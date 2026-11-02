/* Unit tests for ops/assets/pane-overview.js, the Today page.

   What is worth testing here is the set of rules in that file's docblock,
   nearly all of them rules about NOT drawing something, and none of which a
   screenshot or a headless-Chrome overflow check can see:

     - a block whose availability is not `ready` renders words and never a
       numeral, so "not connected" can never look like zero;
     - the two apps are never added together, and the change in people is an
       absolute difference, never a rate;
     - a day with no reading is a gap in the line, never a drop to zero;
     - "No critical issues" is a claim, printed only after a complete, readable
       problems result, and only when something was in a position to notice;
     - a moment in "This week" is earned by its own rule or it is not drawn,
       the strip draws only the tiles that were earned, and there is no paying
       tile at all;
     - the person on a problem is never named, because the session layer
       withholds the address and the pane must not rebuild a name from one.

   Plus the things that are easy to re-break by accident: the chart's accessible
   NAME has to carry the data, because role="img" is children-presentational;
   a severity that is the name of an object built-in must not put JavaScript on
   the screen; and every doorway has to point at the pane the registry says owns
   it.

   The retry, focus and announcement behaviour is ops-overview-retry-focus, the
   degraded and never-a-zero behaviour is ops-overview-degraded, and the
   whitespace-only and malformed strings are ops-overview-blank-text.

   Every test here has a published mutation in the pull request: the exact file
   and the exact original line whose removal or inversion makes that test fail.
   A test with no such line is a test that pins nothing. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { makeDom, allText, allDomTextAndAttrs, findAll } from './ops-dom-harness.mjs';

const OPS = new URL('../ops/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, OPS), 'utf8');

const REGISTRY_SRC = read('assets/pane-registry.js');
const ARIA_SRC = read('assets/aria.js');
const SHELL_SRC = read('assets/shell-pane-v2.js');
const MODEL_SRC = read('assets/alerts-model.js');
const PANE_SRC = read('assets/pane-overview.js');

const TOKENS = {
  '--cyan': '#00E5FF', '--violet': '#8B5CF6', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#F87171', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#F5F5F7',
};

/* ------------------------------------------------------------- fixtures */

/* Every fixture is a function that returns a fresh object, because every test
   below takes something away from a whole, healthy answer and a shared object
   would carry the removal into the next test. Dates are fixed: the pane reads
   every date from the answer and never from the clock, so a fixed date says
   the same thing every day it is run. */
const WEEK = {
  start: '2026-10-25T00:00:00.000Z', endExclusive: '2026-11-01T00:00:00.000Z', days: 7,
};

const MOBILE_DAILY = [12, 15, 14, 17, 16, 19, 18, 17, 20, 22, 19, 21, 23, 20, 22,
  25, 24, 22, 26, 27, 25, 24, 28, 30, 26, 29, 31, 28, 33, 37];
const COACHES_DAILY = [4, 5, 4, 6, 5, 7, 6, 5, 7, 8, 6, 7, 8, 6, 7,
  9, 8, 7, 8, 9, 7, 6, 8, 9, 7, 8, 9, 8, 7, 9];

const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();

const edit = (make, over) => {
  const base = make();
  if (!over) return base;
  const out = over(base);
  return out === undefined ? base : out;
};

function summaryFixture(over) {
  return edit(() => ({
    generatedAt: '2026-11-01T09:41:00.000Z',
    consent: { basis: 'operational' },
    people: {
      availability: { state: 'ready' },
      platform: { active: 1102, previousActive: 980 },
      apps: [
        { app: 'mobile', label: 'Mobile', active: 870, previousActive: 800 },
        { app: 'coaches', label: 'Coaches Web', active: 412, previousActive: 390 },
      ],
      window: WEEK,
      comparison: { days: 7, label: 'the 7 days before' },
      reportingFloor: 5,
      environment: 'production',
    },
    aiRuns: {
      availability: { state: 'ready' },
      runs: 4820, previous: { runs: 4410, daysReported: 7 },
      daysMissing: [], daysReported: 7, window: WEEK,
    },
  }), over);
}

function usageFixture(over) {
  return edit(() => ({
    window: {
      range: '30d', start: '2026-10-02T00:00:00.000Z', endExclusive: '2026-11-01T00:00:00.000Z',
      days: 30, grain: 'day', timezone: 'UTC', daysCovered: 30, daysMissingRollups: [],
    },
    availability: { state: 'ready', detail: '' },
    apps: [
      { app: 'mobile', label: 'Mobile', trend: { values: MOBILE_DAILY.slice() } },
      { app: 'coaches', label: 'Coaches Web', trend: { values: COACHES_DAILY.slice() } },
    ],
  }), over);
}

function problemsFixture(rows) {
  const list = rows === undefined ? [{
    id: 'p1', reference: 'PRB-104', severity: 'critical', status: 'open',
    title: 'Generation queue is backing up',
    summary: 'Nothing has drained for 40 minutes.',
    detectedAt: '2026-10-30T08:00:00.000Z',
    workPane: 'jobs-live', workPaneLabel: 'Happening now',
  }] : rows;
  return { problems: list, total: list.length };
}

function rulesFixture(over) {
  return edit(() => ({
    rules: [
      { key: 'queue', label: 'Queue depth', enabled: true, lastEvaluatedAt: minutesAgo(5), lastEvaluationStatus: 'ok', lastFiredAt: null },
      { key: 'errors', label: 'Error rate', enabled: true, lastEvaluatedAt: minutesAgo(5), lastEvaluationStatus: 'ok', lastFiredAt: null },
    ],
    channels: [{ key: 'teams', label: 'Teams', configured: true, status: 'ok' }],
  }), over);
}

function jobsFixture(over) {
  return edit(() => ({
    generatedAt: '2026-11-01T09:40:00.000Z',
    queue: {
      open: 19,
      byState: [{ state: 'running', jobs: 6 }, { state: 'queued', jobs: 13 }],
    },
    attention: { completeness: 'whole_queue', stuck: [] },
  }), over);
}

function runsFixture(over) {
  return edit(() => ({
    window: { range: '24h' },
    coverage: { state: 'ready', coversWindow: true },
    summary: { runs: 26, completed: 24, failed: 1, canceled: 1, unfinished: 0 },
  }), over);
}

function costsFixture(over) {
  return edit(() => ({
    availability: { state: 'ready' },
    currency: 'USD',
    period: {
      start: '2026-10-01T00:00:00.000Z', actualThrough: '2026-10-31T00:00:00.000Z',
      billedDays: 31,
    },
    total: { micros: 3_100_000_000 },
    daily: {
      series: [{ values: Array.from({ length: 31 }, (_, i) => (85 + i) * 1_000_000) }],
    },
  }), over);
}

const ENDPOINTS = {
  summary: '/api/ops/summary',
  usage: '/api/ops/usage',
  problems: '/api/ops/alerts/problems',
  rules: '/api/ops/alerts/rules',
  jobs: '/api/ops/jobs',
  runs: '/api/ops/runs',
  costs: '/api/ops/costs',
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
  body.setAttribute('data-pane', 'overview');
  body.className = 'is-booting';
  const boot = el(body, 'main', { class: 'gate gate-boot gate-center' });
  el(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  el(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = el(body, 'div', { class: 'gate gate-app' });
  el(appGate, 'div', { id: 'app' });
}

/* Loads the page the way ops/index.html loads it: registry, aria.js, the
   bootstrap, the alerts model, then the pane module. `options` replaces a
   read's answer by its short name; an Error rejects, and a function is asked
   with the query so one endpoint can answer two ranges differently. The answer
   table is handed back live. */
async function boot(options) {
  const opts = options || {};
  const calls = [];
  const answers = {
    [ENDPOINTS.summary]: opts.summary === undefined ? summaryFixture() : opts.summary,
    [ENDPOINTS.usage]: opts.usage === undefined ? usageFixture() : opts.usage,
    [ENDPOINTS.problems]: opts.problems === undefined ? problemsFixture() : opts.problems,
    [ENDPOINTS.rules]: opts.rules === undefined ? rulesFixture() : opts.rules,
    [ENDPOINTS.jobs]: opts.jobs === undefined ? jobsFixture() : opts.jobs,
    [ENDPOINTS.runs]: opts.runs === undefined ? runsFixture() : opts.runs,
    [ENDPOINTS.costs]: opts.costs === undefined ? costsFixture() : opts.costs,
  };

  const dom = makeDom({ tokens: TOKENS, href: 'https://ops.example.invalid/ops/index.html' });
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
      if (answer instanceof Error) return Promise.reject(answer);
      if (answer === undefined) return Promise.reject(new Error('no stub for ' + endpoint));
      return Promise.resolve({ data: answer });
    },
    signOut: () => Promise.resolve(),
    role: () => 'owner',
    hasRole: () => true,
    daysLeft: () => 12,
  };

  vm.createContext(dom.window);
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  vm.runInContext(ARIA_SRC, dom.window, { filename: 'aria.js' });
  vm.runInContext(SHELL_SRC, dom.window, { filename: 'shell-pane-v2.js' });
  vm.runInContext(MODEL_SRC, dom.window, { filename: 'alerts-model.js' });
  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-overview.js' });

  for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r));

  return Object.assign(dom, { calls, answers });
}

