'use strict';
// Bridge v2.8.0 insight tests: demonstrated-vs-claimed, freshness, practice queue, today plan, trend.
// No database, browser or npm packages needed.
const assert = require('assert');
const fs = require('fs');
const M = require('./lib/bridge/matcher');
const I = require('./lib/bridge/insight');
const S = require('./lib/bridge/service');
const { createApi } = require('./lib/bridge/api');
const { buildJobs } = require('./data/jobs');
const runtime = require('./lib/runtime');

let passed = 0, failed = 0; const queue = [];
const test = (n, f) => queue.push([n, f]);
const NOW = new Date();
const jobs = buildJobs(NOW).filter((j) => j.lifecycle !== 'REVIEW_REQUIRED' && j.verification && j.verification.status === 'VERIFIED');
const exams = runtime.exams();
const syl = Object.fromEntries(exams.map((e) => [e.version_id, runtime.syllabus(e.version_id)]));
const grad = { education: { level: 'bachelor', status: 'completed', field: 'engineering' }, dob: '2000-05-10', state: 'Telangana', category: 'OBC' };
const daysAgo = (n) => new Date(NOW.getTime() - n * 864e5).toISOString();
const skill = (id, level, o = {}) => ({ skill: id, label: id, group: 'x', level, confidence: 0.8, verified: !!o.tested, tested: !!o.tested, claimed: !o.tested,
  sources: [{ kind: o.tested ? 'campus_aptitude' : 'self', source: 'x', verified: !!o.tested, level, detail: 'd', at: o.at || null }] });
const analyse = (skills, extra = {}) => {
  const result = M.matchJobs({ jobs, profile: grad, skills, now: NOW, exams, syllabusByVersion: syl, options: { dailyMinutes: 120 } });
  const gap = M.gapAnalysis(result, skills, syl, { dailyMinutes: 120 });
  return { profile: { skills }, result, gap, daily_minutes: 120, ...extra };
};

test('freshness: fresh, ageing, stale, claim-only, none and undated are told apart', () => {
  assert.strictEqual(I.freshness(skill('quant', 0.7, { tested: true, at: daysAgo(5) }), NOW).state, 'FRESH');
  assert.strictEqual(I.freshness(skill('quant', 0.7, { tested: true, at: daysAgo(60) }), NOW).state, 'AGING');
  const st = I.freshness(skill('quant', 0.7, { tested: true, at: daysAgo(200) }), NOW);
  assert.strictEqual(st.state, 'STALE'); assert.strictEqual(st.age_days, 200);
  assert.strictEqual(I.freshness(skill('quant', 0.7), NOW).state, 'CLAIM_ONLY');
  assert.strictEqual(I.freshness(undefined, NOW).state, 'NO_EVIDENCE');
  assert.strictEqual(I.freshness(skill('quant', 0.7, { tested: true }), NOW).state, 'UNDATED');
});

test('demonstration: claims never count as demonstrated and never exceed the fit', () => {
  const claims = { quant: skill('quant', 0.9), reasoning: skill('reasoning', 0.9), english: skill('english', 0.9) };
  const r = analyse(claims);
  const m = r.result.matches.find((x) => x.fit && x.fit.coverage.some((c) => ['quant', 'reasoning', 'english'].includes(c.skill)));
  assert(m, 'a post that tests aptitude exists');
  const d = I.demonstration(m, claims, NOW);
  assert.strictEqual(d.demonstrated_score, 0); assert(d.fit_score > 0); assert.strictEqual(d.proof_ratio, 0);
  assert(d.rows.every((x) => x.basis !== 'TESTED'));
  const tested = { quant: skill('quant', 0.9, { tested: true, at: daysAgo(3) }), reasoning: skill('reasoning', 0.9, { tested: true, at: daysAgo(3) }), english: skill('english', 0.9, { tested: true, at: daysAgo(3) }) };
  const r2 = analyse(tested); const m2 = r2.result.matches.find((x) => x.id === m.id);
  const d2 = I.demonstration(m2, tested, NOW);
  assert(d2.demonstrated_score > 0 && d2.demonstrated_score <= d2.fit_score + 1e-9);
  assert(d2.proof_ratio > 0.3);
});

