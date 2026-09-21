/* Drives every pane of the operations dashboard to a RESULT view and judges
   what is painted there.

   Four rendered guards already run against this dashboard — contrast, narrow
   viewport, theme redraw, shell v2 — and every one of them judges a pane in
   its landing state. None of them drives a pane far enough to render a result:
   a populated table, a picked row, a submitted operation's answer. The cost of
   that hole is measured rather than theoretical.

   Stadiora/Aria#10456 shipped through it. assets/pane-users.js wrote
   `is-selected` onto the match row an operator had just picked, and no
   stylesheet ops/users.html loads had a single rule for it. The selection
   existed in the DOM and was invisible on screen, on the one control that
   decides which account the rest of the pane is describing. Every guard stayed
   green for the whole life of the defect. It was found by hand.

   The class of defect this file exists to catch is therefore: A STATE THE JS
   CAN ENTER THAT NO LOADED STYLESHEET CAN PAINT. It is judged two ways, both
   in real Chrome, both after the pane has been driven past its landing state:

     1. Every class the pane writes into its result view must be REACHED by at
        least one rule, from a sheet the page actually loads, at one of the
        places the pane put that class, as the page stands. A class no rule
        mentions is #10456 verbatim. A class whose only rules are `:hover` is
        the same defect with the pointer moved away — the independent review of
        antonyrugama/aria-website#71 demonstrated exactly that mutation, and
        this check runs with no pointer over the page at all, which is the
        state an operator's screen is in most of the time anybody is looking
        at it.

     2. Every state the pane declares to assistive technology must also be
        painted. An element carrying `aria-current`, `aria-selected`,
        `aria-pressed`, `aria-checked` or `aria-expanded` in its positive value
        is compared, painted property by painted property, against the same
        shape drawn without the state: a sibling of the same tag if there is
        one, otherwise an element of the same tag under a parent of the same
        tag and classes whose own classes are the marked one's minus what the
        state added. That second rule is what reaches #10456's own affordance —
        the picked match's BUTTON is the only child of its cell, so a
        sibling-only rule would report it unjudgeable while the other row's
        identical button sits six nodes away. If the two are painted
        identically and the marked one adds no ink of its own, the state is
        announced and invisible — which is what #10456 was.

   Neither judgement can be made without a browser. A stylesheet compiles to
   nothing that can be asserted about, and a class is only orphaned relative to
   the sheets a particular page loads: `is-selected` HAS a rule in ops.css, and
   ops.css is deliberately absent from every v2 pane page. Node's DOM harness
   at scripts/ops-dom-harness.mjs has no layout engine and no CSSOM, and says
   so in its own NOT COVERED section.

   The pane list is read out of assets/pane-registry.js, the table both shells
   boot from, so a pane cannot join the app without joining this sweep, and the
   number of panes judged is asserted against the number the registry declares.
   All ten are on the v2 bootstrap — #65 moved Cloud costs, the last one — and
   every one of them is judged through the same door.

   HOW A RESULT VIEW IS REACHED. Eight panes reach one from their own boot
   read, answered here by a stub that sends populated figures rather than the
   empty envelopes the other sweeps send. Two need an operator: Look up a user
   is driven through a lookup and then a pick, and Aria quality through a
   dataset validation. Every pane is then required to prove it got there: the
   RESULT_PROOF table names strings that only that pane's result view draws,
   they are checked BEFORE the pane is counted as judged, and the count is
   asserted at the end. A pane that draws a failure card is a named failure,
   never a silent pass.

   KNOWN FAILURES ARE ENUMERATED, NEVER SKIPPED. The first run of this check
   found unpaintable classes on five panes, and one announced-but-unpainted
   state, that the pull request adding the check could not fix. Each one is
   listed in KNOWN_UNPAINTED or KNOWN_UNPAINTED_STATE with the issue tracking
   it, and each entry must still reproduce: a class that starts painting, or
   stops being drawn, or an exception nobody can produce any more, fails this
   check just as loudly as a new orphan. A guard that narrows its own scope to
   stay green is the defect class this file is named for — and so is a guard
   whose exception list outlives the defect, so the pull request that fixes
   one of these deletes its lines here in the same change. Look up a user's
   four lines, Stadiora/Aria#10643 and #10648, came out that way.

   WHAT THIS DOES NOT COVER, in the words of what is actually measured:

   - **One width, 1280px.** Narrow layout is scripts/check-ops-narrow-overflow.mjs's
     sweep. A class painted ONLY by a rule inside a media query is treated here
     as painted whatever the viewport, because the condition is ignored when a
     rule is read: a class styled only under `@media print` would pass. What is
     NOT ignored is the selector, so `:hover`-only paint fails.
   - **Contrast.** Judgement 2 fails only when two states are painted
     IDENTICALLY. Two states that differ by an imperceptible amount — a 1%
     tint, a colour pair below 3:1 — both pass here. Contrast is
     scripts/check-ops-contrast.mjs's sweep, and it judges the landing states.
   - **The accessibility tree.** Judgement 2 reads the state off the markup the
     pane wrote, not out of Chrome's accessibility tree, so it holds the pane
     to painting what it declares rather than to declaring it correctly. The
     inverse — an affordance painted for sighted operators that reaches no
     reader — is not judged here at all. #71's review measured that by hand and
     recorded that CDP does not enumerate `aria-current` on any node.
   - **A result view nobody drives.** Each pane is taken to ONE result view.
     Look up a user is measured with a match picked; a reveal, a support action
     and the danger zone are not opened. Aria quality is measured with a
     dataset declaration validated; evidence quarantine and the approval
     workflow are submitted by nobody. Every other pane is measured in the one
     state its stubbed read produces.
   - **A class judged per page, not per site.** A class is reached, or not,
     across all of its sites together: one site a rule can reach is enough for
     the class, so a conditional variant painted on some of its sites and not
     others is not an orphan. #10456 is the case where NO site is reached.
     Hidden sites count towards being reached — a rule that sets display:none
     is a rule doing something — but only a class with at least one site that
     has a box is ever reported, so a class living exclusively on zero-area
     elements is invisible to this check in both directions.
   - **A result the scroll box still reaches.** The gate that decides whether a
     pane reached a result view asks whether the marker's carrier has a box
     inside documentElement's scroll box. Content moved left of the document,
     translated away, or fixed past the viewport all fail it. Content moved far
     to the RIGHT does not: a box at left:99999px extends scrollWidth, the
     reachable area grows to contain it, and the run stays green — measured,
     not reasoned. Reachability rather than the viewport is deliberate, since
     this sweep never scrolls and every pane is taller than the window; the
     cost is that a result parked somewhere no reader would go, but could
     scroll to, reads as on the page.
   - **A sibling combinator's reach.** A clause like `.a ~ .b` paints an
     element that is neither the class's carrier nor inside it, so for those
     clauses the question falls back to "does this match anything on the page".
     A `~` or `+` rule that matches somewhere else entirely would read as
     paint here.
   - **Paint that is not a class.** An id selector, an attribute selector, an
     inline change through CSSOM, or a state expressed only through an
     attribute the sheet keys on, are all outside judgement 1. Judgement 2 sees
     them when they land on an ARIA-marked element, and nowhere else.
   - **Panes with no state pair.** Eight of the ten panes declare no ARIA state
     in their result view, so judgement 2 has nothing to compare on them and
     they are carried by judgement 1 alone. The per-pane minimum in
     EXPECTED_PAIRS is asserted so a pane that stops drawing the pairs it has
     today is a failure rather than a quiet zero.
   - **A state with no unmarked twin on the page.** Judgement 2 needs something
     to compare against. A pane that draws exactly one row and marks it, or one
     tab and selects it, has no unmarked shape anywhere, and that is reported
     as unjudgeable rather than passed — but it is reported, not measured. The
     users fixture draws two match rows for exactly that reason: one would
     leave the picked row with nothing to compare against. Cloud costs fails
     earlier and louder — below two groupings its switch does not render at
     all, so the state is absent rather than unjudgeable and EXPECTED_PAIRS
     catches it.

   Usage:  node scripts/check-ops-result-view.mjs
   Chrome: CHROME_PATH, or the usual install locations on Linux and Windows.
*/
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'ops/assets/pane-registry.js';
const WIDTH = 1280;
const HEIGHT = 900;
const THEMES = ['dark', 'light'];

/* How long a pane is given to finish its boot read and lay itself out, and
   how long a driven step is given to answer. Every read here is one hop to a
   stub on loopback. */
const SETTLE_MS = 2200;
const STEP_MS = 900;

/* A floor, and only a floor: it says the pane put something on the page. The
   RESULT_PROOF markers below are what say the pane put its RESULT on the
   page. The thinnest result view in this sweep is Live jobs at 143
   elements. */
const MIN_CONTENT_ELEMENTS = 20;

/* What a shell puts on screen INSTEAD of a pane. Measuring one of these
   proves nothing about the pane it stands in for. */