/* ------------------------------------------------------------- reading it */

const classesOf = (n) => String(n.getAttribute('class') || '').split(/\s+/).filter(Boolean);
const withClass = (root, cls) => findAll(root, (n) => classesOf(n).includes(cls));
const section = (dom, id) => dom.doc.getElementById('today-' + id);
const wordsOf = (root, cls) => withClass(root, cls).map(allText);
const one = (root, cls) => {
  const found = withClass(root, cls);
  assert.equal(found.length, 1, `expected exactly one .${cls}, found ${found.length}`);
  return found[0];
};
const hasDigit = (text) => /\d/.test(text);
const FN_TEXT = /function|=>|\[native code\]|\bObject\b/;

const healthText = (dom) => allText(one(section(dom, 'health'), 'health-text'));
const healthTone = (dom) => {
  const dot = withClass(section(dom, 'health'), 'dot')[0];
  return dot ? classesOf(dot).find((c) => c.startsWith('is-')) : null;
};

/* The two lines under the title of a moment, by label. */
const moments = (dom) => withClass(section(dom, 'moments'), 'moment').map((m) => ({
  value: allText(one(m, 'moment-value')),
  label: allText(one(m, 'moment-label')),
  sub: allText(one(m, 'moment-sub')),
  tone: classesOf(m).find((c) => c.startsWith('is-')),
}));

const lines = (dom) => withClass(section(dom, 'charts'), 'tc-line');

/* =========================== the problems read ========================== */

test('the pane asks for the seven reads it draws from, with the questions it means to ask', async () => {
  const dom = await boot();
  const asked = (endpoint) => dom.calls.filter((c) => c.endpoint === endpoint);

  assert.deepEqual(Object.values(ENDPOINTS).sort(), [...new Set(dom.calls.map((c) => c.endpoint))].sort(),
    'Today should ask for exactly these seven reads and no others');
  for (const endpoint of Object.values(ENDPOINTS)) {
    assert.equal(asked(endpoint).length, 1, endpoint + ' should be asked once on load');
  }

  const q = (endpoint) => asked(endpoint)[0].query || {};
  assert.deepEqual({ ...q(ENDPOINTS.usage) }, { scope: 'all', range: '30d', env: 'production' });
  assert.deepEqual({ ...q(ENDPOINTS.problems) }, { status: 'open', limit: dom.window.OpsAlertsModel.PAGE });
  assert.deepEqual({ ...q(ENDPOINTS.runs) }, { range: '24h' });
  assert.deepEqual({ ...q(ENDPOINTS.costs) }, { range: 'month' });
});

test('the first of a month falls back to the month before, and only then', async () => {
  const published = await boot({
    costs: (query) => costsFixture(),
  });
  assert.deepEqual(published.calls.filter((c) => c.endpoint === ENDPOINTS.costs).map((c) => c.query.range),
    ['month'], 'a month that has billed a day is the answer');

  const lastMonth = costsFixture((c) => { c.period.billedDays = 30; c.total.micros = 3_000_000_000; });
  const dom = await boot({
    costs: (query) => (query.range === 'month'
      ? { availability: { state: 'not_published', detail: 'Not yet.' } }
      : lastMonth),
  });
  assert.deepEqual(dom.calls.filter((c) => c.endpoint === ENDPOINTS.costs).map((c) => c.query.range),
    ['month', 'last-month']);
  assert.match(allText(section(dom, 'spend')), /\$114\.00/,
    'the closing day of the month before is the latest billed day, and is drawn');
});

/* ============================== the people ============================== */

test('the headline people figure is the platform count, not the two apps added up', async () => {
  const dom = await boot();
  const people = section(dom, 'people');
  assert.equal(allText(one(people, 'big')), '1,102');
  assert.notEqual(allText(one(people, 'big')), '1,282', 'the apps were added together');

  const split = withClass(people, 'split-item').map((n) => [
    allText(one(n, 'split-label')), allText(one(n, 'split-value'))]);
  assert.deepEqual(split, [['Mobile', '870'], ['Coaches Web', '412']],
    'each app is drawn beside the headline with its own count');
});

for (const [state, words] of [
  ['not_reporting', 'No reading'], ['not_collected', 'Not collected'],
  ['insufficient', 'Too few to report'], ['unconfigured', 'Not set up'],
  ['disabled', 'Switched off'], ['something_new', 'Not reported'],
]) {
  test('a people block that is ' + state + ' prints words and no numeral', async () => {
    const dom = await boot({
      summary: summaryFixture((s) => { s.people.availability = { state }; }),
    });
    const people = section(dom, 'people');
    assert.equal(withClass(people, 'num').length, 0, 'a figure is drawn for a block that is not ready');
    assert.equal(allText(one(people, 'big')), words);
    assert.ok(!hasDigit(allText(one(people, 'big'))), 'a numeral beside "' + words + '"');
    assert.equal(withClass(people, 'delta').length, 0, 'a change is drawn against a figure that is not drawn');
    assert.equal(withClass(people, 'split-item').length, 0, 'an app count is drawn for a block that is not ready');
  });
}

test('a state that is not ready prints words even when a figure came with it', async () => {
  const dom = await boot({
    summary: summaryFixture((s) => { s.people.availability = { state: 'insufficient', detail: 'Fewer than 5 people.' }; }),
  });
  const people = section(dom, 'people');
  assert.equal(allText(one(people, 'big')), 'Too few to report');
  assert.ok(!allText(people).includes('1,102'), 'the figure that came with the block is on screen');
  assert.equal(allText(one(people, 'hp-note')), 'Fewer than 5 people.', 'the reason in the answer is said');
});

test('a ready block with no figure says so rather than printing zero', async () => {
  for (const platform of [undefined, {}, { active: null }, { active: '1,102' }, { active: NaN }]) {
    const dom = await boot({
      summary: summaryFixture((s) => { s.people.platform = platform; }),
    });
    const big = one(section(dom, 'people'), 'big');
    assert.ok(classesOf(big).includes('words'), 'a figure that did not arrive is drawn as a number: ' + JSON.stringify(platform));
    assert.ok(!hasDigit(allText(big)), 'a numeral where there is no figure: ' + allText(big));
  }
});

test('the change in people is a difference of people, and absence is shown as absence', async () => {
  const delta = async (mutate) => {
    const dom = await boot({ summary: summaryFixture(mutate) });
    const node = one(section(dom, 'people'), 'delta');
    return { text: allText(node), classes: classesOf(node) };
  };

  const up = await delta();
  assert.equal(up.text, '+122 vs last week');
  assert.ok(up.classes.includes('is-up'));

  const down = await delta((s) => { s.people.platform.previousActive = 1200; });
  assert.equal(down.text, '\u2212' + '98 vs last week', 'a fall uses a true minus sign and the size of the fall');
  assert.ok(down.classes.includes('is-down'));

  const flat = await delta((s) => { s.people.platform.previousActive = 1102; });
  assert.equal(flat.text, 'No change vs last week');
  assert.ok(flat.classes.includes('is-flat'));

  const longer = await delta((s) => { s.people.comparison.days = 14; });
  assert.equal(longer.text, '+122 vs the 14 days before', 'the comparison names the window the answer used');

  for (const strip of [
    (s) => { delete s.people.platform.previousActive; },
    (s) => { s.people.platform.previousActive = null; },
    (s) => { delete s.people.comparison; },
  ]) {
    const absent = await delta(strip);
    assert.equal(absent.text, 'No comparison yet');
    assert.ok(absent.classes.includes('is-none'));
    assert.ok(!/no change|\+0|0 vs/i.test(absent.text), 'an absent comparison read as no change');
  }
});

