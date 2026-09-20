/* Unit tests for ops/assets/pane-analytics.js — People and usage on the v2
   design system.

   What is worth testing here is the five rules in that file's docblock, four
   of which are rules about NOT drawing something and none of which a
   screenshot or a headless-Chrome overflow check can see:

     - a rate over a group under the reporting floor is not published, and what
       makes a figure a rate is the denominator travelling with it rather than
       the kind the pipeline gave it;
     - a window with no stored days shows its stored-day figures as not
       reported rather than as zero;
     - the two apps are never added together;
     - a day with no reading breaks the line rather than being joined across;
     - the age of the answer is on screen beside the figures, and says so in
       words once a whole nightly run has been missed.

   Plus the two that are easy to re-break by accident: every picture of data is
   either named with its data or hidden, because role="img" is
   children-presentational and the SVG <text> inside one is announced to
   nobody; and the read carries the whole selection rather than part of it.

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
const PANE_SRC = read('assets/pane-analytics.js');
const PAGE_HTML = read('analytics.html');

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

const HOUR = 3600 * 1000;
const hoursAgo = (n) => new Date(Date.now() - n * HOUR).toISOString();

/* ------------------------------------------------------------- fixtures */

const MOBILE_TREND = [
  980, 1002, 995, 1030, 1044, 1012, 1061, 1048, 1072, 1090,
  1066, 1081, 1098, 1102, 1085, 1120, 1133, 1119, 1140, 1152,
  1147, 1160, 1171, 1158, 1182, 1190, 1176, 1201, 1214, 1061,
];
const WEB_TREND = MOBILE_TREND.map((v) => Math.round(v * 0.29));

/* A whole, healthy answer. Every test below starts here and takes something
   away or moves one field, because the rules under test are rules about
   absence. */
function usageFixture(over) {
  const base = {
    availability: { state: 'ready' },
    asOf: hoursAgo(5),
    window: {
      days: 30, daysCovered: 30,
      reportingStart: '2026-08-22T00:00:00.000Z',
      daysMissingRollups: [],
    },
    apps: [
      {
        label: 'Mobile', tone: 'mobile', subtitle: 'Athlete app',
        coverageBasisPoints: 9200,
        metrics: [
          { label: 'Active people', value: 1061, kind: 'count' },
          { label: 'Sessions', value: 8430, kind: 'count' },
          { label: 'Median session', value: 372, kind: 'seconds' },
          {
            label: 'Sessions per person', value: 7.9, kind: 'decimal',
            digits: 1, denominator: 1061,
          },
        ],
        trend: { label: 'Active people', color: 's1', values: MOBILE_TREND.slice() },
      },
      {
        label: 'Coaches Web', tone: 'coaches', subtitle: 'Coach app',
        coverageBasisPoints: 10000,
        metrics: [
          { label: 'Active people', value: 308, kind: 'count' },
          { label: 'Sessions', value: 1204, kind: 'count' },
          { label: 'Median session', value: 640, kind: 'seconds' },
          {
            label: 'Sessions per person', value: 3.9, kind: 'decimal',
            digits: 1, denominator: 308,
          },
        ],
        trend: { label: 'Active people', color: 's2', values: WEB_TREND.slice() },
      },
    ],
    cohorts: [{
      app: 'Mobile', label: 'Who comes back', offsets: [1, 2, 3, 4],
      rows: [
        {
          label: 'Week of 24 Aug', size: 214,
          cells: [
            { basisPoints: 7100 }, { basisPoints: 5200 },
            { basisPoints: 4100 }, { state: 'not_aged' },
          ],
        },
        {
          label: 'Week of 31 Aug', size: 31,
          cells: [
            { basisPoints: 8000 }, { basisPoints: 6000 },
            { state: 'not_aged' }, { state: 'not_aged' },
          ],
        },
      ],
    }],
    funnel: {
      hint: 'From signing up to a first program',
      steps: [
        { label: 'Signed up', count: 412, tone: 's1' },
        { label: 'Finished onboarding', count: 318, tone: 's1' },
        { label: 'Started a program', count: 204, tone: 's3' },
      ],
      note: { title: 'Biggest drop is onboarding.', detail: '94 people stopped there.' },
    },
    features: {
      hint: 'Share of people who used it at least once',
      rows: [
        {
          label: 'Chat with Aria', app: 'Mobile', color: 's1',
          basisPoints: 6400, users: 679, denominator: 1061,
        },
        {
          label: 'Video analysis', app: 'Mobile', color: 's3',
          basisPoints: 1200, users: 5, denominator: 41,
        },
      ],
      coverageNote: 'Counted over people on a reporting app version.',
    },
    coverage: {
      shortfall: { detail: 'Eight per cent of sessions are on a version that does not report.' },
      versions: [
        { label: '2.9.1', coverageBasisPoints: 10000, sessionShareBasisPoints: 7200 },
        { label: '2.8.4', coverageBasisPoints: 0, sessionShareBasisPoints: 800 },
      ],
    },
  };
  if (!over) return base;
  /* An override that mutates and returns nothing would otherwise yield
     undefined, which boot() reads as "no override" and quietly serves the
     default fixture: a test written to remove a field would then pass against
     a payload that still had it. Both styles work. */
  const out = over(base);
  return out === undefined ? base : out;
}

