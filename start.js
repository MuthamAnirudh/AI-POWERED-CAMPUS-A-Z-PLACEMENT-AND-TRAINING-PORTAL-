'use strict';
// Safe launcher: `npm start` always gives you a working GovCareer page.
// 1) Full runtime (server.js: Express + PostgreSQL + Campus Portal) when its dependencies are installed.
// 2) If they are missing, or the full runtime crashes during boot, it falls back to the zero-dependency
//    runtime (standalone.js) which still serves the complete GovCareer UI and the real-time Live Jobs feed.
const { spawn } = require('child_process');
const path = require('path');
const PORT = process.env.PORT || '3000';
let child = null, fellBack = false;
function run(file, label) {
  console.log(`[start] launching ${label} on http://localhost:${PORT}`);
  child = spawn(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit', env: process.env });
  return child;
}
function fallback(why) {
  if (fellBack) return; fellBack = true;
  console.warn(`[start] ${why}. Falling back to the zero-dependency runtime (standalone.js) so GovCareer still opens.`);
  console.warn('[start] For the full runtime run:  npm install   (then set DATABASE_URL, see .env.example)');
  run('standalone.js', 'standalone runtime');
}
let depsOk = true;
for (const m of ['express', 'pg']) { try { require.resolve(m, { paths: [__dirname] }); } catch { depsOk = false; } }
if (!depsOk) fallback('Dependencies are not installed (express/pg missing)');
else {
  const t0 = Date.now();
  run('server.js', 'full runtime').on('exit', (code) => { if (code && Date.now() - t0 < 20000) fallback(`Full runtime exited early (code ${code})`); else process.exit(code || 0); });
}
const stop = (sig) => () => { try { child && child.kill(sig); } catch (_) {} process.exit(0); };
process.on('SIGINT', stop('SIGINT')); process.on('SIGTERM', stop('SIGTERM'));
