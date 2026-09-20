/* Unit tests for ops/assets/pane-overview.js — the Overview pane on the v2
   design system.

   What is worth testing here is the four rules in that file's docblock, every
   one of which is a rule about NOT drawing something, and none of which a
   screenshot or a headless-Chrome overflow check can see:

     - a figure is labelled with the window the answer says it covers, read
       from window.days rather than written into the pane;
     - a block whose availability is not `ready` renders words and never a
       numeral, so "not connected" can never look like zero;
     - the two apps are never added together;
     - the omissions list is rendered from the answer rather than from a list
       in the client, and the cost tile draws no budget track.

   Plus the two things that are easy to re-break by accident: the chart's
   accessible NAME has to carry the data, because role="img" is
   children-presentational and SVG <text> inside it is announced to nobody;
   and every doorway has to point at the pane the registry says owns it.

   Every test here has a published mutation in the pull request: the exact file
   and the exact original line whose removal or inversion makes that test fail.
   A test with no such line is a test that pins nothing. */
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
const PANE_DATA_SRC = read('assets/pane-data.js');

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

/* ------------------------------------------------------------- fixtures */

const DAYS = ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16',
  '2026-09-17', '2026-09-18', '2026-09-19'];

/* A whole, healthy answer. Every test below starts here and takes something
   away, because the rules under test are rules about absence. */
function summaryFixture(over) {
  const base = {
    generatedAt: '2026-09-20T06:00:00.000Z',
    consent: { basis: 'operational' },
    people: {
      availability: { state: 'ready' },
      platform: { active: 1102, previousActive: 980 },
      apps: [
        { key: 'aria', label: 'Aria', active: 870, tone: 's1' },
        { key: 'ariaxii', label: 'Aria XII', active: 412, tone: 's2' },
      ],
      window: { days: 7 },
      comparison: { days: 7, label: 'the 7 days before' },
      reportingFloor: 50,
      environment: 'production',
    },
    aiRuns: {
      availability: { state: 'ready' },
      runs: 4820, previous: { runs: 4410 },
      daysMissing: [], daysReported: 7, window: { days: 7 },
    },
    cost: {
      availability: { state: 'ready' },
      micros: 412_000_000, currency: 'USD',
      comparison: { changeBasisPoints: 640, label: 'the same days last month' },
      window: { dayOfPeriod: 12, daysInPeriod: 31 },
      basis: 'spend',
      asOf: '2026-09-19T00:00:00.000Z',
    },
    release: {
      availability: { state: 'ready' },
      platforms: [
        { label: 'iOS', versionName: '2.9.1', versionCode: 291, fetchedAt: '2026-09-19T09:00:00.000Z' },
        { label: 'Android', versionName: '2.9.0', versionCode: 290, fetchedAt: '2026-09-19T09:00:00.000Z' },
      ],
    },
    activity: {
      availability: { state: 'ready' },
      labels: DAYS,
      series: [
        { key: 'aria', label: 'Aria', color: 's1', values: [910, 940, 1001, 980, 1040, 1077, 1102] },
        { key: 'ariaxii', label: 'Aria XII', color: 's2', values: [380, 402, 396, 410, 421, 404, 412] },
      ],
      daysMissingRollups: [],
      window: { days: 7 },
    },
    omissions: [
      { key: 'budget', title: 'No budget bar', detail: 'Nothing here records a cloud budget.' },
    ],
  };
  if (!over) return base;
  /* An override that mutates and returns nothing used to yield undefined here,
     which boot() then read as "no override" and quietly served the default
     fixture — a test written to remove a field would pass against a payload
     that still had it. Both styles work now. */
  const out = over(base);
  return out === undefined ? base : out;
}

function problemsFixture(rows) {
  return {
    problems: rows === undefined ? [{
      id: 'p1', reference: 'PRB-104', severity: 'critical', status: 'open',
      title: 'Generation queue is backing up',
      summary: 'Nothing has drained for 40 minutes.',
      firedAt: '2026-09-20T05:20:00.000Z',
      workPane: 'jobs', workPaneLabel: 'Jobs running now',
    }] : rows,
    total: rows === undefined ? 1 : rows.length,
  };
}

