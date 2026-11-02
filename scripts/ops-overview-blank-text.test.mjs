/* Today, and strings that are present but say nothing.

   A field holding nothing but spaces is a field with no words in it, and a
   field with words and spaces around them is the words. Both are easy to get
   wrong in the same way: a call site that tests the string and then draws the
   RAW one decides with the trimmed value and prints the untrimmed, which is
   the defect wearing its own fix. On this page that looks like a split-label
   with no name in it, a heading with a gap before the word, a note box with
   nothing in it, or a "Since" with a date that is not one.

   How these bind, and why it is not a source grep:

     - Every assertion reads the RENDERED page. Asserting that the source
       contains `.trim()` would pin the characters and not the drawing, and a
       call site that resolved the value elsewhere would walk straight past.

     - Padding is judged on text that was NOT normalised. `allText()` from the
       harness collapses whitespace and trims, so anything routed through it
       reads a string the harness had already tidied and could not see a
       padded heading. `said()` below does not.

     - Every absence assertion is preceded by the same finder locating the
       thing on a render that DOES have it, so a finder that matches nothing
       cannot pass an absence test for the wrong reason.

   The sweeps at the bottom ask the screen rather than the source. They pad
   every string any of the eight answers carries, one at a time, and the
   rendered page must be unchanged; then they blank every string at once and
   the page must still be a page. No census of `textOf()` calls, however
   carefully counted, can reach a call site that never used `textOf()`, and
   that is the argument for the sweep in one line.

   NOT COVERED here:

     - The severity path through `model.SEVERITY_LABEL`. It is a word the
       route sends, matched exactly, and a severity this page does not know is
       printed as the word that arrived, which is bound in ops-overview-v2.
       What is bound here is only that the word that arrives is printed
       without its padding.

     - No enumeration of the other call sites, by name, by line or by count.
       A census in a comment is a claim nothing executes, and it goes stale on
       the next edit to the file it describes. The sweeps are the invariant. */
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
const PANE_SRC = read('assets/pane-overview.js');

const TOKENS = {
  '--cyan': '#00E5FF', '--violet': '#8B5CF6', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#F87171', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#F5F5F7',
};

/* ------------------------------------------------------------- fixtures */

/* A function, because the sweeps below write into the fixture and a shared
   object would carry one test's padding into the next. */
const week = () => ({
  start: '2026-10-25T00:00:00.000Z', endExclusive: '2026-11-01T00:00:00.000Z', days: 7,
});
const MOBILE_DAILY = [12, 15, 14, 17, 16, 19, 18, 17, 20, 22, 19, 21, 23, 20, 22,
  25, 24, 22, 26, 27, 25, 24, 28, 30, 26, 29, 31, 28, 33, 37];
const COACHES_DAILY = [4, 5, 4, 6, 5, 7, 6, 5, 7, 8, 6, 7, 8, 6, 7,
  9, 8, 7, 8, 9, 7, 6, 8, 9, 7, 8, 9, 8, 7, 9];

/* Every date is fixed, so a render is the same on every day it is run and the
   padded and the clean renders can be compared as strings. */
const FIVE_MINUTES_BEFORE = '2026-11-01T09:36:00.000Z';

/* A whole answer from every read, carrying a word in every field the page
   prints. Each test replaces exactly one of those words, so the difference
   between two renders is one field and not a fixture. */
