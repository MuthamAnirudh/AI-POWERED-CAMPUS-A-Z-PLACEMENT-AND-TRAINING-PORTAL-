# v2.9.2 - Render deploy fixes (migration timeout + GovCareer AI tab)

**1. `Error: P1002 ... Timed out trying to acquire a postgres advisory lock` (sign-up broken after deploy).**
`campus/backend/scripts/migrate-deploy.js` now wakes the (Neon) database first, converts a `-pooler` host to the direct host,
retries `prisma migrate deploy` with back-off on transient errors, releases a stale lock left by a killed deploy, and the
Campus server keeps retrying in the background (every 45 s) instead of staying broken until the next restart.

**2. "Connect GovCareer AI" box instead of the embedded GovCareer AI.**
The log line `AI backend proxy listening on 0.0.0.0:10000` shows Render ran the Campus Portal *alone*. GovCareer AI is only
embedded when the unified server runs (`npm start` at the repo root). `campus/backend/server.js` now hands over to the unified
launcher automatically when the whole tree is present, and `render.yaml` documents the correct Root Directory / Start Command.

No feature was removed or changed.

---

# v2.9.1 - audit fixes

- Campus CSP (meta tag in campus/frontend/index.html and header in campus/backend/server.js) now includes `frame-src 'self' https:`. Without it, a separately hosted GovCareer AI URL pasted into the Campus "GovCareer AI" sub-tab was blocked by `default-src 'self'` and the tab stayed blank. Same-origin (`npm start`) behaviour is unchanged.
- package-lock.json version fields synced to the package version.
- Audit: all JS files pass `node --check`; every frontend `/api/*` call, DOM id and `require()` resolves; no features removed.

# v2.9.0 - GovCareer AI is now a sub-tab of the Campus "1000+ Roadmaps & Govt Jobs" tab (additive)

**What you asked for.** GovCareer AI should live inside the Campus A-to-Z placement and training portal, in the same tab as the government jobs and roadmaps, as one more sub-tab.

**What is new**
- Campus -> **1000+ Roadmaps & Govt Jobs** now has three sub-tabs: *1000+ Roadmaps*, *1000+ Govt Jobs* and **GovCareer AI**. The sector chooser and the *Opportunity workspace* bar also offer GovCareer AI. The choice is remembered like the other two.
- The GovCareer AI sub-tab shows the full GovCareer app (Live feed of 1000+ posts, verified records and eligibility, Exam Lab, Career Paths, Bridge, Strategy, My Tools, Ask the AI) inside the Campus page. It has *Reload* and *Open in new tab*, a loading state, and a notice with retry if the app does not load within 15 s.
- One login: the frame is same-origin, so the Campus session is shared; no second sign-in.
- **Embed mode** (`?embed=1`, or any framed load): GovCareer hides its link back to Campus (you are already in it). Nothing else changes, and opening GovCareer directly looks exactly as before.
- **Security header change (needed for framing):** GovCareer now sends `X-Frame-Options: SAMEORIGIN` and CSP `frame-ancestors 'self'` instead of `DENY` / `'none'`. Other websites still cannot frame it. If Campus is hosted on a different origin, set `FRAME_ANCESTORS` (see `.env.example`) and, in the Campus tab, paste the GovCareer address once (or set `window.GOVCAREER_URL`).
- New: `public/embed.js|css`, `test-embed.js` (13 checks, in `npm test`). SW cache v17.

**Unchanged.** Every Campus tab, the Roadmaps and Govt Jobs sub-tabs, GovCareer features, routes, migrations and earlier tests. No file was removed. `campus/mainapp.js` is the unused legacy copy and was not edited; the page loads `campus/frontend/app-runtime.js`.

---

# v2.8.1 - Error check and fixes (additive, nothing removed)

**Checked.** Syntax of every JS/Python file, JSON validity, HTML asset references, lockfiles, all root and Campus test suites (including the two PostgreSQL-backed ones), the FastAPI AI/ML service (73 pytest tests, every route probed for 5xx), and a boot of both runtimes.

