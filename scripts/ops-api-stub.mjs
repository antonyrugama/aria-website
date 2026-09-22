/* The operations API, answered from a fixture, for the browser guards.

   Two checks lay the real pane pages out in headless Chrome and read
   something back off them: scripts/check-ops-narrow-overflow.mjs measures the
   document width at phone widths, and scripts/check-ops-theme-redraw.mjs
   presses the theme button and measures the paint. Neither can talk to the
   real operations API, and neither can measure a pane that answered an empty
   read with a failure card: a failure card is a few short lines that fit any
   viewport and repaint from the stylesheet for free, so it passes both checks
   while proving nothing about the pane it stands in for.

   So the fixture is the substrate both checks stand on, and it lives here
   rather than inside either of them. The bodies below came out of
   check-ops-narrow-overflow.mjs, which is still carrying its own copy at the
   time of writing — this module is imported by check-ops-theme-redraw.mjs
   only. Pointing the narrow-overflow check at it is a one-line change and is
   deliberately not made here: that file belongs to another change in flight.

   Every address is .invalid and every network address is from RFC 5737's
   documentation range. This directory is world-readable.

   Public surface: named exports — stub(pathname) answers an /api/ops/* path,
   PROOF names what each pane's drawn state puts on the page, and the fixture
   bodies themselves are exported for the checks that assert against a value
   they send.
*/
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
   the pill by joining them with ', '. That row is the one
   scripts/check-ops-narrow-overflow.mjs was written for, and NARROW_BADGE
   below is the string that check asserts reached the DOM.

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

/* Cloud costs, in the state a period that has not published yet produces.
   Both generations of this pane read `availability.state` first and print
   `availability.detail` verbatim into the card they draw for it, so the detail
   line below is a fixture value on the page rather than pane prose — which is
   what makes it usable as a marker across a remodel.

   An explicit branch rather than the fall-through it used to take. Falling
   through sent `{}`, which today's pane reads as "no billed total" and the v2
   remodel on antonyrugama/aria-website#65 reads as a state outside its
   vocabulary: the same payload, two different cards, and a marker that works
   on one head and not the next. A state both generations name is the payload
   this fixture should have been sending all along. */
const COSTS = {
  availability: {
    state: 'not_published',
    detail: 'Billing for this period has not published yet, so there is no ' +
      'figure to read here until the export lands.'
  }
};

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
     row the narrow-viewport sweep laid out was one button narrower than the
     real one
     (Stadiora/Aria#10461). */
  workPane: 'jobs-live', workPaneLabel: 'Happening now',
  detectedAt: ago(15 * MINUTE), firedAt: ago(13 * MINUTE),
  acknowledgedAt: null, acknowledgedBy: null,
  closedAt: null, closeReason: null, closedBy: null,
  notificationsFailed: 0, events: []
};

/* ------------------------------------------------- proof the pane drew itself */

/* One thing per pane that only that pane's LOADED state puts on the page.

   An element-count floor says a pane drew something. It does not say the pane
   drew its DATA, and several panes here answer an empty read with a failure
   card of their own: Overview, App releases and Settings each do. Such a card
   is served from the right file, sets the right pane attribute, reaches the
   shell's ready gate, carries a correct top bar — both shells write the top
   bar out of the registry entry they booted from, not out of the read — and is
   not one of the shell's own refusals, so every other gate a check can apply
   passes on it.

   That matters differently to each caller and matters to both.
   scripts/check-ops-narrow-overflow.mjs measures the document width, and a
   failure card fits any viewport; scripts/check-ops-theme-redraw.mjs compares
   a page against a fresh load of itself, and a failure card repaints from the
   stylesheet perfectly. Either one would report on a pane it never drew.

   Each string here is therefore chosen to be absent from that pane's failure
   or empty state and present in its drawn one, and is taken off the fixture
   above wherever the pane prints a fixture value verbatim.

   What these do NOT prove: Aria quality and Look up a user read nothing until
   something is submitted, so their markers pin the pane's own static prose and
   nothing more. People and usage and Cloud costs are answered above with an
   empty envelope and a period that has not published, so their markers pin
   those cards rather than populated ones.

   A pane that changes these words turns both checks red. That is the
   mechanism, not a side effect: the markers are kept in step by hand, on the
   same terms as the fixtures they are taken from, and a pane remodel that
   moves one is meant to come past this file. */
