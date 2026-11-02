/* Money, on the v2 pane bootstrap.

   One question: what are we paying for this month, and how does it compare
   with the last. The answer is one read of GET /api/ops/costs for the month
   the picker names, plus a second, parallel read of GET /api/ops/summary for
   what that spend is measured against. Neither route was changed to make this
   pane: the bill is the billing export and the target is Azure's own budget
   record. The second read fails soft and only ever adds a figure.

   Four properties are load bearing. Each is checked by a test in
   scripts/ops-spend-v2.test.mjs rather than only claimed in this comment:

     1. **A figure with no source is words, never a zero.** On a pane about
        money a zero is a claim. The route says an absent field is absent, and
        the pane keeps that: a missing total is "Not reported", a missing day
        breaks the line, and a row with no amount has no bar.
     2. **Nothing is printed that the page cannot reproduce.** The dollar
        change against the last period is drawn only when it works out to the
        route's own percentage, and the rows under "Where it goes" say so when
        they do not add up to the total rather than drawing as if they did.
     3. **Every figure carries how old it is.** Cost data is never live: the
        billing export publishes on a lag. The page says when it was collected,
        and says so in words once the publishing cycle has been missed twice
        over, or the collection itself has failed.
     4. **Month names come from the answer, never from the browser's clock.**
        A laptop set to another day would otherwise label October's bill as
        November's. The picker names a month only once an answer has said which
        one it is.

   The App scope control is absent because a shared cloud bill is not split by
   client app, and the shell's range control is absent because this pane
   carries its own month picker: the route answers four windows (this month,
   last month, the last 3 months, the last 12 months) and refuses any other, so
   the picker offers those four and nothing else.

   Nothing here uses innerHTML and no style attribute is written into markup.
   Every computed length -- a bar's width, a dot's position, a label's offset
   -- goes through CSSOM, which the page's Content-Security-Policy does not
   gate. */