const REFUSALS = ['Not built yet', 'You do not have access to this pane', 'Owner access only'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

/* ------------------------------------------------------------- the panes */

/* Out of the registry rather than out of a second copy of it here: a pane
   cannot join the app without joining this sweep, and the sweep's own size is
   asserted at the bottom against what the registry declares. */
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

if (PAGES.length === 0) {
  console.error(`\n${REGISTRY} declares no panes, so there is nothing to sweep.\n`);
  process.exit(1);
}
for (const page of PAGES) {
  if (!page.file || !fs.existsSync(path.join(ROOT, 'ops', page.file))) {
    console.error(`\n${REGISTRY} declares pane "${page.key}" as ops/${page.file}, ` +
      'which is not a file in this repository.\n');
    process.exit(1);
  }
}

/* ------------------------------------------------------------- fixtures */

/* The real clock, because every age on these panes is computed against
   Date.now(): a fixture pinned to a fixed instant writes a different sentence
   every day it is run.

   Every identity below is coded and every address is .invalid, on the same
   terms as the panes' own fixtures. This pane set carries explicit privacy
   guarantees — personal fields hidden until a reveal is recorded, reveals
   recorded by field name and never by value — and a fixture carrying a
   realistic personal value would be the first place those guarantees leaked. */
const NOW = Date.now();
const ago = (ms) => new Date(NOW - ms).toISOString();
const ahead = (ms) => new Date(NOW + ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const utcDay = (ms) => new Date(NOW - ms).toISOString().slice(0, 10);

const ADMIN = { id: 'adm_1', email: 'owner@ops.invalid', name: 'Owner', role: 'owner' };
const SESSION = { id: 'ses_1', createdAt: ago(10 * MINUTE), lastSeenAt: ago(1000), userAgent: 'check' };

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

/* Three problems rather than one, in three different statuses, because the
   result views on Problems, What happened and Overview are lists: a single
   row cannot show a list drawing its rows differently from one another. */
const PROBLEMS = [
  { id: 'prb_1', reference: 'AO-118', severity: 'critical', status: 'open',
    category: 'ai_reliability', title: 'Nutrition plans are failing to generate',
    description: 'Worker memory pressure is killing the generation process.',
    ruleKey: 'ai_success_rate', ruleTitle: 'AI success rate',
    workPane: 'jobs-live', workPaneLabel: 'Happening now',
    detectedAt: ago(15 * MINUTE), firedAt: ago(13 * MINUTE),
    acknowledgedAt: null, acknowledgedBy: null,
    closedAt: null, closeReason: null, closedBy: null,
    notificationsFailed: 0, events: [] },
  { id: 'prb_2', reference: 'AO-119', severity: 'warning', status: 'acknowledged',
    category: 'cost', title: 'Storage cost climbed against the last 7 days',
    description: 'Video retention is holding more than the window expects.',
    ruleKey: 'cost_anomaly', ruleTitle: 'Unusual cost for a service',
    workPane: 'spend', workPaneLabel: 'Cloud costs',
    detectedAt: ago(4 * HOUR), firedAt: ago(4 * HOUR),
    acknowledgedAt: ago(2 * HOUR), acknowledgedBy: 'ops_owner_1',
    closedAt: null, closeReason: null, closedBy: null,
    notificationsFailed: 0, events: [] },
  { id: 'prb_3', reference: 'AO-120', severity: 'warning', status: 'closed',
    category: 'ingest', title: 'Watch uploads stopped for one app',
    description: 'No telemetry arrived from the watch companion for 20 minutes.',
    ruleKey: 'no_telemetry', ruleTitle: 'No data coming in',
    workPane: 'jobs-live', workPaneLabel: 'Happening now',
    detectedAt: ago(2 * DAY), firedAt: ago(2 * DAY),
    acknowledgedAt: ago(2 * DAY - HOUR), acknowledgedBy: 'ops_owner_1',
    closedAt: ago(DAY), closeReason: 'resolved', closedBy: 'ops_owner_1',
    notificationsFailed: 1, events: [] }
];

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
    expiresAt: ahead(30 * DAY - 30 * HOUR), revokedAt: null }
];

const AUDIT = [
  { id: 'aud_1', occurredAt: ago(5 * MINUTE), actorEmail: 'owner@ops.invalid',
    actorRole: 'owner', action: 'admin.session_revoke', outcome: 'success',
    targetType: 'ops_admin_session', targetId: 'ses_retired_4',
    reason: 'Laptop reported lost', ipAddress: '198.51.100.7' },
  { id: 'aud_2', occurredAt: ago(40 * MINUTE), actorEmail: 'operator@ops.invalid',
    actorRole: 'operator', action: 'admin.login', outcome: 'success',
    targetType: null, targetId: null, reason: null, ipAddress: '198.51.100.9' }
];

const TREND = (scale) => Array.from({ length: 30 }, (_, i) =>
  Math.round((900 + Math.sin(i / 3) * 90 + i * 4) * scale));

/* People and usage, with figures in it. The other rendered sweeps answer
   /api/ops/usage with an empty envelope and measure the no-data card; this
   one is the populated view that card stands in for. */
const USAGE = {
  asOf: ago(HOUR),
  window: {
    range: '30d',
    start: utcDay(30 * DAY) + 'T00:00:00.000Z',
    endExclusive: utcDay(0) + 'T00:00:00.000Z',
    days: 30, grain: 'day', timezone: 'UTC',
    rollupsComputedAt: ago(5 * HOUR),
    reportingStart: utcDay(30 * DAY),
    daysCovered: 30,
    daysMissingRollups: []
  },
  filters: { app: 'all', env: 'production' },
  reportingFloor: 50,
  consent: { enforcedAt: 'ingest',
    detail: 'Only accounts that turned usage analytics on are counted.' },
  availability: { state: 'ready', detail: '' },
  apps: [
    { app: 'mobile', label: 'Mobile', tone: 'mobile', subtitle: 'Athlete app',
      coverageBasisPoints: 9200,
      metrics: [
        { label: 'Active people', kind: 'count', value: 1061 },
        { label: 'Sessions', kind: 'count', value: 8430 },
        { label: 'Sessions per person', kind: 'decimal', digits: 1, value: 7.9,
          numerator: 8430, denominator: 1061 },
        { label: 'Opened a feature', kind: 'rate', value: 6400, numerator: 679, denominator: 1061 }
      ],
      trend: { label: 'Active people per day, Mobile', color: 's1', values: TREND(1) } },
    { app: 'coaches', label: 'Coaches Web', tone: 'coaches', subtitle: 'Coach workspace',
      coverageBasisPoints: 10000,
      metrics: [
        { label: 'Active people', kind: 'count', value: 308 },
        { label: 'Sessions', kind: 'count', value: 1204 },
        { label: 'Sessions per person', kind: 'decimal', digits: 1, value: 3.9,
          numerator: 1204, denominator: 308 },
        { label: 'Opened a feature', kind: 'rate', value: 8084, numerator: 249, denominator: 308 }
      ],
      trend: { label: 'Active people per day, Coaches Web', color: 's2', values: TREND(0.29) } }
  ],
  cohorts: [
    { app: 'mobile', label: 'Mobile', offsets: ['W1', 'W2'],
      rows: [
        { label: '24 Aug', size: 214,
          cells: [{ basisPoints: 7103, returned: 152 }, { basisPoints: 5234, returned: 112 }] },
        { label: '31 Aug', size: 131,
          cells: [{ basisPoints: 6600, returned: 86 }, { state: 'not_aged' }] }
      ] },
    { app: 'coaches', label: 'Coaches Web', offsets: ['W1', 'W2'],
      rows: [
        { label: '24 Aug', size: 64,
          cells: [{ basisPoints: 8100, returned: 52 }, { basisPoints: 7000, returned: 45 }] },
        { label: '31 Aug', size: 51,
          cells: [{ basisPoints: 7500, returned: 38 }, { state: 'not_aged' }] }
      ] }
  ]
};

/* Cloud costs, billed and published. The rows add up to the total exactly, so
   the pane draws the reconciled sentence rather than the gap one.

   `views` keyed by category / resourceGroup / service, each `{ label, hint,
   rows }`, is the shape the route sends. All three keys have to be here and
   the note on `resourceGroup` below says why. The markers this check pins for
   the pane are row labels, which the pane prints verbatim. */
const COST_ROWS = [
  { key: 'openai', label: 'Azure OpenAI', micros: 240_000_000, color: 's1' },
  { key: 'postgres', label: 'Postgres', micros: 92_000_000, color: 's2' },
  { key: 'storage', label: 'Blob storage', micros: 80_000_000, color: 's3' }
];

const COSTS = {
  availability: { state: 'ready' },
  currency: 'USD',
  range: 'month',
  window: { range: 'month', start: utcDay(12 * DAY), endExclusive: utcDay(0),
    label: 'This month', dayOfPeriod: 12, daysInPeriod: 31 },
  total: { micros: 412_000_000, comparisonLabel: 'against the same days last month',
    changeBasisPoints: 618 },
  views: {
    category: { label: 'Category', hint: '3 categories', rows: COST_ROWS },
    /* `resourceGroup` rather than `service` alone, because the pane on the
       page reads `['category', 'resourceGroup']` (ops/assets/pane-spend.js:302)
       and draws its Group-the-bill-by switch only when two of the views it
       reads have rows. A fixture sending `service` gave the v2 pane ONE view,
       no switch, and therefore none of the `aria-pressed` pair EXPECTED_PAIRS
       says this result view declares. All three keys are shapes the route
       sends: `'category' | 'resourceGroup' | 'service'`
       (app-backend/server/ops/opsPanesRouter.ts:158 in the monorepo). */
    resourceGroup: { label: 'Resource group', hint: '3 groups', rows: COST_ROWS },
    service: { label: 'Service', hint: '3 services', rows: COST_ROWS }
  },
  daily: {
    label: 'Daily spend for this period against the previous one',
    labels: [11, 8, 5, 2].map((n) => utcDay(n * DAY)),
    series: [
      { key: 'current', label: 'This period', color: 's1',
        values: [32, 34, 31, 36, 33, 35, 34, 36, 35, 37, 36, 33] },
      { key: 'previous', label: 'Previous period', color: 'muted', dashed: true,
        values: [30, 31, 30, 33, 31, 32, 33, 32, 34, 33, 32, 31] }
    ]
  },
  asOf: ago(2 * HOUR)
};

/* Two matches of the same shape, differing only in the coded reference and
   the masked address. Judgement 2 compares the picked row against the other
   one property by property, so a fixture whose rows differ in structure — one
   flag more, a different tier shape — would hand that comparison a difference
   that has nothing to do with being picked, which is a false green in the one
   place this check most needs not to have one. */
const LOOKUP = {
  recorded: { at: ago(1000), actor: 'ops_owner_1', fields: 'summary', reason: 'SUP-4471' },
  matchCount: 2,
  matches: [
    { reference: 'ath_2277', maskedEmail: 'a•••@example.invalid',
      state: { key: 'active', label: 'Active', tone: 'ok' },
      tier: { key: 'pro', label: 'Athlete Pro', brand: true },
      platforms: [{ key: 'mobile', label: 'Mobile' }],
      lastActiveAt: ago(3 * HOUR), flags: [] },
    { reference: 'ath_2419', maskedEmail: 'b•••@example.invalid',
      state: { key: 'active', label: 'Active', tone: 'ok' },
      tier: { key: 'pro', label: 'Athlete Pro', brand: true },
      platforms: [{ key: 'mobile', label: 'Mobile' }],
      lastActiveAt: ago(30 * HOUR), flags: [] }
  ]
};

