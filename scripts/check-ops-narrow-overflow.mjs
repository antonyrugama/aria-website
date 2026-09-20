/* Guards every pane of the operations dashboard against scrolling the page
   sideways on a phone.

   The defect this was written for was in the Problems pane. That pane lists
   one row per rule, and a row says why a rule that cannot reach a verdict
   cannot reach one. That sentence is set in a pill, which never wraps, so the
   whole of it became the minimum width of a column declared `1fr`, and a `1fr`
   column will not go under its content's minimum. On a 375px viewport that
   pushed the threshold and the on/off switch past the right edge of the
   document, and the whole page scrolled sideways rather than the row wrapping
   in place.

   Nothing in this repository could have caught that. There is no build step
   and no test runner, and a stylesheet compiles to nothing that can be
   asserted about: the defect only exists once a browser has laid the page out
   at a particular width against particular data. So this check does what the
   bug needed doing to it — it serves the real pages, answers the operations
   API with a stub, lays them out in headless Chrome at phone widths, and reads
   `documentElement.scrollWidth` back.

   What changed with Stadiora/Aria#10492 is only which pages it lays out. It
   watched one pane out of ten, and the mechanism is not specific to that pane:
   any pane can put an unbreakable minimum in a `1fr` column. The list of panes
   is read out of assets/pane-registry.js, which is the table both shells
   already boot from, so a pane cannot join the app without joining this sweep
   — and the count that was swept is asserted against the count the registry
   declares, so the sweep cannot quietly shrink back to one page, or to none.

   Trust the CI run over a local one. Font metrics differ per platform, so a
   sentence that fits on one machine can overflow on another: the first CI run
   of this check failed at 375px on a second badge that the same commit had
   passed locally on Windows. Linux is what the check is measured on.

   Two widths, 375px and 360px. 375px is the acceptance criterion; 360px exists
   because of the platform split above. The first CI run of the v2 Problems
   pane failed at 375px on Linux on a filter note that fitted 375px on macOS
   with nothing to spare, so a local run could not see it and a reviewer on a
   Mac had to find it by hand. 360px reproduces on any platform what CI's wider
   font metrics produce at 375px.

   The stub is deliberately hostile rather than tidy. It sends a rule that
   cannot judge and whose reason is the longest sentence the vocabulary in
   assets/alerts-model.js can produce, because a fixture of short strings would
   fit in any layout and the check would pass over the defect it is named for.
   Its clock is the real one rather than a frozen instant, because every age on
   these panes is computed against `Date.now()`: a fixture pinned to a date in
   the past reads "50 days ago" this week and "415 days ago" next year, so its
   strings grow without anybody changing anything.

   An empty page cannot overflow, so every measurement is preceded by evidence
   that the page under it is the pane it claims to be and drew something: the
   shell reached its ready gate, the heading and the question in the top bar
   are the ones the registry declares for that pane, `#content` holds more than
   a handful of elements, none of the shell refusals — a pane the role may not
   open, a pane with no module — is what is on screen, and `#content` holds a
   string that only that pane's loaded state draws. A pane that fails any of
   those is reported as a failure rather than measured, and is missing from the
   swept count, which is itself asserted.

   That last gate is the one the other five cannot stand in for. Overview, App
   releases and Settings each answer an empty read with a failure card of their
   own, and a failure card passes all five: it is the right file, it sets the
   right `data-pane`, the shell reaches ready, the top bar is written from the
   registry rather than from the read, and two of the three clear the floor of
   eight elements by 23 and 30. Without a per-pane marker the sweep shrank from
   ten laid-out panes to seven and went on printing that it had swept ten.

   Two shells, so two spellings of everything the sweep reads off the page.
   assets/shell-pane-v2.js boots from `data-pane` and writes the question into
   `.page-sub`; the v1 assets/shell.js boots from `data-page` and writes it
   into `.page-question`. Cloud costs is the one pane still on the v1 shell.
   Reading only the v2 spelling drops it out of the sweep silently, which is
   how both of these were found.

   WHAT THIS DOES NOT COVER, in the words of what was actually measured:

   - **People and usage, and Cloud costs, are measured with no figures in
     them.** The stub answers /api/ops/usage and /api/ops/costs with an empty
     envelope, so those two panes draw their no-data cards and that is what is
     laid out. Their shell chrome, filter bar and empty state are swept; their
     populated state is not. Both panes are mid-remodel onto the v2 design
     system, and a fixture written against the modules being replaced would
     measure markup that is about to be deleted.
   - **Look up a user is measured before any lookup**, and **Aria quality
     before any operation is submitted**. Both panes start as forms with no
     result, which is their real loaded state; neither result view is laid out
     here.
   - **An overflow a container clips.** The verdict is the width of the
     document, so an element that overruns inside an ancestor that clips it
     never reaches the document and is invisible here on every pane. Measured:
     deleting the four per-pane copies of `.hero > .hero-chips { grid-column:
     1 / -1 }` collapses the hero's title column to 0px on three panes and to
     41px on App releases, and `.hero` itself then reports scrollWidth 398
     against clientWidth 343 — while `documentElement.scrollWidth` stays 375
     and this check stays green, byte-identically, in both states. That defect
     class needs an element-level check and is filed as Stadiora/Aria#10397
     rather than folded in.
   - **Sub-pixel overflow.** The verdict is `documentElement.scrollWidth`
     against `documentElement.clientWidth`, and both are integers, so overflow
     below about half a pixel is not visible to it. The per-element report
     underneath reads fractional `getBoundingClientRect()` widths, but it lists
     only elements more than half a pixel past the edge and it decides nothing,
     so it does not close that gap either. Nothing here catches a margin that
     small.
   - **320px.** Only 375px and 360px are laid out. A further overflow exists at
     320px — the Severity segmented control is wider than the bar — and it is
     filed rather than folded in, so an overflow that appears only below 360px
     is invisible to this check on every pane, not just that one.

   Usage:  node scripts/check-ops-narrow-overflow.mjs
   Chrome: CHROME_PATH, or the usual install locations on Linux and Windows.
*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'ops/assets/pane-registry.js';
const WIDTHS = [375, 360];
const HEIGHT = 812;
const THEMES = ['dark', 'light'];

/* How long the pane is given to finish its reads and lay itself out. Every
   pane here is a single read or two against a stub on loopback. */
