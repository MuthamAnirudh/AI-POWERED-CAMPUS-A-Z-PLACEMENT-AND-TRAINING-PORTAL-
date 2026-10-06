'use strict';
// Transport-neutral handlers shared by server.js (Express) and standalone.js (plain http).
let lastManual = 0;
function handle(live, method, pathname, query = {}) {
  if (method === 'GET' && pathname === '/api/live/jobs') return { status: 200, body: live.list(query) };
  if (method === 'GET' && pathname === '/api/live/jobs/stats') return { status: 200, body: live.stats() };
  if (method === 'POST' && pathname === '/api/live/jobs/refresh') { if (Date.now() - lastManual > 30000) { lastManual = Date.now(); live.refresh().catch(() => {}); } return { status: 202, body: { started: true, ...live.stats() } }; }
  return null;
}
module.exports = { handle };
