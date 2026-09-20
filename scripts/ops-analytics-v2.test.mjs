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

/* A whole, healthy answer.

   Every member below is copied from `OpsUsagePayload` in
   `app-backend/server/services/opsUsage/opsUsageView.ts`, and every literal
   string that the route composes rather than passes through -- the cohort
   note, the consent detail, the feature hint and note, the coverage note, the
   shortfall detail, each version's note -- is the route's own text, character
   for character, from the template that builds it. The enums are the route's
   enums: `app` is the FILTER (`mobile`), not the source app (`mobile-app`);
   `color` is `s1` or `s2` and there is no `s3`; feature labels come from
   `FEATURE_LABELS`, so it is `Sprint video analysis` and never `Video
   analysis`; a cohort row label is `shortUtcDay(week)`, which is `24 Aug`.

   Two things it deliberately gets right that an eyeballed fixture gets wrong,
   because both hid a defect for four review rounds:

   - `sessionShareBasisPoints` is `basisPoints(entry.sessions, appSessions)`,
     computed inside ONE app, so each app's rows sum to 10000 and two apps'
     rows sum to 20000. A fixture whose four rows summed to 8000 made a column
     of shares look like one denominator.
   - `cohorts` is one entry PER APP, not one for the selection.

   What this fixture is not is every shape: `usageFixture` is a healthy 30-day
   `ready` answer with two apps. Absence, staleness, the reporting floor, the
   90-day grid and the three non-ready states are separate cases below, each
   one starting here and taking something away or moving one field, because
   the rules under test are rules about absence. */

const CONSENT_DETAIL =
  'Product analytics is opt in and defaults off, and the gate is at ingest: a client batch from '
  + 'an account that has not turned usage analytics on is refused before any event is stored. '
  + 'Every figure here is built from client-origin events only, so it was never recorded for an '
  + 'opted-out account. There is no read-time filter, because a filter would imply the rows exist.';

const cohortNote = (app) =>
  `A group is the accounts created in that UTC week which also opened ${app} `
  + 'that week, and coming back means opening it again. Accounts that have not turned '
  + 'usage analytics on are in no group, because their activity was never recorded.';