const DETAIL = {
  reference: 'ath_2277',
  kind: 'athlete',
  state: { key: 'active', label: 'Active', tone: 'ok' },
  tier: { key: 'pro', label: 'Athlete Pro', brand: true },
  memberSince: ago(400 * DAY),
  recorded: { at: ago(500), actor: 'ops_owner_1', fields: 'summary', reason: 'SUP-4471' },
  summary: { fields: [
    { key: 'email', label: 'Email', masked: true, maskedValue: 'a•••@example.invalid',
      reveal: 'allowed' },
    { key: 'displayName', label: 'Name', masked: true, maskedValue: 'A••• R•••',
      reveal: 'allowed' },
    { key: 'weight', label: 'Weight', masked: true, reveal: 'never' },
    { key: 'locale', label: 'Locale', masked: false, value: 'es-ES' }
  ] },
  activity: { windowDays: 7, events: [
    { occurredAt: ago(3 * HOUR), label: 'Chat reply', tone: 'ok', reference: 'run_88214',
      href: '/ops/run-history.html' },
    { occurredAt: ago(9 * HOUR), label: 'Nutrition plan', tone: 'warn', reference: 'run_87744' }
  ] },
  devices: [{ label: 'iPhone', appVersion: '1.1.2', os: 'iOS 18.2', lastSeenAt: ago(2 * HOUR) }],
  billing: { fields: [
    { key: 'tier', label: 'Tier', masked: false, value: 'Athlete Pro' },
    { key: 'renewsAt', label: 'Renews', masked: false, value: '14 Aug 2026' }
  ] },
  access: { windowDays: 90, entries: [
    { occurredAt: ago(2 * DAY), actor: 'ops_owner_1', fields: 'email', reason: 'SUP-4471',
      revealed: true },
    { occurredAt: ago(5 * DAY), actor: 'ops_operator_2', fields: 'summary', reason: 'SUP-4390',
      revealed: false }
  ] },
  supportActions: { available: [] }
};

function stub(pathname, body) {
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
  if (pathname.startsWith('/api/ops/alerts/problems')) return { data: { problems: PROBLEMS } };
  if (pathname.startsWith('/api/ops/costs')) return { data: COSTS };
  if (pathname.startsWith('/api/ops/summary')) return { data: SUMMARY };
  if (pathname.startsWith('/api/ops/usage')) return { data: USAGE };
  if (pathname.startsWith('/api/ops/releases')) return { data: RELEASES };
  if (pathname.startsWith('/api/ops/admins')) return { data: ADMINS };
  if (pathname.startsWith('/api/ops/sessions')) return { data: SESSIONS };
  if (pathname.startsWith('/api/ops/audit')) return { data: AUDIT };
  if (pathname.startsWith('/api/ops/users/lookup')) return { data: LOOKUP };
  if (/^\/api\/ops\/users\/[^/]+$/.test(pathname)) {
    return { data: Object.assign({}, DETAIL,
      { reference: decodeURIComponent(pathname.split('/').pop()) }) };
  }
  /* The operations transport echoes the request it is answering: the pane
     refuses a response whose requestId or operationId is not the one it
     asked about, which is the check that stops a stale answer painting over
     a newer question. */
  if (pathname.startsWith('/api/ops/ciel/operations')) {
    const req = body || {};
    return {
      schemaVersion: 'ciel.operation.response.v1',
      requestId: req.requestId,
      operationId: req.operationId,
      status: 'success',
      exitCode: 0,
      resource: {
        type: 'ciel.dataset-validation',
        id: req.requestId,
        revision: 1,
        value: {
          valid: true, issues: [],
          digests: [{ datasetId: 'dataset.example', revision: 1, sha256: 'b'.repeat(64) }]
        }
      }
    };
  }
  return { data: {} };
}

/* ------------------------------------------------- driving to the result */

/* What a pane needs an operator to do before it has a result to judge.

   Eight panes need nothing: their boot read answers with figures and the
   result view is what lands. The two below are forms, and their landing state
   — which is all any other rendered guard has ever measured — is a pane with
   no result in it at all.

   Each returns a short sentence about what it did, which is printed with the
   pane's line so a run says how it got where it got. A step that cannot find
   what it needs says so and the pane then fails its markers rather than being
   measured in the state the drive failed to leave. */
const DRIVE = {
  users: `(async () => {
    const id = document.getElementById('lookupIdentifier');
    const reason = document.getElementById('lookupReason');
    if (!id || !reason) return 'no lookup form on the page';
    id.value = 'ath_2277';
    reason.value = 'SUP-4471';
    id.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, ${STEP_MS}));
    const picks = document.querySelectorAll('.match-row-btn');
    if (!picks.length) return 'the lookup drew no match rows';
    /* .click() rather than a dispatched mouse event, deliberately: a real
       pointer would leave the row hovered, and a hover state is exactly what
       judgement 2 must not be confounded by. #71's review demonstrated that
       rewriting the selection rules to :hover-only leaves a picked row
       pixel-identical to an unpicked one with the pointer away, which is
       #10456 again. */
    picks[0].click();
    await new Promise((r) => setTimeout(r, ${STEP_MS}));
    return 'looked up ath_2277 and picked the first of ' + picks.length + ' matches';
  })()`,
  evals: `(async () => {
    const input = document.getElementById('dataset-input');
    if (!input) return 'no dataset form on the page';
    input.value = JSON.stringify({
      schemaVersion: 'ciel.dataset.v1',
      datasets: [{ datasetId: 'dataset.example', revision: 1, cases: [] }],
      fixtureDigests: []
    });
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, ${STEP_MS}));
    return 'validated a dataset declaration';
  })()`
};

/* --------------------------------------------------- proof of the result */

/* One or more strings that only a pane's RESULT view draws.

   This is the gate the other sweeps' equivalent could not be: theirs proves a
   pane drew ITSELF rather than a failure card, and for two of the panes it
   pins static prose from a form with no result in it. These strings are taken
   off the fixtures above wherever a pane prints a fixture value verbatim, so
   they are absent from the landing state, absent from an empty state, and
   absent from a failure card by construction.

   Checked BEFORE the pane is counted as judged. A guard that judges zero
   pages passes, and a guard that counts a landing state as a result view is
   the same failure wearing a better number. */
const RESULT_PROOF = {
  overview: ['1,102', SUMMARY.release.platforms[0].versionName, PROBLEMS[0].reference],
  jobs: [RULES[0].thresholdLabel, RULES[1].title],
  history: [RULES[0].title, PROBLEMS[0].category],
  alerts: [PROBLEMS[0].reference, PROBLEMS[1].reference, PROBLEMS[0].workPaneLabel],
  analytics: ['1,061', '8,430', USAGE.apps[1].label],
  spend: [COST_ROWS[0].label, COST_ROWS[2].label],
  /* Only the answered validation draws these: the digest the stub sent back
     and the sentence the pane writes for a valid declaration. */
  evals: ['Declarations valid', 'b'.repeat(64)],
  releases: [RELEASES.sources[0].label, RELEASES.adoption.buckets[0].label],
  /* Nothing here is on the page until a lookup has answered AND a match has
     been picked: the masked address comes off the account record the pick
     requested, and "Access record" is the band the account column ends with. */
  users: ['Access record', 'Selected', DETAIL.summary.fields[1].maskedValue],
  settings: [ADMINS[0].email, AUDIT[0].reason]
};

for (const page of PAGES) {
  const proof = RESULT_PROOF[page.key];
  if (!Array.isArray(proof) || proof.length === 0 || proof.some((s) => !s)) {
    console.error(`\n${REGISTRY} declares pane "${page.key}" and RESULT_PROOF in ` +
      'scripts/check-ops-result-view.mjs names nothing that only its result view draws, ' +
      'so its landing state would be judged as a result view.\n');
    process.exit(1);
  }
}

/* ------------------------------------------------------ known failures */

/* Classes a pane writes into its result view today that no sheet the page
   loads can paint. Every one of these is #10456's shape, every one is in a
   file this pull request does not own, and every one is filed.

   They are enumerated rather than skipped, and each entry must still
   reproduce: a class that starts painting, or stops being drawn, fails this
   check with a message telling you to delete the line. An exception nobody
   can produce is an exception nobody is reading.

   `why` is the fact, not an excuse. Two entries on Look up a user are query
   hooks — assets/pane-users.js queries them by class and says so in its own
   comment — and they are the only entries here that are not defects.

   Stadiora/Aria#10643 was fixed in the pull request that deleted its two
   lines from this list, and `match-row-btn` left with it: assets/pane-users.js
   still queries the control by that class, but the class is now reached by
   `.match-row-btn[aria-pressed="true"]` in assets/pane-users-v2.css, so it no
   longer reproduces as unpainted and carrying it would be carrying an
   exception nobody can produce. */
const KNOWN_UNPAINTED = [
  { pane: 'users', cls: 'match-row', issue: null,
    why: 'a query hook: assets/pane-users.js:1467 finds the rows by it' },
  { pane: 'users', cls: 'sel-mark', issue: null,
    why: 'a query hook: assets/pane-users.js:549 finds the selected mark by it' },
  { pane: 'alerts', cls: 'rule-row', issue: 'Stadiora/Aria#10644',
    why: 'styled only in operate.css, which alerts.html deliberately does not load' }
];

/* The same enumeration for judgement 2: a state a pane declares to assistive
   technology whose control is painted exactly like its unmarked peer today.
   Keyed by the attribute and the element's tag and classes, so a fix that
   paints the control breaks the key and tells you to delete the line.

   Empty, and that is the point: the one entry this list was opened with —
   Look up a user's pick control announcing aria-pressed while drawn
   pixel-for-pixel like the button beside it, Stadiora/Aria#10648 — was fixed
   by `.match-row-btn[aria-pressed="true"]` in assets/pane-users-v2.css, and
   the line came out in the same pull request. An empty list is not a weaker
   check: judgement 2 still compares every state pair it finds, and an
   unpainted state that appears from here on is a plain failure with nobody to
   claim it. */