function everything() {
  return {
    summary: {
      generatedAt: '2026-11-01T09:41:00.000Z',
      consent: { basis: 'operational', detail: 'Operational data only.' },
      people: {
        availability: { state: 'ready', detail: '' },
        platform: { active: 1102, previousActive: 980 },
        apps: [
          { app: 'mobile', label: 'Mobile', active: 870, previousActive: 800 },
          { app: 'coaches', label: 'Coaches Web', active: 412, previousActive: 390 },
        ],
        window: week(),
        comparison: { days: 7, label: 'the 7 days before' },
        reportingFloor: 5,
        environment: 'production',
      },
      aiRuns: {
        availability: { state: 'ready', detail: '' },
        runs: 4820, previous: { runs: 4410, daysReported: 7 },
        daysMissing: [], daysReported: 7, window: week(),
      },
    },
    usage: {
      window: {
        range: '30d', start: '2026-10-02T00:00:00.000Z', endExclusive: '2026-11-01T00:00:00.000Z',
        days: 30, grain: 'day', timezone: 'UTC', daysCovered: 30, daysMissingRollups: [],
      },
      availability: { state: 'ready', detail: '' },
      apps: [
        { app: 'mobile', label: 'Mobile', trend: { values: MOBILE_DAILY.slice() } },
        { app: 'coaches', label: 'Coaches Web', trend: { values: COACHES_DAILY.slice() } },
      ],
    },
    growth: {
      payingSubscribers: {
        current: { count: 31 },
        weeks: [20, 21, 22, 23, 24, 25, 27, 29].map((count) => ({ count })),
      },
    },
    problems: {
      problems: [
        { id: 'p1', reference: 'PRB-104', severity: 'warning', status: 'open',
          title: 'Generation queue is slow', summary: 'Nothing has drained for 40 minutes.',
          detectedAt: '2026-10-30T08:00:00.000Z', workPane: 'jobs-live', workPaneLabel: 'Happening now' },
        { id: 'p2', reference: 'PRB-105', severity: 'info', status: 'acknowledged',
          title: 'Backfill is behind', summary: 'Running late.',
          detectedAt: '2026-10-29T08:00:00.000Z', workPane: 'run-history', workPaneLabel: 'Run history' },
      ],
      total: 2,
    },
    rules: {
      rules: [{
        key: 'queue', label: 'Queue depth', enabled: true,
        lastEvaluatedAt: FIVE_MINUTES_BEFORE, lastEvaluationStatus: 'ok', lastFiredAt: null,
      }],
      channels: [{ key: 'teams', label: 'Teams', configured: true, status: 'ok' }],
    },
    jobs: {
      generatedAt: '2026-11-01T09:40:00.000Z',
      queue: { open: 19, byState: [{ state: 'running', jobs: 6 }, { state: 'queued', jobs: 13 }] },
      attention: { completeness: 'whole_queue', stuck: [] },
    },
    runs: {
      window: { range: '24h' },
      coverage: { state: 'ready', coversWindow: true },
      summary: { runs: 26, completed: 24, failed: 1, canceled: 1, unfinished: 0 },
    },
    costs: {
      availability: { state: 'ready', detail: '' }, currency: 'USD',
      period: { start: '2026-10-01T00:00:00.000Z', actualThrough: '2026-10-31T00:00:00.000Z', billedDays: 31 },
      total: { micros: 3_100_000_000 },
      daily: { series: [{ values: Array.from({ length: 31 }, (_, i) => (85 + i) * 1_000_000) }] },
    },
  };
}

/* The same page when three of its figures cannot be given and say why. This
   is the branch that draws a note, and the one a ready fixture cannot reach. */
function withNotes() {
  const all = everything();
  all.summary.people.availability = { state: 'not_collected', detail: 'Backfilled on 3 Sep.' };
  all.summary.aiRuns.availability = { state: 'not_reported', detail: 'Runs are not recorded yet.' };
  all.costs.availability = { state: 'not_published', detail: 'The export lands on the 2nd.' };
  return all;
}

const ENDPOINTS = {
  summary: '/api/ops/summary', usage: '/api/ops/usage', growth: '/api/ops/growth',
  problems: '/api/ops/alerts/problems', rules: '/api/ops/alerts/rules',
  jobs: '/api/ops/jobs', runs: '/api/ops/runs', costs: '/api/ops/costs',
};

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

