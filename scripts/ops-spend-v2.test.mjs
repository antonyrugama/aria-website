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

/* ------------------------------------------------- the summary's budget

   The SECOND read the pane makes. /api/ops/costs carries no target -- a
   budget is Azure's own Microsoft.Consumption record and reaches a client on
   /api/ops/summary -- so the budget card is driven from a different payload
   and this builds it.

   Mirrors the block `opsSummaryView.ts` publishes as of Stadiora/Aria#10780:
   `basis` is `spend_against_target` only when a budget was read AND is
   comparable, `cost.budget.ratioBasisPoints` is the route's own division of
   spend by target and is deliberately NOT clamped, and the `budget` entry
   leaves `omissions` exactly when the block arrives. Both halves matter to
   this pane: the refusal is what it prints when there is no track to draw.

   The arithmetic here is the ROUTE's, not the pane's: `ratioBasisPoints` is
   computed from the two micros figures the fixture states, so a test that
   compares a drawn width against it is comparing the pane to the contract
   rather than to itself. */
const OTHER_OMISSION = {
  key: 'hourly_activity',
  title: 'Activity by hour',
  detail: 'Nothing stores an hourly grain, so the by-hour figure has no source.',
};

export function summaryPayload(options) {
  const o = options || {};
  const spend = o.spend === undefined ? 945_710_000 : o.spend;
  const target = o.target === undefined ? 300_000_000 : o.target;
  const currency = o.currency === undefined ? 'USD' : o.currency;
  const refusal = o.refusal || null;
  const drawn = !refusal && target !== null && spend !== null;

  const budget = drawn
    ? {
      name: 'aria-target-monthly-budget',
      micros: target,
      currency,
      timeGrain: 'Monthly',
      periodStart: '2026-06-01',
      periodEnd: null,
      fetchedAt: '2026-08-14T06:00:00.000Z',
      ratioBasisPoints: Math.round((spend / target) * 10_000),
    }
    : null;

  return {
    cost: {
      range: 'month',
      basis: drawn ? 'spend_against_target' : 'spend',
      publishLagHours: OPS_COST_PUBLISH_LAG_HOURS,
      window: {
        start: o.windowStart === undefined ? '2026-08-01' : o.windowStart,
        endExclusive: '2026-09-01',
        billedDays: 14,
        actualThrough: o.actualThrough === undefined ? '2026-08-14' : o.actualThrough,
      },
      availability: { state: 'ready', detail: '' },
      asOf: '2026-08-14T06:00:00.000Z',
      ...(spend === null ? {} : { micros: spend, currency }),
      ...(budget ? { budget: o.budget === undefined ? budget : o.budget(budget) } : {}),
    },
    omissions: drawn
      ? [OTHER_OMISSION]
      : [{
        key: 'budget',
        title: 'Budget',
        detail: refusal || 'Nothing here records a cloud budget to compare this against.',
      }, OTHER_OMISSION],
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

/* The stylesheet as `cssRules()` reads it -- comments taken out by the same
   string-blind sweep. The shape test asserts on THIS text rather than on the
   file, so what it refuses is what the rest of this file actually parsed. */
const STRIPPED = PANE_CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/* One rule's declarations, as a property map. Splitting on `;` and `:`
   outright loses any value holding either character -- `content: ";"`, a
   `url(data:...)`, a `var()` fallback with a semicolon -- and a property that
   disappears from this map is a property every check below reads as
   agreeing. So the scan steps over anything inside brackets or quotes. */
function declarations(body) {
  const out = new Map();
  /* Every property name this scan could not read, kept rather than thrown
     away. A name dropped in silence is a name every check below reads as
     agreeing: `posi\74 ion: static` is `position` to a browser, fails the
     name pattern here, and shipped 67.35% of the plot green. The shape test
     refuses a rule that has any. */
  const dropped = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  let colon = -1;
  const take = (end) => {
    if (colon > start) {
      const property = body.slice(start, colon).trim().toLowerCase();
      const value = body.slice(colon + 1, end).trim();
      if (/^[-a-z]+$/.test(property) && value) out.set(property, value);
      else if (property && value) dropped.push(property);
    }
    start = end + 1;
    colon = -1;
  };
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote) {
      if (ch === quote && body[i - 1] !== '\\') quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (depth === 0 && ch === ':' && colon === -1) colon = i;
    else if (depth === 0 && ch === ';') take(i);
  }
  take(body.length);
  out.dropped = dropped;
  return out;
}

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
  /* Absent by default, and absent means the read FAILS -- which is the state
     every test written before the budget card ran in, and the state the live
     API is in until Stadiora/Aria#10780 deploys. So the whole suite doubles
     as the control for "a summary this pane cannot read leaves the bill
     untouched". */
  const summary = opts.summary === undefined ? null : opts.summary;
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
      if (endpoint === '/api/ops/summary') {
        if (summary === null) return Promise.reject(new Error('no stub for ' + endpoint));
        if (summary instanceof Error) return Promise.reject(summary);
        return Promise.resolve({ data: summary });
      }
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

/* --------------------------------------- the windows the registry offers

   scripts/ops-registry-filters.test.mjs holds "a filter a pane declares must
   move something" for every pane that declares one. Until Stadiora/Aria#10798
   it excused this one, on the grounds that the pane was still on the v1 shell
   and mid-conversion -- which stopped being true the day that conversion
   merged, and is held false now by the test above at 'the page loads the v2
   system and none of v1'. A coverage exclusion resting on a fact that has
   quietly expired gets read at face value by the next person deciding whether
   a pane is tested. So the exclusion was not reworded, it was DELETED: that
   file now boots this pane from a two-field answer and RUNS four of its
   sections against it -- `1. the coverage lock`, `2. a declared filter changes
   what the pane does`, `3. a filter reaches the read` and `6. no value costs
   the pane its answer`, named by banner rather than by number because that
   file carries two numbering schemes. That last one is the one the exclusion
   used to say could not be held from a client. (RUNS, not proves: section 2
   is an OR across a pane's values and is the floor under a pane that answers
   every value identically, so it is sections 3 and 6 that a window added to
   the declaration has to get past.) There is no longer an
   excuse here to keep true, which is the only kind that cannot go stale.

   The two tests below stay, because they are not the same claim. That file
   asks whether the window reaches the read; these ask what the pane does with
   it once it has -- under this pane's own fixture, which carries the figures
   the headline is drawn from. The list of windows is read from the registry
   rather than typed, so a fifth window added to the declaration is covered
   the moment it is declared. The EXPECTATION is not: each window's expected
   arrival is that exact string in `query.range`. That is held next door by
   the section banner `3. a filter reaches the read` -- named by its heading
   rather than by a number, because that file numbers its sections 1 to 6 and
   separately numbers three rules in a CONTRACT block, and the two schemes
   disagree. (HONOURED records spend's filter, not that section, as 'read'.)
   Either way the expectation is the registry's, not anything this pane
   computes.

   The second test's expectation is likewise the registry's, not the pane's:
   the two label tables deliberately differ ('This month' against 'This month
   to date'), so the binding asserted is that the pane's headline STARTS WITH
   the registry's label -- the pane may extend a name, it may not rename one.
   Asserting equality would pin the extension; asserting nothing would let the
   four names be dealt out in any order, which is the swap this catches, in
   both directions run (3m/12m and month/last-month).

   What a PREFIX cannot catch, stated rather than implied: a label that keeps
   the registry's name and then contradicts it further along the string --
   'Last 12 months, which is Last 3 months of billing' passes. Round 3's
   reviewer ran it. Nothing here binds the tail, and an assertion that did
   would be pinning wording rather than the window, which is the trade taken
   deliberately: this catches a name swapped for another window's, not a name
   argued with. */

/* The registry as the shell loads it, without booting a pane. */
function registryPanes() {
  const context = vm.createContext({ window: {} });
  vm.runInContext('var global = window;', context);
  vm.runInContext(REGISTRY_SRC, context, { filename: 'pane-registry.js' });
  return context.window.OpsPaneRegistry.PANES;
}

/* The registry's own names for the windows -- what the filter bar prints on
   the control. Read the same way, from the same source, so the expectation is
   never the pane's copy of it. */
function registryRanges() {
  const context = vm.createContext({ window: {} });
  vm.runInContext('var global = window;', context);
  vm.runInContext(REGISTRY_SRC, context, { filename: 'pane-registry.js' });
  return context.window.OpsPaneRegistry.RANGES;
}

test('every window the registry offers Cloud costs reaches the read under its own name',
  async () => {
    const declared = registryPanes().spend.range;
    assert.ok(Array.isArray(declared) && declared.length >= 2,
      'the registry declares a window list for spend; without one there is nothing to hold');

    for (const window of declared) {
      const dom = await boot({
        search: '?range=' + window,
        costs: payload({ range: window, billedThrough: 5 }),
      });
      const call = dom.calls.filter((c) => c.endpoint === '/api/ops/costs')[0];
      assert.ok(call, 'the pane read the cost route for ' + window);
      assert.equal(call.query.range, window,
        'the bar offers ' + window + ' and the read went without it, so the answer is of some '
        + 'other window than the one named above it');
    }
  });

test('no window the registry offers Cloud costs leaves the headline describing dates',
  async () => {
    const declared = registryPanes().spend.range;

    for (const window of declared) {
      const dom = await boot({
        search: '?range=' + window,
        costs: payload({ range: window, billedThrough: 5 }),
      });
      /* The headline node itself, not a run count. region() builds liveBox
         unconditionally with data-state="live degraded", and only show() and
         degraded() ever write to it (shell-pane-v2.js:630,635, both through
         fill(), which clears first). empty() fills emptyBox and never touches
         liveBox at all, so a refusal leaves whatever was last painted
         standing -- offscreen, since applyState('empty') is what takes it off
         the page. Either way `livePanel(dom)` is truthy on every path, so a
         filter over its runs returns [] for "the pane never drew anything"
         exactly as it does for "the pane drew a good headline". Asserting the
         node is what tells those two apart, and is why the weaker
         assert.ok(live, ...) this started as was dropped: it tests the
         harness's scaffolding and stays green on a pane that drew nothing.

         NOT COVERED here, and demonstrated rather than assumed: a load that
         paints a headline and THEN refuses leaves this assertion green, on a
         node the reader cannot see. Round 2's reviewer ran it. The pane has
         no such path today -- one load() reaches exactly one of show(),
         degraded(), empty() or failed() -- and the state itself is held next
         door, where rule 6 of scripts/ops-registry-filters.test.mjs turns red
         on it naming the window. This oracle is about the headline, and it is
         the state oracle's job to say which box is on screen. */
      const head = livePanel(dom).querySelectorAll('.kpi-label')[0];
      assert.ok(head,
        'the bar offers ' + window + ' and the pane drew no period headline at all, so there '
        + 'is nothing naming the window above the figures');

      const named = String(head.textContent || '').trim();
      assert.ok(!/^\d+ \w+ \d{4} to \d+ \w+ \d{4}$/.test(named),
        'the bar offers ' + window + ' and the pane has no name for it, so the headline falls '
        + 'back to describing the period in dates under a control that named it: ' + named);
      assert.notEqual(named, 'This period',
        'the bar offers ' + window + ' and the pane has no name for it and the answer carried '
        + 'no dates either, so the headline is the anonymous fallback: ' + named);

      /* And it is THIS window's name. The expectation comes from the registry
         -- the thing the operator actually clicked -- not from the pane's own
         table, which is the map under test. Prefix rather than equality
         because the pane may say more ('This month to date' for 'This
         month'); it may not START with something else. What comes after the
         registry's name is not bound -- see the docblock above the test. */
      const offered = String(registryRanges()[window] || '');
      assert.ok(offered,
        'the registry offers spend the window ' + window + ' and has no label for it, so the '
        + 'bar draws a control with no name on it');
      assert.ok(named.startsWith(offered),
        'the operator picked "' + offered + '" and the figures are headed "' + named + '". A '
        + 'headline naming a different window than the control that produced it puts one '
        + 'period\'s money under another period\'s name.');
    }
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

test('the approved unusual-costs card is acknowledged as not answerable yet', async () => {
  const dom = await boot({});
  const text = liveText(dom);

  assert.match(text, /What this pane cannot answer yet/,
    'the cannot-answer band is not on the pane');
  assert.match(text, /Anything unusual/,
    'the approved unusual-costs card is still silent');
  assert.match(text, /Problems watches unusual service spend with the service_cost_anomaly rule/,
    'the unusual-costs cause does not point at the live Problems rule');
  assert.match(text, /This pane draws the cost breakdown, but it does not draw the anomaly list yet\./,
    'the unusual-costs cause does not state the pane gap');

  const problemsLink = linkNamed(livePanel(dom), 'Problems');
  assert.ok(problemsLink, 'the unusual-costs cause does not link to the Problems pane');
  assert.equal(problemsLink.getAttribute('href'), 'alerts.html');
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
  const row = byClass(livePanel(dom), 'sp-xaxis-row')[0];
  assert.ok(row, 'the strip sits in the row that carries the drawing\'s own gutter');
  assert.ok(findAll(row, (n) => n === axis).length === 1, 'and the dates are inside it');

  /* In that order. The empty cell reserves the width of the money scale, so
     the strip after it starts where the drawing's plot starts. Swap the two
     and the strip is still exactly as wide as the plot -- every width
     assertion below still holds -- but it starts a whole gutter plus gap to
     the left of it, and every date is 66.0px off its day at 1440px, 60.0px
     at 320px, measured in Chrome. Membership is not order. */
  const cells = row.children;
  assert.equal(cells.length, 2, 'the row is the reserved cell and the strip, nothing else');
  assert.match(cells[0].getAttribute('class') || '', /\bsp-xaxis-gutter\b/,
    'the reserved cell comes first, or the strip does not start where the plot starts');
  assert.equal(cells[1], axis, 'and the dates are the cell after it');

  assert.equal(row.getAttribute('aria-hidden'), 'true',
    'and it is hidden from the reader, because the chart\'s own name already carries the dates');

  /* In the card body, beside the drawing's own box, and AFTER it.

     Every date stays over its own day however this row is re-parented -- the
     horizontal story is untouched -- so nothing else in this file notices,
     and neither does Chrome's placement sweep: `body.insertBefore(axis,
     plot.node)` moves the axis above the chart and `plot.node.appendChild(
     axis)` drops it INSIDE the drawing's box, overlapping the plot by more
     than its own width, and both are green everywhere but here.

     The box is named, not followed. Round 9 broke the first version of this,
     which took `row.parentNode` as the box and therefore travelled with the
     row: the assertion moved with the mutation, which is the defect it exists
     to catch wearing the assertion's own clothes. */
  const box = row.parentNode;
  assert.match(box.getAttribute('class') || '', /\bcard-body\b/,
    'the strip is printed in the card body, not inside the drawing it labels');
  const drawing = findAll(box, (n) => n.getAttribute && n.getAttribute('role') === 'img')[0];
  assert.ok(drawing, 'the drawing is in that same box');
  const wrap = drawing.parentNode;
  assert.equal(wrap.parentNode, box,
    'the drawing\'s box is a child of the card body, beside the strip, not somewhere else');
  const order = (node) => box.childNodes.indexOf(node);
  assert.ok(order(wrap) >= 0 && order(row) > order(wrap),
    'the dates are printed under the drawing they label, not over it');
});

/* --------------------------------------------- the dates under the drawing

   Stadiora/Aria#10507: every date after the first was drawn over a day it
   does not name.

   The route strides its labels -- every Nth day, never every day -- and sends
   them as bare formatted dates. So a label's position is not its place in the
   list: over three months the six dates name days 0, 15, 30, 45, 60 and 75 of
   89, and the last of them belongs 84.6% of the way across rather than at the
   right-hand end. The strip was a `justify-content: space-between` row, which
   put it at 100%: 14.3% of the plot away from its own day, measured in Chrome
   at 1440px before this change and 0.01% after.

   Why the assertions below are not circular. WHICH DAY a label names is taken
   from the route's own striding rule, re-derived in the fixture port at the
   head of this file and never read back off the pane. WHERE THAT DAY IS DRAWN
   is read out of the `d` attribute of the path the chart drew, which is the
   geometry a reader actually sees. The percentage the pane writes on each
   date is then compared against that drawn x, and against the closed form
   stated below, which is written here rather than imported from the pane.

   NOT COVERED here, and deliberately: that the strip's box is the same box as
   the drawing. Nothing in this file lays anything out. That half is CSS --
   one width shared by the money gutter and the empty cell under it, one gap
   shared by the two rows -- and it is asserted from the stylesheet further
   down this file and measured in headless Chrome for the pull request. */

const PLOT = { width: 640, padLeft: 6, padRight: 6 };

/* Where a day index is drawn across the plot, in the drawing's own viewBox
   units. Stated from the drawing's geometry rather than imported from the
   pane: an expectation computed by the code under test moves with the
   mutation and proves nothing. */
function plotX(index, span) {
  const inner = PLOT.width - PLOT.padLeft - PLOT.padRight;
  return PLOT.padLeft + (span > 1 ? (index / (span - 1)) * inner : inner / 2);
}

/* The points the chart actually drew, in viewBox units, read off the path. */
function drawnPoints(dom, seriesLabel) {
  const group = findAll(livePanel(dom), (n) => n.getAttribute
    && n.getAttribute('data-series') === seriesLabel)[0];
  assert.ok(group, 'the chart drew a group for ' + seriesLabel);
  const points = [];
  findAll(group, (n) => n.tagName && n.tagName.toLowerCase() === 'path').forEach((path) => {
    const d = path.getAttribute('d') || '';
    const matches = d.match(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g) || [];
    matches.forEach((one) => {
      points.push(Number(/[ML]\s*(-?[\d.]+)/.exec(one)[1]));
    });
  });
  return points;
}

/* What the pane wrote on each date, unit and all.

   The unit is not decoration: `left: 84.567` is not a length, so a browser
   drops the whole declaration and the date falls back into static flow --
   the defect of #10507, arrived at by deleting three characters. So the raw
   string is kept and checked against the one shape a percentage can take
   BEFORE anything parses it. Normalising the value first threw that away:
   `Number('84.567%')` and `Number('84.567')` are the same number, so the
   suite caught the WRONG unit (`Number('84.567px')` is NaN) and not the
   MISSING one, which is the likelier mistake. */
const PERCENT = /^-?\d+(?:\.\d+)?%$/;

function placedAt(dom, expecting) {
  const strip = byClass(livePanel(dom), 'sp-xaxis')[0];
  assert.ok(strip, 'the date strip is on the page');
  const isLoose = /\bsp-xaxis-loose\b/.test(strip.getAttribute('class') || '');

  /* The positioned strip and the unpositioned fallback are the SAME element
     with a different class, and `.sp-xaxis-loose span` sets `position:
     static; transform: none` at equal specificity and later in the sheet. So
     a strip carrying both classes keeps every `left` this function reads --
     every percentage below stays true -- and the browser ignores all of
     them: measured 61.48% of the plot at 1440px, 75.99% at 320px, which is
     worse than the defect #10507 was. Positioned or loose, never both. */
  assert.equal(isLoose, expecting === 'loose',
    expecting === 'loose'
      ? 'the strip that claims no position says so in its class'
      : 'the strip that carries positions is not also the one that says it has none');

  return findAll(strip, (n) => n.tagName && n.tagName.toLowerCase() === 'span')
    .map((cell) => {
      const left = cell.style && cell.style.left;
      const text = String(cell.textContent || '').trim();
      if (left === undefined) return { text, raw: null, left: null };
      assert.match(String(left), PERCENT,
        'the position written on ' + text + ' is a percentage, unit included -- '
        + 'a bare number is not a length and a browser drops the declaration');
      return { text, raw: String(left), left: Number(String(left).replace('%', '')) };
    });
}

test('each date is drawn over the day it names, not over its own place in the list',
  async () => {
    /* Three months: 89 days billed, strided to six dates, and the stride does
       not divide the window. So the dates are NOT evenly spread across the
       plot -- five steps of 15 days and a tail of 13 unlabelled days -- which
       is the shape `space-between` gets wrong and an evenly spaced fixture
       would hide. */
    const data = payload({ range: '3m' });
    const sent = data.daily.labels.filter(Boolean);
    const span = Math.max(...data.daily.series.map((one) => one.values.length));
    const stride = Math.max(1, Math.ceil(data.period.billedDays / MAX_DAILY_LABELS));
    assert.equal(sent.length, 6, 'six dates, which is what the route strides down to');
    assert.equal(span, 89);
    assert.equal(stride, 15);
    assert.ok((span - 1) % stride !== 0,
      'the last date is short of the last day, or this fixture cannot fail the old way');

    const dom = await boot({ costs: data });
    const placed = placedAt(dom);
    const points = drawnPoints(dom, data.daily.series[0].label);
    assert.equal(placed.length, sent.length, 'every date the route sent is drawn');

    const errors = placed.map((cell, i) => {
      const dayIndex = i * stride;          // the route's own rule, not the pane's
      const drawn = points[dayIndex];       // where the chart put that day
      const stated = plotX(dayIndex, span);
      assert.ok(typeof drawn === 'number', 'the chart drew day ' + dayIndex);
      /* The path is written to two decimal places, so the drawing can differ
         from the stated geometry by half of that and no more. Anything larger
         means the two have parted company and every figure below is moot. */
      assert.ok(Math.abs(drawn - stated) <= 0.005,
        'the drawing and the stated geometry agree about day ' + dayIndex
        + ': drawn ' + drawn + ', stated ' + stated.toFixed(4));
      assert.equal(cell.text, sent[i], 'in the order the route sent them');
      assert.ok(cell.left !== null, 'date ' + cell.text + ' carries a position');
      return {
        text: cell.text,
        dayIndex,
        wanted: (stated / PLOT.width) * 100,
        got: cell.left,
        off: Math.abs(cell.left - (stated / PLOT.width) * 100),
      };
    });

    const worst = Math.max(...errors.map((one) => one.off));
    assert.ok(worst < 0.002,
      'every date sits on its own day, within the rounding the percentage is written to. '
      + 'Worst: ' + JSON.stringify(errors.find((one) => one.off === worst)));

    /* The one the old layout could not get right: the last date names day 75
       of 89 and belongs at 84.6% of the drawing, not at its right-hand end. */
    const last = errors[errors.length - 1];
    assert.equal(last.dayIndex, 75, 'the last date names day 75');
    assert.equal(last.got.toFixed(1), '84.6', 'and is drawn at 84.6% of the drawing');
    assert.ok(last.got < 95, 'a date at the right-hand end is the defect in #10507');
  });

/* The other half of the mapping, and until now the half held up by a
   comment. Every position above is a viewBox x divided by the drawing's own
   viewBox width and written as a percentage of the STRIP. That is a page
   position only because of two attributes on the <svg>:

     preserveAspectRatio="none"   stretches the drawing to its box on each
                                  axis independently. Take it away and the
                                  svg letterboxes to the default
                                  `xMidYMid meet`: the drawing shrinks inside
                                  its box, every date stays where the CSSOM
                                  put it, and the pane draws #10507 again
                                  from the other side -- 20.80% of the plot at 1440px at 1440px,
                                  with every other check in this repository
                                  green.
     viewBox="0 0 640 ..."        is the scale those x values are in. Widen
                                  it alone -- room on the right for a legend,
                                  say -- and the divisor and the drawing
                                  disagree by a constant ratio: 7.39% of the plot, at 1440px and at 320px alike, the
                                  same at every width, again all green.

   Both are asserted on the rendered element rather than on the source text,
   and the viewBox width is checked against PLOT.width -- the number stated
   at the top of this section from the drawing's geometry, not imported from
   the pane -- so the two halves of the mapping have to agree with one
   independently written constant rather than with each other. */
test('the drawing is stretched to its box, in the scale the dates are placed in',
  async () => {
    const data = payload({ range: '3m' });
    const dom = await boot({ costs: data });
    const charts = findAll(livePanel(dom), (n) => n.getAttribute
      && n.getAttribute('role') === 'img');
    assert.equal(charts.length, 1, 'one drawing on the page');
    const svg = charts[0];

    assert.equal(svg.getAttribute('preserveAspectRatio'), 'none',
      'the drawing is stretched to its box on both axes. Without it the svg letterboxes '
      + 'to xMidYMid meet, the drawing is narrower than the box the dates are '
      + 'percentages of, and every date stands 20.80% of the plot at 1440px from its day');

    const box = String(svg.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
    assert.equal(box.length, 4, 'the drawing has a viewBox');
    assert.equal(box[0], 0, 'that starts at x 0, which is what makes an x a fraction of it');
    assert.equal(box[2], PLOT.width,
      'and is ' + PLOT.width + ' units wide -- the width every position below is a '
      + 'fraction of. Widen the viewBox alone and every date moves 7.39% of the plot, at 1440px and at 320px alike at every '
      + 'width, because the divisor and the drawing disagree by a constant ratio');

    /* And the percentages the pane wrote are percentages of THAT width: the
       contract the two attributes exist to serve, stated here in one place. */
    const span = Math.max(...data.daily.series.map((one) => one.values.length));
    const stride = Math.max(1, Math.ceil(data.period.billedDays / MAX_DAILY_LABELS));
    placedAt(dom).forEach((cell, i) => {
      const wanted = (plotX(i * stride, span) / box[2]) * 100;
      assert.ok(Math.abs(cell.left - wanted) < 0.002,
        cell.text + ' is written at ' + cell.left + '% of the strip, and day '
        + (i * stride) + ' is at ' + wanted.toFixed(3) + '% of the viewBox');
    });
  });

/* The edge the fix decided NOT to clamp, pinned here so the decision is a
   measurement rather than a claim.

   A strided route reaches the last day whenever (billedDays - 1) is a
   multiple of the stride. `last-month` on a 31-day month does it: 31 days,
   stride 6, six dates, the last naming day 30 of 31. Centred on its day, that
   date is written at 99.063% of the strip and half of its box hangs past the
   right-hand end of the drawing. Measured in Chrome on that fixture, on this
   head:

     width    past the plot's right edge    clearance to the card's inner edge
     1440px            7.34px                          8.66px
      768px           11.17px                          4.83px
      375px           13.34px                          2.66px
      320px           13.86px                          2.14px

   Nothing is clipped and the page never scrolls sideways (documentElement
   scrollWidth - clientWidth is 0 at all four widths), because the card's own
   padding absorbs the overhang -- with 2.14px to spare at the narrowest
   width the shell supports. Clamping the last date back inside the plot
   would buy those pixels by drawing the date somewhere other than over its
   day, which is exactly the defect #10507 reported. So it is not clamped,
   and this test fails if anybody clamps it without re-measuring the
   clearance above. */
test('a date that names the last day of the window is written over it, not pulled back',
  async () => {
    const data = payload({ range: 'last-month', billedThrough: 31 });
    const span = Math.max(...data.daily.series.map((one) => one.values.length));
    const stride = Math.max(1, Math.ceil(data.period.billedDays / MAX_DAILY_LABELS));
    assert.equal(span, 31, 'a 31-day window');
    assert.equal(stride, 6, 'strided to six dates');
    assert.equal((span - 1) % stride, 0,
      'so the last date names the last day -- the case the 3m fixture cannot reach');

    const dom = await boot({ costs: data });
    const placed = placedAt(dom);
    const last = placed[placed.length - 1];
    assert.equal(last.text, 'Aug 31', 'the last date names the last day of the window');
    assert.equal(last.raw, ((plotX(span - 1, span) / PLOT.width) * 100).toFixed(3) + '%',
      'and is written over that day, at the plot\'s right-hand end, not pulled back '
      + 'inside it. Half of its box hangs over the end of the drawing by 7.34px at '
      + '1440px and 13.86px at 320px, measured in Chrome, and the card\'s padding '
      + 'absorbs it with 2.14px to spare at the narrowest width. Clamping it would put '
      + 'the date somewhere other than over its day, which is #10507');
    assert.equal(last.raw, '99.063%', 'stated outright, so the number is in the file');
  });

/* The other way this formatter can be wrong, and the only one that does not
   announce itself. A date the pane cannot recognise at all falls into the
   unpositioned strip, loudly. A date it recognises as the WRONG DAY keeps
   every position and is quietly one day out -- which is #10507 again, in
   miniature and permanently.

   That is what dropping `timeZone: 'UTC'` from `dayNamer()` does. The route
   spells its dates in UTC; a reader west of UTC spells the same instant as
   the day before, so every label matches one index late. It is invisible to
   a suite that runs where the two spellings agree, and CI runs on
   `ubuntu-latest`, which is UTC. Measured in Chrome at UTC-4 with the option
   removed: the strip does NOT fall back, and every date stands one day off
   its day -- 0.908% of the plot on a 109-day window, 2.336% on 43 days,
   16.7% on a week, because the error is 1/(span-1) and grows as the window
   shortens.

   So this test moves the reader instead of trusting the runner: it renders
   the pane where the two spellings disagree. Node re-reads `process.env.TZ`
   for each new formatter, so the zone below applies to the pane's own
   `Intl.DateTimeFormat` and to nothing in the fixture, which pins UTC
   exactly as the route does. */
test('a date is matched to its day in UTC, wherever the reader is', async () => {
  const was = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    assert.equal(new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short' })
      .format(Date.UTC(2026, 8, 6, 0, 0, 0)), 'Sep 5',
    'the zone really did change: a UTC midnight is the day before here, which is the '
      + 'disagreement this test needs to exist');

    const data = payload({ range: '3m' });
    const sent = data.daily.labels.filter(Boolean);
    const span = Math.max(...data.daily.series.map((one) => one.values.length));
    const stride = Math.max(1, Math.ceil(data.period.billedDays / MAX_DAILY_LABELS));

    const dom = await boot({ costs: data });
    const placed = placedAt(dom);
    assert.equal(placed.length, sent.length, 'every date the route sent is still drawn');

    placed.forEach((cell, i) => {
      const dayIndex = i * stride;
      const wanted = (plotX(dayIndex, span) / PLOT.width) * 100;
      assert.ok(cell.left !== null,
        'date ' + cell.text + ' carries a position west of UTC too');
      assert.ok(Math.abs(cell.left - wanted) < 0.002,
        'date ' + cell.text + ' names day ' + dayIndex + ' and belongs at '
        + wanted.toFixed(3) + '% of the drawing, but is at ' + cell.left + '%. A reader '
        + 'west of UTC spells the route\'s own dates a day early, so a formatter without '
        + '`timeZone: \'UTC\'` matches every date to the day after the one it names');
    });
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
});

test('dates the route spaced unevenly are placed unevenly, one per day named', async () => {
  /* A shape the route does not send today: its stride is uniform, so the
     dates it sends are a constant number of days apart. This fixture names
     days 0, 1, 7 and 29 of the same window to show that what places a date is
     the day it names and nothing else -- not the stride, not its place in the
     list, not an even share of the width. The route-shaped proof is the test
     above; this one is the rule underneath it. */
  const data = payload({ range: 'last-month' });
  const span = Math.max(...data.daily.series.map((one) => one.values.length));
  const dayNames = new Intl.DateTimeFormat('en-US', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  });
  const named = [0, 1, 7, 29];
  assert.ok(named[named.length - 1] < span, 'every day named is inside the window');
  data.daily.labels = named.map((offset) =>
    dayNames.format(dayStart(addDays(data.period.start, offset))));

  const dom = await boot({ costs: data });
  const placed = placedAt(dom);
  assert.equal(placed.length, named.length);
  placed.forEach((cell, i) => {
    assert.equal(cell.left.toFixed(3),
      ((plotX(named[i], span) / PLOT.width) * 100).toFixed(3),
      cell.text + ' sits on day ' + named[i]);
  });

  const steps = placed.slice(1).map((cell, i) => cell.left - placed[i].left);
  assert.ok(new Set(steps.map((one) => one.toFixed(2))).size === steps.length,
    'no two gaps are equal, which is what an evenly spread row would produce');
});

test('a date the pane cannot match to a day is not placed as though it could be',
  async () => {
    /* The route changing how it formats a date, or an answer with no window
       start, leaves the pane unable to say which day any date names. It then
       draws them as a plain list claiming no position, rather than spreading
       them over days they were not measured on -- which is exactly the defect
       in #10507, arrived at by a different road. */
    const data = payload({ range: 'last-month' });
    data.daily.labels = data.daily.labels.map((one, i) => 'Week ' + (i + 1));

    const dom = await boot({ costs: data });
    const strip = byClass(livePanel(dom), 'sp-xaxis')[0];
    assert.ok(strip, 'the dates are still on the page');
    assert.match(strip.getAttribute('class'), /\bsp-xaxis-loose\b/,
      'in the shape that claims no position');
    assert.deepEqual(runs(strip), data.daily.labels,
      'and none of them is dropped');
    placedAt(dom, 'loose').forEach((cell) => {
      assert.equal(cell.left, null, cell.text + ' is not positioned');
    });
  });

test('a window with no start leaves the dates unplaced rather than placed by guess',
  async () => {
    const data = payload({ range: 'last-month' });
    delete data.period.start;

    const dom = await boot({ costs: data });
    const strip = byClass(livePanel(dom), 'sp-xaxis')[0];
    assert.match(strip.getAttribute('class'), /\bsp-xaxis-loose\b/);
    placedAt(dom, 'loose').forEach((cell) => assert.equal(cell.left, null));
  });

test('the narrow layout drops every other date to a line of its own, clear of the first',
  () => {
    /* At 320px six dates at 9.5px do not fit side by side: measured in Chrome
       on a twelve-month period, the closest pair overlaps by 0.74px. Every
       other date therefore drops to a second line, rather than some of them
       being dropped altogether -- which days the route chose to label is its
       statement about the series.

       The drop has to clear the line box it came from or the two lines still
       touch: measured at 9.5px the line box is 14.25px, so 1.5em, and an
       earlier 1.35em stagger left the boxes overlapping by 1.4px while the
       text looked separated. The strip then has to be tall enough for both
       lines or the second one paints over whatever follows it. */
    const LINE_BOX_EM = 1.5;   // 14.25px at 9.5px, measured in Chrome
    const narrow = RULES.filter((r) => r.media && /max-width:\s*420px/.test(r.media));
    assert.ok(narrow.length > 0, 'the stylesheet has a narrow layout');

    const stagger = narrow.filter((r) => r.targets(/nth-child\(even\)/))[0];
    assert.ok(stagger, 'every other date is offset at this width');
    const top = /(?:^|[;{\s])top:\s*([\d.]+)em/.exec(stagger.body);
    assert.ok(top, 'offset in em, so it follows the font size rather than a fixed pixel guess');
    assert.ok(Number(top[1]) >= LINE_BOX_EM,
      'a date dropped ' + top[1] + 'em still sits inside the ' + LINE_BOX_EM
      + 'em line box of the one before it');

    const strip = narrow.filter((r) => r.targets(/^\s*\.sp-xaxis$/))[0];
    assert.ok(strip, 'the strip is restyled at this width');
    const min = /(?:^|[;{\s])min-height:\s*([\d.]+)em/.exec(strip.body);
    assert.ok(min, 'and given a height');
    assert.ok(Number(min[1]) >= Number(top[1]) + LINE_BOX_EM,
      'the strip is ' + min[1] + 'em tall, which does not hold a second line at '
      + top[1] + 'em');
  });

/* ------------------------------------------ what a date's position rests on

   Everything from here to the end of this block is about the same question:
   the pane writes a correct percentage onto every date, so what else has to
   be true for that percentage to put the date over its day?

   The answer is a small, closed set of declarations in this stylesheet. This
   file cannot lay out -- the harness has no layout at all -- so it cannot
   check the pixels. What it can do is refuse to let that set change without
   somebody measuring the change in a browser.

   Three ways of writing this guard have now been broken by review, each
   with the suite green:

     "is the declaration present"   a declaration does not have to be deleted
                                    to stop applying. Appending `.sp-xaxis
                                    { position: static }`, or adding it to
                                    the 420px rule, reinstates #10507 at
                                    7.9% of the plot at 1440px and 39.07% at
                                    320px -- the same pixels as deleting
                                    `position: relative` outright, which was
                                    caught.
     "do all the rules agree"       agreeing about five NAMED properties says
                                    nothing about a sixth. `margin-left: 24px`
                                    on a date moves it 24px (12.24% at 320px);
                                    `flex-direction: row-reverse` or
                                    `direction: rtl` on the row moves every
                                    date 30.62% at 320px, which is the same
                                    geometry as swapping the row's two cells,
                                    a swap this file DOES catch; `flex-grow: 0`
                                    on the strip beats `flex: 1` (83.97%);
                                    `translate: 50%` on a date beats
                                    `transform` (8.26%). All five were green.
     "the subject is the last      a selector does not have to NAME an element
      compound"                     to land on it. `.sp-xaxis-row span` is a
                                    date, `.sp-xaxis > *` is a date, and
                                    `.sp-xaxis-row > div:last-child` is the
                                    strip -- the last compound of all three is
                                    a bare type or universal selector, so a
                                    matcher keyed on it saw none of them. The
                                    first two move every date 12.48% at 320px
                                    and the third renders no date at all; all
                                    three were green.
     the whole thing                still cannot see a browser. What it can
                                    be is CLOSED on BOTH axes: which rules
                                    reach these elements, and what those rules
                                    are allowed to say.

   So there are two guards below, and they are closed worlds rather than
   checklists. The first: a rule whose selector NAMES any of these elements
   must be one of the ten selectors measured here -- a spelling nobody has
   measured is a failure, whatever it says. The second: a declaration those
   rules give must be one named here with the figure a browser produced when
   it changed -- a property nobody has measured is a failure, whatever its
   value. What escapes both, and cannot be closed by any scan of this file,
   is a rule that reaches these elements WITHOUT naming them
   (`.card div { margin-left: 24px }`). That is in the PR's NOT COVERED list.

   The ten selectors, and the element each one is. Keyed on the exact text
   because that is the point: `.sp-xaxis span` is measured and
   `.sp-xaxis > *` is not, though they hit the same element. */
const MEASURED_SELECTORS = new Map([
  ['.sp-xaxis-row', 'the row'],
  ['.sp-xaxis', 'the strip'],
  ['.sp-xaxis span', 'a date'],
  ['.sp-xaxis span:nth-child(even)', 'a date'],
  ['.sp-xaxis-loose', 'the unpositioned fallback'],
  ['.sp-xaxis-loose span', 'a date of the fallback'],
  ['.sp-chart-wrap', 'the drawing\'s own row'],
  ['.sp-chart-wrap .chart', 'the drawing'],
  ['.sp-axis', 'the money gutter'],
  ['.sp-xaxis-gutter', 'the cell under the money gutter'],
]);

/* A class token of the strip's own family, anywhere in a selector -- not
   only in its last compound. `.sp-xaxis-row` is not a mention of `sp-xaxis`,
   which is what the trailing guard is for. */
const NAMES_THE_STRIP = new RegExp('(^|[^-\\w])\\.(?:'
  + ['sp-xaxis-row', 'sp-xaxis-loose', 'sp-xaxis-gutter', 'sp-xaxis',
    'sp-chart-wrap', 'sp-axis'].join('|')
  + ')(?![-\\w])');

const oneLine = (selector) => selector.trim().replace(/\s+/g, ' ');

/* Both closed worlds below read this stylesheet as TEXT: the selector map
   matches the literal characters of a selector, and the declaration allowlist
   reads a rule's body as a flat list of `property: value`. Five ordinary CSS
   spellings make that reading wrong rather than incomplete, and every one of
   them ships a visibly broken strip green:

     nesting     `.sp-xaxis { & span { position: static } }` is one rule whose
                 body is not declarations. The property name comes out as
                 `& span { position`, fails the name pattern, and is dropped --
                 and a property that disappears from that map is a property
                 every check below reads as agreeing. Measured: 69.86% of the
                 plot with every pair of dates touching (0.00px apart), 68/0
                 green -- the same displacement to the digit as the flat
                 spelling of the same declaration, which is RED.
     escapes     `.sp\-xaxis` and `.sp-\78 axis` are the same class to a
                 browser as `.sp-xaxis` and are different strings to a regex.
                 Measured: 39.07% at 320px and 7.90% at 1440px, 68/0 green --
                 again the same figures as the unescaped spelling, which is RED.
     escaped     `.sp-xaxis span { posi\74 ion: static }` is `position` to a
     properties  browser and fails the property-name pattern here, so it is
                 dropped from the map with the same consequence. Measured:
                 69.86% of the plot at 1440px and 7.22% at 320px, with every pair of dates touching (0.00px apart), against an unescaped control that is RED at the
                 same anchor with the same figure.
     attribute   `[class~="sp-xaxis"] span` selects exactly the elements
     selectors   `.sp-xaxis span` selects, names the class in its own text,
                 and does not start with a dot -- so the selector map never
                 sees it. Measured: 69.86% of the plot at 1440px and 7.22% at 320px, every pair of dates touching, against `.sp-xaxis span` at the
                 same anchor, which is RED with the same figure.
     strings     a `content` value holding an open-comment delimiter is a
                 string to a browser and the start of a comment to the
                 stripper at the top of this file. Every rule between it and
                 the next close-comment delimiter inside a string vanishes
                 from RULES, so all of these checks sweep a stylesheet the
                 browser is not using. Measured: 69.86% of the plot at 1440px and 7.22% at 320px, and the two
                 sentinel rules are the whole difference between that and a
                 RED suite.

   None of them is closed by reading harder -- reading harder is what has been
   broken five times. They are closed by refusing the five shapes outright,
   which costs nothing because this sheet uses none of them: a nested block,
   an escape, an attribute selector other than the one measured, or a string
   is a shape this file cannot read, so it fails until somebody teaches it to,
   and the failure says so. */
test('this stylesheet is in a shape the two closed worlds can actually read', () => {
  const NESTED = (rule) => /\{/.test(rule.body);
  const ESCAPED = (text) => /\\/.test(text);
  const ATTRS = (text) => text.match(/\[[^\]]*\]/g) || [];
  /* The one attribute selector this sheet uses, and the only one the
     selector map has been measured against. */
  const MEASURED_ATTRIBUTE = '[scope="row"]';

  /* Positive controls: the refusals must see the real payloads, in the real
     shape they arrive in, or they are five more assertions that pass on
     nothing. */
  assert.ok(NESTED({ body: ' & span { position: static; } ' }), 'a nested block with `&`');
  assert.ok(NESTED({ body: ' span { position: static; } ' }), 'a nested block without `&`');
  assert.ok(!NESTED({ body: ' position: relative; flex: 1; ' }), 'and a flat body is not one');
  assert.ok(ESCAPED('.sp\\-xaxis'), 'a backslash escape');
  assert.ok(ESCAPED('.sp-\\78 axis'), 'a hex escape');
  assert.ok(ESCAPED(' posi\\74 ion: static; '), 'an escape in a property name, not a selector');
  assert.ok(!ESCAPED('.sp-xaxis span'), 'and an ordinary selector is neither');
  assert.deepEqual(ATTRS('[class~="sp-xaxis"] span'), ['[class~="sp-xaxis"]'],
    'an attribute selector on the class');
  assert.deepEqual(ATTRS('.sp-xaxis-row[aria-hidden="true"] span'),
    ['[aria-hidden="true"]'], 'and on any other attribute the pane sets');
  assert.deepEqual(ATTRS('.sp-xaxis span'), [], 'and an ordinary selector has none');
  assert.equal(declarations(' posi\\74 ion: static; ').dropped.length, 1,
    'a property name this scan cannot read is kept, not dropped in silence');
  assert.equal(declarations(' position: static; ').dropped.length, 0,
    'and one it can read is not');

  RULES.forEach((rule) => {
    const where = ' in ' + (rule.media || 'the base sheet');
    assert.ok(!NESTED(rule),
      '`' + rule.selectors.join(', ') + '`' + where
      + ' has a nested block in its body. Every check in this file reads a rule body as a '
      + 'flat list of declarations, so a nested one is not read as anything at all: '
      + '`.sp-xaxis { & span { position: static } }` put every date 69.86% of the plot '
      + 'from its day with every pair touching, and was 68 pass / 0 fail. Flatten it, or '
      + 'teach `declarations()` about braces first and prove it with a mutation');
    assert.ok(!ESCAPED(rule.body),
      '`' + rule.selectors.join(', ') + '`' + where + ' has a CSS escape in its body. A '
      + 'property name is an identifier, so a browser reads `posi\\74 ion` as `position` '
      + 'while the name pattern in `declarations()` drops it -- and a property dropped '
      + 'there is a property every check below reads as agreeing: `.sp-xaxis span '
      + '{ posi\\74 ion: static }` moved every date 69.86% of the plot at 1440px and 7.22% '
      + 'at 320px, with every pair of dates touching (0.00px apart), while the selector '
      + 'map and the declaration allowlist below both read this stylesheet as agreeing. '
      + 'Spell it plainly');
    assert.deepEqual(declarations(rule.body).dropped, [],
      '`' + rule.selectors.join(', ') + '`' + where + ' has a property name this file '
      + 'cannot read. It is not treated as absent, because absent is exactly how a '
      + 'defect gets through here: every check below would read this rule as agreeing '
      + 'with whatever it is asked. Spell the property plainly, or teach the scan the '
      + 'shape and prove it with a mutation');
    rule.selectors.forEach((selector) => {
      assert.ok(!ESCAPED(selector),
        '`' + selector.trim() + '`' + where + ' spells a '
        + 'class with a CSS escape. The selector map matches literal text, so an escaped '
        + 'name is a different string and the same element: `.sp\\-xaxis { position: '
        + 'static }` moved every date 39.07% of the plot at 320px, and was 68 pass / 0 '
        + 'fail. Spell it plainly');
      ATTRS(selector).forEach((attribute) => {
        assert.equal(attribute, MEASURED_ATTRIBUTE,
          '`' + oneLine(selector) + '`' + where + ' selects on an attribute. An '
          + 'attribute selector reaches an element without spelling it the way the '
          + 'selector map reads -- `[class~="sp-xaxis"] span` is the same subject as '
          + '`.sp-xaxis span`, names the class in its own text, and starts with `[` '
          + 'rather than `.`, so nothing here sees it: it moved every date '
          + '69.86% of the plot at 1440px and 7.22% at 320px with every pair of dates '
          + 'touching, the same figures to the digit as the dot-spelled control at the '
          + 'same anchor, which is RED. '
          + '`[aria-hidden="true"]` reaches the same row, because the pane sets that '
          + 'attribute on it. Spell the subject as a class');
      });
    });
  });

  /* And no string anywhere, because a string can carry a comment delimiter
     past the stripper at the top of this file and hide the rules behind it
     from every check here. Read on the stripped source, so what is asserted
     is what the rest of this file actually parsed. */
  const outsideMeasured = STRIPPED.split(MEASURED_ATTRIBUTE).join('');
  assert.equal(outsideMeasured.match(/["']/g), null,
    'this stylesheet has a string literal in it, outside the one measured attribute '
    + 'selector. `content: "/*"` is a string to a browser and an open comment to the '
    + 'stripper `cssRules()` runs, so every rule between it and the next `*/` inside a '
    + 'string disappears from RULES while Chrome applies it: three rules spelled that '
    + 'way put every date 69.86% of the plot at 1440px and 7.22% at 320px, with the '
    + 'selector map and the declaration allowlist below both reading this stylesheet as '
    + 'agreeing, and the middle rule ON ITS OWN is RED with the identical figure -- the '
    + 'two sentinels are the whole difference. Take the string out, or make the stripper '
    + 'string-aware and prove it with a mutation');
  assert.ok(STRIPPED.includes(MEASURED_ATTRIBUTE),
    'and that one attribute selector is still here, or this check is asserting nothing');
});

test('every rule that names the date strip is one that has been measured', () => {
  const named = [];
  RULES.forEach((rule) => rule.selectors.forEach((raw) => {
    if (NAMES_THE_STRIP.test(oneLine(raw))) named.push({ rule, selector: oneLine(raw) });
  }));
  assert.ok(named.length >= MEASURED_SELECTORS.size,
    'the stylesheet still names these elements');

  named.forEach(({ rule, selector }) => {
    assert.ok(MEASURED_SELECTORS.has(selector),
      '`' + selector + '` in ' + (rule.media || 'the base sheet') + ' reaches the date '
      + 'strip by a spelling nobody has measured. A selector does not have to NAME an '
      + 'element to land on it, so this list is keyed on the exact text rather than on '
      + 'which element the text resolves to: `.sp-xaxis-row span { margin-left: 24px }` '
      + 'moves every date 12.48% of the plot at 320px, `.sp-xaxis > * { margin-left: '
      + '24px }` the same 12.48%, and `.sp-xaxis-row > div:last-child { display: none }` '
      + 'renders no date at all -- each of them green before this test existed, and the '
      + 'last compound of all three is a bare type or universal selector. Measure it in '
      + 'a browser and add it to MEASURED_SELECTORS with what it does, or spell the rule '
      + 'as one of the ten that are already there');
  });

  /* And every measured selector is really in the sheet, so the map cannot rot
     into a list of names for rules that no longer exist. */
  const present = new Set(named.map((one) => one.selector));
  MEASURED_SELECTORS.forEach((_role, selector) => {
    assert.ok(present.has(selector),
      '`' + selector + '` is measured here but no longer in the stylesheet');
  });
});

test('every declaration the date strip is given is one that has been measured', () => {
  /* Which rules are which element is decided by the map above, not by a
     rule about compounds -- the test before this one has already refused
     every spelling that is not in it, so there is nothing here to infer.
     `.sp-xaxis span` and `.sp-xaxis-loose span` both style a span; only the
     first styles a span of the positioned strip, and the map says so. */
  const subject = (role) => (rule) => rule.selectors
    .some((raw) => MEASURED_SELECTORS.get(oneLine(raw)) === role);

  const ANY = null;                       // measured as unable to move a date sideways

  /* Every declaration, keyed by the element it is given to. The regex is the
     value the declaration must have; ANY means the property cannot move a
     date across the plot whatever its value (a colour, a font size, a
     vertical offset). The sentence is what a browser measured when it
     changed. */
  const ALLOWED = [
    ['the row', subject('the row'), {
      display: [/^flex$/, 'the row is a flex row, so its first cell can reserve the '
        + 'scale column: without it -30.91% at 320px'],
      gap: [/^[\d.]+px$/, 'and puts the same gap after that cell as the drawing does, '
        + 'checked against the drawing\'s own below'],
      'margin-top': [ANY, 'vertical'],
    }],
    ['the strip', subject('the strip'), {
      position: [/^relative$/, 'the strip is what a percentage inside it resolves '
        + 'against: without it -39.07% at 320px'],
      flex: [/^1$/, 'and fills the rest of the row, which is what makes it the '
        + 'plot\'s width: without it -86.18%. Exactly `1`, because the shorthand '
        + 'carries a basis and a shrink factor too: `flex: 1 0 400px` keeps the grow '
        + 'term and stops the strip shrinking, which moves every date 51.16% of the plot at 375px and 89.70% at 320px, with 117px and 172px of horizontal page overflow '
        + 'with nothing in this repository red -- the three browser sweeps that visit '
        + 'a narrow width answer this pane with an unpublished period, so they never '
        + 'build the strip at all'],
      'min-width': [/^0$/, 'and may shrink below its content, or a long date would '
        + 'widen it past the plot'],
      'min-height': [/^[\d.]+em$/, 'and reserves its own height, because every date in '
        + 'it is out of flow: without it the row is 0px tall and the last date crosses '
        + 'the card edge. In em, so it follows the font size the same rule sets'],
      'font-size': [ANY, 'vertical and horizontal, but only of the text inside a box '
        + 'that is positioned independently of it'],
      color: [ANY, 'paint'],
    }],
    ['a date', subject('a date'), {
      position: [/^absolute$/, 'a date is placed by its own left, not by the date '
        + 'before it: without it -69.86%'],
      transform: [/^translateX\(-50%\)$/, 'and sits centred on its day rather than '
        + 'starting at it: without it +8.45% at 320px'],
      top: [ANY, 'vertical -- this is the narrow layout\'s stagger'],
      'white-space': [/^nowrap$/, 'and is one line, or a wrapped date is centred on '
        + 'its own second line'],
    }],
    ['the unpositioned fallback', subject('the unpositioned fallback'), {
      display: [/^flex$/, 'the fallback lays its dates out in a row'],
      'flex-wrap': [/^wrap$/, 'that wraps, because it has no width to spread over'],
      gap: [/^[\d.]+px\s+[\d.]+px$/, 'and separates one date from the next, which in '
        + 'that state nothing else does: h() appends its children with no whitespace '
        + 'between them, so without this the six dates render as one unbroken string'],
    }],
    ['a date of the fallback', subject('a date of the fallback'), {
      position: [/^static$/, 'a fallback date claims no position at all'],
      transform: [/^none$/, 'and is not centred on a day it was never matched to'],
    }],
    ['the drawing\'s own row', subject('the drawing\'s own row'), {
      display: [/^flex$/, 'the drawing sits in the same shape as the strip below it'],
      'align-items': [ANY, 'vertical'],
      gap: [/^[\d.]+px$/, 'with the gap the strip is checked against'],
    }],
    ['the drawing', subject('the drawing'), {
      flex: [/^1$/, 'the drawing takes the rest of its row exactly as the strip '
        + 'takes the rest of its own, which is what makes one plot two boxes wide the '
        + 'same. Move the drawing alone -- `.sp-chart-wrap .chart '
        + '{ margin-left: 20px }` -- and every date stays where it was while the day it '
        + 'names slides: 1.97% of the plot at 1440px, 11.48% at 320px. Exactly `1`, for '
        + 'the same reason the strip is: a basis in the shorthand stops the box '
        + 'shrinking and the two boxes stop being the same width'],
      'min-width': [/^0$/, 'and may shrink below its content, for the same reason'],
      height: [ANY, 'vertical'],
    }],
    ['the money gutter', subject('the money gutter'), {
      position: [/^relative$/, 'the money scale places its own labels inside this cell'],
      flex: [/^none$/, 'and is the width it is given rather than a share of the row, on '
        + 'both rows at once: let the cell under it grow alone -- `.sp-xaxis-gutter '
        + '{ flex: 1 }` -- and the strip starts somewhere the drawing does not: every date lands 47.68% of the plot from its day at '
        + '1440px and 37.08% at 320px'],
      width: [/^[\d.]+px$/, 'and is as wide as the cell under it, which is what lines '
        + 'the strip up with the drawing: checked as one declaration below'],
    }],
    ['the cell under the money gutter', subject('the cell under the money gutter'), {
      flex: [/^none$/, 'the empty cell is the width it is given, not a share: every date lands 47.68% of the plot from its day at '
        + '1440px and 37.08% at 320px'],
      width: [/^[\d.]+px$/, 'and that width is the money gutter\'s own, which is what '
        + 'lines the strip up with the drawing: checked as one declaration below'],
    }],
  ];

  ALLOWED.forEach(([name, matches, allowed]) => {
    const rules = RULES.filter(matches);
    assert.ok(rules.length > 0, 'the stylesheet styles ' + name);

    rules.forEach((rule) => {
      declarations(rule.body).forEach((value, property) => {
        const spec = allowed[property];
        assert.ok(spec, name + ' is given `' + property + ': ' + value + '` in '
          + (rule.media || 'the base sheet') + ', which nothing here has measured. '
          + 'A declaration this list does not name can move a date across the plot '
          + 'without touching any it does: margin-left moved every date 12.24% of the '
          + 'plot, flex-direction and direction 30.62%, flex-grow 83.97%, translate '
          + '8.26% -- all with this file green. Measure it in a browser and add it '
          + 'here with the figure, or take it out');
        if (spec[0]) {
          assert.match(value, spec[0], name + ' is given `' + property + ': ' + value
            + '` in ' + (rule.media || 'the base sheet') + ', and ' + spec[1]);
        }
      });
    });

    /* And the ones with a value are in the base sheet, so none of them is a
       thing that only holds at one width. */
    Object.keys(allowed).filter((property) => allowed[property][0]).forEach((property) => {
      assert.ok(rules.some((r) => !r.media && declarations(r.body).has(property)),
        name + ' has lost `' + property + '` from the base sheet, so ' + allowed[property][1]);
    });
  });
});

test('the date strip is laid out in the same box as the drawing it labels', () => {
  /* The percentages above are percentages OF THE STRIP. They are percentages
     of the plot only while the strip is the same width as the drawing, which
     is a fact about this stylesheet: both rows are flex rows with the same
     gap, and the money gutter and the empty cell under it take their width
     from one declaration. Split that declaration in two and every date moves
     by the difference, at every width, silently. */
  const widths = RULES.filter((r) => r.targets(/\.sp-xaxis-gutter\b/) && /width:/.test(r.body));
  assert.ok(widths.length >= 1, 'the cell under the money gutter has a width');
  widths.forEach((rule) => {
    assert.ok(rule.selectors.some((s) => /^\.sp-axis$/.test(s.trim())),
      'and it is the same declaration the money gutter itself takes its width from, '
      + 'in ' + (rule.media || 'the base sheet'));
  });

  /* Every width the money gutter is given is given to the cell under it. */
  const gutterWidths = RULES
    .filter((r) => r.targets(/\.sp-axis\b/) && /(^|[;{\s])width:/.test(r.body))
    .map((r) => ({ media: r.media, selectors: r.selectors.map((s) => s.trim()) }));
  gutterWidths.forEach((rule) => {
    assert.ok(rule.selectors.includes('.sp-xaxis-gutter'),
      'the scale column is sized alone in ' + (rule.media || 'the base sheet')
      + ', so the strip under it no longer starts where the drawing starts');
  });

  /* The gap, in every media context either row declares one -- the strip and
     the drawing must put the SAME gap after their gutter cell at every width,
     not only in the base sheet. Adding `.sp-chart-wrap { gap: 4px }` to the
     720px block drifts every date 4.0px from its day below that breakpoint,
     which the base-sheet-only version of this assertion could not see.

     Read as a COLUMN gap rather than as the `gap` shorthand: `column-gap`
     added later beats the shorthand without ever appearing under that key,
     and drifts every date 3.95px (1.98% of the plot). The allowlist above
     refuses `column-gap` on either row outright; this resolves whichever of
     the two spellings is there, so the two guards do not depend on each
     other. */
  const columnGap = (rule) => {
    const decls = declarations(rule.body);
    if (decls.has('column-gap')) return decls.get('column-gap').trim();
    if (!decls.has('gap')) return null;
    const parts = decls.get('gap').trim().split(/\s+/);
    return (parts.length > 1 ? parts[1] : parts[0]);
  };
  const gapsOf = (selector) => {
    const found = RULES.filter((r) => r.targets(selector))
      .map((r) => ({ media: r.media, gap: columnGap(r) }))
      .filter((one) => one.gap)
      .map((one) => [one.media || '', one.gap]);
    assert.ok(found.length > 0, selector + ' sets the gap between the gutter and what follows it');
    return new Map(found);
  };
  const rowGaps = gapsOf(/^\.sp-xaxis-row$/);
  const chartGaps = gapsOf(/^\.sp-chart-wrap$/);
  assert.ok(rowGaps.has('') && chartGaps.has(''),
    'both rows state their gap in the base sheet, or one of them inherits nothing');
  const contexts = new Set([...rowGaps.keys(), ...chartGaps.keys()]);
  contexts.forEach((media) => {
    assert.equal(rowGaps.get(media) || rowGaps.get(''), chartGaps.get(media) || chartGaps.get(''),
      'the strip and the drawing put the same gap after their gutter cell in '
      + (media || 'the base sheet'));
  });
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

/* ------------------------------------------- spend against its target

   The budget is NOT on this pane's own route. /api/ops/costs is the billing
   export; the target is Azure's own Microsoft.Consumption record and reaches
   a client on /api/ops/summary. So every assertion here drives a SECOND
   payload, and the default `boot()` -- which rejects that endpoint -- is the
   control for what the pane does without one.

   Production is 3.15x over a $300 target, and the approved mock has no drawn
   state for a bar past the end of its own track. The scale this pane uses is
   stated once in pane-spend.js and restated here as its own arithmetic, from
   the fixture's two micros figures rather than from the pane's code: an
   expectation computed by the thing under test moves with the mutation and
   proves nothing. */

const BUDGET_TRACK = 'sp-budget';

const budgetCardOf = (dom) => card(dom, /Against the monthly target/);
const trackOf = (dom) => byClass(livePanel(dom), BUDGET_TRACK)[0];

/* The contract, independently: what share of the track each segment is owed,
   from the two figures the fixture states. `ratio` is spend/target; the
   track's domain is the larger of the target and the spend, so the target
   stands at domain's own 100% while spend is under it and travels left as
   spend runs past it. */
function owedShares(spendMicros, targetMicros) {
  const ratio = spendMicros / targetMicros;
  const domain = Math.max(1, ratio);
  return {
    used: (Math.min(ratio, 1) / domain) * 100,
    over: (Math.max(0, ratio - 1) / domain) * 100,
  };
}

const pct = (node) => parseFloat(String((node.style || {}).width || '').replace('%', ''));

test('the target is read beside the bill, once, from the summary route', async () => {
  const dom = await boot({ summary: summaryPayload() });
  const reads = dom.calls.filter((c) => c.endpoint === '/api/ops/summary');
  assert.equal(reads.length, 1,
    'one read of the summary per load: the bill and the target are read together, and a '
    + 'second read of either would race two answers into one card');
  assert.equal(reads[0].query, undefined,
    'the summary takes no selection: it is the month, whatever this pane\'s range is');
  assert.ok(dom.calls.filter((c) => c.endpoint === '/api/ops/costs').length === 1,
    'and the bill is still read exactly once');
});

test('spend past its target draws the overrun as its own segment, not a full bar',
  async () => {
    const summary = summaryPayload();
    const spend = summary.cost.micros;
    const target = summary.cost.budget.micros;
    assert.ok(spend > target * 3, 'the fixture is the production shape: well past its target');

    const dom = await boot({ summary });
    const track = trackOf(dom);
    assert.ok(track, 'the track is drawn');

    const used = byClass(track, 'sp-bud-used')[0];
    const over = byClass(track, 'sp-bud-over')[0];
    assert.ok(used && over, 'past the target the track is two segments, not one');

    const owed = owedShares(spend, target);
    assert.ok(Math.abs(pct(used) - owed.used) < 0.01,
      `the segment up to the target is ${owed.used.toFixed(2)}% of the track, drawn at `
      + `${pct(used)}%`);
    assert.ok(Math.abs(pct(over) - owed.over) < 0.01,
      `the overrun is ${owed.over.toFixed(2)}% of the track, drawn at ${pct(over)}%`);

    /* The point of the scale. A bar pinned at full cannot be told apart from
       one exactly on target, so the target's own mark has to be somewhere a
       reader can see it is behind them. */
    assert.ok(pct(used) < 40 && pct(used) > 25,
      'at 3.15x the target the mark sits around a third of the way along, not at the end: '
      + `drawn at ${pct(used)}%`);
    assert.ok(Math.abs(pct(used) + pct(over) - 100) < 0.02,
      'and the two together are the whole track');
  });

test('spend short of its target draws one segment, at the share it is of the target',
  async () => {
    const summary = summaryPayload({ spend: 572_000_000, target: 650_000_000 });
    const dom = await boot({ summary });
    const track = trackOf(dom);

    const used = byClass(track, 'sp-bud-used')[0];
    assert.ok(used, 'the fill is drawn');
    assert.equal(byClass(track, 'sp-bud-over').length, 0,
      'nothing has run past the target, so there is no overrun segment to draw');
    assert.equal(hasClass(track, 'sp-budget-over'), false,
      'and the track is not in its over-target state');

    const owed = owedShares(572_000_000, 650_000_000);
    assert.ok(Math.abs(pct(used) - owed.used) < 0.01,
      `88% of the target is ${owed.used.toFixed(2)}% of the track, drawn at ${pct(used)}%`);
  });

test('the published ratio is printed at its real size, never clamped to the track',
  async () => {
    const summary = summaryPayload();
    assert.equal(summary.cost.budget.ratioBasisPoints, 31_524,
      'the route publishes the ratio unclamped, which is what makes this drawable');

    const dom = await boot({ summary });
    const words = ownText(budgetCardOf(dom));

    assert.match(words, /3\.15\u00D7/,
      'the multiple is a figure on the card. A bar clamped to its track with no number '
      + 'beside it renders three times over budget identically to exactly on target');
    assert.equal(/\b100\.0%\b/.test(words), false,
      'and the ratio is not restated as the clamped width the bar was drawn at');

    /* The two halves of the same claim: the BAR is bounded by the track and
       the NUMBER is not bounded by anything. */
    const track = trackOf(dom);
    const widths = byClass(track, 'sp-bud-used').concat(byClass(track, 'sp-bud-over'))
      .map(pct);
    assert.ok(widths.every((w) => w <= 100) && Math.abs(widths.reduce((a, b) => a + b) - 100) < 0.02,
      'the drawing stays inside its own track: ' + widths.join(' + '));
  });

test('the figure changes unit at the target, and the caption says which in words',
  async () => {
    const over = ownText(budgetCardOf(await boot({ summary: summaryPayload() })));
    assert.match(over, /3\.15\u00D7/);
    assert.match(over, /times the \$300\.00 monthly target/,
      'the glyph is punctuation for a word a reader also hears, not the only thing '
      + 'saying what the figure is a multiple of');

    const at = ownText(budgetCardOf(await boot({
      summary: summaryPayload({ spend: 300_000_000, target: 300_000_000 }),
    })));
    assert.match(at, /100\.0%/, 'exactly on target is a percentage, not a 1.00x');
    assert.match(at, /of the \$300\.00 monthly target/);

    const under = ownText(budgetCardOf(await boot({
      summary: summaryPayload({ spend: 572_000_000, target: 650_000_000 }),
    })));
    assert.match(under, /88\.0%/);
    assert.match(under, /of the \$650\.00 monthly target/);
  });

test('over target is said in words, so a tone is never the only thing saying it',
  async () => {
    const over = budgetCardOf(await boot({ summary: summaryPayload() }));
    assert.equal(runCount(over, /^Over target$/), 1,
      'the state is a label chip with words in it. check-ops-contrast.mjs judges both '
      + 'themes and a re-toned fill says nothing to a reader who cannot see it');

    const under = budgetCardOf(await boot({
      summary: summaryPayload({ spend: 572_000_000, target: 650_000_000 }),
    }));
    assert.equal(runCount(under, /^Within target$/), 1,
      'and the other state is words too, or the presence of a chip is the signal');
    assert.equal(runCount(under, /^Over target$/), 0);

    const at = budgetCardOf(await boot({
      summary: summaryPayload({ spend: 300_000_000, target: 300_000_000 }),
    }));
    assert.equal(runCount(at, /^At target$/), 1,
      'spending exactly the target is neither over it nor within it');
  });

test('what is left, or what it is over by, is money and is printed once', async () => {
  const over = ownText(budgetCardOf(await boot({ summary: summaryPayload() })));
  assert.match(over, /\$645\.71 over/, 'the overrun is the subtraction, in money');
  assert.match(over, /\$945\.71 spent/, 'beside what was spent');
  assert.equal(over.split('$300.00').length - 1, 1,
    'and the target is printed once, not once in the caption and again in the foot');

  const under = ownText(budgetCardOf(await boot({
    summary: summaryPayload({ spend: 572_000_000, target: 650_000_000 }),
  })));
  assert.match(under, /\$78\.00 left/);
  assert.equal(/over/.test(under), false, 'nothing is over anything here');
});

test('the card says which window the target is measured over, not the pane\'s range',
  async () => {
    /* The bill on screen can be Last 3 months while the target is monthly.
       The card states its own window so the two cannot be read as one. */
    const dom = await boot({ costs: payload({ range: '3m' }), summary: summaryPayload() });
    const words = ownText(budgetCardOf(dom));
    assert.match(words, /1 Aug 2026 to 14 Aug 2026/,
      'the summary\'s own window, from its own payload');
  });

test('a target the route refused is the refusal in words, with no track under it',
  async () => {
    const summary = summaryPayload({ refusal: 'The budget is set in EUR and this period '
      + 'was billed in USD, so the two are not comparable.' });
    assert.equal(summary.cost.basis, 'spend',
      'the route does not claim a comparison it refused to make');

    const dom = await boot({ summary });
    const budget = budgetCardOf(dom);
    assert.ok(budget, 'the card is still drawn: an operator has to be told why');
    assert.equal(byClass(budget, BUDGET_TRACK).length, 0,
      'and draws NO track. An empty one reads as a budget with nothing spent against it '
      + 'and a full one as a budget already gone');
    assert.match(ownText(budget), /set in EUR/,
      'the route\'s own sentence, because it is the only thing that knows which of the '
      + 'seven refusals applies');
    assert.match(ownText(budget), /No target to draw against/);
  });

test('a target stating no currency is not drawn in the one the bill happens to be in',
  async () => {
    /* Azure states no currency on a budget AMOUNT -- the only denomination in
       its response rides on the accrued spend -- so a budget that has never
       accrued any arrives with a figure and nothing saying what the figure is
       in. The route refuses that budget (`unknown_currency`) rather than
       drawing it. This is the client half of the same rule: a payload that
       reaches the pane with an amount and no denomination is not drawn
       either, and specifically is not drawn in the currency this window was
       billed in, which is a different fact about a different number.

       The expectation is stated here, not taken from the pane: $300.00 is
       what the target's micros formatted as US dollars looks like, and US
       dollars is exactly the denomination the bill states and the target
       does not. */
    const summary = summaryPayload({
      budget: (b) => { const { currency, ...rest } = b; return rest; }
    });
    assert.equal(summary.cost.currency, 'USD',
      'the BILL is denominated -- this is the trap: there is a currency in the payload, it '
      + 'just is not the target\'s');
    assert.equal(summary.cost.budget.currency, undefined,
      'and the target states none');

    const dom = await boot({ summary });
    const panel = livePanel(dom);
    assert.equal(byClass(panel, BUDGET_TRACK).length, 0,
      'an undenominated target draws no track: a bar is a comparison, and there is nothing '
      + 'here to say the two figures are comparable');

    const words = ownText(panel);
    assert.ok(!/\$\s*300\.00/.test(words),
      'the target is printed as US dollars, which is the bill\'s denomination borrowed for a '
      + 'figure that never stated one. A made-up denomination is worse than a made-up number '
      + 'because it is drawn just as confidently as a real one');
    assert.ok(!/times the|of the \$/.test(words),
      'and no ratio caption is drawn against it either');

    /* The bill itself is untouched: refusing the target must not cost the
       figure the pane could always draw. The bill comes from the OTHER read
       (/api/ops/costs), so the figure checked here is that fixture's own
       total, summed from its groups rather than copied from the pane. */
    const billed = payload().total.micros;
    const printed = new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2
    }).format(billed / 1_000_000);
    assert.ok(ownText(panel).includes(printed),
      `the billed total ${printed} is still printed -- this refuses a comparison, not a `
      + 'reading, and the bill was never the figure in doubt');
  });

test('the route\'s own words for an undenominated target are what the pane prints',
  async () => {
    /* The contract-faithful shape of the same situation: the route resolves
       the refusal itself and sends no budget block at all, with the reason as
       an omission. Seven refusals share one code path here, so what is
       asserted is that the pane prints the route's sentence rather than one
       of its own. Text taken verbatim from the shipped
       BUDGET_REFUSAL_DETAIL.unknown_currency in Stadiora/Aria#10780. */
    const detail = 'A cloud budget is recorded, but the source states no currency for its '
      + 'amount, so there is no way to know whether it is comparable with this spend. Reading '
      + 'it as the currency this window happens to be billed in would invent the denomination '
      + 'of a target, which is drawn just as confidently as a real one.';
    const dom = await boot({ summary: summaryPayload({ refusal: detail }) });
    const budget = budgetCardOf(dom);
    assert.ok(budget, 'the card is drawn: an operator has to be told why there is no bar');
    assert.equal(byClass(budget, BUDGET_TRACK).length, 0);
    assert.match(ownText(budget), /states no currency for its amount/,
      'the pane prints the route\'s sentence, not a summary of it');
  });

test('a summary the pane could not read draws no budget card, and no bill is lost',
  async () => {
    const dom = await boot({ summary: new Error('summary unavailable') });
    assert.equal(byClass(livePanel(dom), BUDGET_TRACK).length, 0);
    assert.equal(budgetCardOf(dom), undefined,
      'a failed read is not a statement about whether a budget exists, so the card says '
      + 'nothing at all rather than saying there is no budget');
    assert.match(liveText(dom), /This month to date/,
      'and the figures this pane is actually about are untouched by it');
  });

test('a payload naming a target it cannot describe is not drawn as one', async () => {
  /* Both directions of one invariant: the pane reads the block, not the
     basis, so a payload that contradicts itself cannot put a track on screen
     with nothing behind it. */
  const noBlock = summaryPayload();
  delete noBlock.cost.budget;
  assert.equal(noBlock.cost.basis, 'spend_against_target',
    'the fixture is the contradiction: the basis claims a comparison the block is missing');
  assert.equal(byClass(livePanel(await boot({ summary: noBlock })), BUDGET_TRACK).length, 0);

  const noRatio = summaryPayload({ budget: (b) => ({ ...b, ratioBasisPoints: undefined }) });
  assert.equal(byClass(livePanel(await boot({ summary: noRatio })), BUDGET_TRACK).length, 0,
    'a block with no ratio in it has nothing to draw a width from');

  const noTarget = summaryPayload({ budget: (b) => ({ ...b, micros: 0 }) });
  assert.equal(byClass(livePanel(await boot({ summary: noTarget })), BUDGET_TRACK).length, 0,
    'and a target of nothing is not a target: every figure would be infinite against it');

  const noSpend = summaryPayload({ spend: null });
  assert.equal(byClass(livePanel(await boot({ summary: noSpend })), BUDGET_TRACK).length, 0,
    'nor is a target with no spend to measure against it');
});

test('the budget track is hidden from a reader, and carries no text of its own',
  async () => {
    const dom = await boot({ summary: summaryPayload() });
    const track = trackOf(dom);
    assert.equal(track.getAttribute('aria-hidden'), 'true',
      'decorative by decision: every fact it encodes is real text in the same card, so '
      + 'naming it would announce each of them twice');
    assert.equal(runs(track).length, 0,
      'and no text sits on it. Text over a hatch is measured against the worst stripe, '
      + 'and that pair is already one contrast failure on this design system (#10366)');

    /* The half that makes hiding it safe: each of the four facts is in text. */
    const words = ownText(budgetCardOf(dom));
    [/3\.15\u00D7/, /\$300\.00/, /\$945\.71/, /\$645\.71/].forEach((re) => {
      assert.match(words, re, 'a fact the track encodes is missing from the card\'s text');
    });
  });

test('the scale is the larger of the target and the spend, at every ratio', async () => {
  /* One statement of the scale, checked across the range rather than at the
     one ratio production happens to sit at. Each pair is computed here from
     the fixture's figures; the pane is compared to that, not to itself. */
  const CASES = [
    [1_000_000, 650_000_000],     // a rounding of a percent
    [325_000_000, 650_000_000],   // half
    [650_000_000, 650_000_000],   // exactly on it
    [650_065_000, 650_000_000],   // barely past it
    [945_710_000, 300_000_000],   // production
    [30_000_000_000, 300_000_000] // a hundred times over
  ];
  for (const [spend, target] of CASES) {
    const dom = await boot({ summary: summaryPayload({ spend, target }) });
    const track = trackOf(dom);
    const owed = owedShares(spend, target);
    const used = byClass(track, 'sp-bud-used')[0];
    const over = byClass(track, 'sp-bud-over')[0];

    assert.ok(Math.abs(pct(used) - owed.used) < 0.02,
      `${spend} against ${target}: the segment to the target is owed ${owed.used.toFixed(2)}%`
      + ` and is ${pct(used)}%`);
    if (owed.over > 0) {
      assert.ok(over, `${spend} against ${target}: an overrun with no segment drawn for it`);
      assert.ok(Math.abs(pct(over) - owed.over) < 0.02,
        `${spend} against ${target}: the overrun is owed ${owed.over.toFixed(2)}% and is `
        + `${pct(over)}%`);
    } else {
      assert.equal(over, undefined,
        `${spend} against ${target}: nothing ran past the target, so nothing is drawn past it`);
    }
    assert.equal(hasClass(track, 'sp-budget-over'), owed.over > 0,
      `${spend} against ${target}: the state class and the geometry disagree`);
  }
});

/* The two claims the mutation battery found nothing binding: the overrun's
   texture, and the target mark's colour. Both were GREEN under a mutation
   that removed them -- M10 and M11 -- which is what a false green looks like
   from the outside, so both are bound here.

   Read as the rule that paints, parsed and cascade-ordered, not as a string
   found in the file. What is asserted is which colour FUNCTION the declared
   value is built from, because that is the part a browser paints and the part
   a mutation removes. The rendered proof -- the stripe count, the measured
   ratios -- is in Chrome and published in the PR; this is the part CI can
   run, and the PR says so rather than implying the pair is covered twice. */
function paintOf(selector, property) {
  let found = null;
  RULES.forEach((rule) => {
    const decl = declarations(rule.body);
    if (!decl.has(property)) return;
    if (!rule.selectors.some((one) => oneLine(one) === selector)) return;
    found = { value: decl.get(property), media: rule.media };
  });
  return found;
}

test('the overrun is a different material, not only a different tone', () => {
  const over = paintOf('.sp-bud-over', 'background');
  const used = paintOf('.sp-bud-used', 'background');
  assert.ok(over && used, 'both segments of the budget track are painted by this sheet');

  /* A repeating gradient is a texture: stripes a reader who cannot tell rose
     from cyan still sees as a second material. Rendered, it is 12 distinct
     colours spanning 2.45:1 in the dark theme and 17 spanning 2.05:1 in the
     light one, against a fill that is a smooth ramp. */
  assert.match(over.value, /\brepeating-(linear|radial|conic)-gradient\(/,
    'the over-target segment paints no repeating gradient, so the only thing separating '
    + 'it from the segment before it is its hue -- and colour alone cannot carry '
    + '"over target" (check-ops-contrast.mjs judges both themes; this repo\'s answer '
    + 'where colour IS the data is a texture and a label chip, not a re-toned fill)');
  assert.ok(!/\brepeating-/.test(used.value),
    'and the under-target segment is NOT striped, or the two materials are one material '
    + 'and this assertion is comparing a thing to itself');
  assert.equal(over.media, null, 'at every width, not only a wide one');
});

test('the target mark takes the darker token in each theme, not one in both', () => {
  const mark = paintOf('.sp-budget-over .sp-bud-used', 'border-right');
  assert.ok(mark, 'the over-target track draws a mark where the target fell');

  /* --ink is near-black in the light theme and near-white in the dark one,
     while both segments the mark separates are mid-luminance in both. One
     token cannot be the conservative choice for both roles: measured in
     Chrome, an --ink rule is 6.28:1 against the cyan fill in light and
     2.15:1 against it in dark, which is under the 3:1 a boundary needs.
     light-dark() takes the darker end in each theme: 6.28:1 / 5.31:1 light,
     8.00:1 / 4.63:1 dark. */
  const chosen = /light-dark\(\s*(var\(--[a-z0-9-]+\))\s*,\s*(var\(--[a-z0-9-]+\))\s*\)/
    .exec(mark.value);
  assert.ok(chosen,
    'the mark takes one colour for both themes: `' + mark.value + '`. A single token '
    + 'cannot be the conservative choice for both, because --ink flips polarity with the '
    + 'theme and the two segments it separates do not: measured, --ink is 2.15:1 against '
    + 'the cyan fill in the dark theme');
  assert.notEqual(chosen[1], chosen[2],
    'both arms of light-dark() name the same token, which is one colour written twice');
});

test('the last row of the service table drops its rule on every cell in it', () => {
  /* Stadiora/Aria#10820: the rule reached the `td`s and not the row's own
     `th[scope="row"]`, so the last row drew a horizontal rule that stopped
     dead at the end of the first column -- about 48% of the table -- while
     every row above it drew a full-width one. Measured on the shipped
     screenshot's Azure Monitor row: th 546px wide with a 1px bottom border,
     the three td s with 0px.

     Read as rules and their order rather than as a string in the file: the
     question is which declaration WINS on that cell, and `border-bottom: 0`
     in a rule a later one overrides is a sheet saying nothing. */
  const base = new Map();
  const lastRow = new Map();
  RULES.forEach((rule, index) => {
    const decl = declarations(rule.body);
    if (!decl.has('border-bottom')) return;
    rule.selectors.forEach((selector) => {
      const one = oneLine(selector);
      if (!/\.sp-tbl\b/.test(one)) return;
      const cell = /(?:^|[\s>])(th|td)\b[^\s>]*$/.exec(one);
      if (!cell) return;
      const entry = { value: decl.get('border-bottom'), index, media: rule.media, one };
      (/tbody\s+tr:last-child/.test(one) ? lastRow : base).set(cell[1], entry);
    });
  });

  assert.deepEqual([...base.keys()].sort(), ['td', 'th'],
    'the table draws a rule under both kinds of cell, or there is no rule to drop');
  base.forEach((entry, cell) => {
    assert.match(entry.value, /^1px\b/, `the ${cell} rule is the 1px one: ${entry.one}`);
    assert.equal(entry.media, null, 'and it is not inside a media query');
  });

  assert.deepEqual([...lastRow.keys()].sort(), ['td', 'th'],
    'and the last row drops it on BOTH. A rule naming only `td` leaves the row\'s own '
    + 'th[scope="row"] with its 1px, which is a rule under half a row');
  lastRow.forEach((entry, cell) => {
    assert.match(entry.value, /^0(px)?$/, `the last row's ${cell} keeps no rule: ${entry.one}`);
    assert.equal(entry.media, null, 'at every width, not only a wide one');
    assert.ok(entry.index > base.get(cell).index,
      `and says so after the rule it overrides, so it wins the cascade on ${cell} whatever `
      + 'the specificities work out to');
  });
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
   does that four times on purpose -- a share bar's width, a gridline label's
   offset, a date's left and a budget segment's width, all lengths computed
   from the answer -- and CSSOM is not gated by the policy. The clause below
   pins that exception rather than trusting it: every `.style` contact in the
   module must be a `setProperty` call FOR ONE OF THOSE THREE PROPERTY NAMES
   (the fourth site writes `width`, which is already one of them, so the
   property axis is unchanged by it). Pinning only the
   form was a hole: the stylesheet allowlist further up cannot see CSSOM at
   all, so `cell.style.setProperty('position', 'static')` added inside the
   date loop's own `if (placed)` gate was a `setProperty` call, was green,
   and put the worst date 69.86% of the plot from its day with two dates
   touching. A fourth property here is a length this file has not reasoned
   about, and it has to be argued for rather than typed. Also
   not covered: an attribute name assembled at runtime, which no source scan
   can see and which the page's own policy is the enforcement for. And three
   further spellings, verified SURVIVED rather than assumed: a namespaced
   `setAttributeNS(null, 'style', ...)`, a capitalised `Style:` key on `h()`
   (HTML lowercases attribute names, so it writes a real style attribute), and
   `document.createRange().createContextualFragment(...)`. This module writes
   none of the three, and widening an analyzer to reach them adds guard code
   nothing has reviewed; they are recorded here rather than matched. All three
   write a style ATTRIBUTE, which the page's own `style-src 'self'` refuses,
   so a browser is the backstop behind this record. CSSOM has no such
   backstop, which is why the spellings of THAT are pinned by the rendered
   result below rather than recorded here. One further Typed OM spelling,
   `cell.attributeStyleMap.set(...)`, is red today only because this harness
   has no Typed OM and the pane throws: a crash, not a catch. If the harness
   ever grows the API, the write lands in the same style object the test below
   reads. */
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

  /* The documented exception, held to its own words: CSSOM, for three named
     lengths, and nothing else. Wide enough a capture to read the property
     name out of the call, because the name is the half that matters. */
  const CSSOM_LENGTH = /^\.style\s*\.\s*setProperty\(\s*'(?:width|top|left)'/;
  [["  .style.setProperty('position', 'static');", false],
    ['  .style.setProperty(\'margin-left\', \'24px\');', false],
    ['  .style.marginLeft = \'24px\';', false],
    ["  .style.setProperty('left', value);", true],
  ].forEach(function (pair) {
    assert.equal(CSSOM_LENGTH.test(pair[0].trim()), pair[1],
      'the CSSOM clause reads this spelling wrong: ' + pair[0].trim());
  });

  const styleContacts = PANE_CODE.match(/\.style\b[\s\S]{0,34}/g) || [];
  styleContacts.forEach(function (contact) {
    assert.match(contact, CSSOM_LENGTH,
      'the docblock allows CSSOM for four computed lengths -- a bar\'s width, a gridline '
      + 'label\'s top, a date\'s left and a budget segment\'s width -- and nothing else. Any other property set this '
      + 'way is invisible to the stylesheet allowlist above: adding '
      + '`cell.style.setProperty(\'position\', \'static\')` inside the date loop\'s own '
      + '`if (placed)` gate put the worst date 69.86% of the plot from its day with two '
      + 'dates touching (0.00px apart), and was green. This is: ' + contact);
  });
  assert.equal(styleContacts.length, 4,
    'a fifth `.style` contact, or one fewer: the four are a bar\'s width, a gridline '
    + 'label\'s top, a date\'s left and a budget segment\'s width');

  assert.ok(!/\bstyle\s*=/.test(PAGE_HTML), 'and none is written into the page either');
});

/* ------------------------------ the inline styles the RENDERED pane carries

   The clause above reads the source for the literal text `.style`, so it sees
   the spelling this module uses and no other. Measured rather than assumed: a
   fourth CSSOM write added inside the date loop's own `if (placed)` gate is
   green there -- 72 pass, 0 fail -- when it is spelled `cell['style']`, when
   the key is built at runtime (`var K = 'sty' + 'le'; cell[K]`), or through a
   bound `setProperty`, and all three put the worst date 83.80% of the plot
   from its day at 1440px. Widening that regex would close the spellings
   somebody thought of, which is the failure shape it already is.

   So the property axis is pinned a second time, by the RESULT rather than by
   the spelling. Every route into an element's inline style -- dotted,
   bracketed, computed, bound, `cssText`, `Object.assign`, `attributeStyleMap`
   if the harness ever grows one -- ends at the same style object, and this
   reads that object on every element the pane rendered. A fourth property
   arrives here whatever it was typed as, and it does not need to be
   enumerated first.

   The sweep starts at the document element rather than at the pane's region,
   because a write does not have to land on a node the pane built to matter:
   `document.documentElement['style'].setProperty('overflow-x', 'hidden')`
   inside the date loop's own gate was green while this read `#content`.

   What this does NOT cover: a write that never reaches the fake DOM -- a
   style attribute (the clause above, and `style-src 'self'` behind it) -- and
   a property set from a branch neither fixture below takes. Two renders,
   chosen for their branches: a closed three-month window, which places every
   date, and an open month whose labels name no day in it, which takes the
   unpositioned fallback and draws the forecast block that a closed period has
   none of. The skeleton the shell draws while the answer is in flight is
   inside the swept region and is not this module's: its bar heights
   (`shell-pane-v2.js:687`) are pinned below rather than skipped. */
test('the rendered pane carries three inline lengths and no fourth, however it is spelled',
  async () => {
    /* Two renders, for their branches. The first places every date. The
       second is an open month -- so the forecast block is drawn, which a
       closed period has none of -- whose labels name no day in the window, so
       `labelDays()` returns null and the strip takes the unpositioned
       fallback. A bracketed write in either of those two branches was green
       while this test rendered only the first. */
    const placed = payload({ range: '3m' });
    const loose = payload();
    loose.daily.labels = loose.daily.labels.map((one, i) => '2026-01-' + String(i + 1));
    assert.ok(loose.forecast, 'the open month forecasts, or the second branch is not taken');

    /* Two more renders for the budget track, which is the other branch that
       writes a length: over target it draws two segments, under target one.
       Without them the sweep never sees the card at all -- every other test
       in this file boots with no summary, so the track is absent -- and a
       fifth inline property written into it would be green here. */
    const over = summaryPayload();
    const under = summaryPayload({ spend: 572_000_000, target: 650_000_000 });
    assert.ok(over.cost.budget.ratioBasisPoints > 10_000
      && under.cost.budget.ratioBasisPoints < 10_000,
      'one render is past the target and one is short of it, or the pair is one branch twice');

    for (const one of [
      { costs: placed }, { costs: loose },
      { costs: placed, summary: over }, { costs: placed, summary: under },
    ]) {
      const dom = await boot(one);
      const data = one.costs;
      const isLoose = data === loose;
      /* From the fixture's own ratio and the scale's stated design -- two
         segments past the target, one short of it -- not from the tree. */
      const segments = one.summary
        ? (one.summary.cost.budget.ratioBasisPoints > 10_000 ? 2 : 1)
        : 0;

      /* This harness's style object is a plain object: `setProperty` writes
         the property as an own key beside its own two methods, so the own
         keys that are not those methods are exactly what something has
         written. */
      const METHODS = ['setProperty', 'removeProperty'];
      const propsOn = (node) => Object.keys(node.style || {})
        .filter((name) => METHODS.indexOf(name) === -1);
      const entries = (root) => [root].concat(findAll(root, () => true))
        .flatMap((node) => propsOn(node).map((name) => ({ node, name })));

      /* One region of the swept tree is not written by this module: the
         skeleton the shell draws while the answer is in flight sets a height
         on each bar (`shell-pane-v2.js:687`). It is pinned here rather than
         skipped, so a length this module wrote into that box is still a
         failure. */
      const loading = panel(dom, 'loading');
      const inLoading = new Set([loading].concat(findAll(loading, () => true)));
      entries(loading).forEach((one) => {
        assert.equal(one.name, 'height',
          'the shell\'s skeleton sets a bar height and nothing else');
        assert.ok(hasClass(one.node, 'skel'), 'on a skeleton bar');
      });

      const written = entries(dom.doc.documentElement).filter((one) => !inLoading.has(one.node));

      /* The fallback strip claims no position, so `left` is absent from it by
         design -- the one difference between the two renders. */
      const ALLOWED = isLoose ? ['top', 'width'] : ['left', 'top', 'width'];
      const names = [...new Set(written.map((one) => one.name))].sort();
      assert.deepEqual(names, ALLOWED,
        'the three lengths this module computes are a bar\'s width, a gridline label\'s top '
        + 'and a date\'s left. A fourth inline property is a length this file has not reasoned '
        + 'about, and the stylesheet allowlist above cannot see it: found ' + names.join(', ')
        + (isLoose ? ' on the fallback render' : ''));

      written.forEach((one) => {
        assert.equal(propsOn(one.node).length, 1,
          'an element carries one computed length, not a declaration block: '
          + String(one.node.tagName) + '.' + String(one.node.className || '') + ' carries '
          + propsOn(one.node).join(', '));
      });

      /* Which element each length is allowed to land on, so a `left` written
         on a bar or a `width` written on a date is a failure even though the
         name is one of the three. */
      const holders = (name) => written.filter((one) => one.name === name).map((one) => one.node);
      holders('width').forEach((node) => {
        assert.equal(String(node.tagName).toLowerCase(), 'i', 'a width is a bar\'s fill');
        const box = node.parentNode;
        if (hasClass(box, 'sp-budget')) {
          assert.ok(hasClass(node, 'sp-bud-used') || hasClass(node, 'sp-bud-over'),
            'a width in the budget track is one of its two named segments');
        } else {
          assert.ok(hasClass(box, 'sp-bar'), 'inside the share meter or the budget track');
        }
      });
      holders('top').forEach((node) => {
        assert.ok(hasClass(node, 'sp-tick'), 'a top is a gridline\'s number');
      });
      holders('left').forEach((node) => {
        assert.equal(String(node.tagName).toLowerCase(), 'span', 'a left is a date');
        assert.ok(hasClass(node.parentNode, 'sp-xaxis'), 'in the date strip');
      });

      /* The counts come from the fixture and from the scale's stated design,
         not from the tree they are checked against. Without them this test
         passes on a pane that rendered nothing at all. */
      assert.equal(holders('left').length,
        isLoose ? 0 : data.daily.labels.filter(Boolean).length,
        'one position per date the route sent, and none at all on the fallback');
      assert.equal(holders('top').length, 5,
        'one number per gridline: four ticks and the baseline');
      assert.equal(holders('width').length,
        data.views.category.rows.filter((row) => row.shareBasisPoints !== undefined).length
          + segments,
        'one bar per row of the grouping on screen that has a share, plus the budget '
        + 'track\'s segments');

      /* The second render is only worth making if it really took the other
         two branches, so the branches are asserted rather than assumed. */
      if (isLoose) {
        const strip = byClass(livePanel(dom), 'sp-xaxis')[0];
        assert.ok(strip && /\bsp-xaxis-loose\b/.test(strip.getAttribute('class') || ''),
          'the second render takes the unpositioned fallback');
        assert.equal(byClass(livePanel(dom), 'sp-fore').length, 1,
          'and draws the forecast block a closed period has none of');
      }
    }
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
