/* Unit tests for ops/assets/pane-wearables-v2.js — Wearable sync on the v2
   design system (Stadiora/Aria#12704).

   The pane reads one route, GET /api/ops/wearable-sync, and the route says
   what it is looking at in `feedState`. The rules held here are the ones the
   issue's acceptance names, and each is asserted against the DOM the pane
   drew and the call it made, never against the pane's source text:

     - every feedState draws differently, in words as well as colour, and the
       two empty states read differently from each other;
     - the App control narrows the run counts and never the freshness chart;
     - a day with no snapshot is a labelled gap, not a zero bar, and a day
       still waiting for the 04:40 UTC job is labelled as pending;
     - every status pill carries a glyph and a word, not a colour alone;
     - an error summary is masked before it reaches the page.

   The live payload is scripts/fixtures/ops-wearable-sync-view.json, a literal
   buildWearableSyncPane result, so these tests read the shape the server
   sends rather than a hand-written object that can drift from it.

   NOT COVERED here, stated rather than implied: layout, width, overflow and
   contrast. Nothing here measures anything; the headless-Chrome checks do. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { makeDom, allText, findAll } from './ops-dom-harness.mjs';
import { shiftWearableSync, WEARABLE_SYNC_RECORDED } from './ops-api-stub.mjs';

const OPS = new URL('../ops/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, OPS), 'utf8');

const REGISTRY_SRC = read('assets/pane-registry.js');
const ARIA_SRC = read('assets/aria.js');
const SHELL_SRC = read('assets/shell-pane-v2.js');
const PANE_SRC = read('assets/pane-wearables-v2.js');

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

/* Two minutes after the recorded generatedAt, so the ledger's newest row
   (recorded two minutes before it) is four minutes old: live, not degraded. */
const NOW = Date.parse('2026-09-28T09:44:00.000Z');

function fixture(over) {
  const base = shiftWearableSync(WEARABLE_SYNC_RECORDED, Date.parse('2026-09-28T09:42:00.000Z'));
  if (!over) return base;
  const out = over(base);
  return out === undefined ? base : out;
}

function buildPage(dom, body) {
  const el = (parent, tag, attrs = {}) => {
    const node = dom.element(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };
  body.setAttribute('data-pane', 'wearables');
  body.className = 'is-booting';
  const boot = el(body, 'main', { class: 'gate gate-boot gate-center' });
  el(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  el(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = el(body, 'div', { class: 'gate gate-app' });
  el(appGate, 'div', { id: 'app' });
}

/* Loads the page the way ops/wearables.html loads it: registry, aria.js, the
   bootstrap, then the pane module. */
async function boot(options) {
  const opts = options || {};
  const calls = [];
  const answer = opts.answer === undefined ? fixture() : opts.answer;

  const dom = makeDom({ tokens: TOKENS, href: 'https://ops.example.invalid/ops/wearables.html' });
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
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve({ data: answer });
    },
    signOut: () => Promise.resolve(),
    role: () => 'owner',
    hasRole: () => true,
    daysLeft: () => 12,
  };

  vm.createContext(dom.window);
  dom.window.Date = class extends Date {
    constructor(...args) {
      if (args.length === 0) super(NOW);
      else super(...args);
    }

    static now() { return NOW; }
  };
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  vm.runInContext(ARIA_SRC, dom.window, { filename: 'aria.js' });
  vm.runInContext(SHELL_SRC, dom.window, { filename: 'shell-pane-v2.js' });

  /* The state the pane ASKED for: `live` and `degraded` share one panel, so
     the markup alone cannot tell them apart. */
  const states = [];
  const applyState = dom.window.Aria.applyState;
  dom.window.Aria.applyState = function (s) {
    states.push(String(s));
    return applyState.call(dom.window.Aria, s);
  };

  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-wearables-v2.js' });
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));

  return { ...dom, body, calls, states, content: dom.doc.getElementById('content') };
}

const hasClass = (cls) => (n) => (n.getAttribute('class') || '').split(/\s+/).includes(cls);

/* The panel the state put on screen: the data-state box aria.js marked shown. */
function shown(page) {
  const boxes = findAll(page.content, (n) => n.getAttribute('data-shown') !== null);
  assert.equal(boxes.length, 1, 'exactly one state box is shown');
  return boxes[0];
}

function tileValue(page, label) {
  const tile = findAll(shown(page), hasClass('kpi')).find((t) =>
    allText(findAll(t, hasClass('kpi-label'))[0]) === label);
  assert.ok(tile, `a tile labelled ${label}`);
  return allText(findAll(tile, hasClass('kpi-val'))[0]);
}

