/* Unit tests for ops/assets/pane-spend.js -- Money on the v2 design system.

   What is worth testing here is what a screenshot cannot see. The pane's
   docblock names four properties, and the first block of tests below holds
   each of them:

     - a figure with no source is words or a gap, never a zero, on a pane
       where a zero is a claim about money;
     - nothing is printed that the page cannot reproduce: the dollar change is
       drawn only when it works out to the route's own percentage, and the rows
       say so when they do not add up to the bill;
     - every figure carries how old it is, and the collection's own state;
     - month names come from the answer, not from the browser's clock.

   Then the behaviour a reviewer would otherwise have to click through: the
   picker reaches the read under each window's own name and the newest pick
   wins; a month nobody chose that has nothing yet gives way to the closed
   one, and a month somebody chose does not; the grouping switch redraws from
   the answer in hand and hands focus back; the budget is drawn only against
   the same month and its read fails soft.

   Every test here has a published mutation in the pull request: the exact
   file and line whose removal or inversion makes that test fail. A test with
   no such line pins nothing.

   ----------------------------------------------------------------------

   The fixtures are BUILT, not written.

   `payload()` in scripts/ops-spend-fixture.mjs is a port of the route's own
   assembly, driven by the same input the route is driven by: a list of billed
   group rows per usage day. Every derived member (`shareBasisPoints`,
   `changeBasisPoints`, the row order, the comparison bounds, `billedDays`,
   whether there is a forecast at all) is computed there the way the route
   computes it, so a fixture cannot carry a combination the route cannot send.
   The two `route contract` tests re-check the port's own arithmetic against
   values worked out independently of it.

   scripts/ops-api-stub.mjs serves THIS builder's answer, so every browser
   sweep and anyone looking at the pane locally sees the answer these
   assertions are made against rather than a second, hand-written one. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { makeDom, allText, findAll } from './ops-dom-harness.mjs';
import {
  hoursAgo, resolveCostPeriod, resolveComparisonWindow, GROUPS, UNGROUPED_GROUP, payload,
} from './ops-spend-fixture.mjs';
import { stub, PROOF } from './ops-api-stub.mjs';

const OPS = new URL('../ops/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, OPS), 'utf8');

const REGISTRY_SRC = read('assets/pane-registry.js');
const ARIA_SRC = read('assets/aria.js');
const SHELL_SRC = read('assets/shell-pane-v2.js');
const PANE_SRC = read('assets/pane-spend.js');
const PANE_CSS = read('assets/pane-spend-v2.css');
const PAGE_HTML = read('spend.html');

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

/* ------------------------------------------------------------ stylesheet */

/* Every rule in a stylesheet, found by what its selector list targets rather
   than by how the selector happens to be spelled. `.a, .b { ... }` is
   invisible to a regex that requires the class to be the whole selector, and
   `String.match` returning null makes the loop under it sweep zero rules and
   pass while the defect it names is live. */
function cssRules(css, media = null) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1) break;
    const prelude = src.slice(i, open).trim();
    let depth = 0;
    let end = open;
    for (; end < src.length; end += 1) {
      if (src[end] === '{') depth += 1;
      else if (src[end] === '}') { depth -= 1; if (depth === 0) break; }
    }
    const body = src.slice(open + 1, end);
    if (prelude.startsWith('@')) {
      /* Every at-rule, by what its body holds rather than by which at-rule it
         is: one holding rules is walked into, one holding declarations
         outright is a body of its own. Naming `@media` and `@supports` left
         `@keyframes` unscanned by everything below -- a colour does not stop
         being a colour for standing in an animation, and a named at-rule list
         passes every at-rule it does not name. */
      if (/\{/.test(body)) out.push(...cssRules(body, prelude));
      else if (body.trim()) {
        out.push({ selectors: [prelude], body, media, targets: (re) => re.test(prelude) });
      }
    } else if (prelude) {
      const selectors = prelude.split(',').map((s) => s.trim()).filter(Boolean);
      out.push({
        selectors,
        body,
        media,
        targets: (re) => selectors.some((s) => re.test(s)),
      });
    }
    i = end + 1;
  }
  return out;
}

const RULES = cssRules(PANE_CSS);

/* ------------------------------------------------------------- the page */