async function boot(all) {
  const answers = {};
  for (const key of Object.keys(ENDPOINTS)) answers[ENDPOINTS[key]] = all[key];

  const dom = makeDom({ tokens: TOKENS, href: 'https://ops.example.invalid/ops/index.html' });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body);

  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: { admin: { displayName: 'Owner', email: 'owner@example.invalid', role: 'owner' } },
    boot: () => Promise.resolve({ admin: dom.window.OpsSession.state.admin }),
    call: (endpoint) => {
      const answer = answers[endpoint];
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
  return dom;
}

/* ------------------------------------------------------------- reading it */

const classesOf = (n) => String(n.getAttribute('class') || '').split(/\s+/).filter(Boolean);
const withClass = (root, cls) => findAll(root, (n) => classesOf(n).includes(cls));
const section = (dom, id) => dom.doc.getElementById('today-' + id);

/* The text of a node exactly as drawn. `allText()` ends in
   `.replace(/\s+/g, ' ').trim()`, so every "this must not carry its own
   padding" assertion routed through it read a string the harness had already
   tidied. Presence is asserted with `includes`, which does not care either
   way; padding is asserted on this, which is the only thing that can see it. */
function rawText(node) {
  if (!node) return '';
  return (node.textContent || '') + (node.childNodes || []).map(rawText).join('');
}

/* Everything the page says, to anyone: its text exactly as drawn, and every
   attribute a screen reader or a link follows. An un-normalised string, so a
   field that carries its padding onto the screen in an attribute is seen too.
   Sighted users are not the only users the sweep answers for. */
function said(node) {
  if (!node) return '';
  const attrs = (node.attributeNames || [])
    .map((name) => name + '=' + node.getAttribute(name)).join('\u0001');
  const kids = (node.childNodes || []).map(said).join('\u0002');
  return (node.textContent || '') + '\u0003' + attrs + '\u0003' + kids;
}

const everyWordOn = (dom) => said(dom.doc.body);

/* ======================= a label, padded or blank ========================= */

test('an app named with nothing but spaces is named by its key, and by a word when the key is blank too', async () => {
  const clean = await boot(everything());
  assert.deepEqual(withClass(section(clean, 'people'), 'split-label').map(rawText), ['Mobile', 'Coaches Web']);

  const blankLabel = everything();
  blankLabel.summary.people.apps[0].label = '    ';
  blankLabel.summary.people.apps[1].label = '\t \n';
  const keyed = await boot(blankLabel);
  assert.deepEqual(withClass(section(keyed, 'people'), 'split-label').map(rawText), ['mobile', 'coaches'],
    'a label of spaces was drawn as nothing, or as spaces');

  const blankBoth = everything();
  blankBoth.summary.people.apps.forEach((app) => { app.label = ' '; app.app = '  '; });
  const nameless = await boot(blankBoth);
  assert.deepEqual(withClass(section(nameless, 'people'), 'split-label').map(rawText), ['App', 'App']);
});

test('a label with words and spaces around them is the words', async () => {
  const padded = everything();
  padded.summary.people.apps[0].label = '   Mobile  ';
  padded.summary.people.apps[1].app = '  coaches ';
  padded.summary.people.apps[1].label = '';
  const dom = await boot(padded);
  assert.deepEqual(withClass(section(dom, 'people'), 'split-label').map(rawText), ['Mobile', 'coaches']);
});

test('the chart carries an app label in its spoken name without its padding or its blankness', async () => {
  const names = (dom) => findAll(section(dom, 'charts'), (n) => n.getAttribute && n.getAttribute('role') === 'img')
    .map((n) => String(n.getAttribute('aria-label')));
  const clean = await boot(everything());
  assert.equal(names(clean).length, 2, 'the clean render drew no named charts, so their padding proves nothing');
  assert.ok(names(clean)[0].includes('Mobile'));

  const padded = everything();
  padded.usage.apps[0].label = '   Mobile  ';
  padded.usage.apps[1].label = '    ';
  const dom = await boot(padded);
  const [first, second] = names(dom);
  assert.ok(first.includes('Mobile') && !/\s{2}/.test(first) && !first.startsWith(' '), 'padding reached the spoken name: ' + JSON.stringify(first));
  assert.ok(second.includes('coaches'), 'a blank label was drawn as nothing: ' + JSON.stringify(second));
  assert.ok(!/\s{2}/.test(second));
});

