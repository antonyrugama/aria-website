/* Unit tests for ops/assets/pane-health.js, the Health page at ops/alerts.html.

   Like Today, almost everything worth pinning here is a rule about NOT drawing
   something, and none of it is visible to a screenshot:

     - a queued job has no progress, and a running job that has reported none
       has no bar: an empty bar reads as "just started";
     - a stuck or abandoned count is as wide as the read behind it, and a count
       nobody sent is a gap, never a zero;
     - typical time needs a measured base and says how big it is;
     - worked over attempted leaves cancellations out;
     - the Checks card counts checks that reached a verdict and never says
       "healthy"; the billing feed's stamp that could not be read says so;
     - a read that is down takes only its own card, and Try again re-reads only
       that read;
     - the Community safety queue is still drawn above everything, for the two
       roles that may act on it and for nobody else.

   The status line, the problem rows and the retry engine are
   assets/pane-status.js's and are covered where Today uses them
   (ops-overview-*); what is pinned here is that Health draws them from the same
   code, with the hour on the problem's date that Today leaves off.

   Every test here has a published mutation in the pull request: the exact file
   and the exact original line whose removal or inversion makes that test fail. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { makeDom, allText, findAll } from './ops-dom-harness.mjs';

const OPS = new URL('../ops/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, OPS), 'utf8');

const REGISTRY_SRC = read('assets/pane-registry.js');
const ARIA_SRC = read('assets/aria.js');
const SHELL_SRC = read('assets/shell-pane-v2.js');
const MODEL_SRC = read('assets/alerts-model.js');
const STATUS_SRC = read('assets/pane-status.js');
const PANE_SRC = read('assets/pane-health.js');
const UGC_SRC = read('assets/pane-ugc.js');

const TOKENS = {
  '--cyan': '#00E5FF', '--violet': '#8B5CF6', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#F87171', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#F5F5F7',
};

/* ------------------------------------------------------------- fixtures */

/* Functions that return a fresh object, because every test takes something away
   from a whole, healthy answer. Dates are fixed: the pane reads every date but
   the billing feed's age from the answer, never from the clock. */
const edit = (make, over) => {
  const base = make();
  if (!over) return base;
  const out = over(base);
  return out === undefined ? base : out;
};

const NOW_ISO = '2026-11-01T09:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const at = (hhmm, day = '2026-11-01') => day + 'T' + hhmm + ':00.000Z';
const hoursAgo = (n) => new Date(NOW_MS - n * 3600000).toISOString();

/* The page is read at NOW_ISO. The age of a check and of the billing feed is
   judged against the clock, so the clock the sources see stands still. */
class FrozenDate extends Date {
  constructor(...args) { if (args.length) super(...args); else super(NOW_MS); }
  static now() { return NOW_MS; }
}

function problemsFixture(rows) {
  const list = rows === undefined ? [{
    id: 'p1', reference: 'AO-131', severity: 'warning', status: 'acknowledged',
    title: 'Cloud costs up', detectedAt: '2026-10-31T07:40:00.000Z',
    acknowledgedAt: '2026-10-31T09:00:00.000Z', acknowledgedBy: 'adm_op',
    workPane: 'spend', workPaneLabel: 'Cloud spend',
  }] : rows;
  return { problems: list, total: list.length };
}

function rulesFixture(over) {
  return edit(() => ({
    rules: Array.from({ length: 9 }, (_, n) => ({
      ruleKey: 'check_' + n, title: 'Check ' + n, enabled: true, channels: ['teams'],
      lastEvaluatedAt: at('08:55'),
      lastEvaluationStatus: n < 7 ? 'ok' : 'insufficient_data',
      lastInsufficientReason: n < 7 ? null : 'below_minimum_samples',
    })),
    channels: [{ channel: 'teams', label: 'Teams', configured: true, lastDeliveryStatus: 'ok' }],
  }), over);
}

const job = (id, jobType, state, over) => Object.assign({
  id, jobType, state, lane: 'background', progress: 0, progressGrade: null,
  ageMs: 5000, queuedMs: state === 'queued' ? 5000 : 500, runningMs: state === 'queued' ? null : 5000,
}, over);