const RULES = {
  rules: [
    { key: 'queue', label: 'Queue depth', enabled: true, lastEvaluatedAt: '2026-09-20T05:55:00.000Z', lastEvaluationStatus: 'firing', lastFiredAt: '2026-09-20T05:20:00.000Z' },
    { key: 'errors', label: 'Error rate', enabled: true, lastEvaluatedAt: '2026-09-20T05:55:00.000Z', lastEvaluationStatus: 'ok', lastFiredAt: null },
  ],
  channels: [{ key: 'teams', label: 'Teams', configured: true, status: 'ok' }],
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

/* Loads the page the way ops/index.html loads it: registry, aria.js, the
   bootstrap, the alerts model, then the pane module. */
async function boot(options) {
  const opts = options || {};
  const calls = [];
  const answers = {
    '/api/ops/summary': opts.summary === undefined ? summaryFixture() : opts.summary,
    '/api/ops/alerts/problems': opts.problems === undefined ? problemsFixture() : opts.problems,
    '/api/ops/alerts/rules': opts.rules === undefined ? RULES : opts.rules,
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
      calls.push({ endpoint, query: o && o.query });
      const answer = answers[endpoint];
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

  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));

  return { ...dom, body, calls, answers, content: dom.doc.getElementById('content') };
}

/* The live panel only. The loading, empty and degraded panels are siblings of
   it and are hidden by aria.css, so reading the whole region would read text
   the operator cannot see. */
function livePanel(dom) {
  const shown = dom.doc.getElementById('content')
    .querySelectorAll('[data-state]')
    .filter((n) => (n.getAttribute('data-state') || '').split(' ').indexOf('live') !== -1);
  return shown[0];
}

function liveText(dom) {
  return allText(livePanel(dom));
}

/* The activity chart, which is the only svg on this pane that is a picture of
   data rather than an icon: an icon carries aria-hidden and no role. */
function chartOf(dom) {
  return findAll(livePanel(dom),
    (n) => n.tagName === 'svg' && n.getAttribute('role') === 'img')[0]
    || findAll(livePanel(dom), (n) => n.tagName === 'svg' && !n.getAttribute('aria-hidden'))[0];
}

/* One tile, by its heading. Whole-pane text is the wrong instrument for a
   rule about one figure's label: another sentence elsewhere can carry the
   same words and the assertion passes without the tile being right. */
function tileText(dom, heading) {
  const tile = findAll(livePanel(dom), (n) => (n.className || '').indexOf('kpi') !== -1)
    .filter((n) => heading.test(allText(n)))[0];
  return tile ? allText(tile) : '';
}

/* Every numeral on screen, so a rule about never printing one can be checked
   without guessing which element it would have landed in. */
function numerals(text) {
  return (text.match(/\d/g) || []).length;
}

/* =========================== the window label ========================== */

test('every figure says the window the answer covered, taken from the answer', async () => {
  const seven = await boot({});
  assert.match(tileText(seven, /Active people/), /Last 7 whole UTC days/,
    'a 7-day answer was not labelled 7 days');

  /* The same pane, the same code, a different answer. If the window were
     written into the client this second read would still say 7. */
  const three = await boot({
    summary: summaryFixture((s) => {
      s.people.window.days = 3;
      s.aiRuns.window.days = 3;
      s.activity.window.days = 3;
      s.activity.labels = DAYS.slice(4);
      s.activity.series.forEach((x) => { x.values = x.values.slice(4); });
      s.aiRuns.daysReported = 3;
      return s;
    }),
  });
  const text = tileText(three, /Active people/);
  assert.match(text, /Last 3 whole UTC days/,
    'a 3-day answer was still labelled something else: ' + text);
  assert.doesNotMatch(text, /7 whole UTC days/,
    'the pane printed a 7-day window for a 3-day answer');
  assert.doesNotMatch(liveText(three), /Last 7 whole UTC days/,
    'another block kept the old window while the answer moved');
});

test('the pane never claims a 24 hour window the pipeline cannot answer', async () => {
  const dom = await boot({});
  assert.doesNotMatch(liveText(dom), /24 hours|last day|today/i,
    'a figure claimed an hourly window that nothing behind it aggregates to');
});

/* The branch above covers an answer that DID describe a window. The one below
   covers the answer that did not, which is the worse case: a tile with no
   window to print either guesses one or says so, and only one of those is
   honest. Nothing bound this path until it was raised in review. */
