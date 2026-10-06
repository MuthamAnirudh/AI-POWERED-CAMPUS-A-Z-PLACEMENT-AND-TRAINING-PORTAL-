'use strict';
// Bridge insight layer (v2.8.0). Pure, deterministic, additive: it reads the output of the existing matcher and
// never changes a score, a rank or an eligibility result.
//
//   demonstration()  how much of a post's skill fit is backed by TESTED evidence, row by row
//   freshness()      how recent the tested evidence for a skill is (fresh / ageing / stale / claim-only / none)
//   practiceQueue()  one ordered "what to practise next" list: close gaps, prove claims, refresh stale skills
//   todayPlan()      the queue packed into the student's daily minutes
//   progressTrend()  direction of travel across saved snapshots
const T = require('./taxonomy');
const { actionsFor } = require('./matcher');

const FRESH_DAYS = 30;     // tested within a month: fresh
const AGING_DAYS = 90;     // up to a quarter: ageing; beyond that: stale
const PROVE_MINUTES = 25;  // one short diagnostic
const REFRESH_MINUTES = 20;
const dayMs = 864e5;
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const ELIGIBLE_FOR_PLAN = ['MATCH', 'PARTIAL_MATCH', 'CONDITIONALLY_ELIGIBLE', 'UNKNOWN'];

function freshness(skillState, now = new Date()) {
  if (!skillState) return { state: 'NO_EVIDENCE', last_tested_at: null, age_days: null };
  const tested = (skillState.sources || []).filter((s) => s.verified);
  if (!tested.length) return { state: skillState.claimed || (skillState.sources || []).length ? 'CLAIM_ONLY' : 'NO_EVIDENCE', last_tested_at: null, age_days: null };
  const times = tested.map((s) => Date.parse(s.at)).filter(Number.isFinite);
  if (!times.length) return { state: 'UNDATED', last_tested_at: null, age_days: null };
  const last = Math.max(...times);
  const age = Math.max(0, Math.floor((now.getTime() - last) / dayMs));
  return { state: age <= FRESH_DAYS ? 'FRESH' : age <= AGING_DAYS ? 'AGING' : 'STALE', last_tested_at: new Date(last).toISOString(), age_days: age };
}

// Which part of this post's skill fit is demonstrated (tested) and which part rests on claims or assumptions.
function demonstration(match, skills = {}, now = new Date()) {
  const cov = (match && match.fit && match.fit.coverage) || [];
  if (!cov.length) return null;
  let demonstrated = 0;
  const rows = cov.map((c) => {
    const tested = !!c.tested;
    const basis = tested ? 'TESTED' : c.level != null ? 'CLAIMED' : 'NONE';
    const provenCov = tested ? Math.min(1, (c.level || 0) / c.target) : 0;
    demonstrated += c.weight * provenCov;
    return {
      skill: c.skill, label: c.label, weight: c.weight, target: c.target, level: c.level, basis,
      demonstrated_coverage: r2(provenCov), claimed_coverage: r2(c.coverage), freshness: freshness(skills[c.skill], now),
    };
  });
  const fit = match.fit.score;
  const demoScore = Math.min(fit, r1(demonstrated * 100));
  return {
    fit_score: fit, demonstrated_score: demoScore, unproven_points: r1(Math.max(0, fit - demoScore)),
    proof_ratio: fit > 0 ? r2(demoScore / fit) : 0, rows,
    note: demoScore >= fit - 0.5 ? 'Your fit for this post is fully backed by tested evidence.'
      : `About ${Math.round(Math.max(0, fit - demoScore))} of the ${Math.round(fit)} fit points rest on resume or self-declared claims, or on assumptions. Tests would confirm or correct them.`,
  };
}