function jobsFixture(over) {
  return edit(() => ({
    generatedAt: NOW_ISO,
    recording: { state: 'recording', lastRecordedAt: at('08:58') },
    queue: {
      open: 3,
      byState: [{ state: 'queued', jobs: 1 }, { state: 'running', jobs: 2 }, { state: 'canceling', jobs: 0 }],
    },
    workingSet: {
      jobs: [
        job('j1', 'training_plan', 'running', { progress: 42, runningMs: 11000 }),
        job('j2', 'nutrition_plan', 'running', { progress: 71, runningMs: 8000 }),
        job('j3', 'meal_photo', 'queued', { queuedMs: 4000 }),
      ],
    },
    attention: { completeness: 'whole_queue', stuck: [], abandoned: [] },
  }), over);
}

const run = (id, label, outcome, finishedAt, durationMs) => ({
  jobId: id, type: { value: label.toLowerCase().replace(/ /g, '_'), label },
  outcome, outcomeLabel: outcome === 'completed' ? 'Worked' : 'Failed', durationMs, finishedAt,
});

function runsFixture(over) {
  return edit(() => ({
    window: { range: '24h', endExclusiveAt: NOW_ISO },
    coverage: { state: 'ready', coversWindow: true },
    summary: {
      runs: 25, completed: 24, failed: 1, canceled: 0, unfinished: 0,
      duration: { p50Ms: 18000, measured: 25, total: 25 },
    },
    runs: [
      run('r1', 'Training plan', 'completed', at('08:58'), 18000),
      run('r2', 'Nutrition plan', 'completed', at('08:54'), 14000),
      run('r3', 'Meal photo', 'failed', at('08:37'), 6000),
    ],
  }), over);
}

function costsFixture(over) {
  return edit(() => ({ asOf: hoursAgo(1), publishLagHours: 4 }), over);
}

const ENDPOINTS = {
  problems: '/api/ops/alerts/problems',
  rules: '/api/ops/alerts/rules',
  jobs: '/api/ops/jobs',
  runs: '/api/ops/runs',
  costs: '/api/ops/costs',
};

const NONE = '-';

const boom = (message) => Object.assign(new Error(message || 'The server did not answer.'), { code: 'http_500' });

/* -------------------------------------------------------------- the page */

function buildPage(dom, body) {
  const el = (parent, tag, attrs = {}) => {
    const node = dom.element(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };
  body.setAttribute('data-pane', 'alerts');
  body.className = 'is-booting';
  const boot = el(body, 'main', { class: 'gate gate-boot gate-center' });
  el(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  el(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = el(body, 'div', { class: 'gate gate-app' });
  el(appGate, 'div', { id: 'app' });
}

/* Loads the page the way ops/alerts.html loads it. `options` replaces a read's
   answer by its short name; an Error rejects and a function is asked with the
   query. `role` is the signed-in role, and `ugc` loads the Community safety
   script too. The answer table is handed back live. */
async function boot(options) {
  const opts = options || {};
  const calls = [];
  const answers = {
    [ENDPOINTS.problems]: opts.problems === undefined ? problemsFixture() : opts.problems,
    [ENDPOINTS.rules]: opts.rules === undefined ? rulesFixture() : opts.rules,
    [ENDPOINTS.jobs]: opts.jobs === undefined ? jobsFixture() : opts.jobs,
    [ENDPOINTS.runs]: opts.runs === undefined ? runsFixture() : opts.runs,
    [ENDPOINTS.costs]: opts.costs === undefined ? costsFixture() : opts.costs,
    '/api/ops/moderation/reports': { items: [], nextCursor: null },
  };
  const role = opts.role || 'owner';

  const dom = makeDom({ tokens: TOKENS, href: 'https://ops.example.invalid/ops/alerts.html' });
  dom.window.Date = FrozenDate;
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body);

  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: { admin: { displayName: 'Owner', email: 'owner@example.invalid', role } },
    boot: () => Promise.resolve({ admin: dom.window.OpsSession.state.admin }),
    call: (endpoint, o) => {
      const query = o && o.query;
      calls.push({ endpoint, query });
      let answer = answers[endpoint];
      if (typeof answer === 'function') answer = answer(query);
      if (answer instanceof Error) return Promise.reject(answer);
      if (answer === undefined) return Promise.reject(new Error('no stub for ' + endpoint));
      return Promise.resolve({ data: answer });
    },
    signOut: () => Promise.resolve(),
    role: () => role,
    hasRole: (roles) => !roles || !roles.length || roles.includes(role),
    daysLeft: () => 12,
  };

  vm.createContext(dom.window);
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  vm.runInContext(ARIA_SRC, dom.window, { filename: 'aria.js' });
  vm.runInContext(SHELL_SRC, dom.window, { filename: 'shell-pane-v2.js' });
  vm.runInContext(MODEL_SRC, dom.window, { filename: 'alerts-model.js' });
  vm.runInContext(STATUS_SRC, dom.window, { filename: 'pane-status.js' });
  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-health.js' });
  if (opts.ugc) vm.runInContext(UGC_SRC, dom.window, { filename: 'pane-ugc.js' });

  const settle = async (n = 12) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r)); };
  await settle();

  const repair = (key, value) => { answers[ENDPOINTS[key]] = value; };
  return Object.assign(dom, { calls, answers, settle, repair });
}