test('the best-day moment names the app by its label without padding, and by a word when it is blank', async () => {
  const label = async (value) => {
    const all = everything();
    all.usage.apps[0].label = value;
    const found = withClass(section(await boot(all), 'moments'), 'moment-label').map(rawText);
    return found.filter((t) => /day/.test(t));
  };
  assert.deepEqual(await label('Mobile'), ['Best Mobile day'], 'the clean render did not earn the moment');
  assert.deepEqual(await label('   Mobile  '), ['Best Mobile day']);
  assert.deepEqual(await label('     '), ['Best Mobile day'], 'a blank label left the moment with no name for the app');
});

/* ========================== a problem, padded or blank ==================== */

const titleOf = (dom, which) => withClass(section(dom, 'problems'), 'prob-title').map(rawText)[which || 0];
const viewLabelOf = (dom, which) => withClass(section(dom, 'problems'), 'prob-view').map((n) => n.getAttribute('aria-label'))[which || 0];

test('a problem titled with spaces is untitled, and a padded title prints without its padding', async () => {
  assert.equal(titleOf(await boot(everything())), 'Generation queue is slow');

  const blank = everything();
  blank.problems.problems[0].title = '     ';
  const untitled = await boot(blank);
  assert.equal(titleOf(untitled), 'Untitled problem');
  assert.equal(viewLabelOf(untitled), 'View: Untitled problem', 'the link was named after spaces');

  const padded = everything();
  padded.problems.problems[0].title = '   Generation queue is slow  ';
  const dom = await boot(padded);
  assert.equal(titleOf(dom), 'Generation queue is slow');
  assert.equal(viewLabelOf(dom), 'View: Generation queue is slow');
});

test('a title with nothing at all in it, or something that is not a string, is untitled', async () => {
  for (const value of [undefined, null, '', 0, 12, false, {}, []]) {
    const all = everything();
    all.problems.problems[0].title = value;
    assert.equal(titleOf(await boot(all)), 'Untitled problem', JSON.stringify(value));
  }
});

test('a severity that arrives padded is printed as the word, without its padding', async () => {
  const wordFor = async (severity) => {
    const all = everything();
    all.problems.problems[0].severity = severity;
    return withClass(section(await boot(all), 'problems'), 'sr').map(rawText)[0];
  };
  assert.equal(await wordFor('warning'), 'Warning: ', 'the clean severity did not reach its word');
  const padded = await wordFor('   odd  ');
  assert.equal(padded, 'odd: ', 'padding reached the severity word: ' + JSON.stringify(padded));
  assert.equal(await wordFor('     '), 'Unknown: ', 'a severity of spaces was drawn as nothing');
});

/* ========================= a note, padded or blank ======================== */

test('an availability detail of nothing but spaces draws no note, and a padded one prints without it', async () => {
  const noteOf = (dom, id) => withClass(section(dom, id), 'hp-note').map(rawText);
  const clean = await boot(withNotes());
  assert.deepEqual(noteOf(clean, 'people'), ['Backfilled on 3 Sep.'], 'the clean render drew no note');
  assert.deepEqual(noteOf(clean, 'spend'), ['The export lands on the 2nd.']);

  const blank = withNotes();
  blank.summary.people.availability.detail = '      ';
  blank.costs.availability.detail = '\n\t';
  const quiet = await boot(blank);
  assert.deepEqual(noteOf(quiet, 'people'), [], 'a note of spaces was drawn as an empty box');
  assert.deepEqual(noteOf(quiet, 'spend'), []);

  const padded = withNotes();
  padded.summary.people.availability.detail = '   Backfilled on 3 Sep.   ';
  padded.costs.availability.detail = '  The export lands on the 2nd.  ';
  const dom = await boot(padded);
  assert.deepEqual(noteOf(dom, 'people'), ['Backfilled on 3 Sep.']);
  assert.deepEqual(noteOf(dom, 'spend'), ['The export lands on the 2nd.']);
});