const KNOWN_UNPAINTED_STATE = [];

/* The states each pane declares to assistive technology in its result view,
   and therefore the comparisons judgement 2 makes there. A minimum rather
   than a count: a new state pair is judged the moment it appears without
   anybody editing this table, and a pane that stops drawing the pairs it has
   today fails rather than passing on zero comparisons.

   Eight panes are zero because their result views declare no ARIA state at
   all. That is stated here rather than left to be inferred from a sweep that
   silently compared nothing. */
const EXPECTED_PAIRS = {
  overview: 0, jobs: 0, history: 0, alerts: 0, analytics: 0,
  /* One pair: the Group-the-bill-by switch's two buttons, `category` against
     `resourceGroup`. Not `service` — the pane drops that key from its switch
     on purpose (ops/assets/pane-spend.js:288-302) and draws the per-service
     figures as a table instead, so `service` feeds a table and no ARIA state.
     Deleting `resourceGroup` from the fixture takes this to 0 and fails the
     run; deleting `service` leaves it at 1. */
  spend: 1,
  evals: 0,
  releases: 0,
  /* The picked row's aria-current against the unpicked row, and the pick
     control's aria-pressed against the other row's control. */
  users: 2,
  settings: 0
};

for (const page of PAGES) {
  if (typeof EXPECTED_PAIRS[page.key] !== 'number') {
    console.error(`\n${REGISTRY} declares pane "${page.key}" and EXPECTED_PAIRS in ` +
      'scripts/check-ops-result-view.mjs does not say how many state comparisons its ' +
      'result view is due, so zero of them would read as a pass.\n');
    process.exit(1);
  }
}

/* A sentence appended to a missed floor. Each names the mechanism that draws
   the state and the two NUMBERS a reader can put side by side — never what
   those numbers mean about a cause.

   Three review rounds of this pull request each caught a version of this text
   asserting a cause anyway, and the third one is the instructive one: which of
   the fixture and the pane produced a short count is not decidable from the
   count. Round 1 blamed the pane where the fixture was intact. Round 2 cleared
   the fixture where the fixture was the cause. Round 3 read a census of rows
   the pane DREW as a count of rows the fixture SENT, and proved it by making
   the pane render one of two rows it had been handed: byte-identical output to
   the run where the fixture sent one. The suggested repair — "the same number
   means the fixture narrowed" — is itself false in the other proven direction,
   where the pane writes aria-pressed on both rows and the count matches the
   fixture exactly.
   So these sentences state only what was observed and where the number to
   compare it against lives — and where the comparison is between two counts,
   BOTH are printed, derived from the fixture rather than typed, so the reader
   is not asked to take either on faith. Round 4 added the other half of the
   same discipline: what is counted here is ATTRIBUTES, so no sentence may
   conclude anything about CONTROLS. Removing both ARIA writes from
   applySelection leaves two rows and two pick controls on the page, measured
   and clickable, and an empty census. The reader does the deducing; this file
   has been wrong at it three times. Enumerated rather than generated: a hint
   that guesses is worse than none. */
const FLOOR_HINTS = {
  spend: 'The pair comes from the Group-the-bill-by switch, which viewCard draws only ' +
    'when two or more of the groupings in VIEW_ORDER (declared in ops/assets/pane-spend.js) ' +
    'arrive with rows. PREFLIGHT in this file tested the COSTS fixture against that one ' +
    'rule before Chrome started and it passed, since a failure there exits before this ' +
    'point — so read that rule as already checked and start downstream of it.',
  users: 'The pairs come from picking a row in Look up a user: aria-current on the row ' +
    'and aria-pressed on its control. Measured at this head, a one-row result view judges ' +
    'aria-current and not aria-pressed — the marked <tr> finds an unmarked peer among the ' +
    'detail card\'s rows (ops/assets/pane-users.js:1095, :1156, :1239) while the marked ' +
    'control finds none outside the match table. applySelection writes aria-pressed on the ' +
    'pick control of every rendered match row that has one (:551, from :652), so the ' +
    'aria-pressed entries above, added up whatever their value, are how many pick controls ' +
    `carried the ATTRIBUTE — not how many were drawn. The LOOKUP fixture in this file sent ` +
    `${LOOKUP.matches.length} rows. Equal means one attribute-bearing pick control per row ` +
    'sent; fewer means the page carried fewer of them than that, which a row that never ' +
    'rendered and a control the pane stopped writing the attribute on both produce.'
};

/* Fixture pre-flight.
 *
 * Stadiora/Aria#10631's guard merged green and went red on `main` seven minutes
 * later, because its branch was cut from a `main` older than the Cloud costs v2
 * remodel: the floor was calibrated against a pane that no longer existed. The
 * general shape recurs whenever a guard pins a floor while panes are being
 * remodelled concurrently, and re-reading the branch base by hand is not a fix.
 *
 * So each check below reads the PRODUCT source for the rule that decides
 * whether the state can be drawn at all, and tests this file's fixture against
 * it before the browser starts. A fixture that cannot produce the state its
 * floor demands is a fixture bug, and it is named as one here rather than
 * surfacing 300 lines later as a bare count of 0.
 *
 * Enumerated, not generic: only panes whose state depends on fixture SHAPE
 * rather than mere presence need an entry, and each says how it derives its
 * rule so a remodel moves the check rather than silently passing it.
 *
 * Its limit, stated because round 8 proved it twice: reading a declaration
 * out of source text is NOT executing the module. `VIEW_ORDER = []` followed
 * by `VIEW_ORDER.push('category', 'resourceGroup')` initialises to nothing and
 * runs with two, and no amount of grammar on the initialiser closes that. So
 * the check below refuses every file it cannot read as ONE declaration that
 * nothing later writes to, and the sentences it does print say what the TEXT
 * says and stop there. */
