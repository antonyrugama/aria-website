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

   Every test here but one has a published mutation in the pull request: the
   exact file and the exact original line whose removal or inversion makes that
   test fail. A test with no such line is a test that pins nothing.

   The exception is `the tone vocabulary is read from the sheets, not from a
   list here`, and it is NOT COVERED by any published row. Its inputs are the
   two stylesheets, and the tone words it names are declared by ops/assets/aria.css,
   which this pull request is not allowed to edit. The only mutation that would
   falsify it lives in a file outside this change, so none is published rather
   than a weaker one being passed off as proof. */
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

const hoursAgo = (n) => new Date(Date.now() - n * 3600000).toISOString();

/* Problem stamps are relative for the same reason the release card's are, one
   fixture down: the ribbon prints how long ago the oldest problem started,
   against the real clock. These were fixed dates, so they aged a little every
   day, and the day they reached "24 hours ago" the sweep below read that as a
   claim about a 24 hour WINDOW and went red. The release card had already been
   converted for exactly this; these were the site that conversion missed.

   The offsets keep the original spacing (05:20, 05:25, 05:30, 05:55 against a
   06:00 read), so the oldest is still the oldest and an acknowledgement still
   lands after the problem it acknowledges. */
const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();

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
        /* Relative, not absolute. The releases card prints how long ago the
           store was asked, worked out against the real clock, so a fixed date
           here says "3 hours ago" the day it is written and something new
           every day after. It said "24 hours ago" exactly once, on the day
           after this fixture's date, and turned the sweep below red for one
           day. A fixture that moves with the clock stays the same. */
        { label: 'iOS', versionName: '2.9.1', versionCode: 291, fetchedAt: hoursAgo(3) },
        { label: 'Android', versionName: '2.9.0', versionCode: 290, fetchedAt: hoursAgo(3) },
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
      firedAt: minutesAgo(40),
      workPane: 'jobs', workPaneLabel: 'Jobs running now',
    }] : rows,
    total: rows === undefined ? 1 : rows.length,
  };
}