/* ------------------------------------------------------------ reading it */

const classesOf = (n) => String(n.getAttribute('class') || '').split(/\s+/).filter(Boolean);
const withClass = (root, cls) => findAll(root, (n) => classesOf(n).includes(cls));
const host = (dom, id) => dom.doc.getElementById('health-' + id);
const wordsOf = (root, cls) => withClass(root, cls).map(allText);
const one = (root, cls) => {
  const found = withClass(root, cls);
  assert.equal(found.length, 1, `expected exactly one .${cls}, found ${found.length}`);
  return found[0];
};
const asked = (dom, key) => dom.calls.filter((c) => c.endpoint === ENDPOINTS[key]);

/* Each row of the job table as [name, sub-word, percent, elapsed, state]. */
const jobRows = (dom) => withClass(host(dom, 'now'), 'job-line').map((row) => ({
  name: allText(one(row, 'job-type')),
  sub: withClass(row, 'job-sub').map(allText)[0] || null,
  bar: withClass(row, 'job-bar').length,
  pct: withClass(row, 'job-pct').map(allText)[0] || null,
  time: allText(one(row, 'job-time')),
  state: allText(one(row, 'job-state')),
}));

const counts = (dom) => Object.fromEntries(withClass(host(dom, 'now'), 'count').map((c) => [
  allText(one(c, 'count-l')), allText(one(c, 'count-n')),
]));

const checkRows = (dom) => Object.fromEntries(withClass(host(dom, 'checks'), 'chk-row').map((r) => [
  allText(one(r, 'chk-l')), allText(one(r, 'chk-v')),
]));
const checkRow = (dom, label) => withClass(host(dom, 'checks'), 'chk-row')
  .find((r) => allText(one(r, 'chk-l')) === label);

/* ============================== the reads ================================ */

test('the pane asks for the five reads it draws from, with the questions it means to ask', async () => {
  const dom = await boot();
  assert.deepEqual([...new Set(dom.calls.map((c) => c.endpoint))].sort(), Object.values(ENDPOINTS).sort(),
    'Health should ask for exactly these five reads');
  for (const key of Object.keys(ENDPOINTS)) assert.equal(asked(dom, key).length, 1, key + ' should be asked once on load');
  assert.deepEqual({ ...asked(dom, 'problems')[0].query }, { status: 'open', limit: dom.window.OpsAlertsModel.PAGE });
  assert.deepEqual({ ...asked(dom, 'runs')[0].query }, { range: '24h' });
  assert.deepEqual({ ...asked(dom, 'costs')[0].query }, { range: 'month' });
});

/* ============================== happening now ============================ */