function usageFixture(over) {
  const base = {
    asOf: '2026-09-20T00:00:00.000Z',
    window: {
      range: '30d',
      start: '2026-08-21T00:00:00.000Z',
      endExclusive: '2026-09-20T00:00:00.000Z',
      days: 30, grain: 'day', timezone: 'UTC',
      rollupsComputedAt: hoursAgo(5),
      reportingStart: '2026-08-21',
      daysCovered: 30,
      daysMissingRollups: [],
    },
    filters: { app: 'all', env: 'production' },
    reportingFloor: 50,
    consent: { enforcedAt: 'ingest', detail: CONSENT_DETAIL },
    availability: { state: 'ready', detail: '' },
    apps: [
      {
        app: 'mobile', label: 'Mobile', tone: 'mobile', subtitle: 'Athlete app',
        coverageBasisPoints: 9200,
        metrics: [
          { label: 'Active people', kind: 'count', value: 1061 },
          { label: 'Sessions', kind: 'count', value: 8430 },
          {
            label: 'Sessions per person', kind: 'decimal',
            digits: 1, value: 7.945334590009425, numerator: 8430, denominator: 1061,
          },
          {
            label: 'Opened a feature', kind: 'rate',
            value: 6400, numerator: 679, denominator: 1061,
          },
        ],
        trend: {
          label: 'Active people per day, Mobile', color: 's1',
          values: MOBILE_TREND.slice(),
        },
      },
      {
        app: 'coaches', label: 'Coaches Web', tone: 'coaches',
        subtitle: 'Coach workspace',
        coverageBasisPoints: 10000,
        metrics: [
          { label: 'Active people', kind: 'count', value: 308 },
          { label: 'Sessions', kind: 'count', value: 1204 },
          {
            label: 'Sessions per person', kind: 'decimal',
            digits: 1, value: 3.909090909090909, numerator: 1204, denominator: 308,
          },
          {
            label: 'Opened a feature', kind: 'rate',
            value: 8084, numerator: 249, denominator: 308,
          },
        ],
        trend: {
          label: 'Active people per day, Coaches Web', color: 's2',
          values: WEB_TREND.slice(),
        },
      },
    ],
    cohorts: [
      {
        app: 'mobile', label: 'Mobile', offsets: ['W1', 'W2', 'W3', 'W4'],
        rows: [
          {
            label: '24 Aug', size: 214,
            cells: [
              { basisPoints: 7103, returned: 152 }, { basisPoints: 5234, returned: 112 },
              { basisPoints: 4112, returned: 88 }, { state: 'not_aged' },
            ],
          },
          {
            label: '31 Aug', size: 31,
            cells: [
              { basisPoints: 8065, returned: 25 }, { basisPoints: 6129, returned: 19 },
              { state: 'not_aged' }, { state: 'not_aged' },
            ],
          },
        ],
        note: cohortNote('Mobile'),
      },
      {
        app: 'coaches', label: 'Coaches Web', offsets: ['W1', 'W2', 'W3', 'W4'],
        rows: [
          {
            label: '24 Aug', size: 96,
            cells: [
              { basisPoints: 6667, returned: 64 }, { basisPoints: 5313, returned: 51 },
              { basisPoints: 4479, returned: 43 }, { state: 'not_aged' },
            ],
          },
        ],
        note: cohortNote('Coaches Web'),
      },
    ],
    features: {
      hint: "Share of each app's own active people",
      rows: [
        {
          label: 'Aria chat', app: 'Mobile', color: 's1',
          basisPoints: 6400, users: 679, denominator: 1061,
        },
        {
          label: 'Sprint video analysis', app: 'Mobile', color: 's1',
          basisPoints: 1200, users: 5, denominator: 41,
        },
      ],
      note:
        'Each feature is measured against the active people of the app it belongs to. A '
        + 'shared denominator would understate a feature only one app has.',
      coverageNote:
        'Feature use is measured only on sessions from app versions that report it. '
        + 'Mobile coverage in this window is 92.0%.',
    },
    coverage: {
      shortfall: {
        detail:
          '8.0% of Mobile sessions in this window ran on an app version that does not '
          + 'report feature use.',
      },
      versions: [
        {
          label: 'Mobile 2.9.1', coverageBasisPoints: 10000,
          sessionShareBasisPoints: 7200, note: 'Share is of Mobile sessions.',
        },
        {
          label: 'Mobile 2.8.4', coverageBasisPoints: 0,
          sessionShareBasisPoints: 2800, note: 'Share is of Mobile sessions.',
        },
        {
          label: 'Coaches Web version not reported', coverageBasisPoints: 0,
          sessionShareBasisPoints: 10000, note: 'Share is of Coaches Web sessions.',
        },
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
      u.apps[0].metrics[3].value = 6400;
    }),
  });
  const withheldTile = tileText(under, /Opened a feature/);
  assert.match(withheldTile, /Not reported/, 'a rate over 49 people was published anyway');
  assert.match(withheldTile, /floor is 50/, 'the tile withheld a figure without saying why');
  assert.doesNotMatch(withheldTile, /64\.0%/, 'the withheld figure was printed regardless');

  /* The other direction. Without it this test passes just as well against a
     pane that withholds every figure it is given. */
  const over = await boot({
    usage: usageFixture((u) => {
      u.apps[0].metrics[3].denominator = 50;
      u.apps[0].metrics[3].value = 6400;
    }),
  });
  const shown = tileText(over, /Opened a feature/);
  assert.match(shown, /64\.0%/, 'a rate over exactly 50 people was withheld');
  assert.doesNotMatch(shown, /Not reported/, 'a publishable figure was withheld anyway');
});