**Fixed**
- **Campus Portal crashed on boot in production** (`NODE_ENV=production`, i.e. Docker and Render): the unified server handed the Campus child `CORS_ORIGIN=http://localhost:PORT`, which the production validator rejects (HTTPS only), so `/campus/` answered 503. Now the child gets `CORS_ORIGIN`, else `RENDER_EXTERNAL_URL`, else `PUBLIC_URL`; the validator also accepts `RENDER_EXTERNAL_URL` (as `campus/backend/server.js` already did) and plain-HTTP loopback (`localhost`, `127.0.0.1`, `[::1]`). Public HTTP origins and `*` are still rejected.
- **Single sign-on ignored `CAMPUS_HOST`**: `lib/sso.js` always called `127.0.0.1`, so a separately deployed Campus could never sign users in, and the entry gate was switched off whenever `DISABLE_CAMPUS_PORTAL=1`. It now uses `CAMPUS_HOST` like the Bridge client does. `test-account.js` (SSO redirect check) failed because of this and now passes 20/20.
- **Docker image had no OCR tools and no AI/ML service**: added poppler, Tesseract (English/Hindi/Telugu), ffmpeg, Python and a prebuilt AI/ML virtualenv to the `Dockerfile`, plus `.dockerignore`. This also fixes `test-phase2.js` (regional-language OCR check, 45/45 once the packs exist).
- **`docker-compose.unified.yml`** now passes the secrets Campus requires in production (read from `.env`; generate with `npm run secrets`). **`render.yaml`** builds the AI/ML virtualenv at build time and sets the AI timeouts.
- `.env.example`: removed duplicated keys, added `OPERATIONS_TOKEN` and `CORS_ORIGIN`.
- New: `test-deploy.js` (7 checks, in `npm test`), `scripts/gen-secrets.js`, `.dockerignore`.

**Unchanged.** Every feature, route, screen, migration and earlier test. No file was removed.

---

# v2.8.0 - Bridge: demonstrated skills and "Practice next" (additive)

**Why.** GovCareer supplies verified recruitment facts, deterministic eligibility and grounded answers; Bridge connects them to what a student has *demonstrated*. Until now a match score mixed tested evidence with resume and self-declared claims, and the next-step advice was split across *Skill gaps* and the daily plan.

**What is new**
- **Demonstrated score** on every match: the part of the skill fit backed by tested evidence only, with the unproven points called out. Under *Why this?* a claimed-vs-tested table shows each required skill.
- **Evidence freshness** (fresh <=30 days, ageing <=90, stale beyond, claim-only, none). Display only: it never changes a score.
- **Practice next** tab: one ordered list of *Close a gap*, *Prove a claim* and *Refresh a test* items, each with why, the posts it helps, and links to Campus practice / Exam Lab / mock test, plus a *Today* plan packed into the daily minutes.
- **Progress trend** from saved snapshots (improving / holding / slipping). Fixed: the progress chart plotted newest to oldest.
- API: `insight` and `matches[].demonstrated` on analyze, `job.demonstration` on explain, `trend` on history. Works in the zero-dependency runtime too.
- New: `lib/bridge/insight.js`, `test-bridge-v28.js` (10 checks, in `npm test`). SW cache v16. `matcher.actionsFor` is now exported.

**Unchanged.** Eligibility engine, scoring weights, ranking, Campus link/HMAC, Live Jobs, Jobs+, Strategy suite, Exam Lab, alerts, accounts and every earlier test. No file was removed.

---

# v2.7.0 - Live Jobs (real-time) + GovCareer always opens (additive)

**Problem fixed.** GovCareer only ever showed the 11 built-in demonstration records, and with `npm start` the page could fail to appear (forced redirect to the Campus login, or a crash when dependencies/PostgreSQL were missing). On phones the navigation was hidden below 1050px.