const PREFLIGHT = [
  {
    pane: 'spend',
    check() {
      const rel = 'ops/assets/pane-spend.js';
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      /* NOT comment-stripped, and that is the fix rather than an oversight.
         Stripping block comments first removed characters from INSIDE a quoted
         grouping name: a name spelled 'category' with a block comment opened
         and closed inside the quotes was read as "category", and the run then
         said the fixture supplied one grouping and was missing "region" when
         it supplied none and adding "region" alone would not have helped. Every transformation applied
         before the read is a chance to report text the file does not contain,
         so there are none. A comment anywhere inside the literal now makes an
         item unreadable and lands on the refusal below, which is the right
         answer: this check cannot see what the comment hides.

         Two structural refusals stand in front of the grammar, because a
         well-formed initialiser establishes nothing on its own:

           var VIEW_ORDER = [];
           VIEW_ORDER.push('category', 'resourceGroup');

         passes any grammar, initialises to nothing, and runs with two — so a
         second write to the name is refused outright rather than read past.
         Likewise a second DECLARATION anywhere in the file, which is how a
         dead `if (false) { var VIEW_ORDER = []; }`, a later reassignment, and
         a string literal quoting the declaration all reached the parser with
         the real one sitting untouched below them. */
      const DECL = /(?:var|let|const)\s+VIEW_ORDER\s*=\s*([^;]*);/g;
      const decls = [...src.matchAll(DECL)];
      if (decls.length === 0) {
        return `${rel} no longer declares VIEW_ORDER as a var/let/const initialised in one ` +
          'statement, so this check cannot tell whether the COSTS fixture can draw the ' +
          'Group-the-bill-by switch. Re-derive it from whatever replaced it rather than ' +
          'deleting this check.';
      }
      if (decls.length > 1) {
        return `${rel} contains ${decls.length} texts this check would read as a VIEW_ORDER ` +
          'declaration, and it cannot tell which one the module runs — a later ' +
          'reassignment, a declaration in a branch, and a string quoting one all look ' +
          'alike here. Teach it which is authoritative; do not assume the pane lost its ' +
          'switch, and do not touch EXPECTED_PAIRS.spend on the strength of this.';
      }
      const decl = decls[0];
      /* Everything the name touches AFTER its one declaration. A read is fine;
         a write is not, and the list is written out rather than inferred so
         that a mutator it does not know is a gap in this comment rather than a
         silent pass — see the limit note above the table. */
      const rest = src.slice(decl.index + decl[0].length);
      const WRITE = new RegExp('\\bVIEW_ORDER\\s*(?:=[^=]|\\[[^\\]]*\\]\\s*=[^=]|\\.\\s*' +
        '(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin|length\\s*=))');
      const write = rest.match(WRITE);
      if (write) {
        /* Phrased like the count above it, and for the same reason: nothing
           here distinguishes code from a comment or a string, so "the pane
           writes to VIEW_ORDER" was false the moment the text appeared in a
           comment — and the sentence after it, that the declaration is not the
           value the pane runs with, was false with it. */
        return `${rel} contains a text after the declaration that this check reads as a ` +
          `write to VIEW_ORDER (${JSON.stringify(write[0].trim())}), and it does not ` +
          'distinguish code from a comment or a string, so it cannot rely on the ' +
          'declaration being the whole of the order. Teach it which texts are ' +
          'authoritative; do not assume the pane lost its switch, and do not touch ' +
          'EXPECTED_PAIRS.spend on the strength of this.';
      }
      /* Read strictly, and refuse anything this grammar does not cover.
         Everything here is a NARROWING of a looser parse that had been wrong
         four times in the same way: a declaration it read only part of,
         reported as the whole of VIEW_ORDER, over a pane drawing its switch
         from two groupings and a fixture with nothing wrong with it.

           ['category', RG]                  one quoted string out of two items
           ['category', // the pane's ...]   the apostrophe pairs with the next
                                             real quote: two strings, two
                                             comma-items, resourceGroup gone
           ['category'].concat(EXTRA)        the old [^\]]* stopped at the ]
           [['category', 'resourceGroup']]   likewise, one item deep

         The last three all AGREED with a count of comma-items, so counting
         items was not the invariant either. What is checked now is the shape
         itself: the initialiser must be a bracketed list, and every item in it
         must be a plain quoted literal with nothing else attached.

         An EMPTY array is not an unreadable shape: it is a declaration this
         check can read, saying no groupings. What that means for the running
         pane is a separate question and the message below does not answer it. */
      const init = decl[1].trim();
      const snip = (s) => JSON.stringify(s.length > 90 ? `${s.slice(0, 90)}…` : s);
      const unsupported = (what) =>
        `${rel} declares VIEW_ORDER as ${snip(init)}, and this check cannot read that as ` +
        `a plain array of quoted grouping names: ${what}. It reads a bracketed list of ` +
        'single- or double-quoted literals and nothing else, so it refuses rather than ' +
        'guess at the rest. Teach it the new shape; do not assume the pane lost its ' +
        'switch, and do not touch EXPECTED_PAIRS.spend on the strength of this.';
      const bracketed = init.match(/^\[([\s\S]*)\]$/);
      if (!bracketed) {
        return unsupported('the initialiser does not both open with "[" and end with "]"');
      }
      const body = bracketed[1].trim();
      const items = body === '' ? [] : body.split(',').map((s) => s.trim());
      /* A trailing comma is house style here and leaves one empty last item.
         An empty item anywhere else is a hole, and falls to the message. */
      if (items.length > 1 && items[items.length - 1] === '') items.pop();
      const QUOTED = /^(?:'[^'"\\\n]*'|"[^'"\\\n]*")$/;
      const badAt = items.findIndex((s) => !QUOTED.test(s));
      if (badAt !== -1) {
        return unsupported(`item ${badAt + 1} of ${items.length}, ${snip(items[badAt])}, ` +
          'is not a quoted string literal on its own');
      }
      const order = items.map((s) => s.slice(1, -1));
      if (order.length < 2) {
        /* No causal claim. The earlier wording ended "a state the pane can no
           longer draw for any fixture", which is a statement about the RUNNING
           module, and this check has read a declaration. Under the push
           payload above that sentence was false, and it named
           EXPECTED_PAIRS.spend as the thing to change. */
        return `the one VIEW_ORDER declaration this check can read in ${rel} initialises it ` +
          `to ${JSON.stringify(order)}, and viewCard draws the Group-the-bill-by switch only ` +
          'when two or more groupings arrive with rows. This check reads that declaration ' +
          'and does not execute the module, so it reports the text and stops: if that is ' +
          'the whole of the order then no fixture can produce the pair EXPECTED_PAIRS.spend ' +
          'asks for, and if something else fills it then teach this check to see that.';
      }
      const has = (k) => Array.isArray(COSTS.views[k]?.rows) && COSTS.views[k].rows.length > 0;
      const supplied = order.filter(has);
      if (supplied.length >= 2) return null;
      const missing = order.filter((k) => !has(k));
      /* The whole point of reading VIEW_ORDER at run time is that the rule can
         change, so the note about "service" has to be conditional on the rule
         just read. Printed unconditionally it contradicted the sentence above
         it the moment the pane put "service" INTO the order. The clause that
         followed — "and draws it as a table instead" — was asserted about a
         function this check never opens, and printed over a serviceCard()
         returning null. What is left is what the order above shows. */
      const serviceNote = order.includes('service') ? '' :
        ' Note that "service" does NOT count: it is absent from the order just read, ' +
        `because ${rel} excludes it from the switch on purpose.`;
      return `the COSTS fixture supplies ${supplied.length} of the groupings the pane ` +
        `switches between. ${rel} reads ${JSON.stringify(order)} and viewCard draws the ` +
        'Group-the-bill-by switch only when two or more of them arrive with rows; this ' +
        `fixture is missing ${missing.map((k) => `"${k}"`).join(', ')}. Add rows for ` +
        `${missing.map((k) => `"${k}"`).join(', ')} rather than lowering ` +
        'EXPECTED_PAIRS.spend — the pair on that switch is where this pane\'s floor in ' +
        'this file comes from, and a floor of 0 would let the switch vanish unnoticed.' +
        `${serviceNote}`;
    }
  }
];

{
  const paneKeys = new Set(PAGES.map((p) => p.key));
  /* The hints are validated here rather than at their own table because one of
     them cites PREFLIGHT by name. A hint that claims a pre-flight this file no
     longer runs would rule out a cause nobody checked — and the run that
     exposed it, a PREFLIGHT emptied to [], left the hint saying the fixture had
     been tested when the missing rows were the whole failure. This couples the
     two tables on the literal name, which is as far as a check can reach into
     prose: a hint that claimed a pre-flight in other words would still pass. */
  for (const key of Object.keys(FLOOR_HINTS)) {
    if (!EXPECTED_PAIRS[key]) {
      console.error(`\nFLOOR_HINTS explains a missed floor for "${key}" and EXPECTED_PAIRS ` +
        'does not set one, so the hint can never print. Delete it or set the floor.\n');
      process.exit(1);
    }
    if (FLOOR_HINTS[key].includes('PREFLIGHT') && !PREFLIGHT.some((e) => e.pane === key)) {
      console.error(`\nFLOOR_HINTS for "${key}" tells the reader PREFLIGHT already tested ` +
        'the fixture, and PREFLIGHT has no entry for that pane, so the hint rules out a ' +
        'cause nothing checked. Restore the pre-flight or stop citing it.\n');
      process.exit(1);
    }
  }
  const problems = [];
  for (const entry of PREFLIGHT) {
    if (!paneKeys.has(entry.pane)) {
      problems.push(`PREFLIGHT names pane "${entry.pane}", which ${REGISTRY} does not ` +
        'declare, so the check it carries runs against nothing.');
      continue;
    }
    const problem = entry.check();
    if (problem) problems.push(`${entry.pane}: ${problem}`);
  }
  if (problems.length) {
    /* Neutral about which side is at fault: the same block reports a fixture
       that cannot produce the state AND a declaration this check cannot read,
       and the second is not a fixture problem. */
    console.error('\nA pre-flight check stopped this run before Chrome started, so the cause ' +
      'is here rather than 300 lines below as a bare count of 0:\n');
    for (const p of problems) console.error(`  - ${p}\n`);
    process.exit(1);
  }
}

/* --------------------------------------------------------------- serving */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { /* not a JSON body */ }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(stub(url.pathname, body)));
    });
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
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('No Chrome or Chromium found. Set CHROME_PATH.');
}

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

/* ------------------------------------------------------------- the probe */

/* Everything below runs inside the page, against the result view, with no
   pointer anywhere near it. */
