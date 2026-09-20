/* People and usage: who is using Aria, is that growing, do they come back.

   Drawn on the v2 design system through assets/shell-pane-v2.js. The pane
   holds no session, filter or navigation logic of its own, and it reads
   GET /api/ops/usage unchanged: this is a surface remodel, not a contract
   change. Nothing on screen is computed from a field the route does not send.

   Five rules from that contract are load bearing here rather than decorative,
   and four of them are rules about NOT drawing something:

     1. **A rate over a small group is not drawn at all.** Anything measured
        over a group carries its denominator, and under the reporting floor the
        pane prints why instead of a percentage. What makes a figure a rate is
        the denominator travelling with it, not the label the pipeline gave it:
        a ratio delivered as a decimal is still a ratio, and in the first build
        of this pane that walked straight past the guard.
     2. **Empty never means zero.** `availability.state` gates the whole pane,
        and a window with no stored days shows its stored-day figures as not
        reported rather than as 0 - a zero there says the apps ran and nobody
        did anything.
     3. **Mobile and Coaches Web are never summed.** The chart is one line per
        app over a shared x scale and the split card is independent columns;
        no row anywhere adds them. Somebody who used both is one person.
     4. **A missing day breaks the line** instead of dropping it to the floor,
        and the days themselves are named under the chart.
     5. **How old the answer is travels with the figures.** The count is
        nightly, so a poller a run behind would otherwise serve yesterday's
        figures as today's with nothing on screen saying so. The age sits in
        the head of the band the headline numbers are in, and turns from a
        plain stamp into a warning past STALE_AFTER_HOURS.

   Consent gating is not here. It happens at ingest, and a second gate on the
   display side would be a second place that decision is made and a second
   place it can be made differently.

   Charts are drawn in this file rather than by assets/aria.js, and painted
   from CSS classes rather than from custom properties resolved in script, so
   they follow the theme button with no redraw pass at all. The accessible NAME
   carries the data: role="img" is children-presentational, so the <text> inside
   one of these is announced to nobody. */