test('a block whose answer describes no window says so rather than guessing one', async () => {
  const dom = await boot({
    summary: summaryFixture((s) => { delete s.people.window; }),
  });
  const tile = tileText(dom, /Active people/i);
  assert.match(tile, /Window not reported/,
    'a tile with no window in the answer printed no window at all');
  assert.doesNotMatch(tile, /whole UTC day/,
    'a tile with no window in the answer named a window anyway');
  assert.match(tileText(dom, /runs/i), /whole UTC day/,
    'the other tiles lost their window label too, so this proves nothing');
});

/* ================= availability: words, never a numeral ================= */

const BLOCKS = [
  { block: 'people', heading: /Active people/i },
  { block: 'aiRuns', heading: /runs/i },
  { block: 'cost', heading: /Cloud spend/i },
  { block: 'release', heading: /release/i },
];

for (const { block, heading } of BLOCKS) {
  test('a ' + block + ' block that is not ready prints words and no numeral', async () => {
    for (const state of ['not_reporting', 'not_collected', 'not_published']) {
      const dom = await boot({
        summary: summaryFixture((s) => {
          /* Exactly what the route does: the state changes AND the figures
             leave the payload. A block that kept its numbers would let this
             test pass on a pane that ignores availability entirely. */
          s[block] = { availability: { state: state }, window: { days: 7 } };
          return s;
        }),
      });
      const tile = findAll(livePanel(dom), (n) => (n.className || '').indexOf('kpi') !== -1)
        .filter((n) => heading.test(allText(n)))[0];
      assert.ok(tile, block + ' lost its tile entirely when it was ' + state);
      const text = allText(tile);
      assert.equal(numerals(text.replace(/7 days/g, '')), 0,
        block + ' printed a numeral while ' + state + ': ' + text);
      assert.ok(text.replace(/\s+/g, ' ').trim().length > 12,
        block + ' went blank while ' + state + ' instead of saying so');

      /* The rest of the pane is still ready in this same render. Without
         this the test would pass on a pane that printed no numeral anywhere,
         which is how the first draft of it passed against a fixture whose
         availability shape was wrong throughout. */
      assert.ok(numerals(liveText(dom)) > 8,
        'the whole pane went wordless, so this proves nothing about ' + block);
    }
  });
}

test('a state that is not ready prints words even when a figure came with it', async () => {
  /* The route drops the figures when the state is not `ready`, so a pane can
     pass the test above while ignoring availability altogether. This is the
     same answer with the figures left in: the state alone has to decide. */
  const dom = await boot({
    summary: summaryFixture((s) => {
      s.people.availability = { state: 'not_reporting' };
      return s;
    }),
  });
  const tile = tileText(dom, /Active people/);
  assert.equal(numerals(tile.replace(/7 days|7 whole UTC days/g, '')), 0,
    'a stale figure was printed for a block that is not reporting: ' + tile);
  assert.match(tile, /No reading/, 'the state was not named');
});

test('a ready block with no figure in it says so rather than printing zero', async () => {
  const dom = await boot({
    summary: summaryFixture((s) => {
      delete s.people.platform;
      return s;
    }),
  });
  const tile = tileText(dom, /Active people/);
  assert.doesNotMatch(tile, /\b0\b/,
    'a missing figure was drawn as a measured zero: ' + tile);
  assert.match(tile, /Not reported|No reading/, 'a missing figure was drawn as nothing at all');
});

test('a block that is not reporting is never drawn as a zero', async () => {
  const dom = await boot({
    summary: summaryFixture((s) => {
      s.people = { availability: { state: 'not_reporting' }, window: { days: 7 } };
      return s;
    }),
  });
  const text = liveText(dom);
  assert.doesNotMatch(text, /\b0 (active )?people\b/i, 'not reporting was drawn as zero');
});

/* ======================== the two apps, never summed ==================== */

test('the headline people figure is the platform count, not the two apps added up', async () => {
  const fixture = summaryFixture();
  const sum = fixture.people.apps.reduce((n, a) => n + a.active, 0);
  assert.notEqual(sum, fixture.people.platform.active,
    'the fixture cannot tell the two apart, so this test proves nothing');

  const dom = await boot({});
  const text = liveText(dom);
  assert.match(text, new RegExp(String(fixture.people.platform.active).replace(/(\d)(?=(\d{3})+$)/g, '$1,')),
    'the platform distinct count is not on the pane');
  assert.doesNotMatch(text, new RegExp('\\b' + String(sum).replace(/(\d)(?=(\d{3})+$)/g, '$1,') + '\\b'),
    'the two apps were added together: somebody who used both was counted twice');
});