/* -------------------------------------------------------------- the page */

function buildPage(dom, body) {
  const el = (parent, tag, attrs = {}) => {
    const node = dom.element(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };
  body.setAttribute('data-pane', 'analytics');
  body.className = 'is-booting';
  const boot = el(body, 'main', { class: 'gate gate-boot gate-center' });
  el(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  el(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = el(body, 'div', { class: 'gate gate-app' });
  el(appGate, 'div', { id: 'app' });
}

/* Loads the page the way ops/analytics.html loads it: registry, aria.js, the
   bootstrap, then the pane module. */
async function boot(options) {
  const opts = options || {};
  const calls = [];
  const answer = opts.usage === undefined ? usageFixture() : opts.usage;
  const search = opts.search || '';

  const dom = makeDom({
    tokens: TOKENS,
    href: 'https://ops.example.invalid/ops/analytics.html' + search,
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
      if (endpoint !== '/api/ops/usage') return Promise.reject(new Error('no stub for ' + endpoint));
      if (answer instanceof Error) return Promise.reject(answer);
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
  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-analytics.js' });

  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));

  return { ...dom, body, calls, content: dom.doc.getElementById('content') };
}

/* The panel the operator can see. The other three are siblings of it and are
   hidden by aria.css, so reading the whole region would read text nobody is
   looking at. */
function panel(dom, state) {
  const shown = dom.doc.getElementById('content')
    .querySelectorAll('[data-state]')
    .filter((n) => (n.getAttribute('data-state') || '').split(' ').indexOf(state) !== -1);
  return shown[0];
}

const livePanel = (dom) => panel(dom, 'live');
const liveText = (dom) => allText(livePanel(dom));
const emptyText = (dom) => allText(panel(dom, 'empty'));

/* One tile, by its heading. Whole-pane text is the wrong instrument for a rule
   about one figure: another sentence elsewhere can carry the same words and
   the assertion passes without the tile being right. */
function tile(dom, heading) {
  return findAll(livePanel(dom), (n) => (n.className || '').split(' ').indexOf('kpi') !== -1)
    .filter((n) => heading.test(allText(n)))[0];
}

function tileText(dom, heading) {
  const found = tile(dom, heading);
  return found ? allText(found) : '';
}

/* A card, by the text of its head. */
function card(dom, heading) {
  return findAll(livePanel(dom), (n) => (n.className || '').split(' ').indexOf('card') !== -1)
    .filter((n) => heading.test(allText(n)))[0];
}

/* The harness upper-cases the tagName of an HTML element and leaves an SVG
   one as written, which is what the browser does. Comparing through this
   rather than by hand means a selector cannot silently match nothing. */
const isTag = (node, name) => (node.tagName || '').toLowerCase() === name;

function chart(dom) {
  return findAll(livePanel(dom),
    (n) => isTag(n, 'svg') && n.getAttribute('role') === 'img')[0];
}

function paths(group) {
  return findAll(group, (n) => isTag(n, 'path'));
}

/* The line groups, one per app, keyed by the series name they carry. */
function seriesGroup(dom, name) {
  return findAll(chart(dom),
    (n) => isTag(n, 'g') && n.getAttribute('data-series') === name)[0];
}

function numerals(text) {
  return (text.match(/\d/g) || []).length;
}

/* ========================= the read and the filters ===================== */

test('the read carries the whole selection, not part of it', async () => {
  const dom = await boot({ search: '?scope=mobile&range=7d&env=staging' });
  assert.equal(dom.calls.length, 1, 'the pane did not read exactly once on boot');
  assert.equal(dom.calls[0].endpoint, '/api/ops/usage', 'the pane read a different route');
  /* Spread rather than compare the object itself: it was made inside the vm
     realm, so deepEqual would fail on its prototype no matter what it holds. */
  assert.deepEqual({ ...dom.calls[0].query }, { scope: 'mobile', range: '7d', env: 'staging' },
    'the read dropped part of the selection: ' + JSON.stringify(dom.calls[0].query));
});

/* Driven through the shell's own Range control rather than by dispatching
   ops:filters by hand: a synthetic event carries whatever detail the test
   writes, so a pane that ignored the event and re-read its own stale
   selection would still look right. */
test('changing a filter re-reads with the new selection', async () => {
  const dom = await boot({});
  const first = dom.calls.length;
  const select = dom.doc.getElementById('fRange');
  assert.ok(select, 'the shell drew no Range control to change');

  select.value = '90d';
  select.dispatch('change');
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));

  assert.equal(dom.calls.length, first + 1, 'a filter change did not cause a second read');
  assert.equal(dom.calls[dom.calls.length - 1].query.range, '90d',
    'the second read did not carry the new range');
});

/* ============================ the reporting floor ====================== */

test('a rate over a group under the floor is withheld, and one over the floor is drawn', async () => {
  const under = await boot({
    usage: usageFixture((u) => {
      u.apps[0].metrics[3].denominator = 49;
      u.apps[0].metrics[3].value = 7.9;
    }),
  });
  const withheldTile = tileText(under, /Sessions per person/);
  assert.match(withheldTile, /Not reported/, 'a rate over 49 people was published anyway');
  assert.match(withheldTile, /floor is 50/, 'the tile withheld a figure without saying why');
  assert.doesNotMatch(withheldTile, /7\.9/, 'the withheld figure was printed regardless');

  /* The other direction. Without it this test passes just as well against a
     pane that withholds every figure it is given. */
  const over = await boot({
    usage: usageFixture((u) => {
      u.apps[0].metrics[3].denominator = 50;
      u.apps[0].metrics[3].value = 7.9;
    }),
  });
  const shown = tileText(over, /Sessions per person/);
  assert.match(shown, /7\.9/, 'a rate over exactly 50 people was withheld');
  assert.doesNotMatch(shown, /Not reported/, 'a publishable figure was withheld anyway');
});

test('a ratio delivered as a decimal still goes through the floor', async () => {
  /* The historical defect: the guard keyed on kind === "rate", and a ratio
     sent as a decimal walked straight past it. The denominator is the signal,
     not the kind. */
  const dom = await boot({
    usage: usageFixture((u) => {
      u.apps[0].metrics[3].kind = 'decimal';
      u.apps[0].metrics[3].denominator = 12;
      u.apps[0].metrics[1].denominator = 12;
    }),
  });
  assert.match(tileText(dom, /Sessions per person/), /Not reported/,
    'a ratio labelled decimal was published over a group of 12');
  assert.match(tileText(dom, /^\s*Sessions\b/m), /Not reported/,
    'a count that arrived with a denominator was published over a group of 12');
});

test('a feature row over too small a group shows no share', async () => {
  const dom = await boot({});
  const features = card(dom, /Most used features/);
  const text = allText(features);
  assert.match(text, /Chat with Aria/, 'the feature table lost its rows');
  assert.match(text, /64\.0%/, 'a share over 1061 people was withheld');
  assert.match(text, /Not reported, 41 people in the group, floor is 50/,
    'a share over 41 people was published: ' + text);
  assert.doesNotMatch(text, /12\.0%/, 'the withheld share was drawn anyway');
});

test('a signup group under the floor is withheld as a whole row, never cell by cell', async () => {
  const dom = await boot({});
  const cohort = card(dom, /Who comes back/);
  const rows = findAll(cohort, (n) => isTag(n, 'tr'));
  const small = rows.filter((r) => /Week of 31 Aug/.test(allText(r)))[0];
  const big = rows.filter((r) => /Week of 24 Aug/.test(allText(r)))[0];

  assert.ok(small, 'the small signup group left the table entirely');
  assert.match(allText(small), /Not reported, 31 people in the group, floor is 50/,
    'a group of 31 was reported: ' + allText(small));
  assert.doesNotMatch(allText(small), /80\.0%|60\.0%/,
    'the cells of a withheld row were drawn anyway');
  assert.equal(findAll(small, (n) => isTag(n, 'td')).length, 2,
    'the withheld row still drew one cell per week, so the rest can be read as a trend');

  assert.match(allText(big), /71\.0%/, 'a group of 214 was withheld too, so this proves nothing');
});

/* ======================== empty is never a zero ========================= */

test('a window with no stored days shows its stored-day figures as not reported', async () => {
  const none = await boot({
    usage: usageFixture((u) => {
      u.window.daysCovered = 0;
      u.window.reportingStart = null;
      u.apps.forEach((app) => {
        app.metrics[1].value = 0;
        app.metrics[3].value = 0;
      });
    }),
  });
  const sessions = tileText(none, /^\s*Sessions\b/m);
  assert.match(sessions, /Not reported/, 'a window with nothing stored drew a zero');
  assert.match(sessions, /no day in this window has stored figures/i,
    'the tile withheld the figure without saying why: ' + sessions);

  /* The live figure in the same answer is unaffected: it is read from accounts
     rather than from the rollups, so hiding it would be its own lie. */
  assert.match(tileText(none, /Active people/), /1,061/,
    'the live figure was withheld along with the stored ones');

  /* The other direction. A real zero over a window that DID store days is a
     measurement and has to survive. */
  const real = await boot({
    usage: usageFixture((u) => {
      u.apps.forEach((app) => { app.metrics[1].value = 0; });
    }),
  });
  const measured = tileText(real, /^\s*Sessions\b/m);
  assert.match(measured, /\b0\b/, 'a measured zero was hidden');
  assert.doesNotMatch(measured, /Not reported/,
    'a measured zero over a covered window was called not reported');
});

test('an answer that is not ready draws words and never a figure', async () => {
  const dom = await boot({
    usage: {
      availability: { state: 'not_reporting', detail: 'No app has reported since 3 Sep.' },
      asOf: hoursAgo(5),
    },
  });
  const text = emptyText(dom);
  assert.match(text, /Usage is not being reported/, 'a not-reporting answer drew something else');
  assert.match(text, /No app has reported since 3 Sep\./,
    'the pane replaced the reason the route gave with one of its own');
  assert.equal(liveText(dom), '', 'the live panel was filled from an answer that is not ready');
});

test('too little data offers the widest window, and stops offering it there', async () => {
  const narrow = await boot({
    search: '?range=7d',
    usage: { availability: { state: 'insufficient', detail: 'Fewer than 50 people in this window.' } },
  });
  const text = emptyText(narrow);
  assert.match(text, /Not enough usage to report yet/, 'the insufficient state drew something else');
  assert.match(text, /Try the widest window/, 'a widenable window offered no way to widen it');
  const link = findAll(panel(narrow, 'empty'), (n) => isTag(n, 'a'))[0];
  assert.match(link.getAttribute('href'), /range=90d/,
    'the offer pointed somewhere other than the widest window: ' + link.getAttribute('href'));

  /* At the widest window there is nothing to offer, and an action that changes
     nothing is worse than no action. */
  const widest = await boot({
    search: '?range=90d',
    usage: { availability: { state: 'insufficient', detail: 'Fewer than 50 people in this window.' } },
  });
  assert.doesNotMatch(emptyText(widest), /Try the widest window/,
    'the widest window still offered to widen itself');
});

test('a read that fails is degraded, not empty, and can be tried again', async () => {
  const dom = await boot({ usage: new Error('The operations API did not answer.') });
  const degraded = allText(panel(dom, 'degraded'));
  assert.match(degraded, /This pane could not be read/, 'a failed read did not degrade');
  assert.match(degraded, /Nothing here is a zero/, 'a failed read was presented as an absence');
  assert.equal(emptyText(dom), '', 'a failed read was drawn as an empty pane');

  const again = findAll(panel(dom, 'degraded'), (n) => isTag(n, 'button'))[0];
  assert.ok(again, 'a failed read offered no retry');
  const before = dom.calls.length;
  again.dispatch('click');
  assert.equal(dom.calls.length, before + 1, 'the retry did not read again');
});

/* ========================== the apps are separate ====================== */

test('a headline figure is one app, named, with the other beside it and never added', async () => {
  const dom = await boot({});
  const active = tileText(dom, /Active people/);

  assert.match(active, /1,061/, 'the headline lost the leading app figure');
  assert.match(active, /Mobile/, 'the headline figure did not say which app it is');
  assert.match(active, /Coaches Web 308/, 'the other app reading is not beside it');
  assert.doesNotMatch(active, /1,369/, 'the two apps were added together');
  assert.doesNotMatch(liveText(dom), /1,369/, 'something else on the pane added the two apps');
});

test('one app is a split that cannot exist, not an empty one', async () => {
  const one = await boot({
    search: '?scope=mobile',
    usage: usageFixture((u) => { u.apps = u.apps.slice(0, 1); }),
  });
  const text = liveText(one);
  assert.match(text, /No split to draw/, 'one app was drawn as a comparison anyway');
  assert.match(text, /Only Mobile is in this selection/,
    'the pane did not say why there is nothing to compare');
  const offer = findAll(livePanel(one), (n) => isTag(n, 'a'))
    .filter((n) => /Show every app/.test(allText(n)))[0];
  assert.ok(offer, 'a scoped selection offered no way to widen it');
  assert.match(offer.getAttribute('href'), /scope=all/,
    'the offer did not point at every app: ' + offer.getAttribute('href'));

  /* The other direction: two apps is a comparison and has to draw one. */
  const two = await boot({});
  assert.doesNotMatch(liveText(two), /No split to draw/,
    'two apps were refused a comparison');
  assert.match(allText(card(two, /Side by side/)), /Coaches Web/,
    'the comparison lost one of its columns');
});

test('every app figure is in the split, withheld ones with their reason', async () => {
  const dom = await boot({
    usage: usageFixture((u) => { u.apps[1].metrics[3].denominator = 20; }),
  });
  const split = allText(card(dom, /Side by side/));
  assert.match(split, /Median session/, 'the split lost a figure the answer sent');
  assert.match(split, /10m 40s/, 'a seconds figure was not printed as a duration');
  assert.match(split, /Not reported, 20 people in the group, floor is 50/,
    'a withheld figure in the split gave no reason: ' + split);
  assert.doesNotMatch(split, /3\.9/, 'the withheld figure was printed in the split anyway');
});

/* ================================ the line ============================= */

test('a day with no reading breaks the line rather than being joined across', async () => {
  const whole = await boot({});
  assert.equal(paths(seriesGroup(whole, 'Mobile')).length, 1,
    'an unbroken series was drawn as more than one path');

  const gapped = await boot({
    usage: usageFixture((u) => {
      u.apps[0].trend.values[10] = null;
      u.apps[0].trend.values[11] = null;
    }),
  });
  assert.equal(paths(seriesGroup(gapped, 'Mobile')).length, 2,
    'a two-day gap did not break the line into two paths');
  assert.equal(paths(seriesGroup(gapped, 'Coaches Web')).length, 1,
    'the other series broke too, so the break is not about the gap');
});

test('a single reading between two gaps is drawn as a point, not dropped', async () => {
  const dom = await boot({
    usage: usageFixture((u) => {
      u.apps[0].trend.values = u.apps[0].trend.values.map((v, i) => (i === 14 ? v : null));
    }),
  });
  const group = seriesGroup(dom, 'Mobile');
  const marks = paths(group);
  assert.equal(marks.length, 1, 'the one day with a reading was not drawn at all');
  /* A dot rather than a line: the point mark is its own class, and its path
     starts and ends on the same coordinate. A line between two readings would
     be .ln and would move. */
  assert.equal(marks[0].getAttribute('class'), 'ln-pt',
    'one reading was drawn as a line');
  const [move, to] = marks[0].getAttribute('d').split('L');
  assert.equal(move.slice(1), to, 'the point mark was drawn with a length');
});

test('the days with no stored figures are named under the line', async () => {
  const dom = await boot({
    usage: usageFixture((u) => {
      u.window.daysMissingRollups = ['2026-09-03T00:00:00.000Z', '2026-09-04T00:00:00.000Z'];
    }),
  });
  const trend = allText(card(dom, /Active people, /)) || liveText(dom);
  assert.match(trend, /No stored figures on 3 Sep 2026, 4 Sep 2026/,
    'the gap days were not named: ' + trend);

  const clean = await boot({});
  assert.doesNotMatch(liveText(clean), /No stored figures on/,
    'a window with no gaps still claimed one');
});

/* ============================ the chart's name ========================= */

test('the chart is named with its own data, and the name moves when the data does', async () => {
  const dom = await boot({});
  const name = chart(dom).getAttribute('aria-label');

  assert.match(name, /Active people/, 'the chart name did not say what is drawn');
  assert.match(name, /one line per app/, 'the chart name did not say it is more than one series');
  assert.match(name, /the last 30 days/, 'the chart name did not say the window it covers');
  assert.match(name, /Mobile: 30 of 30 days with a reading/,
    'the chart name did not say how much of the window the series has: ' + name);
  assert.match(name, /low 980, high 1,214/, 'the chart name did not carry the range');
  assert.match(name, /ending 1,061/, 'the chart name did not carry the last reading');
  assert.match(name, /Coaches Web:/, 'the chart name left a drawn series out');

  const moved = await boot({
    usage: usageFixture((u) => {
      u.apps[0].trend.values[0] = null;
      u.apps[0].trend.values[29] = 1;
    }),
  });
  const second = chart(moved).getAttribute('aria-label');
  assert.match(second, /Mobile: 29 of 30 days with a reading/,
    'the name did not follow the data: ' + second);
  assert.match(second, /ending 1\b/, 'the name kept the old last reading');
});

test('a series with no reading at all says so in the name', async () => {
  const dom = await boot({
    usage: usageFixture((u) => {
      u.apps[1].trend.values = u.apps[1].trend.values.map(() => null);
    }),
  });
  assert.match(chart(dom).getAttribute('aria-label'),
    /Coaches Web: no reading on any of 30 days/,
    'a silent series was left out of the name instead of being named as silent');
});

test('every picture of data is either named with its data or hidden', async () => {
  const dom = await boot({});
  const svgs = findAll(livePanel(dom), (n) => isTag(n, 'svg'));
  assert.ok(svgs.length >= 3, 'the pane drew almost nothing, so this proves little');

  for (const svg of svgs) {
    const hidden = svg.getAttribute('aria-hidden') === 'true';
    const named = svg.getAttribute('role') === 'img' &&
      (svg.getAttribute('aria-label') || '').length > 12;
    assert.ok(hidden || named,
      'an svg is neither hidden nor named: class=' + (svg.className || '') +
      ' role=' + svg.getAttribute('role') + ' label=' + svg.getAttribute('aria-label'));
    assert.ok(!(hidden && svg.getAttribute('role') === 'img'),
      'an svg claims to be a picture and is hidden from the tree at the same time');
  }
});

test('the tile sparkline is hidden, and is not drawn across a gap', async () => {
  const dom = await boot({});
  const spark = findAll(tile(dom, /Active people/), (n) => isTag(n, 'svg'))[0];
  assert.ok(spark, 'the headline tile drew no sparkline for a series it has');
  assert.equal(spark.getAttribute('aria-hidden'), 'true',
    'the sparkline is announced as well as the chart that states the same series');

  const gapped = await boot({
    usage: usageFixture((u) => { u.apps[0].trend.values[7] = null; }),
  });
  assert.equal(findAll(tile(gapped, /Active people/), (n) => isTag(n, 'svg')).length, 0,
    'a sparkline was drawn straight through a day with no reading');
});

/* ============================== how old it is ========================== */

test('an answer a whole run behind says how far behind it is', async () => {
  const stale = await boot({ usage: usageFixture((u) => { u.asOf = hoursAgo(40); }) });
  const text = liveText(stale);
  assert.match(text, /40 hours behind/, 'a 40 hour old answer did not say it was behind');
  assert.match(text, /counted \d+ \w+ \d{4}/i, 'the stale answer did not say when it was counted');

  const fresh = await boot({ usage: usageFixture((u) => { u.asOf = hoursAgo(5); }) });
  const freshText = liveText(fresh);
  assert.doesNotMatch(freshText, /hours behind/, 'a 5 hour old answer was called stale');
  assert.match(freshText, /Counted \d+ \w+ \d{4}/, 'a fresh answer did not say when it was counted');
});

test('an answer with no time on it says that, rather than looking fresh', async () => {
  const dom = await boot({ usage: usageFixture((u) => { delete u.asOf; }) });
  assert.match(liveText(dom), /Counted at an unreported time/,
    'an answer with no timestamp was drawn as though it had one');
  assert.doesNotMatch(liveText(dom), /Counted \d+ \w+ \d{4}/,
    'the pane invented a counting time');
});

/* ============================= not-aged cells ========================== */

test('a week a group has not reached is not a zero', async () => {
  const dom = await boot({});
  const cohort = card(dom, /Who comes back/);
  const row = findAll(cohort, (n) => isTag(n, 'tr'))
    .filter((r) => /Week of 24 Aug/.test(allText(r)))[0];
  const cells = findAll(row, (n) => isTag(n, 'td'));
  const last = cells[cells.length - 1];

  assert.match(allText(last), /Not aged into this week yet/,
    'a week the group has not reached was not named: ' + allText(last));
  assert.equal(numerals(allText(last)), 0, 'a week nobody has reached printed a figure');
  assert.doesNotMatch(allText(cohort), /n\/a/, 'an unreported cell printed a formatter fallback');
});

/* ================================ the tiles ============================ */

test('the tiles are the answer figures, in its order, and never more than four', async () => {
  const dom = await boot({
    usage: usageFixture((u) => {
      u.apps[0].metrics.push({ label: 'Programs started', value: 92, kind: 'count' });
    }),
  });
  const labels = findAll(livePanel(dom),
    (n) => (n.className || '').split(' ').indexOf('kpi-label') !== -1)
    .map((n) => allText(n));

  assert.deepEqual(labels,
    ['Active people', 'Sessions', 'Median session', 'Sessions per person'],
    'the tiles are not the answer figures in the answer order: ' + labels.join(' | '));
});

/* ============================== the page ============================== */

test('the page loads the v2 system and not the v1 one', () => {
  for (const asset of ['assets/aria.css', 'assets/shell-pane-v2.css',
    'assets/pane-analytics-v2.css', 'assets/pane-registry.js', 'assets/aria.js',
    'assets/shell-pane-v2.js', 'assets/pane-analytics.js']) {
    assert.ok(PAGE_HTML.indexOf(asset) !== -1, 'analytics.html no longer loads ' + asset);
  }
  /* Both systems define .card, .rail, .topbar, .btn, .seg, .pill and .tbl from
     different token sets, so a page that loads both is wrong in a way no
     screenshot of one card will show. */
  for (const asset of ['assets/ops.css', 'assets/operate.css', 'assets/shell.js',
    'assets/pane-data.js', 'assets/icons.js']) {
    assert.equal(PAGE_HTML.indexOf(asset), -1, 'analytics.html loads the v1 asset ' + asset);
  }
  assert.ok(PAGE_HTML.indexOf('data-pane="analytics"') !== -1,
    'the page no longer names the pane the bootstrap looks for');
  assert.ok(PAGE_HTML.indexOf('Content-Security-Policy') !== -1,
    'the page lost its content security policy');
});
