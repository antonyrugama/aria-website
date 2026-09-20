/* Unit tests for ops/assets/pane-spend.js — Cloud costs on the v2 design
   system.

   What is worth testing here is the three rules in that file's docblock, all
   three of which are rules a screenshot cannot see:

     - a grouping's rows are added up on screen and compared with the billed
       total, in both directions: a grouping that reconciles says so, and one
       that does not says by how much;
     - a figure the answer does not carry is words rather than a zero, on a
       pane where a zero is a claim about money;
     - the age of the answer is on screen beside the figures, and says so in
       words once the publishing cycle has been missed twice over.

   Plus the ones that are easy to re-break by accident: the `ungrouped`
   category is drawn as its own named line rather than folded away; the chart
   is named with its own data, because role="img" is children-presentational
   and the SVG inside one is announced to nobody; a day past the end of a
   stretch breaks the pen rather than dropping to a floor; the read carries
   the range; and the four availability states the route can send are four
   different sentences rather than one.

   Every test here has a published mutation in the pull request: the exact
   file and the exact original line whose removal or inversion makes that test
   fail. A test with no such line is a test that pins nothing.

   ----------------------------------------------------------------------

   The fixtures are BUILT, not written.

   `payload()` below is a port of the route's own assembly --
   `app-backend/server/ops/opsPanesRouter.ts` lines 437-621, plus
   `buildCostView`, `buildDailySeries`, `resolveCostPeriod` and
   `resolveComparisonWindow` -- driven by the same input the route is driven
   by: a list of billed group rows per usage day. Every derived member
   (`shareBasisPoints`, `changeBasisPoints`, `color`, the row order, the
   comparison bounds, `billedDays`, the label stride, the note, whether there
   is a forecast at all) is computed here the way the route computes it.

   This is deliberate and it is the lesson of the sibling pane's review: four
   blocking findings there were hand-written fixtures in shapes the route
   cannot produce, each of which let a real defect pass. A fixture that is a
   projection of the route's code cannot drift from it by hand-editing, and
   `route contract` below re-checks the port's own arithmetic against values
   worked out independently of it.

   `payload` and the group tables are exported for the same reason: the
   screenshots and the narrow-width measurements in the pull request are
   rendered from THIS builder rather than from a second set of hand-written
   JSON, so the pictures and the assertions are looking at the same answer. */
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
const PANE_SRC = read('assets/pane-spend.js');
const PANE_CSS = read('assets/pane-spend-v2.css');
const PAGE_HTML = read('spend.html');

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

const HOUR = 3600 * 1000;
export const hoursAgo = (n) => new Date(Date.now() - n * HOUR).toISOString();

/* ------------------------------------------------ the route's arithmetic

   Ported verbatim from app-backend/server/services/opsPanes/opsCostPeriod.ts
   so the fixtures below are a projection of the route rather than a drawing
   of one. */

const DAY_MS = 86400000;
const isoDay = (date) => date.toISOString().slice(0, 10);
const dayStart = (usageDate) => new Date(usageDate + 'T00:00:00.000Z');
const addDays = (usageDate, days) =>
  isoDay(new Date(dayStart(usageDate).getTime() + days * DAY_MS));
const dayCount = (start, endExclusive) =>
  Math.round((dayStart(endExclusive).getTime() - dayStart(start).getTime()) / DAY_MS);

const OPS_COST_PUBLISH_LAG_HOURS = 8;
const SERIES_TOKENS = ['s1', 's2', 's3', 's4', 's5', 's6'];
const MAX_DAILY_LABELS = 6;

const CATEGORY_LABELS = {
  ci_and_build: 'CI and build',
  ai_and_models: 'AI and models',
  data: 'Data',
  application_compute: 'Application compute',
  platform_and_observability: 'Platform and observability',
  ungrouped: 'Ungrouped',
};

const categoryLabel = (category) =>
  Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, category)
    ? CATEGORY_LABELS[category]
    : category;

function shareBasisPoints(micros, total) {
  if (total <= 0) return 0;
  return Math.round((micros / total) * 10000);
}

function changeBasisPoints(current, previous) {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 10000);
}

function resolveCostPeriod(range, now) {
  const today = isoDay(now);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  if (range === 'month' || range === 'last-month') {
    const thisMonthStart = isoDay(new Date(Date.UTC(year, month, 1)));
    const nextMonthStart = isoDay(new Date(Date.UTC(year, month + 1, 1)));
    const lastMonthStart = isoDay(new Date(Date.UTC(year, month - 1, 1)));
    const beforeLastStart = isoDay(new Date(Date.UTC(year, month - 2, 1)));
    if (range === 'month') {
      return {
        start: thisMonthStart,
        endExclusive: addDays(today, 1),
        daysInPeriod: dayCount(thisMonthStart, nextMonthStart),
        dayOfPeriod: now.getUTCDate(),
        open: true,
        comparisonLabel: 'against the same day last month',
        previousStart: lastMonthStart,
        previousEndExclusive: thisMonthStart,
      };
    }
    return {
      start: lastMonthStart,
      endExclusive: thisMonthStart,
      daysInPeriod: dayCount(lastMonthStart, thisMonthStart),
      dayOfPeriod: dayCount(lastMonthStart, thisMonthStart),
      open: false,
      comparisonLabel: 'against the month before',
      previousStart: beforeLastStart,
      previousEndExclusive: lastMonthStart,
    };
  }

  const length = range === '7d' ? 7 : range === '3m' ? 90 : 365;
  const endExclusive = addDays(today, 1);
  const start = addDays(endExclusive, -length);
  return {
    start,
    endExclusive,
    daysInPeriod: length,
    dayOfPeriod: length,
    open: false,
    comparisonLabel: 'against the previous ' + length + ' days',
    previousStart: addDays(start, -length),
    previousEndExclusive: start,
  };
}

function resolveComparisonWindow(period, billedDays) {
  const previousPeriodDays = dayCount(period.previousStart, period.previousEndExclusive);
  const days = billedDays >= period.daysInPeriod
    ? previousPeriodDays
    : Math.min(billedDays, previousPeriodDays);
  return {
    start: period.previousStart,
    endExclusive: addDays(period.previousStart, days),
    days,
  };
}

function comparisonLabelFor(period, billedDays, comparisonDays) {
  if (comparisonDays === billedDays) return period.comparisonLabel;
  return period.comparisonLabel + ', over ' + comparisonDays +
    ' days against ' + billedDays + ' here';
}

const resourceGroupKey = (group) => group.subscriptionId + '/' + group.resourceGroup;

const DIMENSIONS = [
  {
    key: 'category',
    label: 'By category',
    hint: 'What the money is for.',
    rowKey: (group) => group.category,
    rowLabel: (group) => categoryLabel(group.category),
    ungrouped: (group) => group.category === 'ungrouped',
  },
  {
    key: 'resourceGroup',
    label: 'By resource group',
    hint: 'How the bill is grouped in Azure.',
    rowKey: resourceGroupKey,
    rowLabel: (group, context) => {
      const base = group.resourceGroup === '' ? 'Subscription level' : group.resourceGroup;
      return context.subscriptionLabels.length > 1
        ? base + ' (' + group.subscriptionLabel + ')'
        : base;
    },
    rowDescription: (group) => (group.resourceGroup === ''
      ? 'Billed to the subscription rather than to a resource group.'
      : undefined),
  },
  {
    key: 'service',
    label: 'By service',
    hint: 'Which Azure service was billed.',
    rowKey: (group) => group.serviceName,
    rowLabel: (group) => group.serviceName,
  },
];

function buildCostView(dimension, groups, previousGroups, total, context) {
  const current = new Map();
  for (const group of groups) {
    const key = dimension.rowKey(group);
    const row = current.get(key);
    if (row) row.micros += group.micros;
    else current.set(key, { sample: group, micros: group.micros });
  }
  const previous = new Map();
  for (const group of previousGroups) {
    const key = dimension.rowKey(group);
    previous.set(key, (previous.get(key) ?? 0) + group.micros);
  }

  const rows = [...current.entries()]
    .sort((a, b) => b[1].micros - a[1].micros || a[0].localeCompare(b[0]))
    .map(([key, { sample, micros }], index) => {
      const change = changeBasisPoints(micros, previous.get(key) ?? 0);
      const description = dimension.rowDescription ? dimension.rowDescription(sample) : undefined;
      return {
        key,
        label: dimension.rowLabel(sample, context),
        ...(description ? { description } : {}),
        micros,
        shareBasisPoints: shareBasisPoints(micros, total),
        ...(change === null ? {} : { changeBasisPoints: change }),
        color: SERIES_TOKENS[index % SERIES_TOKENS.length],
        ...(dimension.ungrouped && dimension.ungrouped(sample) ? { ungrouped: true } : {}),
      };
    });

  return { label: dimension.label, hint: dimension.hint, rows };
}