test('the activity chart is one line per app and never a combined one', async () => {
  const dom = await boot({});
  const svg = chartOf(dom);
  assert.ok(svg, 'the activity chart is not on the pane');
  const groups = findAll(svg, (n) => n.tagName === 'g' && n.getAttribute('data-series'));
  const keys = groups.map((g) => g.getAttribute('data-series'));
  assert.deepEqual(keys.sort(), ['aria', 'ariaxii'],
    'the chart drew something other than one line per app: ' + keys.join(', '));
  for (const g of groups) {
    const lines = findAll(g, (n) => n.tagName === 'path');
    assert.equal(lines.length, 1,
      g.getAttribute('data-series') + ' was drawn as ' + lines.length + ' lines, not one');
  }
});

/* ============================ the chart's name ========================== */

test('the chart carries its data in the accessible name, not only in the drawing', async () => {
  const dom = await boot({});
  const svg = chartOf(dom);
  assert.ok(svg, 'the activity chart is not on the pane');
  assert.equal(svg.getAttribute('role'), 'img');

  /* role="img" is children-presentational, so <text> inside this element is
     announced to nobody. Everything a reader gets is in the name. */
  const name = svg.getAttribute('aria-label') || '';
  assert.ok(name.length > 40, 'the chart has no name, or a name that says nothing: ' + name);
  for (const series of summaryFixture().activity.series) {
    assert.ok(name.indexOf(series.label) !== -1,
      'the name does not mention ' + series.label);
  }
  assert.match(name, /1,102/, 'the name does not carry the latest figure');
  assert.match(name, /910/, 'the name does not carry the range the line covers');
  assert.match(name, /2026-09-19/, 'the name does not say when the line ends');

  const inside = findAll(svg, (n) => n.tagName === 'text');
  for (const node of inside) {
    assert.ok(name.indexOf(allText(node)) !== -1 || allText(node).length <= 12,
      'a figure is drawn inside the chart and is in no accessible name: ' + allText(node));
  }
});

test('a day with no stored reading breaks the line rather than joining across it', async () => {
  const dom = await boot({
    summary: summaryFixture((s) => {
      s.activity.series[0].values = [910, 940, null, 980, 1040, 1077, 1102];
      s.activity.daysMissingRollups = ['2026-09-15'];
      return s;
    }),
  });
  const svg = chartOf(dom);
  const group = findAll(svg, (n) => n.tagName === 'g' && n.getAttribute('data-series') === 'aria')[0];
  const lines = findAll(group, (n) => n.tagName === 'path');

  /* Two strokes with nothing between them, rather than one stroke through the
     day nothing was stored for. Joining would draw a measurement that was
     never taken; dropping to zero would draw one that was taken and was zero. */
  assert.equal(lines.length, 2,
    'the gap day was joined across instead of breaking the line into two');
  for (const line of lines) {
    const d = line.getAttribute('d') || '';
    assert.doesNotMatch(d, /NaN/, 'the gap day reached the path as NaN');
    assert.equal((d.match(/M/g) || []).length, 1, 'a stroke restarted inside itself: ' + d);
  }
  const other = findAll(svg, (n) => n.tagName === 'g' && n.getAttribute('data-series') === 'ariaxii')[0];
  assert.equal(findAll(other, (n) => n.tagName === 'path').length, 1,
    'the app with a full window lost its line too');

  const text = liveText(dom);
  assert.match(text, /15 Sep 2026/, 'the gap day is drawn but never named');
  assert.match(text, /6 of 7 days/,
    'the app with a missing day still claims a reading for every day');
  assert.doesNotMatch(text, /\b0 people on 2026-09-15\b/,
    'the gap day was reported as a measured zero');
});

/* ===================== the cost tile and the omissions ================== */

test('the cost tile draws no budget track, because nothing records a budget', async () => {
  const dom = await boot({});
  const panel = livePanel(dom);
  const bars = findAll(panel, (n) => /\b(meter|budget|track|progress)\b/.test(n.className || ''));
  assert.deepEqual(bars.map((n) => n.className), [],
    'a budget bar was drawn against a target nothing in the platform records');
  assert.equal(findAll(panel, (n) => n.tagName === 'progress').length, 0);
});