const SETTLE_MS = 2500;

/* A floor, and only a floor: it says the pane put something on the page
   rather than nothing. It is not a claim that the pane drew its data — see
   WHAT THIS DOES NOT COVER above for the two panes where it did not. The
   thinnest pane in this sweep today is Cloud costs, whose no-data card is ten
   elements. */
const MIN_CONTENT_ELEMENTS = 8;

/* The things a shell puts on screen INSTEAD of a pane. Each is a single card
   of a few short lines, each fits any viewport, and measuring one proves
   nothing about the pane it stands in for, so any of them is a failure here
   rather than a pass. The strings are the shells' own — the first is in both
   assets/shell-pane-v2.js and assets/shell.js, the second is the v2 shell's
   refusal and the third the v1 shell's — and they are pinned deliberately: if
   a shell stops saying them this check should stop and say so rather than
   quietly start measuring a refusal card. */
const REFUSALS = ['Not built yet', 'You do not have access to this pane', 'Owner access only'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

/* ------------------------------------------------------------- the panes */

/* The pane list, out of the registry rather than out of a second copy of it
   here. assets/pane-registry.js is a browser file: it hands its table to a
   `window` it is passed, so running it in a context holding nothing else is
   the whole of reading it. Anything more — a regex over the source, a literal
   array kept in step by hand — is a second source of truth, which is the thing
   the registry exists to stop. */
function readRegistry() {
  const src = fs.readFileSync(path.join(ROOT, REGISTRY), 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: REGISTRY });
  const registry = sandbox.window.OpsPaneRegistry;
  if (!registry || !registry.PANES) {
    throw new Error(`${REGISTRY} defined no window.OpsPaneRegistry.PANES`);
  }
  return registry.PANES;
}

const DECLARED = readRegistry();
const PAGES = Object.keys(DECLARED).map((key) => ({
  key,
  file: DECLARED[key].file,
  url: '/ops/' + DECLARED[key].file,
  label: DECLARED[key].label,
  question: DECLARED[key].question
}));

/* Both of these stop the run before a browser is started, because either one
   means the sweep about to happen would not be the sweep this file claims. */
if (PAGES.length === 0) {
  console.error(`\n${REGISTRY} declares no panes, so there is nothing to sweep.\n`);
  process.exit(1);
}
for (const page of PAGES) {
  if (!page.file || !fs.existsSync(path.join(ROOT, 'ops', page.file))) {
    console.error(`\n${REGISTRY} declares pane "${page.key}" as ops/${page.file}, ` +
      `which is not a file in this repository.\n`);
    process.exit(1);
  }
}

/* ------------------------------------------------------------------ stub */

/* The real clock. Every age on these panes — "open for 50 days", "read 2
   minutes ago", "last ran 3 hours ago" — is computed against Date.now() by
   the pane itself, so a fixture pinned to a fixed instant writes a different
   sentence every day it is run and a longer one every year. */