test('the window under the figure is the one the answer covered, written as a range of days', async () => {
  const range = async (mutate) => {
    const dom = await boot({ summary: summaryFixture(mutate) });
    const found = withClass(section(dom, 'people'), 'hp-range');
    return found.length ? allText(found[0]) : null;
  };
  assert.equal(await range(), 'Oct 25\u201331');
  assert.equal(await range((s) => {
    s.people.window = { start: '2026-10-28T00:00:00.000Z', endExclusive: '2026-11-04T00:00:00.000Z', days: 7 };
  }), 'Oct 28\u2013Nov 3', 'a week that crosses a month names both months');
  assert.equal(await range((s) => { s.people.window = { days: 14 }; }), 'Last 14 days',
    'a window with no dates is named by its length and nothing is guessed');
  assert.equal(await range((s) => { s.people.window = { days: 1 }; }), 'Last 1 day');
  assert.equal(await range((s) => { s.people.window = {}; }), null,
    'a window the answer does not describe is not described');
  assert.equal(await range((s) => {
    s.people.window = { start: '2026-11-01T00:00:00.000Z', endExclusive: '2026-10-25T00:00:00.000Z', days: 7 };
  }), 'Last 7 days', 'a window that ends before it starts is not printed as a range');
});

/* =============================== the charts ============================= */

test('the daily chart is one line per app and never a combined one', async () => {
  const dom = await boot();
  const charts = section(dom, 'charts');
  assert.deepEqual(wordsOf(charts, 'chart-title'), ['Mobile daily', 'Coaches Web daily']);
  assert.equal(withClass(charts, 'chart-block').length, 2);
  assert.equal(withClass(charts, 'tchart').length, 2, 'each app is its own chart');
  assert.equal(lines(dom).length, 2, 'each chart draws one line when no day is missing');
  assert.ok(!/total|combined|all apps|both/i.test(allText(charts)), 'a combined series is named');
});

test('only the first chart carries a legend and the dashed week before it', async () => {
  const dom = await boot();
  const [lead, other] = withClass(section(dom, 'charts'), 'chart-block');
  assert.equal(withClass(lead, 'tc-legend').length, 1);
  assert.deepEqual(wordsOf(lead, 'tc-key'), ['This week', 'Last week']);
  assert.equal(withClass(lead, 'tc-ghost').length, 1, 'the lead chart draws last week behind this one');
  assert.equal(withClass(other, 'tc-legend').length, 0);
  assert.equal(withClass(other, 'tc-ghost').length, 0, 'a second chart is not drawn against a ghost');
});

test('a week that mostly did not report is not drawn as a comparison', async () => {
  const dom = await boot({
    usage: usageFixture((u) => {
      const values = MOBILE_DAILY.slice();
      for (let i = 16; i < 21; i += 1) values[i] = null; // five of the seven days before
      u.apps[0].trend.values = values;
    }),
  });
  const lead = withClass(section(dom, 'charts'), 'chart-block')[0];
  assert.equal(withClass(lead, 'tc-ghost').length, 0, 'a dashed line through a week that is mostly gaps');
  assert.deepEqual(wordsOf(lead, 'tc-key'), ['This week'], 'the legend names a line that is not drawn');
});

test('the chart carries its data in the accessible name, not only in the drawing', async () => {
  const dom = await boot();
  const [lead, other] = withClass(section(dom, 'charts'), 'tchart');
  assert.equal(lead.getAttribute('role'), 'img');
  assert.equal(lead.getAttribute('aria-label'),
    'Mobile daily active people, this week: 7 of 7 days with a reading, low 26, high 37, ending 37 on Oct 31.' +
    ' the week before, dashed: 7 of 7 days with a reading, low 22, high 28, ending 28 on Oct 24.');
  assert.equal(other.getAttribute('aria-label'),
    'Coaches Web daily active people, this week: 7 of 7 days with a reading, low 7, high 9, ending 9 on Oct 31.');
  /* The drawing inside is not announced; the name is the only place the data
     is spoken. */
  const svgs = findAll(lead, (n) => n.tagName === 'svg');
  assert.ok(svgs.length && svgs.every((s) => s.getAttribute('aria-hidden') === 'true'));
});

test('a day with no stored reading breaks the line rather than joining across it', async () => {
  const dom = await boot({
    usage: usageFixture((u) => {
      const values = MOBILE_DAILY.slice();
      values[26] = null;
      u.apps[0].trend.values = values;
    }),
  });
  const [lead] = withClass(section(dom, 'charts'), 'chart-block');
  const traced = withClass(lead, 'tc-line').map((p) => p.getAttribute('d'));
  assert.equal(traced.length, 2, 'one line was drawn across a day with no reading');
  assert.ok(traced.every((d) => (d.match(/M/g) || []).length === 1), 'a path restarts inside itself');

  const name = one(lead, 'tchart').getAttribute('aria-label');
  assert.match(name, /this week: 6 of 7 days with a reading/);
});

test('a reported zero stays a zero on the line, and no reading is not one', async () => {
  const zero = await boot({
    usage: usageFixture((u) => {
      const values = MOBILE_DAILY.slice();
      values[27] = 0;
      u.apps[0].trend.values = values;
    }),
  });
  const [lead] = withClass(section(zero, 'charts'), 'chart-block');
  assert.equal(withClass(lead, 'tc-line').length, 1, 'a reported zero breaks the line');
  assert.ok(wordsOf(lead, 'tc-val').includes('0'), 'a reported zero has no value on the chart');
  assert.match(one(lead, 'tchart').getAttribute('aria-label'), /7 of 7 days with a reading, low 0, high 37/);

  const none = await boot({
    usage: usageFixture((u) => {
      u.apps[0].trend.values = MOBILE_DAILY.map((v, i) => (i >= 23 ? null : v));
    }),
  });
  const [bare] = withClass(section(none, 'charts'), 'chart-block');
  assert.equal(withClass(bare, 'tc-line').length, 0);
  assert.match(one(bare, 'tchart').getAttribute('aria-label'), /this week: no reading on any of 7 days\./);
  assert.ok(!wordsOf(bare, 'tc-val').includes('0'), 'a week with no reading is drawn as a zero');
});

test('the chart is labelled with the dates of the days it draws', async () => {
  const dom = await boot();
  const [lead] = withClass(section(dom, 'charts'), 'chart-block');
  assert.deepEqual(wordsOf(lead, 'tc-x'), ['Oct 25', 'Oct 28', 'Oct 31']);
  assert.deepEqual(wordsOf(lead, 'tc-y'), ['38', '19', '0'],
    'the ceiling is an even number just over the peak, and the floor is zero');
  assert.deepEqual(wordsOf(lead, 'tc-val').slice(-1), ['37'], 'the last reading is labelled');
});

for (const state of ['not_reporting', 'insufficient', 'unconfigured', 'not_something']) {
  test('daily lines that are ' + state + ' print words and draw no chart', async () => {
    const dom = await boot({
      usage: usageFixture((u) => { u.availability = { state, detail: 'Nothing to chart yet.' }; }),
    });
    const charts = section(dom, 'charts');
    assert.equal(withClass(charts, 'tchart').length, 0);
    assert.ok(!hasDigit(allText(one(charts, 'big'))));
    assert.equal(allText(one(charts, 'hp-note')), 'Nothing to chart yet.');
  });
}

/* ============================== the moments ============================= */