test('an availability state with padding is read as that state, in words and in what it allows', async () => {
  const words = (dom, id) => withClass(section(dom, id), 'big').map(rawText);
  const padded = withNotes();
  padded.summary.people.availability.state = '  not_collected ';
  padded.costs.availability.state = ' not_published  ';
  const dom = await boot(padded);
  assert.deepEqual(words(dom, 'people'), ['Not collected'], 'a padded state was not recognised');
  assert.deepEqual(words(dom, 'spend'), ['Not published']);

  const ready = everything();
  ready.summary.people.availability.state = '  ready ';
  assert.ok(withClass(section(await boot(ready), 'people'), 'big').map(rawText).includes('1,102'),
    'a padded ready was not ready');

  const blank = everything();
  blank.summary.people.availability.state = '    ';
  assert.deepEqual(words(await boot(blank), 'people'), ['Not reported'], 'a state of spaces was read as ready');
});

/* ========================= a date, invalid or blank ======================= */

test('a stamp that is blank, empty or not a date draws no date and no time, and never the word that says so', async () => {
  const head = (dom) => rawText(dom.doc.getElementById('pageSub'));
  const clean = await boot(everything());
  assert.ok(/Sun, Nov 1, 2026/.test(head(clean)) && /Updated 09:41 UTC/.test(head(clean)), head(clean));

  for (const stamp of ['', '   ', 'not a date', '2026-13-45T99:99:00Z', null, 7, {}]) {
    const all = everything();
    all.summary.generatedAt = stamp;
    all.jobs.generatedAt = stamp;
    const dom = await boot(all);
    assert.equal(head(dom), '', 'a stamp of ' + JSON.stringify(stamp) + ' printed ' + JSON.stringify(head(dom)));
  }
});

test('a window whose ends are not dates is described by its length, and never by Invalid Date', async () => {
  const range = (dom) => withClass(section(dom, 'people'), 'hp-range').map(rawText);
  assert.deepEqual(range(await boot(everything())), ['Oct 25\u201331']);

  for (const ends of [{ start: '   ', endExclusive: '' }, { start: 'tomorrow', endExclusive: 'yesterday' }, { start: null, endExclusive: null }]) {
    const all = everything();
    all.summary.people.window = { ...ends, days: 7 };
    assert.deepEqual(range(await boot(all)), ['Last 7 days'], JSON.stringify(ends));
  }
});

test('a problem with no usable date has no since, and a usable one has it', async () => {
  const since = (dom) => withClass(section(dom, 'problems'), 'prob-since').map(rawText);
  assert.deepEqual(since(await boot(everything())), ['Since Oct 30', 'Since Oct 29']);

  for (const stamp of ['   ', 'sometime', undefined, '']) {
    const all = everything();
    all.problems.problems[0].detectedAt = stamp;
    all.problems.problems[0].firedAt = stamp;
    assert.deepEqual(since(await boot(all)), ['Since Oct 29'], JSON.stringify(stamp));
  }
});

test('a spend day that is not a date is left off, not printed as one', async () => {
  const day = (dom) => withClass(section(dom, 'spend'), 'spend-day').map(rawText);
  assert.deepEqual(day(await boot(everything())), ['Oct 31']);
  for (const stamp of ['  ', 'the 31st', null]) {
    const all = everything();
    all.costs.period.actualThrough = stamp;
    assert.deepEqual(day(await boot(all)), [''], JSON.stringify(stamp));
  }
});