test('a queued job has no progress, and a running job that reported none has no bar', async () => {
  const dom = await boot({
    jobs: jobsFixture((j) => {
      j.workingSet.jobs = [
        job('a', 'training_plan', 'running', { progress: 42 }),
        job('b', 'nutrition_plan', 'running', { progress: 0, progressGrade: 'unknown' }),
        job('c', 'meal_photo', 'queued', { progress: 30 }),
      ];
    }),
  });
  const [withBar, noProgress, queued] = jobRows(dom);
  assert.deepEqual([withBar.bar, withBar.pct], [1, '42%']);
  assert.deepEqual([noProgress.bar, noProgress.pct], [0, null], 'a running job that reported nothing drew a bar');
  assert.deepEqual([queued.bar, queued.pct, queued.state], [0, null, 'Queued'],
    'a queued job drew a bar or a percentage');
  assert.ok(!/\b0%/.test(allText(host(dom, 'now'))), 'a 0% is on screen');
});

test('the table lists running jobs first, longest first, then the queue, and stops at five', async () => {
  const dom = await boot({
    jobs: jobsFixture((j) => {
      j.queue = { open: 9, byState: [{ state: 'queued', jobs: 3 }, { state: 'running', jobs: 5 }, { state: 'canceling', jobs: 1 }] };
      j.workingSet.jobs = [
        job('q1', 'meal_photo', 'queued', { queuedMs: 9000 }),
        job('r1', 'training_plan', 'running', { progress: 10, runningMs: 3000 }),
        job('r2', 'nutrition_plan', 'running', { progress: 10, runningMs: 90000 }),
        job('c1', 'weekly_review', 'canceling', { runningMs: 40000 }),
        job('q2', 'sprint_scoring', 'queued', { queuedMs: 1000 }),
        job('r3', 'video_analysis', 'running', { progress: 10, runningMs: 20000 }),
      ];
    }),
  });
  assert.deepEqual(jobRows(dom).map((r) => r.name),
    ['Nutrition plan', 'Video analysis', 'Training plan', 'Weekly review', 'Meal photo']);
  const more = one(host(dom, 'now'), 'tile-more');
  assert.equal(allText(more), '+4 more', 'what the queue holds beyond the rows is counted from the queue, not the rows');
  assert.equal(more.getAttribute('href'), 'jobs-live.html');
});

test('a stuck or abandoned count is as wide as the read behind it', async () => {
  const of = async (attention) => counts(await boot({ jobs: jobsFixture((j) => { j.attention = attention; }) }));

  assert.deepEqual(await of({ completeness: 'whole_queue', stuck: [], abandoned: [] }),
    { running: '2', queued: '1', stuck: '0', abandoned: '0' });
  const bounded = await of({ completeness: 'working_set_only', stuck: [], abandoned: ['x', 'y', 'z'] });
  assert.equal(bounded.stuck, 'none seen', 'a bounded read that saw none claimed there are none');
  assert.equal(bounded.abandoned, '3+', 'a bounded count was printed as exact');
  const unread = await of({});
  assert.equal(unread.stuck, NONE, 'a completeness the route did not send was read as a zero');
  assert.equal(unread.abandoned, NONE);
});

test('a count the queue did not send is a gap, never a zero', async () => {
  const dom = await boot({ jobs: jobsFixture((j) => { j.queue = { open: 3, byState: [{ state: 'running', jobs: 2 }] }; }) });
  assert.equal(counts(dom).queued, NONE, 'a missing queued count was drawn as a number');
  assert.equal(counts(dom).running, '2');
});

test('the attention lists name the job as stuck or abandoned, from the lists the counters count', async () => {
  const dom = await boot({
    jobs: jobsFixture((j) => {
      j.workingSet.jobs = [
        job('s', 'training_plan', 'running', { progress: 10 }),
        job('a', 'nutrition_plan', 'running', { progress: 0 }),
        job('n', 'meal_photo', 'running', { progress: 10 }),
      ];
      j.attention = { completeness: 'whole_queue', stuck: ['s'], abandoned: ['a'] };
    }),
  });
  assert.deepEqual(jobRows(dom).map((r) => r.state), ['Stuck', 'Abandoned', 'Running']);
  assert.equal(counts(dom).stuck, '1');
  assert.equal(counts(dom).abandoned, '1');
});

/* ================================ last 24h =============================== */