test('the best mobile day is earned by a strict maximum over a fortnight with no missing rollup', async () => {
  const dom = await boot({ summary: summaryFixture((s) => { s.aiRuns.runs = 1; }) });
  assert.deepEqual(moments(dom), [
    { value: '37', label: 'Best Mobile day', sub: 'in 30 days', tone: 'is-cyan' },
  ]);

  const none = async (mutate, why) => {
    const d = await boot({
      summary: summaryFixture((s) => { s.aiRuns.runs = 1; }),
      usage: usageFixture(mutate),
    });
    assert.deepEqual(moments(d), [], why);
    assert.equal(withClass(section(d, 'moments'), 'sec-label').length, 0, 'the label is drawn over nothing: ' + why);
  };
  await none((u) => { u.apps[0].trend.values[28] = 37; }, 'a tie is not a best day');
  await none((u) => { u.apps[0].trend.values[10] = 40; }, 'an earlier higher day is not beaten');
  await none((u) => { u.window.daysCovered = 13; }, 'less than a fortnight says nothing about a best');
  await none((u) => { u.window.daysMissingRollups = ['2026-10-12']; }, 'a day with no rollup could have been higher');
  await none((u) => { delete u.window.daysMissingRollups; }, 'a window that does not say which rollups are missing');
  await none((u) => { u.availability = { state: 'insufficient' }; }, 'usage that is not ready');
  await none((u) => { u.apps[0].trend.values[29] = null; }, 'a latest day with no reading');
  await none((u) => { u.apps = u.apps.slice(1); }, 'a mobile line that did not arrive');
  await none((u) => { u.apps[0].trend.values = u.apps[0].trend.values.slice(-13); }, 'a line shorter than the fortnight');
});

test('a null day among the earlier ones does not stop the best day being earned', async () => {
  const dom = await boot({
    summary: summaryFixture((s) => { s.aiRuns.runs = 1; }),
    usage: usageFixture((u) => { u.apps[0].trend.values[5] = null; }),
  });
  assert.equal(moments(dom).length, 1, 'a gap was read as a day that beat the latest');
});

test('the best day is named for the line that earned it', async () => {
  const dom = await boot({
    summary: summaryFixture((s) => { s.aiRuns.runs = 1; }),
    usage: usageFixture((u) => { u.apps[0].label = '  Aria Mobile  '; }),
  });
  assert.equal(moments(dom)[0].label, 'Best Aria Mobile day');
});

test('more AI runs is earned only when both weeks are fully reported and the count rose', async () => {
  const lone = { usage: usageFixture((u) => { u.window.daysCovered = 3; }) };
  const dom = await boot({ ...lone });
  assert.deepEqual(moments(dom), [{ value: '+410', label: 'More AI runs', sub: 'vs last week', tone: 'is-violet' }]);

  const none = async (mutate, why) => {
    const d = await boot({ ...lone, summary: summaryFixture(mutate) });
    assert.deepEqual(moments(d), [], why);
  };
  await none((s) => { s.aiRuns.previous.runs = 4820; }, 'the same number of runs');
  await none((s) => { s.aiRuns.previous.runs = 5000; }, 'fewer runs');
  await none((s) => { s.aiRuns.daysMissing = ['2026-10-28']; }, 'a day missing from this week');
  await none((s) => { s.aiRuns.daysReported = 6; }, 'a week that is not fully reported');
  await none((s) => { s.aiRuns.previous.daysReported = 5; }, 'a week before that is not fully reported');
  await none((s) => { delete s.aiRuns.previous; }, 'no week before');
  await none((s) => { s.aiRuns.previous = { runs: null, daysReported: 7 }; }, 'no run count for the week before');
  await none((s) => { s.aiRuns.availability = { state: 'not_reporting' }; }, 'runs that are not ready');
  await none((s) => { delete s.aiRuns.window; }, 'a week of no stated length');
  await none((s) => { delete s.aiRuns.daysMissing; }, 'no list of the days that are missing');
});

test('the strip draws only the moments that were earned, under one label, in order', async () => {
  const dom = await boot();
  assert.deepEqual(wordsOf(section(dom, 'moments'), 'sec-label'), ['This week']);
  assert.deepEqual(moments(dom).map((m) => m.label), ['Best Mobile day', 'More AI runs']);
  assert.equal(withClass(section(dom, 'moments'), 'moment-row').length, 1);
  assert.ok(!/paying/i.test(allText(dom.doc.getElementById('content'))), 'a paying tile is on the page');

  /* One earned moment is a strip of one: its label and no gap where the other
     would have been. */
  const aiOnly = await boot({ usage: usageFixture((u) => { u.window.daysCovered = 3; }) });
  assert.deepEqual(moments(aiOnly).map((m) => m.label), ['More AI runs']);
  assert.equal(withClass(one(section(aiOnly, 'moments'), 'moment-row'), 'moment').length, 1);
  assert.deepEqual(wordsOf(section(aiOnly, 'moments'), 'sec-label'), ['This week']);

  const bestOnly = await boot({ summary: summaryFixture((s) => { s.aiRuns.previous.runs = 9999; }) });
  assert.deepEqual(moments(bestOnly).map((m) => m.label), ['Best Mobile day']);
  assert.equal(withClass(one(section(bestOnly, 'moments'), 'moment-row'), 'moment').length, 1);

  const empty = await boot({
    usage: usageFixture((u) => { u.window.daysCovered = 3; }),
    summary: summaryFixture((s) => { s.aiRuns.previous.runs = 9999; }),
  });
  assert.equal(section(empty, 'moments').childNodes.length, 0, 'a strip was drawn with nothing earned');
});

/* ============================ the health line =========================== */

const OK = 'No critical issues';

test('the health line says no critical issues only when it has earned the claim', async () => {
  const calm = await boot({ problems: problemsFixture([]) });
  assert.equal(healthText(calm), OK);
  assert.equal(healthTone(calm), 'is-ok');

  /* A rules answer with no channel list at all says nothing about delivery, so
     it is not "no destination is set". */
  const silent = await boot({
    problems: problemsFixture([]),
    rules: rulesFixture((r) => { delete r.channels; }),
  });
  assert.equal(healthText(silent), OK);

  const acknowledged = await boot({
    problems: problemsFixture([{ id: 'a', severity: 'warning', status: 'acknowledged', title: 'Cost' }]),
  });
  assert.equal(healthText(acknowledged), OK, 'a warning is not a critical issue');
});

test('the health line never says no critical issues over a read it could not trust', async () => {
  const cases = [
    ['a failed problems read', { problems: boom('down') }, 'Problems unread', 'is-warn'],
    ['a rules read that failed', { problems: problemsFixture([]), rules: boom('down') }, 'Checks unread', 'is-warn'],
    ['checks that are not running', {
      problems: problemsFixture([]),
      rules: rulesFixture((r) => { r.rules.forEach((x) => { x.enabled = false; }); }),
    }, 'Checks not running', 'is-warn'],
    ['checks that never ran', {
      problems: problemsFixture([]),
      rules: rulesFixture((r) => { r.rules.forEach((x) => { x.lastEvaluatedAt = null; }); }),
    }, 'Checks not running', 'is-warn'],
    ['no destination to tell anyone', {
      problems: problemsFixture([]),
      rules: rulesFixture((r) => { r.channels[0].configured = false; }),
    }, 'No alert destination set', 'is-warn'],
    ['a channel list that is empty', {
      problems: problemsFixture([]),
      rules: rulesFixture((r) => { r.channels = []; }),
    }, 'No alert destination set', 'is-warn'],
    ['a full page of problems', {
      problems: problemsFixture(Array.from({ length: 100 }, (_, i) => ({
        id: 'w' + i, severity: 'warning', status: 'open', title: 'Slow ' + i }))),
    }, 'At least 100 open problems', 'is-warn'],
    ['a critical problem', {}, '1 critical issue', 'is-crit'],
    ['a critical problem somebody is already on', {
      problems: problemsFixture([{ id: 'c', severity: 'critical', status: 'acknowledged', title: 'Down' }]),
    }, '1 critical issue', 'is-crit'],
  ];
  for (const [name, options, words, tone] of cases) {
    const dom = await boot(options);
    assert.equal(healthText(dom), words, name);
    assert.equal(healthTone(dom), tone, name);
    assert.ok(!allText(section(dom, 'health')).includes(OK), name + ' says ' + OK);
  }
});