test('enrich never changes a score, rank, action or eligibility', () => {
  const sk = { quant: skill('quant', 0.6, { tested: true, at: daysAgo(100) }), reasoning: skill('reasoning', 0.8) };
  const a = analyse(sk), b = JSON.parse(JSON.stringify(analyse(sk)));
  I.enrich(a, { now: NOW });
  const strip = (x) => x.result.matches.map((m) => [m.id, m.bridge_score, m.action.code, m.eligibility.overall, m.fit && m.fit.score]);
  assert.deepStrictEqual(strip(a), strip(b));
  assert(a.insight && Array.isArray(a.insight.practice_next));
});

test('practice queue: claim-only skills get PROVE_IT, stale tests REFRESH, gaps CLOSE_GAP; ordered and bounded', () => {
  const sk = { quant: skill('quant', 0.95, { tested: true, at: daysAgo(150) }), reasoning: skill('reasoning', 0.95), english: skill('english', 0.2, { tested: true, at: daysAgo(2) }) };
  const r = analyse(sk); I.enrich(r, { now: NOW });
  const q = r.insight.practice_next;
  assert(q.length > 0 && q.length <= 8);
  const kinds = new Set(q.map((x) => x.kind));
  assert(kinds.has('CLOSE_GAP'), 'english gap');
  for (let i = 1; i < q.length; i++) assert(q[i - 1].priority >= q[i].priority, 'sorted by priority');
  assert(q.every((x, i) => x.rank === i + 1 && x.minutes >= 20 && x.posts.length > 0 && x.why));
  assert.strictEqual(new Set(q.map((x) => x.id)).size, q.length, 'no duplicates');
  const p = q.find((x) => x.skill === 'reasoning' && x.kind === 'PROVE_IT');
  if (p) assert(/claim/i.test(p.why));
  const f = q.find((x) => x.skill === 'quant' && x.kind === 'REFRESH');
  if (f) assert(/150 days/.test(f.why));
});

test('practice queue is deterministic and empty when nothing is open', () => {
  const sk = { quant: skill('quant', 0.6, { tested: true, at: daysAgo(1) }) };
  const a = analyse(sk), b = analyse(sk); I.enrich(a, { now: NOW }); I.enrich(b, { now: NOW });
  assert.deepStrictEqual(a.insight.practice_next, b.insight.practice_next);
  assert.deepStrictEqual(I.practiceQueue({ result: { matches: [] }, gap: { skills: [] }, skills: {}, now: NOW }), []);
});

test('today plan fits the daily minutes and always offers one item when the queue is not empty', () => {
  const q = [{ id: 'a', kind: 'CLOSE_GAP', label: 'A', minutes: 50 }, { id: 'b', kind: 'PROVE_IT', label: 'B', minutes: 25 }, { id: 'c', kind: 'REFRESH', label: 'C', minutes: 20 }];
  const p = I.todayPlan(q, 60);
  assert(p.total_minutes <= 60); assert.deepStrictEqual(p.items.map((x) => x.id), ['a']);
  const tiny = I.todayPlan(q, 15); assert.strictEqual(tiny.items.length, 1); assert(tiny.total_minutes <= 15);
  assert.deepStrictEqual(I.todayPlan([], 60).items, []);
});