/* ============================== the sweeps ================================ */

/* Every string leaf in the fixture, as a path. */
function stringPaths(node, prefix = []) {
  if (typeof node === 'string') return [prefix];
  if (Array.isArray(node)) return node.flatMap((v, i) => stringPaths(v, prefix.concat(String(i))));
  if (node && typeof node === 'object') {
    return Object.keys(node).flatMap((k) => stringPaths(node[k], prefix.concat(k)));
  }
  return [];
}
const getPath = (obj, path) => path.reduce((o, k) => o[k], obj);
const setPath = (obj, path, value) => {
  path.slice(0, -1).reduce((o, k) => o[k], obj)[path[path.length - 1]] = value;
};
const withPath = (obj, path, value) => { setPath(obj, path, value); return obj; };

/* Not a date, not an ISO 4217 code, not an availability state, and holding no
   whitespace for a render to normalise away. */
const SENTINEL = 'Zq7Sentinel';

/* Fields whose value is a KEY the page looks something up by, or a number
   written as text, rather than a word it prints, so padding one legitimately
   changes the render. Named one at a time and justified, because "the sweep
   has exceptions" is how a sweep stops meaning anything.

   Each is verified below to be a lookup, two ways. Padding it changes the
   render, so the exception is not stale. And SUBSTITUTING an unrecognisable
   value for it leaves nothing of that value on the screen, so the field is
   looked up rather than printed. The substitution is the one that matters: a
   padded value can be reformatted into anything, while a substituted one
   cannot hide. */
const LOOKUPS = new Set([
  /* Parsed as a date, never printed as a word. A padded one is not a date the
     route could have sent, and the page does not guess at it. */
  'summary.generatedAt',
  'summary.people.window.start',
  'summary.people.window.endExclusive',
  'usage.window.endExclusive',
  'problems.problems.0.detectedAt',
  'problems.problems.1.detectedAt',
  'rules.rules.0.lastEvaluatedAt',
  'costs.period.start',
  'costs.period.actualThrough',
  /* The key the best-day moment finds the mobile app by, compared exactly. */
  'usage.apps.0.app',
  /* An ISO 4217 code handed to Intl.NumberFormat, which refuses a padded one.
     A currency code is not a word this page prints. */
  'costs.currency',
  /* The key a state table is matched against exactly. A padded one is NOT in
     this list: the page reads the state through textOf(), so ' ready ' is
     ready, and that is asserted above. These are the words of the route's
     enums that are compared with ===, never trimmed, and a padded one falls
     out of the lookup. */
  'jobs.queue.byState.0.state',
  'jobs.queue.byState.1.state',
  'jobs.attention.completeness',
  'runs.coverage.state',
  'runs.window.range',
  'problems.problems.0.status',
  'problems.problems.1.status',
  'problems.problems.0.workPane',
  'problems.problems.1.workPane',
  'rules.rules.0.lastEvaluationStatus',
]);

/* The strings that are printed in a way that is allowed to change when padded,
   and are asserted on their own above. A severity is a word, not a key: what
   arrives is what is printed, trimmed. */
const SEVERITIES = new Set([
  'problems.problems.0.severity',
  'problems.problems.1.severity',
]);