test('the omissions list is rendered from the answer, not from a list in the pane', async () => {
  const named = await boot({
    summary: summaryFixture((s) => {
      s.omissions = [
        { key: 'budget', title: 'No budget bar', detail: 'Nothing here records a cloud budget.' },
        { key: 'forecast', title: 'No month-end forecast', detail: 'Only billed usage is stored.' },
      ];
      return s;
    }),
  });
  const text = liveText(named);
  assert.match(text, /No month-end forecast/,
    'an omission the answer named is missing, so the list is hard-coded here');
  assert.match(text, /Only billed usage is stored/, 'the reason was dropped');

  /* The other direction, which is the one that matters: a figure that gains a
     source has to leave the list without an edit in this file. */
  const gained = await boot({ summary: summaryFixture((s) => { s.omissions = []; return s; }) });
  assert.doesNotMatch(liveText(gained), /No budget bar|budget/i,
    'an omission the answer no longer names is still printed by the pane');
});

/* ============================== the doorways =========================== */

test('every doorway points at the pane the registry says owns the question', async () => {
  const dom = await boot({});
  const registry = dom.window.OpsPaneRegistry;
  const files = Object.keys(registry.PANES).map((id) => registry.PANES[id].file);

  const links = findAll(livePanel(dom), (n) => n.tagName === 'A' && n.getAttribute('href'));
  assert.ok(links.length >= 4, 'the pane has no doorways on it at all');
  for (const link of links) {
    const file = (link.getAttribute('href') || '').split('?')[0];
    assert.ok(files.indexOf(file) !== -1,
      'a doorway points at ' + file + ', which is not a pane the registry names');
    assert.ok(allText(link).replace(/\s+/g, ' ').trim().length > 3,
      'a doorway has no words in it');
  }

  /* The specific paths the approved mock draws. */
  const hrefs = links.map((l) => (l.getAttribute('href') || '').split('?')[0]);
  for (const file of ['analytics.html', 'run-history.html', 'spend.html', 'releases.html']) {
    assert.ok(hrefs.indexOf(file) !== -1, 'no doorway into ' + file);
  }
});

test('the reporting floor is the same number the understand panes use', async () => {
  const floor = /REPORTING_FLOOR\s*=\s*(\d+)/;
  const here = floor.exec(PANE_SRC);
  const there = floor.exec(PANE_DATA_SRC);
  assert.ok(here && there, 'one of the two files stopped naming a reporting floor');
  assert.equal(here[1], there[1],
    'Overview and the understand panes now hide a share over different group sizes');
});

/* The test above pins the literal; it cannot see whether the literal is ever
   applied, which is the source-grep shape this repository has been caught by
   before. Raised in review. This one runs the branch. */
test('a comparison over too small a group prints no rate', async () => {
  const dom = await boot({
    summary: summaryFixture((s) => {
      s.people.platform.previousActive = 9;
      s.people.reportingFloor = 50;
    }),
  });
  const tile = tileText(dom, /Active people/i);
  assert.match(tile, /no rate under 50 people/,
    'a comparison against 9 people printed no reason for withholding the rate');
  assert.doesNotMatch(tile, /%/,
    'a share was drawn over a group too small to report one');
  assert.match(tileText(dom, /Cloud spend/i), /%/,
    'every rate on the pane disappeared, so this proves nothing about the floor');
});

/* ======================= status, never colour alone ===================== */

/* The class names a state can be painted in, read from the stylesheets that
   paint them rather than listed here. Two sources, because a tone reaches the
   DOM by two routes: `aria.css` publishes the shared vocabulary as compound
   rules (`.dot.bad`, `.pill.up`), and this pane's own sheet adds its shapes.
   A hand-listed set of whole class names went blind to five spellings at the
   first review, and the enumeration that replaced it went blind to `.dot.bad`
   and `.dot.live` at the second — both times because the list was written
   from what the pane happened to use that day.

   Family prefixes stay, for classes no compound rule declares (`st-bad`,
   `is-crit`, `tone-rose`).

   Proof pointer: the derivation is bound by the next test, which reinstates a
   tone class in the sheet and requires the scan to see it. The scan alone
   does not kill a blanked hero, because the hero element contains the
   severity chips and their words satisfy it — that is what the ribbon test
   further down is for. NOT COVERED: a tone painted by a rule in neither
   sheet, and a tone class outside every family prefix. */