function tileMeta(page, label) {
  const tile = findAll(shown(page), hasClass('kpi')).find((t) =>
    allText(findAll(t, hasClass('kpi-label'))[0]) === label);
  return allText(findAll(tile, hasClass('kpi-meta'))[0]);
}

function heroTitle(page) {
  return allText(findAll(shown(page), hasClass('hero-title'))[0]);
}

function pressFilter(page, groupLabel, buttonText) {
  const group = findAll(page.doc.body, (n) => n.getAttribute('aria-label') === groupLabel &&
    hasClass('seg')(n))[0];
  assert.ok(group, `a ${groupLabel} control in the filter bar`);
  const button = findAll(group, (n) => n.tagName === 'BUTTON' || n.tagName === 'button')
    .find((b) => b.textContent === buttonText);
  assert.ok(button, `a ${buttonText} button`);
  button.dispatch('click');
  return button;
}

function chartLabel(page) {
  const chart = findAll(shown(page), hasClass('ws-chart'))[0];
  assert.ok(chart, 'the freshness chart is drawn');
  return chart.getAttribute('aria-label');
}

function sum(groups, pick) {
  return groups.reduce((n, g) => n + pick(g), 0);
}

const int = (n) => Math.round(n).toLocaleString('en-GB');

/* ------------------------------------------------------------- the read */

test('reads the wearable sync route once, with the 30-day freshness window', async () => {
  const page = await boot();
  /* Through JSON, because the query object was built inside the vm realm and
     deepStrictEqual compares prototypes as well as values. */
  assert.deepEqual(JSON.parse(JSON.stringify(page.calls)),
    [{ endpoint: '/api/ops/wearable-sync', query: { days: '30' } }]);
});

/* ------------------------------------------------------------ the states */

test('live names the failing provider in words and draws the ledger', async () => {
  const page = await boot();
  assert.equal(page.states[page.states.length - 1], 'live');
  assert.equal(heroTitle(page), 'Polar is rate-limited.');
  const totals = fixture().runs.last24h.totals;
  assert.equal(tileValue(page, 'Sync runs'), int(totals.runs));
  assert.equal(tileValue(page, 'Silent 2 days or more'), int(fixture().connections.silent) + ' of ' +
    int(fixture().connections.active));
});

test('degraded differs from live in the hero and hides the tiles that would over-count', async () => {
  const live = await boot();
  const page = await boot({ answer: fixture((d) => {
    d.feedState = 'degraded';
    d.newestRunAt = new Date(NOW - 92 * 60000).toISOString();
  }) });
  assert.equal(page.states[page.states.length - 1], 'degraded');
  assert.match(heroTitle(page), /^The ledger is .+ behind\.$/);
  assert.notEqual(heroTitle(page), heroTitle(live));
  assert.equal(tileValue(page, 'Silent 2 days or more'), 'Hidden');
  assert.equal(tileValue(page, 'Lag p95'), 'Hidden');
  assert.equal(tileMeta(page, 'Sync runs'), 'So far, still climbing');
  assert.notEqual(tileValue(live, 'Silent 2 days or more'), 'Hidden');
});

test('the two empty states read differently, and neither prints a tile', async () => {
  const noRuns = await boot({ answer: fixture((d) => {
    d.feedState = 'empty_no_runs';
    d.runs.last24h = { totals: d.runs.last24h.totals, groups: [] };
  }) });
  const noConnections = await boot({ answer: fixture((d) => {
    d.feedState = 'empty_no_connections';
    d.connections = { active: 0, silent: 0, byProvider: [] };
  }) });
  for (const page of [noRuns, noConnections]) {
    assert.equal(page.states[page.states.length - 1], 'empty');
    assert.equal(findAll(shown(page), hasClass('kpi')).length, 0, 'no tile, so no zero');
  }
  const a = allText(shown(noRuns));
  const b = allText(shown(noConnections));
  assert.match(a, /No sync runs in 24 hours, with 172 active connections/);
  assert.match(a, /Last run recorded /);
  assert.match(b, /No wearable connections yet/);
  assert.doesNotMatch(b, /No sync runs in 24 hours/);
  assert.doesNotMatch(a, /No wearable connections yet/);
});

test('unavailable is the failure card with the route\'s own words, and no figure', async () => {
  const err = Object.assign(new Error('The wearable sync ledger could not be read.'),
    { code: 'ops_wearable_sync_unavailable', status: 503 });
  const page = await boot({ answer: err });
  assert.equal(page.states[page.states.length - 1], 'degraded');
  const text = allText(shown(page));
  assert.match(text, /This pane could not be read/);
  assert.match(text, /The wearable sync ledger could not be read\./);
  assert.equal(findAll(shown(page), hasClass('kpi')).length, 0);
  assert.equal(findAll(shown(page), hasClass('ws-chart')).length, 0);
});

