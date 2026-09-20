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

/* ------------------------------------------------------------ stylesheet */

/* Every rule in a stylesheet, found by what its selector list targets rather
   than by how the selector happens to be spelled.

   This exists because the guards below used to match `/\.u-cohort\s*\{/` over
   the raw file, which requires the class to be the WHOLE selector and the last
   thing before the brace. `.u-cohort, .u-feat { ... }` is invisible to that,
   and a `String.match` that finds nothing yields `null`, so the loop under it
   swept zero rules and the file passed while the defect it names was live in
   the page. Anchoring a guard on one syntactic shape is the failure; matching
   on the selector LIST is the narrowing.

   `media` is the `@media` prelude a rule was found under, or `null` at the top
   level, so a guard can tell a global declaration from a phone-only one
   without splitting the file on the first `@media` and judging only what is
   above it. Nesting deeper than one level would come back as the inner
   prelude, which no rule in this stylesheet uses. */
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
      if (/^@(media|supports)\b/.test(prelude)) out.push(...cssRules(body, prelude));
    } else if (prelude) {
      const selectors = prelude.split(',').map((s) => s.trim()).filter(Boolean);
      out.push({
        selectors, body, media,
        /* True when ANY member of the list matches, which is the point: a rule
           applies to everything its list names, so one member carrying the
           class is enough for the declarations to reach it. */
        targets: (re) => selectors.some((s) => re.test(s)),
      });
    }
    i = end + 1;
  }
  return out;
}

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
    /* Route-faithful for THIS window, re-derived from `buildCohorts`
       (`opsUsageView.ts:897-943`) rather than drawn to suit the grid. Over
       `2026-08-21` to `2026-09-20` exclusive, a signup Monday is admissible
       iff `weekStart >= start && weekStart + 7d <= endExclusive`, so 24 Aug,
       31 Aug and 7 Sep qualify and 14 Sep does not; `aged` is
       `floor((endExclusive - weekStart) / 7d) - 1`, so they have 2, 1 and 0
       whole later weeks inside the window; `widest` is 2, which is the length
       of `offsets`; and a group is dropped only when its own size is zero,
       which is why 7 Sep is present with every cell `not_aged`.

       Round 8 raised this as an advisory: the earlier shape sent four offsets
       and two rows, which no 30 day window can produce. Nothing was hiding
       behind it, but a fixture the route cannot send is the thing rounds 4
       and 5 both blocked on, so it is the route's shape now. `wideFixture`
       below carries the 90 day shape, 11 offsets and 12 groups. */
    cohorts: [
      {
        app: 'mobile', label: 'Mobile', offsets: ['W1', 'W2'],
        rows: [
          {
            label: '24 Aug', size: 214,
            cells: [
              { basisPoints: 7103, returned: 152 }, { basisPoints: 5234, returned: 112 },
            ],
          },
          {
            label: '31 Aug', size: 31,
            cells: [
              { basisPoints: 8065, returned: 25 }, { state: 'not_aged' },
            ],
          },
          {
            label: '7 Sep', size: 58,
            cells: [
              { state: 'not_aged' }, { state: 'not_aged' },
            ],
          },
        ],
        note: cohortNote('Mobile'),
      },
      {
        app: 'coaches', label: 'Coaches Web', offsets: ['W1', 'W2'],
        rows: [
          {
            label: '24 Aug', size: 96,
            cells: [
              { basisPoints: 6667, returned: 64 }, { basisPoints: 5313, returned: 51 },
            ],
          },
          {
            label: '31 Aug', size: 72,
            cells: [
              { basisPoints: 5694, returned: 41 }, { state: 'not_aged' },
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

/* A 90 day answer the pipeline has only reached the last 20 days of, with two
   of those 20 days carrying no stored figures.

   Built day by day rather than by hand because the three numbers it exists to
   separate have to agree with each other the way the route makes them agree.
   Days run `2026-06-22` (index 0) to `2026-09-19` (index 89); `reportingStart`
   is index 70, so `daysCovered` is `90 - 70 = 20` exactly as
   `opsUsageView.ts:586` computes it; `daysMissingRollups` are two days at or
   after that index, so the series carries `20 - 2 = 18` readings and every day
   before index 70 is `null` because no rollup row exists for it. Change one of
   the three and the others move with it. */
function partial90() {
  const FIRST = Date.UTC(2026, 5, 22);
  const day = (i) => new Date(FIRST + i * 86400000).toISOString().slice(0, 10);
  const COVERED_FROM = 70;
  const GAPS = [day(75), day(76)];
  const series = (scale) => Array.from({ length: 90 }, (_, i) => {
    if (i < COVERED_FROM || GAPS.indexOf(day(i)) !== -1) return null;
    return Math.round(MOBILE_TREND[i % MOBILE_TREND.length] * scale);
  });
  return usageFixture((u) => {
    u.window.range = '90d';
    u.window.start = new Date(FIRST).toISOString();
    u.window.days = 90;
    u.window.reportingStart = day(COVERED_FROM);
    u.window.daysCovered = 90 - COVERED_FROM;
    u.window.daysMissingRollups = GAPS.slice();
    u.apps[0].trend.values = series(1);
    u.apps[1].trend.values = series(0.29);
  });
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

/* Every text run under a node, once each. In the browser an element's text is
   a child text node; in this harness `h()`'s `textContent` write lands on the
   element itself, so a run is "an element that carries text of its own" either
   way. What this is NOT is a count of matches in `allText`: that helper
   returns `textContent + ' ' + each child's allText`, so a string under an
   ancestor that also carries text is counted twice, and a phrase can be
   fabricated across two adjacent nodes that never say it on their own.
   Round 8's finding was a missing count, so the instrument has to be one. */
function runs(node) {
  const out = [];
  (function walk(n) {
    for (const child of (n && n.childNodes) || []) {
      const own = String(child.textContent || '').replace(/\s+/g, ' ').trim();
      if (own) out.push(own);
      if (child.tagName) walk(child);
    }
  })(node);
  return out;
}

const runCount = (node, re) => runs(node).filter((run) => re.test(run)).length;

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
  assert.doesNotMatch(allText(small), /80\.7%/,
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
     says 90 days. Without this the two answers draw the same screen.

     Built at 90 days with two gap days INSIDE the covered span, because that is
     the shape the two quantities come apart in. `daysCovered` is the distance
     from `reportingStart` to the end of the window (`opsUsageView.ts:332`); the
     days that carry figures are that distance minus `daysMissingRollups`. The
     answer below has 20 and 18, and this test pins all three slots that print
     one of them, so calling the span *stored* - which is what the days with a
     reading are - makes the page contradict itself by the gap count and makes
     this test red. */
  const partial = await boot({ usage: partial90() });
  const text = liveText(partial);
  assert.match(text, /20 of 90 days covered/,
    'a window covered for 20 of its 90 days did not say so: ' + text);
  assert.match(text, /from 31 Aug 2026/,
    'the covered span did not say where it starts: ' + text);

  /* The span is not the count of days with figures, and the pill must not
     print it as though it were. Both words appear on this page, on different
     numbers: the chart's name says `with a reading` of 18, the trend foot
     names the two gap days, and `stored` belongs to those, not to the span. */
  assert.doesNotMatch(text, /20 of 90 days stored/,
    'the covered span was labelled as the days that carry stored figures: ' + text);
  assert.doesNotMatch(text, /18 of 90 days covered/,
    'the covered span printed the days with a reading instead: ' + text);

  const name = chart(partial).getAttribute('aria-label');
  assert.match(name, /Mobile: 18 of 90 days with a reading/,
    'the chart did not name the days that carry a reading: ' + name);
  assert.match(text, /No stored figures on 5 Sep 2026, 6 Sep 2026/,
    'the two gap days inside the covered span were not named: ' + text);

  /* The other direction, which is the one a hard-coded sentence passes on its
     own: a fully covered window must not carry the annotation. */
  const whole = await boot({
    usage: usageFixture((u) => {
      u.window.range = '90d';
      u.window.days = 90;
      u.window.daysCovered = 90;
    }),
  });
  assert.doesNotMatch(liveText(whole), /of 90 days covered/,
    'a fully covered window was annotated as short');

  /* And the figures still draw. Partial coverage is not the empty state. */
  assert.match(text, /8,430/, 'a partly covered window stopped drawing its figures');
});

test('a window with nothing stored says that once, not twice', async () => {
  /* `daysCovered: 0` with `reportingStart: null` arrives as `ready`, and every
     figure counted from stored days already reads NOT REPORTED with the reason
     attached. A pill reading `0 of 90 days covered` beside them would be the
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
  assert.doesNotMatch(text, /0 of 90 days covered/,
    'the empty covered span was drawn as a short one');
  assert.match(text, /no day in this window has stored figures/,
    'a window with nothing stored did not say so: ' + text);
});

/* ============================= not-aged cells ========================== */

test('a week a group has not reached is not a zero', async () => {
  const dom = await boot({});
  const cohort = card(dom, /Who comes back/);
  const pick = (label) => findAll(cohort, (n) => isTag(n, 'tr'))
    .filter((r) => new RegExp('^' + label).test(allText(r).trim()))[0];

  /* Three groups, three different amounts of aging, which is what the route
     sends for this window: 24 Aug has reached both weeks, 31 Aug has reached
     one, 7 Sep has reached neither.

     The mixed row is read off the Coaches Web card, because Mobile's 31 Aug
     group is 31 people against a floor of 50 and is withheld as a whole row
     -- that is a different rule and its own test. Coaches Web's 31 Aug group
     is 72, so its one reached week is drawn and its one unreached week is
     named, side by side. */
  const web = findAll(livePanel(dom),
    (n) => (n.className || '').split(' ').indexOf('card') !== -1)
    .filter((n) => /Who comes back/.test(allText(n)) && /Coaches Web/.test(allText(n)))[0];
  assert.ok(web, 'the second app lost its retention card');
  const partly = findAll(findAll(web, (n) => isTag(n, 'tr'))
    .filter((r) => /^31 Aug/.test(allText(r).trim()))[0], (n) => isTag(n, 'td'));
  /* Row shape, stated rather than assumed: the label is the row heading, the
     first cell is the group's size, and one cell per offset follows. The
     header row above asserts the same shape in words. */
  assert.equal(partly.length, 3,
    'the row is not size plus one cell per offset: ' + partly.map(allText).join(' | '));
  assert.match(allText(partly[1]), /%/,
    'a week the group HAS reached printed no figure: ' + allText(partly[1]));
  assert.match(allText(partly[2]), /Not aged into this week yet/,
    'a week the group has not reached was not named: ' + allText(partly[2]));
  assert.equal(numerals(allText(partly[2])), 0,
    'a week nobody has reached printed a figure');

  /* And a group that has reached none of them is still a row, because the
     route sends it: `buildCohorts` drops a group for a size of zero, never
     for having aged into nothing. */
  const fresh = findAll(pick('7 Sep'), (n) => isTag(n, 'td')).slice(1);
  assert.equal(fresh.length, 2, 'the newest group lost its offset cells');
  assert.equal(fresh.filter((c) => /Not aged into this week yet/.test(allText(c))).length, 2,
    'a group that has reached no later week lost a cell to something else: '
    + fresh.map(allText).join(' | '));
  assert.equal(numerals(fresh.map(allText).join(' ')), 0,
    'a group that has reached no later week printed a figure anyway');

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

  assert.deepEqual(heads, ['Week joined', 'People', 'Week 1', 'Week 2'],
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

/* The 90 day answer, re-derived from `buildCohorts` rather than drawn: over
   `2026-06-22` to `2026-09-20` exclusive, twelve signup Mondays are admissible
   -- 22 Jun through 7 Sep, because 14 Sep would end a day past the window --
   and the earliest has `floor(90d / 7d) - 1 = 11` whole later weeks inside it,
   so `offsets` runs `W1` to `W11` and the grid is twelve rows deep. Each
   group's own `aged` falls by one down the list, which is why the staircase of
   `not_aged` cells is a diagonal and the last row is entirely unreached.

   90d is one of the four ranges the bar offers, and the one the insufficient
   state's own button navigates to, so this is a shape an operator reaches in
   two clicks. It is also the shape four review rounds ran over while the
   fixture said four offsets: a grid that is legible at four and unreadable at
   eleven looks identical in a test that never sends eleven.

   Round 8 raised the group count as an advisory -- eleven offsets with four
   groups is not a shape the route can produce, because `widest` is taken from
   the same list the rows come from. Twelve now. */
function wideFixture(over) {
  const WEEKS = [
    '22 Jun', '29 Jun', '6 Jul', '13 Jul', '20 Jul', '27 Jul',
    '3 Aug', '10 Aug', '17 Aug', '24 Aug', '31 Aug', '7 Sep',
  ];
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
        rows: WEEKS.map((label, row) => ({
          label,
          /* Above the 50 floor on every row: this fixture is about the width
             of the grid, and a withheld row draws one wide cell instead of
             eleven narrow ones. */
          size: 180 + row * 7 + index,
          cells: offsets.map((_, i) => (
            /* `aged` is 11 for the first group and falls by one per week, and
               a cell is drawn only at an offset the group has aged into. */
            i + 1 > 11 - row
              ? { state: 'not_aged' }
              : { basisPoints: 7200 - i * 430, returned: 100 - i }
          )),
        })),
      };
    });
    if (over) over(u);
  });
}

test('the widest window draws every week it sends', async () => {
  const payload = wideFixture();
  const dom = await boot({ usage: payload });
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
  /* Twelve is the count `buildCohorts` produces for this window, derived in
     `wideFixture`'s docblock from the route's own admissibility rule. It is
     stated here as well as read off the answer so that a fixture edit cannot
     quietly move both sides together. */
  assert.equal(payload.cohorts[0].rows.length, 12,
    'the 90 day fixture stopped sending the twelve groups the route sends');
  assert.equal(bodyRows.length, payload.cohorts[0].rows.length,
    'not every group the answer sent was drawn');
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
     with a control that puts `table-layout: fixed` back at
     `pane-analytics-v2.css:179`. That control reproduces 67 / 20 / 69 / 64
     overlapping cell pairs at 320 / 768 / 1024 / 1440 on an eleven-week answer,
     with 0px of page overflow at every one of them.

     It is still worth its line, because the failure it guards is silent in
     exactly the way a fixed table is: a fixed table does not overflow when it
     runs out of room, it prints each column over its neighbour, and a
     page-level overflow probe reads clean while the grid is unreadable.

     Read through `cssRules`, which finds a rule by what its selector list
     TARGETS rather than by how the selector is spelled. The earlier shape of
     this guard matched `/\.u-cohort\s*\{/`, so `.u-cohort, .u-feat { ... }` --
     one refactor, and the most ordinary way anyone would consolidate the two
     table rules that live 50 lines apart in this file -- swept zero rules and
     passed. */
  const css = readFileSync(new URL('assets/pane-analytics-v2.css', OPS), 'utf8');
  const cohortRules = cssRules(css).filter((rule) => rule.targets(/\.u-cohort(?![\w-])/));
  /* A sweep that judged nothing is the failure shape this whole guard was
     rewritten for, so it is red rather than silent -- and the site the defect
     lands in is specifically a rule on the TABLE, since `table-layout` applies
     to nothing else. Finding only the descendant rules would leave the loop
     below sweeping cells and reporting clean. */
  assert.ok(cohortRules.some((rule) => rule.selectors.some((s) => /^\.u-cohort$/.test(s))),
    'no rule targets the cohort table itself, so this guard is sweeping only its cells: '
    + cohortRules.map((rule) => rule.selectors.join(', ')).join(' | '));
  for (const rule of cohortRules) {
    assert.doesNotMatch(rule.body, /table-layout\s*:\s*fixed/,
      'the cohort grid is back to a fixed layout, which overlaps rather than overflowing: '
      + rule.selectors.join(', '));
  }

  /* And the scroll box is outside every media query, because eleven columns do
     not fit a half-width desktop card either. `cssRules` carries the `@media`
     prelude a rule was found under, so a phone-only declaration cannot be read
     as a global one by being moved above the first media block. */
  const scroll = cssRules(css)
    .filter((rule) => rule.targets(/\.u-scroll(?![\w-])/) && /overflow-x\s*:\s*auto/.test(rule.body));
  assert.ok(scroll.length, 'nothing declares the scroll box at all');
  assert.ok(scroll.some((rule) => rule.media === null),
    'the scroll box is only declared inside a media query, so it is a phone-only fix: '
    + scroll.map((rule) => rule.media).join(' | '));
});

test('a card in a single-column grid is allowed to shrink under its table', async () => {
  /* WHAT THIS PINS, EXACTLY: one declaration, plus the branch that decides
     which grid track a cohort card lands on. Not a rendering -- the rendering
     proof is in the pull request: removing `.grid > .card { min-width: 0 }`
     alone, on a ONE-cohort answer, measures 194px of page overflow at 320 and
     139px at 375 in both themes, and 0px on all four multi-cohort answers.

     The two halves have to move together, which is why they are one test.
     `g2`, `g3` and `g4` are `minmax(0, …)` tracks (`aria.css:367-372`), so a
     card in one of those already has a zero floor and this declaration is
     inert. Plain `.grid` declares no `grid-template-columns`, so its implicit
     track is `auto` and the card's min-content contribution -- 460px, from
     `.u-cohort`'s `min-width` in the narrow block -- becomes the page's width.
     A change that gave plain `.grid` a `minmax(0, …)` track, or that sent a
     single cohort to `g2`, would make the declaration inert; a change that
     dropped the declaration while the branch still emits plain `grid` puts
     194px back. */
  const css = readFileSync(new URL('assets/pane-analytics-v2.css', OPS), 'utf8');
  const shrink = cssRules(css)
    .filter((rule) => rule.targets(/\.grid\s*>\s*\.card(?![\w-])/)
      && /min-width\s*:\s*0/.test(rule.body));
  assert.ok(shrink.length,
    'nothing lets a grid card shrink under its own table');
  assert.ok(shrink.some((rule) => rule.media === null),
    'the card is only allowed to shrink inside a media query, and the cohort table is '
    + 'wider than a half-width desktop card too: ' + shrink.map((r) => r.media).join(' | '));

  /* And the branch really does send one cohort to a track with no zero floor,
     so the declaration above is guarding a shape the page draws rather than a
     hypothetical one. Asserted on the rendered class, not on the source. */
  const gridHolding = (dom) => findAll(livePanel(dom),
    (n) => /(^|\s)grid(\s|$)/.test(n.className || '')
      && findAll(n, (c) => (c.className || '').includes('u-cohort')).length)[0];

  const one = await boot({
    usage: usageFixture((u) => { u.cohorts = [u.cohorts[0]]; }),
  });
  const holder = gridHolding(one);
  assert.ok(holder, 'the cohort card is not in a grid at all');
  assert.equal((holder.className || '').trim(), 'grid',
    'one cohort no longer lands on the bare grid track this rule protects: ' + holder.className);

  const wide = gridHolding(await boot({}));
  assert.match(wide.className || '', /\bg2\b/,
    'two cohorts stopped sharing a row: ' + wide.className);
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
  /* Both row-heading tables, not only the versions one. A feature row's label
     is `FEATURE_LABELS[row.featureKey] ?? row.featureKey` (opsUsageView.ts:691)
     and the fallback is the raw telemetry key -- an unbroken `snake_case`
     token, reachable whenever a key outlives its member of
     `TelemetryFeatureKey` -- so `.u-feat` needs the same declaration and has no
     scroll box to fall back on. Found through `cssRules` so that a grouped
     selector is read for what it targets. */
  for (const table of ['.u-vers', '.u-feat']) {
    const re = new RegExp('\\' + table + '\\s+th\\[scope="row"\\]');
    const rules = cssRules(css).filter((rule) => rule.targets(re));
    assert.ok(rules.length, 'the row heading in ' + table + ' has no rule of its own at all');
    /* The EFFECTIVE value, read in document order: a second rule setting
       `break-word` later in the file would win in the browser, and a guard
       that stopped at the first declaration would call that fixed. Document
       order is the whole of it only because each of these selectors appears
       once, outside every media query, which is asserted rather than assumed. */
    assert.equal(rules.length, 1,
      table + ' now declares its row heading in ' + rules.length
      + ' places, so document order is no longer the whole story');
    assert.equal(rules[0].media, null,
      table + "'s row heading is declared inside " + rules[0].media);
    const values = rules[0].body.match(/overflow-wrap\s*:\s*([\w-]+)/g) || [];
    assert.ok(values.length,
      'an unbroken 32 character token has nowhere to break in ' + table + ': ' + rules[0].body);
    assert.match(values[values.length - 1], /overflow-wrap\s*:\s*anywhere/,
      table + ' settles on ' + values[values.length - 1]
      + ', which wraps the paint without lowering min-content size');
  }

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

test('the page never counts people without saying which people', async () => {
  /* The consent statement rides on `cohorts[].note`, which is right -- it is
     the route's own sentence, beside the groups it is about -- and it leaves
     the page entirely when no group is drawn. `buildCohorts` skips an app
     whose widest admissible signup week has aged into nothing
     (`opsUsageView.ts:932`): on 7d always, because the only admissible start
     is the window's own and `floor(7d / 7d) - 1` is zero aged weeks, and on
     14d on six weekdays in seven, because its eight-day admissible interval
     holds two signup weeks only when the window ends on one. 13 of the 28
     range-and-weekday combinations print headcounts, session totals and
     per-feature shares of people with nothing on screen saying they are
     consenting accounts only.

     The gate is `cohorts.length` and never the range, which is why the three
     directions below are driven by the groups rather than by `window.range`. */
  const week = await boot({
    usage: usageFixture((u) => {
      u.window.range = '7d';
      u.window.days = 7;
      u.window.start = '2026-09-13T00:00:00.000Z';
      u.window.reportingStart = '2026-09-13';
      u.window.daysCovered = 7;
      u.cohorts = [];
    }),
  });
  const weekText = liveText(week);
  assert.doesNotMatch(weekText, /usage analytics on are in no group/,
    'the fixture still has a cohort, so this proves nothing: ' + weekText);
  assert.match(weekText, /1,061/, 'the page stopped counting people, so there is nothing to say');
  assert.match(weekText, /Consenting accounts only/,
    'a range with no groups counted people and never said which people: ' + weekText);

  /* A fourth direction, added at round 8: the gate is the groups, so a 14 day
     answer with no groups -- which is what the route sends on six weekdays in
     seven -- gets the pill too. A pill written against `range === '7d'` passes
     the three directions above and fails this one. */
  const fortnight = await boot({
    usage: usageFixture((u) => {
      u.window.range = '14d';
      u.window.days = 14;
      u.window.start = '2026-09-06T00:00:00.000Z';
      u.window.reportingStart = '2026-09-06';
      u.window.daysCovered = 14;
      u.cohorts = [];
    }),
  });
  assert.match(liveText(fortnight), /Consenting accounts only/,
    'a 14 day answer with no groups counted people and never said which people');

  /* Read from the answer, not written here: an answer that does not report the
     gate at ingest does not get the pane asserting it. */
  const unreported = await boot({
    usage: usageFixture((u) => {
      u.cohorts = [];
      u.consent = { enforcedAt: 'unknown', detail: '' };
    }),
  });
  assert.doesNotMatch(liveText(unreported), /Consenting accounts only/,
    'the pane claimed a gate the answer did not report');

  /* And the other direction, which is the one a hard-coded pill passes on its
     own: where the groups ARE drawn, the route's fuller sentence is on the
     page and the pill would be that fact twice. */
  const whole = liveText(await boot({}));
  assert.match(whole, /usage analytics on are in no group/,
    'the ordinary answer lost the route sentence');
  assert.doesNotMatch(whole, /Consenting accounts only/,
    'the consent statement was printed twice on one screen');
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

test('the coverage figure is printed once, on every answer that carries one', async () => {
  /* 69.3% report, 30.7% do not, and coverage is 92.0% are the same reading of
     the same thing, so the pane prints it in exactly one slot and drops the
     route's two sentences that restate it.

     Round 8's finding was that "exactly one" was tested in one direction only:
     every assertion here was satisfied by ZERO printings, so deleting the pill
     left the suite green. Both directions now, and on both shapes of answer
     the bar can ask for -- `scope=all` sends two apps, `scope=mobile` and
     `scope=coaches` send one, which is two of the three values it offers, and
     on those the split card has no column to hang a pill on.

     Counted as text RUNS, not as matches in `allText`: that helper repeats a
     node's text once per ancestor, so a count taken from it measures nesting
     depth. */
  const both = await boot({});
  const bothLive = livePanel(both);

  assert.equal(runCount(bothLive, /^92\.0% of sessions report$/), 1,
    'Mobile\'s coverage figure is printed ' + runCount(bothLive, /^92\.0% of sessions report$/)
    + ' times on a two app answer, not once: ' + runs(bothLive).join(' | '));
  assert.equal(runCount(bothLive, /^Every session reports$/), 1,
    "Coaches Web's coverage is not printed exactly once: " + runs(bothLive).join(' | '));

  /* One app: the answer the figure used to vanish from entirely. The tiles are
     platform figures and carry no coverage, and `appColumn` never runs. */
  const one = await boot({
    search: '?scope=mobile',
    usage: usageFixture((u) => {
      u.apps = u.apps.slice(0, 1);
      u.filters.app = 'mobile';
    }),
  });
  const oneLive = livePanel(one);
  assert.equal(runCount(oneLive, /^92\.0% of sessions report$/), 1,
    'a one app answer printed the coverage figure '
    + runCount(oneLive, /^92\.0% of sessions report$/)
    + ' times, while the version and feature cards drop the route\'s two sentences about '
    + 'it on the ground that it is already on screen: ' + runs(oneLive).join(' | '));

  /* Null is a reading too, and it is the reading that says there is no
     shortfall rather than a shortfall of everything. */
  const none = await boot({
    search: '?scope=mobile',
    usage: usageFixture((u) => {
      u.apps = u.apps.slice(0, 1);
      u.apps[0].coverageBasisPoints = null;
    }),
  });
  const noneLive = livePanel(none);
  assert.equal(runCount(noneLive, /^Coverage not reported$/), 1,
    'an unmeasured coverage on a one app answer said nothing at all: '
    + runs(noneLive).join(' | '));
  assert.equal(runCount(noneLive, /of sessions report$/), 0,
    'an unmeasured coverage was drawn as a figure anyway');

  /* And the other half of "once": the two sentences the route sends carrying
     the same figure stay dropped, on both shapes of answer. */
  [['two apps', bothLive], ['one app', oneLive]].forEach(function (pair) {
    const shape = pair[0];
    const live = pair[1];
    const feet = findAll(live, (n) => (n.className || '').includes('card-foot'));
    const footText = feet.map(allText).join(' | ');
    assert.doesNotMatch(footText, /\d/,
      'a card footer carries a figure that is already drawn elsewhere, on ' + shape
      + ': ' + footText);
    assert.doesNotMatch(allText(live), /does not\s+report feature use/,
      'the shortfall sentence is back on ' + shape + ', restating the pill as its complement');
    assert.match(footText, /Only seen on app versions that report feature use/,
      'the method behind the feature figures is not stated anywhere on ' + shape
      + ': ' + footText);
  });

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