**What is new**
- **Live feed** (Opportunities -> *Live feed* tab, default): real postings collected on the server every 15 min from ~38 official portals (UPSC, SSC, IBPS, SBI, RBI, Railways, India Post, DRDO, ISRO, PSUs, 15 state PSCs/boards) plus an RSS aggregator feed that is walked page by page. The store accumulates (up to 5000 posts, 180 days) and survives restarts (`storage/live-jobs.json`), so it grows past 1000.
- Search, filters (source, state, type, qualification), sort (newest / closing soon / most vacancies), pagination, official-only, hide closed, new-in-24h, per-source health panel, *Refresh now*. New live counter on Overview. SSE event `livejobs.changed`.
- **Integrity kept**: live posts are labelled *Unverified - confirm at source*; vacancies / last date are shown only when the source text states them; eligibility is not guessed. Verified records + eligibility engine stay in the *Verified records & eligibility* tab, untouched.
- **API**: `GET /api/live/jobs` (q, source, state, level, qual, kind, sort, page, pageSize, official, hideClosed, newHours), `GET /api/live/jobs/stats`, `POST /api/live/jobs/refresh`.
- **`npm start` now always works**: `start.js` runs the full runtime and falls back to `standalone.js` if dependencies are missing or the full runtime crashes on boot. Full runtime: `npm run start:full`.
- GovCareer is publicly viewable by default (`REQUIRE_LOGIN=1` restores the forced Campus login first).
- Mobile bottom navigation bar (the top nav was hidden on phones). SW cache v15.
- Sources are data, not code: edit `data/liveJobSources.json` or set `LIVE_JOB_FEEDS`.
- New: `lib/liveJobs.js`, `lib/liveJobsApi.js`, `public/livejobs.js|css`, `start.js`, `test-livejobs.js` (32 checks, in `npm test`). No existing file was removed; all earlier suites still pass.

**Honest limits.** Portal page layouts change, so a source can return few or no links; its status shows in *Source health* and it never breaks the page. Aggregator feeds are third-party, so treat them as leads and confirm at the official notice.

---

# v2.6.2 - Merge with P1 AI/ML Live Fix + voice/input fixes

**Merge result.** `p1_FINAL_AI_ML_LIVE_FIX` was compared file-by-file against `campus/` inside Unified v2.6.1. Nothing existed only in the P1 zip: every P1 file is already present in `campus/`, and wherever both differ the Unified copy is the newer, better one (live-AI timing 30s/2 retries/38s, response cache off, two-language AI Video Tutor, SSO return, Bridge source routes, monorepo-safe `migrate-deploy.js`, port 3101). So the merged project = Unified v2.6.1 + the fixes below, with no duplicate tree and no feature removed.

**Fix 1 - text pasted back after Send** (`campus/frontend/app-runtime.js`, `public/app.js`)
- Root cause: push-to-talk dictation kept a stale snapshot of the answer box; the next speech result re-wrote the box with the old text after it was sent/cleared. It now detects that the field changed (Send, Clear, manual edit) and rebases on the live value. Fixes Mock Interview, follow-up answers, MirrorMentor-X and all `useMisDictation` boxes.
- Ask AI chat (campus) and Ask the AI (GovCareer): double-submit guard, input remount + re-clear so mobile keyboard composition cannot restore the sent text, autocorrect/spellcheck off. AI Video Tutor follow-up box gets the same re-clear.

**Fix 2 - teacher voice not continuous** (`campus/frontend/app-runtime.js`)
- Browser voice speaks sentence-sized chunks (engines cut one long utterance after ~15 s), with a per-chunk watchdog for engines that never fire `onend`; one failing chunk no longer ends the lesson.
- Neural voice reuses one persistent `<audio>` unlocked on the first tap (iOS/Safari/Android blocked later auto-plays), retries on rate-limit, and pre-fetches the next two segments so there is no gap.
- Segment advance uses a play token (stale callbacks ignored), no state-updater side effects, pause/resume/seek/restart rewritten on the same engine. Non-English lessons choose a matching browser voice (te-IN, hi-IN, ta-IN, kn-IN, ml-IN, bn-IN, mr-IN). The Listen buttons use the same chunking.

**Tests.** New `campus/backend/tests/voiceAndInputRegression.test.js` (added to `npm test`). SW cache v14.

---

# v2.6 - Jobs+ (additive)

- **Search and filters**: department, organisation, keyword, last-date-on-or-before, minimum vacancies, fee-free, has-official-updates; sort by best fit, closing soonest, most vacancies, exam date, recently verified; saved presets; compare up to 3 posts.
- **Alerts**: bell on every result; watched posts show due items (closing within 7 days, exam within 14 days with an admit-card check reminder, result check once the exam date passes). Opt-in browser notifications. Admit card and result dates are not in verified records, so they are never invented.
- **Job detail**: met / partial / not-met summary, what blocks you, date timeline, seats by category (your category highlighted), document checklist, add-to-calendar .ics, share summary.
- **Mobile**: bottom-sheet drawer, 44px touch targets, scrolling chips, safe-area spacing.
- New files `public/jobsplus.js`, `public/jobsplus.css`; `lib/search.js` only gains extra fields on each result. SW cache is now v13. Existing tests: UI 10/10, advanced 17/17, realtime 5/5, phase 1 pass.