function buildDailySeries(period, billedDays, current, comparison, refusal) {
  const currentByDay = new Map(current.days.map((d) => [d.usageDate, d.micros]));
  const previousByDay = new Map(
    ((comparison && comparison.window.days) || []).map((d) => [d.usageDate, d.micros]),
  );

  const comparisonDays = comparison ? comparison.days : 0;
  const length = Math.max(billedDays, comparisonDays);

  const currentValues = [];
  const previousValues = [];
  const labels = [];
  const labelStride = Math.max(1, Math.ceil(billedDays / MAX_DAILY_LABELS));
  const dayLabel = new Intl.DateTimeFormat('en-US', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  });

  for (let offset = 0; offset < length; offset += 1) {
    if (offset < billedDays) {
      const day = addDays(period.start, offset);
      currentValues.push(currentByDay.get(day) ?? 0);
      if (offset % labelStride === 0) labels.push(dayLabel.format(dayStart(day)));
    } else {
      currentValues.push(null);
    }
    if (comparison) {
      previousValues.push(offset < comparisonDays
        ? previousByDay.get(addDays(comparison.start, offset)) ?? 0
        : null);
    }
  }

  const note = !comparison
    ? (refusal === 'not_collected'
      ? 'Nothing was collected for the period before this one, so there is no comparison line to '
        + 'draw against it.'
      : 'The period before this one was not billed in this currency, so there is no comparison '
        + 'line to draw against it.')
    : (comparisonDays === billedDays
      ? undefined
      : 'The two stretches are not the same length: ' + billedDays + ' '
        + (billedDays === 1 ? 'day' : 'days') + ' billed here against ' + comparisonDays
        + ' in the period before, so one line stops before the other.');

  return {
    label: 'Daily spend for this period against the previous one',
    hint: 'Both lines are billed usage, not forecast.',
    ...(note ? { note } : {}),
    labels,
    series: [
      { key: 'current', label: 'This period', color: 's1', values: currentValues },
      ...(comparison
        ? [{
          key: 'previous', label: 'Previous period', color: 'muted',
          dashed: true, values: previousValues,
        }]
        : []),
    ],
  };
}

/* --------------------------------------------------- the billed rows

   The input the route is driven by: one entry per usage day per billed group.
   `window()` folds them into the shape `repository.loadCostWindow` returns.

   Every group below is the real SHAPE of the seed mapping in
   app-backend/shared/operations-cost.ts -- an Azure service name, one of the
   six category keys, a resource group on one of two subscriptions -- with the
   subscription ids AND the resource group names replaced by coded ones.
   Everything under ops/ is world-readable, so nothing a real deployment is
   actually called goes into a fixture. The Azure service names are Microsoft
   product names, not ours, and they are what makes the rows legible. */

const SUB_A = '00000000-0000-4000-8000-00000000000a';
const SUB_B = '00000000-0000-4000-8000-00000000000b';

export const GROUPS = [
  {
    serviceName: 'Azure OpenAI', category: 'ai_and_models',
    resourceGroup: 'rg-app-prod', subscriptionId: SUB_A, subscriptionLabel: 'Production',
    perDay: 41000000,
  },
  {
    serviceName: 'Virtual Machines', category: 'ci_and_build',
    resourceGroup: 'rg-build-sandbox', subscriptionId: SUB_B, subscriptionLabel: 'CI sandbox',
    perDay: 26500000,
  },
  {
    serviceName: 'Azure Database for PostgreSQL', category: 'data',
    resourceGroup: 'rg-app-prod', subscriptionId: SUB_A, subscriptionLabel: 'Production',
    perDay: 18800000,
  },
  {
    serviceName: 'Azure Container Apps', category: 'application_compute',
    resourceGroup: 'rg-app-prod', subscriptionId: SUB_A, subscriptionLabel: 'Production',
    perDay: 12400000,
  },
  {
    serviceName: 'Azure Monitor', category: 'platform_and_observability',
    resourceGroup: '', subscriptionId: SUB_A, subscriptionLabel: 'Production',
    perDay: 4300000,
  },
];

/* A service the category mapping has never seen. The route bills it under the
   explicit `ungrouped` category and flags the row, which is what keeps the
   grouping adding up to the invoice instead of quietly losing it. */
export const UNGROUPED_GROUP = {
  serviceName: 'Azure Spring Apps', category: 'ungrouped',
  resourceGroup: 'rg-app-prod', subscriptionId: SUB_A, subscriptionLabel: 'Production',
  perDay: 310000,
};

/* Folds a group list and a day count into what loadCostWindow returns: one
   row per day per group, and the per-day totals the daily line is drawn
   from. `scale` lets a stretch bill at a different rate from another without
   a second table, and `dayScale` lets a stretch vary from day to day, which
   a real bill does and a constant rate cannot: against a flat series a chart
   that never plots its values still looks right. */
function window_(groups, startDay, days, scale, dayScale) {
  const base = scale === undefined ? 1 : scale;
  const rows = [];
  const byDay = [];
  for (let offset = 0; offset < days; offset += 1) {
    const usageDate = addDays(startDay, offset);
    const rate = base * (dayScale ? dayScale(offset) : 1);
    let dayTotal = 0;
    for (const group of groups) {
      const micros = Math.round(group.perDay * rate);
      dayTotal += micros;
      rows.push({ ...group, micros, usageDate });
    }
    byDay.push({ usageDate, micros: dayTotal });
  }
  return {
    days: byDay,
    groups: rows,
    currencies: days > 0 ? ['USD'] : [],
    fetchedAt: null,
  };
}

/* The route's own assembly, driven by two windows.

   Mirrors opsPanesRouter.ts:437-621. Anything the route decides -- which
   availability state, whether there is a forecast, whether a comparison was
   made and what its bounds are -- is decided here by the same test, so a
   fixture cannot carry a combination the route cannot send. */
export function payload(options) {
  const opts = options || {};
  const range = opts.range || 'month';
  const now = opts.now || new Date('2026-09-20T09:00:00.000Z');
  const period = resolveCostPeriod(range, now);

  const pollerState = opts.pollerState === undefined
    ? { status: 'ok', lastSuccessAt: opts.asOf || hoursAgo(5) }
    : opts.pollerState;

  const staleness = opts.staleness || { state: 'ok' };
  const asOf = opts.asOf === undefined
    ? (pollerState && pollerState.lastSuccessAt) || null
    : opts.asOf;

  const base = {
    range,
    asOf,
    publishLagHours: OPS_COST_PUBLISH_LAG_HOURS,
    staleness,
    scopeNote:
      'Cloud spend is billed per piece of infrastructure, so it is not split by client app.',
  };

  const billedThrough = opts.billedThrough === undefined
    ? dayCount(period.start, period.endExclusive) - 1
    : opts.billedThrough;
  const groups = opts.groups || GROUPS;
  const current = window_(groups, period.start, billedThrough, opts.scale,
    opts.dayScale);

  if (current.days.length === 0) {
    const availability = !pollerState || pollerState.status === 'unconfigured'
      ? {
        state: 'unconfigured',
        detail: 'No Azure subscription is configured for cost polling, so nothing has been '
          + 'collected for this period.',
      }
      : pollerState.status === 'disabled'
        ? {
          state: 'disabled',
          detail: 'Cost polling is switched off for every subscription in scope.',
        }
        : {
          state: 'not_published',
          detail: 'The billing export has published nothing for this period yet. Azure restates '
            + 'recent days and publishes on roughly a ' + OPS_COST_PUBLISH_LAG_HOURS
            + ' hour cycle.',
        };
    return { ...base, availability };
  }

  if (opts.currencies && opts.currencies.length > 1) {
    return {
      ...base,
      availability: {
        state: 'mixed_currency',
        detail: 'This period was billed in more than one currency ('
          + opts.currencies.join(', ') + '), so there is no single total to show and the '
          + 'groupings cannot be added together.',
      },
    };
  }

  const currency = 'USD';
  const actualThrough = current.days[current.days.length - 1].usageDate;
  const billedDays = dayCount(period.start, actualThrough) + 1;
  const comparisonBounds = resolveComparisonWindow(period, billedDays);
  const previous = opts.previousCollected === false
    ? { days: [], groups: [], currencies: [], fetchedAt: null }
    : window_(
      opts.previousGroups || groups,
      comparisonBounds.start,
      comparisonBounds.days,
      opts.previousScale,
      opts.previousDayScale,
    );

  const refusal = previous.days.length === 0
    ? 'not_collected'
    : (previous.currencies.every((code) => code === currency) ? null : 'other_currency');
  const comparison = refusal === null ? { ...comparisonBounds, window: previous } : null;
  const comparisonGroups = comparison ? previous.groups : [];

  const total = current.groups.reduce((running, g) => running + g.micros, 0);
  const previousTotal = comparisonGroups.reduce((running, g) => running + g.micros, 0);
  const totalChange = changeBasisPoints(total, previousTotal);

  const context = {
    subscriptionLabels: [...new Set(current.groups.map((g) => g.subscriptionLabel))].sort(),
  };
  const views = Object.fromEntries(DIMENSIONS.map((dimension) => [
    dimension.key,
    buildCostView(dimension, current.groups, comparisonGroups, total, context),
  ]));

  const forecast = period.open && billedDays > 0 && total > 0
    ? {
      micros: Math.round((total / billedDays) * period.daysInPeriod),
      basis: 'Projected from the ' + billedDays + ' ' + (billedDays === 1 ? 'day' : 'days')
        + ' billed so far, at the same daily rate.',
    }
    : null;

  return {
    ...base,
    availability: { state: 'ready' },
    currency,
    period: {
      start: period.start,
      endExclusive: period.endExclusive,
      dayOfPeriod: period.dayOfPeriod,
      daysInPeriod: period.daysInPeriod,
      actualThrough,
      billedDays,
    },
    total: {
      micros: total,
      ...(totalChange === null
        ? {}
        : {
          changeBasisPoints: totalChange,
          comparisonLabel: comparisonLabelFor(period, billedDays, comparisonBounds.days),
        }),
    },
    ...(comparison
      ? {
        comparison: {
          start: comparison.start,
          endExclusive: comparison.endExclusive,
          days: comparison.days,
          sameLength: comparison.days === billedDays,
        },
      }
      : {}),
    ...(forecast ? { forecast } : {}),
    views,
    daily: buildDailySeries(period, billedDays, current, comparison, refusal),
  };
}

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
   bootstrap, then the pane module. */