test('critical issues are counted and a closed one is not', async () => {
  const dom = await boot({
    problems: problemsFixture([
      { id: '1', severity: 'critical', status: 'open', title: 'A' },
      { id: '2', severity: 'critical', status: 'acknowledged', title: 'B' },
      { id: '3', severity: 'critical', status: 'closed', title: 'C' },
      { id: '4', severity: 'warning', status: 'open', title: 'D' },
    ]),
  });
  assert.equal(healthText(dom), '2 critical issues');
  assert.equal(healthTone(dom), 'is-crit');
});

/* ====================== the checks beside the calm line ================== */

const notesOf = (dom) => wordsOf(section(dom, 'health'), 'health-note');
const calm = { problems: problemsFixture([]) };
const oldStamp = '2020-01-01T00:00:00.000Z';
const threeRules = (edit) => rulesFixture((r) => {
  r.rules.push({ key: 'spend', label: 'Spend', enabled: true, lastEvaluatedAt: minutesAgo(5), lastEvaluationStatus: 'ok', lastFiredAt: null });
  if (edit) edit(r.rules);
});

test('every check reporting and recent leaves the calm line with nothing beside it', async () => {
  const dom = await boot(calm);
  assert.equal(healthText(dom), OK);
  assert.deepEqual(notesOf(dom), []);
  assert.equal(withClass(section(dom, 'health'), 'health-notes').length, 0, 'an empty note row is drawn');
  /* A rule that is switched off was never going to report. */
  const off = await boot({ ...calm, rules: threeRules((rules) => {
    rules[2].enabled = false; rules[2].lastEvaluationStatus = 'insufficient_data';
  }) });
  assert.deepEqual(notesOf(off), []);
});

test('checks that are not reporting are counted beside the claim, never inside it', async () => {
  const cases = [
    ['one short of data', (rules) => { rules[1].lastEvaluationStatus = 'insufficient_data'; }, '1 check not reporting'],
    ['one whose own check failed', (rules) => { rules[1].lastEvaluationStatus = 'error'; }, '1 check not reporting'],
    ['one that never ran', (rules) => { rules[1].lastEvaluatedAt = null; rules[1].lastEvaluationStatus = null; }, '1 check not reporting'],
    ['one with a stamp nobody can read', (rules) => { rules[1].lastEvaluatedAt = 'sometime'; }, '1 check not reporting'],
    ['two of three', (rules) => {
      rules[1].lastEvaluationStatus = 'insufficient_data'; rules[2].lastEvaluationStatus = 'error';
    }, '2 checks not reporting'],
  ];
  for (const [name, mutate, words] of cases) {
    const dom = await boot({ ...calm, rules: threeRules(mutate) });
    assert.equal(healthText(dom), OK, name + ': the problems claim changed');
    assert.equal(healthTone(dom), 'is-ok', name);
    assert.deepEqual(notesOf(dom), [words], name);
    assert.ok(!allText(one(section(dom, 'health'), 'health-text')).includes('check'),
      name + ': the check count is inside the claim');
  }
});

test('verdicts older than the evaluator would leave them are dated beside the claim', async () => {
  const ranAt = (stamp) => rulesFixture((r) => { r.rules.forEach((x) => { x.lastEvaluatedAt = stamp; }); });

  const fresh = await boot({ ...calm, rules: ranAt(minutesAgo(14)) });
  assert.deepEqual(notesOf(fresh), [], 'fourteen minutes is inside the cadence');

  const late = await boot({ ...calm, rules: ranAt(minutesAgo(16)) });
  assert.deepEqual(notesOf(late), ['Checks last ran 16 minutes ago']);
  assert.equal(healthText(late), OK);

  const hours = await boot({ ...calm, rules: ranAt(minutesAgo(3 * 60)) });
  assert.deepEqual(notesOf(hours), ['Checks last ran 3 hours ago']);

  const years = await boot({ ...calm, rules: ranAt(oldStamp) });
  assert.equal(healthText(years), OK);
  assert.equal(notesOf(years).length, 1);
  assert.match(notesOf(years)[0], /^Checks last ran \d+ days ago$/);
});

test('the age is the newest verdict, not the newest run that reached none', async () => {
  const rules = rulesFixture((r) => {
    r.rules[0].lastEvaluatedAt = oldStamp;
    r.rules[1].lastEvaluationStatus = 'insufficient_data';
  });
  const dom = await boot({ ...calm, rules });
  const notes = notesOf(dom);
  assert.equal(notes.length, 2, notes.join(' | '));
  assert.equal(notes[0], '1 check not reporting');
  assert.match(notes[1], /^Checks last ran \d+ days ago$/, 'a run that reached no verdict made the verdicts look current');
});

test('the coverage line is one clause each, and only ever beside the calm claim', async () => {
  const both = await boot({ ...calm, rules: threeRules((rules) => {
    rules.forEach((x) => { x.lastEvaluatedAt = minutesAgo(40); });
    rules[2].lastEvaluationStatus = 'insufficient_data';
  }) });
  assert.deepEqual(notesOf(both), ['1 check not reporting', 'Checks last ran 40 minutes ago']);
  for (const note of notesOf(both)) assert.ok(!/[.,;:]/.test(note), 'the note is a sentence: ' + note);

  /* Every other line already says something about the checks or the queue. */
  const elsewhere = [
    ['a critical issue', { rules: threeRules((rules) => { rules[2].lastEvaluationStatus = 'insufficient_data'; }) }],
    ['checks not running', { ...calm, rules: rulesFixture((r) => { r.rules.forEach((x) => { x.lastEvaluationStatus = 'insufficient_data'; }); }) }],
    ['checks unread', { ...calm, rules: boom('down') }],
    ['no destination', { ...calm, rules: threeRules((rules) => { rules[2].lastEvaluationStatus = 'error'; }) }],
  ];
  elsewhere[3][1].rules.channels[0].configured = false;
  for (const [name, options] of elsewhere) {
    const dom = await boot(options);
    assert.ok(!allText(section(dom, 'health')).includes(OK), name);
    assert.deepEqual(notesOf(dom), [], name + ' carries the coverage line');
  }
});

test('every status dot is decoration, because the health line says it in words', async () => {
  for (const options of [{}, { problems: problemsFixture([]) }, { problems: boom('x') }]) {
    const dom = await boot(options);
    const dots = withClass(dom.doc.getElementById('content'), 'dot');
    assert.ok(dots.length >= 1);
    for (const dot of dots) {
      assert.equal(dot.getAttribute('aria-hidden'), 'true', 'a status dot is announced as something');
      assert.equal(allText(dot), '', 'a status dot carries words');
    }
    assert.ok(allText(one(section(dom, 'health'), 'health-text')).length > 3);
  }
});

/* =============================== the queue =============================== */

test('the queue lists the three worst problems, worst first then oldest, and counts the rest', async () => {
  const row = (id, severity, at, title) => ({ id, severity, status: 'open', title, detectedAt: at, firedAt: at });
  const dom = await boot({
    problems: problemsFixture([
      row('1', 'warning', '2026-10-01T00:00:00.000Z', 'Old warning'),
      row('2', 'critical', '2026-10-20T00:00:00.000Z', 'Newer critical'),
      row('3', 'info', '2026-09-01T00:00:00.000Z', 'Oldest info'),
      row('4', 'critical', '2026-10-10T00:00:00.000Z', 'Older critical'),
      row('5', 'warning', '2026-10-15T00:00:00.000Z', 'New warning'),
    ]),
  });
  const rows = withClass(section(dom, 'problems'), 'prob-row');
  assert.deepEqual(rows.map((r) => allText(one(r, 'prob-title'))),
    ['Older critical', 'Newer critical', 'Old warning']);
  assert.equal(allText(one(section(dom, 'problems'), 'prob-more')), '+2 more');
  assert.deepEqual(rows.map((r) => allText(one(r, 'prob-since'))), ['Since Oct 10', 'Since Oct 20', 'Since Oct 1']);
});