---

# v2.5 - Advanced Strategy Suite (additive)

- **New Strategy tab**: brief, decision matrix with user-set weights and rank stability, deadline and conflict radar, age runway, spaced-revision study planner, mock-test analytics, what-if scenarios, target portfolio with syllabus overlap, local photo/signature checker, `.ics` export, print and opt-in browser reminders. See `ADVANCED.md`.
- New stateless API under `/api/advanced/*` in both `server.js` and `standalone.js`; nothing is stored server-side.
- **Bug fix**: ex-servicemen age relaxation was never applied from the main UI (`exServiceman` vs `exServicemen`); the eligibility engine now accepts both.
- Service-worker cache bumped to `govcareer-shell-v12`; command palette gains "Strategy".
- Tests: `test-advanced.js` 17/17, `test-advanced-ui.js` 9/9; Bridge 58/58, UI contract 10/10, Phase 4/5/6 and realtime unchanged. Phase 3 is still 105/107 with the same two date-dependent failures as the v2.4 upload. Phase 2 and Account tests need PostgreSQL and were not run here.
- Not changed: every earlier route, screen, migration and test.

---

# v2.4 - One login + real time

## One login for the whole app
- **The Campus sign-in is the only login screen.** Opening GovCareer without a Campus session redirects to `/campus/?next=/`; after the Campus login (password, Face ID or fingerprint) you are sent straight back.
- GovCareer no longer has its own sign-in / create-account form. Its "Sign in" button goes to the Campus login; the header shows your Campus name.
- `POST /api/account/sso` exchanges the verified Campus session (asked of the Campus service via `GET /api/auth/me`) for a GovCareer session. No password is shared or duplicated. The first visit shows one privacy-consent step (nothing is created without it); after that sign-in is automatic.
- Sign out ends both sessions. `GET /api/session` reports the current state.
- The old `/api/account/register` and `/api/account/login` password endpoints now return 410 unless `LEGACY_ACCOUNT_LOGIN=1` (kept only so the earlier API tests still run).
- Entry gate fails open if the Campus service is unreachable, and is off with `REQUIRE_LOGIN=0`, `DISABLE_CAMPUS_PORTAL=1` or in `standalone.js`.
- Not changed: the staff console at `/admin.html` keeps its separate reviewer login (different people, different roles).

## Real time
- One Server-Sent-Events stream, `GET /api/stream` (also in `standalone.js`), with automatic reconnect and resume from `Last-Event-ID`.
- `pulse` (live counts every 15 s), `jobs.changed` (published set or a deadline status changed, or an admin publishes), `sources` / `source.changed` (official portals checked once on the server every 2 min, not once per visitor), and private `alert` events for the signed-in person (read from `alert_events`, so the separate worker process works too).
- UI: Live pill with "seconds ago", ticking deadline countdown for closing-soon posts, counts and portal monitor updated without polling, results refresh automatically when data changes.
- Everything shown is computed from published records or live portal checks; nothing is simulated.

## Tests
`npm test` now includes `test-realtime.js` (5 checks) and a rewritten `test-account.js` (20 checks, incl. SSO, gate and stream). Phase 2 (44/45) and Phase 3 (105/107) have the same 3 failures as the uploaded v2.3 (date-dependent checks and missing OCR language packs).

---

# Bridge release (additive)

- **New Bridge tab**: Campus aptitude / digital-twin / interview evidence + resume + self-assessment + Exam Lab progress matched to verified recruitments, with explainable fit ranges, readiness hours, skill-gap ranking, daily study plan, what-if simulation and saved progress snapshots.
- **Two-sided, consented, revocable link** between GovCareer and Campus accounts, protected by an HMAC service signature so the student's browser token alone can never create a link or export data.
- Works without PostgreSQL (resume + self-assessment) via the resilient and standalone runtimes.
- Migration `008_bridge.sql`; `/api/account/export` v1.2 includes Bridge data; consent withdrawal and account deletion revoke the link.
- No existing feature, route or test was changed in behaviour. See `BRIDGE.md`.

