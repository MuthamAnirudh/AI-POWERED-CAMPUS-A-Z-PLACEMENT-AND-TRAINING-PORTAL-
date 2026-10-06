/* GovCareer AI v2.7 - Live Jobs feed (additive). Real postings collected server-side from official portals and
 * feeds; shown with source links and an explicit "unverified - confirm at source" label. Verified records and
 * eligibility remain in the existing "Verified records" tab. */
(function () {
  'use strict';
  const q = (s, r = document) => r.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '#');
  const fmtN = (n) => Number(n || 0).toLocaleString('en-IN');
  const state = { q: '', source: '', state: '', level: '', qual: '', sort: 'latest', official: false, hideClosed: true, fresh: false, page: 1, version: -1, timer: null, t: null };

  function ago(iso) {
    if (!iso) return 'never';
    const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    return s < 5 ? 'just now' : s < 90 ? s + 's ago' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago';
  }
  function fmtDate(d) { if (!d) return ''; const x = new Date(d + 'T00:00:00'); return isNaN(x) ? d : x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function daysLeft(d) { if (!d) return null; return Math.ceil((Date.parse(d + 'T23:59:59+05:30') - Date.now()) / 864e5); }

  function build() {
    const view = q('#view-opportunities'); const ws = q('.workspace', view);
    if (!view || !ws || q('#lj-tabs')) return;
    const tabs = document.createElement('div');
    tabs.id = 'lj-tabs'; tabs.className = 'lj-tabs'; tabs.setAttribute('role', 'tablist');
    tabs.innerHTML = '<button type="button" role="tab" id="lj-tab-live" aria-selected="true" class="lj-tab active">Live feed <b id="lj-tab-count">…</b></button><button type="button" role="tab" id="lj-tab-ver" aria-selected="false" class="lj-tab">Verified records &amp; eligibility</button>';
    const panel = document.createElement('section');
    panel.id = 'lj-panel'; panel.className = 'lj-panel'; panel.setAttribute('aria-label', 'Live government job feed');
    panel.innerHTML = `
      <div class="lj-status" id="lj-status" role="status" aria-live="polite">Collecting live postings…</div>
      <form class="lj-search" id="lj-form" role="search"><label for="lj-q" class="sr">Search live jobs</label><input id="lj-q" type="search" placeholder="Search 1000+ live posts: “railway”, “10th pass”, “Telangana police”…" autocomplete="off"><button type="submit" class="primary-btn">Search</button></form>
      <div class="lj-filters">
        <select id="lj-source" aria-label="Source"><option value="">All sources</option></select>
        <select id="lj-state" aria-label="State"><option value="">All states</option></select>
        <select id="lj-level" aria-label="Type"><option value="">All types</option></select>
        <select id="lj-qual" aria-label="Qualification"><option value="">Any qualification</option></select>
        <select id="lj-sort" aria-label="Sort"><option value="latest">Newest first</option><option value="closing">Closing soonest</option><option value="vacancies">Most vacancies</option></select>
      </div>
      <div class="lj-checks"><label class="check"><input type="checkbox" id="lj-official"> Official portals only</label><label class="check"><input type="checkbox" id="lj-hide" checked> Hide closed</label><label class="check"><input type="checkbox" id="lj-new"> New in last 24 h</label><button type="button" class="mini-btn" id="lj-refresh">Refresh now</button><button type="button" class="text-btn" id="lj-reset">Reset</button></div>
      <p id="lj-count" class="lj-count" aria-live="polite"></p>
      <ol id="lj-list" class="lj-list"></ol>
      <nav class="lj-pager" id="lj-pager" aria-label="Pages"></nav>
      <details class="lj-sources"><summary>Source health</summary><div id="lj-sources"></div></details>
      <p class="lj-note">These posts are discovered live from official portals and public job feeds. They are <strong>not verified</strong> by GovCareer: always open the source to confirm dates, vacancies and eligibility. Verified records with the eligibility engine are in the other tab.</p>`;
    view.insertBefore(tabs, ws); view.insertBefore(panel, ws);
    const show = (live) => { panel.hidden = !live; ws.hidden = live; q('#lj-tab-live').classList.toggle('active', live); q('#lj-tab-ver').classList.toggle('active', !live); q('#lj-tab-live').setAttribute('aria-selected', live); q('#lj-tab-ver').setAttribute('aria-selected', !live); };
    q('#lj-tab-live').onclick = () => show(true); q('#lj-tab-ver').onclick = () => show(false); show(true);

    q('#lj-form').addEventListener('submit', (e) => { e.preventDefault(); state.q = q('#lj-q').value.trim(); state.page = 1; load(); });
    for (const [id, key] of [['lj-source', 'source'], ['lj-state', 'state'], ['lj-level', 'level'], ['lj-qual', 'qual'], ['lj-sort', 'sort']]) q('#' + id).addEventListener('change', (e) => { state[key] = e.target.value; state.page = 1; load(); });
    q('#lj-official').onchange = (e) => { state.official = e.target.checked; state.page = 1; load(); };
    q('#lj-hide').onchange = (e) => { state.hideClosed = e.target.checked; state.page = 1; load(); };
    q('#lj-new').onchange = (e) => { state.fresh = e.target.checked; state.page = 1; load(); };
    q('#lj-reset').onclick = () => { Object.assign(state, { q: '', source: '', state: '', level: '', qual: '', sort: 'latest', official: false, hideClosed: true, fresh: false, page: 1 }); q('#lj-q').value = ''; ['source', 'state', 'level', 'qual'].forEach((k) => (q('#lj-' + k).value = '')); q('#lj-sort').value = 'latest'; q('#lj-official').checked = false; q('#lj-hide').checked = true; q('#lj-new').checked = false; load(); };
    q('#lj-refresh').onclick = async () => { const b = q('#lj-refresh'); b.disabled = true; b.textContent = 'Refreshing…'; try { await fetch('/api/live/jobs/refresh', { method: 'POST' }); } catch (_) {} setTimeout(() => { b.disabled = false; b.textContent = 'Refresh now'; poll(true); }, 4000); };
    q('#lj-pager').addEventListener('click', (e) => { const b = e.target.closest('button[data-p]'); if (!b) return; state.page = Number(b.dataset.p); load(); q('#lj-panel').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  }

  function fillSelect(id, items, label, valueKey = 'name') {
    const el = q('#' + id); if (!el) return; const cur = el.value;
    el.innerHTML = `<option value="">${esc(label)}</option>` + items.slice(0, 80).map((f) => `<option value="${esc(f[valueKey])}">${esc(f.name)} (${fmtN(f.n)})</option>`).join('');
    el.value = cur;
  }

  function card(i) {
    const left = daysLeft(i.last_date);
    const urgency = i.closed ? '<span class="lj-chip lj-closed">Closed</span>' : left !== null && left <= 7 ? `<span class="lj-chip lj-urgent">Closes in ${Math.max(0, left)} day${left === 1 ? '' : 's'}</span>` : '';
    const srcs = i.sources.slice(0, 3).map((s) => `<a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a>`).join(' · ');
    return `<li class="lj-card${i.official ? ' is-official' : ''}">
      <div class="lj-card-top"><a class="lj-title" href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a>${i.is_new ? '<span class="lj-chip lj-new">NEW</span>' : ''}</div>
      <div class="lj-meta">${esc(i.org)}${i.state ? ' · ' + esc(i.state) : ''} · ${esc(i.level)}${i.official ? ' · <b class="lj-off">Official portal</b>' : ''}</div>
      <div class="lj-chips">${i.vacancies ? `<span class="lj-chip">${fmtN(i.vacancies)} posts</span>` : ''}${i.last_date ? `<span class="lj-chip">Last date ${esc(fmtDate(i.last_date))}</span>` : ''}${urgency}${i.quals.slice(0, 3).map((x) => `<span class="lj-chip lj-q">${esc(x)}</span>`).join('')}<span class="lj-chip lj-unv" title="Not verified by GovCareer">Unverified · confirm at source</span></div>
      ${i.summary ? `<p class="lj-sum">${esc(i.summary.slice(0, 220))}${i.summary.length > 220 ? '…' : ''}</p>` : ''}
      <div class="lj-foot"><span>Seen ${esc(ago(i.first_seen))}</span><span>Source: ${srcs}</span><a class="lj-open" href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener noreferrer">Open official notice ↗</a></div></li>`;
  }

  async function load() {
    const p = new URLSearchParams({ page: state.page, pageSize: 30, sort: state.sort });
    if (state.q) p.set('q', state.q); if (state.source) p.set('source', state.source); if (state.state) p.set('state', state.state);
    if (state.level) p.set('level', state.level); if (state.qual) p.set('qual', state.qual); if (state.official) p.set('official', '1');
    if (state.hideClosed) p.set('hideClosed', '1'); if (state.fresh) p.set('newHours', '24');
    try {
      const r = await fetch('/api/live/jobs?' + p); if (!r.ok) throw new Error('HTTP ' + r.status); const d = await r.json();
      state.version = d.version;
      fillSelect('lj-source', d.facets.sources, 'All sources', 'id'); fillSelect('lj-state', d.facets.states, 'All states'); fillSelect('lj-level', d.facets.levels, 'All types'); fillSelect('lj-qual', d.facets.quals, 'Any qualification');
      const list = q('#lj-list');
      list.innerHTML = d.items.length ? d.items.map(card).join('') : '<li class="lj-empty">No live posts match yet. If this is the first start, the first collection takes about 30 seconds; otherwise clear a filter.</li>';
      q('#lj-count').textContent = `${fmtN(d.total)} live post${d.total === 1 ? '' : 's'}${d.refreshing ? ' · refreshing…' : ''}`;
      const pg = q('#lj-pager');
      pg.innerHTML = d.pages > 1 ? `<button type="button" data-p="${Math.max(1, d.page - 1)}" ${d.page <= 1 ? 'disabled' : ''}>← Previous</button><span>Page ${d.page} of ${d.pages}</span><button type="button" data-p="${Math.min(d.pages, d.page + 1)}" ${d.page >= d.pages ? 'disabled' : ''}>Next →</button>` : '';
    } catch (e) { q('#lj-list').innerHTML = '<li class="lj-empty">Live feed is temporarily unavailable. Retrying automatically…</li>'; }
  }

  async function poll(force) {
    try {
      const r = await fetch('/api/live/jobs/stats'); if (!r.ok) return; const s = await r.json();
      const st = q('#lj-status');
      if (st) {
        const down = s.first_run_done && s.sources_online === 0;
        st.className = 'lj-status' + (down ? ' lj-bad' : '');
        st.innerHTML = down
          ? `<b>No official portal reachable from this server.</b> Check the internet connection or firewall, then press Refresh. (${s.sources_total} sources configured)`
          : `<span class="live-dot" aria-hidden="true"></span><b>LIVE</b> ${fmtN(s.recruitments)} recruitment posts · ${fmtN(s.new_24h)} new in 24 h · ${s.sources_online}/${s.sources_total} sources online · updated ${esc(ago(s.updated_at))}${s.refreshing ? ' · refreshing…' : ''}`;
      }
      const tc = q('#lj-tab-count'); if (tc) tc.textContent = fmtN(s.recruitments);
      const mc = q('#metric-live'); if (mc) mc.textContent = fmtN(s.recruitments);
      const sh = q('#lj-sources'); if (sh) sh.innerHTML = s.sources.map((x) => `<span class="lj-src ${x.status === 'ONLINE' ? 'ok' : x.status === 'PENDING' ? 'wait' : 'bad'}" title="${esc(x.error || '')}">${esc(x.name)} · ${esc(x.status)}${x.status === 'ONLINE' ? ' · ' + x.found : ''}</span>`).join('');
      if (force || s.version !== state.version) load();
    } catch (_) {}
  }

  function metric() {
    const m = q('#metrics'); if (!m || q('#metric-live')) return;
    const a = document.createElement('article');
    a.innerHTML = '<span class="metric-icon">●</span><div><strong id="metric-live">…</strong><span>live job posts (real time)</span></div>';
    a.style.cursor = 'pointer'; a.onclick = () => { const b = q('.nav-btn[data-view="opportunities"]'); if (b) b.click(); };
    m.appendChild(a);
  }

  // Mobile: a fixed bar inside the sticky header is clipped by it, so the nav lives on <body> under 1050px.
  function mobileNav() {
    const nav = q('.top-nav'), header = q('.shell-header'), actions = q('.header-actions'); if (!nav || !header) return;
    const mq = window.matchMedia('(max-width:1050px)');
    const place = () => { if (mq.matches) { if (nav.parentNode !== document.body) document.body.appendChild(nav); } else if (nav.parentNode !== header) header.insertBefore(nav, actions || null); };
    (mq.addEventListener ? mq.addEventListener('change', place) : mq.addListener(place)); place();
  }
  function init() { mobileNav(); build(); metric(); load(); poll(true); state.timer = setInterval(() => poll(false), 20000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