const NOW = Date.now();
const ago = (ms) => new Date(NOW - ms).toISOString();
const ahead = (ms) => new Date(NOW + ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const utcDay = (ms) => new Date(NOW - ms).toISOString().slice(0, 10);

const ADMIN = { id: 'adm_1', email: 'owner@example.invalid', name: 'Owner', role: 'owner' };
const SESSION = { id: 'ses_1', createdAt: ago(10 * MINUTE), lastSeenAt: ago(1000), userAgent: 'check' };

/* The longest badge the Problems pane can draw: EVALUATION_LABEL.insufficient_data,
   the longest of the five labels, followed by INSUFFICIENT_REASON.no_baseline,
   the longest of the four reasons — 'there is no history to compare against'
   at 38 characters against below_minimum_samples' 27. Both lists are in
   assets/alerts-model.js:50-68, and assets/pane-alerts.js:1406-1408 composes
   the pill by joining them with ', '. That row is the one this check was
   written for, and NARROW_BADGE below asserts it reached the DOM.

   no_baseline is sent for cost_anomaly, whose scope is "Against the last 7
   days": a rule with a window is exactly the kind that has no history to
   compare against, so this is a combination the real API produces and not a
   shape invented to be long. */
const NARROW_BADGE = 'Not enough data to judge, there is no history to compare against';

const RULES = [
  { ruleKey: 'ai_success_rate', title: 'AI success rate', scopeDescription: 'Per request type',
    thresholdLabel: 'below 95% for 10m', channels: ['teams', 'email'], enabled: true,
    lastEvaluationStatus: 'ok' },
  { ruleKey: 'cost_anomaly', title: 'Unusual cost for a service',
    scopeDescription: 'Against the last 7 days', thresholdLabel: 'over 25%',
    channels: ['email'], enabled: true,
    lastEvaluationStatus: 'insufficient_data', lastInsufficientReason: 'no_baseline' },
  { ruleKey: 'no_telemetry', title: 'No data coming in',
    scopeDescription: 'An app stops sending anything', thresholdLabel: 'over 15m',
    channels: ['teams', 'email'], enabled: true, lastEvaluationStatus: 'error' }
];

/* Overview, App releases and Settings each read something of their own, and
   each of them draws a failure card instead of a pane when that read comes
   back empty. A failure card is three short lines in one column and it fits
   any viewport, so a sweep that accepted one would be reporting on a pane it
   never laid out. The shapes below are the ones those panes' own node:test
   fixtures send — scripts/ops-overview-v2.test.mjs, ops-releases-v2.test.mjs
   and ops-settings-v2.test.mjs — trimmed to what has to be present for the
   pane to reach its ready state, and moved onto the real clock. */

const SUMMARY_DAYS = [6, 5, 4, 3, 2, 1, 0].map((n) => utcDay(n * DAY));

const SUMMARY = {
  generatedAt: ago(5 * MINUTE),
  consent: { basis: 'operational' },
  people: {
    availability: { state: 'ready' },
    platform: { active: 1102, previousActive: 980 },
    apps: [
      { key: 'aria', label: 'Aria', active: 870, tone: 's1' },
      { key: 'ariaxii', label: 'Aria XII', active: 412, tone: 's2' }
    ],
    window: { days: 7 },
    comparison: { days: 7, label: 'the 7 days before' },
    reportingFloor: 50,
    environment: 'production'
  },
  aiRuns: {
    availability: { state: 'ready' },
    runs: 4820, previous: { runs: 4410 },
    daysMissing: [], daysReported: 7, window: { days: 7 }
  },
  cost: {
    availability: { state: 'ready' },
    micros: 412_000_000, currency: 'USD',
    comparison: { changeBasisPoints: 640, label: 'the same days last month' },
    window: { dayOfPeriod: 12, daysInPeriod: 31 },
    basis: 'spend',
    asOf: ago(DAY)
  },
  release: {
    availability: { state: 'ready' },
    platforms: [
      { label: 'iOS', versionName: '2.9.1', versionCode: 291, fetchedAt: ago(3 * HOUR) },
      { label: 'Android', versionName: '2.9.0', versionCode: 290, fetchedAt: ago(3 * HOUR) }
    ]
  },
  activity: {
    availability: { state: 'ready' },
    labels: SUMMARY_DAYS,
    series: [
      { key: 'aria', label: 'Aria', color: 's1', values: [910, 940, 1001, 980, 1040, 1077, 1102] },
      { key: 'ariaxii', label: 'Aria XII', color: 's2', values: [380, 402, 396, 410, 421, 404, 412] }
    ],
    daysMissingRollups: [],
    window: { days: 7 }
  },
  omissions: [
    { key: 'budget', title: 'No budget bar', detail: 'Nothing here records a cloud budget.' }
  ]
};

const RELEASE_TRACKS = (state) => [
  { track: 'internal', versionName: '1.1.3', versionCode: '4412', state: 'processing',
    testerCount: 12, fetchedAt: ago(90_000) },
  { track: 'external', versionName: '1.1.3', versionCode: '4412', state: 'in_review',
    testerCount: 240, fetchedAt: ago(90_000) },
  { track: 'production', versionName: '1.1.2', versionCode: '4398', state: state,
    rolloutBasisPoints: state === 'live' ? 10_000 : 2000,
    rolloutObservedSince: ago(6 * DAY), releasedAt: ago(9 * DAY), fetchedAt: ago(90_000) }
];

const RELEASES = {
  generatedAt: ago(90_000),
  platforms: [
    { platform: 'ios', label: 'iOS', appIdentifier: 'com.example.invalid',
      sourceKey: 'app_store_connect', tracks: RELEASE_TRACKS('live'), unknownTracks: [] },
    { platform: 'android', label: 'Android', appIdentifier: 'com.example.invalid',
      sourceKey: 'google_play', tracks: RELEASE_TRACKS('rolling_out'), unknownTracks: [] }
  ],
  sources: [
    { key: 'app_store_connect', label: 'App Store Connect', status: 'ok',
      lastSuccessAt: ago(90_000), lastAttemptAt: ago(90_000), pollSeconds: 900, mode: 'poll' },
    { key: 'google_play', label: 'Google Play', status: 'ok',
      lastSuccessAt: ago(150_000), lastAttemptAt: ago(150_000), pollSeconds: 900, mode: 'poll' }
  ],
  production: { versionName: '1.1.2', builds: [
    { platform: 'ios', versionCode: '4398' }, { platform: 'android', versionCode: '4398' }] },
  adoption: {
    latestVersion: '1.1.2', sampleSessions: 18_422,
    buckets: [
      { key: 'latest', label: '1.1.2', basisPoints: 6120 },
      { key: 'previous', label: '1.1.1', basisPoints: 2740 },
      { key: 'older', label: 'Older', basisPoints: 1140 }
    ]
  },
  crashFree: { basisPoints: 9962, floorBasisPoints: 9950, windowHours: 24 },
  health: {
    platform: 'android', current: '1.1.2', previous: '1.1.1',
    signals: [
      { key: 'crash_rate', label: 'Crash rate', unit: 'rate_bp', previous: 52, current: 38,
        verdict: 'better' },
      { key: 'cold_start', label: 'Cold start', unit: 'millis', previous: 1840, current: 2130,
        verdict: 'slightly_worse' },
      { key: 'anr', label: 'App not responding', unit: 'per_1k', previous: 1.4, current: 1.4,
        verdict: 'no_change' }
    ]
  }
};

/* Every address here is .invalid and every network address is from RFC 5737's
   documentation range, on the same terms as the pane's own fixtures: this
   directory is world-readable. */
const ADMINS = [
  { id: 'adm_owner', email: 'owner@ops.invalid', displayName: 'Owner', role: 'owner',
    status: 'active', mustChangePassword: false,
    lastLoginAt: ago(2 * HOUR), activeSessionExpiresAt: ahead(30 * DAY - 2 * HOUR) },
  { id: 'adm_op', email: 'operator@ops.invalid', displayName: 'Operator', role: 'operator',
    status: 'active', mustChangePassword: false,
    lastLoginAt: ago(30 * HOUR), activeSessionExpiresAt: ahead(30 * DAY - 30 * HOUR) },
  { id: 'adm_view', email: 'viewer@ops.invalid', displayName: 'Viewer', role: 'viewer',
    status: 'disabled', mustChangePassword: false,
    lastLoginAt: null, activeSessionExpiresAt: null }
];

const SESSIONS = [
  { id: 'ses_owner_current', adminId: 'adm_owner', current: true,
    createdAt: ago(2 * HOUR), lastUsedAt: ago(5 * MINUTE),
    expiresAt: ahead(30 * DAY - 2 * HOUR), revokedAt: null },
  { id: 'ses_operator_1', adminId: 'adm_op', current: false,
    createdAt: ago(30 * HOUR), lastUsedAt: ago(3 * HOUR),
    expiresAt: ahead(30 * DAY - 30 * HOUR), revokedAt: null },
  { id: 'ses_expired_9', adminId: 'adm_view', current: false,
    createdAt: ago(40 * DAY), lastUsedAt: ago(35 * DAY),
    expiresAt: ago(10 * DAY), revokedAt: null }
];

const AUDIT = [
  { id: 'aud_1', occurredAt: ago(5 * MINUTE), actorEmail: 'owner@ops.invalid',
    actorRole: 'owner', action: 'admin.session_revoke', outcome: 'success',
    targetType: 'ops_admin_session', targetId: 'ses_retired_4',
    reason: 'Laptop reported lost', ipAddress: '198.51.100.7' },
  { id: 'aud_2', occurredAt: ago(40 * MINUTE), actorEmail: 'operator@ops.invalid',
    actorRole: 'operator', action: 'admin.login', outcome: 'success',
    targetType: null, targetId: null, reason: null, ipAddress: '198.51.100.9' },
  { id: 'aud_3', occurredAt: ago(3 * HOUR), actorEmail: 'nobody@ops.invalid',
    actorRole: null, action: 'admin.login_failed', outcome: 'refused',
    targetType: null, targetId: null, reason: null, ipAddress: '203.0.113.4' }
];

const PROBLEM = {
  id: 'prb_1', reference: 'AO-118', severity: 'critical', status: 'open',
  category: 'ai_reliability', title: 'Nutrition plans are failing to generate',
  description: 'Worker memory pressure is killing the generation process.',
  ruleKey: 'ai_success_rate', ruleTitle: 'AI success rate',
  /* workPane, not pane: assets/pane-alerts.js:928-931,
     assets/pane-overview.js:539-544 and assets/pane-jobs-live-v2.js:921-924
     all read problem.workPane / problem.workPaneLabel, and so does the panes'
     own fixture at scripts/ops-alerts-v2.test.mjs:124. Spelled `pane` this
     stub drew an action row with the drill-down link missing, so the widest
     row the sweep laid out was one button narrower than the real one
     (Stadiora/Aria#10461). */
  workPane: 'jobs-live', workPaneLabel: 'Happening now',
  detectedAt: ago(15 * MINUTE), firedAt: ago(13 * MINUTE),
  acknowledgedAt: null, acknowledgedBy: null,
  closedAt: null, closeReason: null, closedBy: null,
  notificationsFailed: 0, events: []
};

/* ------------------------------------------------------- proof of drawing */

/* One thing per pane that only that pane's LOADED state puts on the page.

   The floor of MIN_CONTENT_ELEMENTS says a pane drew something. It does not
   say the pane drew its data, and three panes here can draw a failure card of
   their own instead: Overview, App releases and Settings each answer an empty
   read with a card that says the read failed. Those cards pass every other
   gate below — right file, right pane attribute, ready gate reached, top bar
   correct, no shell refusal — and two of them clear the floor of eight by 23
   and 30 elements. So a fixture going stale used to shrink the sweep from ten
   laid-out panes to seven while it went on printing that it had swept ten.

   Each string here is therefore chosen to be absent from that pane's failure
   or empty state and present in its loaded one, and is taken off the fixture
   above wherever the pane prints a fixture value verbatim. A pane that draws
   a failure card now fails its page rather than being measured, which takes it
   out of the swept count as well, so the count assertion at the bottom catches
   it a second time.

   What this does NOT prove: Aria quality and Look up a user read nothing until
   something is submitted, so their markers pin the pane's own static prose and
   nothing more. People and usage and Cloud costs are measured in the empty
   state their stubbed read produces, which is what WHAT THIS DOES NOT COVER
   above already says; their markers pin that empty card, not a populated one.

   A pane that changes these words turns this red. That is the mechanism, not a
   side effect: the markers are kept in step by hand, on the same terms as the
   fixtures they are taken from, and a pane remodel that moves one is meant to
   come past this file. */
const PROOF = {
  /* SUMMARY.people.platform.active and SUMMARY.release.platforms[0].versionName,
     both of which the failure card replaces with "Not reported". */
  overview: ['1,102', SUMMARY.release.platforms[0].versionName],
  jobs: [RULES[0].thresholdLabel, `of ${RULES.length} rules were checking`],
  history: [RULES[0].title, PROBLEM.category],
  /* The drill-down link the workPane rename restored, and the problem's own
     reference. Both sit in the action row this check measures. */
  alerts: [PROBLEM.workPaneLabel, PROBLEM.reference],
  analytics: ['No app reported over this window'],
  spend: ['carried no billed total'],
  evals: ['Check a dataset declaration', 'Quarantine evidence'],
  releases: [RELEASES.sources[0].label, RELEASES.sources[1].label],
  users: ['Nothing looked up yet'],
  settings: [ADMINS[0].email, AUDIT[0].reason]
};

/* A pane joining the registry without a marker would otherwise be swept on the
   floor of eight alone, which is the hole this table exists to close. */
for (const page of PAGES) {
  const proof = PROOF[page.key];
  if (!Array.isArray(proof) || proof.length === 0 || proof.some((s) => !s)) {
    console.error(`\n${REGISTRY} declares pane "${page.key}" and PROOF in ` +
      'scripts/check-ops-narrow-overflow.mjs names nothing that only its loaded ' +
      'state draws, so a failure card on that pane would be measured as the pane.\n');
    process.exit(1);
  }
}

function stub(pathname) {
  if (pathname.startsWith('/api/ops/auth/refresh') || pathname.startsWith('/api/ops/auth/login')) {
    return { data: {
      accessToken: 'stub-access', expiresIn: 900, refreshToken: 'stub-refresh-2',
      refreshTokenRotated: true, authTime: Math.floor(NOW / 1000), reauthWindowSeconds: 900,
      admin: ADMIN, session: SESSION
    } };
  }
  if (pathname.startsWith('/api/ops/auth/session')) {
    return { data: {
      admin: ADMIN, session: SESSION,
      authTime: Math.floor(NOW / 1000), reauthWindowSeconds: 900
    } };
  }
  if (pathname.startsWith('/api/ops/alerts/rules')) {
    return { data: {
      rules: RULES.map((r) => Object.assign({
        severity: 'warning', category: 'ai_reliability',
        lastInsufficientReason: null, lastEvaluatedAt: ago(2 * MINUTE), lastFiredAt: null
      }, r)),
      channels: [
        { channel: 'teams', status: 'ok', target: 'Aria operations',
          lastDeliveredAt: ago(5 * MINUTE), failureReason: null },
        { channel: 'email', status: 'failed', target: 'ops@example.invalid',
          lastDeliveredAt: ago(2 * HOUR), failureReason: 'auth' }
      ]
    } };
  }
  if (pathname.startsWith('/api/ops/alerts/problems')) {
    return { data: { problems: [PROBLEM] } };
  }
  if (pathname.startsWith('/api/ops/summary')) return { data: SUMMARY };
  if (pathname.startsWith('/api/ops/releases')) return { data: RELEASES };
  if (pathname.startsWith('/api/ops/admins')) return { data: ADMINS };
  if (pathname.startsWith('/api/ops/sessions')) return { data: SESSIONS };
  if (pathname.startsWith('/api/ops/audit')) return { data: AUDIT };
  return { data: {} };
}

/* --------------------------------------------------------------- serving */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(stub(url.pathname)));
    return;
  }
  const abs = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
  fs.createReadStream(abs).pipe(res);
});

