'use strict';
// Applies every Prisma migration to the production PostgreSQL database.
// Without this step the tables (User, PortalKV, ...) never exist on a fresh Render/Vercel/Neon
// database, so sign-up and login fail with "internal error".
//
// Uses DIRECT_URL (a non-pooled connection string) when provided, because `prisma migrate`
// cannot run through a PgBouncer / "transaction pooler" URL (Supabase 6543, Neon -pooler).
//
// v2.6.3: the Prisma CLI is located dynamically (backend/node_modules, repo-root node_modules, or `npx`).
//
// v2.9.2 (fixes "Error: P1002 ... Timed out trying to acquire a postgres advisory lock" on Render + Neon):
//   * Neon free databases auto-suspend. The first connection can take several seconds while the compute wakes up,
//     and Prisma only waits 10 s for its migration lock. We now WAKE the database first (retrying SELECT 1).
//   * A "-pooler" Neon host is converted to the direct host automatically, and Prisma-only / pgbouncer URL
//     parameters are handled, so a pooled DATABASE_URL no longer breaks `migrate deploy`.
//   * `prisma migrate deploy` is retried with back-off on P1001 / P1002 / lock timeouts / dropped connections.
//   * If a previous (killed) deploy left a session idle while holding the migration lock, that stale session is
//     released (only the exact lock Prisma reported, only when idle >= 60 s). Disable: MIGRATE_KILL_STALE_LOCKS=0.
// Tunables (all optional): MIGRATE_MAX_ATTEMPTS (default 4), MIGRATE_WARMUP_SECONDS (default 60).
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const explicitDirect = String(process.env.DIRECT_URL || '').trim();
const rawUrl = explicitDirect || String(process.env.DATABASE_URL || '').trim();
if (!rawUrl) {
  console.warn('[migrate-deploy] DATABASE_URL is not set - skipping migrations. Accounts will NOT be stored until it is configured.');
  process.exit(0);
}
if (/USER:PASSWORD@HOST/i.test(rawUrl)) {
  console.warn('[migrate-deploy] DATABASE_URL is still the example placeholder - skipping migrations.');
  process.exit(0);
}

const backendDir = path.join(__dirname, '..');
const schema = path.join(backendDir, 'prisma', 'schema.prisma');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Strip query parameters that only Prisma understands, so node-postgres accepts the URL for the warm-up/lock checks.
const PRISMA_ONLY_PARAMS = ['schema', 'connect_timeout', 'pool_timeout', 'socket_timeout', 'connection_limit', 'pgbouncer', 'statement_cache_size'];

function buildMigrationUrl(input) {
  // Returns { prismaUrl, pgUrl, notes[] }
  const notes = [];
  let u;
  try { u = new URL(input); } catch (_) { return { prismaUrl: input, pgUrl: input, notes }; }
  if (/-pooler(\.|$)/i.test(u.hostname)) {
    u.hostname = u.hostname.replace(/-pooler(?=\.|$)/i, '');
    notes.push('Neon "-pooler" host detected; using the direct host for migrations (prisma migrate cannot use PgBouncer).');
  }
  if (u.searchParams.has('pgbouncer')) { u.searchParams.delete('pgbouncer'); notes.push('Removed pgbouncer=true for the migration connection.'); }
  if (/neon\.tech$/i.test(u.hostname) && !u.searchParams.has('sslmode')) u.searchParams.set('sslmode', 'require');
  if (!u.searchParams.has('connect_timeout')) u.searchParams.set('connect_timeout', '30');
  const prismaUrl = u.toString();
  const p = new URL(prismaUrl);
  for (const k of PRISMA_ONLY_PARAMS) p.searchParams.delete(k);
  return { prismaUrl, pgUrl: p.toString(), notes };
}

function findPrismaCli() {
  const searchRoots = [backendDir, path.join(backendDir, '..', '..'), process.cwd()];
  for (const root of searchRoots) {
    try {
      const pkg = require.resolve('prisma/package.json', { paths: [root] });
      const cli = path.join(path.dirname(pkg), 'build', 'index.js');
      if (fs.existsSync(cli)) return cli;
    } catch (_) { /* try next */ }
  }
  for (const root of searchRoots) {
    const cli = path.join(root, 'node_modules', 'prisma', 'build', 'index.js');
    if (fs.existsSync(cli)) return cli;
  }
  return null;
}

function loadPg() {
  for (const root of [backendDir, path.join(backendDir, '..', '..'), process.cwd()]) {
    try { return require(require.resolve('pg', { paths: [root] })); } catch (_) { /* next */ }
  }
  return null;
}