const PROOF = {
  /* SUMMARY.people.platform.active and SUMMARY.release.platforms[0].versionName,
     both of which the failure card replaces with "Not reported". */
  overview: ['1,102', SUMMARY.release.platforms[0].versionName],
  jobs: [RULES[0].thresholdLabel, `of ${RULES.length} rules were checking`],
  history: [RULES[0].title, PROBLEM.category],
  /* The drill-down link the workPane rename restored, and the problem's own
     reference. Both sit in the action row the narrow-viewport sweep
     measures. */
  alerts: [PROBLEM.workPaneLabel, PROBLEM.reference],
  analytics: ['No app reported over this window'],
  /* COSTS.availability.detail, which both this pane and the v2 remodel print
     verbatim into whichever card they draw for `not_published`. */
  spend: ['there is no figure to read here until the export lands'],
  evals: ['Check a dataset declaration', 'Quarantine evidence'],
  releases: [RELEASES.sources[0].label, RELEASES.sources[1].label],
  users: ['Nothing looked up yet'],
  settings: [ADMINS[0].email, AUDIT[0].reason]
};


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
      /* The shape `pane-alerts.js:routingCard()` actually reads. The stub used
         to send `status`/`target`/`lastDeliveredAt`/`failureReason`, none of
         which the pane looks at, so "Where problems are sent" drew two
         nameless rows both reading "No destination has been set"
         (Stadiora/Aria#10821). A fixture describing a payload the route does
         not send is a picture of nothing.

         Teams delivering, email set up but refused, webhook set up and never
         used: all three branches `channelNote()` has for a configured
         destination. The third is the state configuring a channel produces
         before its first delivery, which is exactly what Stadiora/Aria#10811
         asks somebody to create, and the stub had no picture of it. */
      channels: [
        { channel: 'teams', label: 'Microsoft Teams', configured: true,
          lastDeliveryStatus: 'ok', lastFailureReason: null, consecutiveFailures: 0,
          lastAttemptAt: ago(5 * MINUTE), lastSuccessAt: ago(5 * MINUTE) },
        { channel: 'email', label: 'Email', configured: true,
          lastDeliveryStatus: 'failed', lastFailureReason: 'auth', consecutiveFailures: 3,
          lastAttemptAt: ago(2 * HOUR), lastSuccessAt: ago(2 * DAY) },
        { channel: 'webhook', label: 'Webhook', configured: true,
          lastDeliveryStatus: null, lastFailureReason: null, consecutiveFailures: 0,
          lastAttemptAt: null, lastSuccessAt: null }
      ]
    } };
  }
  if (pathname.startsWith('/api/ops/alerts/problems')) {
    return { data: { problems: [PROBLEM] } };
  }
  if (pathname.startsWith('/api/ops/costs')) return { data: COSTS };
  if (pathname.startsWith('/api/ops/summary')) return { data: SUMMARY };
  if (pathname.startsWith('/api/ops/releases')) return { data: RELEASES };
  if (pathname.startsWith('/api/ops/admins')) return { data: ADMINS };
  if (pathname.startsWith('/api/ops/sessions')) return { data: SESSIONS };
  if (pathname.startsWith('/api/ops/audit')) return { data: AUDIT };
  return { data: {} };
}

export {
  NOW, ago, ahead, MINUTE, HOUR, DAY, utcDay,
  ADMIN, SESSION, NARROW_BADGE, RULES, SUMMARY, RELEASES,
  ADMINS, SESSIONS, AUDIT, COSTS, PROBLEM, PROOF, stub
};
