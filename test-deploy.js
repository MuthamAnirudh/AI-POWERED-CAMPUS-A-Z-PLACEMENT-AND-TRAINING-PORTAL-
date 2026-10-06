'use strict';
// v2.8.1 regression tests: deployment/runtime wiring that previously failed only in production-like setups.
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const { spawnSync } = require('child_process');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); } };
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

t('sso: Campus counts as enabled locally, and also when a separate CAMPUS_HOST is set even if the local one is disabled', () => {
  const sso = require('./lib/sso'); const save = { ...process.env };
  try {
    delete process.env.DISABLE_CAMPUS_PORTAL; delete process.env.CAMPUS_HOST; assert.strictEqual(sso.campusEnabled(), true);
    process.env.DISABLE_CAMPUS_PORTAL = '1'; assert.strictEqual(sso.campusEnabled(), false);
    process.env.CAMPUS_HOST = 'campus.internal'; assert.strictEqual(sso.campusEnabled(), true);
  } finally { process.env = save; }
  assert(/CAMPUS_HOST\(\)/.test(read('lib/sso.js')), 'campusUser must connect to CAMPUS_HOST, not a hard-coded 127.0.0.1');
});

const prodEnv = (extra) => ({ PATH: process.env.PATH, NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@h/db', JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40), AI_ML_SERVICE_TOKEN: 'c'.repeat(40), OPERATIONS_TOKEN: 'd'.repeat(40), PORTAL_SECRETS_ENCRYPTION_KEY: 'e'.repeat(40), ...extra });
const boot = (extra) => spawnSync(process.execPath, ['-e', "require('./src/config')"], { cwd: path.join(__dirname, 'campus', 'backend'), env: prodEnv(extra), encoding: 'utf8' });
t('campus config: production accepts https origins, localhost over http, and RENDER_EXTERNAL_URL', () => {
  assert.strictEqual(boot({ CORS_ORIGIN: 'https://app.example.in' }).status, 0);
  assert.strictEqual(boot({ CORS_ORIGIN: 'http://localhost:3000' }).status, 0);
  assert.strictEqual(boot({ RENDER_EXTERNAL_URL: 'https://govcareer.onrender.com' }).status, 0);
});
t('campus config: production still rejects public http origins, wildcard and missing origin', () => {
  assert.notStrictEqual(boot({ CORS_ORIGIN: 'http://app.example.in' }).status, 0);
  assert.notStrictEqual(boot({ CORS_ORIGIN: 'http://localhost.evil.com' }).status, 0);
  assert.notStrictEqual(boot({ CORS_ORIGIN: '*' }).status, 0);
  assert.notStrictEqual(boot({}).status, 0);
});
t('server.js passes the platform HTTPS URL to the Campus child instead of http://localhost', () => {
  assert(/CORS_ORIGIN: process\.env\.CORS_ORIGIN \|\| process\.env\.RENDER_EXTERNAL_URL/.test(read('server.js')));
});
t('Dockerfile: OCR (eng/hin/tel), poppler, ffmpeg and the AI/ML virtualenv are built into the image', () => {
  const d = read('Dockerfile');
  for (const x of ['tesseract-ocr-hin', 'tesseract-ocr-tel', 'poppler-utils', 'ffmpeg', 'campus/ai-ml-service/.venv', 'requirements.txt', 'prisma generate']) assert(d.includes(x), x);
  assert(/AI_ML_AUTOINSTALL=false/.test(d));
  assert(fs.existsSync(path.join(__dirname, '.dockerignore')) && /node_modules/.test(read('.dockerignore')));
});
t('docker-compose.unified.yml supplies every secret Campus needs in production; render.yaml builds the AI/ML venv', () => {
  const c = read('docker-compose.unified.yml');
  for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'PORTAL_SECRETS_ENCRYPTION_KEY', 'AI_ML_SERVICE_TOKEN', 'OPERATIONS_TOKEN', 'BRIDGE_SERVICE_SECRET', 'CORS_ORIGIN']) assert(c.includes(k + ':'), k);
  const r = read('render.yaml'); assert(/python3 -m venv campus\/ai-ml-service\/\.venv/.test(r) && /requirements\.txt/.test(r));
  assert(fs.existsSync(path.join(__dirname, 'scripts', 'gen-secrets.js')));
});
t('.env.example has no duplicate keys', () => {
  const keys = read('.env.example').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split('=')[0]);
  assert.deepStrictEqual(keys.filter((k, i) => keys.indexOf(k) !== i), []);
});
console.log(`\nDeploy wiring: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