async function sweep(make, lookups, expectSwept, reached) {
  const base = make();
  const paths = stringPaths(base);
  assert.ok(paths.length >= 40, `the walker found ${paths.length} string fields, too few to be reading the fixtures properly`);

  const clean = everyWordOn(await boot(make()));
  /* Each of these is from a DIFFERENT region of the page, so a region that
     silently stopped rendering cannot sit inside the sweep looking covered. A
     sweep that cannot say which parts of the screen it reached is not a
     sweep. */
  for (const word of reached) {
    assert.ok(clean.includes(word), `the clean render does not carry "${word}", so the region of the fixture it comes from was never drawn and every comparison below passes over nothing`);
  }

  const drifted = [];
  const exercised = [];
  for (const path of paths) {
    const key = path.join('.');
    if (SEVERITIES.has(key)) continue;
    const fixture = make();
    setPath(fixture, path, '  ' + getPath(base, path) + '  ');
    const padded = everyWordOn(await boot(fixture));

    if (lookups.has(key)) {
      /* Checked in BOTH directions: an exception that has stopped mattering is
         a stale one, hiding a real site. */
      assert.notEqual(padded, clean, `"${key}" is on the lookup list but padding it changes nothing, so the exception is stale`);
      const swapped = everyWordOn(await boot(withPath(make(), path, SENTINEL)));
      assert.ok(!swapped.includes(SENTINEL),
        `"${key}" is excused as a lookup, but substituting an unrecognisable value put it on the screen: the field is printed, not looked up`);
      continue;
    }
    exercised.push(key);
    if (padded !== clean) {
      let at = 0;
      while (at < clean.length && padded[at] === clean[at]) at += 1;
      drifted.push(`${key} (${JSON.stringify(clean.slice(Math.max(0, at - 40), at + 40))} => ${JSON.stringify(padded.slice(Math.max(0, at - 40), at + 40))})`);
    }
  }

  /* Pinned exactly, not floored. A floor cannot tell "the fixture lost a
     field" from "the fixture never had it". Change the fixture, change this
     number, and the diff says which happened. */
  assert.equal(exercised.length, expectSwept, `${exercised.length} fields were swept, not ${expectSwept}: ${JSON.stringify(exercised)}`);
  assert.deepEqual(drifted, [], `padding these fields changed what the page says: ${JSON.stringify(drifted)}`);
}

test('padding any string any answer carries changes nothing on the screen', async () => {
  await sweep(everything, LOOKUPS, 41, ['Mobile', 'Coaches Web', 'Generation queue is slow', 'Backfill is behind',
    '1,102', '$115.00', 'Best Mobile day']);
});

/* The people figure and the cost tile give up their detail when they cannot
   give a count, so these are not drawn here and an exception for them would be
   stale. */
const NOT_DRAWN_WITH_NOTES = new Set([
  'summary.people.window.start', 'summary.people.window.endExclusive',
  'costs.currency', 'costs.period.start', 'costs.period.actualThrough',
]);

test('padding any string changes nothing on the screen when the figures carry notes', async () => {
  const lookups = new Set([...LOOKUPS].filter((key) => !NOT_DRAWN_WITH_NOTES.has(key)));
  await sweep(withNotes, lookups, 46, ['Backfilled on 3 Sep.', 'The export lands on the 2nd.',
    'Generation queue is slow']);
});

/* Blanking is the other half. Every string becomes spaces at once, and the
   page must still be a page: no word that is a placeholder for an absence,
   no exception, and every section host still standing. */
const PLACEHOLDERS = /undefined|\bnull\b|NaN|Invalid Date|\[object|function\s*\(/;

for (const [name, make] of [['a ready answer', everything], ['an answer with notes', withNotes]]) {
  for (const blank of ['', ' ', '   \t\n  ']) {
    test(`${name} with every string blanked to ${JSON.stringify(blank)} is still a page that says nothing false`, async () => {
      const all = make();
      for (const key of Object.keys(all)) {
        for (const path of stringPaths(all[key])) setPath(all[key], path, blank);
      }
      const dom = await boot(all);
      const text = allText(dom.doc.getElementById('content'));
      assert.ok(!PLACEHOLDERS.test(text), 'a placeholder reached the screen: ' + text);
      assert.ok(section(dom, 'health'), 'the page went down as a whole');
      for (const heading of findAll(dom.doc.getElementById('content'), (n) => /^H[1-6]$/.test(String(n.tagName || '')))) {
        assert.notEqual(allText(heading), '', 'an empty heading was drawn');
      }
    });
  }
}
