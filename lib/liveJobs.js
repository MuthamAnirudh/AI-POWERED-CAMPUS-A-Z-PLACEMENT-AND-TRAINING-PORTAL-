'use strict';
// GovCareer AI - Live Jobs engine (real-time, additive).
// Pulls recruitment postings from official portals and RSS feeds on a schedule, de-duplicates them, keeps a
// growing persistent store (default up to 5000 posts) and serves filtered/paginated lists.
// Integrity rule of the project is kept: nothing here is presented as a *verified* record. Every item is
// labelled LIVE_UNVERIFIED with a link to its source; vacancies / last date are shown only when the source text
// itself states them, and eligibility stays UNKNOWN until the post goes through the verified pipeline.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UA = 'Mozilla/5.0 (compatible; GovCareerAI/2.7; +official-source-monitor)';
const STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Jammu and Kashmir','Ladakh','Puducherry','Chandigarh'];
const QUALS = [['10th', /\b(10th|matric|ssc pass|tenth)\b/i], ['12th', /\b(12th|intermediate|hsc|higher secondary|10\+2)\b/i], ['ITI', /\biti\b/i], ['Diploma', /\bdiploma\b/i], ['Graduate', /\b(graduate|graduation|any degree|degree)\b/i], ['B.Tech/B.E', /\b(b\.?\s?tech|b\.?e\b|engineering)\b/i], ['Post Graduate', /\b(post graduate|postgraduate|master|m\.?sc|m\.?a\b|m\.?com|mba)\b/i], ['Nursing/Medical', /\b(nursing|mbbs|pharmac|medical officer|paramedical|b\.?sc nursing)\b/i], ['Law', /\b(llb|law officer|legal)\b/i]];
const KIND_RULES = [['ADMIT_CARD', /admit card|hall ticket|call letter/i], ['RESULT', /\b(result|merit list|cut[- ]?off|final selection|scorecard|answer key)\b/i], ['RECRUITMENT', /recruit|vacanc|notification|advertis|apply|online form|posts?\b|jobs?\b|walk[- ]?in|engagement|appointment|apprentice|bharti|opening|career/i]];
const JUNK = /^(home|contact|about|login|sign in|register|read more|click here|more|next|previous|skip to|sitemap|disclaimer|privacy|terms|rti|faq|help|download app)/i;

const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);
const clean = (s) => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8211;|&#8212;/g, '-').replace(/&#8217;|&#039;|&#39;/g, "'").replace(/&quot;|&#8220;|&#8221;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
const normTitle = (t) => String(t).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(recruitment|notification|apply online|online form|out|released|official|latest)\b/g, ' ').replace(/\s+/g, ' ').trim();
const normUrl = (u) => { try { const x = new URL(u); x.hash = ''; ['utm_source', 'utm_medium', 'utm_campaign'].forEach(k => x.searchParams.delete(k)); return x.href.replace(/\/$/, ''); } catch { return String(u); } };