const probeFor = (markers) => `(() => {
  const clean = (node) => (node && node.textContent || '').replace(/\\s+/g, ' ').trim();
  const content = document.getElementById('content');
  const de = document.documentElement;

  /* ---------------------------------------------- what the page loaded */

  /* Every style rule with at least one declaration, out of the sheets this
     page actually loaded. A rule with an empty block paints nothing, so it
     cannot be what makes a class load-bearing.

     Media conditions are deliberately NOT evaluated — see WHAT THIS DOES NOT
     COVER. Selectors are, which is the half that matters: a rule that only
     applies on :hover matches nothing while the pointer is elsewhere, and
     that is the mutation #71's reviewer demonstrated. */
  const rules = [];
  const walkRules = (list) => {
    for (const rule of list) {
      if (rule.type === CSSRule.STYLE_RULE) {
        if (rule.style && rule.style.length) rules.push(rule.selectorText || '');
      } else if (rule.cssRules) {
        walkRules(rule.cssRules);
      }
    }
  };
  let sheetsRead = 0;
  for (const sheet of document.styleSheets) {
    let list;
    try { list = sheet.cssRules; } catch (e) { continue; }
    sheetsRead += 1;
    walkRules(list);
  }

  /* :not(...) is removed before a selector is read for a class, because a
     class named inside it is a class the rule refuses to paint. :is(), :where()
     and :has() are left alone: a class named inside those IS painted by the
     rule. */
  const withoutNot = (sel) => {
    let out = '';
    for (let i = 0; i < sel.length; i++) {
      if (sel.startsWith(':not(', i)) {
        let depth = 0;
        let j = i + 4;
        for (; j < sel.length; j++) {
          if (sel[j] === '(') depth += 1;
          else if (sel[j] === ')') { depth -= 1; if (depth === 0) break; }
        }
        i = j;
        continue;
      }
      out += sel[i];
    }
    return out;
  };

  const unevaluable = [];

  /* Class tokens a clause NAMES, with the places a dot is not a class
     removed first: an attribute value can hold one ([href=".pdf"]), a string
     literal can hold one, and :not() holds classes the rule refuses to
     paint. :is(), :where() and :has() are left in, because a class named
     inside those IS painted by the rule. */
  const classTokens = (clause) => {
    const bare = withoutNot(clause)
      .replace(/\\[[^\\]]*\\]/g, '')
      .replace(/"[^"]*"|'[^']*'/g, '');
    const out = [];
    for (const [, cls] of bare.matchAll(/\\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g)) out.push(cls);
    return out;
  };

  /* class -> the clauses from loaded sheets that name it. Built once per page
     so the judgement below can be asked per SITE without rescanning every
     selector for every element. */
  const byClass = new Map();
  for (const selectorText of rules) {
    for (const one of selectorText.split(',')) {
      for (const cls of new Set(classTokens(one))) {
        if (!byClass.has(cls)) byClass.set(cls, []);
        byClass.get(cls).push(one.trim());
      }
    }
  }

  /* Does a rule from a loaded sheet reach THIS element's class HERE?

     Asked at the class's own sites rather than at the page: a clause paints a
     class at an element when it matches that element, or matches something
     inside it — the ancestor case, where .tbl tbody tr.is-selected > th
     paints the row's cells rather than the row. A class no clause can reach
     at any of its sites is #10456.

     The one loosening: a clause with a sibling combinator paints an element
     that is neither the carrier nor inside it, so for those the question falls
     back to the page. They are named in NOT COVERED. */
  const paintsAt = (el, cls) => {
    const clauses = byClass.get(cls);
    if (!clauses) return false;
    for (const clause of clauses) {
      /* A pseudo-element is dropped for the matching question: a ::before on
         a class is paint by that class. */
      const probe = clause.replace(/::[a-zA-Z-]+(\\([^)]*\\))?/g, '').trim();
      if (!probe) continue;
      try {
        if (el.matches(probe)) return true;
        if (el.querySelector(probe)) return true;
        if (/[~+]/.test(probe) && document.querySelector(probe)) return true;
      } catch (e) {
        unevaluable.push(clause);
        return true;
      }
    }
    return false;
  };

  /* ------------------------------------------- judgement 1: class paint */

  /* Judged at the SITES a class lands on rather than against the page as a
     whole: the question is whether a rule from a loaded sheet can reach THIS
     class where the pane put it, not whether the rule matched something
     somewhere. A class counts as painted once any one of its sites is
     reached, INCLUDING a site the rule hides — a rule that sets display:none
     is a rule doing something, and the App releases legend is reached only at
     the keys whose share it takes away. What no site can reach is #10456.

     A class is REPORTED only if it also lands somewhere with a box. A class
     that only ever lands on a zero-area element cannot be seen either way,
     and an empty error container styled :not(:empty) is not an orphan for
     being empty. */
  const seenClasses = new Map();
  let classSites = 0;
  let visibleSites = 0;
  for (const el of content.querySelectorAll('*')) {
    const list = el.classList;
    if (!list || !list.length) continue;
    const box = el.getBoundingClientRect();
    const visible = box.width > 0 && box.height > 0;
    for (const cls of list) {
      classSites += 1;
      if (visible) visibleSites += 1;
      let rec = seenClasses.get(cls);
      if (!rec) {
        rec = { cls, painted: false, visible: false, where: null, text: null };
        seenClasses.set(cls, rec);
      }
      if (!rec.painted) rec.painted = paintsAt(el, cls);
      if (visible && !rec.visible) {
        rec.visible = true;
        rec.where = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '');
        rec.text = clean(el).slice(0, 48);
      }
    }
  }
  const unpainted = [...seenClasses.values()].filter((c) => !c.painted && c.visible);

  /* ------------------------------------- judgement 2: state pair paint */

  const STATES = ['aria-current', 'aria-selected', 'aria-pressed', 'aria-checked', 'aria-expanded'];
  const positive = (v) => v !== null && v !== '' && v !== 'false' && v !== 'undefined';

  /* The properties a person can see. Geometry is NOT among them: two rows of
     a table hold different text, so a width or a height difference would be a
     difference this comparison must not accept as the state being painted. */
  const PAINT = [
    'background-color', 'background-image', 'background-position', 'background-size',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-left-radius', 'border-top-right-radius',
    'border-bottom-left-radius', 'border-bottom-right-radius',
    'box-shadow', 'outline-color', 'outline-style', 'outline-width', 'outline-offset',
    'color', 'font-weight', 'font-style', 'font-size', 'font-family',
    'text-decoration-line', 'text-decoration-color', 'text-transform',
    'opacity', 'filter', 'transform', 'visibility', 'display'
  ];
  const PSEUDO = [
    'content', 'background-color', 'background-image', 'box-shadow',
    'border-left-color', 'border-left-width', 'border-left-style',
    'width', 'height', 'color', 'opacity', 'display', 'transform'
  ];

  /* Keyed by the path from the compared root — child index and tag — rather
     than by a flat walk index, so one element appended inside a row does not
     shift every element after it and turn one real difference into fifty
     imaginary ones. */
  const fingerprint = (root) => {
    const out = new Map();
    const walk = (el, key) => {
      const cs = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      const before = getComputedStyle(el, '::before');
      const after = getComputedStyle(el, '::after');
      out.set(key, {
        tag: el.tagName.toLowerCase(),
        style: PAINT.map((p) => p + ':' + cs.getPropertyValue(p)).join(';'),
        before: PSEUDO.map((p) => p + ':' + before.getPropertyValue(p)).join(';'),
        after: PSEUDO.map((p) => p + ':' + after.getPropertyValue(p)).join(';'),
        /* Whether this element puts anything on screen at all, which is what
           decides whether an element present in one state and absent from the
           other is an affordance or a hidden hook. */
        ink: box.width > 0 && box.height > 0 && cs.visibility !== 'hidden' &&
          Number(cs.opacity) > 0,
        text: clean(el).slice(0, 40)
      });
      let i = 0;
      for (const child of el.children) {
        walk(child, key + '/' + i + ':' + child.tagName.toLowerCase());
        i += 1;
      }
    };
    walk(root, ':' + root.tagName.toLowerCase());
    return out;
  };

  /* A peer is the same shape drawn WITHOUT the state, looked for in two
     places, in this order:

       1. a sibling of the same tag that does not carry the state — two rows of
          one table, two tabs of one strip;
       2. failing that, the same shape one level out: an element of the same
          tag whose parent has the same tag and the same class attribute, and
          whose own classes are a subset of the marked element's — the marked
          one carries whatever the state added and nothing else differs.

     Rule 2 exists because #10456's own affordance needs it. The picked match's
     BUTTON is the only child of its cell, so rule 1 finds no sibling at all and
     the pressed button would be reported unjudgeable while the other row's
     identical button sits six nodes away. The subset test is what keeps rule 2
     from comparing a pressed button against any unrelated button sharing a
     tag. */
  const classSet = (node) =>
    new Set((node.getAttribute('class') || '').split(/\\s+/).filter(Boolean));
  const subsetOf = (small, big) => {
    for (const c of small) if (!big.has(c)) return false;
    return true;
  };

  const peerFor = (el, attr) => {
    const parent = el.parentElement;
    if (!parent) return null;
    for (const sib of parent.children) {
      if (sib === el) continue;
      if (sib.tagName !== el.tagName) continue;
      if (positive(sib.getAttribute(attr))) continue;
      return { node: sib, rule: 'a sibling' };
    }
    const mine = classSet(el);
    const parentTag = parent.tagName;
    const parentClass = parent.getAttribute('class') || '';
    for (const cand of content.querySelectorAll(el.tagName.toLowerCase())) {
      if (cand === el) continue;
      if (positive(cand.getAttribute(attr))) continue;
      const cp = cand.parentElement;
      if (!cp || cp.tagName !== parentTag) continue;
      if ((cp.getAttribute('class') || '') !== parentClass) continue;
      if (!subsetOf(classSet(cand), mine)) continue;
      return { node: cand, rule: 'the same shape in another ' + parentTag.toLowerCase() };
    }
    return null;
  };

  const pairs = [];
  /* Every state attribute the result view declares at ALL, positive or not,
     counted by value. Judgement 2 only keeps the positive ones, so a pane that
     has stopped drawing a control entirely and a pane that draws it with every
     state false both arrive at the floor check as a bare zero. This census is
     what tells those two apart in the failure message.

     Scoped to #content, which is the pane's own output. That scope is load
     bearing and rests on a mount point rather than on the pane: the shell's
     App-scope bar carries an aria-pressed on every button
     (ops/assets/shell-pane-v2.js:413-421) and stays out of these counts only
     because it is appended to main (:1094) while this walks #content. A
     remodel that moved the bar inside #content would inflate the users
     aria-pressed count that FLOOR_HINTS.users tells a reader to compare
     against LOOKUP. */
  const stateCensus = {};
  for (const el of content.querySelectorAll('*')) {
    for (const attr of STATES) {
      const value = el.getAttribute(attr);
      if (value === null) continue;
      const key = attr + '="' + value + '"';
      stateCensus[key] = (stateCensus[key] || 0) + 1;
    }
  }
  for (const el of content.querySelectorAll('*')) {
    for (const attr of STATES) {
      const value = el.getAttribute(attr);
      if (!positive(value)) continue;
      const found = peerFor(el, attr);
      const describe = (node) => node.tagName.toLowerCase() +
        (node.getAttribute('class') ? '.' + node.getAttribute('class').split(/\\s+/).join('.') : '');
      if (!found) {
        pairs.push({ attr, value, marked: describe(el), peer: null, differences: [], judged: false,
          text: clean(el).slice(0, 60) });
        continue;
      }
      const peer = found.node;
      const a = fingerprint(el);
      const b = fingerprint(peer);
      const differences = [];
      let compared = 0;
      for (const [key, rec] of a) {
        const other = b.get(key);
        if (!other || other.tag !== rec.tag) {
          if (rec.ink) differences.push('the marked one draws ' + (rec.text ? JSON.stringify(rec.text) : key) + ', which the unmarked one has no counterpart for');
          continue;
        }
        compared += 1;
        if (rec.style !== other.style) {
          const mine = rec.style.split(';');
          const theirs = other.style.split(';');
          const first = mine.find((p, i) => p !== theirs[i]);
          differences.push(key + ' ' + first + ' against ' + theirs[mine.indexOf(first)]);
        }
        if (rec.before !== other.before) differences.push(key + ' ::before differs');
        if (rec.after !== other.after) differences.push(key + ' ::after differs');
      }
      for (const [key, rec] of b) {
        if (!a.has(key) && rec.ink) {
          differences.push('the unmarked one draws ' + (rec.text ? JSON.stringify(rec.text) : key) +
            ', which the marked one has no counterpart for');
        }
      }
      pairs.push({ attr, value, marked: describe(el), peer: describe(peer), peerRule: found.rule,
        compared, differences: differences.slice(0, 6), count: differences.length, judged: true,
        text: clean(el).slice(0, 60) });
    }
  }

  const contentText = content ? clean(content) : '';

  /* A marker in the DOM is not a marker on screen.

     Setting display:none on the wrapper a pane hands to region.show() leaves
     every marker in textContent and every node in querySelectorAll('*'), so
     both result gates passed over a blank content area and the pane counted
     as judged: a result view nothing paints, which is the defect class this
     whole file exists to catch, occurring in its own entry gate. Judgement 1
     could not catch it either, since it reports a class only where the class
     lands on something with a box, and judgement 2's floor for that pane is 0.

     So a marker counts only when something that CARRIES it is on screen. The
     carrier is looked for innermost-first: #content contains the text of a
     display:none child and has a box of its own, so asking whether any
     element containing the marker is visible answers yes for every marker on
     the page. An element is a carrier when it holds the marker and no child
     of it does, which also covers a marker split across two siblings — their
     parent is then the innermost carrier.

     Two predicates, deliberately: a box rules out display:none and a collapsed
     subtree, checkVisibility() rules out visibility:hidden and
     content-visibility, which keep their boxes. opacity is NOT asked about,
     because a pane mid-transition would read as hidden and this gate decides
     whether the run happens at all. */
  const carriers = (m) => {
    const out = [];
    for (const el of content.querySelectorAll('*')) {
      if (clean(el).indexOf(m) === -1) continue;
      let deeper = false;
      for (const kid of el.children) {
        if (clean(kid).indexOf(m) !== -1) { deeper = true; break; }
      }
      if (!deeper) out.push(el);
    }
    return out;
  };
  /* Size, renderedness, and PLACE. The first version of this asked the first
     two and passed a result moved to left:-99999px, to translateX(-3000px),
     or fixed at 2000px on a 1280px viewport — three boxes of the right size,
     rendered, and nowhere a person could look. scale(0) was caught, so it saw
     extent and not position, which is the narrower half of the same question.

     The reachable area, not the viewport: this sweep never scrolls, and every
     one of these panes is taller than the window, so a marker below the fold
     is on the page and failing it would be a false red. documentElement's
     scroll box is what a reader can reach by scrolling; a box that does not
     intersect it is not reachable by scrolling either. */
  const root = document.documentElement;
  const reachW = Math.max(root.clientWidth, root.scrollWidth);
  const reachH = Math.max(root.clientHeight, root.scrollHeight);
  const onScreen = (el) => {
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return false;
    if (box.right <= 0 || box.bottom <= 0 || box.left >= reachW || box.top >= reachH) {
      return false;
    }
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true });
    }
    return true;
  };
  const markers = ${JSON.stringify(markers)};
  const absent = markers.filter((m) => contentText.indexOf(m) === -1);
  const hiddenMarkers = markers.filter((m) => contentText.indexOf(m) !== -1
    && !carriers(m).some(onScreen));
  const title = document.querySelector('.page-title');
  /* Two spellings. The pane header aria.js:253 builds writes the question into
     .page-sub, which is what all ten pages render. .page-question is
     shell.js:290's spelling, and no ops page loads shell.js any more — it is
     kept in this selector so the probe does not depend on that staying true,
     at a cost of one clause. */
  const sub = document.querySelector('.page-sub, .page-question');

  return JSON.stringify({
    pane: document.body.getAttribute('data-pane') || document.body.getAttribute('data-page'),
    theme: de.getAttribute('data-theme'),
    gate: document.body.className,
    title: clean(title),
    sub: clean(sub),
    contentElements: content ? content.querySelectorAll('*').length : -1,
    contentText: contentText.slice(0, 4000),
    missing: absent,
    hiddenMarkers,
    sheetsRead,
    ruleCount: rules.length,
    classSites: visibleSites,
    sitesEvaluated: classSites,
    classesSeen: seenClasses.size,
    unpainted,
    unevaluable: [...new Set(unevaluable)],
    pairs,
    stateCensus,
    /* Nothing should be hovered: every driven step activates a control through
       .click() rather than a pointer, and a hover state left on the page would
       make a :hover-only rule look like paint. */
    hovered: document.querySelectorAll('#content :hover').length
  });
})()`;