const SHEETS = ['ops/assets/aria.css', 'ops/assets/pane-overview-v2.css'];
const TONE_WORDS = [...new Set(SHEETS.flatMap((f) => [
  ...readFileSync(new URL('../' + f, import.meta.url), 'utf8')
    .matchAll(/\.(?:dot|pill|chip|tag|st|bar|ln|seg)\.([a-z][a-z0-9-]*)/g),
].map((m) => m[1])))].sort();
const TONE_CLASS = new RegExp(
  '(^|\\s)(st-[a-z]+|is-[a-z]+|acc|acc-[a-z]+|tone-[a-z]+|' +
  TONE_WORDS.join('|') + ')(\\s|$)');

test('the tone vocabulary is read from the sheets, not from a list here', () => {
  for (const want of ['bad', 'live', 'ok', 'warn', 'vio', 'up', 'down', 'info']) {
    assert.ok(TONE_WORDS.includes(want),
      want + ' is declared as a tone in the sheets but the scan cannot see it');
  }
  assert.ok(TONE_CLASS.test('dot bad'), 'a tone the sheets declare escaped the scan');
  assert.ok(TONE_CLASS.test('dot live'), 'a tone the sheets declare escaped the scan');
  assert.ok(!TONE_CLASS.test('kpi-label'), 'the scan matches a class that paints no state');
  /* `.pill.ghost` is a shape rather than a state, and the derivation picks it
     up anyway. Kept: over-reading costs a false alarm on an element that
     already carries words, under-reading is the defect this scan exists for. */
  assert.ok(TONE_CLASS.test('pill ghost'), 'the derivation stopped reading the sheet');
});

test('every status on the pane is carried in words, not only in a tone class', async () => {
  const dom = await boot({});
  const inChart = (n) => {
    for (let p = n.parentNode; p; p = p.parentNode) {
      if (p.getAttribute && p.getAttribute('role') === 'img') return true;
    }
    return false;
  };
  /* Shapes inside a role="img" are skipped on purpose, not overlooked:
     role="img" is children-presentational, so nothing in there is announced at
     all and a word placed on it would be announced to nobody. The chart's data
     lives in its accessible NAME, which `the activity chart's accessible name
     carries the data` binds, and which shape belongs to which app is also in
     data-series. */
  const toned = findAll(livePanel(dom), (n) => TONE_CLASS.test(n.className || '') && !inChart(n));
  assert.ok(toned.length >= 3, 'the pane carries no status markers at all');
  for (const node of toned) {
    /* A coloured dot beside a word is fine, and is how the mock draws a
       series key. A coloured dot that is the only thing saying which state
       this is, is the defect. So the words have to be somewhere a reader
       reaches: on the marker, or on the thing it is decorating. */
    const own = allText(node).replace(/\s+/g, ' ').trim();
    const hidden = node.getAttribute('aria-hidden') === 'true';
    const near = allText(node.parentNode).replace(/\s+/g, ' ').trim();
    const words = hidden ? near : own;
    const signed = /^[+\u2212-]\s*\d/.test(own);
    assert.ok(/[A-Za-z]{3}/.test(words) || signed,
      'a status is conveyed by colour alone: class=' + node.className);
    if (signed) {
      assert.ok(/[A-Za-z]{3}/.test(near),
        'a signed figure is toned but nothing near it says what it is measuring');
    }
  }
});

/* The status ribbon is the pane's largest status element and the scan above
   cannot kill it: the hero carries the severity chips inside it, so blanking
   its title and sub leaves letters in allText() and the scan still passes.
   Raised in review as a demonstrated false green. This reads the title and the
   sub directly, and requires all three states to say something DIFFERENT —
   a constant string satisfies "has words" and says nothing. */
const HERO = (dom, cls) =>
  allText(findAll(livePanel(dom), (n) => (n.className || '').indexOf(cls) !== -1)[0] || {})
    .replace(/\s+/g, ' ').trim();

test('the ribbon says its own state in words, and a different one per state', async () => {
  const cases = {
    active: await boot({}),
    quiet: await boot({ problems: { problems: [] } }),
    unarmed: await boot({ rules: { rules: [], channels: [] } }),
  };

  const titles = [];
  for (const [name, dom] of Object.entries(cases)) {
    const title = HERO(dom, 'hero-title');
    const sub = HERO(dom, 'hero-sub');
    assert.match(title, /[A-Za-z]{3}/, 'the ribbon title carries no words in the ' + name + ' state');
    assert.match(sub, /[A-Za-z]{3}/, 'the ribbon sub carries no words in the ' + name + ' state');
    titles.push(title);
  }
  assert.equal(new Set(titles).size, titles.length,
    'the ribbon says the same thing in every state, so it says nothing: ' + JSON.stringify(titles));
});