test('a full page of problems says the rest is a floor, not a count', async () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    id: 'p' + i, severity: 'warning', status: 'open', title: 'Slow ' + i,
    detectedAt: '2026-10-01T00:00:00.000Z' }));
  const dom = await boot({ problems: problemsFixture(rows) });
  assert.equal(allText(one(section(dom, 'problems'), 'prob-more')), '+97 or more');
});

test('a quiet queue draws no rows and no empty frame', async () => {
  const dom = await boot({ problems: problemsFixture([]) });
  assert.equal(section(dom, 'problems').childNodes.length, 0);
});

test('a problem never names the person on it, because the pane was never given a name', async () => {
  const dom = await boot({
    problems: problemsFixture([
      { id: 'a', severity: 'warning', status: 'acknowledged', title: 'Cloud costs up',
        acknowledgedBy: 'adm_op', acknowledgedByEmail: 'anthony@ops.invalid', summary: 'Spend is high.' },
      { id: 'b', severity: 'warning', status: 'open', title: 'Slow job',
        acknowledgedBy: null, acknowledgedByEmail: null },
    ]),
  });
  const rows = withClass(section(dom, 'problems'), 'prob-row');
  assert.deepEqual(rows.map((r) => allText(one(r, 'prob-who'))), ['Someone is on it', 'Nobody on it']);
  assert.equal(withClass(rows[0], 'who-av').length, 1, 'somebody being on it has a person glyph');
  assert.equal(withClass(rows[1], 'who-av').length, 0, 'nobody being on it has no person glyph');

  const everything = allDomTextAndAttrs(dom.doc.getElementById('content'));
  for (const leaked of ['anthony@ops.invalid', 'anthony', 'adm_op', 'Spend is high.']) {
    assert.ok(!everything.includes(leaked), leaked + ' reached the screen');
  }
});

test('a problem title has its contact details masked, and an empty one is named as untitled', async () => {
  const dom = await boot({
    problems: problemsFixture([
      { id: 'a', severity: 'critical', status: 'open', title: 'Email from jane@example.com is failing' },
      { id: 'b', severity: 'warning', status: 'open', title: '   ' },
      { id: 'c', severity: 'info', status: 'open' },
    ]),
  });
  const titles = withClass(section(dom, 'problems'), 'prob-title').map(allText);
  assert.ok(!titles[0].includes('jane@example.com'), 'an address reached the screen: ' + titles[0]);
  assert.match(titles[0], /^Email from .+ is failing$/);
  assert.deepEqual(titles.slice(1), ['Untitled problem', 'Untitled problem']);
  const view = findAll(section(dom, 'problems'), (n) => classesOf(n).includes('prob-view'));
  assert.ok(!view[0].getAttribute('aria-label').includes('jane@example.com'));
});

test('a critical problem says critical in the row itself, in words a screen reader reads first', async () => {
  const dom = await boot({
    problems: problemsFixture([
      { id: 'a', severity: 'critical', status: 'open', title: 'T1' },
      { id: 'b', severity: 'warning', status: 'open', title: 'T2' },
      { id: 'c', severity: 'info', status: 'open', title: 'T3' },
    ]),
  });
  const rows = withClass(section(dom, 'problems'), 'prob-row');
  assert.deepEqual(rows.map((r) => allText(one(r, 'sr'))), ['Critical:', 'Warning:', 'Info:']);
  assert.deepEqual(rows.map((r) => classesOf(r).find((c) => c.startsWith('is-'))), ['is-crit', 'is-warn', 'is-info']);
});

test('a severity this pane does not know reaches the row as the word that arrived', async () => {
  const dom = await boot({
    problems: problemsFixture([{ id: 'a', severity: 'blocker', status: 'open', title: 'Odd' }]),
  });
  const row = withClass(section(dom, 'problems'), 'prob-row')[0];
  assert.equal(allText(one(row, 'sr')), 'blocker:');
  assert.ok(classesOf(row).includes('is-info'), 'an unknown severity is drawn in a tone of its own invention');
});