/* ------------------------------------------------------------------- run */

const failures = [];
/* Panes the browser confirmed it had driven to a result view, by the page's
   own data-pane attribute and by the result markers, rather than by the list
   this file navigated with. */
const judged = new Set();
const exceptionsHit = new Set();
const stateExceptionsHit = new Set();
let resultViews = 0;
let pairsJudged = 0;
let classSites = 0;
const pairsByPane = {};
/* Per pane, every state attribute its result view declared and how many times,
   kept so a missed floor can say which of the two things went wrong. */
const censusByPane = {};

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const PORT = server.address().port;

const tempRoot = process.env.RUNNER_TEMP || process.env.TEMP || os.tmpdir();
const profile = fs.mkdtempSync(path.join(tempRoot, 'ops-result-view-'));

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
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false
  });

  const origin = `http://127.0.0.1:${PORT}`;
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source:
      'try {' +
      "localStorage.setItem('ops-api-base', " + JSON.stringify(origin) + ');' +
      "sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' }));" +
      '} catch (e) {}'
  });

  for (const theme of THEMES) {
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: theme }]
    });
    await cdp.send('Runtime.evaluate', {
      expression: "try { localStorage.setItem('ops-theme', " + JSON.stringify(theme) + '); } catch (e) {}'
    });

    for (const page of PAGES) {
      const where = `${page.key} (${page.file}), ${theme} theme`;

      cdp.reset();
      await cdp.send('Page.navigate', { url: origin + page.url });
      await cdp.once('Page.loadEventFired');
      await new Promise((r) => setTimeout(r, SETTLE_MS));

      let drove = 'its own read';
      if (DRIVE[page.key]) {
        const ran = await cdp.send('Runtime.evaluate', {
          expression: DRIVE[page.key], awaitPromise: true, returnByValue: true
        });
        if (ran.exceptionDetails) {
          failures.push(`${where}: driving the pane to its result view threw — ` +
            JSON.stringify(ran.exceptionDetails).slice(0, 400));
          continue;
        }
        drove = String(ran.result.value);
      }

      const evaluated = await cdp.send('Runtime.evaluate', {
        expression: probeFor(RESULT_PROOF[page.key]), returnByValue: true
      });
      if (evaluated.exceptionDetails) {
        failures.push(`${where}: reading the result view threw — ` +
          JSON.stringify(evaluated.exceptionDetails).slice(0, 400));
        continue;
      }
      const seen = JSON.parse(evaluated.result.value);
      resultViews += 1;

      /* Everything from here to the judgements is evidence that what is about
         to be judged is this pane's result view. A landing state, a refusal
         card, a failure card and a 404 all have to end this page rather than
         pass it. */
      if (seen.theme !== theme) {
        failures.push(`${where}: the page applied the ${seen.theme} theme, so the ${theme} ` +
          'run never happened.');
        continue;
      }
      if (seen.pane !== page.key) {
        failures.push(`${where}: ${seen.pane
          ? `the page says it is pane "${seen.pane}", not "${page.key}"`
          : 'the page names no pane at all, so neither shell booted it'}.`);
        continue;
      }
      if (seen.gate !== 'is-ready') {
        failures.push(`${where}: the shell never reached its ready gate — body is ` +
          `"${seen.gate}". Nothing was drawn to judge.`);
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
        failures.push(`${where}: the shell drew "${refused}" instead of the pane.`);
        continue;
      }
      if (seen.contentElements < MIN_CONTENT_ELEMENTS) {
        failures.push(`${where}: #content holds ${seen.contentElements} elements, under the ` +
          `floor of ${MIN_CONTENT_ELEMENTS}. The pane did not draw.`);
        continue;
      }
      if (seen.missing.length) {
        failures.push(`${where}: the pane drew ${seen.contentElements} elements but not ` +
          `${seen.missing.map((m) => JSON.stringify(m)).join(' or ')}, which only its RESULT ` +
          `view draws. Driving it (${drove}) did not leave a result on screen — what is there ` +
          `starts ${JSON.stringify(seen.contentText.slice(0, 140))}.`);
        continue;
      }
      /* Separated from the branch above on purpose. "The pane drew N elements
         but not X" is false here: it drew X, and nothing on screen carries it.
         Saying so would be this file making the reader's diagnosis harder in
         exactly the way seven rounds of review have been about. */
      if (seen.hiddenMarkers.length) {
        failures.push(`${where}: the pane drew ` +
          `${seen.hiddenMarkers.map((m) => JSON.stringify(m)).join(' and ')} into #content ` +
          'and no element carrying it has a box inside the area this page can be scrolled ' +
          'over that the browser also reports as rendered — zero-area, display:none, ' +
          'visibility:hidden, content-visibility, or placed outside the document. The ' +
          'result is in the DOM and not anywhere a reader could look, so nothing below ' +
          'could judge what it paints and this run will not count the pane as reaching a ' +
          'result view.');
        continue;
      }
      if (seen.sheetsRead === 0 || seen.ruleCount === 0) {
        failures.push(`${where}: no stylesheet could be read from the page ` +
          `(${seen.sheetsRead} sheets, ${seen.ruleCount} rules), so every class on it would ` +
          'have looked painted by nothing and every class looks orphaned.');
        continue;
      }
      if (seen.hovered > 0) {
        failures.push(`${where}: ${seen.hovered} elements inside #content are hovered, so a ` +
          ':hover-only rule would read here as paint. Judgement is void.');
        continue;
      }

      judged.add(seen.pane);
      classSites += seen.classSites;

      /* --------------------------------------- judgement 1: class paint */

      for (const orphan of seen.unpainted) {
        const known = KNOWN_UNPAINTED.find((k) => k.pane === page.key && k.cls === orphan.cls);
        if (known) {
          exceptionsHit.add(page.key + '.' + orphan.cls);
          continue;
        }
        failures.push(`${where}: the result view writes class "${orphan.cls}" on ` +
          `<${orphan.where}> (${JSON.stringify(orphan.text)}) and no rule in any stylesheet ` +
          'this page loads reaches it at any of the places the pane put it. That class ' +
          'paints nothing — which is Stadiora/Aria#10456 exactly.');
      }
      if (seen.unevaluable.length) {
        failures.push(`${where}: ${seen.unevaluable.length} selectors could not be evaluated ` +
          `against the page (${seen.unevaluable.slice(0, 3).map((s) => JSON.stringify(s)).join(', ')}), ` +
          'so the classes they name were counted as painted without being checked.');
      }

      /* ---------------------------------- judgement 2: state pair paint */

      const pairCount = seen.pairs.filter((p) => p.judged).length;
      /* The census must come from the pass that supplied the minimum, not from
         whichever theme ran last. They can differ: a pane that writes its
         states in one theme and not the other gives a floor of 0 from the
         silent theme and a census full of positive states from the loud one,
         and joining the two says the states were drawn and unjudgeable when
         they were judged, in the other theme. Reproduced at
         ops/assets/pane-users.js:547,551 by keying the written value on
         data-theme. The theme is carried too, so the message can say which
         pass it is describing. */
      if (pairCount < (pairsByPane[page.key] ?? Infinity)) {
        pairsByPane[page.key] = pairCount;
        censusByPane[page.key] = { census: seen.stateCensus || {}, theme };
      }
      pairsJudged += pairCount;

      for (const pair of seen.pairs) {
        if (!pair.judged) {
          failures.push(`${where}: ${pair.marked} carries ${pair.attr}="${pair.value}" ` +
            `(${JSON.stringify(pair.text)}) and has no sibling of the same shape without it, ` +
            'so nothing on this page says what the unmarked state looks like and the state ' +
            'cannot be judged.');
          continue;
        }
        if (pair.count === 0) {
          const known = KNOWN_UNPAINTED_STATE.find((k) => k.pane === page.key &&
            k.attr === pair.attr && k.marked === pair.marked);
          if (known) {
            stateExceptionsHit.add(page.key + '|' + pair.attr + '|' + pair.marked);
            continue;
          }
          failures.push(`${where}: ${pair.marked} carries ${pair.attr}="${pair.value}" and is ` +
            `painted identically to ${pair.peer} across all ${pair.compared} compared nodes — ` +
            'same colours, same borders, same shadows, same weight, and no ink of its own. ' +
            'The state is announced to a screen reader and invisible on screen, which is ' +
            'Stadiora/Aria#10456.');
        }
      }

      console.log(`ok  ${page.url} (${theme}): drove ${drove}; ` +
        `${seen.contentElements} elements, ${seen.classesSeen} classes over ` +
        `${seen.classSites} sites, ${pairCount} state comparisons`);
    }
  }
} finally {
  if (cdp) cdp.close();
  browser.kill();
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
}