/* ------------------------------------------------------------------- CDP */

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH, process.env.CHROME_BIN,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('No Chrome or Chromium found. Set CHROME_PATH.');
}

/* Chrome writes the port it actually took to DevToolsActivePort. Asking it
   rather than dictating a port is what keeps two runs on one machine - a
   local re-run over a still-closing browser, two CI jobs on one runner - from
   silently driving each other's browser. */
async function devtoolsPort(profile) {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200; i++) {
    try {
      const port = Number(fs.readFileSync(file, 'utf8').split('\n')[0]);
      if (port > 0) return port;
    } catch { /* browser has not written it yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Chrome never reported a DevTools port');
}

async function devtools(port, pathname, method) {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${pathname}`, { method });
      if (res.ok) return await res.json();
    } catch { /* browser not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Chrome never opened its DevTools endpoint');
}

function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  const waiters = [];
  const seen = new Set();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(JSON.stringify(m.error)));
      else p.resolve(m.result);
      return;
    }
    seen.add(m.method);
    for (const w of waiters.splice(0)) w(m.method);
  };
  return {
    ready: new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; }),
    close: () => ws.close(),
    send(method, params = {}) {
      const id = ++nextId;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    once(method, timeoutMs = 30000) {
      if (seen.has(method)) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for ' + method)), timeoutMs);
        const check = (m) => {
          if (m === method) { clearTimeout(timer); resolve(); }
          else waiters.push(check);
        };
        waiters.push(check);
      });
    },
    reset() { seen.delete('Page.loadEventFired'); }
  };
}

/* What the browser is asked, once the pane has rendered. Reported whole, so a
   failure names the elements that are past the edge rather than only the
   number that proves some element is.

   Takes the pane's PROOF strings because the answer has to be computed against
   the whole of #content: contentText below is truncated for the report, and a
   marker that a pane draws near the bottom of a 530-element page would fall
   outside it. */
const probeFor = (markers) => `(() => {
  const de = document.documentElement;
  const viewport = de.clientWidth;

  /* A designed horizontal scroller and everything inside it. The rules table
     is 760px wide inside a 375px card ON PURPOSE, so its cells all report
     right edges far past the viewport while scrolling in place and leaving
     documentElement alone. Left in, they fill the report and the element that
     actually set the document width never appears -- which is how a CI
     failure came to name a table that was not the cause. */
  const scrolls = (el) => {
    const x = getComputedStyle(el).overflowX;
    return x === 'auto' || x === 'scroll' || x === 'hidden' || x === 'clip';
  };
  const inScroller = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      if (scrolls(n)) return true;
    }
    return false;
  };

  const past = [];
  for (const el of document.querySelectorAll('body *')) {
    const box = el.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue;
    if (box.right > viewport + 0.5 && !inScroller(el)) {
      past.push({
        tag: el.tagName.toLowerCase(),
        cls: el.getAttribute('class') || '',
        text: (el.textContent || '').trim().slice(0, 40),
        right: Math.round(box.right)
      });
    }
  }
  past.sort((a, b) => b.right - a.right);

  const content = document.getElementById('content');
  const title = document.querySelector('.page-title');
  /* Two spellings again, for the same two shells: the v2 shell's top bar calls
     the pane's question .page-sub and the v1 shell's calls it .page-question.
     Both render the registry's own sentence, which is what is compared. */
  const sub = document.querySelector('.page-sub, .page-question');
  const clean = (node) => (node && node.textContent || '').replace(/\\s+/g, ' ').trim();
  const contentText = content ? clean(content) : '';

  return JSON.stringify({
    scrollWidth: de.scrollWidth,
    viewport: viewport,
    /* Which pane the page says it is, and which theme actually got applied.

       Two spellings because there are two shells: shell-pane-v2.js boots from
       data-pane and the v1 assets/shell.js from data-page, and Cloud costs is
       the one page still on the v1 one. Reading only the v2 spelling drops
       that pane out of the swept count, which is how this was found.

       The theme is set through localStorage before the navigation and read
       back here because a write that silently failed would leave this sweep
       laying the same theme out twice and reporting two. */
    pane: document.body.getAttribute('data-pane') || document.body.getAttribute('data-page'),
    theme: de.getAttribute('data-theme'),
    gate: document.body.className,
    title: clean(title),
    sub: clean(sub),
    contentElements: content ? content.querySelectorAll('*').length : -1,
    contentText: contentText.slice(0, 4000),
    /* Against the untruncated text, and reported as what is MISSING rather
       than as a boolean, so a failure can name the marker it did not find. */
    missing: ${JSON.stringify(markers)}.filter((m) => contentText.indexOf(m) === -1),
    ruleRows: document.querySelectorAll('.rule-row').length,
    /* The row's own text, not the text of a particular element inside it. A
       probe that reads .rule-row .badge only sees the sentence while the pane
       spells it that way, and the v2 remodel spells it .pill; a guard that
       anchors on one syntactic shape lets the defect it is named for walk
       through in any other spelling. */
    rowText: [...document.querySelectorAll('.rule-row')].map(function (row) {
      /* Doubled backslash on purpose: this probe is a template literal, so a
         lone \\s here reaches Chrome as a plain "s" and the regex quietly
         becomes /s+/g, which strips every letter s out of the row. */
      return (row.textContent || '').replace(/\\s+/g, ' ').trim();
    }),
    past: past.slice(0, 10)
  });
})()`;

/* ------------------------------------------------------------------- run */

const failures = [];
/* Panes the browser confirmed it had laid out, by the page's own data-pane
   attribute rather than by the list this file navigated with. A page that
   404s, names another pane, or never reaches its ready gate is not in here,
   which is what makes the count at the bottom worth asserting. */
const measured = new Set();
let probes = 0;

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const PORT = server.address().port;

const tempRoot = process.env.RUNNER_TEMP || process.env.TEMP || '/tmp';
const profile = fs.mkdtempSync(path.join(tempRoot, 'ops-overflow-'));

const browser = spawn(chromePath(), [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--no-sandbox',
  '--disable-gpu', '--disable-extensions', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--force-prefers-reduced-motion', 'about:blank'
], { stdio: 'ignore' });

let cdp;
try {
  const cdpPort = await devtoolsPort(profile);
  const target = await devtools(cdpPort, '/json/new?about:blank', 'PUT');
  cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const origin = `http://127.0.0.1:${PORT}`;
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source:
      "try {" +
      "localStorage.setItem('ops-api-base', " + JSON.stringify(origin) + ");" +
      "sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' }));" +
      "} catch (e) {}"
  });

  for (const WIDTH of WIDTHS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: true
    });

    for (const theme of THEMES) {
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: theme }]
      });
      await cdp.send('Runtime.evaluate', {
        expression: "try { localStorage.setItem('ops-theme', " + JSON.stringify(theme) + "); } catch (e) {}"
      });

      for (const page of PAGES) {
        const where = `${page.key} (${page.file}) at ${WIDTH}px, ${theme} theme`;

        cdp.reset();
        await cdp.send('Page.navigate', { url: origin + page.url });
        await cdp.once('Page.loadEventFired');
        await new Promise((r) => setTimeout(r, SETTLE_MS));

        const evaluated = await cdp.send('Runtime.evaluate', {
          expression: probeFor(PROOF[page.key]), returnByValue: true
        });
        const seen = JSON.parse(evaluated.result.value);
        probes += 1;

        /* Everything from here to the scrollWidth comparison is evidence that
           the thing measured was this pane, drawn. An empty page cannot
           overflow, and neither can a refusal card, a boot placeholder or a
           404 — so any of those has to end this page's measurement rather
           than pass it. */
        if (seen.theme !== theme) {
          failures.push(`${where}: the page applied the ${seen.theme} theme, so this ` +
            `measurement is of ${seen.theme} and the ${theme} run never happened.`);
          continue;
        }
        if (seen.pane !== page.key) {
          failures.push(`${where}: ${seen.pane
            ? `the page says it is pane "${seen.pane}", not "${page.key}", so ${REGISTRY} ` +
              'points this pane at a file that belongs to another one'
            : `the page names no pane at all, so neither shell booted it and ${REGISTRY} ` +
              'points this pane at a page that is not one'}.`);
          continue;
        }
        if (seen.gate !== 'is-ready') {
          failures.push(`${where}: the shell never reached its ready gate — body is ` +
            `"${seen.gate}". Nothing was laid out to measure.`);
          continue;
        }
        if (seen.title !== page.label || seen.sub !== page.question) {
          failures.push(`${where}: the top bar reads ${JSON.stringify(seen.title)} / ` +
            `${JSON.stringify(seen.sub)}, and ${REGISTRY} declares ` +
            `${JSON.stringify(page.label)} / ${JSON.stringify(page.question)}.`);
          continue;
        }
        const refused = REFUSALS.find((r) => seen.contentText.includes(r));
        if (refused) {
          failures.push(`${where}: the shell drew "${refused}" instead of the pane, which ` +
            `fits any viewport and proves nothing about the pane itself.`);
          continue;
        }
        if (seen.contentElements < MIN_CONTENT_ELEMENTS) {
          failures.push(`${where}: #content holds ${seen.contentElements} elements, under the ` +
            `floor of ${MIN_CONTENT_ELEMENTS}. The pane did not draw.`);
          continue;
        }
        /* The floor above says the pane drew something. This says it drew
           itself: a pane whose read came back empty answers with a failure
           card that clears the floor, reads the right top bar and is not a
           shell refusal, so nothing else here can tell the two apart. */
        if (seen.missing.length) {
          failures.push(`${where}: #content holds ${seen.contentElements} elements but not ` +
            `${seen.missing.map((m) => JSON.stringify(m)).join(' or ')}, which only this ` +
            'pane\'s loaded state draws. What was laid out is not this pane with its data ' +
            `in it — it starts ${JSON.stringify(seen.contentText.slice(0, 120))}.`);
          continue;
        }
        if (page.key === 'alerts') {
          if (seen.ruleRows < RULES.length) {
            failures.push(`${where}: expected at least ${RULES.length} rule rows, saw ${seen.ruleRows}`);
            continue;
          }
          if (!seen.rowText.some((text) => text.includes(NARROW_BADGE))) {
            failures.push(
              `${where}: the long "cannot judge" sentence is not in any rule row, so the ` +
              `widest row was never laid out. Saw rows: ${JSON.stringify(seen.rowText)}`);
            continue;
          }
        }

        measured.add(seen.pane);

        if (seen.scrollWidth > seen.viewport) {
          const worst = seen.past
            .map((e) => `      ${e.tag}.${e.cls.split(' ').join('.')} ends at ${e.right}px${e.text ? ` ("${e.text}")` : ''}`)
            .join('\n');
          failures.push(
            `${where}: the page scrolls sideways — ` +
            `documentElement.scrollWidth is ${seen.scrollWidth}, viewport is ${seen.viewport}.\n` +
            `    Past the right edge:\n${worst}`);
        } else {
          console.log(`ok  ${page.url} at ${WIDTH}px, ${theme} theme: ` +
            `scrollWidth ${seen.scrollWidth} <= ${seen.viewport}, ` +
            `${seen.contentElements} elements drawn`);
        }
      }
    }
  }
} finally {
  if (cdp) cdp.close();
  browser.kill();
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
}