test('a critical problem says critical in the queue row itself', async () => {
  const dom = await boot({});
  const row = findAll(livePanel(dom), (n) => (n.className || '').indexOf('q-title') !== -1)[0];
  assert.ok(row, 'the needs-attention queue has no rows on it');
  /* On the row, not merely somewhere on the pane: the ribbon above counts
     severities too, so whole-pane text passes while the row that an operator
     reads carries severity as an accent colour and nothing else. */
  assert.match(allText(row), /^Critical: /,
    'severity reached the queue row as a colour and nothing else: ' + allText(row));
});

/* ============================== the states ============================= */

test('empty needs both halves to be empty, not one quiet window', async () => {
  const quiet = await boot({ problems: problemsFixture([]) });
  assert.doesNotMatch(liveText(quiet), /Nothing is behind this pane yet/,
    'a quiet hour with figures behind it was drawn as an empty pane');
  assert.match(liveText(quiet), /1,102/, 'the figures went off screen with the problems');

  const nothing = await boot({
    problems: problemsFixture([]),
    rules: { rules: [], channels: [] },
    summary: null,
  });
  const shownEmpty = dom2state(nothing, 'empty');
  assert.match(allText(shownEmpty), /Nothing is behind this pane yet/,
    'a pane with nothing behind either half did not reach the empty state');
});

function dom2state(dom, state) {
  return dom.doc.getElementById('content').querySelectorAll('[data-state]')
    .filter((n) => (n.getAttribute('data-state') || '').split(' ').indexOf(state) !== -1)[0];
}

test('a summary read that fails leaves the urgent queue on screen', async () => {
  const dom = await boot({ summary: new Error('summary is down') });
  const degraded = dom2state(dom, 'degraded') || livePanel(dom);
  const text = allText(degraded);
  assert.match(text, /Generation queue is backing up/,
    'a spend outage took the critical problem off the screen with it');
  assert.match(text, /could not be read/i, 'the failed half claims nothing about why');
  assert.doesNotMatch(text, /\$0|0 runs|0 active/,
    'an unread figure was drawn as a zero');
});

test('the pane asks for exactly the three reads it needs, and no filters', async () => {
  const dom = await boot({});
  const endpoints = dom.calls.map((c) => c.endpoint).sort();
  assert.deepEqual(endpoints, [
    '/api/ops/alerts/problems', '/api/ops/alerts/rules', '/api/ops/summary',
  ]);
  const summaryCall = dom.calls.filter((c) => c.endpoint === '/api/ops/summary')[0];
  assert.equal(summaryCall.query, undefined,
    'the summary read carried a filter this pane offers no control for');
});

/* ===================== the rail badge is a real read ==================== */

/* "A dashboard that invents a count is worse than one that shows nothing" is
   the rule the bootstrap's badge pass-through exists for, and until this was
   raised in review nothing on the Overview side held it: a hard-coded label
   and a badge that was never cleared both left the suite green. */
const railBadge = (dom) => {
  const items = findAll(dom.body, (n) => (n.className || '').indexOf('nav-item') !== -1);
  const alerts = items.filter((n) => n.getAttribute('data-rail-id') === 'alerts')[0];
  if (!alerts) return null;
  const badge = findAll(alerts, (n) => /(^|\s)nav-badge(\s|$)/.test(n.className || ''))[0];
  const sr = findAll(alerts, (n) => (n.className || '').indexOf('nav-badge-sr') !== -1)[0];
  return { label: badge ? allText(badge).trim() : null, sr: sr ? allText(sr).trim() : '' };
};

test('the Problems badge is the count this pane just read, not a number in the client', async () => {
  const two = await boot({
    problems: {
      problems: [
        { id: 'p1', reference: 'PRB-104', severity: 'critical', status: 'open', title: 'A', firedAt: '2026-09-20T05:20:00.000Z' },
        { id: 'p2', reference: 'PRB-105', severity: 'warning', status: 'open', title: 'B', firedAt: '2026-09-20T05:25:00.000Z' },
      ],
      total: 2,
    },
  });
  assert.equal(railBadge(two).label, '2', 'the rail badge does not match the answer');
  assert.match(railBadge(two).sr, /2 problems with nobody on them/,
    'the badge is a bare number with nothing saying what it counts');

  const one = await boot({});
  assert.equal(railBadge(one).label, '1', 'a one-problem answer did not produce a badge of 1');
});