async function boot(options) {
  const opts = options || {};
  const calls = [];
  const answer = opts.costs === undefined ? payload() : opts.costs;
  const search = opts.search || '';

  const dom = makeDom({
    tokens: TOKENS,
    href: 'https://ops.example.invalid/ops/spend.html' + search,
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
      if (endpoint !== '/api/ops/costs') return Promise.reject(new Error('no stub for ' + endpoint));
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
  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-spend.js' });

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

/* Every text run under a node, once each. In the browser an element's text is
   a child text node; in this harness `h()`'s `textContent` write lands on the
   element itself, so a run is "an element that carries text of its own"
   either way. What this is NOT is a count of matches in `allText`: that
   helper returns `textContent + ' ' + each child's allText`, so a string
   under an ancestor that also carries text is counted twice, and a phrase can
   be fabricated across two adjacent nodes that never say it on their own. */
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

const hasClass = (node, cls) =>
  String(node.className || '').split(/\s+/).indexOf(cls) !== -1;

const byClass = (root, cls) => findAll(root, (n) => hasClass(n, cls));

/* A card, by the text of its head. */
function card(dom, heading) {
  return byClass(livePanel(dom), 'card').filter((n) => heading.test(allText(n)))[0];
}

/* The grouping card, found by the switch it carries rather than by its head,
   because its head is whichever grouping is on. Scoping to it matters: the
   per-service table below draws a reconciliation line of its own, so a
   reconciliation assertion made over the whole panel passes on the wrong
   card's sentence. */
const switchCard = (dom) =>
  byClass(livePanel(dom), 'card').filter((n) => byClass(n, 'sp-views').length > 0)[0];

/* A link by its words, as the thing it actually is: an `a` carrying an
   `href`. Reading the words alone only says that a way out is printed; the
   href is the half that says where it goes, and a link that reads correctly
   and travels to the wrong place fails silently. */
const linkNamed = (root, words) =>
  findAll(root, (n) => n.tagName && n.tagName.toUpperCase() === 'A'
    && String(n.textContent || '').trim() === words)[0];

/* Every text run under a node joined once each -- see `runs` for why this is
   not `allText`. A figure printed as a number and again inside a sentence
   appears twice here and once in `runCount`. */
const ownText = (node) => runs(node).join(' | ');
const occurrences = (node, needle) =>
  ownText(node).split(needle).length - 1;

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

/* ------------------------------------------------------------- the read */

test('the read carries the chosen range, because the route defaults an absent one', async () => {
  const dom = await boot({ search: '?range=3m' });
  const call = dom.calls.filter((c) => c.endpoint === '/api/ops/costs')[0];
  assert.ok(call, 'the pane read the cost route');
  assert.equal(call.query.range, '3m',
    'a read with no range would be answered with this month under a bar saying Last 3 months');
});

test('the pane reads once on boot, not twice', async () => {
  const dom = await boot();
  assert.equal(dom.calls.filter((c) => c.endpoint === '/api/ops/costs').length, 1,
    'a call from the pane plus the bootstrap\'s own ops:filters would race two answers');
});

/* ------------------------------------------------- the reconciliation */

/* The pane's central claim, asserted in BOTH directions. One direction alone
   is the failure shape this repo has already shipped: a test that only ever
   sees rows that add up passes just as happily against a pane that prints
   "adding up to the bill" unconditionally. */

test('a grouping whose rows add up to the bill says so, with the bill beside it', async () => {
  const data = payload({ range: 'month', billedThrough: 10 });
  const dom = await boot({ costs: data });

  const summed = data.views.category.rows.reduce((r, row) => r + row.micros, 0);
  assert.equal(summed, data.total.micros, 'the fixture is a reconciling one');

  const grouping = card(dom, /By category/);
  assert.ok(grouping, 'the grouping card is on the page');
  assert.equal(runCount(grouping, /^5 categories adding up to the bill$/), 1,
    'the reconciliation line names what it added up, not just how many');
  /* $103.00 a day over ten days. Printed as the total beside the rows it is
     the sum of, which is the whole point of putting it there. */
  assert.equal(runCount(grouping, /^\$1,030\.00$/), 1,
    'the billed total is beside the rows it is the sum of');
  assert.equal(runCount(grouping, /short of the bill|more than the bill/), 0,
    'a reconciling grouping must not also report a gap');
});

test('a grouping whose rows do not add up to the bill reports the gap as a figure', async () => {
  const data = payload({ range: 'month', billedThrough: 10 });
  /* One row loses a million micros -- exactly one dollar -- which is what a
     dropped tail or a capped list would look like. The total is untouched. */
  data.views.category.rows[4].micros -= 1000000;

  const dom = await boot({ costs: data });
  const grouping = card(dom, /By category/);

  assert.equal(
    runCount(grouping, /^5 categories adding up to \$1,029\.00, \$1\.00 short of the bill$/), 1,
    'the gap is stated as a figure, in the direction it goes');
  assert.equal(runCount(grouping, /^5 categories adding up to the bill$/), 0,
    'the category card must not also claim it reconciles');
});

test('a grouping that overshoots the bill says "more than", not "short of"', async () => {
  const data = payload({ range: 'month', billedThrough: 10 });
  data.views.category.rows[4].micros += 2500000;

  const dom = await boot({ costs: data });
  assert.equal(runCount(card(dom, /By category/), /\$2\.50 more than the bill$/), 1,
    'a sum over the bill is a different fact from one under it');
});

test('a row with no figure at all is not added up as a zero', async () => {
  const data = payload({ range: 'month', billedThrough: 10 });
  delete data.views.category.rows[2].micros;

  const dom = await boot({ costs: data });
  const live = livePanel(dom);
  assert.equal(
    runCount(live, /^One of these rows carries no figure, so they cannot be added up$/), 1,
    'treating the absent row as zero would report a gap the size of that row, as though it were '
    + 'a real discrepancy');
  assert.equal(runCount(card(dom, /By category/), /adding up to the bill$/), 0,
    'the grouping with the unreadable row makes no claim about adding up');
  assert.equal(runCount(card(dom, /By service/), /adding up to the bill$/), 1,
    'the service card, whose rows are whole, still reconciles');
});

/* ------------------------------------------------------ absence is words */

test('a row the answer gives no figure for prints words, not a zero', async () => {
  const data = payload({ range: 'month', billedThrough: 10 });
  /* Both drawings of a row, because they are different code: the grouping
     card builds a row, the per-service table builds a table cell, and a
     mutation in either one alone has to be caught here. */
  delete data.views.service.rows[1].micros;
  delete data.views.service.rows[1].shareBasisPoints;
  delete data.views.category.rows[1].micros;
  delete data.views.category.rows[1].shareBasisPoints;

  const dom = await boot({ costs: data });
  const live = livePanel(dom);
  assert.ok(runCount(card(dom, /By service/), /^Not reported$/) >= 2,
    'in the table the figure and its share are both absent');
  assert.ok(runCount(switchCard(dom), /^Not reported$/) >= 1,
    'and the grouping card above it says so too, rather than drawing a $0.00 row');
  assert.equal(runCount(live, /^\$0\.00$/), 0,
    'a zero on a cost pane is a claim that something was billed nothing');
});

test('a service with no change figure says so rather than drawing a flat month', async () => {
  /* The route withholds changeBasisPoints when the previous stretch billed
     nothing to divide by, which is exactly what previousCollected: false
     produces. */
  const data = payload({ range: 'month', billedThrough: 10, previousCollected: false });
  assert.ok(data.views.service.rows.every((row) => row.changeBasisPoints === undefined),
    'the fixture is one the route built with no comparison');

  const dom = await boot({ costs: data });
  const live = livePanel(dom);
  assert.equal(runCount(live, /^No change$/), 0,
    '"No change" is a measured zero, and there was nothing to measure against');
  assert.ok(runCount(live, /^Not reported$/) >= data.views.service.rows.length,
    'every service row says its change is not reported');
});

test('a measured zero change is "No change", which is not the same as unmeasured', async () => {
  const data = payload({ range: 'month', billedThrough: 10, previousScale: 1 });
  assert.equal(data.total.changeBasisPoints, 0,
    'the fixture bills the same in both stretches, so the route computes a real zero');

  const dom = await boot({ costs: data });
  assert.ok(runCount(livePanel(dom), /^No change$/) >= 1,
    'a change of exactly zero is a fact the pane states');
});

test('an answer with no billed total at all does not print one', async () => {
  const data = payload({ range: 'month', billedThrough: 10 });
  delete data.total.micros;

  const dom = await boot({ costs: data });
  const live = livePanel(dom);
  assert.equal(runCount(live, /^Not reported$/), 1, 'the headline figure is words');
  assert.equal(
    runCount(live, /^This answer carried no billed total to check these rows against$/), 2,
    'both groupings say what they cannot check against, rather than checking against zero');
});

/* ----------------------------------------------------------- the stale path */

test('a recently collected answer prints when it was collected, without a warning', async () => {
  const dom = await boot({ costs: payload({ asOf: hoursAgo(5) }) });
  const live = livePanel(dom);
  const stamped = byClass(live, 'pill')
    .filter((n) => /^Collected \d+ \w+ \d{4} \d\d:\d\d UTC$/.test(ownText(n)));
  assert.equal(stamped.length, 1,
    'the collection time is on screen beside the figures');
  /* The glyph is decorative and carries no name in the DOM, so the warn tone
     is the one part of "this is a problem" a test can read. Five hours is
     inside one publishing cycle and the pill must not carry it. */
  assert.equal(hasClass(stamped[0], 'warn'), false,
    'a fresh answer is stated, not warned about');
  assert.equal(runCount(live, /behind, collected/), 0,
    'and nothing says it is behind');
});

test('an answer older than two publishing cycles says how far behind it is', async () => {
  const dom = await boot({ costs: payload({ asOf: hoursAgo(31) }) });
  assert.equal(runCount(livePanel(dom), /^31 hours behind, collected .* UTC$/), 1,
    'the age is beside the number rather than only in a timestamp nobody subtracts');
});

test('the stale threshold follows the answer\'s own publish lag, not a constant here', async () => {
  const slow = payload({ asOf: hoursAgo(9) });
  slow.publishLagHours = 4;
  const dom = await boot({ costs: slow });
  assert.equal(runCount(livePanel(dom), /^9 hours behind, collected .* UTC$/), 1,
    'nine hours is inside twice the default lag but outside twice this answer\'s own');
});

test('an answer with no collection time says that, rather than printing nothing', async () => {
  const dom = await boot({ costs: payload({ asOf: null }) });
  assert.equal(runCount(livePanel(dom), /^Collected at an unreported time$/), 1,
    'a figure with no age is the one case where the age has to be said in words');
});

test('a poller that is not ok says so in its own words, beside a fresh figure', async () => {
  const data = payload({
    asOf: hoursAgo(3),
    staleness: {
      state: 'failed',
      detail: 'The cost poller last failed at 06:12 UTC and has not succeeded since.',
    },
  });
  const dom = await boot({ costs: data });
  const live = livePanel(dom);
  assert.equal(
    runCount(live, /^The cost poller last failed at 06:12 UTC and has not succeeded since\.$/), 1,
    'the route\'s own detail is the sentence, because it is the only thing that knows which of '
    + 'the four reasons applies');
  assert.equal(runCount(live, /behind, collected/), 0,
    'a broken poller and an old figure are two facts, and this answer is only one of them');
});

test('a poller reporting ok is not also given a pill saying so', async () => {
  const dom = await boot({ costs: payload({ staleness: { state: 'ok' } }) });
  assert.equal(runCount(livePanel(dom), /^Cost collection is ok$/), 0,
    'a working poller is already stated by the collection time beside it');
});

/* ------------------------------------------------------------ ungrouped */

test('an unmapped service is drawn as its own named line, with words on it', async () => {
  const data = payload({
    range: 'month', billedThrough: 10, groups: GROUPS.concat([UNGROUPED_GROUP]),
  });
  const ungrouped = data.views.category.rows.filter((row) => row.ungrouped === true);
  assert.equal(ungrouped.length, 1, 'the fixture carries the route\'s ungrouped row');

  const dom = await boot({ costs: data });
  const live = livePanel(dom);
  assert.equal(runCount(live, /^Ungrouped$/), 1,
    'the row keeps its own label rather than being folded into a neighbour');
  assert.equal(runCount(live, /^Unmapped: no category covers these services yet$/), 1,
    'what is wrong with the row is words, not a tone: a tone alone says nothing to a reader who '
    + 'cannot see it');

  const row = byClass(live, 'sp-row-ungrouped')[0];
  assert.ok(row, 'the row carries its own class');
  assert.match(allText(row), /Ungrouped/);
});

test('a grouping with an unmapped row still adds up to the bill', async () => {
  const data = payload({
    range: 'month', billedThrough: 10, groups: GROUPS.concat([UNGROUPED_GROUP]),
  });
  const dom = await boot({ costs: data });
  assert.equal(runCount(card(dom, /By category/), /^6 categories adding up to the bill$/), 1,
    'the unmapped row is counted, which is why the categories reconcile to the invoice');
});

test('a row the mapping HAS seen gets no unmapped sentence', async () => {
  const dom = await boot({ costs: payload({ range: 'month', billedThrough: 10 }) });
  assert.equal(runCount(livePanel(dom), /^Unmapped: no category covers these services yet$/), 0,
    'every category in this fixture is mapped');
});

/* ---------------------------------------------------------- the chart */

test('the chart is named with its own data, because role="img" hides its text', async () => {
  const data = payload({ range: 'month', billedThrough: 10 });
  const dom = await boot({ costs: data });

  const charts = findAll(livePanel(dom), (n) => n.getAttribute
    && n.getAttribute('role') === 'img');
  assert.equal(charts.length, 1, 'one chart on the page');

  const name = charts[0].getAttribute('aria-label');
  assert.ok(name, 'a role="img" with no name is a picture announced as nothing');
  assert.match(name, /This period: 10 of 10 days billed/,
    'the name says how much of the window carries a figure');
  assert.match(name, /flat at \$103\.00/,
    'the name carries the figures, in the answer\'s own currency');
  assert.match(name, /Previous period: /,
    'both lines are in the name, not just the one on top');
});

test('a line with no billed day says so rather than being left out of the name', async () => {
  const data = payload({ range: 'month', billedThrough: 10 });
  data.daily.series[1].values = data.daily.series[1].values.map(() => null);

  const dom = await boot({ costs: data });
  const chart = findAll(livePanel(dom), (n) => n.getAttribute
    && n.getAttribute('role') === 'img')[0];
  assert.match(chart.getAttribute('aria-label'), /Previous period: no billed day in 10 days\./,
    'a line that is entirely absent is a fact about the comparison, not a line to omit');
});

test('a day past the end of a stretch breaks the pen instead of dropping to zero', async () => {
  /* The route pads the shorter stretch with null, and the longer stretch's
     own days are numbers. A pane that joined across the null would draw the
     comparison line running along the floor for days it was never billed. */
  const data = payload({ range: 'month', billedThrough: 10 });
  data.daily.series[0].values = [5, 6, null, null, 9, 10, 11, 12, 13, 14];

  const dom = await boot({ costs: data });
  const svg = findAll(livePanel(dom), (n) => n.getAttribute
    && n.getAttribute('role') === 'img')[0];
  const group = findAll(svg, (n) => n.getAttribute
    && n.getAttribute('data-series') === 'This period')[0];
  assert.ok(group, 'the series keys its own group');

  const paths = findAll(group, (n) => n.tagName && n.tagName.toLowerCase() === 'path');
  assert.equal(paths.length, 2,
    'two runs of readings means two paths; one path would be a line drawn across the gap');
});

test('a single billed day between two gaps is still drawn', async () => {
  const data = payload({ range: 'month', billedThrough: 10 });
  data.daily.series[0].values = [null, null, 7, null, null, null, null, null, null, null];

  const dom = await boot({ costs: data });
  const svg = findAll(livePanel(dom), (n) => n.getAttribute
    && n.getAttribute('role') === 'img')[0];
  const group = findAll(svg, (n) => n.getAttribute
    && n.getAttribute('data-series') === 'This period')[0];
  const points = findAll(group, (n) => hasClass(n, 'sp-ln-pt'));
  assert.equal(points.length, 1,
    'a reading with no neighbour has no line to belong to, and drawing nothing would hide a day '
    + 'that was billed');
});

test('the chart\'s scale is HTML beside it, never <text> inside the role="img"', async () => {
  const dom = await boot({ costs: payload({ range: 'month', billedThrough: 10 }) });
  const svg = findAll(livePanel(dom), (n) => n.getAttribute
    && n.getAttribute('role') === 'img')[0];
  assert.equal(findAll(svg, (n) => n.tagName && n.tagName.toLowerCase() === 'text').length, 0,
    'text inside a children-presentational role is announced to nobody');
  assert.ok(byClass(livePanel(dom), 'sp-tick').length >= 2,
    'the scale is real text outside the drawing');
});

/* Three things around the picture, each of which can be deleted with every
   other test in this file still passing: the dates the chart is drawn over,
   the names of the two lines, and how much of the period has a bill behind
   it. Each is user-visible, each fails silently, so each gets its own test. */

test('the day chart carries an x axis of the dates the route labelled', async () => {
  const data = payload({ range: 'month', billedThrough: 10 });
  const sent = data.daily.labels.filter(Boolean);
  assert.ok(sent.length >= 2, 'the fixture sends labels at all, or this test proves nothing');

  const dom = await boot({ costs: data });
  const axis = byClass(livePanel(dom), 'sp-xaxis')[0];
  assert.ok(axis, 'a chart of days with no dates under it is a shape, not a reading');
  assert.deepEqual(runs(axis), sent,
    'every label the route sent, in the order it sent them');
  assert.equal(axis.getAttribute('aria-hidden'), 'true',
    'and it is hidden from the reader, because the chart\'s own name already carries the dates');
});

test('both lines on the day chart are named, so the dashed one is not just a texture', async () => {
  const data = payload({ range: 'month', billedThrough: 10 });
  const dom = await boot({ costs: data });

  const chartCard = byClass(livePanel(dom), 'card')
    .filter((n) => findAll(n, (x) => x.getAttribute && x.getAttribute('role') === 'img').length > 0)[0];
  assert.ok(chartCard, 'the day chart is on the page');

  const legend = byClass(chartCard, 'legend')[0];
  assert.ok(legend, 'the chart names its lines beside itself');
  const named = runs(legend);
  assert.ok(named.indexOf(data.daily.series[0].label) !== -1,
    'the current stretch is named: ' + named.join(' | '));
  assert.ok(named.indexOf(data.daily.series[1].label) !== -1,
    'and so is the stretch it is drawn against: ' + named.join(' | '));
});

test('a period billed only part way through says how far, in days and a date', async () => {
  const data = payload({ range: 'month', billedThrough: 10 });
  assert.equal(data.period.billedDays, 10, 'ten days of a thirty day September');
  assert.equal(data.period.daysInPeriod, 30);

  const dom = await boot({ costs: data });
  assert.equal(runCount(livePanel(dom), /^10 of 30 days billed, through 10 Sep 2026$/), 1,
    'the pill states the part of the period that has a bill behind it, and to which day');

  /* Tone, which the docblock argues for at length and nothing above reads: a
     billing lag is how billing works, not a fault, so the pill must carry no
     tone modifier. `pill warn` renders amber and puts the same words in the
     register the pane uses for something an operator must act on.

     The vocabulary is read out of aria.css rather than listed here, so `warn`
     is caught as one of a class and not as the one spelling this test happened
     to think of -- `down` and `rose` are the same mistake in another colour.
     A non-tone class is not a defect and must pass, which is why this is a
     vocabulary check rather than an exact match on the class list. */
  const TONES = (readFileSync(new URL('assets/aria.css', OPS), 'utf8')
    .match(/^\.pill\.([a-z-]+)/gm) || []).map((s) => s.slice(6));
  ['warn', 'down', 'up', 'info'].forEach((tone) => assert.ok(TONES.indexOf(tone) !== -1,
    'the tone vocabulary is read, not empty: aria.css still defines .pill.' + tone));

  const billedPill = byClass(livePanel(dom), 'pill')
    .filter((n) => /\d+ of \d+ days billed/.test(allText(n)))[0];
  assert.ok(billedPill, 'the pill is a pill, not a bare run of text');
  const worn = String(billedPill.className).trim().split(/\s+/)
    .filter((cls) => TONES.indexOf(cls) !== -1);
  assert.deepEqual(worn, [],
    'neutral: a lag is not a warning, so no tone modifier may ride on it');

  /* The other direction, which is the half a one-sided test would miss: a
     period billed to its own end must NOT print the pill, because the range
     name already says it and the pill would be that fact twice. */
  const full = payload({
    range: 'last-month', now: new Date('2026-07-15T09:00:00.000Z'), billedThrough: 30,
  });
  assert.equal(full.period.billedDays, full.period.daysInPeriod,
    'a closed month billed to its own end');
  const whole = await boot({ costs: full });
  assert.equal(runCount(livePanel(whole), /\d+ of \d+ days billed/), 0,
    'and a fully billed period does not repeat what the range name already says');
});

test('the route\'s own note about the two stretches is printed once', async () => {
  /* A fully billed June against the whole of May: 30 days against 31, which
     is the route's rule 1 -- a period billed to its own end is compared
     against the WHOLE period before it, however long that was. */
  const data = payload({
    range: 'last-month', now: new Date('2026-07-15T09:00:00.000Z'), billedThrough: 30,
  });
  assert.equal(data.period.billedDays, 30);
  assert.equal(data.comparison.days, 31);
  assert.ok(data.daily.note, 'the route says so when the two stretches differ in length');

  const dom = await boot({ costs: data });
  assert.equal(runCount(livePanel(dom),
    /^The two stretches are not the same length: 30 days billed here against 31 in the period before, so one line stops before the other\.$/), 1,
    'printed once, as a card foot, rather than above the chart and below it');
  assert.equal(
    runCount(livePanel(dom), /^against the month before, over 31 days against 30 here$/), 1,
    'and the headline caption says it too, because that is the route\'s own label');
});

/* ------------------------------------------------------- the four states */

test('nothing published for the period is its own state, with a way out', async () => {
  const dom = await boot({
    costs: payload({ range: 'month', billedThrough: 0, pollerState: { status: 'ok' } }),
  });
  const words = emptyText(dom);
  assert.match(words, /Nothing published for this period yet/);
  assert.match(words, /The billing export has published nothing for this period yet/,
    'the route\'s own detail is the sentence');
  assert.match(words, /Try last month/,
    'a closed month is the one window that is always published, so it answers "is anything '
    + 'arriving at all"');
});

/* The words are not the way out; the href is. `Try last month` sitting on the
   page says only that a way out was drawn, and the failure this pane can
   actually have is silent: the link stays, still reads correctly, and travels
   back to the empty period it exists to escape.

   The contract is stated here independently of the code that builds it -- the
   link goes to THIS pane under `range=last-month`, whatever range the
   operator was standing in -- and it is asserted from two different starting
   ranges, because a link that merely echoed the current selection would
   satisfy a single-range version of this test by accident. */
test('the way out of an empty period goes to last month, not back to the period it escapes',
  async () => {
    for (const from of ['month', '3m']) {
      const dom = await boot({
        search: '?range=' + from,
        costs: payload({ range: from, billedThrough: 0, pollerState: { status: 'ok' } }),
      });
      const out = linkNamed(panel(dom, 'empty'), 'Try last month');
      assert.ok(out, 'the way out is a link rather than a sentence, from range=' + from);

      const href = out.getAttribute('href');
      assert.ok(href, 'and it carries an href, from range=' + from);
      const url = new URL(href, 'https://ops.example.invalid/ops/spend.html');
      assert.equal(url.pathname, '/ops/spend.html',
        'it stays on this pane rather than leaving it, from range=' + from);
      assert.equal(url.searchParams.get('range'), 'last-month',
        'and it asks for the closed month, not the period it is escaping, from range=' + from);
    }
  });

test('cost collection not being set up is a different state from nothing published', async () => {
  const dom = await boot({
    costs: payload({
      range: 'month', billedThrough: 0, pollerState: { status: 'unconfigured' },
    }),
  });
  const words = emptyText(dom);
  assert.match(words, /Cost collection is not set up/);
  assert.match(words, /No Azure subscription is configured for cost polling/);
  assert.doesNotMatch(words, /Try last month/,
    'no range shows figures when nothing is configured to collect them');
});

test('cost collection being switched off is its own state again', async () => {
  const dom = await boot({
    costs: payload({ range: 'month', billedThrough: 0, pollerState: { status: 'disabled' } }),
  });
  const words = emptyText(dom);
  assert.match(words, /Cost collection is switched off/);
  assert.match(words, /Cost polling is switched off for every subscription in scope/);
});

test('two currencies in one window is stated, not totalled', async () => {
  const dom = await boot({
    costs: payload({ range: 'month', billedThrough: 10, currencies: ['USD', 'EUR'] }),
  });
  const words = emptyText(dom);
  assert.match(words, /Billed in more than one currency/);
  assert.match(words, /\(USD, EUR\)/, 'which two is the answer\'s, not the pane\'s');
  assert.equal(runCount(livePanel(dom), /adding up to the bill/), 0,
    'there is no total to add up to');
});

test('an availability state the pane does not know is not read as one of the four', async () => {
  const data = payload({ range: 'month', billedThrough: 10 });
  data.availability = { state: 'quarantined', detail: 'Held for review.' };

  const dom = await boot({ costs: data });
  const words = emptyText(dom);
  assert.match(words, /This answer is not one this pane can read/,
    'picking the nearest known state would draw a guess with the same confidence as a fact');
  assert.match(words, /Held for review\./, 'the route\'s own words still reach the operator');
  assert.doesNotMatch(words, /switched off|not set up|Nothing published/);
});

test('a read that fails is the degraded state, and says the figures are unread', async () => {
  const dom = await boot({ costs: new Error('gateway timeout') });
  const words = allText(livePanel(dom));
  assert.match(words, /This pane could not be read/);
  assert.match(words, /Nothing here is a zero\. The figures are unread, not absent\./,
    'on a cost pane the difference between unread and zero is the whole point');
});

test('the loading state is up before the answer lands', async () => {
  const dom = await boot({ costs: payload() });
  /* The skeleton region exists and was filled; after the answer it is the
     live panel that is shown. Both facts, in order. */
  const loading = panel(dom, 'loading');
  assert.ok(loading, 'the loading panel is in the document');
  assert.ok(byClass(loading, 'skel').length > 0, 'and it was filled with a skeleton');
});

/* ---------------------------------------------------- the forecast rule */

test('a month to date carries the forecast and its basis', async () => {
  const data = payload({ range: 'month', billedThrough: 10 });
  const dom = await boot({ costs: data });
  const live = livePanel(dom);
  assert.equal(runCount(live, /^Forecast to period end$/), 1);
  assert.equal(runCount(live, /^\$3,090\.00$/), 1,
    '$1,030.00 over ten days, at the same daily rate, over a 30 day September');
  assert.equal(
    runCount(live, /^Projected from the 10 days billed so far, at the same daily rate\.$/), 1,
    'the basis is the route\'s sentence and appears nowhere else');
});

test('a closed period carries no forecast, and the pane draws none', async () => {
  const data = payload({ range: 'last-month' });
  assert.equal(data.forecast, undefined,
    'the route forecasts only an open period, and only month is open');

  const dom = await boot({ costs: data });
  const live = livePanel(dom);
  assert.equal(runCount(live, /^Forecast to period end$/), 0);
  assert.equal(runCount(live, /Projected from the/), 0,
    'a basis with no forecast beside it is a sentence about nothing');
});

/* ------------------------------------------------------- the view switch */

test('the allocation groupings are one card and a switch, not a card each', async () => {
  const dom = await boot({ costs: payload({ range: 'month', billedThrough: 10 }) });
  const live = livePanel(dom);
  assert.equal(runCount(live, /^By category$/), 1, 'the grouping on screen names itself once');
  assert.equal(runCount(live, /^By resource group$/), 0,
    'a grouping not on screen is behind its button, not drawn as well');
  assert.ok(byClass(live, 'sp-views').length >= 1, 'the switch is on the page');
});

test('the switch says which grouping is on, as state rather than as a colour', async () => {
  const dom = await boot({ costs: payload({ range: 'month', billedThrough: 10 }) });
  const buttons = byClass(livePanel(dom), 'sp-views')
    .flatMap((row) => findAll(row, (n) => n.getAttribute
      && n.getAttribute('data-view') !== null));
  assert.deepEqual(buttons.map((n) => String(n.textContent)), ['Category', 'Resource group'],
    'the two allocation cuts, and NOT Service -- the table below already draws those rows');

  const on = buttons.filter((n) => n.getAttribute('aria-pressed') === 'true');
  assert.equal(on.length, 1, 'exactly one is pressed');
  assert.equal(String(on[0].textContent), 'Category', 'and it is the one the card is showing');
});

test('switching grouping redraws from the answer in hand, without reading again', async () => {
  const dom = await boot({ costs: payload({ range: 'month', billedThrough: 10 }) });
  const before = dom.calls.filter((c) => c.endpoint === '/api/ops/costs').length;

  const button = byClass(livePanel(dom), 'btn')
    .filter((n) => String(n.textContent) === 'Resource group')[0];
  assert.ok(button, 'the resource group button is on the page');
  button.dispatchEvent({ type: 'click' });

  const live = livePanel(dom);
  assert.equal(runCount(live, /^By resource group$/), 1, 'the card is now the other grouping');
  /* The window holds two subscriptions, so the route qualifies every group
     name with the subscription it is billed on -- a bare name is ambiguous
     when the same group exists on two bills. */
  assert.equal(runCount(live, /^rg-app-prod \(Production\)$/), 1,
    'with the other grouping\'s own rows');
  assert.equal(dom.calls.filter((c) => c.endpoint === '/api/ops/costs').length, before,
    'two cuts of one bill need one read, not two');
});

test('switching hands keyboard focus back to the button that did it', async () => {
  const dom = await boot({ costs: payload({ range: 'month', billedThrough: 10 }) });
  const button = byClass(livePanel(dom), 'btn')
    .filter((n) => String(n.textContent) === 'Resource group')[0];

  /* A keyboard operator reaches the switch by tabbing to it, so the click
     arrives with focus ON the button. The redraw destroys that button; if
     nothing hands focus back they are dropped to the top of the document and
     have to traverse the skip link, the rail and the filter bar again -- on
     every switch, for the pane's only interactive control. */
  button.focus();
  assert.equal(dom.doc.activeElement, button, 'focus starts on the control');
  button.dispatchEvent({ type: 'click' });

  const after = dom.doc.activeElement;
  assert.ok(after, 'focus did not fall off the document');
  assert.notEqual(after, dom.body, 'and was not dropped to the top of the page');
  assert.equal(after.getAttribute('data-view'), 'resourceGroup',
    'it is on the rebuilt button for the grouping now showing');
  assert.equal(after.getAttribute('aria-pressed'), 'true',
    'which is the one that reads as pressed');
});

test('a pointer switch does not move focus, because it was not on the switch', async () => {
  const dom = await boot({ costs: payload({ range: 'month', billedThrough: 10 }) });
  const button = byClass(livePanel(dom), 'btn')
    .filter((n) => String(n.textContent) === 'Resource group')[0];

  /* The other direction. Focus is nowhere in particular, and moving it onto
     the switch would be a jump nobody asked for. */
  assert.notEqual(dom.doc.activeElement, button, 'focus is not on the switch');
  const before = dom.doc.activeElement;
  button.dispatchEvent({ type: 'click' });
  assert.equal(dom.doc.activeElement, before, 'and the redraw left it where it was');
  assert.equal(runCount(livePanel(dom), /^By resource group$/), 1, 'the switch still worked');
});

/* The tone classes on a change pill read backwards on purpose -- up is the
   bad direction on a bill -- so the chevron and the signed figure are what
   carry the direction. Colour is never the only thing saying it, and that is
   only true while the chevron follows the sign. */
test('the change chevron follows the sign, so the tone is never the only thing saying it',
  async () => {
    const UP = 'M7 14l5-5 5 5';
    const DOWN = 'M7 10l5 5 5-5';

    const data = payload({ range: 'month', billedThrough: 10 });
    data.views.service.rows[0].changeBasisPoints = 1850;
    data.views.service.rows[1].changeBasisPoints = -1200;
    data.views.service.rows[2].changeBasisPoints = 0;

    const dom = await boot({ costs: data });
    const table = card(dom, /By service/);

    /* Read off the drawn pill, by its own printed figure, so the assertion
       is against the sign on screen rather than against the fixture. */
    const pills = byClass(table, 'pill').map((pill) => ({
      text: ownText(pill),
      tone: String(pill.className || ''),
      paths: findAll(pill, (n) => n.tagName && n.tagName.toLowerCase() === 'path')
        .map((n) => n.getAttribute('d'))
    }));

    const rise = pills.filter((p) => /^\+/.test(p.text))[0];
    assert.ok(rise, 'a rise is on the table');
    assert.deepEqual(rise.paths, [UP], 'a rise draws the up chevron');
    assert.match(rise.tone, /\bdown\b/, 'and takes the rose tone, because up is bad on a bill');

    const fall = pills.filter((p) => /^-/.test(p.text))[0];
    assert.ok(fall, 'a fall is on the table');
    assert.deepEqual(fall.paths, [DOWN], 'a fall draws the down chevron');
    assert.match(fall.tone, /\bup\b/, 'and takes the emerald tone');

    const flat = pills.filter((p) => p.text === 'No change')[0];
    assert.ok(flat, 'a measured zero is on the table');
    assert.deepEqual(flat.paths, [], 'and draws no chevron at all, because it points nowhere');

    /* Both directions, against each other: the two glyphs must differ. A
       single icon name used for both would satisfy every assertion above if
       they were read one at a time. */
    assert.notDeepEqual(rise.paths, fall.paths,
      'a rise and a fall are not drawn with the same glyph');
  });

test('every grouping reconciles to the same bill, which is what makes switching safe', async () => {
  const data = payload({ range: 'month', billedThrough: 10 });
  const dom = await boot({ costs: data });
  const bill = /^\$1,030\.00$/;

  /* Scoped to the grouping card. The per-service table draws a reconciliation
     line of its own, so asserting over the whole panel would pass on that one
     and say nothing about the card the switch actually redraws. */
  const seen = [];
  for (const [label, line] of [
    ['Category', /^5 categories adding up to the bill$/],
    ['Resource group', /^3 resource groups adding up to the bill$/]
  ]) {
    const button = byClass(livePanel(dom), 'btn')
      .filter((n) => String(n.textContent) === label)[0];
    assert.ok(button, label + ' is offered');
    button.dispatchEvent({ type: 'click' });

    const on = switchCard(dom);
    assert.equal(runCount(on, line), 1, label + ' states that its own rows add up');
    assert.equal(runCount(on, bill), 1, label + ' prints the bill it adds up to');
    seen.push(label);
  }
  assert.deepEqual(seen, ['Category', 'Resource group'],
    'both groupings were switched to, not one of them twice');

  /* The third cut is the table below, not a switch state. It is on the page
     the whole time and it reconciles to the same bill. */
  const table = card(dom, /By service/);
  assert.equal(runCount(table, /^5 services adding up to the bill$/), 1,
    'the per-service table adds up too, in its own words');
  assert.equal(runCount(table, bill), 1, 'and to the same bill');
});

test('the per-service rows are drawn once, as the table, and not also as a switch state',
  async () => {
    const dom = await boot({ costs: payload({ range: 'month', billedThrough: 10 }) });

    /* Read off `data-view`, not the button's words. A grouping restored to
       the switch without a label in VIEW_BUTTON falls back to its own key,
       so a test filtering on the text "Service" would not see it come back
       -- and the duplication it is named for would walk straight through. */
    const offered = byClass(livePanel(dom), 'sp-views')
      .flatMap((row) => findAll(row, (n) => n.getAttribute
        && n.getAttribute('data-view') !== null))
      .map((n) => n.getAttribute('data-view'));
    assert.deepEqual(offered, ['category', 'resourceGroup'],
      'the switch offers the two allocation cuts and nothing that redraws the table');

    /* Walked, not reasoned about: every state the switch can reach, asserted
       to draw each card title once and each reconciliation sentence once.
       The duplication this is named for only appears in the state that draws
       the rows a second time, so a test that never enters that state cannot
       see it. */
    for (const key of offered.concat(offered.slice(0, 1))) {
      const button = findAll(livePanel(dom), (n) => n.getAttribute
        && n.getAttribute('data-view') === key)[0];
      button.dispatchEvent({ type: 'click' });

      const live = livePanel(dom);
      const heads = byClass(live, 'card').map((n) => String(runs(n)[0] || ''));
      assert.deepEqual(heads, Array.from(new Set(heads)),
        'with ' + key + ' on, no two cards carry the same title: ' + heads.join(' / '));

      const claims = runs(live).filter((t) => / adding up to /.test(t));
      assert.equal(claims.length, 2,
        'with ' + key + ' on, two cards make the reconciliation claim: the grouping '
        + 'on screen and the table');
      assert.deepEqual(claims, Array.from(new Set(claims)),
        'with ' + key + ' on, the two claims are about different things: '
        + claims.join(' / '));
    }

    assert.equal(runCount(livePanel(dom), /^5 services adding up to the bill$/), 1,
      'the table says it about services');
    assert.equal(runCount(livePanel(dom), /^5 categories adding up to the bill$/), 1,
      'the grouping card about categories, and the two sentences differ');
  });

test('the column past the edge is reachable without a pointer, and says what it is',
  async () => {
    /* What this box hides on a phone is a column, not a margin: measured in
       Chrome 152 at 320px it is 315 wide inside 256, with the whole Change
       column (241.33..314.72 inside the box) past the visible edge. 360px
       hides 18px, 375px 4px, 414px and up none.

       Chrome >= 127 puts an overflowing scroller into the tab order on its
       own, and measured here it does -- but focus then lands on a box with no
       role and no name, and an engine without that behaviour leaves the
       column to a pointer alone. Named and focusable is what
       ops/README.md:942-944 states as the rule and what the Analytics,
       Evaluations, Releases and Settings panes already do. */
    const dom = await boot();
    const table = card(dom, /By service/);
    const box = byClass(table, 'sp-scroll')[0];
    assert.ok(box, 'the per-service table is not inside a scroll box at all');
    assert.equal(byClass(box, 'sp-tbl').length, 1,
      'the box that scrolls is not the one holding the table');
    assert.equal(box.getAttribute('tabindex'), '0',
      'the box carrying the Change column cannot be reached from a keyboard');
    assert.equal(box.getAttribute('role'), 'region',
      'focus lands on a bare div, which announces nothing about what it holds');
    assert.equal(box.getAttribute('aria-label'), 'By service',
      'the region does not say which table it is');

    /* And the name is the answer's own, not a constant in the pane: the card
       head and the region have to keep saying the same thing when the route
       renames the view. */
    const renamed = payload();
    renamed.views.service.label = 'By Azure service';
    const second = await boot({ costs: renamed });
    const box2 = byClass(card(second, /By Azure service/), 'sp-scroll')[0];
    assert.equal(box2.getAttribute('aria-label'), 'By Azure service',
      'the region is named from a constant rather than from the answer');
  });

test('a grouping the answer has no rows for is not offered', async () => {
  const data = payload({ range: 'month', billedThrough: 10 });
  data.views.resourceGroup.rows = [];

  const dom = await boot({ costs: data });
  const labels = byClass(livePanel(dom), 'btn')
    .map((n) => String(n.textContent || ''))
    .filter((t) => /^(Category|Resource group|Service)$/.test(t));
  assert.deepEqual(labels, [],
    'a button that switches to an empty card is a control that does nothing, and a '
    + 'switch with one state left is not a switch');
  assert.ok(card(dom, /By category/), 'the grouping that does have rows is still drawn');
});

/* ------------------------------------------- the subscription-level row */

test('a charge billed to no resource group keeps the route\'s own words', async () => {
  const data = payload({ range: 'month', billedThrough: 10 });
  const dom = await boot({ costs: data });
  const button = byClass(livePanel(dom), 'btn')
    .filter((n) => String(n.textContent) === 'Resource group')[0];
  button.dispatchEvent({ type: 'click' });

  const live = livePanel(dom);
  assert.equal(runCount(live, /^Subscription level \(Production\)$/), 1,
    'the poller\'s empty-string sentinel is a real row and gets real words');
  assert.equal(
    runCount(live, /^Billed to the subscription rather than to a resource group\.$/), 1,
    'the route\'s description is printed rather than dropped');
});

/* ------------------------------------------------------ the editorial rule */

test('the share bar carries no label of its own, and is hidden from a reader', async () => {
  const dom = await boot({ costs: payload({ range: 'month', billedThrough: 10 }) });
  const meters = byClass(livePanel(dom), 'meter');
  assert.ok(meters.length >= 5, 'one bar per row');
  for (const meter of meters) {
    assert.equal(meter.getAttribute('aria-hidden'), 'true',
      'the share is printed as a figure in the same row; a named meter would say it twice');
    assert.equal(String(meter.textContent || '').trim(), '',
      'a bar with a label on it is the same fact three times');
  }
});

test('each figure on the headline is printed once, not once as a number and once as a sentence',
  async () => {
    const data = payload({ range: 'month', billedThrough: 10 });
    const dom = await boot({ costs: data });
    const head = card(dom, /This month to date/);
    assert.ok(head, 'the headline card is on the page');
    assert.equal(runCount(head, /^\$1,030\.00$/), 1,
      'the period total appears once in its own card');
    assert.equal(runCount(head, /^\$3,090\.00$/), 1, 'and so does the forecast');
    /* The rule the pane exists to follow is one fact per slot, and a caption
       repeating a figure breaks it without ever producing a second bare run.
       Counted across every run's text, not only runs that are the figure. */
    assert.equal(occurrences(head, '$1,030.00'), 1,
      'the total is not also spelled out in a sentence beside itself');
    assert.equal(occurrences(head, '$3,090.00'), 1,
      'and neither is the forecast');
  });

/* ------------------------------------------------------------- the page */

test('the page loads the v2 system and none of v1', () => {
  assert.match(PAGE_HTML, /assets\/aria\.css/);
  assert.match(PAGE_HTML, /assets\/shell-pane-v2\.css/);
  assert.match(PAGE_HTML, /assets\/pane-spend-v2\.css/);
  assert.match(PAGE_HTML, /assets\/shell-pane-v2\.js/);
  assert.match(PAGE_HTML, /assets\/pane-spend\.js/);
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

/* Comments stripped first. The module's own docblock says it uses no
   innerHTML, so a guard over the raw file matches that sentence and passes
   whatever the code does -- the "source-grep assertion still matches after
   the defect is reinstated" shape, with the sentence doing the matching. */
const PANE_CODE = PANE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* Every spelling that turns a value into markup, not the one this module
   happens not to use. A guard that names `innerHTML` alone passes
   `outerHTML`, `insertAdjacentHTML` and `document.write`, which are the same
   defect typed differently. */
const MARKUP_WRITE = /innerHTML|outerHTML|insertAdjacentHTML|document\s*\.\s*write/;

/* A style ATTRIBUTE, which `ops/spend.html`'s `style-src 'self'` forbids,
   in the two ways this module could write one: by name, and as an option key
   to `h()` or `svgEl()`. Both of those helpers `setAttribute` every key that
   is not `className` or `text` (`shell-pane-v2.js:149-159`), so
   `h('div', { style: '...' })` writes a literal style attribute through the
   module's own primary idiom -- a spelling `setAttribute('style'` cannot
   see. Quoted keys and a key on its own line are the same defect, so the
   pattern allows for both.

   NOT COVERED, deliberately: `element.style.setProperty(...)`. The module
   does that twice on purpose -- a share bar's width and a gridline label's
   offset are lengths computed from the answer -- and CSSOM is not gated by
   the policy. The clause below pins that exception rather than trusting it:
   every `.style` contact in the module must BE a `setProperty` call. Also
   not covered: an attribute name assembled at runtime, which no source scan
   can see and which the page's own policy is the enforcement for. And three
   further spellings, verified SURVIVED rather than assumed: a namespaced
   `setAttributeNS(null, 'style', ...)`, a capitalised `Style:` key on `h()`
   (HTML lowercases attribute names, so it writes a real style attribute), and
   `document.createRange().createContextualFragment(...)`. This module writes
   none of the three, and widening an analyzer to reach them adds guard code
   nothing has reviewed; they are recorded here rather than matched. */
const STYLE_ATTR_WRITE = /setAttribute\(\s*['"]style['"]|[{,]\s*['"]?style['"]?\s*:/;

test('the pane module writes no markup and no style attribute', () => {
  assert.ok(/innerHTML/.test(PANE_SRC),
    'the docblock explains why there is none, so the raw file DOES carry the word: this asserts '
    + 'the guard below is reading stripped code rather than passing vacuously');

  /* A positive control per clause, so the widened guard cannot claim a
     spelling it does not actually see. Each of these is the defect the test
     is named for, written the way it would really arrive. */
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
  CAUGHT.forEach(function (pair) {
    assert.ok(pair[1].test(pair[0]), 'the guard cannot see this spelling: ' + pair[0]);
  });

  assert.ok(!MARKUP_WRITE.test(PANE_CODE),
    'the pane shows production data to an administrator; no value may become markup');
  assert.ok(!STYLE_ATTR_WRITE.test(PANE_CODE),
    'a style attribute is forbidden by the page\'s own policy');

  /* The documented exception, held to its own words: CSSOM, and only CSSOM. */
  const styleContacts = PANE_CODE.match(/\.style\b[\s\S]{0,14}/g) || [];
  assert.ok(styleContacts.length > 0, 'the two computed lengths are still there to be checked');
  styleContacts.forEach(function (contact) {
    assert.match(contact, /^\.style\s*\.\s*setProperty\(/,
      'the docblock allows CSSOM for two computed lengths and nothing else; this is: ' + contact);
  });

  assert.ok(!/\bstyle\s*=/.test(PAGE_HTML), 'and none is written into the page either');
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

   NOT COVERED by either clause: a CSS NAMED colour standing in a property
   whose name carries none of the words `COLOUR_SLOT` gates on --
   `text-decoration: underline crimson` is the shape. The spelling clause has
   no property gate but reads only hexes and the `rgb()`/`hsl()` families, and
   the value scan reads any spelling but only where it is looking. Widening
   the gate to every property means allowlisting every geometry word in CSS,
   which is a larger guard than the sheet it guards. */
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
   sweep eats. What it cannot see is a CSS named colour or an `oklch()`, and
   that is the value scan's half of the union. */
function rawColourSpellings(css) {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [
    ...(body.match(/#[0-9a-fA-F]{3,8}\b/g) || []),
    ...(body.match(/\b(?:rgb|rgba|hsl|hsla)\(/g) || []),
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
     is in a comment. */
  ['#333', '#112233', '#2b7fff', '#FFF', 'rgb(0,0,0)', 'rgba(0,0,0,.4)',
    'hsl(210 90% 60%)', 'hsla(210 90% 60% / .4)'].forEach((spelling) => {
    assert.equal(rawColourSpellings('.x { background: ' + spelling + '; }').length, 1,
      'the spelling clause cannot see: ' + spelling);
  });
  assert.deepEqual(
    rawColourSpellings('/* #333 rgb( */ .x { background: var(--c, var(--cyan)); }'), [],
    'the spelling clause reads a comment as a declaration'
  );

  const stated = [];
  RULES.forEach((rule) => { stated.push(...colourValues(rule.body)); });
  assert.deepEqual(stated, [],
    'the v2 palette is AA by construction; a colour here is outside that proof and does not '
    + 'follow the theme');
  assert.deepEqual(rawColourSpellings(PANE_CSS), [], 'same rule, spelled the other way');
});

test('a card cannot set the page\'s own minimum width', () => {
  const rule = RULES.filter((r) => r.targets(/\.grid\s*>\s*\.card/))[0];
  assert.ok(rule, 'the pane stylesheet keeps the grid child from sizing to its content');
  assert.match(rule.body, /min-width:\s*0/,
    'without it a long service name takes the whole page sideways instead of scrolling inside '
    + 'its own card');
});

test('the service name column can break, because Azure names it and some have no space',
  () => {
    const rule = RULES.filter((r) => r.targets(/\.sp-name\b/))[0];
    assert.ok(rule, '.sp-name is styled');
    assert.match(rule.body, /overflow-wrap:\s*anywhere/);

    const cell = RULES.filter((r) => r.targets(/th\[scope="row"\]/))[0];
    assert.ok(cell, 'the table\'s row header is styled');
    assert.match(cell.body, /overflow-wrap:\s*anywhere/);
  });

test('the change pill survives the narrow layout rather than being dropped', () => {
  const narrow = RULES.filter((r) => r.media && /max-width:\s*720px/.test(r.media));
  assert.ok(narrow.length > 0, 'the stylesheet has a narrow layout');
  const dropped = narrow.filter((r) => r.targets(/\.sp-chg\b/) && /display:\s*none/.test(r.body));
  assert.deepEqual(dropped, [],
    'a row that only says it went up has lost the thing it went up from');
});