test('worked over attempted leaves cancellations out and counts them beside it', async () => {
  const dom = await boot({ runs: runsFixture((r) => { r.summary.completed = 20; r.summary.failed = 2; r.summary.canceled = 5; }) });
  const day = host(dom, 'day');
  assert.equal(allText(one(day, 'day-big')), '20 / 22', 'a cancellation was counted as an attempt');
  assert.match(allText(one(day, 'day-foot')), /^5 cancelled/);
});

test('typical time needs a measured base, and says how large it is', async () => {
  const typical = async (duration) => {
    const dom = await boot({ runs: runsFixture((r) => { r.summary.duration = duration; }) });
    const found = withClass(host(dom, 'day'), 'is-typical');
    return found.length ? allText(found[0]) : null;
  };
  assert.match(await typical({ p50Ms: 18000, measured: 25, total: 25 }), /18s.*25 measured/);
  assert.match(await typical({ p50Ms: 18000, measured: 211, total: 214 }), /211 of 214 measured/);
  assert.equal(await typical({ p50Ms: 18000, measured: 0, total: 25 }), null, 'a typical time with nothing measured was printed');
  assert.equal(await typical({ p50Ms: null, measured: 25, total: 25 }), null, 'a typical time that was not sent was printed');
  assert.equal(await typical(null), null);
});

test('a day that was not fully recorded prints words and no numeral', async () => {
  for (const mutate of [
    (r) => { r.coverage = { state: 'partial', coversWindow: false }; },
    (r) => { r.coverage.coversWindow = false; },
    (r) => { r.window.range = '7d'; },
  ]) {
    const dom = await boot({ runs: runsFixture(mutate) });
    assert.equal(withClass(host(dom, 'day'), 'num').length, 0, 'a figure was drawn for a day that is not fully recorded');
    assert.match(allText(one(host(dom, 'day'), 'day-words')), /^Last 24h not (fully recorded|reported)$/);
  }
});

/* ================================= recent runs =========================== */

test('recent runs are newest first, five at most, and an undated run is not listed', async () => {
  const dom = await boot({
    runs: runsFixture((r) => {
      r.runs = [
        run('a', 'Oldest', 'completed', at('01:00'), 1000),
        run('b', 'Newest', 'failed', at('08:59'), 1000),
        Object.assign(run('c', 'Undated', 'completed', at('08:00'), 1000), { finishedAt: null }),
        run('d', 'Two', 'completed', at('07:00'), 1000),
        run('e', 'Three', 'completed', at('06:00'), 1000),
        run('f', 'Four', 'completed', at('05:00'), 1000),
        run('g', 'Five', 'completed', at('04:00'), 1000),
      ];
    }),
  });
  assert.deepEqual(wordsOf(host(dom, 'runs'), 'job-type'), ['Newest', 'Two', 'Three', 'Four', 'Five']);
  assert.deepEqual(wordsOf(host(dom, 'runs'), 'run-when').slice(0, 2), ['08:59', '07:00']);
});

test('a run from an earlier day carries its date, and a contact detail in a label is masked', async () => {
  const dom = await boot({
    runs: runsFixture((r) => {
      r.runs = [
        run('a', 'Plan for coach@example.invalid', 'completed', at('08:30'), 1000),
        run('b', 'Older', 'completed', at('23:10', '2026-10-31'), 1000),
      ];
    }),
  });
  assert.deepEqual(wordsOf(host(dom, 'runs'), 'run-when'), ['08:30', 'Oct 31, 23:10']);
  assert.ok(!allText(host(dom, 'runs')).includes('coach@example.invalid'), 'an address reached the screen');
});

test('a contact detail in a job type or an outcome label is masked', async () => {
  const dom = await boot({
    jobs: jobsFixture((j) => {
      j.workingSet.jobs = [job('a', 'plan_for_coach@example.invalid', 'running', { progress: 40 })];
    }),
    runs: runsFixture((r) => {
      r.runs = [Object.assign(run('a', 'Plan', 'failed', at('08:30'), 1000), { outcomeLabel: 'Failed for coach@example.invalid' })];
    }),
  });
  assert.ok(!allText(host(dom, 'now')).includes('coach@example.invalid'), 'an address reached Happening now');
  assert.ok(!allText(host(dom, 'runs')).includes('coach@example.invalid'), 'an address reached Recent runs');
  assert.match(allText(host(dom, 'now')), /\[hidden contact detail\]/);
  assert.match(allText(host(dom, 'runs')), /\[hidden contact detail\]/);
});

