/* Unit tests for ops/assets/pane-delivery.js, the Delivery tab of Aria AI.

   What is worth testing here is the set of rules in that file, nearly all of
   them rules about NOT drawing something, and none of which a screenshot or a
   headless-Chrome overflow check can see:

     - the bars and the by-job table are drawn only from a list that holds
       every run the summary counted, all of them inside one exact 24 hours,
       each with a finish time and a job type; anything less is words;
     - "Worked" is completed out of completed plus failed, and a cancelled run
       is neither, so the figure is not a measure of impatience;
     - last week's comparison is drawn only when both weeks reported every day,
       and otherwise says how many days were reported;
     - the cost is the month so far, falls back to the month before when the
       export has not published a day, and says "so far" while the month is
       open;
     - the cost block names the days the bill covers from the bill's own
       `actualThrough`, and says so, in the Money pane's words, when the
       bill's collector has failed or is off or its figures are old, because a
       `ready` bill can be the amounts of the last good poll and the page's
       "Updated" stamp is the summary's;
     - the review count is what is waiting, a floor when the queue was cut,
       and a queue nobody could read is a failed read and never "nothing";
     - each read fails and retries by itself, and an older answer that arrives
       after a newer ask draws nothing;
     - a role the queue route refuses never asks it.

   Every test here has a published mutation in the pull request: the exact
   file and the exact original line whose removal or inversion makes that
   test fail. A test with no such line is a test that pins nothing. */
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
const PANE_SRC = read('assets/pane-delivery.js');

const TOKENS = {
  '--cyan': '#00E5FF', '--violet': '#8B5CF6', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#F87171', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#F5F5F7',
};

/* ------------------------------------------------------------- fixtures */

/* Every fixture is a function that returns a fresh object, because every test
   below takes something away from a whole, healthy answer and a shared object
   would carry the removal into the next test. Dates are fixed: the pane reads
   every date from the answer and never from the clock. */
const MIN = 60000;
const HOUR = 60 * MIN;
const START = Date.parse('2026-10-31T09:41:00.000Z');
const END = START + 24 * HOUR;
const at = (ms) => new Date(ms).toISOString();

const edit = (make, over) => {
  const base = make();
  if (!over) return base;
  const out = over(base);
  return out === undefined ? base : out;
};

const KINDS = {
  plan: { value: 'nutrition_plan', label: 'Nutrition plan', labelled: true },
  photo: { value: 'meal_photo', label: 'Meal photo', labelled: true },
  video: { value: 'video_analysis', label: 'Sprint video analysis', labelled: true },
};

const run = (kind, outcome, offsetMs, n) => ({
  jobId: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'),
  type: { ...KINDS[kind] }, outcome, finishedAt: at(START + offsetMs),
});

/* Six runs: four worked, one failed, one cancelled. Offsets from the start of
   the window fall in bins 0, 0, 1, 6, 6 and 11 of twelve two-hour bins. */
function runsFixture(over) {
  return edit(() => ({
    window: { range: '24h', startAt: at(START), endExclusiveAt: at(END) },
    coverage: { state: 'ready', coversWindow: true },
    summary: {
      runs: 6, completed: 4, failed: 1, canceled: 1, unfinished: 0,
      duration: { p50Ms: 18000, measured: 6, total: 6 },
    },
    runs: [
      run('plan', 'completed', 30 * MIN, 1),
      run('plan', 'completed', 90 * MIN, 2),
      run('photo', 'failed', 3 * HOUR, 3),
      run('photo', 'completed', 12 * HOUR, 4),
      run('video', 'canceled', 13 * HOUR, 5),
      run('plan', 'completed', 23.5 * HOUR, 6),
    ],
    truncated: false,
  }), over);
}

function summaryFixture(over) {
  return edit(() => ({
    generatedAt: '2026-11-01T09:41:00.000Z',
    aiRuns: {
      availability: { state: 'ready' },
      runs: 4820, previous: { runs: 4410, daysReported: 7 },
      daysReported: 7, window: { days: 7 }, comparison: { days: 7 },
    },
  }), over);
}

/* The cost read is the one answer here with an age of its own, so it is the
   one that reads the clock: `asOf` is when the collector last succeeded. */
const hoursAgo = (n) => new Date(Date.now() - n * HOUR).toISOString();

function costsFixture(over) {
  return edit(() => ({
    availability: { state: 'ready' },
    currency: 'USD',
    asOf: hoursAgo(5),
    publishLagHours: 8,
    staleness: { state: 'ok' },
    period: { start: '2026-10-01T00:00:00.000Z', billedDays: 31, daysInPeriod: 31, actualThrough: '2026-10-31' },
    total: { micros: 3_100_000_000 },
    views: { category: { rows: [
      { key: 'compute', micros: 2_000_000_000 },
      { key: 'ai_and_models', micros: 807_700_000 },
    ] } },
  }), over);
}