---

# GovCareer AI — Real-Time Hackathon/IIT M.Tech Hardening Release

## Critical fixes
- Profile selectors now populate immediately from a built-in validated catalog.
- Highest qualification includes 8th, 10th, 12th, ITI, Diploma, Bachelor's, Master's and PhD.
- State, domicile, stream and category selectors are populated even when the metadata API is unavailable.
- Metadata is refreshed from the server when available.
- API calls have bounded client-side timeouts.
- Overview requests use partial-failure handling instead of blanking the application when one service fails.
- Career paths use the resilient runtime when PostgreSQL is unavailable.
- Exam mock-test catalog and tutor behavior are available in resilient mode.
- PostgreSQL migration files restored to the release archive.

## Runtime modes
1. `node standalone.js` — zero-dependency public/hackathon runtime.
2. `npm ci && npm start` — PostgreSQL-backed production runtime.
3. Docker Compose — PostgreSQL + production runtime.

## Verified in this build
- UI contract tests: 10/10
- Phase 5 behavior tests: 46/46
- Phase 6 contract tests: 10/10
- JavaScript syntax checks: PASS
- Standalone `/api/meta`: PASS
- Standalone natural-language search: PASS
- Standalone eligibility evaluation: PASS
- Standalone grounded assistant + audit id: PASS
- Standalone knowledge graph: PASS
- Standalone verified exam syllabus: PASS
- Standalone mock-test catalog: PASS

# v2.2 — Account UI

The account API existed since Phase 4 but the web UI never sent a login token, so My Tools could not work
against the PostgreSQL runtime. This release adds an additive front-end module (`public/account.js`,
`public/account.css`); no existing file's behaviour was removed.

## New
- Sign in / create account (explicit privacy consent, 10+ character password), sign out
- Bearer token attached to `/api/account/*` calls, so the existing tracker now loads for signed-in users
- Watch / unwatch from the opportunity drawer; "Track" also records into the account tracker
- Application tracker with all nine statuses, application number and notes
- Saved searches with an alerts on/off switch; alerts inbox
- Preferences, data export (JSON download), consent withdrawal, account deletion
- Honest demo mode: the zero-dependency runtime has no real accounts and the UI says so
- Service-worker cache bumped to `govcareer-shell-v9`

## Bugs found and fixed by the new tests
- Account deletion originally sent no token (the path match required a trailing slash).
- Demo runtime returns 405 (not 404) for unknown POSTs; both are now treated as "accounts unavailable".

## Verified
- `npm test`: Phase 1 pass, Phase 3 107/107, Phase 2 45/45, Phase 4 10/10 + 27/27, Phase 5 9/9 + 46/46,
  Phase 6 10/10, **Account 17/17** (API round-trip, cross-user isolation, real-DOM behaviour in jsdom, demo mode)
- `npm run check`: syntax + UI contract pass

## Known limitations
- Alerts are only *delivered* when the worker and a notification channel are configured (see `.env.example`);
  the inbox shows whatever the alert planner has already produced. No email/push provider is configured by default.
- The Campus portal (`/campus/`) keeps its own login; GovCareer accounts and Campus accounts are not yet linked.
- Browser behaviour was verified in jsdom, not in a real browser; please click through once on your machine.

## v2.6.3 - Render login "internal error" fix
- Root cause: `campus/backend/scripts/migrate-deploy.js` hard-coded `<repo-root>/node_modules/prisma/build/index.js`.
  On Render `NODE_ENV=production` skips devDependencies, so Prisma was never installed -> `MODULE_NOT_FOUND`,
  migrations were skipped, tables (User, ...) never existed and every sign-up/login returned an internal error.
- Fix: the script now locates the Prisma CLI dynamically (backend, repo root, or `npx` fallback);
  `prisma` moved from devDependencies to dependencies in root and backend `package.json` + lockfiles.
- No features removed; all other files unchanged.
- DB alignment: `campus/backend/prisma` (schema + all 9 migrations) re-synced from the P1 package (identical);
  `.env.example` now uses the P1 PostgreSQL URL format with `DIRECT_URL`; added root `render.yaml`.