/* -------------------------------------------------------- the App filter */

test('the App filter narrows the run counts to that app and hides server runs', async () => {
  const page = await boot();
  pressFilter(page, 'App', 'FitMG');
  const fitmg = fixture().runs.last24h.groups.filter((g) => g.appVariant === 'fitmg');
  assert.ok(fitmg.length > 0);
  assert.equal(tileValue(page, 'Sync runs'), int(sum(fitmg, (g) => g.runs)));
  const server = fixture().runs.last24h.groups.filter((g) => g.appVariant === null);
  assert.match(allText(shown(page)),
    new RegExp(int(sum(server, (g) => g.runs)) + ' server runs hidden: server runs belong to no app\\.'));
  assert.match(heroTitle(page) + ' ' + allText(findAll(shown(page), hasClass('hero-sub'))[0]), /FitMG only\./);
});

test('the App filter never reaches the freshness chart', async () => {
  const page = await boot();
  const before = chartLabel(page);
  const barsBefore = findAll(shown(page), hasClass('ws-bar')).map((b) => b.style['--ws-h']);
  pressFilter(page, 'App', 'Aria XII');
  assert.equal(chartLabel(page), before);
  assert.deepEqual(findAll(shown(page), hasClass('ws-bar')).map((b) => b.style['--ws-h']), barsBefore);
  assert.match(allText(findAll(shown(page), hasClass('ws-scope'))[0]), /app filter does not apply/);
});

test('the Window control switches the runs to the 7-day counts', async () => {
  const page = await boot();
  pressFilter(page, 'Window', '7 d');
  assert.equal(tileValue(page, 'Sync runs'), int(fixture().runs.last7d.totals.runs));
  assert.notEqual(fixture().runs.last7d.totals.runs, fixture().runs.last24h.totals.runs);
});

/* --------------------------------------------------------- the freshness */

test('a day with no snapshot is a labelled gap, never a bar', async () => {
  const page = await boot();
  const missing = fixture().freshness.missingDates;
  assert.equal(missing.length, 2);
  const days = findAll(shown(page), hasClass('ws-day'));
  assert.equal(days.length, 30);
  const gaps = days.filter(hasClass('ws-gap'));
  assert.equal(gaps.length, missing.length);
  for (const gap of gaps) assert.equal(findAll(gap, hasClass('ws-bar')).length, 0);
  assert.equal(findAll(shown(page), hasClass('ws-bar')).length, 30 - missing.length);
  const legend = allText(findAll(shown(page), hasClass('ws-legend'))[0]);
  assert.match(legend, /No snapshot: 11 Sep 2026, 22 Sep 2026/);
  assert.match(chartLabel(page), /2 days with no snapshot\./);
});

test('today, before the 04:40 UTC job, is labelled pending rather than missing', async () => {
  const page = await boot({ answer: fixture((d) => {
    d.freshness.snapshots = d.freshness.snapshots.filter((s) => s.snapshotDate !== '2026-09-28');
    d.freshness.pendingDates = ['2026-09-28'];
  }) });
  const gaps = findAll(shown(page), hasClass('ws-gap'));
  assert.equal(gaps.length, 3);
  assert.equal(gaps.filter(hasClass('ws-pending')).length, 1);
  const legend = allText(findAll(shown(page), hasClass('ws-legend'))[0]);
  assert.match(legend, /Pending until 04:40 UTC: 28 Sep 2026/);
  assert.doesNotMatch(legend, /No snapshot: [^P]*28 Sep 2026/);
});

/* --------------------------------------------------------- status words */

test('every status pill carries a glyph and a word', async () => {
  const page = await boot();
  const pills = findAll(shown(page), hasClass('pill'));
  assert.ok(pills.length >= 5);
  for (const p of pills) {
    assert.equal(findAll(p, (n) => String(n.tagName).toLowerCase() === 'svg').length, 1, 'one glyph');
    assert.ok(allText(p).length > 0, 'a word');
  }
  const chips = allText(findAll(shown(page), hasClass('hero-chips'))[0]);
  assert.match(chips, /Polar: rate-limited/);
  assert.match(chips, /Strava: no connections/);
});

/* ----------------------------------------------------------- the privacy */

test('an error summary that carries a contact detail is masked', async () => {
  const page = await boot({ answer: fixture((d) => {
    d.failedRuns[0].errorSummary = 'Refused for someone@example.invalid by the provider.';
  }) });
  const text = allText(findAll(shown(page), hasClass('ws-failed'))[0]);
  assert.doesNotMatch(text, /someone@example\.invalid/);
  assert.match(text, /Refused for \[hidden contact detail\] by the provider\./);
});