function classify(text) { for (const [k, re] of KIND_RULES) if (re.test(text)) return k; return 'OTHER'; }
function parseVacancies(text) {
  const m = String(text).match(/(\d[\d,]{0,6})\s*(?:\+\s*)?(?:posts?|vacanc(?:y|ies)|seats|positions|openings)\b/i) || String(text).match(/(?:posts?|vacanc(?:y|ies))\s*[:\-]?\s*(\d[\d,]{0,6})\b/i);
  if (!m) return null; const n = Number(m[1].replace(/,/g, '')); return n > 0 && n < 1000000 ? n : null;
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function parseLastDate(text) {
  const t = String(text);
  const ctx = t.match(/(?:last\s*date|closing\s*date|apply\s*(?:online\s*)?(?:till|before|by|upto|up to)|till)\D{0,25}?(\d{1,2})[\/\-.\s]+(\d{1,2}|[A-Za-z]{3,9})[\/\-.,\s]+(\d{2,4})/i);
  if (!ctx) return null;
  let d = Number(ctx[1]), m = /^\d+$/.test(ctx[2]) ? Number(ctx[2]) : MONTHS[ctx[2].slice(0, 3).toLowerCase()], y = Number(ctx[3]);
  if (y < 100) y += 2000; if (!m || m > 12 || d > 31 || y < 2020 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function detectState(text, src) {
  if (src && src.state) return src.state;
  for (const s of STATES) if (new RegExp('\\b' + s + '\\b', 'i').test(text)) return s;
  return /\b(TSPSC|TGPSC)\b/i.test(text) ? 'Telangana' : /\bAPPSC\b/i.test(text) ? 'Andhra Pradesh' : null;
}
function detectLevel(text, src) {
  if (src && src.level && src.level !== 'Aggregator') return src.level;
  if (/\b(bank|ibps|sbi|rbi|nabard|clerk|probationary)\b/i.test(text)) return 'Bank';
  if (/\b(railway|rrb|rrc|ntpc|group d|alp)\b/i.test(text)) return 'Railway';
  if (/\b(army|navy|air ?force|agniveer|defence|bsf|crpf|cisf|itbp|ssb|assam rifles)\b/i.test(text)) return 'Defence';
  if (/\b(police|constable|sub[- ]?inspector|\bsi\b|fireman|jail)\b/i.test(text)) return 'Police';
  if (/\b(teacher|tgt|pgt|prt|lecturer|professor|kvs|nvs|dsssb)\b/i.test(text)) return 'Teaching';
  if (/\b(ongc|ntpc|bhel|sail|iocl|bpcl|hpcl|gail|coal india|psu|power grid|npcil|hal|bel|bhel)\b/i.test(text)) return 'PSU';
  if (/\b(psc|state|subordinate|secretariat|municipal|zilla|district)\b/i.test(text)) return 'State';
  return 'Central';
}

// ---- parsing -----------------------------------------------------------------------------------------
function parseHtmlLinks(html, src) {
  const out = []; const seen = new Set();
  let base; try { base = new URL(src.url); } catch { return out; }
  for (const m of String(html).matchAll(/<a\s[^>]*?href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const u = new URL(m[1].trim(), base); if (!/^https?:$/.test(u.protocol)) continue;
      const title = clean(m[2]) || clean((m[0].match(/title\s*=\s*["']([^"']+)/i) || [])[1]);
      if (title.length < 12 || title.length > 300 || JUNK.test(title)) continue;
      const hay = `${title} ${u.pathname}`;
      if (!/recruit|vacanc|notification|advertis|apply|online|posts?\b|jobs?\b|walk[- ]?in|engagement|appointment|apprentice|bharti|career|opening|admit|result|examination|exam\b/i.test(hay)) continue;
      const href = normUrl(u.href); if (seen.has(href)) continue; seen.add(href);
      out.push({ title, url: href, summary: '' });
    } catch (_) {}
  }
  return out.slice(0, 120);
}
function parseFeed(xml) {
  const out = [];
  const items = String(xml).match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const it of items) {
    const tag = (n) => { const m = it.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`, 'i')); return m ? m[1] : ''; };
    const title = clean(tag('title')); if (!title) continue;
    let link = clean(tag('link')) || (it.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] || clean(tag('guid'));
    if (!/^https?:/i.test(link)) continue;
    const summary = clean(tag('description') || tag('summary') || tag('content:encoded') || tag('content')).slice(0, 900);
    const pub = tag('pubDate') || tag('published') || tag('updated') || tag('dc:date');
    const pd = pub ? new Date(clean(pub)) : null;
    out.push({ title, url: normUrl(link), summary, published_at: pd && !isNaN(pd) ? pd.toISOString() : null });
  }
  return out;
}

async function httpGet(url, { timeoutMs = 12000, maxBytes = 2.5e6, fetchImpl = globalThis.fetch } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml,application/rss+xml,*/*;q=0.8', 'accept-language': 'en-IN,en;q=0.9' } });
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.http = r.status; throw e; }
    const buf = Buffer.from(await r.arrayBuffer()); return { text: buf.subarray(0, maxBytes).toString('utf8'), finalUrl: r.url || url };
  } finally { clearTimeout(t); }
}

// ---- engine ------------------------------------------------------------------------------------------
function createLiveJobs(opts = {}) {
  const dir = opts.dir || process.env.STORAGE_DIR || path.join(__dirname, '..', 'storage');
  const file = path.join(dir, 'live-jobs.json');
  const maxItems = Number(opts.maxItems || process.env.LIVE_JOBS_MAX || 5000);
  const keepDays = Number(opts.keepDays || process.env.LIVE_JOBS_KEEP_DAYS || 180);
  const everyMin = Number(opts.refreshMinutes || process.env.LIVE_REFRESH_MINUTES || 15);
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const concurrency = Number(opts.concurrency || 6);
  let sources = opts.sources;
  if (!sources) {
    try { sources = JSON.parse(fs.readFileSync(process.env.LIVE_JOB_SOURCES_FILE || path.join(__dirname, '..', 'data', 'liveJobSources.json'), 'utf8')).sources; } catch { sources = []; }
    String(process.env.LIVE_JOB_FEEDS || '').split(',').map(s => s.trim()).filter(Boolean).forEach((u, i) => sources.push({ id: 'custom' + (i + 1), name: 'Custom feed ' + (i + 1), org: 'Custom feed', level: 'Aggregator', kind: 'rss', url: u, pages: 5 }));
  }
  const store = new Map(); // id -> item
  const status = new Map(); // source id -> {...}
  const listeners = new Set();
  let version = 0, updatedAt = null, running = null, timer = null, firstRunDone = false;

  function load() {
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); (j.items || []).forEach(i => store.set(i.id, i)); updatedAt = j.updated_at || null; version = j.version || 0; } catch (_) {}
  }
  function save() {
    if (opts.persist === false) return;
    try { fs.mkdirSync(dir, { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ version, updated_at: updatedAt, items: [...store.values()] })); fs.renameSync(tmp, file); } catch (_) {}
  }
  function prune(now) {
    const cutoff = now - keepDays * 864e5;
    for (const [id, it] of store) if (Date.parse(it.last_seen) < cutoff) store.delete(id);
    if (store.size > maxItems) [...store.values()].sort((a, b) => Date.parse(b.last_seen) - Date.parse(a.last_seen)).slice(maxItems).forEach(it => store.delete(it.id));
  }

  function upsert(raw, src, nowIso) {
    const text = `${raw.title} ${raw.summary || ''}`;
    const kind = classify(raw.title) !== 'OTHER' ? classify(raw.title) : classify(text);
    if (src.kind === 'html' && kind === 'OTHER') return null;
    const key = sha(normUrl(raw.url));
    const dupKey = sha(normTitle(raw.title) + '|' + (raw.published_at || '').slice(0, 7));
    let it = store.get(key);
    if (!it) for (const x of store.values()) if (x.dup_key === dupKey && normTitle(x.title) === normTitle(raw.title)) { it = x; break; }
    if (it) {
      it.last_seen = nowIso;
      if (!it.sources.some(s => s.id === src.id)) it.sources.push({ id: src.id, name: src.name, url: raw.url });
      if (src.level !== 'Aggregator' && it.sources[0].id !== src.id) { /* prefer official source as primary */ it.sources.sort((a, b) => (a.id === src.id ? -1 : 0) - (b.id === src.id ? -1 : 0)); it.url = raw.url; it.official = true; }
      return null;
    }
    const lastDate = parseLastDate(text);
    const item = {
      id: key, dup_key: dupKey, title: raw.title.slice(0, 280), url: raw.url, summary: (raw.summary || '').slice(0, 500),
      kind, org: src.org, level: detectLevel(text, src), state: detectState(text, src), quals: QUALS.filter(([, re]) => re.test(text)).map(([n]) => n),
      vacancies: parseVacancies(text), last_date: lastDate, published_at: raw.published_at || null,
      first_seen: nowIso, last_seen: nowIso, official: src.level !== 'Aggregator', sources: [{ id: src.id, name: src.name, url: raw.url }],
      verification: 'LIVE_UNVERIFIED'
    };
    store.set(key, item); return item;
  }

  async function fetchSource(src) {
    const t0 = Date.now(); let raw = [];
    try {
      if (src.kind === 'rss') {
        const pages = Math.max(1, Math.min(Number(src.pages || 1), 40));
        for (let p = 1; p <= pages; p++) {
          const u = p === 1 ? src.url : src.url + (src.url.includes('?') ? '&' : '?') + 'paged=' + p;
          let batch; try { batch = parseFeed((await httpGet(u, { fetchImpl })).text); } catch (e) { if (p === 1) throw e; break; }
          if (!batch.length) break; raw.push(...batch);
        }
      } else {
        const { text, finalUrl } = await httpGet(src.url, { fetchImpl });
        raw = parseHtmlLinks(text, { ...src, url: finalUrl });
        const host = (() => { try { return new URL(finalUrl).hostname.replace(/^www\./, ''); } catch { return ''; } })();
        raw = raw.filter(r => { try { const h = new URL(r.url).hostname.replace(/^www\./, ''); return h === host || h.endsWith('.' + host) || host.endsWith('.' + h) || /\.(gov|nic)\.in$|\.gov\.in$/.test(h); } catch { return false; } });
      }
      status.set(src.id, { id: src.id, name: src.name, status: 'ONLINE', found: raw.length, latency_ms: Date.now() - t0, checked_at: new Date().toISOString(), error: null });
      return raw;
    } catch (e) {
      status.set(src.id, { id: src.id, name: src.name, status: e.name === 'AbortError' ? 'TIMEOUT' : (e.http ? 'HTTP_ERROR' : 'UNAVAILABLE'), found: 0, latency_ms: Date.now() - t0, checked_at: new Date().toISOString(), error: String(e.message || e).slice(0, 120) });
      return [];
    }
  }

  async function refresh() {
    if (running) return running;
    running = (async () => {
      const nowIso = new Date().toISOString(); const queue = [...sources]; let added = 0;
      const worker = async () => { for (let src = queue.shift(); src; src = queue.shift()) { const raw = await fetchSource(src); for (const r of raw) if (upsert(r, src, nowIso)) added++; } };
      await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
      prune(Date.now()); updatedAt = new Date().toISOString(); version++; firstRunDone = true; save();
      const res = { added, total: store.size, version, online: [...status.values()].filter(s => s.status === 'ONLINE').length, sources: sources.length };
      listeners.forEach(fn => { try { fn(res); } catch (_) {} });
      return res;
    })().finally(() => { running = null; });
    return running;
  }

  function start() {
    load();
    setTimeout(() => refresh().catch(() => {}), opts.firstDelayMs ?? 500).unref?.();
    timer = setInterval(() => refresh().catch(() => {}), Math.max(1, everyMin) * 60000); timer.unref?.();
    return stop;
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  const today = () => new Date().toISOString().slice(0, 10);
  function sourceFacet(arr) {
    const m = new Map();
    arr.forEach(i => i.sources.forEach(s => { const e = m.get(s.id) || { id: s.id, name: s.name, n: 0 }; e.n++; m.set(s.id, e); }));
    return [...m.values()].sort((a, b) => b.n - a.n);
  }
  function list(q = {}) {
    let items = [...store.values()];
    const kind = (q.kind || 'RECRUITMENT').toUpperCase();
    if (kind !== 'ALL') items = items.filter(i => i.kind === kind);
    const facetsBase = items;
    const term = String(q.q || '').toLowerCase().trim();
    if (term) { const words = term.split(/\s+/); items = items.filter(i => { const h = `${i.title} ${i.org} ${i.state || ''} ${i.level} ${i.quals.join(' ')} ${i.summary}`.toLowerCase(); return words.every(w => h.includes(w)); }); }
    if (q.source) items = items.filter(i => i.sources.some(s => s.id === q.source));
    if (q.state) items = items.filter(i => i.state === q.state);
    if (q.level) items = items.filter(i => i.level === q.level);
    if (q.qual) items = items.filter(i => i.quals.includes(q.qual));
    if (q.official === '1' || q.official === true) items = items.filter(i => i.official);
    if (q.hideClosed === '1' || q.hideClosed === true) items = items.filter(i => !i.last_date || i.last_date >= today());
    if (q.newHours) { const c = Date.now() - Number(q.newHours) * 36e5; items = items.filter(i => Date.parse(i.first_seen) >= c); }
    const sort = q.sort || 'latest';
    const ts = (i) => Date.parse(i.published_at || i.first_seen);
    items.sort(sort === 'closing' ? (a, b) => (a.last_date || '9999').localeCompare(b.last_date || '9999') : sort === 'vacancies' ? (a, b) => (b.vacancies || 0) - (a.vacancies || 0) : (a, b) => ts(b) - ts(a));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 30)); const total = items.length; const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pages, Math.max(1, Number(q.page) || 1));
    const tally = (arr, f) => { const m = new Map(); arr.forEach(i => { const v = f(i); (Array.isArray(v) ? v : [v]).forEach(x => x && m.set(x, (m.get(x) || 0) + 1)); }); return [...m].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n })); };
    const t = today(); const nowMs = Date.now();
    const view = items.slice((page - 1) * pageSize, page * pageSize).map(({ dup_key, ...i }) => ({ ...i, is_new: nowMs - Date.parse(i.first_seen) < 36e5 * 24, closed: !!(i.last_date && i.last_date < t) }));
    return { total, page, pages, pageSize, items: view, version, updated_at: updatedAt, refreshing: !!running,
      facets: { sources: sourceFacet(facetsBase), states: tally(facetsBase, i => i.state), levels: tally(facetsBase, i => i.level), quals: tally(facetsBase, i => i.quals) } };
  }
  function stats() {
    const all = [...store.values()]; const rec = all.filter(i => i.kind === 'RECRUITMENT'); const nowMs = Date.now();
    return { version, updated_at: updatedAt, refreshing: !!running, first_run_done: firstRunDone, total: all.length, recruitments: rec.length, official: rec.filter(i => i.official).length,
      new_24h: rec.filter(i => nowMs - Date.parse(i.first_seen) < 864e5).length, sources_total: sources.length, sources_online: [...status.values()].filter(s => s.status === 'ONLINE').length,
      sources: sources.map(s => status.get(s.id) || { id: s.id, name: s.name, status: 'PENDING', found: 0 }), refresh_minutes: everyMin };
  }
  return { start, stop, refresh, list, stats, onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, _store: store, _parse: { parseFeed, parseHtmlLinks, parseVacancies, parseLastDate } };
}
module.exports = { createLiveJobs, parseFeed, parseHtmlLinks, parseVacancies, parseLastDate };