test('a ratio delivered as a decimal still goes through the floor', async () => {
  /* The historical defect: the guard keyed on kind === "rate", and a ratio
     sent as a decimal walked straight past it. The denominator is the signal,
     not the kind. */
  const dom = await boot({
    usage: usageFixture((u) => {
      u.apps[0].metrics[2].kind = 'decimal';
      u.apps[0].metrics[2].denominator = 12;
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
  assert.match(text, /Aria chat/, 'the feature table lost its rows');
  assert.match(text, /64\.0%/, 'a share over 1061 people was withheld');
  assert.match(text, /Not reported, 41 people in the group, floor is 50/,
    'a share over 41 people was published: ' + text);
  assert.doesNotMatch(text, /12\.0%/, 'the withheld share was drawn anyway');
});

test('a signup group under the floor is withheld as a whole row, never cell by cell', async () => {
  const dom = await boot({});
  const cohort = card(dom, /Who comes back/);
  const rows = findAll(cohort, (n) => isTag(n, 'tr'));
  const small = rows.filter((r) => /^31 Aug/m.test(allText(r)))[0];
  const big = rows.filter((r) => /^24 Aug/m.test(allText(r)))[0];

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
        app.metrics[2].value = 0;
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
  assert.match(split, /Opened a feature/, 'the split lost a figure the answer sent');
  assert.match(split, /64\.0%/, 'a rate the answer sent was not printed as a percentage');
  assert.match(split, /Not reported, 20 people in the group, floor is 50/,
    'a withheld figure in the split gave no reason: ' + split);
  assert.doesNotMatch(split, /81\.0%/, 'the withheld figure was printed in the split anyway');
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
      u.window.daysMissingRollups = ['2026-09-03', '2026-09-04'];
    }),
  });
  const trend = allText(card(dom, /Active people per day/)) || liveText(dom);
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

  assert.match(name, /^Active people per day, one line per app/,
    'the chart name did not say what is drawn: ' + name);
  assert.doesNotMatch(name, /^Daily activity/,
    'the chart name fell back to a generic phrase against the labels the route sends');
  assert.doesNotMatch(name, /per day, Mobile/,
    'the chart name kept one app\'s qualifier over a chart of both apps: ' + name);
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

test('the age is read from the recompute, not from the end of the window', async () => {
  /* The route sets `asOf` to the window's exclusive end, which is the last UTC
     midnight recomputed on every request. Reading the age from it makes every
     answer under 24 hours old by construction, so the stale path can never be
     reached no matter how far behind the rollups are. The freshness the pane
     is claiming to report lives in `window.rollupsComputedAt`. */
  const behind = await boot({
    usage: usageFixture((u) => {
      u.asOf = new Date(Date.now() - 2 * HOUR).toISOString();
      u.window.rollupsComputedAt = hoursAgo(84);
    }),
  });
  const text = liveText(behind);
  assert.match(text, /84 hours behind/,
    'the age came from the window end rather than the recompute: ' + text);

  /* The other direction, and the one a field swap would pass on its own: a
     fresh recompute behind an old window end is NOT stale. */
  const ahead = await boot({
    usage: usageFixture((u) => {
      u.asOf = hoursAgo(84);
      u.window.rollupsComputedAt = new Date(Date.now() - 2 * HOUR).toISOString();
    }),
  });
  assert.doesNotMatch(liveText(ahead), /hours behind/,
    'a fresh recompute was called stale because the window end was old');
});

test('an answer a whole run behind says how far behind it is', async () => {
  const stale = await boot({
    usage: usageFixture((u) => { u.window.rollupsComputedAt = hoursAgo(40); }),
  });
  const text = liveText(stale);
  assert.match(text, /40 hours behind/, 'a 40 hour old answer did not say it was behind');
  assert.match(text, /counted \d+ \w+ \d{4}/i, 'the stale answer did not say when it was counted');

  const fresh = await boot({
    usage: usageFixture((u) => { u.window.rollupsComputedAt = hoursAgo(5); }),
  });
  const freshText = liveText(fresh);
  assert.doesNotMatch(freshText, /hours behind/, 'a 5 hour old answer was called stale');
  assert.match(freshText, /Counted \d+ \w+ \d{4}/, 'a fresh answer did not say when it was counted');
});

test('an answer with no time on it says that, rather than looking fresh', async () => {
  const unreadable = await boot({
    usage: usageFixture((u) => { u.window.rollupsComputedAt = 'whenever'; }),
  });
  assert.match(liveText(unreadable), /Counted at an unreported time/,
    'an answer with an unreadable timestamp was drawn as though it had one');
  assert.doesNotMatch(liveText(unreadable), /Counted \d+ \w+ \d{4}/,
    'the pane invented a counting time');

  /* Null is the route's own value for "nothing has been computed", and it is a
     different statement from a time that cannot be read. */
  const never = await boot({
    usage: usageFixture((u) => { u.window.rollupsComputedAt = null; }),
  });
  assert.match(liveText(never), /Nothing counted yet/,
    'a window with no recompute at all was drawn as though it had one');
  assert.doesNotMatch(liveText(never), /Counted \d+ \w+ \d{4}/,
    'the pane invented a counting time for a window that has never been computed');
});

/* ======================= how much of it is covered ===================== */

test('a window the pipeline has only reached part of says so beside the figures', async () => {
  /* `daysCovered` with `reportingStart` is not a shade of staleness and not an
     availability state: the route is explicit that partial coverage annotates
     the figures rather than replacing them. A 90 day window opened today
     reaches back past the day the nightly job started writing rollups, so its
     session total is a sum over the covered span while the range name still
     says 90 days. Without this the two answers draw the same screen. */
  const partial = await boot({
    usage: usageFixture((u) => {
      u.window.range = '90d';
      u.window.days = 90;
      u.window.daysCovered = 20;
      u.window.reportingStart = '2026-08-31';
    }),
  });
  const text = liveText(partial);
  assert.match(text, /20 of 90 days stored/,
    'a window covered for 20 of its 90 days did not say so: ' + text);
  assert.match(text, /from 31 Aug 2026/,
    'the covered span did not say where it starts: ' + text);

  /* The other direction, which is the one a hard-coded sentence passes on its
     own: a fully covered window must not carry the annotation. */
  const whole = await boot({
    usage: usageFixture((u) => {
      u.window.range = '90d';
      u.window.days = 90;
      u.window.daysCovered = 90;
    }),
  });
  assert.doesNotMatch(liveText(whole), /of 90 days stored/,
    'a fully covered window was annotated as short');

  /* And the figures still draw. Partial coverage is not the empty state. */
  assert.match(text, /8,430/, 'a partly covered window stopped drawing its figures');
});

test('a window with nothing stored says that once, not twice', async () => {
  /* `daysCovered: 0` with `reportingStart: null` arrives as `ready`, and every
     figure counted from stored days already reads NOT REPORTED with the reason
     attached. A pill reading `0 of 90 days stored` beside them would be the
     same fact a second time, which is the rule this remodel exists for. */
  const none = await boot({
    usage: usageFixture((u) => {
      u.window.range = '90d';
      u.window.days = 90;
      u.window.daysCovered = 0;
      u.window.reportingStart = null;
      /* Not one day aggregated means the sums over stored days are zero. A
         fixture that leaves them at 8,430 is one the route cannot send. */
      u.apps.forEach((app) => {
        app.metrics[1].value = 0;
        app.metrics[2].value = 0;
      });
    }),
  });
  const text = liveText(none);
  assert.doesNotMatch(text, /0 of 90 days stored/,
    'the empty covered span was drawn as a short one');
  assert.match(text, /no day in this window has stored figures/,
    'a window with nothing stored did not say so: ' + text);
});

/* ============================= not-aged cells ========================== */

test('a week a group has not reached is not a zero', async () => {
  const dom = await boot({});
  const cohort = card(dom, /Who comes back/);
  const row = findAll(cohort, (n) => isTag(n, 'tr'))
    .filter((r) => /^24 Aug/m.test(allText(r)))[0];
  const cells = findAll(row, (n) => isTag(n, 'td'));
  const last = cells[cells.length - 1];

  assert.match(allText(last), /Not aged into this week yet/,
    'a week the group has not reached was not named: ' + allText(last));
  assert.equal(numerals(allText(last)), 0, 'a week nobody has reached printed a figure');
  assert.doesNotMatch(allText(cohort), /n\/a/, 'an unreported cell printed a formatter fallback');
});

test('the cohort card names its app, and never the filter behind it', async () => {
  const dom = await boot({});
  const cohort = card(dom, /Who comes back/);
  const head = findAll(cohort, (n) => (n.className || '').split(' ').indexOf('card-head') !== -1)[0];
  const headText = allText(head);

  /* `label` is the app's name and `app` is the value the filter sends. The two
     are a word apart in the payload and a world apart on screen. */
  assert.match(headText, /Mobile/, 'the cohort card did not say which app it is of');
  assert.doesNotMatch(headText, /\bmobile\b/,
    'the cohort card printed the filter enum at an operator: ' + headText);
  assert.match(headText, /Who comes back/,
    'the cohort card lost the question it answers: ' + headText);
});

test('a week column is headed in words, from the offset the route sends', async () => {
  const dom = await boot({});
  const cohort = card(dom, /Who comes back/);
  const heads = findAll(cohort, (n) => isTag(n, 'th') && n.getAttribute('scope') === 'col')
    .map((n) => allText(n).trim());

  assert.deepEqual(heads, ['Week joined', 'People', 'Week 1', 'Week 2', 'Week 3', 'Week 4'],
    'the offsets the route sends were not headed in words: ' + heads.join(' | '));
});

test('the tile draws the line of its own figure, and only of its own figure', async () => {
  const dom = await boot({});
  /* The route qualifies the series with the app -- `Active people per day,
     Mobile` against a figure called `Active people` -- so an equality test
     draws no sparkline at all on a real answer. */
  assert.equal(findAll(tile(dom, /Active people/), (n) => isTag(n, 'svg')).length, 1,
    'the figure the daily line is of drew no line');
  assert.equal(findAll(tile(dom, /^\s*Sessions\b/m), (n) => isTag(n, 'svg')).length, 0,
    'a figure the daily line is not of drew it anyway');

  /* The boundary: a longer figure name that merely starts the same way is a
     different figure and takes no line. */
  const other = await boot({
    usage: usageFixture((u) => {
      u.apps[0].trend.label = 'Active people who churned per day, Mobile';
      u.apps[1].trend.label = 'Active people who churned per day, Coaches Web';
    }),
  });
  assert.equal(findAll(tile(other, /Active people/), (n) => isTag(n, 'svg')).length, 0,
    'a tile claimed a line drawn of something else');
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
    ['Active people', 'Sessions', 'Sessions per person', 'Opened a feature'],
    'the tiles are not the answer figures in the answer order: ' + labels.join(' | '));
});

/* ========================== the widest answer ========================= */

/* `offsets` is as long as the widest group has aged weeks, so the 90 day range
   -- one of the four the bar offers, and where the insufficient state's own
   button navigates to -- sends `W1` to `W11`. The 30 day fixture above sends
   four, which is why four review rounds ran over a grid that was unreadable at
   eleven. */
function wideFixture(over) {
  return usageFixture((u) => {
    u.window.range = '90d';
    u.window.days = 90;
    u.window.daysCovered = 90;
    u.window.start = '2026-06-22T00:00:00.000Z';
    u.cohorts = u.cohorts.map((cohort, index) => {
      const offsets = Array.from({ length: 11 }, (_, i) => `W${i + 1}`);
      return {
        ...cohort,
        offsets,
        rows: ['22 Jun', '29 Jun', '6 Jul', '13 Jul'].map((label, row) => ({
          label,
          size: 180 + row * 7 + index,
          cells: offsets.map((_, i) => (
            i > 10 - row ? { state: 'not_aged' } : { basisPoints: 7200 - i * 430, returned: 100 - i }
          )),
        })),
      };
    });
    if (over) over(u);
  });
}

test('the widest window draws every week it sends', async () => {
  const dom = await boot({ usage: wideFixture() });
  const cohort = card(dom, /Who comes back/);
  const heads = findAll(cohort, (n) => isTag(n, 'th'))
    .map(allText)
    .filter((t) => /^Week \d+$/.test(t.trim()));

  assert.deepEqual(heads.map((t) => t.trim()),
    Array.from({ length: 11 }, (_, i) => `Week ${i + 1}`),
    'a 90 day answer did not draw one column per offset it sent: ' + heads.join(', '));

  /* Every row is as long as the heading row. A grid that drops or merges cells
     to fit is a different defect from one that overlaps them, and both read as
     "it fits now". */
  const bodyRows = findAll(cohort, (n) => isTag(n, 'tr'))
    .filter((r) => /^\d+ \w+/m.test(allText(r)));
  assert.equal(bodyRows.length, 4, 'not every group was drawn');
  for (const row of bodyRows) {
    const cells = findAll(row, (n) => isTag(n, 'td') &&
      /\bu-(cell|na)\b/.test(n.className || ''));
    assert.equal(cells.length, 11,
      'a group row is not as wide as the heading row: ' + allText(row));
  }
});

test('the weeks past the edge are reachable without a pointer', async () => {
  /* A box that scrolls sideways is not in Chrome's tab order on its own, so
     the columns past the card's edge would be a pointer's alone. Named, so the
     region it becomes says which app's grid it is. */
  const dom = await boot({ usage: wideFixture() });
  const cohort = card(dom, /Who comes back/);
  const box = findAll(cohort, (n) => (n.className || '').includes('u-scroll'))[0];
  assert.ok(box, 'the grid is not inside a scroll box at all');
  assert.equal(box.getAttribute('tabindex'), '0',
    'the scroll box cannot be reached from a keyboard');
  assert.equal(box.getAttribute('role'), 'region', 'the scroll box is an unnamed div');
  assert.match(box.getAttribute('aria-label') || '', /Retention by signup week, Mobile/,
    'the region does not say which grid it is: ' + box.getAttribute('aria-label'));

  /* And the name degrades rather than trailing a comma when the answer sends
     no label. */
  const unlabelled = await boot({
    usage: wideFixture((u) => { u.cohorts = [{ ...u.cohorts[0], label: '' }]; }),
  });
  const bare = findAll(card(unlabelled, /Who comes back/),
    (n) => (n.className || '').includes('u-scroll'))[0];
  assert.equal(bare.getAttribute('aria-label'), 'Retention by signup week',
    'an answer with no app name left a dangling comma in the region name');
});

test('the retention grid is sized by its content and scrolls, at every width', async () => {
  /* WHAT THIS PINS, EXACTLY: two declarations in the stylesheet, not a
     rendering. It cannot see an overlap -- `node:test` has no layout -- and it
     is here because the rendering proof does not live in this file: the
     measured matrix is in the pull request, 320px to 1680px in both themes,
     with a control that puts `table-layout: fixed` back and reproduces ten
     overlapping cell pairs at every width.

     It is still worth its line, because the failure it guards is silent in
     exactly the way a fixed table is: a fixed table does not overflow when it
     runs out of room, it prints each column over its neighbour, and a
     page-level overflow probe reads clean while the grid is unreadable. */
  const css = readFileSync(new URL('assets/pane-analytics-v2.css', OPS), 'utf8');
  const cohortRule = /\.u-cohort\s*\{[^}]*\}/g;
  for (const rule of css.match(cohortRule) || []) {
    assert.doesNotMatch(rule, /table-layout\s*:\s*fixed/,
      'the cohort grid is back to a fixed layout, which overlaps rather than overflowing');
  }

  /* And the scroll box is outside every media query, because eleven columns do
     not fit a half-width desktop card either. Every `@media` block is removed
     first -- splitting on the first one would judge the rules above it and
     call a phone-only declaration global the moment a rule moved. */
  let unconditional = '';
  let rest = css;
  while (rest.includes('@media')) {
    const at = rest.indexOf('@media');
    unconditional += rest.slice(0, at);
    let depth = 0;
    let i = rest.indexOf('{', at);
    for (; i < rest.length; i += 1) {
      if (rest[i] === '{') depth += 1;
      else if (rest[i] === '}') { depth -= 1; if (depth === 0) break; }
    }
    rest = rest.slice(i + 1);
  }
  unconditional += rest;
  assert.match(unconditional, /\.u-scroll\s*\{[^}]*overflow-x\s*:\s*auto/,
    'the scroll box is only declared inside a media query, so it is a phone-only fix');
});