function demandBySkill(result) {
  const per = new Map();
  for (const m of (result.matches || [])) {
    if (!m.fit || !ELIGIBLE_FOR_PLAN.includes(m.eligibility.overall)) continue;
    for (const c of m.fit.coverage) {
      const cur = per.get(c.skill) || { weight: 0, posts: [] };
      cur.weight += c.weight; cur.posts.push({ id: m.id, title: m.title, weight: c.weight });
      per.set(c.skill, cur);
    }
  }
  return per;
}

function sessionMinutes(hours) { return Math.max(20, Math.min(60, Math.round((hours * 60) / 10 / 5) * 5)); }

function practiceQueue({ result, gap, skills = {}, now = new Date(), limit = 8 }) {
  const demand = demandBySkill(result);
  const items = [];
  const inGap = new Set();
  for (const g of (gap && gap.skills) || []) {
    if (!(g.hours_to_close > 0)) continue;
    inGap.add(g.skill);
    const posts = (demand.get(g.skill) || { posts: [] }).posts;
    items.push({
      id: `CLOSE_GAP:${g.skill}`, kind: 'CLOSE_GAP', skill: g.skill, label: g.label, minutes: sessionMinutes(g.hours_to_close),
      why: `${g.demand} reachable post${g.demand === 1 ? '' : 's'} test this and you are at ${g.current_level == null ? 'no evidence' : Math.round(g.current_level * 100) + '%'} against up to ${Math.round(g.target_level * 100)}% needed (about ${g.hours_to_close} h to close).`,
      posts: g.jobs.slice(0, 3).map((j) => ({ id: j.id, title: j.title })), post_count: g.demand,
      unlocks: { to_strong: g.unlocks.to_strong, to_good: g.unlocks.to_good }, actions: g.actions, priority: g.impact_per_50h,
      evidence_state: freshness(skills[g.skill], now).state,
    });
  }
  for (const [skill, d] of demand) {
    if (inGap.has(skill) || !T.isSkill(skill) || T.SKILLS[skill].selfCheck) continue;
    const st = skills[skill]; const fr = freshness(st, now);
    const base = { skill, label: T.label(skill), posts: d.posts.slice(0, 3).map((p) => ({ id: p.id, title: p.title })), post_count: d.posts.length, unlocks: null, evidence_state: fr.state };
    if (st && !st.tested) {
      items.push({ ...base, id: `PROVE_IT:${skill}`, kind: 'PROVE_IT', minutes: PROVE_MINUTES, priority: r2(2 * d.weight), actions: actionsFor(skill, null, {}),
        why: `${d.posts.length} post${d.posts.length === 1 ? '' : 's'} count on this, and your ${Math.round(st.level * 100)}% rests on a claim only. A short tested diagnostic turns it into evidence (it may also correct it).` });
    } else if (st && (fr.state === 'STALE' || fr.state === 'AGING')) {
      items.push({ ...base, id: `REFRESH:${skill}`, kind: 'REFRESH', minutes: REFRESH_MINUTES, priority: r2((fr.state === 'STALE' ? 1.2 : 0.6) * d.weight), actions: actionsFor(skill, null, {}),
        why: `Your tested evidence is ${fr.age_days} days old (${fr.state === 'STALE' ? 'stale' : 'ageing'}). A quick re-test keeps the match honest for ${d.posts.length} post${d.posts.length === 1 ? '' : 's'}.` });
    }
  }
  items.sort((a, b) => b.priority - a.priority || a.minutes - b.minutes || a.id.localeCompare(b.id));
  return items.slice(0, limit).map((it, i) => ({ ...it, rank: i + 1, action: it.actions && it.actions[0] ? it.actions[0] : null }));
}

function todayPlan(queue, dailyMinutes = 120) {
  const chosen = []; let used = 0;
  for (const it of queue) {
    if (used + it.minutes <= dailyMinutes) { chosen.push({ id: it.id, kind: it.kind, label: it.label, minutes: it.minutes }); used += it.minutes; }
  }
  if (!chosen.length && queue.length) { const it = queue[0]; chosen.push({ id: it.id, kind: it.kind, label: it.label, minutes: Math.min(it.minutes, dailyMinutes) }); used = chosen[0].minutes; }
  return { daily_minutes: dailyMinutes, total_minutes: used, items: chosen, note: 'Session lengths are planning figures, not predictions. Re-run Bridge after each test to refresh the order.' };
}