(function (global) {
  'use strict';

  var S = global.OpsPaneShell;
  var h = S.h;
  var fmt = S.fmt;
  var maskContactDetails = global.OpsPaneRegistry.maskContactDetails;

  var PANE_ID = 'spend';
  var ENDPOINT = '/api/ops/costs';

  /* Where the target comes from, which is NOT this pane's own answer.
     /api/ops/costs is a reading of the billing export and knows nothing about
     what anybody meant to spend. */
  var SUMMARY_ENDPOINT = '/api/ops/summary';

  /* The fixture key the second read takes, kept apart from the pane's own so
     a local preview can drive the target and the bill independently. */
  var SUMMARY_FIXTURE_ID = 'spend-budget';

  /* Beyond this multiple of the route's own publish lag the answer is old
     enough to say so beside the figures. A normal cycle never trips it and a
     missed one always does. */
  var STALE_MULTIPLE = 2;

  /* Used only when the answer did not carry a usable `publishLagHours`. */
  var FALLBACK_LAG_HOURS = 8;

  var NOT_REPORTED = 'Not reported';
  /* The route sends the ungrouped charge as its own row precisely so the bill
     still adds up. The tone alone says nothing to a reader who cannot see it,
     so the row carries the reason in words. */
  var UNMAPPED_NOTE = 'Unmapped: no category covers these services yet';
  var DAY_MS = 86400000;
  var MICROS = 1000000;

  /* The four windows the route answers, in the order the picker lists them.
     `month` is the one the page opens on. */
  var RANGES = ['month', 'last-month', '3m', '12m'];
  var OPEN_RANGE = 'month';
  var CLOSED_RANGE = 'last-month';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug',
    'Sep', 'Oct', 'Nov', 'Dec'];
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /* Three cuts of the same bill, in the order the switch lists them. */
  var VIEW_ORDER = ['category', 'resourceGroup', 'service'];
  var DEFAULT_VIEW = 'category';
  var VIEW_BUTTON = {
    category: 'Category',
    resourceGroup: 'Resource group',
    service: 'Service'
  };

  /* The route's six category keys, in the words the page uses. A key outside
     this table -- a new category, or a row in one of the other cuts -- is
     drawn with the route's own label, because that label is the only thing
     that knows what the row is. */
  var CATEGORY_NAMES = {
    application_compute: 'Compute',
    ai_and_models: 'AI & models',
    data: 'Data',
    ci_and_build: 'CI & build',
    platform_and_observability: 'Platform'
  };

  /* More points than this and a dot per day is a smear: only the last one is
     marked. */
  var DOT_LIMIT = 62;

  function list(value) { return Array.isArray(value) ? value : []; }

  function num(value) {
    return (typeof value === 'number' && isFinite(value)) ? value : null;
  }

  function text(value) {
    return (typeof value === 'string' && value) ? value : null;
  }

  function diagnostic(value) {
    var detail = text(value);
    return detail ? maskContactDetails(detail) : null;
  }

  /* Every figure on this pane is integer micros in the answer's own currency.
     One helper, so the currency cannot be dropped at one call site and kept
     at another. */
  function money(micros, data, digits) {
    return fmt.money(micros, text((data || {}).currency) || 'USD', digits);
  }

  /* ----------------------------------------------------------------- dates

     A YYYY-MM-DD from the route is read as the UTC day it names, so a browser
     west of Greenwich cannot print the day before. */

  function parseDay(iso) {
    var value = text(iso);
    if (!value) return null;
    var t = new Date(value.length === 10 ? value + 'T00:00:00.000Z' : value);
    return isFinite(t.getTime()) ? t : null;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function monthDay(date) {
    return MONTHS_SHORT[date.getUTCMonth()] + ' ' + date.getUTCDate();
  }

  function monthYear(date) {
    return MONTHS[date.getUTCMonth()] + ' ' + date.getUTCFullYear();
  }

  function addMonths(date, n) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, 1));
  }

  function headDate(iso) {
    var t = parseDay(iso);
    if (!t) return null;
    return WEEKDAYS[t.getUTCDay()] + ', ' + monthDay(t) + ', ' + t.getUTCFullYear();
  }

  function updatedAt(iso) {
    var t = parseDay(iso);
    if (!t) return null;
    return 'Updated ' + pad2(t.getUTCHours()) + ':' + pad2(t.getUTCMinutes()) + ' UTC';
  }

  /* The day an index into the period names. */
  function dayAt(start, index) {
    return new Date(start.getTime() + index * DAY_MS);
  }

  /* ------------------------------------------------------------ the months

     The picker names a month only from an answer: this month is the month the
     `month` answer starts in, last month is the one before it, and a
     `last-month` answer says both the other way round. What was learned stays
     for the answers that carry no month of their own (the 3 and 12 month
     windows). Until one has arrived the words are the generic ones. */

  var months = { current: null, previous: null };

  function learnMonths(data, asked) {
    var start = parseDay((data.period || {}).start);
    if (!start) return;
    var first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    var answered = text(data.range) || asked;
    if (answered === 'month') {
      months.current = monthYear(first);
      months.previous = monthYear(addMonths(first, -1));
    } else if (answered === CLOSED_RANGE) {
      months.previous = monthYear(first);
      months.current = monthYear(addMonths(first, 1));
    }
  }

  function rangeLabel(range) {
    if (range === 'month') return months.current || 'This month';
    if (range === CLOSED_RANGE) return months.previous || 'Last month';
    if (range === '3m') return 'Last 3 months';
    return 'Last 12 months';
  }

  /* The range the address names, if it names one of the four. Anything else
     -- another pane's `30d`, a hand-edited value -- is not a window this
     route answers and is read as no choice at all. */
  function urlRange() {
    try {
      var value = new global.URLSearchParams(global.location.search).get('range');
      return RANGES.indexOf(value) === -1 ? null : value;
    } catch (e) {
      return null;
    }
  }

  function writeUrl(range) {
    try {
      var url = new global.URL(global.location.href);
      url.searchParams.set('range', range);
      global.history.replaceState(global.history.state, '', url.pathname + url.search + url.hash);
    } catch (e) {
      /* An address that cannot be rewritten still shows the right month. */
    }
  }

  /* --------------------------------------------------------- how old it is

     Two separate facts, and the pane never merges them. `asOf` is when the
     figures were collected. `staleness` is the cost poller's own account of
     whether collection is working at all. An answer collected an hour ago by
     a poller that has failed every run since is fresh and broken at the same
     time, and an operator needs both. */

  function lagHours(data) {
    var lag = num(data.publishLagHours);
    return lag !== null && lag > 0 ? lag : FALLBACK_LAG_HOURS;
  }

  function pill(iconName, words) {
    return h('span', { className: 'pill warn' }, [S.icon(iconName), h('span', { text: words })]);
  }

  /* Said only when there is something to say: a collection that is on time is
     already stated by the header's "Updated" time. */
  function freshness(data) {
    var asOf = text(data.asOf);
    var hours = asOf ? fmt.hoursSince(asOf) : null;
    if (hours === null) return pill('warn', 'No collection time');
    if (hours >= lagHours(data) * STALE_MULTIPLE) {
      return pill('warn', fmt.hours(hours) + ' behind');
    }
    return null;
  }

  var POLLER_WORDS = {
    failed: 'Collection failing, showing the last good figures',
    unknown: 'Collection status unknown',
    disabled: 'Collection switched off',
    unconfigured: 'Collection not set up'
  };

  /* The route's own sentence when it sends one, because only the poller knows
     which reason applies; the words above are for a state that arrives bare. */
  function pollerNote(data) {
    var staleness = data.staleness || {};
    var state = text(staleness.state);
    if (!state || state === 'ok') return null;
    var detail = diagnostic(staleness.detail);
    return pill('warn', detail || (Object.prototype.hasOwnProperty.call(POLLER_WORDS, state)
      ? POLLER_WORDS[state]
      : 'Collection needs attention'));
  }

  /* ---------------------------------------------------------- the meta line

     Beside the picker, at the right: the currency, how far the bill reaches,
     and the two disclosures above. A window billed in full says nothing about
     coverage. The open month is always short of its own end, which "Billed
     through" already says, so a count is added only for the windows that
     should have been whole. */
  function metaParts(data, range) {
    var period = data.period || {};
    var parts = [];
    var currency = text(data.currency);
    if (currency) parts.push(currency);
    var through = parseDay(period.actualThrough);
    if (through) parts.push('Billed through ' + monthDay(through));
    var billed = num(period.billedDays);
    var inPeriod = num(period.daysInPeriod);
    if ((text(data.range) || range) !== OPEN_RANGE && billed !== null && inPeriod !== null
      && billed > 0 && billed < inPeriod) {
      parts.push(fmt.int(billed) + ' of ' + fmt.plural(inPeriod, 'day') + ' billed');
    }
    return parts;
  }

  /* ----------------------------------------------------------- the figures */

  /* The daily series the line is drawn from: the one keyed `current`, else the
     first that is not the comparison. With `previous` set, the comparison. */
  function seriesOf(data, previous) {
    var all = list((data.daily || {}).series).filter(function (one) { return !!one; });
    if (previous) {
      return all.filter(function (one) { return one.key === 'previous'; })[0] || null;
    }
    return all.filter(function (one) { return one.key === 'current'; })[0]
      || all.filter(function (one) { return one.dashed !== true && one.key !== 'previous'; })[0]
      || null;
  }

  /* Only the days that have a bill behind them. The route pads the line with
     nulls out to the length of the longer of the two periods; a day with no
     bill is a gap, and a day not yet billed is not part of the line at all. */
  function dailyValues(data) {
    var one = seriesOf(data, false);
    if (!one) return [];
    var values = list(one.values).map(function (v) { return num(v); });
    var billed = num((data.period || {}).billedDays);
    if (billed !== null && billed >= 0 && billed < values.length) {
      values = values.slice(0, billed);
    } else {
      while (values.length && values[values.length - 1] === null) values.pop();
    }
    return values;
  }

  function previousTotal(data) {
    var one = seriesOf(data, true);
    if (!one) return null;
    var sum = 0;
    var seen = false;
    list(one.values).forEach(function (v) {
      if (num(v) !== null) { sum += v; seen = true; }
    });
    return seen ? sum : null;
  }

  /* total / billed days, in whole micros. A period with no billed day has no
     average. */
  function dailyAverage(data) {
    var micros = num((data.total || {}).micros);
    var billed = num((data.period || {}).billedDays);
    if (micros === null || billed === null || billed <= 0) return null;
    return Math.round(micros / billed);
  }

  /* What the change is against: a calendar month by name when the comparison
     is one, the days when it is a stretch of one, and a count otherwise. */
  function versus(data) {
    var c = data.comparison || {};
    var start = parseDay(c.start);
    var end = parseDay(c.endExclusive);
    var days = num(c.days);
    if (start && end && days && days > 0) {
      var last = new Date(end.getTime() - DAY_MS);
      if (start.getUTCDate() === 1 && end.getUTCDate() === 1
        && addMonths(start, 1).getTime() === end.getTime()) {
        return 'vs ' + MONTHS[start.getUTCMonth()];
      }
      if (last.getUTCMonth() === start.getUTCMonth()) {
        return 'vs ' + monthDay(start) + '\u2013' + last.getUTCDate();
      }
      return 'vs the previous ' + fmt.plural(days, 'day');
    }
    var label = text((data.total || {}).comparisonLabel);
    return label || null;
  }

  /* 5, or 5.2. A whole percentage is not written with a decimal it does not
     have. */
  function pct(basisPoints) {
    var abs = Math.abs(basisPoints);
    return fmt.percent(abs, abs % 100 === 0 ? 0 : 1);
  }

  /* The change against the last period, as the route states it and the page
     can reproduce. The route sends the change as basis points only; the
     dollars are drawn when the two series on screen reproduce that exact
     percentage, so a figure the page cannot stand behind is not printed. */
  function deltaLine(data) {
    var total = data.total || {};
    var bp = num(total.changeBasisPoints);
    if (bp === null) return null;
    var vs = versus(data);
    var micros = num(total.micros);
    var prev = previousTotal(data);
    var diff = null;
    if (micros !== null && prev !== null && prev > 0
      && Math.round((micros - prev) / prev * 10000) === bp) {
      diff = micros - prev;
    }
    if (bp === 0 && (diff === null || diff === 0)) {
      return 'No change' + (vs ? ' ' + vs : '');
    }
    if (diff === null) {
      return fmt.signedPercent(bp, bp % 100 === 0 ? 0 : 1) + (vs ? ' ' + vs : '');
    }
    var abs = Math.abs(diff);
    var sign = diff > 0 ? '+' : '\u2212';
    return sign + money(abs, data, abs >= MICROS ? 0 : 2) + (vs ? ' ' + vs : '')
      + ' \u00B7 ' + pct(bp);
  }

  /* ------------------------------------------------------------ the budget

     The published ratio is read, never recomputed: the route divides spend by
     target itself and says so unclamped, and a second division here would be
     a second opinion about the same pair. A target of zero or less never
     reaches this; the route filters to strictly positive amounts. */
  function budgetState(summary) {
    if (!summary) return null;
    var cost = summary.cost || {};
    var budget = cost.budget;
    var spend = num(cost.micros);
    var target = budget ? num(budget.micros) : null;
    var ratio = budget ? num(budget.ratioBasisPoints) : null;
    /* The target's OWN stated denomination, and nothing else. A target read as
       the currency the bill happens to be in is an invented denomination,
       drawn as confidently as a real one and wrong by whatever the exchange
       rate is. */
    var denomination = budget ? text(budget.currency) : null;
    if (budget && spend !== null && target !== null && target > 0 && ratio !== null
      && denomination) {
      return {
        spend: spend,
        target: target,
        ratio: ratio,
        money: { currency: denomination },
        window: cost.window || {}
      };
    }
    return null;
  }

  /* A budget is measured over a month, and it is drawn only against the same
     month: a target for October beside a 3 month window is two different
     questions in one tile. */
  function budgetStat(summary, data) {
    var state = budgetState(summary);
    if (!state) return null;
    var mine = text((data.period || {}).start);
    if (!mine || text(state.window.start) !== mine) return null;
    if (state.ratio > 10000) {
      return {
        value: money(state.spend - state.target, state.money, 0) + ' over',
        label: money(state.target, state.money, 0) + ' budget'
      };
    }
    return {
      value: fmt.percent(state.ratio, 0),
      label: 'of ' + money(state.target, state.money, 0) + ' budget'
    };
  }

  /* -------------------------------------------------------------- the hero */

  function stat(value, label, lead) {
    var words = h('div', { className: 'mn-stat-label' });
    if (lead) words.appendChild(h('span', { className: 'sr', text: lead }));
    words.appendChild(h('span', { text: label }));
    return h('div', { className: 'mn-stat' }, [
      h('div', { className: 'mn-stat-value', text: value }),
      words
    ]);
  }

  function stats(data, summary, values) {
    var row = h('div', { className: 'mn-stats' });
    var avg = dailyAverage(data);
    if (avg !== null) row.appendChild(stat(money(avg, data, 2), 'Daily average'));

    var period = data.period || {};
    var through = parseDay(period.actualThrough);
    var start = parseDay(period.start);
    if (through && start) {
      var at = Math.round((through.getTime() - start.getTime()) / DAY_MS);
      var latest = at >= 0 && at < values.length ? values[at] : null;
      if (latest !== null) {
        row.appendChild(stat(money(latest, data, 2), monthDay(through), 'Latest billed day, '));
      }
    }

    var forecast = num((data.forecast || {}).micros);
    if (forecast !== null) {
      row.appendChild(stat(money(forecast, data, 0), 'Month-end forecast'));
    }

    var budget = budgetStat(summary, data);
    if (budget) row.appendChild(stat(budget.value, budget.label));
    return row.firstChild ? row : null;
  }

  function hero(data, summary) {
    var card = S.card('mn-hero');
    var micros = num((data.total || {}).micros);
    var values = dailyValues(data);

    card.appendChild(h('h2', { className: 'mn-kicker', text: 'Cloud spend' }));
    card.appendChild(h('div', {
      className: 'mn-total' + (micros === null ? ' is-words' : ''),
      text: micros === null ? NOT_REPORTED : money(micros, data, 2)
    }));
    var delta = deltaLine(data);
    if (delta) card.appendChild(h('div', { className: 'mn-delta', text: delta }));
    var row = stats(data, summary, values);
    if (row) card.appendChild(row);

    card.appendChild(h('h3', { className: 'mn-sub', text: 'Daily spend' }));
    card.appendChild(chart(values, data));
    return card;
  }

  /* ------------------------------------------------------------- the chart

     A line over the days it has a reading for, drawn as an SVG whose shape is
     the data and HTML marks for everything with text in it, so the type keeps
     its size when the chart narrows. The path breaks at a day with no reading
     and never drops to the floor through one. */

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  /* An axis that tops out strictly above the highest reading, so the peak
     never touches the top of the plot, in steps a person would write down:
     1, 2, 2.5 or 5 of a power of ten, the smallest that needs at most three
     intervals. */
  function yScale(values) {
    var present = values.filter(function (v) { return v !== null; });
    var top = Math.max.apply(null, present.concat([0]));
    var bottom = Math.min.apply(null, present.concat([0]));
    var ladder = [1, 2, 2.5, 5];
    var step = MICROS;
    var lo = 0;
    var hi = MICROS;
    for (var power = 0; power < 13; power += 1) {
      var found = false;
      for (var i = 0; i < ladder.length; i += 1) {
        step = Math.round(ladder[i] * MICROS * Math.pow(10, power));
        lo = bottom < 0 ? Math.floor(bottom / step) * step : 0;
        hi = (Math.floor(top / step) + 1) * step;
        if ((hi - lo) / step <= (bottom < 0 ? 4 : 3)) { found = true; break; }
      }
      if (found) break;
    }
    var ticks = [];
    for (var at = lo; at <= hi; at += step) ticks.push(at);
    return { lo: lo, hi: hi, step: step, ticks: ticks, digits: step % MICROS === 0 ? 0 : 2 };
  }

  /* First and last day, and the 10th and 20th between them when there is room
     for the label; a long window gets thirds, because a day of the month means
     nothing across a year. */
  function xTicks(count, start) {
    if (!start || count < 1) return [];
    var long = count > DOT_LIMIT;
    var picks = [{ i: 0, mid: false }];
    if (count > 1) {
      if (!long) {
        for (var i = 1; i < count - 1; i += 1) {
          var d = dayAt(start, i).getUTCDate();
          var at = i / (count - 1);
          if ((d === 10 || d === 20) && at >= 0.14 && at <= 0.86) picks.push({ i: i, mid: true });
        }
      } else {
        [1 / 3, 2 / 3].forEach(function (f) {
          picks.push({ i: Math.round((count - 1) * f), mid: true });
        });
      }
      picks.push({ i: count - 1, mid: false });
    }
    return picks.map(function (p) {
      var date = dayAt(start, p.i);
      return {
        i: p.i,
        mid: p.mid,
        label: monthDay(date) + (count > 120 ? ', ' + date.getUTCFullYear() : '')
      };
    });
  }

  function chartName(values, data, avg) {
    var present = values.filter(function (v) { return v !== null; });
    var start = parseDay((data.period || {}).start);
    var head = 'Daily spend';
    if (start && values.length) {
      head += ', ' + monthDay(start) + ' to ' + monthDay(dayAt(start, values.length - 1));
    }
    var last = null;
    values.forEach(function (v) { if (v !== null) last = v; });
    var sentence = head + '. Lowest ' + money(Math.min.apply(null, present), data, 2)
      + ', highest ' + money(Math.max.apply(null, present), data, 2)
      + ', latest ' + money(last, data, 2) + '.';
    if (avg !== null) sentence += ' Daily average ' + money(avg, data, 2) + '.';
    if (present.length < values.length) {
      sentence += ' ' + fmt.plural(values.length - present.length, 'day') + ' not reported.';
    }
    return sentence;
  }

  function chart(values, data) {
    var present = values.filter(function (v) { return v !== null; });
    if (!present.length) {
      return h('p', { className: 'mn-note', text: 'Daily figures not reported' });
    }

    var count = values.length;
    var avg = dailyAverage(data);
    var scale = yScale(values);
    var span = scale.hi - scale.lo;
    var px = function (i) { return count > 1 ? (i / (count - 1)) * 100 : 50; };
    var py = function (v) { return 100 - ((v - scale.lo) / span) * 100; };

    var lastIndex = -1;
    values.forEach(function (v, i) { if (v !== null) lastIndex = i; });
    var below = avg !== null && values[lastIndex] < avg;

    var node = h('div', {
      className: 'mn-chart' + (below ? ' is-below' : ''),
      role: 'img',
      'aria-label': chartName(values, data, avg)
    });
    var plot = h('div', { className: 'mn-plot' });
    var inner = h('div', { className: 'mn-inner' });

    scale.ticks.forEach(function (tick) {
      var at = py(tick).toFixed(2) + '%';
      var line = h('i', { className: 'mn-grid' + (tick === scale.lo ? ' is-base' : '') });
      line.style.setProperty('top', at);
      plot.appendChild(line);
      var label = h('span', { className: 'mn-y', text: money(tick, data, scale.digits) });
      label.style.setProperty('top', at);
      plot.appendChild(label);
    });

    var ticks = xTicks(count, parseDay((data.period || {}).start));
    ticks.forEach(function (tick) {
      var guide = h('i', { className: 'mn-vgrid' });
      guide.style.setProperty('left', px(tick.i).toFixed(2) + '%');
      inner.appendChild(guide);
    });

    var svg = svgEl('svg', {
      'class': 'mn-svg', viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true'
    });
    if (avg !== null) {
      var y = py(avg).toFixed(2);
      svg.appendChild(svgEl('path', { 'class': 'mn-avgline', d: 'M0 ' + y + ' L100 ' + y }));
    }
    var runs = [];
    var run = [];
    values.forEach(function (v, i) {
      if (v === null) {
        if (run.length) runs.push(run);
        run = [];
        return;
      }
      run.push([px(i), py(v)]);
    });
    if (run.length) runs.push(run);
    runs.forEach(function (one) {
      if (one.length < 2) return;
      svg.appendChild(svgEl('path', {
        'class': 'mn-line',
        d: one.map(function (p, i) {
          return (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2);
        }).join(' ')
      }));
    });
    inner.appendChild(svg);

    values.forEach(function (v, i) {
      if (v === null) return;
      var end = i === lastIndex;
      if (count > DOT_LIMIT && !end) return;
      var dot = h('i', { className: 'mn-dot' + (end ? ' is-end' : '') });
      dot.style.setProperty('left', px(i).toFixed(2) + '%');
      dot.style.setProperty('top', py(v).toFixed(2) + '%');
      inner.appendChild(dot);
      if (end) {
        var tag = h('span', { className: 'mn-val', text: money(v, data, 2) });
        tag.style.setProperty('left', px(i).toFixed(2) + '%');
        tag.style.setProperty('top', py(v).toFixed(2) + '%');
        inner.appendChild(tag);
      }
    });

    if (avg !== null) {
      var name = h('span', { className: 'mn-avg-label', text: 'Daily avg' });
      name.style.setProperty('top', py(avg).toFixed(2) + '%');
      inner.appendChild(name);
    }

    ticks.forEach(function (tick) {
      var label = h('span', { className: 'mn-x' + (tick.mid ? ' is-mid' : ''), text: tick.label });
      label.style.setProperty('left', px(tick.i).toFixed(2) + '%');
      inner.appendChild(label);
    });

    plot.appendChild(inner);
    node.appendChild(plot);
    return node;
  }

  /* ------------------------------------------------------- where it goes */

  function views(data) {
    return VIEW_ORDER.filter(function (key) {
      return list(((data.views || {})[key] || {}).rows).length > 0;
    });
  }

  function viewSwitch(keys, current, onPick) {
    var row = h('div', { className: 'seg mn-switch', role: 'group', 'aria-label': 'Group the bill by' });
    keys.forEach(function (key) {
      var on = key === current;
      var button = h('button', {
        className: on ? 'on' : '',
        type: 'button',
        'aria-pressed': on ? 'true' : 'false',
        text: VIEW_BUTTON[key] || key
      });
      button.setAttribute('data-view', key);
      button.addEventListener('click', function () { onPick(key); });
      row.appendChild(button);
    });
    return row;
  }

  function rowName(row, key) {
    if (key === 'category' && Object.prototype.hasOwnProperty.call(CATEGORY_NAMES, row.key)) {
      return CATEGORY_NAMES[row.key];
    }
    return text(row.label) || text(row.key) || NOT_REPORTED;
  }

  function billRow(row, key, data) {
    var micros = num(row.micros);
    var total = num((data.total || {}).micros);
    var share = num(row.shareBasisPoints);
    if (share === null && micros !== null && total !== null && total > 0) {
      share = Math.round(micros / total * 10000);
    }
    var ungrouped = row.ungrouped === true || row.key === 'ungrouped';
    var tone = ungrouped ? ' is-ungrouped' : (key === 'category' && row.key === 'ai_and_models' ? ' is-ai' : '');

    var item = h('li', { className: 'mn-row' + tone });
    var words = h('span', { className: 'mn-row-name' }, [h('span', { text: rowName(row, key) })]);
    var note = text(row.description) || (ungrouped ? UNMAPPED_NOTE : '');
    if (note) words.appendChild(h('span', { className: 'mn-row-note', text: note }));
    item.appendChild(words);
    item.appendChild(h('span', {
      className: 'mn-row-amt' + (micros === null ? ' is-words' : ''),
      text: micros === null ? NOT_REPORTED : money(micros, data, 2)
    }));
    if (micros !== null && micros > 0 && share !== null) {
      var fill = h('i');
      fill.style.setProperty('width', Math.max(0, Math.min(100, share / 100)).toFixed(2) + '%');
      item.appendChild(h('span', { className: 'mn-bar', 'aria-hidden': 'true' }, [fill]));
    }
    return item;
  }

  /* The rows are re-summed on the page and compared with the bill, and the
     page says so only when they differ: a figure nobody can check is not the
     claim this pane makes, and a line stating that things add up is noise
     until they do not. A row with no amount cannot be summed, which is itself
     the reason they do not add up. */
  function reconciliation(rows, data) {
    var total = num((data.total || {}).micros);
    if (total === null) return null;
    var sum = 0;
    var missing = false;
    rows.forEach(function (row) {
      var micros = num(row.micros);
      if (micros === null) missing = true;
      else sum += micros;
    });
    if (!missing && sum === total) return null;
    return h('p', {
      className: 'mn-note',
      text: missing
        ? 'Some rows have no amount, so these rows do not add up to ' + money(total, data, 2) + '.'
        : 'These rows add up to ' + money(sum, data, 2) + ' of ' + money(total, data, 2) + '.'
    });
  }

  function whereCard(data, key, keys, onPick) {
    var rows = list(((data.views || {})[key] || {}).rows);
    var card = S.card('mn-where');
    card.appendChild(S.cardHead('Where it goes'));
    var body = h('div', { className: 'mn-where-body' });
    if (keys.length > 1) body.appendChild(viewSwitch(keys, key, onPick));
    var rowList = h('ul', { className: 'mn-rows' });
    rows.forEach(function (row) { rowList.appendChild(billRow(row, key, data)); });
    body.appendChild(rowList);
    var gap = reconciliation(rows, data);
    if (gap) body.appendChild(gap);
    card.appendChild(body);
    return card;
  }

  function render(data, summary, viewKey, onPick) {
    var grid = h('div', { className: 'mn-layout' });
    grid.appendChild(hero(data, summary));
    var keys = views(data);
    if (keys.length) {
      var key = keys.indexOf(viewKey) === -1 ? keys[0] : viewKey;
      grid.appendChild(whereCard(data, key, keys, onPick));
    }
    return grid;
  }

  /* ---------------------------------------------------------- the states */

  /* Nothing billed, and which of the reasons it is decides what the pane says.
     The route's own `detail` is the sentence in every case, because it is the
     only thing that knows; the title is the pane's, because these are
     different states and a title is how a state is named. */
  var EMPTY_STATES = {
    not_published: {
      icon: 'clock',
      title: 'Nothing billed yet',
      fallback: 'The billing export has not published anything for this period.'
    },
    unconfigured: {
      icon: 'plug',
      title: 'Cost collection is not set up',
      fallback: 'No subscription is configured for cost collection.'
    },
    disabled: {
      icon: 'x',
      title: 'Cost collection is switched off',
      fallback: 'Cost collection is switched off for every subscription.'
    },
    mixed_currency: {
      icon: 'warn',
      title: 'Billed in more than one currency',
      fallback: 'There is no single total to show, and the groupings cannot be added together.'
    }
  };

  function stateCard(block) {
    var card = S.card('mn-state');
    card.appendChild(block);
    return card;
  }

  S.definePane(PANE_ID, function (content) {
    var region = S.region(content);
    var inFlight = 0;
    var latest = null;
    var latestSummary = null;
    var viewKey = DEFAULT_VIEW;
    var range = urlRange() || OPEN_RANGE;
    /* Whether somebody chose this window, by the picker or by the address. A
       window nobody chose may be swapped for the closed month when the open
       one has nothing in it yet; one somebody chose is answered as asked. */
    var chosen = urlRange() !== null;

    var select = h('select', { id: 'fPeriod', 'aria-label': 'Billing period' });
    var options = RANGES.map(function (key) {
      var option = h('option', { value: key, text: rangeLabel(key) });
      select.appendChild(option);
      return option;
    });
    var meta = h('span', { className: 'mn-meta' });

    function syncPicker() {
      options.forEach(function (option, i) {
        option.textContent = rangeLabel(RANGES[i]);
      });
      select.value = range;
    }

    function drawHead(stamp) {
      var slot = document.getElementById('pageSub');
      if (!slot) return;
      while (slot.firstChild) slot.removeChild(slot.firstChild);
      var date = stamp ? headDate(stamp) : null;
      var updated = stamp ? updatedAt(stamp) : null;
      if (date) slot.appendChild(h('span', { className: 'sub-date', text: date }));
      if (updated) slot.appendChild(h('span', { className: 'sub-updated', text: updated }));
    }

    function drawMeta(data, effective) {
      while (meta.firstChild) meta.removeChild(meta.firstChild);
      if (!data) return;
      var parts = metaParts(data, effective);
      if (parts.length) meta.appendChild(h('span', { text: parts.join(' \u00B7 ') }));
      [freshness(data), pollerNote(data)].forEach(function (note) {
        if (note) meta.appendChild(note);
      });
    }

    function skeleton() {
      region.loading([
        { type: 'block', height: 200 },
        { type: 'block', height: 260 }
      ]);
    }

    /* Switching grouping redraws from the answer already in hand rather than
       re-reading: it is three cuts of one bill, so a second request would
       fetch the same bytes and put a skeleton over a question the page has
       already answered. */
    function pick(key) {
      viewKey = key;
      if (!latest) return;

      /* The button that was just pressed is destroyed by the redraw below, so
         a keyboard operator would be dropped to the top of the document on
         every switch for the pane's only in-page control. Only when focus WAS
         on the switch: a pointer user has focus nowhere in particular and
         moving it there would be a jump they did not ask for. */
      var host = document.getElementById('content');
      var live = document.activeElement;
      var wasOnSwitch = !!(live && live.getAttribute && live.getAttribute('data-view') !== null);

      region.show(render(latest, latestSummary, viewKey, pick));

      if (wasOnSwitch && host) {
        var again = host.querySelectorAll('[data-view="' + key + '"]')[0];
        if (again && again.focus) again.focus();
      }
      S.announce('The bill is now grouped by ' + (VIEW_BUTTON[key] || key) + '.');
    }

    /* The target, read beside the bill rather than after it, so the budget
       costs the pane no second round trip of skeleton. Its failure is
       swallowed here rather than raised: this read answers a different
       question, and a summary the API refused must not turn a perfectly good
       bill into a failure card. `null` draws nothing. */
    function target() {
      return S.read({ paneId: SUMMARY_FIXTURE_ID, endpoint: SUMMARY_ENDPOINT })
        .then(function (answer) {
          return (answer && answer.data) || null;
        }, function () { return null; });
    }

    /* The range has to travel. The cost route defaults an absent range to this
       month, so a pane that sent no querystring would draw this month's bill
       under whatever the picker said, with nothing on screen admitting the
       selection had been ignored. */
    function ask(which) {
      return S.read({ paneId: PANE_ID, endpoint: ENDPOINT, query: { range: which } })
        .then(function (answer) { return (answer && answer.data) || {}; });
    }

    function stateOf(data) { return text((data.availability || {}).state); }

    function notReady(data, state) {
      var known = state && Object.prototype.hasOwnProperty.call(EMPTY_STATES, state)
        ? EMPTY_STATES[state]
        : null;
      var detail = diagnostic((data.availability || {}).detail);

      if (!known) {
        /* A state outside the route's vocabulary is not read as one of the
           known ones. Picking the nearest would draw a guess with the same
           confidence as a fact. */
        region.empty(stateCard(S.stateBlock('warn', 'This answer is not one this pane can read', [
          detail || 'The cost route answered with a state this pane does not recognise, so ' +
            'nothing here can be read as this period\u2019s bill.'
        ])));
        return;
      }

      var block = S.stateBlock(known.icon, known.title, [detail || known.fallback]);
      /* A closed month is the one window that is always fully published, so it
         answers "is anything arriving at all" when this period's is not. */
      if (state === 'not_published' && range !== CLOSED_RANGE) {
        var way = h('button', { className: 'btn btn-sm', type: 'button', text: 'Show last month' });
        way.addEventListener('click', function () { choose(CLOSED_RANGE); });
        block.appendChild(h('div', { className: 'row mt-sm' }, [way]));
      }
      region.empty(stateCard(block));
    }

    function settle(data, summary, effective) {
      range = effective;
      learnMonths(data, effective);
      syncPicker();

      var state = stateOf(data);
      if (state !== 'ready') {
        latest = null;
        latestSummary = null;
        /* Only a period that is waiting on the export has a collection to
           report on. The other states say there is none. */
        var waiting = state === 'not_published';
        drawHead(waiting ? text(data.asOf) : null);
        drawMeta(waiting ? data : null, effective);
        notReady(data, state);
        return;
      }
      latest = data;
      latestSummary = summary;
      drawHead(text(data.asOf));
      drawMeta(data, effective);
      region.show(render(data, summary, viewKey, pick));
      S.announce('Cost figures updated for ' + rangeLabel(effective) + '.');
    }

    function load() {
      var token = ++inFlight;
      var asked = range;
      skeleton();

      Promise.all([ask(asked), target()]).then(function (both) {
        if (token !== inFlight) return null;
        var data = both[0];
        var summary = both[1];

        /* The first of a month has nothing billed in it yet, and the last
           month's closing day is the honest latest. Only for a window nobody
           chose, and a failure here leaves the answer already in hand. */
        if (!chosen && asked === OPEN_RANGE && stateOf(data) === 'not_published') {
          return ask(CLOSED_RANGE).then(function (closed) {
            if (token !== inFlight) return;
            settle(closed, summary, CLOSED_RANGE);
          }, function () {
            if (token !== inFlight) return;
            settle(data, summary, asked);
          });
        }
        settle(data, summary, asked);
        return null;
      }).catch(function (error) {
        if (token !== inFlight) return;
        latest = null;
        latestSummary = null;
        drawHead(null);
        drawMeta(null);
        region.failed(error, load);
      });
    }

    function choose(next) {
      range = next;
      chosen = true;
      writeUrl(next);
      syncPicker();
      load();
    }

    select.addEventListener('change', function () { choose(select.value); });
    syncPicker();
    S.paneFilters([h('div', { className: 'sel mn-period' }, [select, S.icon('chev')]), meta]);

    /* The bootstrap fires ops:filters with the starting selection once the
       shell is in the document, so the first read is that event rather than a
       call from here: reading twice on boot would double every request and
       leave the two answers racing. The skeleton goes up now because the
       listener is added before the event and the region would otherwise be
       blank until the answer lands. */
    skeleton();
    global.addEventListener('ops:filters', load);
  });
}(window));