/* The sweep's own size, asserted rather than printed. A sweep that quietly
   stopped visiting panes — a registry that failed to load, a loop that threw
   halfway, a pane list that shrank back to the one page this check started
   life with — would otherwise report every pane it did reach as fitting and
   exit 0 on a page count nobody looked at. */
const expectedProbes = PAGES.length * WIDTHS.length * THEMES.length;
if (measured.size === 0) {
  failures.push('no pane was measured at all: every page failed before its width was read.');
} else if (measured.size !== PAGES.length) {
  const missing = PAGES.map((p) => p.key).filter((k) => !measured.has(k));
  failures.push(`${REGISTRY} declares ${PAGES.length} panes and ${measured.size} were measured. ` +
    `Never measured: ${missing.join(', ')}.`);
}
if (probes !== expectedProbes) {
  failures.push(`${expectedProbes} page loads were due (${PAGES.length} panes x ${WIDTHS.length} ` +
    `widths x ${THEMES.length} themes) and ${probes} were read.`);
}

console.log(`\nSwept ${measured.size} of the ${PAGES.length} panes ${REGISTRY} declares, ` +
  `at ${WIDTHS.join('px and ')}px, in the ${THEMES.join(' and ')} themes: ` +
  `${probes} page loads measured.`);

if (failures.length) {
  console.error('\nThe operations dashboard does not fit a phone-width viewport:\n');
  for (const f of failures) console.error('  - ' + f);
  console.error(
    '\nA row must wrap or scroll inside its own container. The page itself must ' +
    'never scroll sideways.\n');
  process.exit(1);
}

console.log('Every pane fits ' + WIDTHS.join('px and ') + 'px in both themes.');
process.exit(0);