function buildPage(dom, body) {
  const el = (parent, tag, attrs) => {
    const node = dom.element(tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };
  body.setAttribute('data-pane', 'spend');
  body.className = 'is-booting';
  const boot = el(body, 'main', { class: 'gate gate-boot gate-center' });
  el(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  el(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = el(body, 'div', { class: 'gate gate-app' });
  el(appGate, 'div', { id: 'app' });
}

/* Loads the page the way ops/spend.html loads it: registry, aria.js, the
   bootstrap, then the pane module.

   `costs` is one answer for every window, or a function of the window that
   returns an answer, an Error or a promise of either -- the picker and the
   month fallback both need the answer to depend on what was asked.
   `summary` is absent by default, and absent means the read FAILS: the state
   the live API is in until the budget deploys, so the whole suite doubles as
   the control for "a summary this pane cannot read leaves the bill alone". */
async function boot(options) {
  const opts = options || {};
  const calls = [];
  const costs = opts.costs === undefined ? payload() : opts.costs;
  const summary = opts.summary === undefined ? null : opts.summary;

  const dom = makeDom({
    tokens: TOKENS,
    href: 'https://ops.example.invalid/ops/spend.html' + (opts.search || ''),
  });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body);

  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: { admin: { displayName: 'Owner', email: 'owner@example.invalid', role: 'owner' } },
    boot: () => Promise.resolve({ admin: dom.window.OpsSession.state.admin }),
    call: (endpoint, o) => {
      calls.push({ endpoint, query: o && o.query });
      if (endpoint === '/api/ops/summary') {
        if (summary === null) return Promise.reject(new Error('no stub for ' + endpoint));
        if (summary instanceof Error) return Promise.reject(summary);
        return Promise.resolve({ data: summary });
      }
      if (endpoint !== '/api/ops/costs') return Promise.reject(new Error('no stub for ' + endpoint));
      const range = o && o.query && o.query.range;
      const out = typeof costs === 'function' ? costs(range, calls.length) : costs;
      return Promise.resolve(out).then((answer) => {
        if (answer instanceof Error) throw answer;
        return { data: answer };
      });
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
  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-spend.js' });

  await ticks();
  return { ...dom, body, calls, content: dom.doc.getElementById('content') };
}

async function ticks(n = 8) {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r));
}

const costReads = (dom) => dom.calls.filter((c) => c.endpoint === '/api/ops/costs');

/* The panel the operator can see. The other three are siblings of it and are
   hidden by aria.css, so reading the whole region would read text nobody is
   looking at. */
function panel(dom, state) {
  return dom.doc.getElementById('content')
    .querySelectorAll('[data-state]')
    .filter((n) => (n.getAttribute('data-state') || '').split(' ').indexOf(state) !== -1)[0];
}

const livePanel = (dom) => panel(dom, 'live');
const emptyPanel = (dom) => panel(dom, 'empty');

/* A class by token, from `className` or from the `class` attribute, because
   an SVG node built with setAttribute has only the second. */
const classes = (node) => (String(node.className || '')
  + ' ' + String((node.getAttribute && node.getAttribute('class')) || '')).split(/\s+/);
const hasClass = (node, cls) => classes(node).indexOf(cls) !== -1;
const byClass = (root, cls) => findAll(root, (n) => hasClass(n, cls));
const byText = (root, tag, words) => findAll(root, (n) =>
  String(n.tagName).toLowerCase() === tag && String(n.textContent || '').trim() === words)[0];

/* Every text run under a node, once each. In the browser an element's text is
   a child text node; in this harness a `text` write lands on the element
   itself, so a run is "an element that carries text of its own" either way.
   What this is NOT is a count of matches in `allText`: that helper joins an
   element's text with its descendants', so a string under an ancestor that
   also carries text is counted twice. */
function runs(node) {
  const out = [];
  const take = (n) => {
    const own = String(n.textContent || '').replace(/\s+/g, ' ').trim();
    if (own) out.push(own);
  };
  if (node) take(node);
  (function walk(n) {
    for (const child of (n && n.childNodes) || []) {
      take(child);
      if (child.tagName) walk(child);
    }
  })(node);
  return out;
}

const runCount = (node, re) => runs(node).filter((run) => re.test(run)).length;

const hero = (dom) => byClass(livePanel(dom), 'mn-hero')[0];
const where = (dom) => byClass(livePanel(dom), 'mn-where')[0];
const rowsOf = (dom) => byClass(where(dom), 'mn-row');
const meta = (dom) => byClass(dom.body, 'mn-meta')[0];
const picker = (dom) => dom.doc.getElementById('fPeriod');
const stat = (dom, label) => byClass(hero(dom), 'mn-stat')
  .filter((n) => runCount(n, new RegExp('^' + label + '$')) > 0)[0];
const statValue = (node) => runs(byClass(node, 'mn-stat-value')[0]).join('');

/* Money, written independently of the pane's own formatter. */
const usd = (micros, digits = 2) => '$' + (micros / 1e6).toLocaleString('en-US', {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
});

/* A closed month, fully billed. With the fixture's default clock that is
   August 2026, compared against July. */
const closedMonth = (extra) => payload({ range: 'last-month', billedThrough: 31, ...extra });

const sum = (values) => values.reduce((a, b) => a + (b === null ? 0 : b), 0);
const seriesOf = (data, key) => data.daily.series.filter((s) => s.key === key)[0];

/* The second read, which carries the budget. Mirrors the block the summary
   route publishes: `ratioBasisPoints` is the route's own division of spend by
   target and is deliberately NOT clamped, so the pane reads it and never
   recomputes it. */
function summaryPayload(options) {
  const o = options || {};
  const spend = o.spend === undefined ? 945_710_000 : o.spend;
  const target = o.target === undefined ? 300_000_000 : o.target;
  return {
    cost: {
      range: 'month',
      window: { start: o.windowStart === undefined ? '2026-09-01' : o.windowStart },
      micros: spend,
      currency: 'USD',
      budget: {
        name: 'aria-target-monthly-budget',
        micros: target,
        currency: o.currency === undefined ? 'USD' : o.currency,
        ratioBasisPoints: Math.round((spend / target) * 10_000),
      },
    },
  };
}

/* ------------------------------------------------- the fixture port itself

   The fixture builder above is code, and code that nothing checks is the
   thing every other test here is standing on. These check its arithmetic
   against values worked out by hand from the route's rules, so a typo in the
   port cannot quietly redefine what "the route sends" means for the whole
   file. */

test('route contract: the port reproduces the route\'s own period arithmetic', () => {
  const now = new Date('2026-09-20T09:00:00.000Z');

  const month = resolveCostPeriod('month', now);
  assert.equal(month.start, '2026-09-01');
  assert.equal(month.endExclusive, '2026-09-21', 'a month to date ends tomorrow, exclusive');
  assert.equal(month.daysInPeriod, 30, 'September has 30 days');
  assert.equal(month.open, true, 'only a month to date is open, and only an open period forecasts');

  const last = resolveCostPeriod('last-month', now);
  assert.equal(last.start, '2026-08-01');
  assert.equal(last.endExclusive, '2026-09-01');
  assert.equal(last.open, false);

  const trailing = resolveCostPeriod('3m', now);
  assert.equal(trailing.daysInPeriod, 90);
  assert.equal(trailing.endExclusive, '2026-09-21');
  assert.equal(trailing.start, '2026-06-23', '90 days back from tomorrow, exclusive');
  assert.equal(trailing.open, false, 'a trailing window ends today, so it has no end still to come');

  /* The clamp. 20 days billed of a 30 day September, compared against
     August: the comparison is 20 days of August, never running into
     September. */
  const clamped = resolveComparisonWindow(month, 20);
  assert.equal(clamped.start, '2026-08-01');
  assert.equal(clamped.days, 20);
  assert.equal(clamped.endExclusive, '2026-08-21');

  /* A period billed to its own end is compared against the WHOLE period
     before it, which is longer here: 30 days of September against 31 of
     August. */
  const whole = resolveComparisonWindow(month, 30);
  assert.equal(whole.days, 31);
  assert.equal(whole.endExclusive, '2026-09-01');
});

test('route contract: the port reproduces the route\'s own row arithmetic', () => {
  const data = payload({ range: 'month', billedThrough: 10 });

  const rows = data.views.category.rows;
  const summed = rows.reduce((running, row) => running + row.micros, 0);
  assert.equal(summed, data.total.micros, 'the port must produce rows that add up to the total');

  /* Worked out independently: five groups at their own daily rate over ten
     days. If the port drifts, this is the assertion that catches it. */
  const perDay = 41000000 + 26500000 + 18800000 + 12400000 + 4300000;
  assert.equal(data.total.micros, perDay * 10);

  assert.deepEqual(rows.map((row) => row.label), [
    'AI and models', 'CI and build', 'Data',
    'Application compute', 'Platform and observability',
  ], 'rows are biggest first, which is the route\'s sort');
  assert.deepEqual(rows.map((row) => row.color), ['s1', 's2', 's3', 's4', 's5'],
    'the tone is the row index through the six series tokens');
  assert.equal(rows[0].shareBasisPoints, Math.round((41000000 / perDay) * 10000));

  assert.equal(data.period.billedDays, 10);
  assert.ok(data.forecast, 'a month to date with billed days and a positive total forecasts');
  assert.equal(data.forecast.micros, Math.round((data.total.micros / 10) * 30));
});

/* ------------------------------------------------------------- the stub */

/* Stadiora/Aria#10821. scripts/ops-api-stub.mjs is what every browser sweep
   and anyone looking locally draws this pane from. Its default is the billed
   month, and the unpublished period is kept behind `?stub=not_published`.
   Both arms are drawn by the real pane here, and the PROOF markers the
   theme-redraw check waits on are required on the billed render and forbidden
   on the empty one, so a marker the empty card also prints cannot pass as
   proof of a drawn bill. The markers are the pane's own short names for the
   route's categories, which is the half of the contract this pane owns. */
test('the shared API stub serves a billed month, and the unpublished period only on request',
  async () => {
    const billed = stub('/api/ops/costs').data;
    assert.equal(billed.availability.state, 'ready', 'the stub no longer serves a billed month');
    const empty = stub('/api/ops/costs', '?stub=not_published').data;
    assert.equal(empty.availability.state, 'not_published',
      '?stub=not_published no longer reaches the period that has not published');

    const drawn = allText((await boot({ costs: billed })).content);
    const blank = allText((await boot({ costs: empty })).content);
    assert.ok(PROOF.spend.length > 0, 'PROOF.spend names nothing');
    for (const marker of PROOF.spend) {
      assert.ok(drawn.includes(marker), `the billed month does not draw PROOF marker "${marker}"`);
      assert.ok(!blank.includes(marker), `the empty card also draws PROOF marker "${marker}"`);
    }
    assert.ok(blank.includes(empty.availability.detail),
      'the empty card does not print the detail the stub sent');
  });

/* ----------------------------------------------------- the registry entry */

function registryEntry() {
  const context = vm.createContext({ window: {} });
  vm.runInContext('var global = window;', context);
  vm.runInContext(REGISTRY_SRC, context, { filename: 'pane-registry.js' });
  return context.window.OpsPaneRegistry.PANES.spend;
}

test('Money declares no shell filter, owns its period picker, and offers the four windows the route answers',
  async () => {
    const entry = registryEntry();
    assert.equal(entry.label, 'Money');
    assert.equal(entry.range, false, 'the shell\'s range control offers windows the route refuses');
    assert.equal(entry.scope, false, 'a shared cloud bill is not split by client app');
    assert.equal(entry.env, false);
    assert.equal(entry.datedHead, true, 'the pane draws the date line under the title itself');

    const dom = await boot();
    const bars = byClass(dom.body, 'filters');
    assert.equal(bars.length, 1, 'one filter bar, made by the pane because the shell drew none');
    const selects = findAll(bars[0], (n) => String(n.tagName).toLowerCase() === 'select');
    assert.equal(selects.length, 1, 'the picker is the only control in it');
    assert.equal(selects[0].getAttribute('id'), 'fPeriod');
    assert.deepEqual(
      findAll(selects[0], (n) => String(n.tagName).toLowerCase() === 'option')
        .map((n) => n.getAttribute('value')),
      ['month', 'last-month', '3m', '12m'],
      'the route answers these four and refuses any other, so the picker offers these four');
  });

/* ---------------------------------------------------------- the picker */

test('each window the picker offers reaches the read, and when two reads cross the newest wins',
  async () => {
    const answers = {
      month: payload(),
      'last-month': closedMonth(),
      '3m': payload({ range: '3m', billedThrough: 60 }),
      '12m': payload({ range: '12m', billedThrough: 300 }),
    };
    const hold = new Map();
    const dom = await boot({
      costs: (range) => (hold.has(range) ? hold.get(range) : answers[range]),
    });
    const select = picker(dom);
    const shown = () => runs(byClass(hero(dom), 'mn-total')[0]).join('');

    assert.equal(shown(), usd(answers.month.total.micros), 'the page opens on this month');
    for (const key of ['last-month', '3m', '12m', 'month']) {
      const before = costReads(dom).length;
      select.value = key;
      select.dispatchEvent({ type: 'change' });
      await ticks();
      const reads = costReads(dom);
      assert.equal(reads.length, before + 1, 'one read per pick');
      assert.equal(reads[reads.length - 1].query.range, key,
        'a read with no range is answered with this month under a picker saying ' + key);
      assert.equal(shown(), usd(answers[key].total.micros), 'and the figures are that window\'s');
    }

    /* The slow pick is released after the fast one has already drawn. */
    let release;
    hold.set('3m', new Promise((resolve) => { release = () => resolve(answers['3m']); }));
    select.value = '3m';
    select.dispatchEvent({ type: 'change' });
    await ticks();
    select.value = 'last-month';
    select.dispatchEvent({ type: 'change' });
    await ticks();
    release();
    await ticks();
    assert.equal(shown(), usd(answers['last-month'].total.micros),
      'the older, slower read landed last and drew over the window the picker names');
    assert.equal(select.value, 'last-month');
  });

test('the pane reads once on boot, not twice', async () => {
  const dom = await boot();
  assert.equal(costReads(dom).length, 1,
    'a call from the pane plus the bootstrap\'s own ops:filters would race two answers');
  assert.equal(dom.calls.filter((c) => c.endpoint === '/api/ops/summary').length, 1);
});

test('a month nobody chose falls back to the closed one; a month somebody chose does not',
  async () => {
    const published = closedMonth();
    const nothing = payload({ range: 'month', billedThrough: 0 });
    const answers = (range) => (range === 'last-month' ? published : nothing);
    const shown = (dom) => runs(byClass(hero(dom), 'mn-total')[0]).join('');

    const implicit = await boot({ costs: answers });
    assert.deepEqual(costReads(implicit).map((c) => c.query.range), ['month', 'last-month'],
      'the first of a month has nothing billed, so the closed month is the honest latest');
    assert.equal(picker(implicit).value, 'last-month', 'and the picker says so');
    assert.equal(shown(implicit), usd(published.total.micros));

    const failing = await boot({
      costs: (range) => (range === 'last-month' ? new Error('down') : nothing),
    });
    assert.match(allText(emptyPanel(failing)), /Nothing billed yet/,
      'a fallback that fails leaves the answer already in hand rather than a failure card');
    assert.equal(picker(failing).value, 'month');

    const chosen = await boot({ costs: answers, search: '?range=month' });
    assert.deepEqual(costReads(chosen).map((c) => c.query.range), ['month'],
      'a window somebody chose is answered as asked');
    const way = byText(emptyPanel(chosen), 'button', 'Show last month');
    assert.ok(way, 'and the way out is offered');
    way.dispatchEvent({ type: 'click' });
    await ticks();
    assert.equal(costReads(chosen).pop().query.range, 'last-month');
    assert.equal(shown(chosen), usd(published.total.micros));

    const closed = await boot({ costs: () => nothing, search: '?range=last-month' });
    assert.match(allText(emptyPanel(closed)), /Nothing billed yet/);
    assert.equal(byText(emptyPanel(closed), 'button', 'Show last month'), undefined,
      'a closed month is the way out, so it is not offered a way to itself');
  });

test('month names come from the answer, not from the browser\'s clock', async () => {
  const labels = (dom) => findAll(picker(dom), (n) => String(n.tagName).toLowerCase() === 'option')
    .map((n) => String(n.textContent));

  /* The fixture's month is September 2026. The clock this test runs on is
     later, so a name taken from it is a different month. */
  assert.deepEqual(labels(await boot()),
    ['September 2026', 'August 2026', 'Last 3 months', 'Last 12 months']);
  assert.deepEqual(labels(await boot({ costs: closedMonth(), search: '?range=last-month' })),
    ['September 2026', 'August 2026', 'Last 3 months', 'Last 12 months'],
    'a closed month\'s answer says which month it is and so which one is current');
});

/* --------------------------------------------------------- the headline */

test('the headline figures are the bill\'s own, and the dollar change is drawn only when the page can reproduce it',
  async () => {
    const data = payload({ previousScale: 0.85 });
    const billed = data.period.billedDays;
    const days = seriesOf(data, 'current').values.slice(0, billed);
    const total = data.total.micros;
    const prior = sum(seriesOf(data, 'previous').values);
    const bp = data.total.changeBasisPoints;
    assert.equal(Math.round(((total - prior) / prior) * 10_000), bp,
      'the fixture\'s own change reproduces from its own series, or the test below says nothing');

    const dom = await boot({ costs: data });
    assert.deepEqual(runs(byClass(hero(dom), 'mn-total')[0]), [usd(total)]);
    assert.equal(statValue(stat(dom, 'Daily average')), usd(Math.round(total / billed)),
      'the average is the total over the days actually billed');
    assert.equal(statValue(stat(dom, 'Sep 19')), usd(days[billed - 1]),
      'the latest day is the last billed day\'s own figure');
    assert.equal(statValue(stat(dom, 'Month-end forecast')), usd(data.forecast.micros, 0));
    assert.deepEqual(runs(byClass(hero(dom), 'mn-delta')[0]), [
      '+' + usd(total - prior, 0) + ' vs Aug 1\u201319 \u00B7 ' + (bp / 100).toFixed(1) + '%',
    ]);

    const closed = await boot({ costs: closedMonth(), search: '?range=last-month' });
    assert.equal(stat(closed, 'Month-end forecast'), undefined,
      'a closed month has no end still to come, so no forecast is drawn');

    const unproved = payload({ previousScale: 0.85 });
    unproved.total.changeBasisPoints = bp + 1;
    assert.deepEqual(runs(byClass(hero(await boot({ costs: unproved })), 'mn-delta')[0]), [
      '+' + ((bp + 1) / 100).toFixed(1) + '% vs Aug 1\u201319',
    ], 'a dollar figure the page cannot stand behind is not printed beside the route\'s percentage');

    const flat = payload();
    assert.equal(flat.total.changeBasisPoints, 0, 'the default fixture bills both stretches alike');
    assert.deepEqual(runs(byClass(hero(await boot({ costs: flat })), 'mn-delta')[0]),
      ['No change vs Aug 1\u201319']);
  });

/* ----------------------------------------------------- never a zero */

test('a figure with no source is a gap or words, never a zero', async () => {
  const data = closedMonth();
  const current = seriesOf(data, 'current');
  current.values[11] = null;
  const hole = data.views.category.rows[2];
  hole.micros = null;
  delete hole.shareBasisPoints;

  const dom = await boot({ costs: data, search: '?range=last-month' });
  const chart = byClass(hero(dom), 'mn-chart')[0];
  assert.match(chart.getAttribute('aria-label'), /1 day not reported\.$/);
  assert.equal(byClass(chart, 'mn-line').length, 2,
    'the line breaks at the day with no reading rather than dropping to the floor through it');
  assert.equal(byClass(chart, 'mn-dot').length, 30, 'a day with no reading has no dot');

  const rows = rowsOf(dom);
  const blank = rows[2];
  assert.deepEqual(runs(byClass(blank, 'mn-row-amt')[0]), ['Not reported']);
  assert.equal(byClass(blank, 'mn-bar').length, 0, 'a row with no amount has no bar');
  assert.ok(!/\$0/.test(allText(blank)), 'and is not printed as a zero');
  assert.ok(allText(where(dom)).includes(
    'Some rows have no amount, so these rows do not add up to ' + usd(data.total.micros) + '.'),
  'a row that cannot be summed is itself the reason the rows do not add up');

  const none = closedMonth();
  delete none.total.micros;
  const bare = await boot({ costs: none, search: '?range=last-month' });
  assert.deepEqual(runs(byClass(hero(bare), 'mn-total')[0]), ['Not reported']);
  assert.equal(stat(bare, 'Daily average'), undefined, 'no total, no average of it');
});

test('the rows are added up on the page and the page says so only when they do not match the bill',
  async () => {
    const whole = payload();
    const clean = await boot({ costs: whole });
    assert.equal(byClass(where(clean), 'mn-note').length, 0,
      'rows that reconcile say nothing: a line stating that things add up is noise until they do not');

    const short = payload();
    const rows = short.views.category.rows.reduce((running, row) => running + row.micros, 0);
    short.total.micros += 5_000_000;
    const dom = await boot({ costs: short });
    assert.deepEqual(runs(byClass(where(dom), 'mn-note')[0]), [
      'These rows add up to ' + usd(rows) + ' of ' + usd(short.total.micros) + '.',
    ]);
  });

test('an ungrouped charge is its own named, worded line, and the AI row is the only violet one',
  async () => {
    const data = payload({ range: 'month', billedThrough: 10, groups: GROUPS.concat([UNGROUPED_GROUP]) });
    const dom = await boot({ costs: data });
    const flagged = byClass(where(dom), 'is-ungrouped');
    assert.equal(flagged.length, 1);
    assert.equal(runCount(flagged[0], /^Ungrouped$/), 1,
      'the row keeps its own label rather than being folded into a neighbour');
    assert.equal(runCount(flagged[0], /^Unmapped: no category covers these services yet$/), 1,
      'what is wrong with the row is words, not a tone, which says nothing to a reader who '
      + 'cannot see it');
    assert.equal(byClass(where(dom), 'mn-note').length, 0, 'and it is inside the sum');

    const ai = byClass(where(dom), 'is-ai');
    assert.equal(ai.length, 1);
    assert.equal(runCount(ai[0], /^AI & models$/), 1,
      'the route\'s ai_and_models category is the one the mock draws in violet');

    byText(where(dom), 'button', 'Service').dispatchEvent({ type: 'click' });
    assert.equal(byClass(where(dom), 'is-ai').length, 0,
      'a service row is not a category, so none of them is the AI one');
  });

/* ------------------------------------------------------------- the chart */

test('the y axis tops out above the highest day, so the peak never touches the top', async () => {
  const data = closedMonth();
  const current = seriesOf(data, 'current');
  current.values = current.values.map((_, i) => (i % 2 ? 20_000_000 : 10_000_000));

  const dom = await boot({ costs: data, search: '?range=last-month' });
  const chart = byClass(hero(dom), 'mn-chart')[0];
  const labels = byClass(chart, 'mn-y').map((n) => Number(String(n.textContent).replace('$', '')));
  assert.equal(labels[0], 0, 'the baseline is zero');
  assert.ok(Math.max(...labels) > 20, 'the top tick is above a peak that is itself a round number');
  const peak = byClass(chart, 'mn-dot').map((n) => Number.parseFloat(n.style.top));
  assert.ok(Math.min(...peak) > 0, 'so the highest dot is inside the plot');
});

test('the chart is named with its own data, and its scale is HTML beside it, never text inside it',
  async () => {
    const data = payload();
    const dom = await boot({ costs: data });
    const chart = byClass(hero(dom), 'mn-chart')[0];
    const days = seriesOf(data, 'current').values.slice(0, data.period.billedDays);
    const billed = data.period.billedDays;
    assert.equal(chart.getAttribute('role'), 'img');
    assert.equal(chart.getAttribute('aria-label'),
      'Daily spend, Sep 1 to Sep ' + billed + '. Lowest ' + usd(Math.min(...days))
      + ', highest ' + usd(Math.max(...days)) + ', latest ' + usd(days[billed - 1])
      + '. Daily average ' + usd(Math.round(data.total.micros / billed)) + '.',
      'role="img" hides its children from a screen reader, so the name carries the data');
    assert.equal(findAll(chart, (n) => String(n.tagName).toLowerCase() === 'text').length, 0,
      'a <text> inside the figure is announced to nobody');
    assert.ok(byClass(chart, 'mn-y').length >= 2 && byClass(chart, 'mn-x').length >= 2,
      'the scale is drawn beside the line as HTML');
  });

/* --------------------------------------------------------- the switch */

test('switching grouping redraws from the answer in hand, and hands focus back only when it was on the switch',
  async () => {
    const data = payload({ range: 'month', billedThrough: 10 });
    const dom = await boot({ costs: data });
    const before = costReads(dom).length;
    const pressed = () => findAll(where(dom), (n) => n.getAttribute('aria-pressed') === 'true')
      .map((n) => String(n.textContent));
    assert.deepEqual(pressed(), ['Category']);

    const click = byText(where(dom), 'button', 'Resource group');
    assert.notEqual(dom.doc.activeElement, click);
    const elsewhere = dom.doc.activeElement;
    click.dispatchEvent({ type: 'click' });
    assert.equal(dom.doc.activeElement, elsewhere,
      'a pointer switch does not move focus, because it was not on the switch');
    assert.deepEqual(pressed(), ['Resource group']);
    assert.equal(rowsOf(dom).length, data.views.resourceGroup.rows.length,
      'the rows are the other cut of the same bill');
    assert.equal(costReads(dom).length, before, 'two cuts of one bill need one read, not two');

    const key = byText(where(dom), 'button', 'Service');
    key.focus();
    key.dispatchEvent({ type: 'click' });
    const after = dom.doc.activeElement;
    assert.ok(after && after !== dom.body, 'focus did not fall off the document');
    assert.equal(after.getAttribute('data-view'), 'service',
      'the redraw destroyed the pressed button, so a keyboard operator is put on its replacement');
    assert.equal(after.getAttribute('aria-pressed'), 'true');
  });

test('no view is offered that the answer did not carry, and a lone one is not a switch', async () => {
  const two = payload({ range: 'month', billedThrough: 10 });
  two.views.service.rows = [];
  const dom = await boot({ costs: two });
  assert.deepEqual(findAll(where(dom), (n) => n.getAttribute('data-view') !== null)
    .map((n) => String(n.textContent)), ['Category', 'Resource group']);

  const one = payload({ range: 'month', billedThrough: 10 });
  one.views.service.rows = [];
  one.views.resourceGroup.rows = [];
  assert.equal(byClass(where(await boot({ costs: one })), 'mn-switch').length, 0);
});

/* ------------------------------------------------------------- the budget */

test('the budget is drawn only against the same month, from the route\'s own ratio, and its read fails soft',
  async () => {
    const data = payload();
    const over = summaryPayload();
    const under = summaryPayload({ spend: 572_000_000, target: 650_000_000 });
    assert.ok(over.cost.budget.ratioBasisPoints > 10_000 && under.cost.budget.ratioBasisPoints < 10_000,
      'one answer is past the target and one is short of it, or the pair is one branch twice');

    const past = await boot({ costs: data, summary: over });
    assert.equal(statValue(stat(past, '\\$300 budget')),
      usd(over.cost.micros - over.cost.budget.micros, 0) + ' over');

    const short = await boot({ costs: data, summary: under });
    assert.equal(statValue(stat(short, 'of \\$650 budget')),
      under.cost.budget.ratioBasisPoints / 100 + '%',
      'the published ratio is read, never recomputed');

    const other = await boot({ costs: data, summary: summaryPayload({ windowStart: '2026-08-01' }) });
    assert.ok(!/budget/.test(allText(hero(other))),
      'a target for another month beside this window is two different questions in one tile');

    const unnamed = await boot({ costs: data, summary: summaryPayload({ currency: null }) });
    assert.ok(!/budget/.test(allText(hero(unnamed))),
      'a target with no denomination of its own is not read as the currency the bill is in');

    const refused = await boot({ costs: data, summary: new Error('refused') });
    assert.deepEqual(runs(byClass(hero(refused), 'mn-total')[0]), [usd(data.total.micros)],
      'a summary the API refused must not turn a good bill into a failure');
  });

/* ----------------------------------------------- how old, and how complete */

test('the age of the answer is on screen once the publishing cycle is missed twice over, against the answer\'s own lag',
  async () => {
    const fresh = await boot({ costs: payload({ asOf: hoursAgo(5) }) });
    assert.ok(!/behind/.test(allText(meta(fresh))), 'a normal cycle says nothing');

    const stale = await boot({ costs: payload({ asOf: hoursAgo(40) }) });
    assert.match(allText(meta(stale)), /\b4\d hours behind\b/);

    const slow = payload({ asOf: hoursAgo(40) });
    slow.publishLagHours = 48;
    assert.ok(!/behind/.test(allText(meta(await boot({ costs: slow })))),
      'the threshold is the route\'s own lag doubled, not a constant in the pane');
    const quick = payload({ asOf: hoursAgo(10) });
    quick.publishLagHours = 4;
    assert.match(allText(meta(await boot({ costs: quick }))), /\b10 hours behind\b/);

    const unstamped = await boot({ costs: payload({ asOf: null }) });
    assert.match(allText(meta(unstamped)), /No collection time/,
      'an answer with no collection time says that rather than printing nothing');
  });

test('the poller\'s own state is shown beside a fresh figure, in the route\'s words when it sends them',
  async () => {
    const cases = [
      [{ state: 'failed', detail: 'The last 3 cost collections failed.' },
        /The last 3 cost collections failed\./],
      [{ state: 'failed' }, /Collection failing, showing the last good figures/],
      [{ state: 'disabled' }, /Collection switched off/],
      [{ state: 'something_new' }, /Collection needs attention/],
      [{ state: 'failed', detail: 'Ask ops@example.com' }, /\[hidden contact detail\]/],
    ];
    for (const [staleness, expected] of cases) {
      const dom = await boot({ costs: payload({ staleness }) });
      assert.match(allText(meta(dom)), expected);
      assert.ok(!/behind/.test(allText(meta(dom))),
        'fresh and broken are different facts, and the pill says only the second');
    }
    const ok = await boot({ costs: payload({ staleness: { state: 'ok' } }) });
    assert.ok(!/Collection/.test(allText(meta(ok))), 'a poller doing its job is not given a pill');
  });

test('the line beside the picker says how far the bill reaches, and counts days only when a window should have been whole',
  async () => {
    const open = await boot({ costs: payload() });
    assert.deepEqual(runs(meta(open)), ['USD \u00B7 Billed through Sep 19'],
      'the open month is always short of its own end, which "Billed through" already says');

    const trailing = payload({ range: '3m', billedThrough: 70 });
    const partial = await boot({ costs: trailing, search: '?range=3m' });
    assert.deepEqual(runs(meta(partial)),
      ['USD \u00B7 Billed through Aug 31 \u00B7 70 of 90 days billed']);

    const whole = await boot({ costs: closedMonth(), search: '?range=last-month' });
    assert.deepEqual(runs(meta(whole)), ['USD \u00B7 Billed through Aug 31'],
      'a window billed in full does not repeat what its name says');
  });

test('the date line under the title is the answer\'s own UTC collection time, and only when there is a bill to date',
  async () => {
    const before = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      const asOf = '2026-09-21T03:30:00.000Z';
      const sub = (dom) => allText(dom.doc.getElementById('pageSub'));

      const dom = await boot({ costs: payload({ asOf }) });
      assert.equal(sub(dom), 'Mon, Sep 21, 2026 Updated 03:30 UTC',
        'west of Greenwich this instant is still Sunday, and the page names the UTC day');

      const waiting = await boot({
        costs: payload({ range: 'month', billedThrough: 0, asOf }), search: '?range=month',
      });
      assert.match(sub(waiting), /Updated 03:30 UTC/,
        'a period waiting on the export is exactly when the collection time matters');
      assert.ok(!/Billed through|days billed/.test(runs(meta(waiting)).join(' ')),
        'and with nothing billed there is nothing to say about how far');

      const mixed = await boot({ costs: payload({ currencies: ['USD', 'EUR'], asOf }) });
      assert.equal(sub(mixed), '', 'a state that says there is no bill has no collection to report');
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

/* ------------------------------------------------------------- the states */

test('each availability state the route can send gets its own title and the route\'s own sentence',
  async () => {
    const detail = (state) => state.availability.detail;
    const states = {
      not_published: payload({ range: 'last-month', billedThrough: 0 }),
      unconfigured: payload({ range: 'last-month', billedThrough: 0, pollerState: { status: 'unconfigured' } }),
      disabled: payload({ range: 'last-month', billedThrough: 0, pollerState: { status: 'disabled' } }),
      mixed_currency: payload({ range: 'last-month', currencies: ['USD', 'EUR'] }),
    };
    const titles = new Set();
    for (const [state, answer] of Object.entries(states)) {
      assert.equal(answer.availability.state, state, 'the fixture reached the state it is named for');
      const dom = await boot({ costs: answer, search: '?range=last-month' });
      assert.ok(!livePanel(dom) || byClass(livePanel(dom), 'mn-hero').length === 0,
        'no total is drawn for a period with no single bill');
      const words = allText(emptyPanel(dom));
      assert.ok(words.includes(detail(answer)), 'the route\'s own sentence is printed: ' + state);
      titles.add(runs(byClass(emptyPanel(dom), 'state-title')[0] || emptyPanel(dom))[0]);
    }
    assert.equal(titles.size, 4, 'four states are four different titles rather than one');

    const unknown = payload({ range: 'last-month', billedThrough: 0 });
    unknown.availability.state = 'something_new';
    unknown.availability.detail = 'Ask ops@example.com';
    const dom = await boot({ costs: unknown, search: '?range=last-month' });
    const words = allText(emptyPanel(dom));
    assert.match(words, /not one this pane can read/,
      'a state outside the vocabulary is not read as the nearest known one');
    assert.ok(!/ops@example\.com/.test(words) && /hidden contact detail/.test(words),
      'and the route\'s detail is masked on the way out');
  });

test('a read that fails says so, draws no figure, and the retry reads again', async () => {
  const dom = await boot({ costs: new Error('the cost store did not answer') });
  const text = allText(dom.content);
  assert.match(text, /Try again/);
  assert.ok(!/\$\d/.test(text), 'a failed read is not drawn as a bill');
  const reads = costReads(dom).length;
  byText(dom.content, 'button', 'Try again').dispatchEvent({ type: 'click' });
  await ticks();
  assert.equal(costReads(dom).length, reads + 1);
});

/* ------------------------------------------------------------- the page */

test('the page loads the v2 system and none of v1', () => {
  assert.match(PAGE_HTML, /assets\/aria\.css/);
  assert.match(PAGE_HTML, /assets\/shell-pane-v2\.css/);
  assert.match(PAGE_HTML, /assets\/pane-spend-v2\.css/);
  assert.match(PAGE_HTML, /assets\/shell-pane-v2\.js/);
  assert.match(PAGE_HTML, /assets\/pane-spend\.js/);
  assert.match(PAGE_HTML, /<title>Money \| Aria Operations<\/title>/);
  for (const v1 of ['assets/ops.css', 'assets/operate.css', 'assets/shell.js']) {
    assert.ok(!PAGE_HTML.includes(v1),
      v1 + ' defines .card, .rail and .btn from a different token set; a page loading both is '
      + 'subtly and unfixably wrong');
  }
});

test('the page carries a strict policy and names its pane', () => {
  assert.match(PAGE_HTML, /Content-Security-Policy/);
  assert.match(PAGE_HTML, /script-src 'self'/);
  assert.match(PAGE_HTML, /style-src 'self'/);
  assert.ok(!/unsafe-inline/.test(PAGE_HTML), 'no inline script or style is allowed on this page');
  assert.match(PAGE_HTML, /<body data-pane="spend"/);
});

/* ------------------------------------------------------ what the module writes */

/* Comments stripped first. The module's own docblock says it uses no
   innerHTML, so a guard over the raw file matches that sentence and passes
   whatever the code does. */
const PANE_CODE = PANE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* Every spelling that turns a value into markup, not the one this module
   happens not to use. A guard that names `innerHTML` alone passes
   `outerHTML`, `insertAdjacentHTML` and `document.write`, which are the same
   defect typed differently. */
const MARKUP_WRITE = /innerHTML|outerHTML|insertAdjacentHTML|document\s*\.\s*write/;

/* A style ATTRIBUTE, which `ops/spend.html`'s `style-src 'self'` forbids,
   in the two ways this module could write one: by name, and as an option key
   to `h()` or `svgEl()`. Both of those helpers `setAttribute` every key that
   is not `className` or `text`, so `h('div', { style: '...' })` writes a
   literal style attribute through the module's own primary idiom -- a
   spelling `setAttribute('style'` cannot see. Quoted keys and a key on its own
   line are the same defect, so the pattern allows for both.

   NOT COVERED, deliberately: `element.style.setProperty(...)`. The module
   does that on purpose -- a bar's width, and a gridline's, a dot's, a label's
   and a date's offset in the plot, all lengths computed from the answer --
   and CSSOM is not gated by the policy. The test below pins that exception
   rather than trusting it: every `.style` contact in the module must be a
   `setProperty` call for `width`, `top` or `left`, and the RENDERED pane is
   swept for every inline property on every element, so a fourth property is a
   length this file has not reasoned about and has to be argued for. Also not
   covered: an attribute name assembled at runtime, which no source scan can
   see and which the page's own policy is the enforcement for. And three
   further spellings, verified SURVIVED rather than assumed: a namespaced
   `setAttributeNS(null, 'style', ...)`, a capitalised `Style:` key on `h()`
   (HTML lowercases attribute names, so it writes a real style attribute), and
   `document.createRange().createContextualFragment(...)`. This module writes
   none of the three, and widening an analyzer to reach them adds guard code
   nothing has reviewed; they are recorded here rather than matched. All three
   write a style ATTRIBUTE, which the page's own `style-src 'self'` refuses,
   so a browser is the backstop behind this record. */
const STYLE_ATTR_WRITE = /setAttribute\(\s*['"]style['"]|[{,]\s*['"]?style['"]?\s*:/;

test('the pane module writes no markup and no style attribute, and sets only three lengths through CSSOM',
  () => {
    assert.ok(/innerHTML/.test(PANE_SRC),
      'the docblock explains why there is none, so the raw file DOES carry the word: this asserts '
      + 'the guard below is reading stripped code rather than passing vacuously');

    /* A positive control per clause, so the widened guard cannot claim a
       spelling it does not actually see. */
    const CAUGHT = [
      ['node.innerHTML = value;', MARKUP_WRITE],
      ['node.outerHTML = markup;', MARKUP_WRITE],
      ['node.insertAdjacentHTML(\'beforeend\', markup);', MARKUP_WRITE],
      ['document.write(markup);', MARKUP_WRITE],
      ['node.setAttribute(\'style\', \'color: red\');', STYLE_ATTR_WRITE],
      ['h(\'div\', { className: \'x\', style: \'color: red\' })', STYLE_ATTR_WRITE],
      ['h(\'div\', {\n      className: \'x\',\n      style: bar\n    })', STYLE_ATTR_WRITE],
      ['svgEl(\'path\', { \'style\': \'fill: red\' })', STYLE_ATTR_WRITE],
    ];
    CAUGHT.forEach((pair) => {
      assert.ok(pair[1].test(pair[0]), 'the guard cannot see this spelling: ' + pair[0]);
    });

    assert.ok(!MARKUP_WRITE.test(PANE_CODE),
      'the pane shows production data to an administrator; no value may become markup');
    assert.ok(!STYLE_ATTR_WRITE.test(PANE_CODE),
      'a style attribute is forbidden by the page\'s own policy');

    const CSSOM_LENGTH = /^\.style\s*\.\s*setProperty\(\s*'(?:width|top|left)'/;
    [["  .style.setProperty('position', 'static');", false],
      ['  .style.setProperty(\'margin-left\', \'24px\');', false],
      ['  .style.marginLeft = \'24px\';', false],
      ["  .style.setProperty('left', value);", true],
    ].forEach((pair) => {
      assert.equal(CSSOM_LENGTH.test(pair[0].trim()), pair[1],
        'the CSSOM clause reads this spelling wrong: ' + pair[0].trim());
    });

    const contacts = PANE_CODE.match(/\.style\b[\s\S]{0,34}/g) || [];
    contacts.forEach((contact) => {
      assert.match(contact, CSSOM_LENGTH,
        'CSSOM is allowed for a computed width, top or left and nothing else. Any other property '
        + 'set this way is invisible to the stylesheet allowlist: ' + contact);
    });
    assert.equal(contacts.length, 10,
      'ten contacts: a bar\'s width; a gridline\'s and its label\'s top; a vertical guide\'s left; '
      + 'a dot\'s left and top; the end value\'s left and top; the average label\'s top; a date\'s left');

    assert.ok(!/\bstyle\s*=/.test(PAGE_HTML), 'and none is written into the page either');
  });

/* The source clause above reads the literal text `.style`, so it sees the
   spelling this module uses and no other: `cell['style']`, a key built at
   runtime and a bound `setProperty` all end at the same style object and all
   walk past it. So the property axis is pinned a second time, by the RESULT.
   Every route into an element's inline style ends at one object, and this
   reads that object on every element the pane rendered, starting at the
   document element rather than at the pane's region because a write does not
   have to land on a node the pane built to matter.

   Three renders, chosen for their branches: an open month (the average line
   and the dot per day), a three month window (more days than the dot limit,
   so only the last is marked) and a month with a gap in it. What this does NOT
   cover: a property set from a branch none of them takes, and a write that
   never reaches the fake DOM. */
test('the rendered pane carries only the lengths it computes, each on the element it belongs to',
  async () => {
    const METHODS = ['setProperty', 'removeProperty'];
    const propsOn = (node) => Object.keys(node.style || {}).filter((n) => METHODS.indexOf(n) === -1);
    const entries = (root) => [root].concat(findAll(root, () => true))
      .filter((node) => node.tagName)
      .map((node) => ({ node, props: propsOn(node) }))
      .filter((one) => one.props.length > 0);

    /* Which properties each kind of element is allowed to carry, and no other
       element may carry any. */
    const BELONGS = {
      'mn-grid': ['top'], 'mn-y': ['top'], 'mn-vgrid': ['left'], 'mn-x': ['left'],
      'mn-dot': ['left', 'top'], 'mn-val': ['left', 'top'], 'mn-avg-label': ['top'],
    };

    const gap = closedMonth();
    seriesOf(gap, 'current').values[5] = null;
    const renders = [
      { costs: payload() },
      { costs: payload({ range: '3m', billedThrough: 80 }), search: '?range=3m' },
      { costs: gap, search: '?range=last-month' },
    ];
    for (const one of renders) {
      const dom = await boot(one);
      const loading = panel(dom, 'loading');
      const inLoading = new Set([loading].concat(findAll(loading, () => true)));
      entries(loading).forEach((entry) => {
        assert.deepEqual(entry.props, ['height'], 'the shell\'s skeleton sets a bar height and nothing else');
      });

      const written = entries(dom.doc.documentElement).filter((entry) => !inLoading.has(entry.node));
      let bars = 0;
      const seen = {};
      written.forEach(({ node, props }) => {
        if (String(node.tagName).toLowerCase() === 'i' && hasClass(node.parentNode, 'mn-bar')) {
          assert.deepEqual(props, ['width'], 'a share bar\'s fill carries a width');
          bars += 1;
          return;
        }
        const kind = Object.keys(BELONGS).filter((cls) => hasClass(node, cls))[0];
        assert.ok(kind, 'an inline length on an element that has no reason to carry one: '
          + String(node.tagName) + '.' + String(node.className) + ' ' + props.join(','));
        assert.deepEqual(props.slice().sort(), BELONGS[kind], kind + ' carries ' + BELONGS[kind].join(' and '));
        seen[kind] = (seen[kind] || 0) + 1;
      });

      const data = one.costs;
      const rows = data.views.category.rows.filter((row) => row.micros > 0 && row.shareBasisPoints !== undefined);
      assert.equal(bars, rows.length, 'one bar per row that has an amount and a share');
      assert.equal(seen['mn-grid'], seen['mn-y'], 'a number per gridline, and a gridline per number');
      assert.equal(seen['mn-vgrid'], seen['mn-x'], 'a guide per date, and a date per guide');
      const present = seriesOf(data, 'current').values
        .slice(0, data.period.billedDays).filter((v) => v !== null).length;
      assert.equal(seen['mn-dot'], present > 62 ? 1 : present,
        'a dot per day with a reading, or only the last past the dot limit');
      assert.equal(seen['mn-val'], 1, 'one value, on the last day');
      assert.equal(seen['mn-avg-label'], 1);
    }
  });

/* ------------------------------------------------------------- the sheet */

test('the two columns stack on a narrow screen, and a long Azure name cannot widen the page',
  () => {
    const wide = RULES.filter((r) => !r.media && r.targets(/^\.mn-layout$/))[0];
    assert.ok(wide, '.mn-layout is styled');
    assert.match(wide.body, /grid-template-columns:\s*minmax\(0,\s*2fr\)\s*minmax\(0,\s*1fr\)/,
      'a grid track that is not `minmax(0, ...)` sizes to its content, so one long service name '
      + 'takes the whole page sideways instead of wrapping inside its own card');
    const narrow = RULES.filter((r) => r.media && /max-width:\s*980px/.test(r.media)
      && r.targets(/^\.mn-layout$/))[0];
    assert.ok(narrow, 'the layout has a narrow arm');
    assert.match(narrow.body, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);

    const name = RULES.filter((r) => r.targets(/^\.mn-row-name$/))[0];
    assert.ok(name, 'the row name is styled');
    assert.match(name.body, /overflow-wrap:\s*anywhere/,
      'Azure names the service and some of the names have no space to break at');
  });

test('nothing that carries a figure is dropped from the narrow layout', () => {
  const narrow = RULES.filter((r) => r.media && /max-width/.test(r.media));
  assert.ok(narrow.length > 0, 'the stylesheet has a narrow layout');
  const dropped = narrow.filter((r) => r.targets(/\.mn-(?:total|delta|stat|row-amt|chart)\b/)
    && /display:\s*none/.test(r.body));
  assert.deepEqual(dropped, [],
    'a figure hidden for width is a figure the phone reader never had');
});

/* ------------------------------------------- colour values in the sheet

   What may stand in a colour slot here is a theme token, the absence of a
   colour, and the geometry that shares a shorthand with one. Everything else
   is a colour this pane invented.

   Scanned as an allowlist over declaration VALUES rather than as a list of
   spellings, because a guard that names the spellings it knows passes every
   spelling it does not: a CSS named colour, an `oklch()` and a `color-mix()`
   carrying a raw colour all walk through a `#hex`-and-`rgb(`-only match.
   Values rather than the whole file, because a selector may legitimately
   carry a colour word -- `.sp-tan` names no colour -- and a property name may
   not be scanned as its own value.

   Beside it, NOT instead of it, the spelling match this test used to be: see
   `rawColourSpellings()` below. The value scan replaced it once and lost
   coverage doing so, which is the shape of defect this file exists to catch
   in the pane. A union cannot lose what a clause already had.

   NOT COVERED by either clause: ANY spelling the spelling clause cannot read
   -- a CSS named colour, an `oklch()`, a `lab()`, a `color-mix()`, which is
   to say everything but a hex and the `rgb()`/`hsl()` families in any case --
   standing in a property whose name carries none of the words `COLOUR_SLOT`
   gates on. `text-decoration: underline crimson` is the shape, and
   `text-emphasis` and `mask-image` are the same shape; naming only the NAMED
   colour here read as a narrower hole than it is. The spelling clause has no
   property gate but reads only those two families, and the value scan reads
   any spelling but only where it is looking, so the uncovered set is the
   intersection. The gate is what decides it, not the property: the same
   `crimson` in `border-bottom` is caught, and a hex in `text-decoration` is
   caught. Both clauses are case-blind, so an UPPERCASE spelling of anything
   here is covered exactly as its lowercase twin is -- `COLOUR_SLOT` is
   tested against a lowercased property, `COLOURLESS_WORDS` against a
   lowercased word, and the spelling clause carries `i`. Widening the gate to
   every property means allowlisting every geometry word in CSS, which is a
   larger guard than the sheet it guards. */
const COLOUR_SLOT = /(^--)|color|background|border|outline|fill|stroke|shadow|rule|filter/;

const COLOURLESS_WORDS = new Set([
  'none', 'solid', 'dashed', 'dotted', 'double', 'inset', 'outset', 'hidden',
  'transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'revert', 'auto',
  'round', 'square', 'butt', 'miter', 'bevel', 'evenodd', 'nonzero',
  'repeat', 'no-repeat', 'space', 'center', 'cover', 'contain',
  'border-box', 'padding-box', 'content-box', 'collapse', 'separate',
  /* The filter functions, so `filter` can be gated for the colour one of
     them takes without every blur in the sheet reading as a colour. */
  'blur', 'brightness', 'contrast', 'drop-shadow', 'grayscale', 'hue-rotate',
  'invert', 'opacity', 'saturate', 'sepia',
  /* The gradient functions, for the same reason and with the same reach: the
     NAME is not a colour, and the stops inside it are still read by the
     residue that is left after it goes. `linear-gradient(90deg, #fff, red)`
     still leaves `hex` and `red` behind and is still caught -- there is a
     control for exactly that below. Needed because this sheet's budget track
     paints two of them: a fill and, for the over-target segment, a
     repeating hatch that is what keeps colour from being the only thing
     saying "past the target". */
  'linear-gradient', 'repeating-linear-gradient',
  'radial-gradient', 'repeating-radial-gradient',
  'conic-gradient', 'repeating-conic-gradient',
  /* And `light-dark()`, on exactly the same terms: the name is not a colour
     and both of its arguments are still read. The budget track's target mark
     uses it to take the darker token in each theme, because --ink is
     near-black in one and near-white in the other while the two segments it
     separates are mid-luminance in both. Controlled below in both
     directions -- a raw colour in either argument is still caught. */
  'light-dark',
]);

/* Strips the two things allowed to WRAP a value -- a token reference, and a
   `color-mix()` whose own arguments are then scanned -- plus the lengths and
   numbers that share colour shorthands. Whatever is left is examined. A
   `color-mix(in srgb, var(--ink) 22%, transparent)` reduces to nothing and
   passes; `color-mix(in srgb, white 40%, transparent)` leaves `white`.

   A `var()` FALLBACK survives the strip, because a fallback is a value the
   page can paint -- `var(--nope, crimson)` renders crimson -- and this sheet
   ships the idiom twice (`stroke: var(--c, var(--cyan))`). Only the token
   reference itself goes.

   A hex becomes a word before the lengths go, because `#333` is all digits
   and the length sweep would otherwise leave a bare `#` with nothing to
   flag. */
function colourResidue(value) {
  let out = value;
  let before;
  do {
    before = out;
    out = out
      .replace(/var\(\s*--[a-z0-9-]+\s*\)/gi, ' ')
      .replace(/var\(\s*--[a-z0-9-]+\s*,/gi, ' ( ');
  } while (out !== before);
  return out
    .replace(/color-mix\(\s*in\s+[a-z-]+\s*,/gi, ' ')
    .replace(/#[0-9a-f]{3,8}\b/gi, ' hex ')
    .replace(/[\d.]+(px|rem|em|ex|ch|%|s|ms|deg|fr|vh|vw|vmin|vmax|pt)?/gi, ' ');
}

/* The other clause: the spelling match, over the whole comment-stripped
   sheet. No property gate, no value parsing, no scope -- which is exactly
   what makes it worth keeping beside the value scan. It sees a hex wherever
   it stands: in a property nothing thought to list (`filter: drop-shadow(0 0
   2px #2b7fff)`), inside a `var()` fallback, inside a `@keyframes` body, and
   spelled with no letters at all (`#333`), which the value scan's length
   sweep eats. It reads both families in ANY case -- CSS function names are
   case-insensitive, so `RGB(` paints exactly what `rgb(` paints, and a match
   that reads only one of them is a spelling guard with a spelling hole. What
   it cannot see is every OTHER spelling -- a CSS named colour, an `oklch()`,
   a `lab()`, a `color-mix()` -- and that is the value scan's half of the
   union. */
function rawColourSpellings(css) {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [
    ...(body.match(/#[0-9a-fA-F]{3,8}\b/g) || []),
    ...(body.match(/\b(?:rgb|rgba|hsl|hsla)\(/gi) || []),
  ];
}

/* Every colour value a body of declarations states outright, as
   `property: value` strings so a failure names the site rather than a count. */
function colourValues(body) {
  const found = [];
  body.split(';').forEach((decl) => {
    const at = decl.indexOf(':');
    if (at === -1) return;
    const prop = decl.slice(0, at).trim().toLowerCase();
    const value = decl.slice(at + 1).trim();
    if (!prop || !value || !COLOUR_SLOT.test(prop)) return;
    const residue = colourResidue(value);
    const words = (residue.match(/[a-z][a-z0-9-]*/gi) || [])
      .filter((word) => !COLOURLESS_WORDS.has(word.toLowerCase()));
    if (/#[0-9a-f]/i.test(residue) || words.length) found.push(prop + ': ' + value);
  });
  return found;
}

test('the stylesheet introduces no colour value of its own', () => {
  /* A positive control per spelling, so neither clause can claim a reach it
     does not have -- and the legitimate forms alongside, because a guard that
     flags everything is as useless as one that flags nothing.

     An all-numeric hex is in here because it was NOT: the list carried
     `#2b7fff` and `#FFF`, both of which have letters in them, and the one
     spelling it did not contain was the one spelling the value scan could not
     see. A control list only proves what it contains. */
  const CAUGHT = [
    'background: #2b7fff', 'color: #FFF', 'background: #333', 'color: #112233',
    'background: white',
    'stroke: rgb(0, 0, 0)', 'color: rgba(0,0,0,.4)', 'background: hsl(210 90% 60%)',
    'background: oklch(0.72 0.19 250)', 'color: lab(50% 40 59)',
    'background: color-mix(in srgb, white 40%, transparent)',
    '--c: crimson', 'border-top: 1px solid #2b7fff', 'box-shadow: 0 1px 2px rgba(0,0,0,.4)',
    /* A colour in a property the gate has to name to reach. */
    'filter: drop-shadow(0 0 2px #2b7fff)', 'filter: drop-shadow(0 0 2px crimson)',
    'column-rule: 1px solid crimson',
    /* A colour standing in a token reference's fallback, which paints. */
    'background: var(--nope, #ff0000)', 'background: var(--nope, crimson)',
    'stroke: var(--c, #ff0000)',
    /* A colour standing inside a gradient, whose FUNCTION NAME is allowed
       above. Allowing the name must not allow the stops: both families, so
       neither clause of the union is what is carrying this alone. */
    'background: linear-gradient(90deg, #ff0000, transparent)',
    'background: linear-gradient(90deg, crimson, transparent)',
    'background: repeating-linear-gradient(135deg, #333 0 5px, transparent 5px 10px)',
    'background: repeating-linear-gradient(135deg, rebeccapurple 0 5px, transparent 5px 10px)',
    /* A colour standing in either argument of `light-dark()`, whose name is
       allowed above. Both arguments, because allowing the name must not make
       either side of it a place to hide a colour. */
    'border-right: 2px solid light-dark(#333, var(--bg))',
    'border-right: 2px solid light-dark(var(--ink), crimson)',
  ];
  CAUGHT.forEach((decl) => {
    assert.equal(colourValues(decl + ';').length, 1, 'the guard cannot see: ' + decl);
  });
  const ALLOWED = [
    'color: var(--ink)', 'background: var(--c, var(--cyan))', 'fill: none',
    'border-top: 1px solid var(--line)', 'stroke-width: 1', '--c: var(--cyan)',
    'background: color-mix(in srgb, var(--ink) 22%, transparent)',
    'background: transparent', 'color: currentColor', 'border-radius: 20px',
    'stroke: var(--c, var(--cyan))', 'filter: blur(6px)',
    'filter: drop-shadow(0 1px 2px var(--line))',
    /* The two the budget track actually paints, verbatim in shape: a token
       gradient and the over-target hatch layered over a tint. */
    'background: linear-gradient(90deg, color-mix(in srgb, var(--cyan) 65%, transparent), var(--cyan))',
    'background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--rose) 62%, transparent) 0 5px, transparent 5px 10px), color-mix(in srgb, var(--rose) 26%, transparent)',
    /* And the target mark, verbatim in shape. */
    'border-right: 2px solid light-dark(var(--ink), var(--bg))',
  ];
  ALLOWED.forEach((decl) => {
    assert.deepEqual(colourValues(decl + ';'), [], 'the guard mis-reads: ' + decl);
  });

  /* Scope, as its own control: a declaration is read wherever the sheet puts
     it, and an at-rule that holds no rules is still a body. */
  const nested = cssRules(
    '@media (max-width: 9px) { .a { color: crimson; } }'
    + '@supports (color: oklch(0 0 0)) { .b { color: crimson; } }'
    + '@keyframes k { to { background: crimson; } }'
    + '@font-face { font-family: X; src: url(a.woff2); }'
  );
  assert.deepEqual(
    nested.flatMap((rule) => colourValues(rule.body)),
    ['color: crimson', 'color: crimson', 'background: crimson'],
    'a colour does not stop being a colour for standing inside an at-rule'
  );

  /* The spelling clause, controlled on its own: every hex shape including the
     all-numeric one, both function families, and a sheet where the only hex
     is in a comment.

     In BOTH cases, because CSS function names and hex digits are
     case-insensitive and the clause was not: `RGB(` painted what `rgb(`
     paints and walked through a match spelled `/g` rather than `/gi`. A
     spelling guard with a spelling hole is the shape of defect this whole
     test exists to catch, so the case pairs are built by derivation rather
     than typed -- a new entry above gets its uppercase twin for free. */
  const SPELLINGS = ['#333', '#112233', '#2b7fff', '#FFF', 'rgb(0,0,0)', 'rgba(0,0,0,.4)',
    'hsl(210 90% 60%)', 'hsla(210 90% 60% / .4)'];
  const CASED = [...SPELLINGS, ...SPELLINGS.map((s) => s.toUpperCase()),
    ...SPELLINGS.map((s) => s.toLowerCase())];
  CASED.forEach((spelling) => {
    assert.equal(rawColourSpellings('.x { background: ' + spelling + '; }').length, 1,
      'the spelling clause cannot see: ' + spelling);
  });
  assert.ok(CASED.some((s) => /RGB\(|HSL\(/.test(s)),
    'the case sweep above produced no uppercase function spelling to check');
  assert.deepEqual(
    rawColourSpellings('/* #333 rgb( */ .x { background: var(--c, var(--cyan)); }'), [],
    'the spelling clause reads a comment as a declaration'
  );

  /* And the value scan is case-blind in its own two places -- the property
     gate and the colourless-word allowlist -- so neither clause has a case
     seam the other has to cover. */
  assert.equal(colourValues('COLOR: CRIMSON;').length, 1,
    'an uppercase property name walks past the gate');
  assert.deepEqual(colourValues('BORDER-TOP: 1PX SOLID VAR(--LINE);'), [],
    'an uppercase legitimate value is mis-read as a colour');

  /* The hole, pinned rather than only written down. Each of these is a
     declaration BOTH clauses miss, and the docblock above says so; a freeze
     list nothing re-checks rots in both directions, so the ones that are
     uncovered must still be uncovered and the boundary beside them must still
     be caught. Widening `COLOUR_SLOT` to reach any of these turns this red,
     which is the point -- the prose has to move with the guard. */
  const UNCOVERED = [
    'text-decoration: underline crimson', 'text-decoration: underline oklch(0.7 0.2 250)',
    'text-decoration: underline lab(50% 40 59)',
    'text-decoration: underline color-mix(in srgb, crimson 50%, transparent)',
    'text-emphasis: dot crimson', 'mask-image: linear-gradient(crimson, transparent)',
  ];
  UNCOVERED.flatMap((decl) => [decl, decl.toUpperCase()]).forEach((decl) => {
    assert.deepEqual(colourValues(decl + ';'), [],
      'NOT COVERED in the docblock above, but the value scan now sees it: ' + decl);
    assert.deepEqual(rawColourSpellings('.x { ' + decl + '; }'), [],
      'NOT COVERED in the docblock above, but the spelling clause now sees it: ' + decl);
  });

  /* And the two boundaries that make the sentence say something: the gate is
     what decides it, not the property, and the property is not a dead zone. */
  assert.equal(colourValues('border-bottom: 1px solid crimson;').length, 1,
    'the same named colour in a GATED property must still be caught');
  assert.equal(rawColourSpellings('.x { text-decoration: underline #ff0000; }').length, 1,
    'a hex in the SAME ungated property must still be caught by the spelling clause');

  const stated = [];
  RULES.forEach((rule) => { stated.push(...colourValues(rule.body)); });
  assert.deepEqual(stated, [],
    'the v2 palette is AA by construction; a colour here is outside that proof and does not '
    + 'follow the theme');
  assert.deepEqual(rawColourSpellings(PANE_CSS), [], 'same rule, spelled the other way');
});