/* ================================== checks =============================== */

test('checks say how many reached a verdict and never call the system healthy', async () => {
  const dom = await boot();
  const card = host(dom, 'checks');
  assert.equal(allText(one(card, 'chk-big')), '7 of 9');
  assert.equal(allText(one(card, 'chk-words')), 'checks reporting');
  assert.deepEqual(wordsOf(card, 'chk-note'), ['2 without samples']);
  assert.ok(!/healthy|all good|ok\b/i.test(allText(card)), 'the card vouched for the system: ' + allText(card));

  const silent = await boot({
    rules: rulesFixture((r) => { r.rules[0].lastEvaluationStatus = 'error'; r.rules[0].lastEvaluatedAt = null; }),
  });
  assert.deepEqual(wordsOf(host(silent, 'checks'), 'chk-note'), ['2 without samples', '1 not reporting']);
  assert.equal(allText(one(host(silent, 'checks'), 'chk-big')), '6 of 9');
});

test('with no checks turned on the card says so and prints no fraction', async () => {
  const dom = await boot({ rules: rulesFixture((r) => { r.rules.forEach((x) => { x.enabled = false; }); }) });
  assert.equal(withClass(host(dom, 'checks'), 'chk-big').length, 0);
  assert.equal(allText(one(host(dom, 'checks'), 'day-words')), 'No checks turned on');
});

test('the billing feed is behind only past twice its own publish lag, and unreadable is said as unreadable', async () => {
  const feed = async (costs) => {
    const dom = await boot({ costs });
    const row = checkRow(dom, 'Billing feed');
    return { text: allText(one(row, 'chk-v')), dot: withClass(row, 'dot').map((d) => classesOf(d).find((c) => c.startsWith('is-'))) };
  };
  assert.deepEqual((await feed(costsFixture((c) => { c.asOf = hoursAgo(7); c.publishLagHours = 4; }))).dot, ['is-ok'],
    'a feed inside twice its lag was called behind');
  assert.deepEqual((await feed(costsFixture((c) => { c.asOf = hoursAgo(9); c.publishLagHours = 4; }))).dot, ['is-warn'],
    'a feed past twice its lag was called current');
  assert.deepEqual((await feed(costsFixture((c) => { c.asOf = hoursAgo(17); delete c.publishLagHours; }))).dot, ['is-warn'],
    'with no lag sent the feed falls back to eight hours');
  assert.equal((await feed(boom('down'))).text, 'Not read', 'a feed that could not be read looked like a stamp or like nothing');
  assert.equal((await feed(costsFixture((c) => { delete c.asOf; }))).text, NONE);
});

test('the billing feed failing does not degrade the page or take another card with it', async () => {
  const dom = await boot({ costs: boom('down') });
  assert.equal(withClass(host(dom, 'checks'), 'fail-line').length, 0, 'the stamp failed as a whole-card failure');
  assert.equal(allText(one(host(dom, 'checks'), 'chk-big')), '7 of 9');
  assert.equal(dom.doc.getElementById('content').querySelectorAll('[data-shown="degraded"]').length
    + withClass(dom.doc.getElementById('content'), 'is-degraded').length, 0, 'the page was degraded by a stamp');
});

test('the job recorder says when nothing was ever recorded, and the last stamp otherwise', async () => {
  const never = await boot({ jobs: jobsFixture((j) => { j.recording = { state: 'never_recorded', lastRecordedAt: null }; }) });
  assert.equal(allText(one(checkRow(never, 'Job recorder'), 'chk-v')), 'Never recorded');
  assert.ok(withClass(checkRow(never, 'Job recorder'), 'is-warn').length === 1, 'never recorded was drawn as fine');

  const ok = await boot();
  assert.equal(allText(one(checkRow(ok, 'Job recorder'), 'chk-v')), '08:58 UTC');
  assert.equal(allText(one(checkRow(ok, 'Last checked'), 'chk-v')), '08:55 UTC');
  assert.equal(withClass(checkRow(ok, 'Last checked'), 'dot').length, 0, 'a stamp of the last check carries a dot that says healthy');
});