test('a version label with no space in it can still break', async () => {
  /* WHAT THIS PINS, EXACTLY: one declaration, not a rendering. The measured
     proof is in the pull request -- removing `overflow-wrap: anywhere` and
     answering with the labels below takes the page 140px sideways at 320,
     85px at 375 and 28px at 1440, in both themes.

     Why it needs its own line rather than riding on `white-space: normal`:
     the label is `${app} ${app_version}` and `app_version` is a 32 character
     free-text column, so `Mobile 1.4.2+0a1b2c3d4e5f6a7b8c9d0e1f` holds exactly
     one break opportunity -- the space after the app name -- and the version
     token alone still sets the column's minimum width. `anywhere` is the only
     value that both breaks inside a word AND lowers min-content size, which is
     what a table column measures itself by; `break-word` wraps the painted
     text and leaves the table's intrinsic width where it was, so the page
     still goes sideways. A test that accepted either would pass over the
     defect. */
  const css = readFileSync(new URL('assets/pane-analytics-v2.css', OPS), 'utf8');
  const rule = (css.match(/\.u-vers\s+th\[scope="row"\]\s*\{[^}]*\}/) || [''])[0];
  assert.ok(rule, 'the version row heading has no rule of its own at all');
  assert.match(rule, /overflow-wrap\s*:\s*anywhere/,
    'an unbroken 32 character version token has nowhere to break: ' + rule);

  /* And the label really is one token, so the rule above is not guarding a
     case the route cannot send. `app_version` is `varchar(32)`. */
  const dom = await boot({
    usage: usageFixture((u) => {
      u.coverage.versions = [{
        label: 'Mobile 1.4.2+0a1b2c3d4e5f6a7b8c9d0e1f',
        coverageBasisPoints: 10000,
        sessionShareBasisPoints: 10000,
        note: 'Share is of Mobile sessions.',
      }];
    }),
  });
  const heading = findAll(card(dom, /Which versions report/),
    (n) => isTag(n, 'th') && n.getAttribute('scope') === 'row')[0];
  const printed = allText(heading).trim();
  assert.equal(printed, 'Mobile 1.4.2+0a1b2c3d4e5f6a7b8c9d0e1f',
    'the label was not printed whole: ' + printed);
  const longest = printed.split(' ').reduce((a, b) => (b.length > a.length ? b : a), '');
  assert.ok(longest.length >= 28,
    'the fixture no longer carries an unbroken token, so this proves nothing');
});

