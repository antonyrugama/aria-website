/* Shared plumbing for the understand panes: People and usage, Cloud costs.

   Three things live here because both panes need all three and neither may
   hold a second copy:

     1. Where a pane's figures come from, and what it does when they are not
        there yet.
     2. Formatting. Every figure on these panes arrives as an integer, because
        the pipeline stores money in micro-units and every rate as a numerator
        and a denominator rather than as a precomputed percentage. Turning
        those into something readable is one job, done once.
     3. The suppression floor, the four pane states, and the dependency-free
        charts, all of which are drawn identically on both panes.

   Like the rest of this directory, nothing here uses innerHTML: everything is
   built as DOM with textContent, so no value from the API can become markup.
   Data-driven lengths (a bar's width, a cell's tint) are set through the CSSOM
   rather than through a style attribute, which is what keeps them inside the
   pages' style-src policy. */
(function (global) {
  'use strict';

  var shell = global.OpsShell;
  var h = shell.h;
  var icon = shell.icon;

  /* ---------------------------------------------------------- data source */

  /* The reporting floor. A rate whose denominator is below this is not shown,
     because with a group this small one person moves the figure by several
     points and the reader has no way to tell that from a real change. The raw
     counts underneath are always safe to show, and always offered.

     The floor lives on the surface rather than in the pipeline on purpose: it
     is a rule about what may be *displayed*, so it has to hold whatever a
     future read API decides to send. The panes apply it to every rate they
     draw, including ones that arrive already computed. */
  var REPORTING_FLOOR = 50;

  function isLoopback() {
    var host = global.location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  }

  /* Local verification hook, and the reason it exists.

     Neither pane has a read API yet. The pipeline behind People and usage and
     the cost read API behind Cloud costs are both later slices, so with no
     hook the ready, insufficient-data, and stale renderings on these two panes
     could not be looked at by anybody until those slices land, which is the
     wrong way round: the rendering is what is being reviewed now.

     So a pane may be pointed at a same-origin JSON document holding one
     response envelope. Honoured only when the page itself is served from a
     loopback address, exactly like the API base-url override in api.js, so a
     deployment on the real origin can never read one. */
  function fixtureUrl(paneId) {
    if (!isLoopback()) return null;
    try {
      return global.localStorage.getItem('ops-pane-fixture-' + paneId) || null;
    } catch (e) {
      return null;
    }
  }

  /* Resolves a pane's figures.

     source.endpoint is deliberately null while the read API for that pane is
     an unshipped slice. Null is not an oversight and not a placeholder path:
     there is no endpoint to call, so none is called, and the pane says so.
     When the read API lands, the wave that adds it sets the path here and
     nothing else on the pane changes.

     Resolves { kind: 'data', data } or { kind: 'no-source' }. Rejects with the
     OpsApiError the transport raised, which the pane turns into a state rather
     than into a stack trace. */
  function load(source) {
    var fixture = fixtureUrl(source.paneId);
    if (fixture) {
      return global.fetch(fixture, { cache: 'no-store' }).then(function (res) {
        if (!res.ok) throw new Error('fixture responded ' + res.status);
        return res.json();
      }).then(function (payload) {
        return { kind: 'data', data: payload && payload.data };
      });
    }

    if (!source.endpoint) return Promise.resolve({ kind: 'no-source' });

    return global.OpsSession.call(source.endpoint, { query: source.query })
      .then(function (payload) { return { kind: 'data', data: payload.data }; });
  }

  /* ------------------------------------------------------------ formatting */

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* Every timestamp on these panes is UTC and says so. The pipeline buckets
     every period in UTC, so rendering a browser-local time would put a figure
     under a date it was not counted on. */
  function utcStamp(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear() +
      ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ' UTC';
  }

  function utcDay(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  /* Whole hours since an instant, for staleness. Floors, so "8 hours old"
     never reads as nine. */
  function hoursSince(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / 3600000));
  }

  var MICROS = 1000000;

  /* Money arrives as integer micro-units of the billing currency, because the
     claim these panes make is that the parts sum to the invoice exactly and a
     float sum over a few hundred daily rows does not reproduce that. Division
     happens once, here, at the moment of display. */
  function money(micros, currency, opts) {
    if (typeof micros !== 'number' || !isFinite(micros)) return 'n/a';
    opts = opts || {};
    var digits = opts.digits === undefined ? 2 : opts.digits;
    try {
      /* en-US rather than the locale the operator happens to be in. The bill
         is issued in one currency and the figures are compared against it, so
         a browser in another region must not relabel or re-group them. */
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency || 'USD',
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      }).format(micros / MICROS);
    } catch (e) {
      return (micros / MICROS).toFixed(digits);
    }
  }

  function count(n) {
    if (typeof n !== 'number' || !isFinite(n)) return 'n/a';
    try { return new Intl.NumberFormat('en-US').format(n); } catch (e) { return String(n); }
  }

  function decimal(n, digits) {
    if (typeof n !== 'number' || !isFinite(n)) return 'n/a';
    return n.toFixed(digits === undefined ? 1 : digits);
  }

  /* Rates travel as basis points for the same exactness reason money travels
     as micros. One decimal place, because a second one is noise at these
     denominators and invites reading a change that is not there. */
  function percent(basisPoints, digits) {
    if (typeof basisPoints !== 'number' || !isFinite(basisPoints)) return 'n/a';
    return (basisPoints / 100).toFixed(digits === undefined ? 1 : digits) + '%';
  }

  function signedPercent(basisPoints, digits) {
    if (typeof basisPoints !== 'number' || !isFinite(basisPoints)) return 'n/a';
    return (basisPoints > 0 ? '+' : '') + percent(basisPoints, digits);
  }

  function seconds(total) {
    if (typeof total !== 'number' || !isFinite(total)) return 'n/a';
    var m = Math.floor(total / 60);
    var s = Math.round(total - m * 60);
    return m + 'm ' + pad2(s) + 's';
  }

  /* Formats one metric the way its own kind wants to be read. The kind comes
     from the payload, so the pane never guesses from the value's shape. */
  function metricValue(metric, currency) {
    if (metric.kind === 'money') return money(metric.value, currency);
    if (metric.kind === 'rate') return percent(metric.value);
    if (metric.kind === 'seconds') return seconds(metric.value);
    if (metric.kind === 'decimal') return decimal(metric.value, metric.digits);
    return count(metric.value);
  }

  /* --------------------------------------------------- suppression floor */

  /* Whether a rate may be shown at all. Everything with a denominator goes
     through here, so there is one answer to "is this reportable" rather than
     one per card. A missing denominator is not reportable: a rate whose base
     is unknown cannot be known to clear the floor. */
  function reportable(denominator) {
    return typeof denominator === 'number' && isFinite(denominator) &&
      denominator >= REPORTING_FLOOR;
  }

  /* The sentence a suppressed figure carries. Says the floor, says the size,
     and says why, because "hidden" on its own reads as a permission problem. */
  function suppressionReason(denominator, noun) {
    var size = (typeof denominator === 'number' && isFinite(denominator))
      ? count(denominator) : 'Too few';
    return 'Hidden, only ' + size + ' ' + (noun || 'people') +
      ' in this group and we do not report rates below ' + REPORTING_FLOOR + '.';
  }

  /* ------------------------------------------------------------ elements */

  function textRow(className, children) {
    return h('div', { className: className }, children);
  }

  /* A card shell with a real heading. Every card title on these panes is an
     h3: the pane title in the top bar is the h1 and the band headings that
     separate regions are h2, so the levels run in order without a single size
     changing. */
  function card(opts) {
    opts = opts || {};
    var el = h('div', { className: 'card' + (opts.className ? ' ' + opts.className : '') });
    if (opts.id) el.setAttribute('id', opts.id);

    if (opts.title) {
      var head = h('div', { className: 'card-head' });
      head.appendChild(h(opts.level || 'h3', { className: 'card-title', text: opts.title }));
      if (opts.hint) head.appendChild(h('span', { className: 'card-hint', text: opts.hint }));
      if (opts.headExtra) {
        head.appendChild(h('div', { className: 'spacer' }));
        head.appendChild(opts.headExtra);
      }
      el.appendChild(head);
    }
    return el;
  }

  function cardBody(className) {
    return h('div', { className: 'card-body' + (className ? ' ' + className : '') });
  }

  function cardFoot(children) {
    return h('div', { className: 'card-foot' }, children);
  }

  function bandHead(title, hint) {
    var band = h('div', { className: 'band-head' }, [
      h('h2', { className: 'band-title', text: title })
    ]);
    if (hint) band.appendChild(h('span', { className: 'band-hint', text: hint }));
    return band;
  }

  /* A callout. tone is one of warn, crit, info, ai, or omitted for the plain
     one. The glyph is decorative; the tone is always also carried by the
     leading words of the text, so nothing here is colour alone. */
  function callout(tone, iconName, children) {
    var el = h('div', { className: 'callout' + (tone ? ' callout-' + tone : '') });
    el.appendChild(icon(iconName || 'info'));
    var body = h('div');
    (children || []).forEach(function (c) {
      body.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    el.appendChild(body);
    return el;
  }

  function strong(text) { return h('strong', { text: text }); }

  /* ------------------------------------------------------------- states */

  /* The four states every pane on this dashboard has to handle, drawn the same
     way on both of these panes.

     "Empty never means zero" is the rule they exist for. A pane with no
     figures says which kind of nothing it is looking at: too small to report,
     not published yet, never configured, or a fault. Four different answers,
     because the reader does something different in each case. */

  function loading(blocks) {
    var wrap = h('div', { className: 'stack' });
    (blocks || [132, 200]).forEach(function (height, i) {
      var c = h('div', { className: 'card' });
      var body = cardBody();
      var skel = h('div', { className: 'skel' });
      skel.style.setProperty('height', height + 'px');
      body.appendChild(skel);
      c.appendChild(body);
      wrap.appendChild(c);
      if (i === 0) wrap.setAttribute('aria-busy', 'true');
    });
    /* Announced, because the pane replaces itself once and a screen reader is
       otherwise told nothing between the shell appearing and the figures
       arriving. */
    wrap.appendChild(h('p', {
      className: 'sr-only', role: 'status', text: 'Loading figures'
    }));
    return wrap;
  }

  /* A pane-sized state block inside a card, with optional actions under it. */
  function stateCard(iconName, title, lines, actions) {
    var wrap = h('div', { className: 'stack' });
    var c = h('div', { className: 'card' });
    var block = shell.stateBlock(iconName, title, lines);
    if (actions && actions.length) {
      var row = h('div', { className: 'row mt-sm' });
      actions.forEach(function (a) { row.appendChild(a); });
      block.appendChild(row);
    }
    c.appendChild(block);
    wrap.appendChild(c);
    return wrap;
  }

  /* What a pane shows while the read API behind it is an unshipped slice.

     This is not the shell's "not built yet": the pane itself is built and its
     rendering is what you are looking at. What is missing is the reporting
     underneath, and saying that plainly is the whole point of the state. */
  function noSource(opts) {
    return stateCard('empty', opts.title, [
      opts.detail,
      'Nothing is being hidden from you, and nothing here is a zero. ' +
        'When the reporting behind this pane starts publishing, this page ' +
        'shows it without another release.'
    ]);
  }

  /* A failure the reader can act on. The transport has already turned every
     possible fault into one code, so the pane branches on the code and never
     on a message. */
  function failure(err, opts) {
    var missing = err && err.code === 'ops_route_missing';
    if (missing) return noSource(opts);

    var retry = h('button', { className: 'btn btn-primary', type: 'button', text: 'Try again' });
    retry.addEventListener('click', function () { opts.onRetry(); });

    return stateCard('warn', 'Could not load these figures', [
      (err && err.message) || 'The operations API did not answer.',
      'Your session has not been ended, and nothing here is a zero. ' +
        'The figures are unread, not absent.'
    ], [retry]);
  }

  /* ------------------------------------------------------------- charts */

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(name, attrs) {
    var el = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, String(attrs[k])); });
    return el;
  }

  /* Charts are images with a name, not decorations: role="img" plus a label
     built from the same figures the chart draws, so a reader who cannot see
     the line is told what it did rather than that a graphic is present. Every
     chart on these panes also has its numbers in text somewhere on the card,
     so nothing is only in the picture. */
  function chartFrame(width, height, label, className) {
    var svg = svgEl('svg', {
      viewBox: '0 0 ' + width + ' ' + height,
      preserveAspectRatio: 'none',
      role: 'img',
      'aria-label': label,
      focusable: 'false',
      class: className || 'chart'
    });
    return svg;
  }

  function extent(values) {
    var min = Infinity;
    var max = -Infinity;
    values.forEach(function (v) {
      if (typeof v !== 'number' || !isFinite(v)) return;
      if (v < min) min = v;
      if (v > max) max = v;
    });
    if (min === Infinity) { min = 0; max = 1; }
    if (min === max) { min = min - 1; max = max + 1; }
    return { min: min, max: max };
  }

  function pathFor(values, bounds, width, height, pad) {
    var span = bounds.max - bounds.min;
    var step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
    var d = '';
    values.forEach(function (v, i) {
      var x = pad + i * step;
      var y = height - pad - ((v - bounds.min) / span) * (height - pad * 2);
      d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2);
    });
    return d;
  }

  /* A twelve-point trend beside a figure. Deliberately unlabelled on its axes:
     it says "rising, and by roughly this much", and the exact current value is
     the number it sits under. */
  function sparkline(values, opts) {
    opts = opts || {};
    var width = 260;
    var height = 44;
    var svg = chartFrame(width, height, opts.label || 'Trend', 'spark');
    var clean = (values || []).filter(function (v) { return typeof v === 'number' && isFinite(v); });
    if (clean.length < 2) return svg;

    var bounds = extent(clean);
    var line = svgEl('path', {
      d: pathFor(clean, bounds, width, height, 4),
      fill: 'none',
      stroke: opts.color || 'var(--s1)',
      'stroke-width': 1.8,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'vector-effect': 'non-scaling-stroke'
    });
    svg.appendChild(line);
    return svg;
  }

  /* Two series over the same day offsets, which is the only line chart these
     panes draw. Marked days are the ones the card's note is about, so the note
     and the picture cannot disagree about which days they mean. */
  function lineChart(config) {
    var width = 640;
    var height = config.height || 190;
    var pad = 10;
    var svg = chartFrame(width, height, config.label || 'Trend', 'chart');
    svg.setAttribute('preserveAspectRatio', 'none');

    var all = [];
    (config.series || []).forEach(function (s) {
      (s.values || []).forEach(function (v) { all.push(v); });
    });
    if (all.length < 2) return svg;
    var bounds = extent(all.concat([0]));

    (config.series || []).forEach(function (s) {
      var values = (s.values || []).filter(function (v) {
        return typeof v === 'number' && isFinite(v);
      });
      if (values.length < 2) return;
      svg.appendChild(svgEl('path', {
        d: pathFor(values, bounds, width, height, pad),
        fill: 'none',
        stroke: s.color || 'var(--s1)',
        'stroke-width': s.dashed ? 1.4 : 2,
        'stroke-dasharray': s.dashed ? '5 4' : '',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'vector-effect': 'non-scaling-stroke'
      }));

      (s.marks || []).forEach(function (index) {
        if (index < 0 || index >= values.length) return;
        var span = bounds.max - bounds.min;
        var step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
        svg.appendChild(svgEl('circle', {
          cx: (pad + index * step).toFixed(2),
          cy: (height - pad - ((values[index] - bounds.min) / span) * (height - pad * 2)).toFixed(2),
          r: 3.4,
          fill: 'var(--warn)'
        }));
      });
    });

    return svg;
  }

  /* A ranked bar list. The bar is decorative because the value beside it is
     the same fact in text, so the list reads correctly with no colour and no
     graphics at all. */
  function rankList(rows, opts) {
    opts = opts || {};
    var max = 0;
    (rows || []).forEach(function (r) { if (r.value > max) max = r.value; });
    if (max <= 0) max = 1;

    var list = h('ul', { className: 'rank', role: 'list' });
    (rows || []).forEach(function (r) {
      var bar = h('i', { 'aria-hidden': 'true' });
      bar.style.setProperty('width', Math.max(1, (r.value / max) * 100).toFixed(2) + '%');
      if (r.color) bar.style.setProperty('background', r.color);

      var track = h('div', { className: 'rank-track', 'aria-hidden': 'true' }, [bar]);

      var item = h('li', { className: 'rank-row' }, [
        h('span', { className: 'rank-label', text: r.label }),
        track,
        h('span', { className: 'rank-value mono', text: opts.format ? opts.format(r) : count(r.value) })
      ]);
      if (r.note) item.appendChild(h('span', { className: 'rank-note tiny muted', text: r.note }));
      list.appendChild(item);
    });
    return list;
  }

  /* A labelled meter. Same rule: the percentage is text, the bar repeats it. */
  function meterRow(opts) {
    var wrap = h('div', { className: 'meter-row' });
    wrap.appendChild(h('div', { className: 'meter-head' }, [
      h('span', { text: opts.label }),
      h('span', { className: 'mono ' + (opts.tone === 'warn' ? 'ink-warn' : 'muted'), text: opts.value })
    ]));

    var fill = h('div', {
      className: 'meter-fill ' + (opts.tone === 'warn' ? 'warn' : opts.tone === 'crit' ? 'crit' : 'ok')
    });
    fill.style.setProperty('width', Math.max(0, Math.min(100, opts.fillPercent)) + '%');
    wrap.appendChild(h('div', { className: 'meter', 'aria-hidden': 'true' }, [fill]));

    if (opts.note) {
      wrap.appendChild(h('div', {
        className: 'tiny mt-xs ' + (opts.tone === 'warn' ? 'ink-warn' : 'muted'),
        text: opts.note
      }));
    }
    return wrap;
  }

  /* --------------------------------------------------------------- tabs */

  /* A real tablist for the view switchers both panes carry. The shell already
     owns the keyboard behaviour, so this only has to build the markup it
     expects and hand the subtree back for wiring.

     tabs: [{ id, label, panel }] */
  function tabbed(opts) {
    var wrap = h('div', { className: 'tabbed' });
    var list = h('div', {
      className: 'seg seg-tabs', role: 'tablist', 'aria-label': opts.label
    });
    var panels = h('div', { className: 'tabbed-panels' });

    opts.tabs.forEach(function (t, i) {
      var tabId = opts.idPrefix + '-tab-' + t.id;
      var panelId = opts.idPrefix + '-panel-' + t.id;
      var button = h('button', {
        type: 'button', id: tabId, role: 'tab',
        'aria-controls': panelId,
        'aria-selected': String(i === 0),
        text: t.label
      });
      list.appendChild(button);

      var panel = h('div', {
        id: panelId, role: 'tabpanel', tabindex: '0', 'aria-labelledby': tabId
      }, [t.panel]);
      if (i !== 0) panel.hidden = true;
      panels.appendChild(panel);
    });

    wrap.appendChild(list);
    wrap.appendChild(panels);
    return { root: wrap, tablist: list, panels: panels };
  }

  global.OpsPaneData = {
    REPORTING_FLOOR: REPORTING_FLOOR,
    load: load,
    isLoopback: isLoopback,

    utcStamp: utcStamp,
    utcDay: utcDay,
    hoursSince: hoursSince,
    money: money,
    count: count,
    decimal: decimal,
    percent: percent,
    signedPercent: signedPercent,
    seconds: seconds,
    metricValue: metricValue,

    reportable: reportable,
    suppressionReason: suppressionReason,

    card: card,
    cardBody: cardBody,
    cardFoot: cardFoot,
    bandHead: bandHead,
    callout: callout,
    strong: strong,
    textRow: textRow,

    loading: loading,
    stateCard: stateCard,
    noSource: noSource,
    failure: failure,

    sparkline: sparkline,
    lineChart: lineChart,
    rankList: rankList,
    meterRow: meterRow,
    tabbed: tabbed
  };
})(window);
