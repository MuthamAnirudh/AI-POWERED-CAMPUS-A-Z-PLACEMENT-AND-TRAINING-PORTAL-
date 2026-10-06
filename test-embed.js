'use strict';
// v2.9.0: GovCareer AI as a sub-tab of the Campus "1000+ Roadmaps & Govt Jobs" tab.
const fs = require('fs'), http = require('http');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const rt = fs.readFileSync('campus/frontend/app-runtime.js', 'utf8');

// Campus side: sub-tab bar, gate, workspace bar, render block, component
ok(rt.includes("setCtSector('govcareer')"), 'sub-tab button sets the govcareer sector');
ok(rt.includes("ctSector === 'govcareer' && React.createElement(GovCareerEmbed"), 'govcareer sub-tab renders the embed');
ok(rt.includes('const GovCareerEmbed = () =>') && rt.includes("'?embed=1'"), 'embed component loads GovCareer in embed mode');
ok(rt.includes("['govcareer','GovCareer AI']"), 'workspace bar offers GovCareer AI');
// earlier sub-tabs untouched
ok(rt.includes("ctSector === 'private' && (React.createElement") && rt.includes("ctSector === 'government' && (React.createElement"), 'Roadmaps and Govt Jobs sub-tabs still present');
ok(rt.includes('1000+ Roadmaps') && rt.includes('1000+ Govt Jobs') && rt.includes("id: 'careerTracks', label: '1000+ Roadmaps & Govt Jobs'"), 'tab and sub-tab labels unchanged');

// GovCareer side
const html = fs.readFileSync('public/index.html', 'utf8');
ok(html.includes('href="embed.css"') && html.includes('src="embed.js"'), 'embed assets wired into index.html');
ok(fs.readFileSync('public/sw.js', 'utf8').includes('/embed.js'), 'service worker precaches embed assets');
ok(/href="\/campus\/"/.test(html) && fs.readFileSync('public/embed.css', 'utf8').includes('href="/campus/"'), 'Campus link only hidden when embedded');

(async () => {
  const app = require('./server');
  await app.ready;
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const get = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: srv.address().port, path: p }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({ h: r.headers, s: r.statusCode, b })); }).on('error', rej));
  const root = await get('/?embed=1');
  ok(root.s === 200, 'GovCareer root serves 200 in embed mode');
  ok(root.h['x-frame-options'] === 'SAMEORIGIN', 'X-Frame-Options is SAMEORIGIN (was DENY)');
  ok(/frame-ancestors 'self'(;|$)/.test(root.h['content-security-policy'] || ''), "CSP frame-ancestors is 'self' only by default");
  ok((await get('/embed.js')).s === 200 && (await get('/embed.css')).s === 200, 'embed assets served');
  srv.close();
  console.log(`Embed tests: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