/* ====================== what the figures are of ======================= */

test('a group is defined by the answer, not by the pane', async () => {
  const dom = await boot({});
  const cohort = card(dom, /Who comes back/);
  const text = allText(cohort);

  /* The route's own sentence, which is the only place on the page that says
     what `size` counts and that the population is consenting accounts only.
     Both are load-bearing: `size` is the accounts created that week which also
     OPENED the app that week, so reading the column as sign-ups overstates it
     by the activation rate, and a retention share whose denominator quietly
     drops non-consenting people is a different figure from the one the heading
     promises. Neither is inferable from a grid of percentages. */
  assert.match(text, /accounts created in that UTC week which also opened Mobile/,
    'the card did not say what a group is: ' + text);
  assert.match(text, /usage analytics on are in no group/,
    'the card dropped the consent statement: ' + text);

  /* And it is the answer's sentence, not a copy: move the note and the card
     moves with it. */
  const moved = await boot({
    usage: usageFixture((u) => { u.cohorts[0].note = 'A group is whatever the route says.'; }),
  });
  assert.match(allText(card(moved, /Who comes back/)), /whatever the route says/,
    'the card printed a definition of its own instead of the answer\'s');
});

test('the versions table says whose sessions the share is of', async () => {
  /* `sessionShareBasisPoints` is computed inside one app, so with two apps in
     the table the Sessions column holds two denominators and its rows sum to
     200%. Unsaid, the column reads as one share of one thing. */
  const dom = await boot({});
  const versions = card(dom, /Which versions report/);
  assert.match(allText(versions), /Share is of each app's own sessions/,
    'a column with two denominators did not say so: ' + allText(versions));

  /* One app selected is one denominator, and then the route's own sentence is
     printed verbatim rather than being generalised away. */
  const one = await boot({
    usage: usageFixture((u) => {
      u.coverage.versions = u.coverage.versions.filter((v) => /^Mobile/.test(v.label));
    }),
  });
  const oneText = allText(card(one, /Which versions report/));
  assert.match(oneText, /Share is of Mobile sessions\./,
    'a single-app table did not carry the route\'s own note: ' + oneText);
  assert.doesNotMatch(oneText, /each app's own/,
    'a single-app table hedged a denominator it knows exactly: ' + oneText);

  /* And the case the docblock used to mis-describe: past the twelfth version
     of one app the route appends a summed remainder row whose note adds a
     second sentence, so one app can send two notes. Both name the same
     denominator, and printing either one alone drops what the other says. */
  const remainder = await boot({
    usage: usageFixture((u) => {
      u.coverage.versions = [
        {
          label: 'Mobile 2.9.1', coverageBasisPoints: 10000,
          sessionShareBasisPoints: 6000, note: 'Share is of Mobile sessions.',
        },
        {
          label: 'Mobile, 4 other versions', coverageBasisPoints: 0,
          sessionShareBasisPoints: 4000,
          note: 'Share is of Mobile sessions. Versions past the 12 largest, summed.',
        },
      ];
    }),
  });
  const remainderText = allText(card(remainder, /Which versions report/));
  assert.match(remainderText, /Share is of each app's own sessions/,
    'two notes from one app were collapsed onto one of them: ' + remainderText);
  assert.doesNotMatch(remainderText, /Versions past the 12 largest/,
    'the card head printed a row-level sentence as the column-level one');
});

