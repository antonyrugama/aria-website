/* The /api/ops/costs answer, built the way the route builds it.

   Lifted out of scripts/ops-spend-v2.test.mjs (Stadiora/Aria#10821) so the
   shared API stub in scripts/ops-api-stub.mjs can serve the same
   route-faithful `ready` payload the pane's own suite asserts against,
   instead of a hand-drawn one that drifts. It has no test in it and imports
   nothing, so importing it registers no tests and needs no DOM.

   Everything below is unchanged from its old home: the route's period
   arithmetic, the billed groups, and payload(). */

export const HOUR = 3600 * 1000;
export const hoursAgo = (n) => new Date(Date.now() - n * HOUR).toISOString();

/* ------------------------------------------------ the route's arithmetic

   Ported verbatim from app-backend/server/services/opsPanes/opsCostPeriod.ts
   so the fixtures below are a projection of the route rather than a drawing
   of one. */

export const DAY_MS = 86400000;
export const isoDay = (date) => date.toISOString().slice(0, 10);
export const dayStart = (usageDate) => new Date(usageDate + 'T00:00:00.000Z');
export const addDays = (usageDate, days) =>
  isoDay(new Date(dayStart(usageDate).getTime() + days * DAY_MS));
export const dayCount = (start, endExclusive) =>
  Math.round((dayStart(endExclusive).getTime() - dayStart(start).getTime()) / DAY_MS);

export const OPS_COST_PUBLISH_LAG_HOURS = 8;
export const SERIES_TOKENS = ['s1', 's2', 's3', 's4', 's5', 's6'];
export const MAX_DAILY_LABELS = 6;

export const CATEGORY_LABELS = {
  ci_and_build: 'CI and build',
  ai_and_models: 'AI and models',
  data: 'Data',
  application_compute: 'Application compute',
  platform_and_observability: 'Platform and observability',
  ungrouped: 'Ungrouped',
};

export const categoryLabel = (category) =>
  Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, category)
    ? CATEGORY_LABELS[category]
    : category;

export function shareBasisPoints(micros, total) {
  if (total <= 0) return 0;
  return Math.round((micros / total) * 10000);
}

export function changeBasisPoints(current, previous) {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 10000);
}

export function resolveCostPeriod(range, now) {
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

export function resolveComparisonWindow(period, billedDays) {
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

export function comparisonLabelFor(period, billedDays, comparisonDays) {
  if (comparisonDays === billedDays) return period.comparisonLabel;
  return period.comparisonLabel + ', over ' + comparisonDays +
    ' days against ' + billedDays + ' here';
}

export const resourceGroupKey = (group) => group.subscriptionId + '/' + group.resourceGroup;

export const DIMENSIONS = [
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

export function buildCostView(dimension, groups, previousGroups, total, context) {
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

export function buildDailySeries(period, billedDays, current, comparison, refusal) {
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

export const SUB_A = '00000000-0000-4000-8000-00000000000a';
export const SUB_B = '00000000-0000-4000-8000-00000000000b';

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
export function window_(groups, startDay, days, scale, dayScale) {
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