test('a quiet system leaves no count beside Problems at all', async () => {
  const dom = await boot({ problems: { problems: [], total: 0 } });
  assert.equal(railBadge(dom).label, null,
    'the rail kept a count on a system with no problems on it');
  assert.match(allText(dom.body), /Overview/, 'the rail did not render, so this proves nothing');
});

/* A first render has no badge to clear, so the clearing branch is unobservable
   on one boot — which is how the first version of this passed with the clear
   deleted. The page can render twice: a summary that failed leaves a Try again
   button that re-reads everything. That is the second render, and the one
   where a count from the first can go stale. */
test('a count that goes away is taken off the rail on the next read', async () => {
  const dom = await boot({ summary: new Error('summary is down') });
  assert.equal(railBadge(dom).label, '1', 'the first read left no count to go stale');

  const again = findAll(dom.body, (n) => n.tagName === 'BUTTON' && allText(n).trim() === 'Try again')[0];
  assert.ok(again, 'the failed figures offered no way to read them again');

  dom.answers['/api/ops/alerts/problems'] = { problems: [], total: 0 };
  dom.answers['/api/ops/summary'] = summaryFixture();
  again.dispatch('click', { type: 'click' });
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));

  assert.equal(railBadge(dom).label, null,
    'the rail kept a count from the previous render after the problems cleared');
  assert.match(tileText(dom, /Active people/i), /1,102/,
    'the second read did not happen at all, so this proves nothing');
});

/* ================== a change pill points where it moved ================= */

/* Direction and valence are different facts and the tiles disagree about
   them: more people is good news, more spend is not, so the cost tile paints
   a rise in the falling tone. The chevron has to read the figure's own sign
   or a rising bill gets a falling arrow beside `+6.4%`, which is what this
   pane shipped until it was found in review. */
const UP_PATH = 'M7 14l5-5 5 5';
const DOWN_PATH = 'M7 10l5 5 5-5';

const pillsOf = (dom, heading) => {
  const card = findAll(livePanel(dom), (n) => (n.className || '').indexOf('kpi') !== -1)
    .filter((n) => heading.test(allText(n)))[0];
  return findAll(card || {}, (n) => /(^|\s)pill(\s|$)/.test(n.className || ''))
    .map((p) => ({
      className: p.className,
      text: allText(p).replace(/\s+/g, ' ').trim(),
      d: (findAll(p, (n) => n.tagName === 'path')[0] || { getAttribute: () => null }).getAttribute('d'),
    }));
};

for (const [name, heading, bp, wantTone] of [
  ['people', /Active people/i, 1240, 'up'],
  ['cost', /Cloud spend/i, 640, 'down'],
]) {
  test('a rising ' + name + ' figure draws a rising chevron, whatever its tone', async () => {
    const dom = await boot({
      summary: summaryFixture((s) => {
        s.people.platform.previousActive = 500;
        s.cost.comparison.changeBasisPoints = bp;
      }),
    });
    const pill = pillsOf(dom, heading)[0];
    assert.ok(pill, 'the ' + name + ' tile drew no change pill at all');
    assert.match(pill.text, /^\+/, 'the ' + name + ' figure did not rise in this fixture');
    assert.equal(pill.d, UP_PATH,
      'a rising figure drew ' + (pill.d === DOWN_PATH ? 'a falling' : 'no') +
      ' chevron: class=' + pill.className + ' text=' + pill.text);
    assert.match(pill.className, new RegExp('(^|\\s)' + wantTone + '(\\s|$)'),
      'the ' + name + ' tile lost the tone that says whether the rise is good news');
  });
}

test('a falling figure draws a falling chevron', async () => {
  const dom = await boot({
    summary: summaryFixture((s) => {
      s.cost.comparison.changeBasisPoints = -320;
    }),
  });
  const pill = pillsOf(dom, /Cloud spend/i)[0];
  assert.ok(pill, 'the cost tile drew no change pill at all');
  assert.match(pill.text, /^\u2212|^-/, 'the cost figure did not fall in this fixture');
  assert.equal(pill.d, DOWN_PATH, 'a falling figure drew the wrong chevron: ' + pill.d);
});