test('the coverage figure is printed once', async () => {
  /* 69.3% report, 30.7% do not, and coverage is 92.0% are the same reading of
     the same thing. The split card prints it as a pill; the two card footers
     that restated it are gone, and what survives of the feature footer is the
     method with no number in it. */
  const dom = await boot({});
  const live = livePanel(dom);
  const feet = findAll(live, (n) => (n.className || '').includes('card-foot'));
  const footText = feet.map(allText).join(' | ');

  assert.doesNotMatch(footText, /\d/,
    'a card footer carries a figure that is already drawn elsewhere: ' + footText);
  assert.doesNotMatch(allText(live), /does not\s+report feature use/,
    'the shortfall sentence is back, restating the coverage pill as its complement');
  assert.match(footText, /Only seen on app versions that report feature use/,
    'the method behind the feature figures is not stated anywhere: ' + footText);

  /* The method line is conditional on the answer carrying one, not written
     unconditionally: an answer whose versions all report has no caveat to
     make. */
  const clean = await boot({
    usage: usageFixture((u) => { delete u.features.coverageNote; }),
  });
  assert.doesNotMatch(allText(livePanel(clean)), /Only seen on app versions/,
    'the pane made a coverage caveat the answer did not');
});

test('what the feature shares are a share of comes from the answer', async () => {
  /* `features.hint` is the route's own denominator sentence, and it is the
     only thing on the card that says the shares are per app rather than of
     everybody. Nothing asserted it reached the page, so dropping it rendered a
     table of percentages with no denominator and every test stayed green. */
  const dom = await boot({});
  const text = allText(card(dom, /Most used features/));
  assert.match(text, /Share of each app's own active people/,
    'the feature card did not say what its shares are of: ' + text);

  /* From the answer, not written here: a different hint moves the page. */
  const moved = await boot({
    usage: usageFixture((u) => { u.features.hint = 'Share of everyone who opened anything'; }),
  });
  const movedText = allText(card(moved, /Most used features/));
  assert.match(movedText, /Share of everyone who opened anything/,
    'the card kept its own sentence over the one the answer sent: ' + movedText);
  assert.doesNotMatch(movedText, /Share of each app's own active people/,
    'the pane printed a denominator the answer did not send');

  /* And it is conditional: an answer with no hint gets no invented one. */
  const bare = await boot({
    usage: usageFixture((u) => { delete u.features.hint; }),
  });
  assert.doesNotMatch(allText(card(bare, /Most used features/)), /Share of each app's own/,
    'the pane made a denominator claim the answer did not');
});