(function (global) {
  'use strict';

  var S = global.OpsPaneShell;
  var h = S.h;
  var fmt = S.fmt;

  var PANE_ID = 'analytics';
  var ENDPOINT = '/api/ops/usage';

  /* The reporting floor: a rate over fewer than this many people is not
     published. The same floor ops/README.md documents for this route.
     scripts/ops-analytics-v2.test.mjs pins both sides of the boundary, 49
     withheld and 50 published, so the constant cannot drift without a test
     saying so. */
  var REPORTING_FLOOR = 50;

  /* The recount runs nightly, so an answer older than this has missed a whole
     run rather than having been read mid-run. */
  var STALE_AFTER_HOURS = 36;

  /* Most days named in full before the list is summarised: long enough to be
     useful on a week with a couple of holes, short enough that a 90 day window
     with a stalled job does not print a paragraph of dates. */
  var MAX_LISTED_GAP_DAYS = 8;

  /* The palette names the route sends, against the tone classes in
     assets/aria.css. An unknown name falls back rather than keying a custom
     property that does not exist, which is what an unpainted shape is. */
  var SERIES_TONE = {
    s1: 'cyan', s2: 'violet', s3: 'emerald', s4: 'amber', s5: 'rose', s6: 'blue',
    muted: 'muted'
  };
  var FALLBACK_TONE = 'cyan';

  function toneClass(name) {
    return 'tone-' + (Object.prototype.hasOwnProperty.call(SERIES_TONE, name)
      ? SERIES_TONE[name]
      : FALLBACK_TONE);
  }

  /* --------------------------------------------------------------- values */

  function num(value) {
    return (typeof value === 'number' && isFinite(value)) ? value : null;
  }

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  /* Whether a group is big enough for a rate over it to be published. */
  function reportable(size) {
    return num(size) !== null && size >= REPORTING_FLOOR;
  }

  /* Anything measured over a group. The denominator is the signal rather than
     the kind, because a ratio arriving as a decimal is still a ratio. */
  function overGroup(metric) {
    return metric.kind === 'rate' || num(metric.denominator) !== null;
  }

  function seconds(value) {
    var whole = Math.round(value);
    var mins = Math.floor(whole / 60);
    var secs = whole % 60;
    return mins ? mins + 'm ' + secs + 's' : secs + 's';
  }

  function metricValue(metric) {
    var value = num(metric.value);
    if (value === null) return fmt.none;
    if (metric.kind === 'money') return fmt.money(value, metric.currency);
    if (metric.kind === 'rate') return fmt.percent(value, metric.digits);
    if (metric.kind === 'seconds') return seconds(value);
    if (metric.kind === 'decimal') {
      return value.toFixed(num(metric.digits) === null ? 1 : metric.digits);
    }
    return fmt.int(value);
  }

  function people(size) {
    return fmt.plural(num(size) === null ? 0 : size, 'person', 'people');
  }

  /* Why a figure is missing, in the place the figure would have been. */
  /* Why a figure is not on screen, as a phrase rather than a sentence: the
     tile prints "Not reported" above it and repeating the two words in the
     line underneath spends a whole slot saying the same thing twice, while a
     row in a table has no room for two lines and takes the whole of it. */
  function suppressionReason(size) {
    if (num(size) === null) return 'the group behind it was not given';
    return people(size) + ' in the group, floor is ' + REPORTING_FLOOR;
  }

  var NOT_REPORTED = 'Not reported';

  function notReported(reason) {
    return NOT_REPORTED + ', ' + reason;
  }

  /* The same phrase standing on its own, under a value that already says the
     figure is not there. */
  function sentence(phrase) {
    return phrase.charAt(0).toUpperCase() + phrase.slice(1);
  }

  /* ----------------------------------------------------------- the window */

  /* Three separate facts, kept separate because they are answered differently.
     `days` is what the operator asked for. `daysCovered` is how much of it this
     pipeline has ever been able to write, because the nightly aggregation
     started on a particular day and a 90 day window opened today reaches back
     past its own lifetime. `daysMissingRollups` is the real gap: days at or
     after the first covered one that carry no stored figures. */
  function windowSpan(data) {
    var w = data.window;
    if (!w || typeof w !== 'object') return null;
    var covered = num(w.daysCovered);
    if (covered === null) return null;
    return {
      covered: covered,
      days: num(w.days),
      start: typeof w.reportingStart === 'string' ? w.reportingStart : null,
      missing: list(w.daysMissingRollups).filter(function (day) {
        return typeof day === 'string';
      })
    };
  }

  /* Not one day of the chosen window has been aggregated. Its own question
     rather than a shade of the one above: the route reports this as
     `reportingStart: null` with `daysCovered: 0` and still calls itself ready,
     because the people figures are read live from accounts and can clear the
     floor while nothing at all has been rolled up. */
  function hasNoStoredDays(data) {
    var span = windowSpan(data);
    return !!span && span.covered === 0;
  }

  function windowPhrase(data) {
    var span = windowSpan(data);
    var days = span ? span.days : null;
    return days === null ? 'the selected window' : 'the last ' + fmt.plural(days, 'day');
  }

  /* The same window as a caption: the chart's only one. */
  function windowNote(data) {
    var span = windowSpan(data);
    var days = span ? span.days : null;
    return days === null ? 'Selected window' : 'Last ' + fmt.plural(days, 'day');
  }

  function listDays(days) {
    var shown = days.slice(0, MAX_LISTED_GAP_DAYS).map(function (day) {
      return fmt.utcDay(day) || day;
    });
    var rest = days.length - shown.length;
    return shown.join(', ') + (rest > 0 ? ', and ' + fmt.int(rest) + ' more' : '');
  }

  /* Which figures are counted from the stored day grain.

     Matched on the label because that is the only signal there is: the metric
     union carries a kind and, for anything over a group, a denominator, and
     neither says where the number came from. Named exactly rather than by
     substring, so a future figure that merely mentions sessions in its label is
     not silently withheld. Consulted only when the window has no stored days at
     all AND the value is zero, so a relabelled metric fails towards showing the
     figure rather than towards hiding one. Where this belongs is a provenance
     field in the payload, and that is the change to make when a third such
     figure arrives. */
  var FROM_STORED_DAYS = ['Sessions', 'Sessions per person'];

  function fromStoredDays(metric) {
    return typeof metric.label === 'string' &&
      FROM_STORED_DAYS.indexOf(metric.label) !== -1;
  }

  function storedDayGap(metric, noStoredDays) {
    return noStoredDays && fromStoredDays(metric) && metric.value === 0;
  }

  /* Whether this figure is withheld, and why, in one answer so that the tile,
     the column and the footnote cannot disagree about it. */
  function withheld(metric, noStoredDays) {
    if (storedDayGap(metric, noStoredDays)) {
      return 'no day in this window has stored figures';
    }
    if (overGroup(metric) && !reportable(metric.denominator)) {
      return suppressionReason(metric.denominator);
    }
    return null;
  }

  /* ------------------------------------------------------------ the read */

  function source() {
    var now = S.filters();
    return {
      paneId: PANE_ID,
      endpoint: ENDPOINT,
      query: { scope: now.scope, range: now.range, env: now.env }
    };
  }

  /* A link to this pane with one part of the selection changed. The only
     navigation this pane performs, and both uses of it are an offer to widen a
     selection that is itself the reason a block has nothing in it. */
  function hrefWith(key, value) {
    var now = S.filters();
    var query = { scope: now.scope, range: now.range, env: now.env };
    query[key] = value;
    var parts = [];
    Object.keys(query).forEach(function (name) {
      if (query[name]) {
        parts.push(encodeURIComponent(name) + '=' + encodeURIComponent(query[name]));
      }
    });
    return (S.panes[PANE_ID] || {}).file + (parts.length ? '?' + parts.join('&') : '');
  }

  function widestRange() {
    var ranges = list((S.panes[PANE_ID] || {}).range);
    return ranges.length ? ranges[ranges.length - 1] : null;
  }

  /* ---------------------------------------------------------------- charts */

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    var node = global.document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (key) {
      node.setAttribute(key, String(attrs[key]));
    });
    return node;
  }

  var CHART_W = 720;
  var CHART_H = 210;
  var PAD_L = 8, PAD_R = 10, PAD_T = 10, PAD_B = 8;

  /* One line per app over a shared x scale. Consecutive readings become one
     path; a gap ends the path and the next reading starts a new one, so a day
     with no reading is the absence of a stroke rather than a stroke drawn
     through nothing. */
  function lineChart(series, data) {
    var iw = CHART_W - PAD_L - PAD_R;
    var ih = CHART_H - PAD_T - PAD_B;

    var hi = 0;
    var span = 0;
    series.forEach(function (one) {
      var values = list(one.values);
      if (values.length > span) span = values.length;
      values.forEach(function (v) {
        var n = num(v);
        if (n !== null && n > hi) hi = n;
      });
    });
    hi = hi * 1.14 || 1;

    /* Stretched to the box rather than scaled to its own aspect, so the
       drawing is as tall on a phone as it is on a laptop and the gridlines
       keep the spacing the labels beside them are set in. Every stroke in
       here carries non-scaling-stroke in CSS, which is what keeps a line 2px
       wide and a dash pattern square under a scale that is not the same in
       both directions. */
    var svg = svgEl('svg', {
      'class': 'chart',
      viewBox: '0 0 ' + CHART_W + ' ' + CHART_H,
      preserveAspectRatio: 'none',
      role: 'img',
      'aria-label': chartName(series, data)
    });

    /* The scale is HTML beside the picture rather than <text> inside it, for
       two reasons that both matter. The svg is scaled to the width of the card,
       so text inside it is scaled with it and lands at about four pixels on a
       375px screen; and role="img" is children-presentational, so text inside
       one is announced to nobody however large it is. Out here it is real text
       at a real size, positioned against the same gridlines. */
    var axis = h('div', { className: 'ln-axis', 'aria-hidden': 'true' });

    var ticks = 4;
    for (var i = 0; i <= ticks; i++) {
      var y = PAD_T + ih - (i / ticks) * ih;
      var gridline = svgEl('line', {
        'class': 'gridline', x1: PAD_L, y1: y.toFixed(1), x2: CHART_W - PAD_R, y2: y.toFixed(1)
      });
      if (i !== 0) gridline.setAttribute('stroke-dasharray', '2 4');
      svg.appendChild(gridline);

      var label = h('span', {
        className: 'ln-tick num',
        text: fmt.int(Math.round(hi * i / ticks))
      });
      /* The gridline's own height in the viewBox, as a percentage. The scale
         column is the height of the drawing beside it, so the two stay
         registered at every width without measuring anything. */
      label.style.setProperty('top', ((y / CHART_H) * 100).toFixed(2) + '%');
      axis.appendChild(label);
    }

    series.forEach(function (one) {
      /* The app keys the group, so which line belongs to which app is a fact in
         the document rather than only a colour: the tones repeat across panes
         and two apps can be sent the same one. */
      var group = svgEl('g', {
        'class': toneClass(one.color),
        'data-series': one.label || ''
      });
      var values = list(one.values);
      var x = function (index) {
        return PAD_L + (span > 1 ? (index / (span - 1)) * iw : iw / 2);
      };
      var y2 = function (v) { return PAD_T + ih - (v / hi) * ih; };

      var run = [];
      var flush = function () {
        if (run.length > 1) {
          group.appendChild(svgEl('path', {
            'class': 'ln',
            d: run.map(function (point, index) {
              return (index ? 'L' : 'M') + point[0].toFixed(2) + ' ' + point[1].toFixed(2);
            }).join(' ')
          }));
        } else if (run.length === 1) {
          /* A single reading between two gaps has no line to belong to, and
             drawing nothing for it would hide a day that was measured. A
             zero-length path with a round cap rather than a circle: the
             drawing is stretched to its box, and a circle would be drawn as
             an ellipse while a stroke cap stays round. */
          group.appendChild(svgEl('path', {
            'class': 'ln-pt',
            d: 'M' + run[0][0].toFixed(2) + ' ' + run[0][1].toFixed(2)
              + 'L' + run[0][0].toFixed(2) + ' ' + run[0][1].toFixed(2)
          }));
        }
        run = [];
      };

      values.forEach(function (v, index) {
        var n = num(v);
        if (n === null) { flush(); return; }
        run.push([x(index), y2(n)]);
      });
      flush();
      svg.appendChild(group);
    });

    return h('div', { className: 'ln-wrap' }, [axis, svg]);
  }

  /* The chart's accessible name, and the only place its data is announced.

     Every series says how much of the window it has a reading for, its range
     and its last reading, because none of that reaches a screen reader from the
     <text> nodes inside a role="img". A series with no reading at all says so
     rather than being left out of the name. */
  function chartName(series, data) {
    return trendLabel(series) + ', one line per app, over ' + windowPhrase(data) + '. ' +
      series.map(seriesSentence).join(' ');
  }

  function seriesSentence(one) {
    var name = one.label || 'This app';
    var values = list(one.values);
    var reported = [];
    var lastIndex = -1;
    values.forEach(function (v, index) {
      var n = num(v);
      if (n === null) return;
      reported.push(n);
      lastIndex = index;
    });

    if (!reported.length) {
      return name + ': no reading on any of ' + fmt.plural(values.length, 'day') + '.';
    }
    var lo = Math.min.apply(null, reported);
    var high = Math.max.apply(null, reported);
    return name + ': ' + fmt.int(reported.length) + ' of ' +
      fmt.plural(values.length, 'day') + ' with a reading, ' +
      (lo === high ? 'flat at ' + fmt.int(lo) : 'low ' + fmt.int(lo) + ', high ' + fmt.int(high)) +
      ', ending ' + fmt.int(values[lastIndex]) + '.';
  }

  /* What the lines are of, taken from the answer rather than written here. The
     apps have to agree before it can be said once over the whole chart. */
  function trendLabel(series) {
    var labels = series.map(function (one) { return one.trendLabel || ''; })
      .filter(function (label) { return !!label; });
    var first = labels[0] || 'Daily activity';
    var agreed = labels.length === series.length && labels.every(function (label) {
      return label === first;
    });
    return agreed ? first : 'Daily activity by app';
  }

  function chartSeries(data) {
    return list(data.apps).filter(function (app) {
      return app.trend && list(app.trend.values).length > 0;
    }).map(function (app) {
      return {
        label: app.label,
        color: app.trend.color,
        values: list(app.trend.values),
        trendLabel: app.trend.label
      };
    });
  }

  function drawable(series) {
    return series.some(function (one) {
      return one.values.filter(function (v) { return num(v) !== null; }).length > 1;
    });
  }

  /* A tile's sparkline: the same series the chart below names in full, which is
     why it is hidden from the accessible tree rather than named again here.
     Drawn only when every day has a reading, because a line this small has no
     room for a break and a stroke drawn straight through a gap is a claim about
     a day on which nothing was measured. */
  function spark(values, color) {
    var points = list(values);
    if (points.length < 2) return null;
    if (points.some(function (v) { return num(v) === null; })) return null;

    var w = 132, height = 34, pad = 3;
    var hi = Math.max.apply(null, points);
    var lo = Math.min.apply(null, points);
    var range = (hi - lo) || 1;
    var svg = svgEl('svg', {
      'class': 'chart spark ' + toneClass(color),
      viewBox: '0 0 ' + w + ' ' + height,
      preserveAspectRatio: 'none',
      'aria-hidden': 'true',
      focusable: 'false'
    });
    svg.appendChild(svgEl('path', {
      'class': 'ln',
      d: points.map(function (v, index) {
        var x = pad + (index / (points.length - 1)) * (w - pad * 2);
        var y = pad + (1 - (v - lo) / range) * (height - pad * 2);
        return (index ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2);
      }).join(' ')
    }));
    return svg;
  }

  /* --------------------------------------------------------- how old it is */

  /* The age of the answer, in the head of the band its figures are in.

     Three outcomes, and they are different statements: no timestamp at all, a
     timestamp from the last run, and a timestamp old enough that a whole run
     has been missed. The last one carries the age in words, not a colour. */
  function freshness(data) {
    var hours = fmt.hoursSince(data.asOf);
    var stamp = fmt.utcStamp(data.asOf);
    if (hours === null || stamp === null) {
      return h('span', { className: 'pill warn' }, [
        S.icon('warn'), h('span', { text: 'Counted at an unreported time' })
      ]);
    }
    if (hours >= STALE_AFTER_HOURS) {
      return h('span', { className: 'pill warn' }, [
        S.icon('warn'),
        h('span', { text: fmt.hours(hours) + ' behind, counted ' + stamp })
      ]);
    }
    return h('span', { className: 'pill' }, [
      S.icon('clock'), h('span', { text: 'Counted ' + stamp })
    ]);
  }

  /* --------------------------------------------------------------- tiles */

  /* The headline figures, taken from the first app in the answer and labelled
     with it. A tile is one app's figure with the other apps' readings under it,
     never a total: somebody who used both apps is one person. */
  function tiles(data) {
    var apps = list(data.apps);
    var lead = apps[0];
    if (!lead) return null;
    var noStored = hasNoStoredDays(data);

    var grid = h('div', { className: 'grid g4' });
    list(lead.metrics).slice(0, 4).forEach(function (metric) {
      grid.appendChild(tile(metric, lead, apps.slice(1), noStored));
    });
    return grid;
  }

  function tile(metric, lead, others, noStored) {
    var card = S.card('kpi');
    var body = h('div', { className: 'card-body' }, [
      h('h3', { className: 'kpi-label', text: metric.label })
    ]);
    card.appendChild(body);

    var reason = withheld(metric, noStored);
    if (reason) {
      /* Words, not a number, and the reason in the place the comparison would
         have been. The other apps' readings are left out of this tile on
         purpose: a figure printed under "Not reported" is read as the tile's
         own. Every app's copy of this figure, withheld or not, is in the split
         card below. */
      body.appendChild(h('div', { className: 'kpi-val is-absent', text: NOT_REPORTED }));
      card.appendChild(h('div', { className: 'kpi-foot' }, [
        h('span', { text: sentence(reason) })
      ]));
      return card;
    }

    body.appendChild(h('div', { className: 'kpi-val num', text: metricValue(metric) }));

    var meta = h('div', { className: 'kpi-meta' }, [
      h('span', { className: 'pill', text: lead.label })
    ]);
    if (lead.trend && lead.trend.label === metric.label) {
      var line = spark(lead.trend.values, lead.trend.color);
      if (line) meta.appendChild(h('span', { className: 'kpi-spark' }, [line]));
    }
    body.appendChild(meta);

    var rest = others.map(function (app) {
      var match = list(app.metrics).filter(function (one) {
        return one.label === metric.label;
      })[0];
      if (!match) return null;
      return app.label + ' ' + (withheld(match, noStored)
        ? NOT_REPORTED.toLowerCase()
        : metricValue(match));
    }).filter(function (text) { return !!text; });

    if (rest.length) {
      card.appendChild(h('div', { className: 'kpi-foot' }, [
        h('span', { text: rest.join(' \u00b7 ') })
      ]));
    }
    return card;
  }

  /* ---------------------------------------------------------- the trend */

  function trendCard(data) {
    var series = chartSeries(data);
    var span = windowSpan(data);
    var card = S.card();

    var legend = h('div', { className: 'legend' }, series.map(function (one) {
      return h('span', { className: toneClass(one.color) }, [
        h('i', { 'aria-hidden': 'true' }), h('span', { text: one.label })
      ]);
    }));

    card.appendChild(S.cardHead(trendLabel(series), windowNote(data),
      series.length ? [legend] : []));

    var body = h('div', { className: 'card-body' });
    if (drawable(series)) {
      body.appendChild(lineChart(series, data));
    } else {
      body.appendChild(S.stateBlock('chart', 'Not enough days to draw a line', [
        'Two days with a reading are needed before a line means anything.'
      ], 4));
    }
    card.appendChild(body);

    if (span && span.missing.length) {
      card.appendChild(h('div', { className: 'card-foot' }, [
        S.icon('warn'),
        h('span', { text: 'No stored figures on ' + listDays(span.missing) })
      ]));
    }
    return card;
  }

  /* ------------------------------------------------------------ the split */

  /* One column per app: independent columns with no row that adds them.
     A single app is not an empty comparison, it is a comparison that cannot
     exist, so it says that rather than drawing one column and calling it a
     split. */
  function splitCard(data) {
    var apps = list(data.apps);
    var noStored = hasNoStoredDays(data);
    var card = S.card();

    if (apps.length < 2) {
      var block = S.stateBlock('layers', 'No split to draw', [
        apps.length === 1
          ? 'Only ' + apps[0].label + ' is in this selection, so there is nothing to compare it with.'
          : 'No app reported over this window.'
      ], 3);
      if (apps.length === 1 && S.filters().scope !== 'all') {
        block.appendChild(h('div', { className: 'row mt-sm' }, [
          S.link(hrefWith('scope', 'all'), 'Show every app')
        ]));
      }
      card.appendChild(block);
      return card;
    }

    card.appendChild(S.cardHead('Side by side', null, []));
    card.appendChild(h('div', { className: 'card-body' }, [
      h('div', { className: 'u-vs' }, apps.map(function (app) {
        return appColumn(app, noStored);
      }))
    ]));
    return card;
  }

  function appColumn(app, noStored) {
    var metrics = list(app.metrics);
    var lead = metrics[0];

    var head = h('div', { className: 'u-vs-head' }, [
      h('h4', { className: 'u-vs-name' }, [
        h('i', {
          className: 'dot ' + toneClass(app.trend && app.trend.color),
          'aria-hidden': 'true'
        }),
        h('span', { text: app.label })
      ])
    ]);

    /* Coverage is a share of sessions on a reporting app version rather than a
       rate over people, so the reporting floor does not apply to it. What does
       apply is that an unreported coverage is not a shortfall: it says so. */
    var coverage = num(app.coverageBasisPoints);
    head.appendChild(h('span', {
      className: 'pill' + (coverage !== null && coverage < 10000 ? ' warn' : ''),
      text: coverage === null ? 'Coverage not reported'
        : coverage === 10000 ? 'Every session reports'
        : fmt.percent(coverage) + ' of sessions report'
    }));

    var column = h('div', { className: 'u-vs-side' }, [head]);

    if (lead) {
      var leadReason = withheld(lead, noStored);
      column.appendChild(h('div', { className: 'u-vs-big' }, [
        h('div', {
          className: 'u-vs-val num' + (leadReason ? ' is-absent' : ''),
          text: leadReason ? NOT_REPORTED : metricValue(lead)
        }),
        h('div', { className: 'u-vs-cap', text: leadReason ? sentence(leadReason) : lead.label })
      ]));
    }

    var rows = h('div', { className: 'u-vs-rows' });
    metrics.slice(1).forEach(function (metric) {
      var reason = withheld(metric, noStored);
      /* The reason is the value when there is no figure: a bare "Not reported"
         beside a label the operator can see a figure for in the other column
         reads as a gap in the pipeline rather than as a decision this pane
         made, and a title attribute is not on screen at all. */
      rows.appendChild(h('div', { className: 'u-vs-row' }, [
        h('span', { className: 'u-vs-k', text: metric.label }),
        h('span', {
          className: 'u-vs-v num' + (reason ? ' is-absent' : ''),
          text: reason ? notReported(reason) : metricValue(metric)
        })
      ]));
    });
    column.appendChild(rows);
    return column;
  }

  /* --------------------------------------------------------- do they return */

  /* The tint bands the cells are shaded in. The number is printed in every
     cell, so the shade is a second reading of a figure that is already there
     rather than the only way to read it. */
  var COHORT_BANDS = [4000, 5000, 6000, 7000];

  function intensity(basisPoints) {
    var level = 1;
    COHORT_BANDS.forEach(function (edge) {
      if (basisPoints >= edge) level += 1;
    });
    return 'u-i' + level;
  }

  function cohortCard(cohort) {
    var offsets = list(cohort.offsets);
    var card = S.card();
    card.appendChild(S.cardHead(cohort.label || 'Who comes back', cohort.app || null, []));

    var headRow = h('tr', {}, [
      h('th', { scope: 'col', className: 'u-when', text: 'Week joined' }),
      h('th', { scope: 'col', className: 'r u-size', text: 'People' })
    ]);
    offsets.forEach(function (offset) {
      headRow.appendChild(h('th', {
        scope: 'col', className: 'r', text: offsetLabel(offset)
      }));
    });

    var body = h('tbody');
    list(cohort.rows).forEach(function (row) {
      body.appendChild(cohortRow(row, offsets.length));
    });

    card.appendChild(h('div', { className: 'card-body' }, [
      h('div', { className: 'u-scroll' }, [
        h('table', { className: 'tbl u-cohort' }, [h('thead', {}, [headRow]), body])
      ])
    ]));
    return card;
  }

  function offsetLabel(offset) {
    var n = num(offset);
    return n === null ? String(offset) : 'Week ' + n;
  }

  function cohortRow(row, cells) {
    var tr = h('tr', {}, [
      h('th', { scope: 'row', text: row.label }),
      h('td', {
        className: 'r num',
        text: num(row.size) === null ? fmt.none : fmt.int(row.size)
      })
    ]);

    /* A group under the floor is withheld as a whole row rather than cell by
       cell: every cell in it is a rate over the same handful of people. */
    if (!reportable(row.size)) {
      tr.appendChild(h('td', {
        className: 'u-sup', colspan: String(Math.max(cells, 1))
      }, [
        /* The flex row is inside the cell rather than on it: a td laid out as
           a flex container is no longer a table cell, and a colspan on a box
           that is not a table cell spans nothing. */
        h('div', { className: 'u-sup-in' }, [
          S.icon('lock'),
          h('span', { text: notReported(suppressionReason(row.size)) })
        ])
      ]));
      return tr;
    }

    list(row.cells).slice(0, cells).forEach(function (cell) {
      var basisPoints = num(cell && cell.basisPoints);
      if (!cell || cell.state === 'not_aged' || basisPoints === null) {
        tr.appendChild(h('td', { className: 'r u-na' }, [
          h('span', { 'aria-hidden': 'true', text: '\u00b7' }),
          h('span', { className: 'sr', text: 'Not aged into this week yet' })
        ]));
        return;
      }
      tr.appendChild(h('td', { className: 'r u-cell ' + intensity(basisPoints) }, [
        h('span', { className: 'num', text: fmt.percent(basisPoints) })
      ]));
    });
    return tr;
  }

  /* ------------------------------------------------------- what people do */

  function meter(shareOfWidth, tone) {
    var track = h('div', { className: 'meter ' + toneClass(tone) });
    var fill = h('i');
    /* A length computed from data, so it goes through CSSOM: the page's policy
       is style-src 'self' with no 'unsafe-inline' and a style attribute written
       into markup would not apply. */
    fill.style.setProperty('width', Math.max(0, Math.min(100, shareOfWidth)) + '%');
    track.appendChild(fill);
    return track;
  }

  function featureCard(features) {
    var card = S.card();
    card.appendChild(S.cardHead('Most used features', features.hint || null, []));

    var headRow = h('tr', {}, [
      h('th', { scope: 'col', text: 'What they did' }),
      h('th', { scope: 'col', text: 'App' }),
      h('th', { scope: 'col', className: 'r', text: 'Share of people' }),
      h('th', { scope: 'col', className: 'u-bar-col' }, [
        h('span', { className: 'sr', text: 'Share, drawn' })
      ])
    ]);

    var body = h('tbody');
    list(features.rows).forEach(function (row) {
      var basisPoints = num(row.basisPoints);
      var tr = h('tr', {}, [
        h('th', { scope: 'row', text: row.label }),
        h('td', { text: row.app || fmt.none })
      ]);

      if (!reportable(row.denominator) || basisPoints === null) {
        tr.appendChild(h('td', { className: 'u-sup', colspan: '2' }, [
          h('div', { className: 'u-sup-in' }, [
            S.icon('lock'),
            h('span', { text: notReported(suppressionReason(row.denominator)) })
          ])
        ]));
      } else {
        tr.appendChild(h('td', { className: 'r num', text: fmt.percent(basisPoints) }));
        tr.appendChild(h('td', { className: 'u-bar-col' }, [
          meter(basisPoints / 100, row.color)
        ]));
      }
      body.appendChild(tr);
    });

    card.appendChild(h('div', { className: 'card-body' }, [
      h('table', { className: 'tbl u-feat' }, [h('thead', {}, [headRow]), body])
    ]));

    if (features.coverageNote) {
      card.appendChild(h('div', { className: 'card-foot' }, [
        S.icon('info'), h('span', { text: features.coverageNote })
      ]));
    }
    return card;
  }

  function versionCard(coverage) {
    var card = S.card();
    card.appendChild(S.cardHead('Which versions report', null, []));

    var headRow = h('tr', {}, [
      h('th', { scope: 'col', text: 'Version' }),
      h('th', { scope: 'col', className: 'r', text: 'Sessions' }),
      h('th', { scope: 'col', className: 'r', text: 'Reporting' })
    ]);

    var body = h('tbody');
    list(coverage.versions).forEach(function (version) {
      var share = num(version.sessionShareBasisPoints);
      var reports = num(version.coverageBasisPoints);
      var full = reports === 10000;
      body.appendChild(h('tr', {}, [
        h('th', { scope: 'row', text: version.label }),
        h('td', {
          className: 'r num',
          text: share === null ? fmt.none : fmt.percent(share)
        }),
        h('td', { className: 'r' }, [
          h('span', { className: 'pill' + (full ? '' : ' warn') }, [
            S.icon(full ? 'check' : 'warn'),
            h('span', { text: reports === null ? 'Not reported' : fmt.percent(reports) })
          ])
        ])
      ]));
    });

    card.appendChild(h('div', { className: 'card-body' }, [
      h('table', { className: 'tbl' }, [h('thead', {}, [headRow]), body])
    ]));

    var shortfall = coverage.shortfall;
    if (shortfall && shortfall.detail) {
      card.appendChild(h('div', { className: 'card-foot' }, [
        S.icon('warn'), h('span', { text: shortfall.detail })
      ]));
    }
    return card;
  }

  /* ------------------------------------------------------------- assembly */

  function render(data) {
    var wrap = h('div', { className: 'stack' });

    var headline = S.band('Who is using Aria', null, [freshness(data)]);
    var grid = tiles(data);
    if (grid) headline.appendChild(grid);
    wrap.appendChild(headline);

    var growth = S.band('Is that growing', null, []);
    growth.appendChild(h('div', { className: 'grid g-main' }, [
      trendCard(data), splitCard(data)
    ]));
    wrap.appendChild(growth);

    var cohorts = list(data.cohorts).filter(function (cohort) {
      return list(cohort.rows).length > 0;
    });
    if (cohorts.length) {
      var back = S.band('Do people come back',
        'Weekly signup groups; \u00b7 is a week they have not reached yet', []);
      back.appendChild(h('div', { className: cohorts.length > 1 ? 'grid g2' : 'grid' },
        cohorts.map(cohortCard)));
      wrap.appendChild(back);
    }

    var features = data.features || {};
    var coverage = data.coverage || {};
    var hasFeatures = list(features.rows).length > 0;
    var hasVersions = list(coverage.versions).length > 0;

    if (hasFeatures || hasVersions) {
      var doing = S.band('What people do', null, []);
      if (hasFeatures && hasVersions) {
        doing.appendChild(h('div', { className: 'grid g-main' },
          [featureCard(features), versionCard(coverage)]));
      } else if (hasFeatures) {
        doing.appendChild(featureCard(features));
      } else {
        doing.appendChild(versionCard(coverage));
      }
      wrap.appendChild(doing);
    }

    return wrap;
  }

  /* ---------------------------------------------------------------- states */

  function emptyCard(block) {
    var box = S.card();
    box.appendChild(block);
    return box;
  }

  /* Not ready is not empty, and the two states the route distinguishes are
     answered differently: too little data is a window the operator can widen,
     nothing reporting at all is not. */
  function notReady(data, region) {
    var availability = data.availability || {};
    var detail = typeof availability.detail === 'string' && availability.detail
      ? availability.detail
      : null;

    if (availability.state === 'insufficient') {
      var block = S.stateBlock('chart', 'Not enough usage to report yet', [
        detail || 'This window has too few people behind it to publish a figure.'
      ]);
      var widest = widestRange();
      if (widest && S.filters().range !== widest) {
        block.appendChild(h('div', { className: 'row mt-sm' }, [
          S.link(hrefWith('range', widest), 'Try the widest window')
        ]));
      }
      region.empty(emptyCard(block));
      return;
    }

    region.empty(emptyCard(S.stateBlock('plug', 'Usage is not being reported', [
      detail || 'Nothing is arriving from the apps for this selection.'
    ])));
  }

  S.definePane(PANE_ID, function (content) {
    var region = S.region(content);
    var inFlight = 0;

    function skeleton() {
      region.loading([
        { type: 'tiles', count: 4 },
        { type: 'block', height: 240 },
        { type: 'rows', count: 6 }
      ]);
    }

    function load() {
      var token = ++inFlight;
      skeleton();

      S.read(source()).then(function (answer) {
        if (token !== inFlight) return;
        var data = (answer && answer.data) || {};
        var availability = data.availability || {};

        if (availability.state && availability.state !== 'ready') {
          notReady(data, region);
          return;
        }
        if (!list(data.apps).length) {
          region.empty(emptyCard(S.stateBlock('empty', 'No app reported over this window', [
            'Widen the window or change the app filter to see figures.'
          ])));
          return;
        }
        region.show(render(data));
        S.announce('Usage figures updated for ' + windowPhrase(data) + '.');
      }).catch(function (error) {
        if (token !== inFlight) return;
        region.failed(error, load);
      });
    }

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