// Attach insight to an analysis output. Existing fields are only added to, never altered.
function enrich(out, { now = new Date(), dailyMinutes } = {}) {
  const skills = out.profile.skills;
  const matches = out.result.matches;
  for (const m of matches) {
    const d = demonstration(m, skills, now);
    if (d) m.demonstrated = { score: d.demonstrated_score, unproven_points: d.unproven_points, proof_ratio: d.proof_ratio };
  }
  const queue = practiceQueue({ result: out.result, gap: out.gap, skills, now });
  const top = matches.filter((m) => m.demonstrated).slice(0, 5);
  const states = Object.values(skills).map((s) => freshness(s, now).state);
  out.insight = {
    version: 1,
    practice_next: queue,
    today_plan: todayPlan(queue, dailyMinutes || out.daily_minutes || 120),
    overview: {
      proven_share: top.length ? r2(top.reduce((s, m) => s + m.demonstrated.proof_ratio, 0) / top.length) : null,
      posts_considered: top.length,
      skills_fresh: states.filter((s) => s === 'FRESH').length, skills_aging: states.filter((s) => s === 'AGING').length,
      skills_stale: states.filter((s) => s === 'STALE').length, skills_claim_only: states.filter((s) => s === 'CLAIM_ONLY').length,
    },
    freshness: Object.fromEntries(Object.entries(skills).map(([id, s]) => [id, freshness(s, now)])),
    rules: [
      'Practice order is a deterministic heuristic: gaps by posts unlocked per study hour, then claims worth proving, then stale tests worth refreshing.',
      'Demonstrated score counts only tested evidence (graded Campus answers, tracked mastery, scored interviews, Exam Lab mock answers). Resume and self-declared levels never count as demonstrated.',
      `Tested evidence is fresh for ${FRESH_DAYS} days, ageing up to ${AGING_DAYS} days, stale after that. Freshness is shown only; it never changes a score.`,
    ],
  };
  return out.insight;
}

// snapshots: [{ at, summary }] in any order.
function progressTrend(snapshots) {
  const pts = (snapshots || []).filter((s) => s && s.summary && Number.isFinite(Date.parse(s.at))).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (pts.length < 2) return { points: pts.length, direction: 'NOT_ENOUGH_DATA', note: 'Save at least two snapshots (tick “save a snapshot” when you run Bridge) to see your trend.' };
  const f = pts[0].summary, l = pts[pts.length - 1].summary;
  const d = (k) => r1((Number(l[k]) || 0) - (Number(f[k]) || 0));
  const delta = { avg_top_fit: d('avg_top_fit'), matches: d('matches'), apply_now: d('apply_now'), skills_verified: d('skills_verified') };
  const score = delta.avg_top_fit + delta.skills_verified * 2 + delta.apply_now * 3;
  const direction = score >= 2 ? 'IMPROVING' : score <= -2 ? 'DECLINING' : 'FLAT';
  const days = Math.max(1, Math.round((Date.parse(pts[pts.length - 1].at) - Date.parse(pts[0].at)) / dayMs));
  return {
    points: pts.length, since_days: days, direction, delta,
    note: direction === 'IMPROVING' ? `Over ${days} day${days === 1 ? '' : 's'} your tested skills and fit have moved up.` : direction === 'DECLINING' ? 'Fit or tested coverage has slipped; new posts or stale tests may be the cause. Check “Practice next”.' : 'No meaningful change yet. Complete the top practice items and re-run Bridge.',
  };
}

module.exports = { freshness, demonstration, practiceQueue, todayPlan, enrich, progressTrend, FRESH_DAYS, AGING_DAYS };