const RULES = {
  rules: [
    { key: 'queue', label: 'Queue depth', enabled: true, lastEvaluatedAt: minutesAgo(5), lastEvaluationStatus: 'firing', lastFiredAt: minutesAgo(40) },
    { key: 'errors', label: 'Error rate', enabled: true, lastEvaluatedAt: minutesAgo(5), lastEvaluationStatus: 'ok', lastFiredAt: null },
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
  const text = liveText(dom);

  /* Swept over everything rather than over the tiles, because a window can be
     claimed in a sentence, a chart description or a footnote, and a sweep
     that only reads the labels misses the other three.

     One sentence is taken out by name: how long ago the app stores were
     asked. That is the age of a READ, not the span a figure covers, and a
     store asked 24 hours ago says so honestly. It is asserted to still be on
     the page first, or the exclusion would cover the defect by deleting the
     card that carries it.

     The ribbon's oldest-problem sentence is taken out on the same grounds and
     with the same presence assertion. It prints the age of an EVENT — when the
     oldest open problem started — which is no more a window claim than the
     read age is. It was not excluded when the read age was, so a problem that
     happened to be between 24 and 25 hours old turned this red on a pane that
     had claimed nothing. Both sentences state an age; neither states a span.

     NOT COVERED: an age printed in a wording AGE below does not list. The
     pattern tracks fmt.ago()'s vocabulary, so a new branch there needs a new
     branch here, and the presence assertions are what make that failure loud
     rather than silent. */
  const AGE = '(?:\\d+ seconds?|a minute|\\d+ minutes|an hour|\\d+ hours|\\d+ days) ago';
  const readAge = /Read from the stores (within the hour|[\d,.]+ hours? ago)\./;
  assert.match(text, readAge,
    'the releases card printed no read age, so the exclusion below covers nothing');

  const heroAge = new RegExp('Oldest started [^,.]+, ' + AGE + '\\.');
  assert.match(text, heroAge,
    'the ribbon printed no oldest-problem age, so the exclusion below covers nothing');

  assert.doesNotMatch(text.replace(readAge, '').replace(heroAge, ''),
    /24 hours|last day|today/i,
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

   Every **compound** rule in the two sheets, whatever its base: round three
   found a base allow-list here (`dot|pill|chip|tag|st|bar|ln|seg`) that made
   the "derived" set NARROWER than the hand list it replaced, because this
   shell's own badge vocabulary is spelled `.nav-badge.hot`, `.nav-badge.warm`
   and `.nav-badge.soon`. Three demonstrated false greens. There is no
   allow-list now, and over-reading (`.card.lift`, `.kpi-val.sm`) costs a
   false alarm on an element that already carries words.

   Proof pointers: V27 reinstates a coloured marker with its words blanked at
   the all-quiet footer and this scan goes red; V27b does the same with
   `nav-badge hot`, which was green before the allow-list came out. The scan
   alone does not kill a blanked hero, because the hero element contains the
   severity chips and their words satisfy it — that is what the ribbon test
   further down is for.

   NOT COVERED: a state painted by a rule in neither of these two sheets; a
   state painted by a SINGLE-class rule, since the derivation only reads
   compound selectors, unless its class happens to match a family prefix
   above; and a state painted by an inline or computed value rather than a
   class. */
const SHEETS = ['ops/assets/aria.css', 'ops/assets/pane-overview-v2.css'];
const TONE_WORDS = [...new Set(SHEETS.flatMap((f) => [
  ...readFileSync(new URL('../' + f, import.meta.url), 'utf8')
    .matchAll(/\.[a-z][a-z0-9-]*\.([a-z][a-z0-9-]*)/g),
].map((m) => m[1])))].sort();
const TONE_CLASS = new RegExp(
  '(^|\\s)(st-[a-z]+|is-[a-z]+|acc|acc-[a-z]+|tone-[a-z]+|' +
  TONE_WORDS.join('|') + ')(\\s|$)');

test('the tone vocabulary is read from the sheets, not from a list here', () => {
  for (const want of ['bad', 'live', 'ok', 'warn', 'vio', 'up', 'down', 'info',
    'hot', 'warm', 'soon']) {
    assert.ok(TONE_WORDS.includes(want),
      want + ' is declared as a tone in the sheets but the scan cannot see it');
  }
  for (const cls of ['dot bad', 'dot live', 'nav-badge hot', 'nav-badge warm',
    'nav-badge soon']) {
    assert.ok(TONE_CLASS.test(cls), 'a tone the sheets declare escaped the scan: ' + cls);
  }
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
    /* The unarmed state deliberately has no sentence — see the test below;
       its chip carries the only fact a sentence there could. */
    if (name !== 'unarmed') {
      assert.match(sub, /[A-Za-z]{3}/, 'the ribbon sub carries no words in the ' + name + ' state');
    }
    titles.push(title);
  }
  assert.equal(new Set(titles).size, titles.length,
    'the ribbon says the same thing in every state, so it says nothing: ' + JSON.stringify(titles));
});

/* Round nine, advisory: with no alert rules at all the hero read "Nothing is
   being checked" over "There are no alert rules at all." with a chip beside it
   reading "0 of 0 rules checking" — one fact in three slots. The sentence went;
   the chip keeps the count, which is the part an operator acts on. */
test('the no-rules ribbon leaves the count to the chip', async () => {
  const dom = await boot({ rules: { rules: [], channels: [] } });
  const panel = livePanel(dom);
  const sub = findAll(panel, (n) => /(^|\s)hero-sub(\s|$)/.test(n.className || ''))[0];
  assert.equal(sub, undefined,
    'the no-rules ribbon carries a sentence the chip beside it already says: ' +
    JSON.stringify(sub ? allText(sub) : ''));

  const chips = findAll(panel, (n) => /(^|\s)hero-chips(\s|$)/.test(n.className || ''))[0];
  assert.ok(chips, 'the ribbon lost its chips');
  assert.match(allText(chips).replace(/\s+/g, ' '), /0 of 0 rules checking/,
    'the count left the ribbon entirely, so nothing on the row says no rule is armed');
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

/* ============ a severity this pane has never heard of ================== */

/* Stadiora/Aria#10393. The queue row read the severity straight out of
   alerts-model.js's label map with nothing behind it, so a problem whose
   severity was not one of the three the map knows rendered the literal words
   "undefined: Plan generation failing for Aria XII" on the operator's first
   screen. The route emits only the three today, which is why this was filed
   rather than fixed on an approved head, and why nothing here asserts the
   route's shape: the pane has to hold on its own.

   Two different absences, because they degrade to two different words. A
   severity the pane does not recognise is shown VERBATIM — for a plain
   unrecognised word that is the same thing the Problems pane prints for it
   (pane-alerts.js:741), so the two panes describe that state the same way,
   and neither pretends to have translated a word it has never seen. The two
   panes do NOT agree on the other two cases: Problems prints a function for
   `constructor` and an empty pill for a severity that never arrived, which is
   the sibling defect this pane is being fixed of. A severity that did not
   arrive at all has no word to show, so it falls to "Unknown" rather than to
   a blank: a row whose prefix is silently dropped tells the operator nothing
   arrived, which is the other way to get this wrong.

   The rows carry a real workPane — one of the keys alerts-model.js:89-95
   actually holds — so the doorway beside them is drawn. Spelled anything
   else the queue row renders no doorway at all and every assertion about the
   links on it reads an empty row (Stadiora/Aria#10461 is the same fixture
   bug one pane over). */
const ODD_SEVERITY_ROWS = [
  {
    id: 'p1', reference: 'PRB-104', severity: 'critical', status: 'open',
    title: 'Generation queue is backing up',
    summary: 'Nothing has drained for 40 minutes.',
    firedAt: minutesAgo(40), workPane: 'jobs-live', workPaneLabel: 'Jobs running now',
  },
  {
    id: 'p2', reference: 'PRB-105', severity: 'notice', status: 'open',
    title: 'Plan generation failing for Aria XII',
    summary: 'Three in a row.',
    firedAt: minutesAgo(30), workPane: 'jobs-live', workPaneLabel: 'Jobs running now',
  },
  {
    id: 'p3', reference: 'PRB-106', status: 'open',
    title: 'A rule fired with no severity on it',
    summary: 'The field did not arrive.',
    firedAt: minutesAgo(20), workPane: 'jobs-live', workPaneLabel: 'Jobs running now',
  },
  /* Closed, and carrying an unrecognised severity. The chips break down what
     is still open, so this one has to stay out of the count: counted, it
     would put the chips back over a ribbon that disagrees with them, which is
     the contradiction the unknown chip exists to remove. */
  {
    id: 'p4', reference: 'PRB-107', severity: 'notice', status: 'closed',
    title: 'An unrecognised severity that was already closed',
    summary: 'Closed an hour ago.',
    firedAt: minutesAgo(90), closedAt: minutesAgo(60), closeReason: 'resolved',
    workPane: 'jobs-live', workPaneLabel: 'Jobs running now',
  },
];

const qTitles = (dom) =>
  findAll(livePanel(dom), (n) => (n.className || '').indexOf('q-title') !== -1)
    .map((n) => allText(n));

/* The links on the queue rows themselves. Read off `.q-actions` rather than
   off the panel: the panel always carries the card-head "All problems" link
   and four KPI doorways, so a floor over the panel is satisfied by links that
   have nothing to do with a problem row, and a sweep that lost the rows
   entirely would still pass it. */
const rowHrefs = (dom) =>
  findAll(livePanel(dom), (n) => (n.className || '').indexOf('q-actions') !== -1)
    .flatMap((row) => findAll(row, (n) => n.tagName === 'A'))
    .map((n) => n.getAttribute('href') || '');

test('a severity this pane does not know reaches the row as the word that arrived', async () => {
  const dom = await boot({ problems: problemsFixture(ODD_SEVERITY_ROWS) });

  /* Read off the rows, not off whole-pane text: the chips beside the ribbon
     count severities too, so a sweep of the panel passes while the row an
     operator actually reads is the thing that is wrong. */
  assert.deepEqual(qTitles(dom), [
    'Critical: Generation queue is backing up',
    'notice: Plan generation failing for Aria XII',
    'Unknown: A rule fired with no severity on it',
  ], 'a severity outside the three known ones did not reach the row intact');

  /* A severity the pane cannot name must not cost the row its way out. Two
     links per row: the pane where the work happens, and the problem. */
  assert.equal(rowHrefs(dom).length, 6,
    'the queue rows carry ' + rowHrefs(dom).length + ' links rather than six, so a row ' +
    'lost its doorway: ' + JSON.stringify(rowHrefs(dom)));
});

test('nothing on the pane says "undefined" when a severity is not one of the three', async () => {
  const dom = await boot({ problems: problemsFixture(ODD_SEVERITY_ROWS) });
  /* The panel, not the rows: the defect is a class, and the same unguarded
     lookup in the ribbon, a chip or a link title would land here too. */
  const text = allText(livePanel(dom));
  assert.match(text, /Plan generation failing for Aria XII/,
    'the odd-severity problem never reached the page, so this sweep covers nothing');
  assert.doesNotMatch(text, /undefined|\bnull\b|\[object/,
    'a value the pane could not translate was printed as a JavaScript word: ' +
    JSON.stringify(text.replace(/\s+/g, ' ').slice(0, 400)));
});

/* The other half of degrading honestly: the ribbon counts every problem that
   is still open, and the chips under it break that same set down by severity.
   The breakdown counted the three known severities and dropped everything
   else on the floor, so a ribbon reading "3 problems need a person" sat over
   chips adding up to one, and the two problems the pane did not understand
   vanished from the count rather than from the label. */
test('a severity this pane does not know is still counted beside the ribbon', async () => {
  const dom = await boot({ problems: problemsFixture(ODD_SEVERITY_ROWS) });
  const chips = HERO(dom, 'hero-chips').replace(/\s+/g, ' ');

  assert.match(HERO(dom, 'hero-title'), /^3 problems need a person$/,
    'the ribbon counted something other than the three problems it was given');
  assert.match(chips, /(^|\s)1 critical(\s|$)/,
    'the known severity left the chip row: ' + JSON.stringify(chips));
  /* Two, not three: the fourth row carries an unrecognised severity and is
     closed, and the ribbon it sits under counts only what is still open. */
  assert.match(chips, /(^|\s)2 of unknown severity(\s|$)/,
    'the chips do not add up to the ribbon above them: ' + JSON.stringify(chips));
});

/* The same lookup, keyed by a word every plain object in JavaScript already
   answers to. `SEVERITY_LABEL['constructor']` is not undefined — it is
   Object's constructor — so a guard written as a truthiness test on the map
   hands a FUNCTION to the row, and `'' + fn` is that function's source code.
   The same is true of the map from a problem's work pane to a file name, one
   line below the severity, whose `if (file && ...)` guard reads as though it
   has covered the absent case.

   Not a realistic payload, and not the reachability argument: it is why the
   two guards are written against the words the pane knows and against the
   type it needs, rather than against "the lookup found something". */
test('a severity that names an object built-in does not put JavaScript on the screen', async () => {
  const dom = await boot({
    problems: problemsFixture([{
      id: 'p9', reference: 'PRB-109', severity: 'constructor', status: 'open',
      title: 'A severity that is a word Object answers to',
      summary: 'Arrived from the route.',
      firedAt: minutesAgo(10), workPane: 'constructor', workPaneLabel: 'Nowhere',
    }]),
  });

  assert.deepEqual(qTitles(dom),
    ['constructor: A severity that is a word Object answers to'],
    'a severity naming an object built-in was not shown as the word that arrived');

  /* The chip row as well as the label. The tally tests a severity against the
     three words the pane knows rather than against a lookup on a plain
     object, and `SEVERITY_LABEL['constructor']` is not undefined — so a guard
     written the other way counts this problem as one the pane can name, drops
     it out of the breakdown, and leaves a ribbon reading "1 problem needs a
     person" over chips that mention none. Nothing else in this file can see
     the difference between the two spellings of that guard. */
  assert.match(HERO(dom, 'hero-chips').replace(/\s+/g, ' '),
    /(^|\s)1 of unknown severity(\s|$)/,
    'a severity Object answers to was dropped from the chip breakdown');

  const panel = livePanel(dom);
  assert.doesNotMatch(allText(panel), /native code|function \w*\s*\(/,
    'a function reached the page as text');
  /* The doorway is left off rather than pointed at a function: an href is not
     text, so no sweep of what is written on the page would see it.

     `A`, not `a`: the harness stores an HTML tag name upper-cased, and the
     lower-case spelling matched nothing, so this loop ran zero times and
     passed while the defect it names was on the page. Caught by the mutation
     battery, which is what a control exists for.

     The count is over the links on the ROW, which is what makes it bind: a
     floor over the panel is met by the card head and the tiles whatever the
     row does. One link here, the problem's own, because this problem's work
     pane is unrecognised too and that doorway is correctly left off. */
  const hrefs = rowHrefs(dom);
  assert.equal(hrefs.length, 1,
    'the queue row carries ' + hrefs.length + ' links rather than the problem link alone: ' +
    JSON.stringify(hrefs));
  for (const href of hrefs) {
    assert.doesNotMatch(href, /native code|function/,
      'a link was built from a lookup that found an object built-in: ' + JSON.stringify(hrefs));
  }
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

test('an Overview failure message preserves the API copy with contact details masked', async () => {
  const dom = await boot({ summary: new Error('Summary for admin@example.invalid timed out') });
  const text = allText(dom2state(dom, 'degraded') || livePanel(dom));
  assert.match(text, /Summary for \[hidden contact detail\] timed out/,
    'the Overview caller did not show the API message with the address masked');
  assert.doesNotMatch(text, /admin@example\.invalid/,
    'the Overview caller rendered the raw address from the API message');
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
        { id: 'p1', reference: 'PRB-104', severity: 'critical', status: 'open', title: 'A', firedAt: minutesAgo(40) },
        { id: 'p2', reference: 'PRB-105', severity: 'warning', status: 'open', title: 'B', firedAt: minutesAgo(35) },
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

/* ============== one app, one colour, everywhere on the screen ============ */

/* The tile's dots and the chart's legend key the same two apps forty pixels
   apart. They reach the DOM by different routes — `people.apps[].tone` and
   `activity.series[].color` — so nothing but a test stops them disagreeing.
   Until round three this pane carried a `tone === 'coaches'` test ported from
   the v1 Mobile/Coaches world, which no value in the current contract can
   satisfy, so both dots fell through to the default and Aria XII was violet
   in the chart and cyan in the tile. */
test('each app keys the same colour in the tile as in the chart legend', async () => {
  const dom = await boot({});
  const panel = livePanel(dom);

  const legend = findAll(panel, (n) => (n.className || '') === 'legend')[0];
  assert.ok(legend, 'the chart drew no legend to compare against');
  const chart = new Map(findAll(legend, (n) => /^tone-/.test(n.className || ''))
    .map((k) => [allText(k).trim(), k.className.trim()]));
  assert.ok(chart.size >= 2, 'the legend named fewer than two apps: ' + [...chart.keys()]);

  const tile = findAll(panel, (n) => (n.className || '').indexOf('kpi') !== -1)
    .filter((n) => /Active people/i.test(allText(n)))[0];
  const dots = findAll(tile, (n) => /(^|\s)dot(\s|$)/.test(n.className || ''))
    .map((d) => ({
      tone: (d.className.match(/tone-[a-z]+/) || [null])[0],
      label: allText(d.parentNode).replace(/[\d,\s]+$/, '').trim(),
    }));
  assert.equal(dots.length, chart.size, 'the tile and the legend name different app counts');

  for (const dot of dots) {
    assert.ok(dot.tone, 'an app dot carries no series tone at all: ' + dot.label);
    assert.equal('dot ' + dot.tone, 'dot ' + (chart.get(dot.label) || '?'),
      dot.label + ' is ' + dot.tone + ' in the tile and ' +
      (chart.get(dot.label) || 'absent') + ' in the chart legend');
  }

  /* The other direction: matching is not enough if everything matches by
     collapsing to one colour. Two apps, two colours. */
  assert.equal(new Set(dots.map((d) => d.tone)).size, dots.length,
    'two apps were drawn in one colour: ' + dots.map((d) => d.label + '=' + d.tone).join(', '));
});

/* =============== the count is not said twice on one screen ============== */

/* The ribbon title, the severity chips and the queue rows are three views of
   the same count within about eighty pixels of each other. The queue card's
   own head used to add a fourth ("2 problems with nobody on them" under a
   ribbon reading "2 problems need a person"), which is the density the
   editorial rule exists to stop. The empty case keeps its sentence because
   it says something the rows cannot. */
test('the needs-attention head does not restate the count the ribbon just gave', async () => {
  const dom = await boot({
    problems: {
      problems: [
        { id: 'p1', reference: 'PRB-104', severity: 'critical', status: 'open', title: 'A', firedAt: minutesAgo(40) },
        { id: 'p2', reference: 'PRB-105', severity: 'warning', status: 'open', title: 'B', firedAt: minutesAgo(35) },
      ],
      total: 2,
    },
  });
  const panel = livePanel(dom);

  const heroTitle = allText(findAll(panel, (n) => /(^|\s)hero-title(\s|$)/
    .test(n.className || ''))[0] || {}).trim();
  assert.match(heroTitle, /\d/, 'this fixture did not put a count in the ribbon');

  const head = findAll(panel, (n) => /(^|\s)card-title(\s|$)/.test(n.className || ''))
    .filter((n) => /Needs attention/i.test(allText(n)))[0];
  assert.ok(head, 'the needs-attention card lost its title');
  const note = findAll(head.parentNode,
    (n) => /(^|\s)card-note(\s|$)/.test(n.className || ''))[0];

  assert.equal(note, undefined,
    'the queue head restates the count the ribbon already gave: ' +
    JSON.stringify(allText(note)) + ' under ' + JSON.stringify(heroTitle));
});

test('the needs-attention head keeps its sentence when nothing needs a person', async () => {
  const dom = await boot({ problems: { problems: [], total: 0 } });
  const panel = livePanel(dom);
  const head = findAll(panel, (n) => /(^|\s)card-title(\s|$)/.test(n.className || ''))
    .filter((n) => /Needs attention/i.test(allText(n)))[0];
  assert.ok(head, 'the needs-attention card vanished when nothing needed a person');
  const note = findAll(head.parentNode,
    (n) => /(^|\s)card-note(\s|$)/.test(n.className || ''))[0];
  assert.ok(note && /Nobody is being asked/.test(allText(note)),
    'the empty case lost the one sentence the rows cannot carry');
  assert.ok(findAll(head.parentNode.parentNode,
    (n) => /All problems/.test(allText(n)) && n.tagName === 'A')[0],
    'the empty case lost the way through to the pane that owns the detail');
});

/* The capped arm of the same branch. A full page where every problem has been
   taken on is reachable, and the code's own comment says it is the case that
   most needs qualifying: "nobody is being asked to do anything" is a much
   weaker claim when it is only true of the hundred rows that could be read. */
test('the empty sentence says so when it is only true of the page that was read', async () => {
  const rows = [];
  for (let i = 0; i < 100; i += 1) {
    rows.push({
      id: 'p' + i, reference: 'PRB-' + (200 + i), severity: 'warning', status: 'acknowledged',
      title: 'Taken on ' + i, firedAt: minutesAgo(40),
      acknowledgedBy: 'ops', acknowledgedAt: minutesAgo(30),
    });
  }
  const dom = await boot({ problems: { problems: rows, total: 480 } });
  const head = findAll(livePanel(dom), (n) => /(^|\s)card-title(\s|$)/.test(n.className || ''))
    .filter((n) => /Needs attention/i.test(allText(n)))[0];
  assert.ok(head, 'the needs-attention card vanished on a capped read');
  const note = findAll(head.parentNode,
    (n) => /(^|\s)card-note(\s|$)/.test(n.className || ''))[0];
  assert.ok(note, 'a capped read lost the empty sentence entirely');
  assert.match(allText(note), /could be read/,
    'the sentence claims nobody is being asked to do anything across the whole ' +
    'system, when only one page of it was read: ' + JSON.stringify(allText(note)));
});

/* ========== the ribbon and its chips do not say the same thing ========== */

/* Round five found the all-quiet hero reading "2 of 2 rules checking, last 14
   minutes ago" beside a chip reading "2 of 2 rules checking" — the same words
   twice on one row, which is the density the remodel exists to remove. The
   sub keeps only what the chip cannot carry. */
test('the all-quiet ribbon does not repeat the chip beside it', async () => {
  const dom = await boot({ problems: { problems: [], total: 0 } });
  const panel = livePanel(dom);
  const sub = allText(findAll(panel, (n) => /(^|\s)hero-sub(\s|$)/.test(n.className || ''))[0] || {})
    .replace(/\s+/g, ' ').trim();
  assert.ok(sub, 'the all-quiet ribbon lost its sentence');

  const chips = findAll(panel, (n) => /(^|\s)hero-chips(\s|$)/.test(n.className || ''))[0];
  assert.ok(chips, 'the ribbon lost its chips');
  const chipWords = findAll(chips, (n) => !n.childNodes || !n.childNodes.length)
    .map((n) => allText(n).replace(/\s+/g, ' ').trim()).filter(Boolean);

  for (const words of chipWords) {
    if (words.length < 6) continue;
    assert.ok(sub.indexOf(words) === -1,
      'the ribbon sentence repeats a chip verbatim: ' + JSON.stringify(words) +
      ' inside ' + JSON.stringify(sub));
  }

  assert.match(sub, /verdict/,
    'the sentence lost the one fact the chips cannot carry, when the rules last ran');
});

/* ========== one fact per slot, across the whole pane ========== */

/* Rounds five and six each found the same defect in a different state: a
   sentence printed twice on one screen, ~200px apart, under two headings
   arguing the same point. The earlier guard read the ribbon and its chips,
   so it could only see one of the three sites. This reads every leaf run of
   text on the rendered page and refuses an exact repeat, in any state, at any
   site, whether or not anybody thought to write a test for that pair.

   Short runs are exempt: a label, a unit and a status word are data, and
   'Critical' appearing on four rows is the pane working. The floor is a
   sentence's worth of words, not a phrase's. Re-spelled duplication of the
   same fact is NOT COVERED here and nothing in this file covers it; only a
   verbatim repeat is caught. */
const FACT_FLOOR = 24;

function leafRuns(root) {
  return findAll(root, () => true)
    .map((n) => String(n.textContent || '').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length >= FACT_FLOOR);
}

/* The first draft of this read `c.text`, which the DOM stub does not have, so
   it collected nothing and could never fail. The floor below is what makes
   that visible: an empty sweep is now a failure, not a pass. */
function assertNoRepeat(panel, state, floor) {
  const runs = leafRuns(panel);
  assert.ok(runs.length >= floor,
    'the ' + state + ' sweep found only ' + runs.length + ' runs of ' + FACT_FLOOR +
    '+ characters, so it is not reading the page it claims to read');
  const seen = new Map();
  for (const run of runs) {
    if (seen.has(run)) {
      assert.fail('the ' + state + ' pane prints the same sentence in two slots: ' +
        JSON.stringify(run));
    }
    seen.set(run, true);
  }
}

const NEVER_RUN_RULES = {
  rules: [
    { key: 'queue', label: 'Queue depth', enabled: true, lastEvaluatedAt: null, lastEvaluationStatus: null, lastFiredAt: null },
    { key: 'errors', label: 'Error rate', enabled: true, lastEvaluatedAt: null, lastEvaluationStatus: null, lastFiredAt: null },
  ],
  channels: [{ key: 'teams', label: 'Teams', configured: true, status: 'ok' }],
};

test('no state prints the same sentence in two slots', async () => {
  /* Each render asserts the state it claims to be in first. A fixture that
     quietly falls back to the live payload would make the rest of this
     vacuous, and the first draft of this test did exactly that: it passed
     `rules` inside `problems`, where nothing reads it. */
  const quiet = livePanel(await boot({ problems: { problems: [], total: 0 } }));
  assert.match(allText(quiet), /Nothing needs attention/,
    'the all-quiet fixture did not reach the all-quiet state');
  assertNoRepeat(quiet, 'all-quiet', 13);

  const unarmed = livePanel(await boot({
    problems: { problems: [], total: 0 }, rules: NEVER_RUN_RULES,
  }));
  assert.match(allText(unarmed), /The checks are not running/,
    'the unarmed fixture did not reach the unarmed state');
  assert.match(allText(unarmed), /none has run yet/,
    'the unarmed fixture reached a different unarmed branch than the one under test');
  assertNoRepeat(unarmed, 'unarmed', 14);

  const live = livePanel(await boot({}));
  assert.ok(findAll(live, (n) => /(^|\s)q-row(\s|$)/.test(n.className || '')).length,
    'the live fixture drew no queue rows, so it is not the state under test');
  assert.ok(findAll(live, (n) => /(^|\s)card-foot(\s|$)/.test(n.className || '')).length,
    'the live fixture drew no card footer, so the footer is not under test here');
  assertNoRepeat(live, 'live', 15);
});

/* The page-wide guard above catches a sentence repeated character for
   character. Round six's queue findings were not that shape: the chip said
   "3 of 5 rules checking" and the footer said "3 rules watching", which is the
   same fact in two spellings and walks straight past a verbatim test. This
   binds the two slots the chip already answers for, by refusing a rule COUNT
   in either of them rather than a particular sentence. */
test('the queue card never counts rules, because the chip already does', async () => {
  const COUNTS_RULES = /\d[^.]{0,24}\brules?\b/i;

  const quiet = livePanel(await boot({ problems: { problems: [], total: 0 } }));
  const block = findAll(quiet, (n) => /(^|\s)state-block(\s|$)/.test(n.className || ''))[0];
  assert.ok(block, 'the all-quiet queue drew no state block, so nothing here is under test');
  assert.doesNotMatch(allText(block).replace(/\s+/g, ' '), COUNTS_RULES,
    'the quiet queue block counts rules, which the chip beside the ribbon already did');

  const live = livePanel(await boot({}));
  const foot = findAll(live, (n) => /(^|\s)card-foot(\s|$)/.test(n.className || ''))[0];
  assert.ok(foot, 'the live queue drew no footer, so nothing here is under test');
  assert.doesNotMatch(allText(foot).replace(/\s+/g, ' '), COUNTS_RULES,
    'the queue footer counts rules, which the chip beside the ribbon already did');
});

/* Round seven: cardHead rendered its title as a div, so "Needs attention",
   "People active each day" and "Not drawn here, and why" were absent from the
   heading outline while the omission items inside one of those cards were
   headings. A reader navigating by heading landed inside a card without its
   title. The bootstrap is shared, so the three panes queued behind it inherit
   whichever way this lands. */
test('every card title is a heading, so no card is jumped past', async () => {
  const panel = livePanel(await boot({}));
  const titles = findAll(panel, (n) => /(^|\s)card-title(\s|$)/.test(n.className || ''));
  assert.ok(titles.length >= 3,
    'only ' + titles.length + ' card titles were drawn, so this is not reading the page');
  for (const t of titles) {
    assert.match(String(t.tagName || ''), /^H[1-6]$/,
      'a card title is a ' + t.tagName + ', so it is outside the heading outline: ' +
      JSON.stringify(allText(t)));
  }
});

/* Round eight: making card titles h3 in round seven inverted the outline where
   it had only been flat before — stateBlock defaults to h2, so "Nothing needs
   attention" and "There is no line to draw for this window" became h2s nested
   inside h3-titled cards. A reader navigating by heading was told the block was
   a sibling of the band above it.

   This binds the CLASS rather than those four call sites: any heading inside a
   titled card or band has to be deeper than the title of the thing that
   contains it, whatever the pane later puts there. */
const HEADING = (n) => (/^H([1-6])$/.test(String(n.tagName || '')) ? Number(RegExp.$1) : 0);

function ownTitle(node) {
  for (const kid of node.childNodes || []) {
    if (!kid.tagName) continue;
    if (!/(^|\s)(card-head|band-head)(\s|$)/.test(kid.className || '')) continue;
    const found = findAll(kid, (n) => /(^|\s)(card-title|band-title)(\s|$)/.test(n.className || ''))[0];
    if (found) return found;
  }
  return null;
}

function outlineFaults(node, floor, faults, titles) {
  const level = HEADING(node);
  if (level) {
    /* A container's own title was already measured against what contains the
       container, so it is not measured against itself here. */
    if (!titles.has(node) && level <= floor) {
      faults.push('h' + level + ' "' + allText(node) + '" sits inside a container titled h' + floor);
    }
    return faults;
  }
  let next = floor;
  if (/(^|\s)(card|band)(\s|$)/.test(node.className || '')) {
    const mine = ownTitle(node);
    if (mine) {
      titles.add(mine);
      if (HEADING(mine) <= floor) {
        faults.push('h' + HEADING(mine) + ' "' + allText(mine) +
          '" titles a container inside one titled h' + floor);
      }
      next = HEADING(mine);
    }
  }
  for (const kid of node.childNodes || []) {
    if (kid.tagName) outlineFaults(kid, next, faults, titles);
  }
  return faults;
}

for (const [name, mk] of [
  ['live', async () => livePanel(await boot({}))],
  ['all quiet', async () => livePanel(await boot({ problems: { problems: [], total: 0 } }))],
  ['unarmed', async () => livePanel(await boot({
    problems: { problems: [], total: 0 }, rules: NEVER_RUN_RULES,
  }))],
  ['no line to draw', async () => livePanel(await boot({
    summary: summaryFixture((s) => { s.activity.series = []; }),
  }))],
]) {
  test('the heading outline never inverts inside a card — ' + name, async () => {
    const panel = await mk();
    const headings = findAll(panel, (n) => HEADING(n) > 0);
    assert.ok(headings.length >= 3,
      'only ' + headings.length + ' headings in the ' + name + ' render, so this is not reading the page');
    const titled = findAll(panel, (n) => /(^|\s)(card|band)(\s|$)/.test(n.className || '') && ownTitle(n));
    assert.ok(titled.length >= 1, 'no titled container in the ' + name + ' render');
    const faults = outlineFaults(panel, 1, [], new Set());
    assert.deepEqual(faults, [], faults.join(' | '));
  });
}

/* Round nine, advisory: the ribbon read "Oldest started 06:00:00 UTC, 46 hours
   ago" — a bare clock on an incident two days old, which reads as six this
   morning. A UTC stamp exists so two operators in two time zones can quote the
   same instant, and a clock with no date is not one.

   Written as a sweep rather than as an assertion about that one sentence,
   because the defect is a class: any slot on this pane that prints an absolute
   time can print it undated, in any wording. Every match has to carry its day.

   NOT COVERED: a time printed in a format this pattern does not recognise
   (it reads `HH:MM` and `HH:MM:SS` followed by UTC), and a time rendered as an
   attribute rather than as text. */
test('no absolute time is printed without the day it belongs to', async () => {
  const CLOCK = /\b\d{1,2}:\d{2}(?::\d{2})?\s*UTC\b/g;
  const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
  const DATED = new RegExp('\\b\\d{1,2} ' + MONTH + ' \\d{4} $');

  const states = {
    live: livePanel(await boot({})),
    'all-quiet': livePanel(await boot({ problems: { problems: [], total: 0 } })),
    unarmed: livePanel(await boot({ problems: { problems: [], total: 0 }, rules: NEVER_RUN_RULES })),
  };

  /* The ribbon's oldest sentence is the slot this came from, so the sweep is
     vacuous unless that branch actually ran in one of the states above. */
  assert.match(allText(states.live).replace(/\s+/g, ' '), /Oldest started /,
    'no fixture reached the sentence that prints the oldest problem, so this sweep tests nothing');

  let seen = 0;
  for (const [name, panel] of Object.entries(states)) {
    for (const node of findAll(panel, (n) => !n.childNodes || !n.childNodes.length)) {
      const words = allText(node).replace(/\s+/g, ' ');
      for (const hit of words.matchAll(CLOCK)) {
        seen += 1;
        assert.match(words.slice(0, hit.index), DATED,
          'the ' + name + ' state prints a clock with no day in front of it: ' +
          JSON.stringify(words));
      }
    }
  }
  assert.ok(seen >= 2, 'only ' + seen + ' absolute times were found across three states, ' +
    'so this pattern is not reading what the pane prints');
});