/* =============================== failure and retry ======================= */

test('a read that is down takes only its own card, and Try again re-reads only that read', async () => {
  const dom = await boot({ runs: boom('runs down') });
  assert.equal(withClass(host(dom, 'day'), 'fail-line').length, 1, 'Last 24h did not say it could not be read');
  assert.equal(withClass(host(dom, 'runs'), 'fail-line').length, 1, 'Recent runs did not say it could not be read');
  assert.equal(withClass(host(dom, 'now'), 'fail-line').length, 0, 'a read that came back lost its card');
  assert.equal(allText(one(host(dom, 'checks'), 'chk-big')), '7 of 9');
  assert.equal(withClass(host(dom, 'day'), 'num').length, 0, 'a figure stands where the read failed');

  const before = dom.calls.length;
  dom.repair('runs', runsFixture());
  const button = findAll(host(dom, 'day'), (n) => n.tagName === 'BUTTON')[0];
  button.focus();
  button.dispatchEvent({ type: 'click' });
  await dom.settle(20);
  assert.deepEqual(dom.calls.slice(before).map((c) => c.endpoint), [ENDPOINTS.runs],
    'Try again asked for more than the read that failed');
  assert.equal(allText(one(host(dom, 'day'), 'day-big')), '24 / 25');
  assert.equal(withClass(host(dom, 'runs'), 'run-line').length, 3, 'the other card that read it was not redrawn');
});

test('Try again on Happening now re-reads only the jobs read', async () => {
  const dom = await boot({ jobs: boom('jobs down') });
  assert.equal(withClass(host(dom, 'now'), 'fail-line').length, 1, 'Happening now did not say it could not be read');
  const before = dom.calls.length;
  dom.repair('jobs', jobsFixture());
  const button = findAll(host(dom, 'now'), (n) => n.tagName === 'BUTTON')[0];
  button.focus();
  button.dispatchEvent({ type: 'click' });
  await dom.settle(20);
  assert.deepEqual(dom.calls.slice(before).map((c) => c.endpoint), [ENDPOINTS.jobs],
    'Try again asked for more than the read that failed');
  assert.equal(withClass(host(dom, 'now'), 'job-line').length, 3);
});

test('with every read down the page says so once instead of drawing four apologies', async () => {
  const dom = await boot({ problems: boom('a'), rules: boom('b'), jobs: boom('c'), runs: boom('d') });
  assert.equal(host(dom, 'now'), null, 'cards were drawn over a page nothing could be read for');
  assert.ok(findAll(dom.doc.getElementById('content'), (n) => n.tagName === 'BUTTON' && allText(n) === 'Try again').length >= 1);
});

/* ============================ the status line ============================ */

test('the problem row carries the hour on its date here, and an owner is never named', async () => {
  const dom = await boot({
    problems: problemsFixture([{
      id: 'p1', reference: 'AO-1', severity: 'critical', status: 'acknowledged',
      title: 'Generation queue is backing up', detectedAt: '2026-10-30T08:05:00.000Z',
      acknowledgedBy: 'adm_op', acknowledgedByEmail: 'anthony@ops.invalid',
    }]),
  });
  assert.equal(allText(one(host(dom, 'status'), 'health-text')), '1 critical issue');
  assert.equal(allText(one(host(dom, 'problems'), 'prob-since')), 'Since Oct 30, 08:05');
  assert.equal(allText(one(host(dom, 'problems'), 'prob-who')), 'Someone is on it');
  assert.ok(!/anthony|adm_op/i.test(allText(host(dom, 'problems'))), 'the person on a problem was named');

  const open = await boot({
    problems: problemsFixture([{ id: 'p2', severity: 'warning', status: 'open', title: 'B', acknowledgedBy: 'adm_op' }]),
  });
  assert.equal(allText(one(host(open, 'problems'), 'prob-who')), 'Nobody on it');
});