test('the floor comes from the answer, and 50 is only the fallback', async () => {
  /* The route sends `reportingFloor` on every answer. A constant here is a
     second copy of a number that lives there, and it disagrees the day the
     route moves it -- quietly, by withholding a figure the route considers
     publishable or publishing one it does not. */
  const raised = await boot({
    usage: usageFixture((u) => { u.reportingFloor = 250; }),
  });
  const raisedRow = findAll(card(raised, /Who comes back/), (n) => isTag(n, 'tr'))
    .filter((r) => /^24 Aug/m.test(allText(r)))[0];
  assert.match(allText(raisedRow), /floor is 250/,
    'the pane applied its own floor over the one the answer sent: ' + allText(raisedRow));
  assert.doesNotMatch(allText(raisedRow), /71\.0%/,
    'a group of 214 was published under a floor of 250');

  /* The other direction: a lower floor publishes what 50 withheld. */
  const lowered = await boot({
    usage: usageFixture((u) => { u.reportingFloor = 10; }),
  });
  const small = findAll(card(lowered, /Who comes back/), (n) => isTag(n, 'tr'))
    .filter((r) => /^31 Aug/m.test(allText(r)))[0];
  assert.match(allText(small), /80\.7%/,
    'a group of 31 stayed withheld under a floor of 10: ' + allText(small));

  /* And an answer with no floor in it still has one. */
  const missing = await boot({
    usage: usageFixture((u) => { delete u.reportingFloor; }),
  });
  const fallback = findAll(card(missing, /Who comes back/), (n) => isTag(n, 'tr'))
    .filter((r) => /^31 Aug/m.test(allText(r)))[0];
  assert.match(allText(fallback), /floor is 50/,
    'an answer with no floor left the pane without one: ' + allText(fallback));
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
