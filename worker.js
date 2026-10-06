// Background worker: Phase 1-3 queue plus Phase 4 alert engine.
const db = require('./lib/db');
const queue = require('./lib/queue');
const { handlers } = require('./lib/ingest');
const registry = require('./lib/registry');
const alerts = require('./lib/alerts');
const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));
async function main() {
  await db.migrate(); await registry.seedRegistry();
  const h = handlers({}); let lastTick = 0, lastAlerts = 0;
  log({ msg: 'worker started' });
  for (;;) {
    if (Date.now() - lastTick > 15 * 60 * 1000) { lastTick = Date.now(); await queue.recoverStuck(); await queue.enqueue('SCHEDULE_CRAWLS'); await queue.enqueue('ADVANCE_LIFECYCLE'); }
    if (Date.now() - lastAlerts > 60 * 1000) { lastAlerts = Date.now(); try { log({ msg:'phase4 alerts', ...(await alerts.workerTick()) }); } catch(e) { log({ msg:'phase4 alert error', error:e.message }); } }
    const r = await queue.runOne(h); if (r) log(r); else await new Promise((x) => setTimeout(x, 3000));
  }
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { main };
