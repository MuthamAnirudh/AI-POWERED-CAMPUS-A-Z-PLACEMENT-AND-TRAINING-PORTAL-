'use strict';
// Live Jobs engine tests. Uses a local mock "portal" + RSS feed so it runs offline.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { createLiveJobs, parseFeed, parseHtmlLinks, parseVacancies, parseLastDate } = require('./lib/liveJobs');
const liveApi = require('./lib/liveJobsApi');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };

const rssPage = (n, p) => `<?xml version="1.0"?><rss><channel>${Array.from({ length: n }, (_, i) => `<item><title>Dept ${p}-${i} Recruitment 2026 – ${100 + i} Posts Apply Online</title><link>http://127.0.0.1:PORT/post/${p}-${i}?utm_source=x</link><description><![CDATA[<p>Qualification: 10th pass. Last Date: 25/12/2030. Telangana.</p>]]></description><pubDate>Mon, 05 Oct 2026 10:00:00 +0000</pubDate></item>`).join('')}</channel></rss>`;
const portal = `<html><body><a href="/careers/notice1.pdf">Recruitment of Junior Engineers 2026 – 45 vacancies</a><a href="/">Home</a><a href="/x">Contact us page link</a>
<a href="/result/2">Final Result of Combined Exam 2025 declared</a><a href="http://evil.example.com/jobs">Apply now for Government Jobs recruitment</a><a href="/careers/notice1.pdf">Recruitment of Junior Engineers 2026 – 45 vacancies</a></body></html>`;

(async () => {
  // unit parsers
  ok(parseVacancies('Total 1,250 Posts available') === 1250, 'vacancies with comma');
  ok(parseVacancies('Recruitment of 45 vacancies') === 45, 'vacancies simple');
  ok(parseVacancies('no number here') === null, 'no invented vacancies');
  ok(parseLastDate('Last Date: 25/12/2030') === '2030-12-25', 'last date dd/mm/yyyy');
  ok(parseLastDate('apply before 3 March 2031') === '2031-03-03', 'last date month name');
  ok(parseLastDate('Notification released today') === null, 'no invented date');
  ok(parseFeed('<feed><entry><title>A Recruitment</title><link href="https://a.gov.in/x"/></entry></feed>').length === 1, 'atom parse');
  ok(parseHtmlLinks(portal, { url: 'http://127.0.0.1/' }).length >= 3, 'html links parsed');

  let hits = 0;
  const srv = http.createServer((req, res) => {
    hits++;
    const port = srv.address().port;
    if (req.url.startsWith('/feed')) { const m = req.url.match(/paged=(\d+)/); const pg = m ? Number(m[1]) : 1; res.setHeader('content-type', 'application/rss+xml'); return res.end(pg <= 3 ? rssPage(10, pg).replace(/PORT/g, port) : '<rss><channel></channel></rss>'); }
    if (req.url === '/portal') { res.setHeader('content-type', 'text/html'); return res.end(portal); }
    res.statusCode = 503; res.end('down');
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lj-'));
  const sources = [
    { id: 'gov', name: 'Gov Portal', org: 'Test Dept', level: 'Central', kind: 'html', url: `http://127.0.0.1:${port}/portal` },
    { id: 'feed', name: 'Feed', org: 'Aggregated', level: 'Aggregator', kind: 'rss', url: `http://127.0.0.1:${port}/feed`, pages: 10 },
    { id: 'dead', name: 'Dead', org: 'X', level: 'State', kind: 'html', url: `http://127.0.0.1:${port}/dead` },
    { id: 'gone', name: 'Gone', org: 'Y', level: 'State', kind: 'html', url: 'http://127.0.0.1:9/none' },
  ];
  const live = createLiveJobs({ dir, sources, refreshMinutes: 60 });
  let changed = 0; live.onChange(() => changed++);
  const r = await live.refresh();
  ok(r.total >= 31, 'collected feed (3 pages x 10) + portal posts: ' + r.total);
  ok(changed === 1, 'onChange fired');
  const st = live.stats();
  ok(st.sources_online === 2 && st.sources.find(s => s.id === 'dead').status === 'HTTP_ERROR', 'dead sources reported, others unaffected');
  ok(st.sources.find(s => s.id === 'gone').status !== 'ONLINE', 'unreachable source reported');
  let l = live.list({});
  ok(l.items.every(i => i.kind === 'RECRUITMENT'), 'default list is recruitments only');
  ok(l.items.every(i => i.verification === 'LIVE_UNVERIFIED'), 'nothing is marked verified');
  ok(!live.list({ kind: 'RECRUITMENT', q: 'Final Result' }).items.length, 'result notices not in recruitment list');
  ok(live.list({ kind: 'RESULT' }).total === 1, 'result notice classified');
  ok(live.list({ source: 'gov' }).items.every(i => i.official), 'official flag from non-aggregator source');
  ok(!live._store.has('evil') && ![...live._store.values()].some(i => i.url.includes('evil.example.com')), 'off-domain links from official portals are dropped');
  ok([...live._store.values()].filter(i => i.title.includes('Junior Engineers')).length === 1, 'duplicate links collapsed');
  const f = live.list({ q: 'dept 2-3' }).items[0];
  ok(f && f.vacancies === 103 && f.last_date === '2030-12-25' && f.state === 'Telangana' && f.quals.includes('10th'), 'fields extracted only from text');
  ok(f && !f.url.includes('utm_source'), 'tracking params stripped');
  const n1 = r.total; const r2 = await live.refresh(); ok(r2.total === n1 && r2.added === 0, 'second refresh adds no duplicates');
  l = live.list({ pageSize: 10, page: 2 }); ok(l.page === 2 && l.items.length === 10 && l.pages >= 3, 'pagination');
  ok(live.list({ sort: 'vacancies' }).items[0].vacancies >= live.list({ sort: 'vacancies' }).items[5].vacancies, 'sort by vacancies');
  ok(live.list({ hideClosed: '1' }).total === live.list({}).total, 'future last dates stay visible');
  ok(live.list({ state: 'Telangana' }).total >= 30 && l.facets.states.length >= 1, 'state filter + facets');
  // persistence
  const live2 = createLiveJobs({ dir, sources: [], refreshMinutes: 60 }); live2.start(); live2.stop();
  ok(live2.stats().total === r.total, 'store persists across restarts');
  // api handler
  ok(liveApi.handle(live, 'GET', '/api/live/jobs', { q: 'dept' }).body.total > 0, 'api list');
  ok(liveApi.handle(live, 'GET', '/api/live/jobs/stats', {}).body.sources_total === 4, 'api stats');
  ok(liveApi.handle(live, 'POST', '/api/live/jobs/refresh', {}).status === 202, 'api refresh');
  ok(liveApi.handle(live, 'GET', '/api/other', {}) === null, 'api ignores other paths');
  await live.refresh();
  // growth to 1000+ with many feed pages (accumulation + prune cap)
  const big = createLiveJobs({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'lj2-')), sources: [{ id: 'f', name: 'F', org: 'O', level: 'Aggregator', kind: 'rss', url: `http://127.0.0.1:${port}/feed`, pages: 3 }], maxItems: 20, refreshMinutes: 60 });
  await big.refresh(); ok(big.stats().total <= 20, 'maxItems cap enforced');
  srv.close();
  console.log(`Live Jobs tests: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