for (const severity of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
  test('a severity named ' + severity + ' does not put JavaScript on the screen', async () => {
    const dom = await boot({
      problems: problemsFixture([{ id: 'a', severity, status: 'open', title: 'Hostile' }]),
    });
    const row = withClass(section(dom, 'problems'), 'prob-row')[0];
    assert.ok(row, 'the row was not drawn');
    const spoken = allText(one(row, 'sr'));
    assert.ok(!FN_TEXT.test(spoken), 'a function is read out: ' + spoken);
    assert.equal(spoken, severity + ':');
    const klass = classesOf(row).join(' ');
    assert.ok(!FN_TEXT.test(klass), 'a function is in the class list: ' + klass);
    assert.ok(classesOf(row).includes('is-info'));
    assert.ok(!/undefined|\[object/.test(allDomTextAndAttrs(row)), 'the row says something it should not');
  });
}

test('a severity of nothing at all is named unknown and nothing says undefined', async () => {
  for (const severity of [undefined, null, '', '   ', 5, {}]) {
    const dom = await boot({
      problems: problemsFixture([{ id: 'a', severity, status: 'open', title: 'Blank' }]),
    });
    const row = withClass(section(dom, 'problems'), 'prob-row')[0];
    assert.equal(allText(one(row, 'sr')), 'Unknown:', JSON.stringify(severity));
    assert.ok(!/undefined|null|\[object|NaN/.test(allDomTextAndAttrs(dom.doc.getElementById('content'))),
      'the screen says something it should not for ' + JSON.stringify(severity));
  }
});

test('each problem opens the pane its work happens in, and an unknown pane opens Problems', async () => {
  const dom = await boot({
    problems: problemsFixture([
      { id: 'a', severity: 'critical', status: 'open', title: 'A', workPane: 'jobs-live' },
      { id: 'b', severity: 'critical', status: 'open', title: 'B', workPane: 'run-history' },
      { id: 'c', severity: 'critical', status: 'open', title: 'C', workPane: 'spend' },
      { id: 'd', severity: 'warning', status: 'open', title: 'D', workPane: 'nowhere' },
      { id: 'e', severity: 'warning', status: 'open', title: 'E', workPane: 'overview' },
      { id: 'f', severity: 'warning', status: 'open', title: 'F' },
    ]),
  });
  const registry = dom.window.OpsPaneRegistry;
  const hrefs = withClass(section(dom, 'problems'), 'prob-view').map((a) => a.getAttribute('href').split('?')[0]);
  /* The queue lists the three worst, in order, so the last three are in the
     "more" count. The first three are critical. */
  assert.deepEqual(hrefs, [registry.PANES.jobs.file, registry.PANES.history.file, registry.PANES.spend.file]);

  const rest = await boot({
    problems: problemsFixture([
      { id: 'd', severity: 'warning', status: 'open', title: 'D', workPane: 'nowhere' },
      { id: 'e', severity: 'warning', status: 'open', title: 'E', workPane: 'overview' },
      { id: 'f', severity: 'warning', status: 'open', title: 'F' },
    ]),
  });
  assert.deepEqual(
    withClass(section(rest, 'problems'), 'prob-view').map((a) => a.getAttribute('href').split('?')[0]),
    Array(3).fill(registry.PANES.alerts.file),
    'a problem whose work pane is not known, or is Today itself, opens Problems');
});

/* ============================== happening now ============================= */

test('the live line says how many are running now, and is absent when it cannot say', async () => {
  const live = async (mutate) => {
    const dom = await boot({ jobs: jobsFixture(mutate) });
    const found = withClass(section(dom, 'live'), 'live-text');
    return found.length ? allText(found[0]) : null;
  };
  assert.equal(await live(), '6 running now');
  assert.equal(await live((j) => { j.queue.byState = [{ state: 'running', jobs: 0 }]; }), 'Nothing running');
  assert.equal(await live((j) => { j.queue.byState = [{ state: 'queued', jobs: 4 }]; }), null,
    'a missing running count was read as nothing running');
  assert.equal(await live((j) => { delete j.queue; }), null);
});

test('the jobs tile counts what the read counted, and says so when a figure did not arrive', async () => {
  const dom = await boot();
  const tile = section(dom, 'jobs');
  assert.equal(allText(one(tile, 'big')), '19 jobs');
  const rows = (root) => withClass(root, 'job-row').map((r) => [allText(one(r, 'job-n')), allText(one(r, 'job-l'))]);
  assert.deepEqual(rows(tile), [['6', 'running'], ['13', 'queued'], ['0', 'stuck']]);

  const blank = await boot({ jobs: jobsFixture((j) => { delete j.queue.open; j.queue.byState = []; }) });
  assert.equal(allText(one(section(blank, 'jobs'), 'big')), 'Not reported');
  assert.deepEqual(rows(section(blank, 'jobs')), [['-', 'running'], ['-', 'queued'], ['0', 'stuck']],
    'a count that did not arrive was drawn as zero');

  const one1 = await boot({ jobs: jobsFixture((j) => { j.queue.open = 1; }) });
  assert.equal(allText(one(section(one1, 'jobs'), 'big')), '1 job');

  const canceling = await boot({
    jobs: jobsFixture((j) => { j.queue.byState.push({ state: 'canceling', jobs: 2 }); }),
  });
  assert.deepEqual(rows(section(canceling, 'jobs')).map((r) => r[1]), ['running', 'queued', 'canceling', 'stuck']);
});

test('a stuck count is exactly as wide as the read behind it', async () => {
  const stuck = async (completeness, list) => {
    const dom = await boot({
      jobs: jobsFixture((j) => { j.attention = { completeness, stuck: list }; }),
    });
    return withClass(section(dom, 'jobs'), 'job-row')
      .filter((r) => classesOf(r).includes('is-stuck')).map((r) => allText(one(r, 'job-n')))[0];
  };
  assert.equal(await stuck('whole_queue', []), '0', 'a whole-queue read that saw none has seen none');
  assert.equal(await stuck('whole_queue', [{}, {}]), '2');
  assert.equal(await stuck('working_set_only', []), 'none seen', 'a bounded read that saw none is not "none"');
  assert.equal(await stuck('working_set_only', [{}, {}]), '2+', 'a bounded read is a floor');
  assert.equal(await stuck('something_else', [{}]), '-', 'a read of unknown width says nothing');
  assert.equal(await stuck('whole_queue', undefined), '-', 'a list that did not arrive is not an empty one');
});

/* ================================ Aria AI =============================== */

test('the AI tile says how many runs and how many of the last day worked', async () => {
  const dom = await boot();
  const tile = section(dom, 'ai');
  assert.equal(allText(one(tile, 'big')), '4,820 runs \u00b7 7 days');
  assert.equal(allText(one(tile, 'ai-worked')), '24 / 25 worked');
  assert.equal(allText(one(tile, 'ai-window')), 'Last 24h');
  assert.equal(withClass(tile, 'ai-bar').length, 1);
  assert.equal(withClass(tile, 'ai-miss').length, 1, 'a failure draws a miss on the bar');
  assert.equal(withClass(tile, 'ai-fill')[0].style.width, '96.00%');
});

test('a cancellation is neither a success nor a failure, so it is not in the rate', async () => {
  const dom = await boot({
    runs: runsFixture((r) => { r.summary = { completed: 20, failed: 0, canceled: 9 }; }),
  });
  assert.equal(allText(one(section(dom, 'ai'), 'ai-worked')), '20 / 20 worked');
  assert.equal(withClass(section(dom, 'ai'), 'ai-miss').length, 0, 'a miss is drawn with no failure');
});

test('the last day is words, never a rate, unless the read covered the whole day', async () => {
  const words = async (mutate) => {
    const dom = await boot({ runs: runsFixture(mutate) });
    const tile = section(dom, 'ai');
    assert.equal(withClass(tile, 'ai-bar').length, 0, 'a bar is drawn for a rate that is not drawn');
    assert.equal(withClass(tile, 'ai-window').length, 0);
    return allText(one(tile, 'ai-worked'));
  };
  assert.equal(await words((r) => { r.window.range = '7d'; }), 'Last 24h not reported');
  assert.equal(await words((r) => { delete r.window; }), 'Last 24h not reported');
  assert.equal(await words((r) => { r.coverage.coversWindow = false; }), 'Last 24h not fully recorded');
  assert.equal(await words((r) => { r.coverage.state = 'partial'; }), 'Last 24h not fully recorded');
  assert.equal(await words((r) => { delete r.coverage; }), 'Last 24h not fully recorded');
  assert.equal(await words((r) => { delete r.summary.failed; }), 'Last 24h not reported');
  assert.equal(await words((r) => { r.summary.completed = '24'; }), 'Last 24h not reported');
  assert.equal(await words((r) => { r.summary = { completed: 0, failed: 0 }; }), 'No runs finished');
});

test('the run count is words when the summary is not ready', async () => {
  for (const [state, text] of [['not_reporting', 'No reading'], ['unconfigured', 'Not set up'], ['mystery', 'Not reported']]) {
    const dom = await boot({
      summary: summaryFixture((s) => { s.aiRuns.availability = { state }; }),
    });
    const big = one(section(dom, 'ai'), 'big');
    assert.equal(allText(big), text);
    assert.equal(withClass(big, 'num').length, 0, 'a number beside a block that is not ready');
  }
  const noRuns = await boot({ summary: summaryFixture((s) => { delete s.aiRuns.runs; }) });
  assert.ok(classesOf(one(section(noRuns, 'ai'), 'big')).includes('words'), 'a missing run count was drawn as a number');
});

test('a single run is a run and a single day is a day', async () => {
  const dom = await boot({
    summary: summaryFixture((s) => { s.aiRuns.runs = 1; s.aiRuns.window = { days: 1 }; s.aiRuns.daysReported = 1; }),
  });
  assert.equal(allText(one(section(dom, 'ai'), 'big')), '1 run \u00b7 1 day');
});

/* ================================ spend ================================= */

test('the spend tile shows the latest billed day, drawn from the billed days only', async () => {
  const dom = await boot();
  const tile = section(dom, 'spend');
  assert.equal(allText(one(tile, 'big')), '$115.00', 'the latest billed day is the last of the billed values');
  assert.equal(allText(one(tile, 'spend-day')), 'Oct 31');
  assert.equal(allText(one(tile, 'spend-avg')), '$100.00 daily avg \u00b7 Oct');
  const chart = one(tile, 'tchart');
  assert.ok(classesOf(chart).includes('is-spark'));
  assert.equal(chart.getAttribute('aria-label'),
    'Daily cloud spend over 31 billed days, this week: 31 of 31 days with a reading, low 85,000,000, high 115,000,000, ending 115,000,000.');
});

test('the spend line is never longer than the days that billed', async () => {
  const dom = await boot({
    costs: costsFixture((c) => {
      c.period.billedDays = 10;
      c.total.micros = 1_000_000_000;
    }),
  });
  assert.equal(allText(one(section(dom, 'spend'), 'big')), '$94.00', 'the last billed day is the tenth, not the last value');
  assert.match(one(section(dom, 'spend'), 'tchart').getAttribute('aria-label'), /10 of 10 days/);
  assert.equal(allText(one(section(dom, 'spend'), 'spend-avg')).split(' ')[0], '$100.00');
});

test('the cost tile draws no budget track, because nothing records a budget', async () => {
  const dom = await boot();
  const tile = allDomTextAndAttrs(section(dom, 'spend'));
  assert.ok(!/budget|forecast|projected|limit|of \$/i.test(tile), tile);
  assert.equal(withClass(section(dom, 'spend'), 'meter').length, 0);
});

for (const [state, words] of [['not_published', 'Not published'], ['not_collected', 'Not collected'], ['strange', 'Not reported']]) {
  test('a bill that is ' + state + ' prints words and its own reason, never a figure', async () => {
    const dom = await boot({
      costs: costsFixture((c) => { c.availability = { state, detail: 'The export has not landed.' }; }),
    });
    const tile = section(dom, 'spend');
    assert.equal(allText(one(tile, 'big')), words);
    assert.equal(allText(one(tile, 'hp-note')), 'The export has not landed.');
    assert.equal(withClass(tile, 'num').length, 0);
    assert.equal(withClass(tile, 'tchart').length, 0);
  });
}

test('a month with no billed day is words, not a zero dollar day', async () => {
  for (const billedDays of [0, null, undefined]) {
    const dom = await boot({ costs: costsFixture((c) => { c.period.billedDays = billedDays; }) });
    const tile = section(dom, 'spend');
    assert.ok(classesOf(one(tile, 'big')).includes('words'), 'billedDays ' + billedDays);
    assert.ok(!hasDigit(allText(one(tile, 'big'))));
  }
});

/* ============================== the doorways ============================ */

test('every doorway points at the pane the registry says owns the question', async () => {
  const dom = await boot();
  const registry = dom.window.OpsPaneRegistry;
  const files = Object.keys(registry.PANES).map((id) => registry.PANES[id].file);

  const links = findAll(dom.doc.getElementById('content'), (n) => n.tagName === 'A' && n.getAttribute('href'));
  assert.ok(links.length >= 5, 'the pane has no doorways on it at all');
  for (const link of links) {
    const file = (link.getAttribute('href') || '').split('?')[0];
    assert.ok(files.indexOf(file) !== -1,
      'a doorway points at ' + file + ', which is not a pane the registry names');
    assert.ok(allText(link).length > 3 || link.getAttribute('aria-label'), 'a doorway has no words in it');
  }

  const into = (host) => withClass(section(dom, host), 'tile-link').map((a) => a.getAttribute('href').split('?')[0]);
  assert.deepEqual(into('jobs'), [registry.PANES.jobs.file]);
  assert.deepEqual(into('ai'), [registry.PANES.history.file]);
  assert.deepEqual(into('spend'), [registry.PANES.spend.file]);
  assert.deepEqual(withClass(section(dom, 'spend'), 'spend-link').map((a) => a.getAttribute('href').split('?')[0]),
    [registry.PANES.spend.file]);
  const hrefs = links.map((l) => l.getAttribute('href').split('?')[0]);
  for (const file of ['jobs-live.html', 'run-history.html', 'spend.html']) {
    assert.ok(hrefs.includes(file), 'no doorway into ' + file);
  }
});

test('a doorway in the page is a link the browser can follow and never a script', async () => {
  const dom = await boot();
  for (const link of findAll(dom.doc.getElementById('content'), (n) => n.getAttribute('href') !== null)) {
    assert.match(link.getAttribute('href'), /^[a-z0-9-]+\.html/, 'a doorway is not a relative page: ' + link.getAttribute('href'));
  }
});

/* ============================ the head and the badge ===================== */

test('the title carries the date and when the figures were read, in UTC', async () => {
  const dom = await boot();
  const slot = dom.doc.getElementById('pageSub');
  assert.ok(slot, 'the shell has no slot under the title');
  assert.deepEqual(wordsOf(slot, 'sub-date'), ['Sun, Nov 1, 2026']);
  assert.deepEqual(wordsOf(slot, 'sub-updated'), ['Updated 09:41 UTC']);
});

test('the title falls back to the jobs read, and says nothing when neither read has a time', async () => {
  const jobsOnly = await boot({ summary: boom('down') });
  assert.deepEqual(wordsOf(dom_slot(jobsOnly), 'sub-updated'), ['Updated 09:40 UTC']);

  const neither = await boot({
    summary: summaryFixture((s) => { s.generatedAt = 'not a date'; }),
    jobs: jobsFixture((j) => { delete j.generatedAt; }),
  });
  assert.equal(dom_slot(neither).childNodes.length, 0, 'a stamp that cannot be read was printed');
});

function dom_slot(dom) {
  return dom.doc.getElementById('pageSub');
}

test('the Health badge is the count this pane just read, and a quiet queue leaves none', async () => {
  const badge = (dom) => {
    const links = findAll(dom.doc.body, (n) => n.getAttribute && n.getAttribute('data-badge-key') === 'alerts');
    return links.map((l) => withClass(l, 'nav-badge').map(allText)).flat();
  };
  const dom = await boot({
    problems: problemsFixture([
      { id: '1', severity: 'critical', status: 'open', title: 'A' },
      { id: '2', severity: 'warning', status: 'open', title: 'B' },
      { id: '3', severity: 'warning', status: 'acknowledged', title: 'C' },
    ]),
  });
  assert.ok(badge(dom).every((b) => b === '2'), 'the badge counts problems nobody is on: ' + badge(dom));
  assert.ok(badge(dom).length >= 1, 'no badge was drawn');

  const quiet = await boot({ problems: problemsFixture([]) });
  assert.deepEqual(badge(quiet), [], 'a count was drawn for a quiet system');

  const failed = await boot({ problems: boom('down') });
  assert.deepEqual(badge(failed), [], 'a count was drawn for a read that failed');
});

test('a full page of problems makes the badge a floor', async () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: 'p' + i, severity: 'warning', status: 'open', title: 'S' + i }));
  const dom = await boot({ problems: problemsFixture(rows) });
  const badges = findAll(dom.doc.body, (n) => n.getAttribute && n.getAttribute('data-badge-key') === 'alerts')
    .map((l) => withClass(l, 'nav-badge').map(allText)).flat();
  assert.ok(badges.length && badges.every((b) => b === '100+'), String(badges));
});