/* ------------------------------------------------------------ the counts */

/* Every number below is derived from what ran, and every expectation is
   derived from the registry, the tables above, or both. A sweep that stopped
   visiting panes, or one whose exception list has rotted past the code it
   describes, fails here rather than printing a total nobody checked. */

for (const page of PAGES) {
  const due = EXPECTED_PAIRS[page.key];
  const had = pairsByPane[page.key];
  if (had === undefined) continue;
  if (had < due) {
    /* A bare count of 0 states the symptom and withholds everything needed to
       act on it. Three cases, not two: the pane declared no state attribute at
       all; it declared them but none was judgeable; or it judged SOME and is
       short of its floor.

       Every sentence below is about ATTRIBUTES, because attributes are what
       was counted. An absent aria-pressed does not establish an absent
       control: removing both ARIA writes from applySelection
       (ops/assets/pane-users.js:547,551) leaves two match rows and two pick
       controls on the page, measured at 81.4 x 28.25 px, and an empty census.
       None of the three cases is attributed to a cause either — the third
       arrives from a narrowed fixture and from a pane regression alike — so
       each states what was on the page and the hint below says which number to
       compare it against. */
    const record = censusByPane[page.key] || { census: {}, theme: null };
    const census = record.census || {};
    const declared = Object.keys(census).sort();
    const inventory = declared.map((k) => `${k} ×${census[k]}`).join(', ');
    /* The count is a per-theme minimum, so the inventory has to come from the
       theme that produced it or it describes a different page. */
    const inTheme = record.theme ? ` in the ${record.theme} theme` : '';
    let saw;
    if (had > 0) {
      /* "Drawing fewer of them than it was" is not measured — nothing here
         knows what the pane was drawing before. Raising EXPECTED_PAIRS.spend
         with the pane untouched printed it over a byte-identical result view.
         So it states the two numbers and stops. Round 7 caught the sentence
         adding a third number the first two refute: "look for the ONE state"
         printed under "judged 2 here, fewer than 4". Round 8 caught what was
         left of the tail naming causes — "either the pane stopped writing one
         or the fixture stopped producing the shape it needs" — over the same
         floor-only payload, where neither had. The list of inputs is printed
         once, below, for every branch. */
      saw = `It judged ${had} here, fewer than ${due} rather than none — its result view ` +
        `declared ${inventory}${inTheme}. That is ${due - had} short.`;
    } else if (declared.length) {
      /* One sentence covering both shapes this case takes — every value
         negative, and positives nobody could pair. The earlier wording, "no
         positive one among them had an unmarked peer", is vacuously true of
         the first and reads as the second. Narrowed rather than split: the
         inventory above already shows the reader which shape this is, and a
         new branch here would be one more piece of unproven analysis written
         mid-review. */
      saw = `Its result view did declare ${inventory}${inTheme}, so the attributes are ` +
        'being written and none of them produced a pair this check could judge.';
    } else {
      /* Two payloads, neither asserted. The first wording of this sentence
         read an absent attribute as an absent control, which is false when
         applySelection stops writing its two channels and leaves both pick
         controls drawn and clickable. Its replacement, "that is the attribute
         missing, not the control", is the same error with the sign flipped,
         and is false when the control genuinely goes: returning null from
         viewSwitch (ops/assets/pane-spend.js:367) takes the Group-the-bill-by
         switch off the page and empties the census the same way. An empty
         census distinguishes neither, so this sentence names both. */
      saw = `Its result view declared no state attribute of any kind${inTheme}. What this ` +
        'counts is attributes, so that is the whole of what it says: a control that ' +
        'stopped being drawn, and a control still drawn with its attribute dropped, both ' +
        'empty the census.';
    }
    /* Printed in every case, because no hint names a cause any more. Gating it
       on had === 0 suppressed the users hint in exactly the case it was
       written for. */
    const hint = FLOOR_HINTS[page.key] ? ` ${FLOOR_HINTS[page.key]}` : '';
    /* Three inputs produce this number and only one of them is on the page.
       The lead used to end "so the pane has stopped drawing a state this check
       was judging", and the tail used to offer the pane and the fixture as the
       two candidates. Raising a floor with nothing else touched makes both
       false, and a mis-calibrated floor is the incident this whole pre-flight
       exists for — so the input that is most likely to be wrong was the one
       input neither sentence named. They are enumerated now, and none is
       chosen. */
    failures.push(`${page.key}: EXPECTED_PAIRS says its result view declares at least ${due} ` +
      `ARIA state${due === 1 ? '' : 's'} to compare and ${had} were found. ${saw} Three ` +
      'things decide that number and this check measured one of them: what the pane draws, ' +
      'what the fixture sends, and the floor itself — EXPECTED_PAIRS in this file, which a ' +
      `raise moves without touching the page. The census above is the measurement.${hint}`);
  }
}

const unusedExceptions = KNOWN_UNPAINTED
  .filter((k) => !exceptionsHit.has(k.pane + '.' + k.cls))
  .map((k) => `${k.pane}.${k.cls}`);
if (unusedExceptions.length) {
  failures.push('KNOWN_UNPAINTED names classes this run could not reproduce as unpainted: ' +
    `${unusedExceptions.join(', ')}. Either they paint now, or the pane stopped drawing them — ` +
    'delete the lines rather than carrying an exception nobody is reading.');
}

const unusedStateExceptions = KNOWN_UNPAINTED_STATE
  .filter((k) => !stateExceptionsHit.has(k.pane + '|' + k.attr + '|' + k.marked))
  .map((k) => `${k.pane} ${k.marked}[${k.attr}]`);
if (unusedStateExceptions.length) {
  failures.push('KNOWN_UNPAINTED_STATE names states this run could not reproduce as ' +
    `unpainted: ${unusedStateExceptions.join(', ')}. Either they are painted now, or the ` +
    'pane stopped declaring them — delete the lines rather than carrying an exception ' +
    'nobody is reading.');
}

const counts = {
  panesDeclared: PAGES.length,
  panesJudged: judged.size,
  themes: THEMES.length,
  resultViewsRead: resultViews,
  knownUnpaintedDeclared: KNOWN_UNPAINTED.length,
  knownUnpaintedReproduced: exceptionsHit.size,
  knownUnpaintedStateDeclared: KNOWN_UNPAINTED_STATE.length,
  knownUnpaintedStateReproduced: stateExceptionsHit.size
};
const expected = {
  panesDeclared: PAGES.length,
  panesJudged: PAGES.length,
  themes: THEMES.length,
  resultViewsRead: PAGES.length * THEMES.length,
  knownUnpaintedDeclared: KNOWN_UNPAINTED.length,
  knownUnpaintedReproduced: KNOWN_UNPAINTED.length,
  knownUnpaintedStateDeclared: KNOWN_UNPAINTED_STATE.length,
  knownUnpaintedStateReproduced: KNOWN_UNPAINTED_STATE.length
};

console.log('\ncounts');
console.log(JSON.stringify(counts, null, 2));
console.log(`state comparisons: ${pairsJudged} over ${resultViews} result views, ` +
  `minimum per pane ${JSON.stringify(pairsByPane)}`);
console.log(`class sites judged: ${classSites}`);

try {
  assert.deepEqual(counts, expected);
} catch (e) {
  const missing = PAGES.map((p) => p.key).filter((k) => !judged.has(k));
  failures.push('the sweep is not the size it claims: ' + JSON.stringify(counts) +
    ' against ' + JSON.stringify(expected) +
    (missing.length ? `. Never judged: ${missing.join(', ')}` : ''));
}

if (failures.length) {
  /* The heading covers everything in the list below it, and the list holds
     missed floors, unreachable result views and sweep-size mismatches as well
     as unpainted classes. Naming one of those as the finding was false on any
     run that did not contain it — a floor raised with the pane untouched
     printed it over twenty passing paint judgements. */
  console.error('\nThe result views of the operations dashboard did not come back clean:\n');
  for (const f of failures) console.error('  - ' + f);
  console.error(
    '\nA state a pane can enter has to be visible in the state the pane enters it. ' +
    'A class with no rule, and a marked row painted exactly like an unmarked one, ' +
    'are the same defect: Stadiora/Aria#10456.\n');
  process.exit(1);
}

console.log(`\nEvery one of the ${PAGES.length} panes ${REGISTRY} declares reached a result ` +
  `view in both themes, and every class and state drawn there is painted by a rule the page ` +
  `loads (${KNOWN_UNPAINTED.length} enumerated class exceptions and ` +
  `${KNOWN_UNPAINTED_STATE.length} state exception${KNOWN_UNPAINTED_STATE.length === 1 ? '' : 's'}, ` +
  'all still reproducing).');
process.exit(0);