const item = (n, status, statement) => ({
  reviewItemId: 'item-' + n, status,
  rubric: { statement: statement || 'Statement ' + n, authority: { domain: 'training' } },
});

function queueFixture(over) {
  return edit(() => ({
    items: [item(1, 'open'), item(2, 'disputed'), item(3, 'open'), item(4, 'open'), item(5, 'closed')],
    partial: false, omissions: [],
  }), over);
}

const ENDPOINTS = {
  summary: '/api/ops/summary',
  runs: '/api/ops/runs',
  costs: '/api/ops/costs',
  queue: '/api/ops/seval/admin/reviews/queue',
};

const boom = (message) => Object.assign(new Error(message || 'The server did not answer.'), { code: 'http_500' });

/* -------------------------------------------------------------- the page */

function buildPage(dom, body) {
  const el = (parent, tag, attrs = {}) => {
    const node = dom.element(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };
  body.setAttribute('data-pane', 'delivery');
  body.className = 'is-booting';
  const boot = el(body, 'main', { class: 'gate gate-boot gate-center' });
  el(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  el(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = el(body, 'div', { class: 'gate gate-app' });
  el(appGate, 'div', { id: 'app' });
}

const settle = async (n) => { for (let i = 0; i < (n || 12); i += 1) await new Promise((r) => setImmediate(r)); };

/* Loads the page the way ops/delivery.html loads it: registry, aria.js, the
   bootstrap, then the pane module. `options` replaces a read's answer by its
   short name; an Error rejects, and a function is asked with the query. The
   answer table is handed back live, and `held` makes a read wait to be let go
   with the answer it had when it was asked. */
async function boot(options) {
  const opts = options || {};
  const calls = [];
  const waiting = [];
  const held = new Set();
  const answers = {
    [ENDPOINTS.summary]: opts.summary === undefined ? summaryFixture() : opts.summary,
    [ENDPOINTS.runs]: opts.runs === undefined ? runsFixture() : opts.runs,
    [ENDPOINTS.costs]: opts.costs === undefined ? costsFixture() : opts.costs,
    [ENDPOINTS.queue]: opts.queue === undefined ? queueFixture() : opts.queue,
  };

  const dom = makeDom({ tokens: TOKENS, href: 'https://ops.example.invalid/ops/delivery.html' });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body);

  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: { admin: { displayName: 'Owner', email: 'owner@example.invalid', role: 'owner' } },
    boot: () => Promise.resolve({ admin: dom.window.OpsSession.state.admin }),
    call: (endpoint, o) => {
      const query = o && o.query;
      calls.push({ endpoint, query });
      let answer = answers[endpoint];
      if (typeof answer === 'function') answer = answer(query);
      const now = () => {
        if (answer instanceof Error) return Promise.reject(answer);
        if (answer === undefined) return Promise.reject(new Error('no stub for ' + endpoint));
        return Promise.resolve({ data: answer });
      };
      if (!held.has(endpoint)) return now();
      return new Promise((resolve, reject) => { waiting.push({ endpoint, send: () => now().then(resolve, reject) }); });
    },
    signOut: () => Promise.resolve(),
    role: () => (opts.role || 'owner'),
    hasRole: (roles) => (roles || []).includes(opts.role || 'owner'),
    daysLeft: () => 12,
  };

  vm.createContext(dom.window);
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  vm.runInContext(ARIA_SRC, dom.window, { filename: 'aria.js' });
  /* Which of the shell's four states the pane last asked for. */
  const states = [];
  const applyState = dom.window.Aria.applyState;
  dom.window.Aria.applyState = function (state) {
    states.push(String(state));
    return applyState.call(dom.window.Aria, state);
  };
  vm.runInContext(SHELL_SRC, dom.window, { filename: 'shell-pane-v2.js' });
  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-delivery.js' });
  await settle();

  const release = async (...indexes) => {
    const sending = indexes.map((i) => waiting[i]);
    sending.forEach((w) => w.send());
    await settle(20);
  };
  return Object.assign(dom, { calls, answers, held, waiting, release, states });
}

/* ------------------------------------------------------------- reading it */

const classesOf = (n) => String(n.getAttribute('class') || '').split(/\s+/).filter(Boolean);
const withClass = (root, cls) => findAll(root, (n) => classesOf(n).includes(cls));
const wordsOf = (root, cls) => withClass(root, cls).map(allText);
const section = (dom, id) => dom.doc.getElementById('dv-' + id);

/* The one panel the shell is showing: all three sit in #content at once and
   only data-shown says which the operator sees. */
function shownPanel(dom) {
  const boxes = dom.doc.getElementById('content').querySelectorAll('[data-state]')
    .filter((n) => n.getAttribute('data-shown') !== null);
  assert.equal(boxes.length, 1, `the shell has ${boxes.length} panels on screen at once`);
  return boxes[0];
}

const hasDigit = (text) => /\d/.test(text);
const retriesIn = (root) => findAll(root, (n) => n.getAttribute && n.getAttribute('data-retry') !== null);

async function press(dom, button) {
  button.focus();
  button.dispatchEvent({ type: 'click' });
  await settle(20);
}

const barsOf = (dom) => withClass(section(dom, 'chart'), 'dv-col').map((col) => ({
  count: allText(withClass(col, 'dv-val')[0]),
  height: (withClass(col, 'dv-col-bar')[0] || { style: {} }).style.height || null,
}));
const tableRows = (dom) => findAll(section(dom, 'byjob'), (n) => n.tagName === 'TR')
  .map((tr) => findAll(tr, (n) => n.tagName === 'TH' || n.tagName === 'TD').map(allText))
  .filter((cells) => cells[0] !== 'Job');

/* ============================== the reads ============================== */

test('the pane asks for the four reads it draws from, with the questions it means to ask', async () => {
  const dom = await boot();
  const asked = (endpoint) => dom.calls.filter((c) => c.endpoint === endpoint);

  assert.deepEqual([...new Set(dom.calls.map((c) => c.endpoint))].sort(), Object.values(ENDPOINTS).sort(),
    'Delivery should ask for exactly these four reads and no others');
  for (const endpoint of Object.values(ENDPOINTS)) {
    assert.equal(asked(endpoint).length, 1, endpoint + ' should be asked once on load');
  }
  assert.deepEqual({ ...asked(ENDPOINTS.runs)[0].query }, { range: '24h', limit: 200 });
  assert.deepEqual({ ...asked(ENDPOINTS.costs)[0].query }, { range: 'month' });
});

test('a role the review queue refuses never asks for it and draws no review section', async () => {
  const dom = await boot({ role: 'support' });
  assert.equal(dom.calls.filter((c) => c.endpoint === ENDPOINTS.queue).length, 0,
    'the queue was asked for by a role that may not read it');
  assert.equal(section(dom, 'review'), null, 'a review section was drawn for a role that may not read it');
  assert.ok(section(dom, 'byjob'), 'the rest of the page should still be drawn');
});

/* ============================ worked, and the day ======================= */

test('worked is completed over completed plus failed, and a cancellation is neither', async () => {
  const dom = await boot();
  assert.deepEqual(wordsOf(section(dom, 'worked'), 'num'), ['4 / 5']);
  const fill = withClass(section(dom, 'worked'), 'dv-fill')[0];
  assert.equal(fill.style.width, '80.00%', 'the bar is not worked over attempted');

  const noisy = await boot({ runs: runsFixture((r) => { r.summary.canceled = 40; r.summary.runs = 45; }) });
  assert.deepEqual(wordsOf(section(noisy, 'worked'), 'num'), ['4 / 5'],
    'cancellations moved the figure');
});

test('a day that cannot be read as the last 24 hours draws words and no figure or chart', async () => {
  const cases = [
    ['a 7-day window', (r) => { r.window.range = '7d'; }, 'Last 24h not reported'],
    ['coverage not ready', (r) => { r.coverage.state = 'partial'; }, 'Last 24h not fully recorded'],
    ['coverage short of the window', (r) => { r.coverage.coversWindow = false; }, 'Last 24h not fully recorded'],
    ['no completed count', (r) => { delete r.summary.completed; }, 'Last 24h not reported'],
    ['no failed count', (r) => { r.summary.failed = '1'; }, 'Last 24h not reported'],
  ];
  for (const [name, change, words] of cases) {
    const dom = await boot({ runs: runsFixture(change) });
    assert.deepEqual(wordsOf(section(dom, 'worked'), 'dv-words'), [words], name);
    assert.equal(withClass(section(dom, 'worked'), 'num').length, 0, name + ': a figure was drawn');
    assert.equal(withClass(dom.doc.getElementById('content'), 'dv-chart').length, 0, name + ': a chart was drawn');
    assert.equal(findAll(section(dom, 'byjob'), (n) => n.tagName === 'TABLE').length, 0, name + ': a table was drawn');
    assert.equal(allText(section(dom, 'stats')), '', name + ': a stat was drawn');
    assert.equal(allText(section(dom, 'worked')), 'Worked ' + words, name + ': something was drawn beside the words');
  }

  const quiet = await boot({ runs: runsFixture((r) => { r.summary.completed = 0; r.summary.failed = 0; r.summary.canceled = 6; }) });
  assert.deepEqual(wordsOf(section(quiet, 'worked'), 'dv-words'), ['No runs finished'],
    'a day with nothing worked or failed must not print 0 / 0');
});

/* =========================== the chart and the table ==================== */

test('the chart and the table are drawn only from a list that is the whole of the day', async () => {
  const cases = [
    ['a list cut at its limit', (r) => { r.truncated = true; }],
    ['a list that never said it was whole', (r) => { delete r.truncated; }],
    ['fewer rows than the summary counted', (r) => { r.summary.runs = 7; }],
    ['more rows than the summary counted', (r) => { r.summary.runs = 5; }],
    ['a run that finished before the window', (r) => { r.runs[0].finishedAt = at(START - MIN); }],
    ['a run that finished at the window end', (r) => { r.runs[0].finishedAt = at(END); }],
    ['a run with no finish time', (r) => { delete r.runs[0].finishedAt; }],
    ['a run with no job type', (r) => { r.runs[0].type = {}; }],
  ];
  for (const [name, change] of cases) {
    const dom = await boot({ runs: runsFixture(change) });
    assert.equal(withClass(dom.doc.getElementById('content'), 'dv-chart').length, 0, name + ': bars were drawn');
    assert.equal(findAll(section(dom, 'byjob'), (n) => n.tagName === 'TABLE').length, 0, name + ': a table was drawn');
    assert.deepEqual(wordsOf(section(dom, 'chart'), 'dv-words'), ['Not every job was listed'], name);
    assert.deepEqual(wordsOf(section(dom, 'byjob'), 'dv-words'), ['Not every job was listed'], name);
    /* The headline comes off the summary, which is whole, so it is still drawn. */
    assert.deepEqual(wordsOf(section(dom, 'worked'), 'num'), ['4 / 5'], name + ': the headline went too');
  }

  const skewed = await boot({ runs: runsFixture((r) => { r.window.endExclusiveAt = at(END + MIN); }) });
  assert.deepEqual(wordsOf(section(skewed, 'chart'), 'dv-words'), ['Last 24h not reported'],
    'a window that is not exactly a day was drawn as one');
});

test('every finished run lands in its own two hours, and the chart says so in its name', async () => {
  const dom = await boot();
  assert.deepEqual(barsOf(dom).map((b) => b.count), ['2', '1', '0', '0', '0', '0', '2', '0', '0', '0', '0', '1'],
    'a run was counted in the wrong two hours');
  assert.deepEqual(barsOf(dom).map((b) => b.height), ['50.00%', '25.00%', null, null, null, null, '50.00%', null, null, null, null, '25.00%'],
    'a bar of nothing was drawn, or a bar is not its count over the ceiling');

  const chart = withClass(section(dom, 'chart'), 'dv-chart')[0];
  assert.equal(chart.getAttribute('role'), 'img');
  const name = chart.getAttribute('aria-label');
  assert.match(name, /6 jobs in all/);
  assert.match(name, /09:41 2, 11:41 1, 13:41 0/, 'the data is not in the accessible name');
  assert.deepEqual(wordsOf(section(dom, 'chart'), 'dv-window'), ['Oct 31\u2013Nov 1 \u00b7 UTC']);
});

test('the by-job table lists each type busiest first, counts its failures, and drops a type that only cancelled', async () => {
  const dom = await boot();
  assert.deepEqual(tableRows(dom), [
    ['Nutrition plan', '3', '0'],
    ['Meal photo', '1', '1'],
  ]);
  const miss = withClass(section(dom, 'byjob'), 'dv-miss');
  assert.equal(miss.length, 1, 'a failure dot should be drawn for the one type that failed, and only it');
  assert.equal(withClass(section(dom, 'worked'), 'dv-miss').length, 1);
});

test('the typical time is read from the route and never made up', async () => {
  const dom = await boot();
  assert.deepEqual(wordsOf(section(dom, 'stats'), 'dv-stat-num'), ['18s', '1']);
  assert.deepEqual(wordsOf(section(dom, 'stats'), 'dv-stat-label'), ['Typical \u00b7 6 measured', 'Failed']);

  const unmeasured = await boot({ runs: runsFixture((r) => { r.summary.duration = { p50Ms: null, measured: 0, total: 6 }; }) });
  assert.deepEqual(wordsOf(section(unmeasured, 'stats'), 'dv-stat-label'), ['Typical time not measured', 'Failed']);
  assert.ok(!/\d+s/.test(allText(section(unmeasured, 'stats'))), 'a time was drawn that nothing measured');
});

/* ============================ activity and cost ========================= */

test('the change since last week is drawn only when both weeks reported every day', async () => {
  const note = (dom) => wordsOf(section(dom, 'activity'), 'dv-delta');
  assert.deepEqual(note(await boot()), ['+410 vs last week']);

  assert.deepEqual(note(await boot({ summary: summaryFixture((s) => { s.aiRuns.previous.runs = 4820; }) })), ['Same as last week']);
  assert.deepEqual(note(await boot({ summary: summaryFixture((s) => { s.aiRuns.previous.runs = 5000; }) })), ['\u2212180 vs last week']);

  assert.deepEqual(note(await boot({ summary: summaryFixture((s) => { s.aiRuns.previous.daysReported = 5; }) })), [],
    'a week with a gap was compared with a whole one');
  assert.deepEqual(note(await boot({ summary: summaryFixture((s) => { delete s.aiRuns.previous; }) })), []);
  assert.deepEqual(note(await boot({ summary: summaryFixture((s) => { s.aiRuns.comparison = {}; }) })), []);
  assert.deepEqual(note(await boot({ summary: summaryFixture((s) => { s.aiRuns.daysReported = 5; }) })), ['5 of 7 days reported'],
    'this week with a gap should say how many days it had');
});

test('an AI count the summary cannot give is words and never a zero', async () => {
  for (const state of ['not_reporting', 'not_collected', 'unconfigured']) {
    const dom = await boot({ summary: summaryFixture((s) => { s.aiRuns.availability.state = state; s.aiRuns.runs = 0; }) });
    const half = withClass(section(dom, 'activity'), 'dv-half')[0];
    assert.ok(!hasDigit(allText(half)), state + ': a number was drawn: ' + allText(half));
    assert.equal(withClass(half, 'dv-words').length, 1, state);
  }
});

test('cost is the month so far, falls back to last month, and never invents a figure', async () => {
  const cost = (dom) => withClass(section(dom, 'activity'), 'is-cost')[0];

  const open = await boot({ costs: costsFixture((c) => { c.period.billedDays = 12; delete c.period.actualThrough; }) });
  assert.deepEqual(wordsOf(cost(open), 'num'), ['$807.70']);
  assert.deepEqual(wordsOf(cost(open), 'dv-sub'), ['Cloud AI \u00b7 October so far'],
    'a bill that does not say how far it reaches falls back to its count of billed days');
  assert.deepEqual(wordsOf(cost(open), 'dv-included'), ['Included in $3,100 cloud total']);

  const whole = await boot();
  assert.deepEqual(wordsOf(cost(whole), 'dv-sub'), ['Cloud AI \u00b7 October'], '"so far" was printed for a month that has billed every day');

  const lastMonth = costsFixture((c) => { c.period.start = '2026-09-01T00:00:00.000Z'; });
  const fell = await boot({
    costs: (query) => (query.range === 'month' ? { availability: { state: 'not_published' } } : lastMonth),
  });
  assert.deepEqual(fell.calls.filter((c) => c.endpoint === ENDPOINTS.costs).map((c) => c.query.range), ['month', 'last-month']);
  assert.deepEqual(wordsOf(cost(fell), 'dv-sub'), ['Cloud AI \u00b7 September']);

  const asked = await boot();
  assert.deepEqual(asked.calls.filter((c) => c.endpoint === ENDPOINTS.costs).map((c) => c.query.range), ['month'],
    'a month that billed was asked for twice');

  const noAiLine = await boot({ costs: costsFixture((c) => { c.views.category.rows = [{ key: 'compute', micros: 1 }]; }) });
  assert.deepEqual(wordsOf(cost(noAiLine), 'dv-words'), ['No AI cost billed']);
  assert.equal(withClass(cost(noAiLine), 'num').length, 0);

  const none = await boot({ costs: { availability: { state: 'not_published' } } });
  assert.deepEqual(wordsOf(cost(none), 'dv-words'), ['Not published']);
  assert.ok(!hasDigit(allText(cost(none))), 'a figure was drawn for a bill that has not published');
});

/* The page's "Updated" stamp is the summary's. The bill is a different read
   from a different collector, and a `ready` bill can hold the amounts of the
   last good poll, so the block says what days it covers and when its own
   collector is failing, off or behind, in the words the Money pane uses. */
test('the cost block names the days the bill covers, from the bill and not from the clock', async () => {
  const cost = (dom) => withClass(section(dom, 'activity'), 'is-cost')[0];
  const sub = (dom) => wordsOf(cost(dom), 'dv-sub');
  const through = (day, over) => costsFixture((c) => {
    c.period.actualThrough = day;
    c.period.billedDays = Number(day.slice(-2));
    if (over) over(c);
  });

  assert.deepEqual(sub(await boot({ costs: through('2026-10-07') })), ['Cloud AI \u00b7 Oct 1\u20137'],
    'the covered window was not named');
  assert.deepEqual(sub(await boot({ costs: through('2026-10-01') })), ['Cloud AI \u00b7 Oct 1'],
    'one billed day is a day and not a range');
  assert.deepEqual(sub(await boot({ costs: through('2026-10-30') })), ['Cloud AI \u00b7 Oct 1\u201330'],
    'a month one day short of its end was called the month');
  assert.deepEqual(sub(await boot({ costs: through('2026-10-31') })), ['Cloud AI \u00b7 October']);
  assert.deepEqual(sub(await boot({ costs: through('2026-10-07T00:00:00.000Z') })), ['Cloud AI \u00b7 Oct 1\u20137'],
    'a full timestamp for the last day was read as another day');

  const empty = await boot({ costs: through('2026-10-07', (c) => { c.views.category.rows = [{ key: 'compute', micros: 1 }]; }) });
  assert.deepEqual(wordsOf(cost(empty), 'dv-words'), ['No AI cost billed']);
  assert.deepEqual(sub(empty), ['Oct 1\u20137'], 'a month with no AI line did not say which days it looked at');
});

const WORDS = {
  failed: 'Collection failing, showing the last good figures',
  unknown: 'Collection status unknown',
  disabled: 'Collection switched off',
  unconfigured: 'Collection not set up',
  other: 'Collection needs attention',
  none: 'No collection time'
};

test('a bill whose collector has failed or is off says so beside its amounts, in the Money pane\'s words', async () => {
  const cost = (dom) => withClass(section(dom, 'activity'), 'is-cost')[0];
  const notes = (dom) => wordsOf(cost(dom), 'dv-note');
  const stale = (staleness, over) => boot({ costs: costsFixture((c) => {
    c.staleness = staleness;
    c.period.actualThrough = '2026-10-07';
    if (over) over(c);
  }) });

  const cases = [
    [{ state: 'failed', detail: 'The last 3 cost collections failed.' }, 'The last 3 cost collections failed.'],
    [{ state: 'failed' }, WORDS.failed],
    [{ state: 'disabled' }, WORDS.disabled],
    [{ state: 'unconfigured' }, WORDS.unconfigured],
    [{ state: 'unknown' }, WORDS.unknown],
    [{ state: 'something_new' }, WORDS.other],
    [{ state: 'failed', detail: 'Ask ops@example.com' }, '[hidden contact detail]'],
  ];
  for (const [staleness, expected] of cases) {
    const dom = await boot({ costs: costsFixture((c) => { c.staleness = staleness; c.period.actualThrough = '2026-10-07'; }) });
    assert.deepEqual(wordsOf(cost(dom), 'num'), ['$807.70'], 'the retained amount is still shown');
    assert.deepEqual(wordsOf(cost(dom), 'dv-sub'), ['Cloud AI \u00b7 Oct 1\u20137'], expected + ': the covered days are named');
    assert.equal(notes(dom).length, 1, expected + ': ' + JSON.stringify(notes(dom)));
    assert.ok(notes(dom)[0].includes(expected), expected + ' is not in ' + notes(dom)[0]);
  }

  assert.deepEqual(notes(await stale({ state: 'ok' })), [], 'a collector doing its job is given no note');
  assert.deepEqual(notes(await boot({ costs: costsFixture((c) => { delete c.staleness; }) })), [],
    'a bill that says nothing about its collector was given a note');

  const empty = await stale({ state: 'failed' }, (c) => { c.views.category.rows = [{ key: 'compute', micros: 1 }]; });
  assert.deepEqual(notes(empty), [WORDS.failed],
    'a month with no AI line hid that its collector was failing');

  /* A failed collector on a bill that is not `ready` is said once. A collector
     that is off or not set up is already the words, and repeating them is noise. */
  const noBill = await boot({ costs: { availability: { state: 'unconfigured' }, staleness: { state: 'unconfigured' } } });
  assert.deepEqual(wordsOf(cost(noBill), 'dv-words'), ['Not set up']);
  assert.deepEqual(notes(noBill), [], 'the same fact was said twice');
  const stuck = await boot({ costs: { availability: { state: 'not_published' }, staleness: { state: 'failed' } } });
  assert.deepEqual(wordsOf(cost(stuck), 'dv-words'), ['Not published']);
  assert.deepEqual(notes(stuck), [WORDS.failed]);
  assert.ok(!hasDigit(allText(cost(stuck)).replace(/Collection.*/, '')), 'a figure was drawn for a bill that has not published');
});

test('the collector words are the ones the Money pane prints, read from its source', () => {
  const money = read('assets/pane-spend.js');
  for (const words of Object.values(WORDS)) {
    assert.ok(money.includes("'" + words + "'"), words + ' is not in the Money pane, so the two panes say it differently');
    assert.ok(PANE_SRC.includes("'" + words + "'"), words + ' is not in this pane');
  }
});

test('a bill is called behind once its own publishing cycle is missed twice over, and says when it has no time at all', async () => {
  const cost = (dom) => withClass(section(dom, 'activity'), 'is-cost')[0];
  const notes = (dom) => wordsOf(cost(dom), 'dv-note');
  const aged = (hours, over) => boot({ costs: costsFixture((c) => { c.asOf = hoursAgo(hours); if (over) over(c); }) });

  assert.deepEqual(notes(await aged(5)), [], 'a normal cycle says nothing');
  assert.deepEqual(notes(await aged(15)), [], 'one missed cycle is within the bill\'s own margin');
  const late = notes(await aged(40));
  assert.equal(late.length, 1);
  assert.match(late[0], /^4\d hours behind$/);

  assert.deepEqual(notes(await aged(40, (c) => { c.publishLagHours = 48; })), [],
    'the threshold is the bill\'s own lag doubled, not a constant in the pane');
  assert.match(notes(await aged(10, (c) => { c.publishLagHours = 4; }))[0], /^10 hours behind$/);
  assert.match(notes(await aged(17, (c) => { delete c.publishLagHours; }))[0], /^1[67] hours behind$/,
    'a bill that sends no lag is held to the pane\'s own eight hours');

  assert.deepEqual(notes(await boot({ costs: costsFixture((c) => { c.asOf = null; }) })), [WORDS.none],
    'a bill with no collection time said nothing about it');
  assert.deepEqual(notes(await boot({ costs: costsFixture((c) => { delete c.asOf; }) })), [WORDS.none]);

  /* Behind and failing are two facts, and both are said. */
  const both = await aged(40, (c) => { c.staleness = { state: 'failed' }; });
  assert.equal(notes(both).length, 2);
  assert.equal(notes(both)[0], WORDS.failed);
  assert.match(notes(both)[1], /behind$/);
});

/* ============================== human review ============================ */

test('review counts what is waiting, lists three, and says so when the count is a floor', async () => {
  const dom = await boot();
  const review = section(dom, 'review');
  assert.deepEqual(wordsOf(review, 'dv-count'), ['4 open'], 'a closed item was counted');
  assert.deepEqual(wordsOf(review, 'dv-review-name'), ['Statement 1', 'Statement 2', 'Statement 3']);
  assert.deepEqual(wordsOf(review, 'dv-review-meta'), ['Training', 'Training \u00b7 Reviewers disagree', 'Training']);
  assert.deepEqual(findAll(review, (n) => n.tagName === 'A').map(allText), ['Review', 'Review', 'Review', 'See all 4']);

  const four = await boot({ queue: queueFixture((q) => { q.items = q.items.slice(0, 3); }) });
  assert.equal(findAll(section(four, 'review'), (n) => n.tagName === 'A' && /See/.test(allText(n))).length, 0,
    'a link to the rest was drawn when there is no rest');

  const cut = await boot({ queue: queueFixture((q) => { q.partial = true; }) });
  assert.deepEqual(wordsOf(section(cut, 'review'), 'dv-count'), ['4+ open']);
  assert.deepEqual(findAll(section(cut, 'review'), (n) => n.tagName === 'A').map(allText).slice(-1), ['See all 4+']);

  const omitted = await boot({ queue: queueFixture((q) => { q.omissions = [{ source: 'labels' }]; }) });
  assert.deepEqual(wordsOf(section(omitted, 'review'), 'dv-count'), ['4+ open']);

  const capped = await boot({ queue: queueFixture((q) => { q.items = Array.from({ length: 200 }, (_, i) => item(i, 'open')); }) });
  assert.deepEqual(wordsOf(section(capped, 'review'), 'dv-count'), ['200+ open'],
    'a queue at the most the route sends was counted as if it were whole');
});

test('an empty queue says nothing is waiting only when the whole queue was read', async () => {
  const none = await boot({ queue: queueFixture((q) => { q.items = [item(1, 'closed')]; }) });
  assert.deepEqual(wordsOf(section(none, 'review'), 'dv-words'), ['Nothing waiting for review']);
  assert.equal(withClass(section(none, 'review'), 'dv-count').length, 0);

  const partial = await boot({ queue: queueFixture((q) => { q.items = []; q.partial = true; }) });
  assert.deepEqual(wordsOf(section(partial, 'review'), 'dv-words'), ['Review list not fully read'],
    '"nothing waiting" was claimed over a queue nobody finished reading');

  for (const bad of [{}, { items: 'none' }, { items: [null] }]) {
    const dom = await boot({ queue: bad });
    assert.equal(withClass(section(dom, 'review'), 'dv-words').length, 0, JSON.stringify(bad) + ': a claim was made over a list nobody could read');
    assert.equal(retriesIn(section(dom, 'review')).length, 1, JSON.stringify(bad) + ': a list that cannot be read has no retry');
  }
});

test('the doorways are links the browser can follow, to the panes that own them', async () => {
  const dom = await boot();
  const links = findAll(dom.doc.getElementById('content'), (n) => n.tagName === 'A' && n.getAttribute('class'));
  const target = (cls, text) => links.filter((n) => classesOf(n).includes(cls) && allText(n).startsWith(text)).map((n) => n.getAttribute('href'));
  assert.deepEqual(target('dv-link', 'Open run history'), ['run-history.html']);
  assert.ok(target('dv-link', 'Review').every((h) => h === 'review.html'));
  assert.ok(target('dv-link', 'See all').every((h) => h === 'review.html'));
  for (const link of links) assert.match(link.getAttribute('href'), /^[a-z0-9-]+\.html/, 'a doorway is not a relative page');
});

/* ======================= failure, retry and the race ==================== */

test('a read that fails fails its own section only, and its retry asks for that read alone', async () => {
  const dom = await boot({ summary: boom('summary down') });
  const activity = section(dom, 'activity');
  assert.equal(retriesIn(activity).length, 1);
  assert.match(allText(activity), /AI runs could not be read/);
  assert.deepEqual(wordsOf(section(dom, 'worked'), 'num'), ['4 / 5'], 'one failed read took another section with it');
  assert.equal(retriesIn(section(dom, 'worked')).length + retriesIn(section(dom, 'byjob')).length, 0);
  assert.equal(dom.states[dom.states.length - 1], 'degraded', 'a page with a read down was shown as whole');

  dom.answers[ENDPOINTS.summary] = summaryFixture();
  const before = dom.calls.length;
  await press(dom, retriesIn(activity)[0]);
  assert.deepEqual(dom.calls.slice(before).map((c) => c.endpoint), [ENDPOINTS.summary],
    'a retry asked for something it did not need to');
  assert.deepEqual(wordsOf(section(dom, 'activity'), 'num').slice(0, 1), ['4,820']);
  assert.equal(dom.states[dom.states.length - 1], 'live', 'the page stayed degraded after every read came back');
  assert.equal(dom.doc.activeElement, withClass(section(dom, 'activity'), 'dv-title')[0],
    'focus was lost when the button that held it was redrawn');
});

test('when every read fails the page says so once, with one way to ask again', async () => {
  const dom = await boot({ summary: boom('a'), runs: boom('b'), costs: boom('c'), queue: boom('d') });
  assert.equal(dom.states[dom.states.length - 1], 'degraded');
  assert.match(allText(shownPanel(dom)), /This pane could not be read/);
  assert.equal(findAll(shownPanel(dom), (n) => n.tagName === 'BUTTON' && allText(n) === 'Try again').length, 1);
});

test('an older answer to a read that was asked again draws nothing', async () => {
  const dom = await boot({ runs: boom('down') });
  dom.held.add(ENDPOINTS.runs);

  dom.answers[ENDPOINTS.runs] = runsFixture((r) => { r.summary.completed = 1; r.summary.runs = 2; r.runs = r.runs.slice(0, 2); });
  const stale = retriesIn(section(dom, 'worked'))[0];
  stale.focus();
  stale.dispatchEvent({ type: 'click' });
  await settle();

  dom.answers[ENDPOINTS.runs] = runsFixture();
  stale.dispatchEvent({ type: 'click' });
  await settle();
  assert.equal(dom.waiting.length, 2, 'both asks should be in flight');

  await dom.release(1);
  assert.deepEqual(wordsOf(section(dom, 'worked'), 'num'), ['4 / 5']);
  await dom.release(0);
  assert.deepEqual(wordsOf(section(dom, 'worked'), 'num'), ['4 / 5'], 'the older answer drew over the newer one');
});

test('a read that arrives for a page already read again draws nothing', async () => {
  const dom = await boot({ runs: boom('down'), summary: boom('down'), costs: boom('down'), queue: boom('down') });
  dom.held.add(ENDPOINTS.runs);
  dom.held.add(ENDPOINTS.summary);
  dom.held.add(ENDPOINTS.costs);
  dom.held.add(ENDPOINTS.queue);
  const whole = findAll(shownPanel(dom), (n) => n.tagName === 'BUTTON' && allText(n) === 'Try again')[0];
  dom.answers[ENDPOINTS.runs] = runsFixture((r) => { r.summary.completed = 1; r.summary.runs = 2; r.runs = r.runs.slice(0, 2); });
  dom.answers[ENDPOINTS.summary] = summaryFixture();
  dom.answers[ENDPOINTS.costs] = costsFixture();
  dom.answers[ENDPOINTS.queue] = queueFixture();
  whole.dispatchEvent({ type: 'click' });
  await settle();
  const firstLoad = dom.waiting.length;
  assert.equal(firstLoad, 4);

  dom.answers[ENDPOINTS.runs] = runsFixture();
  whole.dispatchEvent({ type: 'click' });
  await settle();
  assert.equal(dom.waiting.length, 8);

  await dom.release(4, 5, 6, 7);
  await dom.release(0, 1, 2, 3);
  assert.deepEqual(wordsOf(section(dom, 'worked'), 'num'), ['4 / 5'], 'the first load drew over the second');
});

/* ============================ the head ================================== */

test('the title carries the date and when the figures were read, in UTC', async () => {
  const dom = await boot();
  const slot = dom.doc.getElementById('pageSub');
  assert.ok(slot, 'the shell has no slot under the title');
  assert.deepEqual(wordsOf(slot, 'sub-date'), ['Sun, Nov 1, 2026']);
  assert.deepEqual(wordsOf(slot, 'sub-updated'), ['Updated 09:41 UTC']);
});

test('the title falls back to the day the runs closed, and says nothing when no read has a time', async () => {
  const runsOnly = await boot({ summary: boom('down') });
  assert.deepEqual(wordsOf(runsOnly.doc.getElementById('pageSub'), 'sub-updated'), ['Updated 09:41 UTC']);
  assert.deepEqual(wordsOf(runsOnly.doc.getElementById('pageSub'), 'sub-date'), ['Sun, Nov 1, 2026']);

  const neither = await boot({
    summary: summaryFixture((s) => { s.generatedAt = 'not a date'; }),
    runs: runsFixture((r) => { delete r.window.endExclusiveAt; }),
  });
  assert.equal(neither.doc.getElementById('pageSub').childNodes.length, 0, 'a stamp that cannot be read was printed');
});