test('progress trend: order-independent, honest about too little data', () => {
  assert.strictEqual(I.progressTrend([]).direction, 'NOT_ENOUGH_DATA');
  assert.strictEqual(I.progressTrend([{ at: daysAgo(1), summary: { avg_top_fit: 40 } }]).direction, 'NOT_ENOUGH_DATA');
  const s1 = { at: daysAgo(14), summary: { avg_top_fit: 40, matches: 5, apply_now: 0, skills_verified: 1 } };
  const s2 = { at: daysAgo(1), summary: { avg_top_fit: 52, matches: 6, apply_now: 1, skills_verified: 3 } };
  const up = I.progressTrend([s2, s1]);
  assert.strictEqual(up.direction, 'IMPROVING'); assert.strictEqual(up.delta.avg_top_fit, 12); assert.strictEqual(up.since_days, 13);
  assert.deepStrictEqual(I.progressTrend([s1, s2]).delta, up.delta);
  assert.strictEqual(I.progressTrend([s2, s1].map((s, i) => (i ? { ...s, summary: { ...s.summary } } : s)).reverse().map((s) => ({ ...s, summary: { avg_top_fit: 50, matches: 5, apply_now: 0, skills_verified: 2 } }))).direction, 'FLAT');
  assert.strictEqual(I.progressTrend([s2, { ...s1, summary: s2.summary }]).direction, 'FLAT');
  assert.strictEqual(I.progressTrend([{ at: daysAgo(14), summary: s2.summary }, { at: daysAgo(1), summary: s1.summary }]).direction, 'DECLINING');
});

test('api: analyze returns insight; explain returns demonstration; response stays honest with no evidence', async () => {
  const api = createApi({ jobs: () => jobs, exams: () => exams, syllabus: (id) => syl[id] || [], store: null, campus: null, consentVersion: () => 'x', audit: null, privacyEvent: null, now: () => NOW });
  const res = await api.analyze({ body: { profile: grad, self: { quant: 'strong' } }, account: null, cookies: '' });
  assert.strictEqual(res.status, 200);
  const ins = res.body.insight; assert(ins && ins.practice_next && ins.today_plan && ins.overview && ins.rules.length >= 3);
  assert.strictEqual(ins.overview.skills_fresh, 0, 'self-declared never counts as fresh tested evidence');
  assert(ins.overview.skills_claim_only >= 1);
  assert(res.body.result.matches.every((m) => !m.fit || (m.demonstrated && m.demonstrated.score === 0)), 'claims demonstrate nothing');
  const id = res.body.result.matches[0].id;
  const ex = await api.explain({ body: { profile: grad }, params: { id }, account: null, cookies: '' });
  assert.strictEqual(ex.status, 200); assert('demonstration' in ex.body.job);
});

test('api: history exposes a trend', async () => {
  const snaps = [{ id: 1, summary: { avg_top_fit: 55, matches: 5, apply_now: 1, skills_verified: 3 }, top: [], created_at: daysAgo(1) }, { id: 2, summary: { avg_top_fit: 40, matches: 4, apply_now: 0, skills_verified: 1 }, top: [], created_at: daysAgo(10) }];
  const store = { listSnapshots: async () => snaps };
  const api = createApi({ jobs: () => jobs, exams: () => exams, syllabus: () => [], store, campus: null, consentVersion: () => 'x', now: () => NOW });
  const r = await api.history({ account: { id: 1 }, query: {} });
  assert.strictEqual(r.body.trend.direction, 'IMPROVING');
});

test('wiring: UI tab, CSP-safe markup, service worker cache bumped, docs present', () => {
  const html = fs.readFileSync('public/index.html', 'utf8'), js = fs.readFileSync('public/bridge.js', 'utf8'), sw = fs.readFileSync('public/sw.js', 'utf8');
  assert(/data-tab="next"/.test(html)); assert(/renderNext/.test(js) && /proofLine/.test(js) && /demoTable/.test(js));
  assert(!/\son(click|change|input)=/.test(js), 'no inline handlers');
  assert(/govcareer-shell-v1\d/.test(sw));
  assert(fs.existsSync('BRIDGE.md') && /Practice next/.test(fs.readFileSync('BRIDGE.md', 'utf8')));
});

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e)); }
  }
  console.log(`\nBridge v2.8: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