// Wake a suspended (Neon) / slow-starting database before Prisma starts its 10 s lock timer.
async function warmUp(pgUrl) {
  const pg = loadPg();
  if (!pg) { console.warn('[migrate-deploy] "pg" not installed - skipping the database warm-up.'); return; }
  const deadline = Date.now() + Math.max(10, Number(process.env.MIGRATE_WARMUP_SECONDS) || 60) * 1000;
  let attempt = 0, lastErr = null;
  while (Date.now() < deadline) {
    attempt++;
    const client = new pg.Client({ connectionString: pgUrl, connectionTimeoutMillis: 15000, query_timeout: 15000 });
    client.on('error', () => {});
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end().catch(() => {});
      console.log(`[migrate-deploy] Database is awake (attempt ${attempt}).`);
      return;
    } catch (e) {
      lastErr = e;
      try { await client.end(); } catch (_) {}
      console.warn(`[migrate-deploy] Database not ready yet (attempt ${attempt}): ${e && e.message ? e.message : e}`);
      await sleep(Math.min(8000, 1500 * attempt));
    }
  }
  console.warn(`[migrate-deploy] Warm-up gave up (${lastErr && lastErr.message}); trying the migration anyway.`);
}

// Release a migration lock left behind by a killed deploy (idle session still holding the exact lock key Prisma reported).
async function releaseStaleLock(pgUrl, lockKey) {
  if (String(process.env.MIGRATE_KILL_STALE_LOCKS || '1') === '0' || !lockKey) return;
  const pg = loadPg();
  if (!pg) return;
  const key = BigInt(lockKey);
  const classid = Number(key >> 32n), objid = Number(key & 0xffffffffn);
  const client = new pg.Client({ connectionString: pgUrl, connectionTimeoutMillis: 15000, query_timeout: 15000 });
  client.on('error', () => {});
  try {
    await client.connect();
    const r = await client.query(
      `SELECT a.pid, a.state, EXTRACT(EPOCH FROM (now() - a.state_change))::int AS idle_s
         FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE l.locktype = 'advisory' AND l.granted AND l.classid = $1::oid AND l.objid = $2::oid
          AND a.pid <> pg_backend_pid() AND a.datname = current_database()`, [classid, objid]);
    if (!r.rows.length) { console.log('[migrate-deploy] No other session holds the migration lock (it was probably just a slow wake-up).'); return; }
    for (const row of r.rows) {
      if (row.state === 'idle' && row.idle_s >= 60) {
        console.warn(`[migrate-deploy] Releasing stale migration lock held by idle session ${row.pid} (idle ${row.idle_s}s).`);
        await client.query('SELECT pg_terminate_backend($1)', [row.pid]);
      } else {
        console.warn(`[migrate-deploy] Another migration is running right now (session ${row.pid}, ${row.state}, ${row.idle_s}s) - waiting for it to finish.`);
      }
    }
  } catch (e) {
    console.warn(`[migrate-deploy] Could not inspect the migration lock: ${e && e.message ? e.message : e}`);
  } finally { try { await client.end(); } catch (_) {} }
}

function runPrisma(prismaUrl) {
  const env = { ...process.env, DATABASE_URL: prismaUrl };
  const args = ['migrate', 'deploy', '--schema', schema];
  const opts = { stdio: ['inherit', 'pipe', 'pipe'], env, cwd: backendDir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 };
  const cli = findPrismaCli();
  let r;
  if (cli) r = spawnSync(process.execPath, [cli, ...args], opts);
  else {
    console.warn('[migrate-deploy] Prisma CLI not found locally - falling back to npx.');
    r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'prisma@5', ...args], opts);
  }
  const out = String(r.stdout || ''), err = String(r.stderr || '');
  if (out) process.stdout.write(out);
  if (err) process.stderr.write(err);
  return { status: r.status === null ? 1 : r.status, text: out + '\n' + err };
}

const RETRYABLE = /P1001|P1002|P1017|advisory lock|timed out|ECONNRESET|ECONNREFUSED|terminating connection|Can't reach database server|Connection terminated/i;

(async () => {
  const { prismaUrl, pgUrl, notes } = buildMigrationUrl(rawUrl);
  notes.forEach((n) => console.log('[migrate-deploy] ' + n));
  await warmUp(pgUrl);
  const maxAttempts = Math.max(1, Number(process.env.MIGRATE_MAX_ATTEMPTS) || 4);
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) console.log(`[migrate-deploy] Retry ${attempt}/${maxAttempts} ...`);
    last = runPrisma(prismaUrl);
    if (last.status === 0) { console.log('[migrate-deploy] Database schema is up to date.'); return; }
    if (!RETRYABLE.test(last.text) || attempt === maxAttempts) break;
    const m = /pg_advisory_lock\((\d+)\)/.exec(last.text);
    if (m) await releaseStaleLock(pgUrl, m[1]);
    const wait = 5000 * attempt;
    console.warn(`[migrate-deploy] Attempt ${attempt} failed with a transient database error; waiting ${wait / 1000}s ...`);
    await sleep(wait);
    await warmUp(pgUrl);
  }
  console.error('[migrate-deploy] prisma migrate deploy FAILED. Check DATABASE_URL / DIRECT_URL.');
  if (last && /P1002|advisory lock|P1001/i.test(last.text)) {
    console.error('[migrate-deploy] Hint: the database was unreachable or locked. On Neon, open the project in the Neon console and make sure the compute is Active,');
    console.error('[migrate-deploy]       use the DIRECT (non "-pooler") connection string in DIRECT_URL, and keep "?sslmode=require" on it. Then redeploy.');
  }
  process.exit(last && last.status ? last.status : 1);
})().catch((e) => { console.error('[migrate-deploy] unexpected error:', e && e.stack || e); process.exit(1); });