test('the status line prints the not-reporting note from the same checks the card counts', async () => {
  const dom = await boot();
  assert.equal(allText(one(host(dom, 'status'), 'health-text')), 'No critical issues');
  assert.deepEqual(wordsOf(host(dom, 'status'), 'health-note'), ['2 checks not reporting']);
  assert.equal(allText(one(host(dom, 'live'), 'live-text')), '2 running now', 'the pulse is not the running count');

  const stale = await boot({
    rules: rulesFixture((r) => { r.rules[0].lastEvaluatedAt = at('08:55', '2026-10-28'); }),
  });
  assert.deepEqual(wordsOf(host(stale, 'status'), 'health-note'), ['2 checks not reporting', '1 check stale']);
  assert.deepEqual(wordsOf(host(stale, 'checks'), 'chk-note'), ['2 without samples', '1 stale']);
});

test('the title carries the date and when the figures were read, from the read and not the clock', async () => {
  const dom = await boot();
  const slot = dom.doc.getElementById('pageSub');
  assert.ok(slot, 'the shell has no slot under the title');
  assert.deepEqual(wordsOf(slot, 'sub-date'), ['Sun, Nov 1, 2026']);
  assert.deepEqual(wordsOf(slot, 'sub-updated'), ['Updated 09:00 UTC']);

  const earlier = await boot({ jobs: jobsFixture((j) => { j.generatedAt = at('23:40', '2026-10-31'); }) });
  const earlierSlot = earlier.doc.getElementById('pageSub');
  assert.deepEqual(wordsOf(earlierSlot, 'sub-date'), ['Sat, Oct 31, 2026']);
  assert.deepEqual(wordsOf(earlierSlot, 'sub-updated'), ['Updated 23:40 UTC']);

  const fallback = await boot({
    jobs: boom('jobs down'),
    runs: runsFixture((r) => { r.window.endExclusiveAt = at('22:10', '2026-10-31'); }),
  });
  assert.deepEqual(wordsOf(fallback.doc.getElementById('pageSub'), 'sub-updated'), ['Updated 22:10 UTC']);
});

/* ======================= doorways and the safety queue =================== */

test('every doorway is a link to the page that owns the depth', async () => {
  const dom = await boot({
    jobs: jobsFixture((j) => { j.queue.open = 9; }),
    problems: problemsFixture([{ id: 'p', severity: 'critical', status: 'open', title: 'A', workPane: 'jobs-live' }]),
  });
  const hrefs = findAll(dom.doc.getElementById('content'), (n) => n.getAttribute && n.getAttribute('href') !== null)
    .map((n) => n.getAttribute('href'));
  for (const file of ['jobs-live.html', 'run-history.html', 'problems.html']) {
    assert.ok(hrefs.includes(file), 'no doorway into ' + file + ': ' + hrefs.join(', '));
  }
  for (const href of hrefs) assert.match(href, /^[a-z0-9-]+\.html/, 'a doorway that is not a relative page: ' + href);
  assert.equal(dom.doc.getElementById('subnav'), null, 'Health drew a sub-nav row; its cards are the way down');
});

test('the Community safety queue is drawn above the page for owners and operators, and for nobody else', async () => {
  for (const role of ['owner', 'operator']) {
    const dom = await boot({ ugc: true, role });
    const content = dom.doc.getElementById('content');
    const queue = withClass(content, 'ugc-queue');
    assert.equal(queue.length, 1, role + ' did not get the queue');
    assert.equal(content.firstChild, queue[0], 'the queue is not the first thing in the page');
    assert.ok(host(dom, 'status'), 'the queue replaced the page');
  }
  for (const role of ['viewer', 'analyst']) {
    const dom = await boot({ ugc: true, role });
    assert.equal(withClass(dom.doc.getElementById('content'), 'ugc-queue').length, 0, role + ' was shown the queue');
    assert.equal(asked(dom, 'problems').length, 1);
    assert.equal(dom.calls.filter((c) => c.endpoint === '/api/ops/moderation/reports').length, 0,
      role + ' asked for private reports');
  }
});