/* ============================== structure ================================ */

test('every section is a heading or sits under one, so no part of the page is jumped past', async () => {
  const dom = await boot();
  const content = dom.doc.getElementById('content');
  const heads = findAll(content, (n) => /^H[1-6]$/.test(n.tagName));
  assert.ok(heads.length >= 6);
  for (const head of heads) assert.ok(allText(head).length >= 3, 'an empty heading');
  const titled = (id) => withClass(section(dom, id), 'sec-title').length;
  for (const id of ['people', 'jobs', 'ai', 'spend']) {
    assert.ok(findAll(section(dom, id), (n) => /^H[2-3]$/.test(n.tagName)).length >= 1, id + ' has no heading');
  }
  assert.ok(titled('health') && titled('live') >= 0);
  /* No heading level is skipped inside the page: an h3 belongs to an h2. */
  const order = findAll(content, (n) => /^H[1-6]$/.test(n.tagName)).map((n) => Number(n.tagName[1]));
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i] - order[i - 1] <= 1, 'the outline jumps from h' + order[i - 1] + ' to h' + order[i]);
  }
});

test('the people figure explains what it counts through a tip a keyboard can reach and dismiss', async () => {
  const dom = await boot();
  const [button] = withClass(section(dom, 'people'), 'tip-btn');
  const [bubble] = withClass(section(dom, 'people'), 'tip-bubble');
  assert.equal(button.tagName, 'BUTTON');
  assert.equal(button.getAttribute('aria-label'), 'What this counts');
  assert.equal(button.getAttribute('aria-describedby'), bubble.getAttribute('id'));
  assert.equal(bubble.getAttribute('role'), 'tooltip');
  assert.match(allText(bubble), /usage analytics/);
  assert.equal(bubble.getAttribute('data-dismissed'), null);
  button.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.notEqual(bubble.getAttribute('data-dismissed'), null, 'Escape does not put the tip away');
  button.dispatchEvent({ type: 'blur' });
  assert.equal(bubble.getAttribute('data-dismissed'), null, 'the tip stays dismissed after the focus has left');
});

test('nothing on the page says undefined, null or NaN when most of every answer is missing', async () => {
  const dom = await boot({
    summary: { people: { availability: { state: 'ready' }, platform: {}, apps: [{}, null, { active: 'x' }], window: {} }, aiRuns: {} },
    usage: { availability: { state: 'ready' }, window: {}, apps: [{ trend: { values: [null, 'a', undefined] } }, null] },
    problems: { problems: [{}, { status: 'open' }, { status: 'open', severity: 'critical', title: null }] },
    rules: {},
    jobs: { queue: { byState: [null, {}] }, attention: {} },
    runs: {},
    costs: { availability: { state: 'ready' }, period: {}, daily: { series: [{}] } },
  });
  const page = allDomTextAndAttrs(dom.doc.getElementById('content'));
  assert.ok(!/undefined|\bnull\b|NaN|\[object|Invalid Date/.test(page), page);
});
