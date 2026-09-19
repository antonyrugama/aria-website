/* Aria Operations — shell and chart rendering, v2.

   Ported from docs/mocks/ops-dashboard-v2/assets/aria.js in the Aria monorepo.
   Four jobs:

     1. Render the rail and top bar from one page-level config, so a pane
        declares only what makes it different.
     2. Expand <i data-i="name"> placeholders into inline SVG.
     3. Draw charts as inline SVG from data-* attributes. Charts read the same
        CSS custom properties as everything else, so they re-colour with the
        theme for free.
     4. Own the preview-state mechanism, so a pane can swap between live,
        loading, no-data and degraded without a rule per component.

   Three departures from the mock file, all forced by this repository:

     - Nothing here uses innerHTML. The mock builds markup as strings; the
       policy in ops/README.md is that the shell is built as DOM, so no value
       arriving from the API, the querystring or storage can become markup.
       Aria.icon() therefore returns an SVGElement rather than a string.
     - Nothing here writes a style attribute. Lengths computed from data go
       through the element's style property, which style-src 'self' allows.
     - The mock hard-codes the rail badges and the account footer. Those are
       operational facts, so they are passed in by the caller and simply absent
       when the caller has none. A dashboard that invents a count is worse than
       one that shows nothing.

   Theme is deliberately NOT resolved here. assets/theme.js is a blocking
   script in every <head> and owns the pre-paint decision; this file reads what
   theme.js already wrote and calls OpsTheme.toggle() to change it. Two places
   that each decide a default will eventually disagree, and the page then
   paints one theme and visibly switches to the other after boot. */
(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* ------------------------------------------------------------- icons */
  /* Each entry is the path data for one icon, kept as a plain string map so
     nothing in here can smuggle markup: every value is handed to setAttribute
     on a <path>, never parsed as HTML. */
  var I = {
    pulse:   ['M2 12h4l2.5-7 3.5 14 2.5-7h6'],
    radio:   ['M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2'],
    history: ['M3 12a9 9 0 1 0 2.6-6.4', 'M3 4v4h4', 'M12 8v4.5l3 1.8'],
    bell:    ['M18 8a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 14 18 8Z', 'M13.7 20a2 2 0 0 1-3.4 0'],
    chart:   ['M3 3v16.5A1.5 1.5 0 0 0 4.5 21H21', 'M7 15.5V12M12 15.5V7M17 15.5v-5'],
    coin:    ['M14.7 9.2A3 3 0 0 0 12 7.8c-1.7 0-3 1-3 2.3s1.3 2 3 2.3 3 1 3 2.3-1.3 2.3-3 2.3a3 3 0 0 1-2.7-1.4', 'M12 6v12'],
    spark:   ['m12 3 2.1 5.6L20 10l-4.5 3.8L16.8 20 12 16.9 7.2 20l1.3-6.2L4 10l5.9-1.4Z'],
    ship:    ['M12 2 4 6.5v11L12 22l8-4.5v-11Z', 'M4 6.5 12 11l8-4.5M12 11v11'],
    person:  ['M4.5 20a7.5 7.5 0 0 1 15 0'],
    gear:    ['M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H2a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.4-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H8a1.6 1.6 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 1 1.4 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V8a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z'],

    up:      ['M7 14l5-5 5 5'],
    down:    ['M7 10l5 5 5-5'],
    chev:    ['m6 9 6 6 6-6'],
    check:   ['m4.5 12.5 5 5 10-11'],
    x:       ['M6 6l12 12M18 6 6 18'],
    warn:    ['M12 3.2 1.8 20.3h20.4Z', 'M12 9.5v4.5M12 17.2h.01'],
    info:    ['M12 11v5M12 8h.01'],
    search:  ['m20 20-3.6-3.6'],
    external:['M14 4h6v6', 'M20 4 11 13', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
    refresh: ['M20.5 12a8.5 8.5 0 1 1-2.5-6', 'M20.5 4v5h-5'],
    sun:     ['M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8'],
    moon:    ['M20 14.2A8.5 8.5 0 0 1 9.8 4 8.5 8.5 0 1 0 20 14.2Z'],
    dl:      ['M12 3v11', 'm7.5 10.5 4.5 4.5 4.5-4.5', 'M4 20h16'],
    clock:   ['M12 7v5.2l3.3 2'],
    empty:   ['M3 8.5 12 4l9 4.5v7L12 20l-9-4.5Z', 'M3 8.5 12 13l9-4.5M12 13v7'],
    plug:    ['M9 2v6M15 2v6', 'M6 8h12v3a6 6 0 0 1-12 0Z', 'M12 17v5'],
    lock:    ['M8 10V7a4 4 0 0 1 8 0v3'],
    eye:     ['M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z'],
    flame:   ['M12 2s5 4.6 5 9a5 5 0 0 1-10 0c0-1.6.8-3 1.6-4 .2 1.4 1 2.3 1.9 2.3 1.2 0 1.8-1 1.8-2.6C12.3 5.2 12 3.4 12 2Z'],
    layers:  ['m12 3 9 4.6-9 4.6-9-4.6Z', 'm3 12.4 9 4.6 9-4.6', 'm3 16.9 9 4.6 9-4.6']
  };

  /* Circles and rects the path map cannot express. Split out for the same
     reason: the maps stay plain data with no markup in them. */
  var CIRCLES = {
    radio:  [[12, 12, 2.5]],
    coin:   [[12, 12, 9]],
    person: [[12, 8, 3.5]],
    gear:   [[12, 12, 3]],
    info:   [[12, 12, 9]],
    search: [[11, 11, 7]],
    clock:  [[12, 12, 9]],
    eye:    [[12, 12, 2.8]]
  };
  var RECTS = {
    lock: [[4, 10, 16, 11, 2]]
  };

  function svgEl(name, attrs) {
    var el = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, String(attrs[k])); });
    return el;
  }

  /* Returns a decorative <svg> element for the named icon. Unknown names fall
     back to info, matching the mock, so a typo degrades to a legible glyph
     rather than an empty slot or a throw. */
  function icon(name, className) {
    var paths = I[name] || I.info;
    var circles = CIRCLES[I[name] ? name : 'info'] || [];
    var rects = RECTS[I[name] ? name : 'info'] || [];

    var svg = svgEl('svg', {
      'class': 'ico' + (className ? ' ' + className : ''),
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.6',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true'
    });
    rects.forEach(function (r) {
      svg.appendChild(svgEl('rect', { x: r[0], y: r[1], width: r[2], height: r[3], rx: r[4] }));
    });
    circles.forEach(function (c) {
      svg.appendChild(svgEl('circle', { cx: c[0], cy: c[1], r: c[2] }));
    });
    paths.forEach(function (d) { svg.appendChild(svgEl('path', { d: d })); });
    return svg;
  }

  /* --------------------------------------------------------- pane registry */
  /* The rail cannot drift from the pages, because neither is written twice.
     No badge and no account are declared here: both are operational facts and
     both arrive through boot(). */
  var PANES = [
    { group: 'Right now' },
    { id: 'overview', label: 'Overview',       href: 'index.html',       icon: 'pulse' },
    { id: 'jobs',     label: 'Happening now',  href: 'jobs-live.html',   icon: 'radio' },
    { id: 'history',  label: 'What happened',  href: 'run-history.html', icon: 'history' },
    { id: 'alerts',   label: 'Problems',       href: 'alerts.html',      icon: 'bell' },

    { group: 'How we are doing' },
    { id: 'analytics', label: 'People and usage', href: 'analytics.html',   icon: 'chart' },
    { id: 'spend',     label: 'Cloud costs',      href: 'spend.html',       icon: 'coin' },
    { id: 'quality',   label: 'Aria quality',     href: 'evaluations.html', icon: 'spark' },

    { group: 'Apps and people' },
    { id: 'releases', label: 'App releases',   href: 'releases.html', icon: 'ship' },
    { id: 'users',    label: 'Look up a user', href: 'users.html',    icon: 'person' },
    { id: 'settings', label: 'Settings',       href: 'settings.html', icon: 'gear' }
  ];

  /* ------------------------------------------------------------- DOM helper */
  function h(tag, opts, children) {
    var el = document.createElement(tag);
    opts = opts || {};
    Object.keys(opts).forEach(function (k) {
      if (k === 'text') el.textContent = String(opts[k]);
      else if (k === 'className') el.className = opts[k];
      else el.setAttribute(k, String(opts[k]));
    });
    (children || []).forEach(function (c) { if (c) el.appendChild(c); });
    return el;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  /* ------------------------------------------------------------------ rail */
  function renderRail(root, cfg) {
    var badges = cfg.badges || {};
    clear(root);

    root.appendChild(h('div', { className: 'brand' }, [
      h('div', { className: 'brand-mark', 'aria-hidden': 'true' }, [icon('pulse')]),
      h('div', {}, [
        h('div', { className: 'brand-name', text: 'Aria Operations' }),
        h('div', { className: 'brand-sub', text: 'Private \u00b7 admin only' })
      ])
    ]));

    /* role="group" rather than a list, because a list wants role="listitem" on
       its children and that would overwrite the link role on the anchors —
       turning ten navigable links into ten list items. The group conveys the
       same heading-to-items relationship and leaves the links alone. */
    var group = null;
    PANES.forEach(function (p) {
      if (p.group) {
        var labelId = 'railGroup' + p.group.replace(/[^A-Za-z]/g, '');
        root.appendChild(h('div', { className: 'nav-group', id: labelId, text: p.group }));
        group = h('div', { className: 'nav-list', role: 'group', 'aria-labelledby': labelId });
        root.appendChild(group);
        return;
      }
      var on = p.id === cfg.id;
      var link = h('a', {
        className: 'nav-item' + (on ? ' on' : ''),
        href: p.href
      }, [icon(p.icon), h('span', { text: p.label })]);
      if (on) link.setAttribute('aria-current', 'page');

      var badge = badges[p.id];
      if (badge) {
        link.appendChild(h('span', {
          className: 'nav-badge' + (badge.tone ? ' ' + badge.tone : ''),
          text: badge.label
        }));
        /* The badge is a bare number beside a pane name, which reads as part
           of the name when it is announced. What it counts is only obvious on
           screen, so it is said. */
        if (badge.description) {
          link.appendChild(h('span', { className: 'sr', text: ', ' + badge.description }));
        }
      }
      (group || root).appendChild(link);
    });

    var account = cfg.account;
    if (account) {
      root.appendChild(h('div', { className: 'rail-foot' }, [
        h('div', { className: 'who' }, [
          h('div', { className: 'who-av', 'aria-hidden': 'true', text: initials(account) }),
          h('div', {}, [
            h('div', { className: 'who-name', text: account.email || account.name || 'Signed in' }),
            account.meta ? h('div', { className: 'who-meta', text: account.meta }) : null
          ])
        ])
      ]));
    }
  }

  function initials(account) {
    var source = (account.name || account.email || '').trim();
    if (!source) return '?';
    var parts = source.replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean);
    if (!parts.length) return source.slice(0, 2).toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  /* --------------------------------------------------------------- top bar */
  var STATES = [
    { value: 'live', label: 'Live data' },
    { value: 'loading', label: 'Loading' },
    { value: 'empty', label: 'No data' },
    { value: 'degraded', label: 'Degraded' }
  ];

  function renderTop(root, cfg) {
    clear(root);
    /* Both lines are guarded the same way. h() stringifies whatever it is
       given, so an unguarded title paints the word "undefined" as the page
       heading, and an empty <h1> is its own accessibility defect. A page that
       names no title gets no heading. */
    root.appendChild(h('div', {}, [
      cfg.title ? h('h1', { className: 'page-title', text: cfg.title }) : null,
      cfg.sub ? h('p', { className: 'page-sub', text: cfg.sub }) : null
    ]));

    var end = h('div', { className: 'topbar-end' });

    /* The preview switcher is a reference control, not pane furniture: it only
       appears where a page asks for it, which today is the design-system page.
       A real pane's state is decided by what its own read came back with. */
    if (cfg.preview) {
      end.appendChild(h('span', { className: 'filter-label', id: 'stateSegLabel', text: 'Preview' }));
      var seg = h('div', { className: 'seg', id: 'stateSeg', role: 'group', 'aria-labelledby': 'stateSegLabel' });
      STATES.forEach(function (s) {
        seg.appendChild(h('button', {
          type: 'button', 'data-value': s.value, text: s.label, 'aria-pressed': 'false'
        }));
      });
      end.appendChild(seg);
      end.appendChild(h('div', { className: 'vr' }));
    }

    var themeBtn = h('button', {
      className: 'btn btn-icon btn-ghost', type: 'button', id: 'themeBtn'
    });
    end.appendChild(themeBtn);
    root.appendChild(end);
  }

  /* ----------------------------------------------------------------- theme */
  /* theme.js decided the theme before first paint. This only keeps the button
     in step with it and redraws the charts, which read colours from CSS. */
  function syncTheme() {
    var t = global.OpsTheme ? global.OpsTheme.current() : 'dark';
    var b = document.getElementById('themeBtn');
    if (b) {
      clear(b);
      b.appendChild(icon(t === 'dark' ? 'sun' : 'moon'));
      b.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    }
    redrawCharts();
  }

  /* ---------------------------------------------------------------- states */
  /* data-state takes a space-separated list of the states an element belongs
     to. Matching elements get data-shown and aria.css hides the rest with
     [data-state]:not([data-shown]), so a shown element keeps its own display
     type: put data-state on a <tr>, a .pill or a .card and it still lays out.
     Forcing display:block on the shown case is the bug this shape avoids. */
  function applyState(s) {
    var wanted = String(s);
    Array.prototype.forEach.call(document.querySelectorAll('[data-state]'), function (el) {
      var on = el.getAttribute('data-state').split(/\s+/).indexOf(wanted) >= 0;
      if (on) el.setAttribute('data-shown', '');
      else el.removeAttribute('data-shown');
    });
    var seg = document.getElementById('stateSeg');
    if (seg) {
      Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
        var on = b.getAttribute('data-value') === wanted;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      });
    }
    redrawCharts();
  }

  /* ============================== charts ==================================
     Everything is drawn from data-* attributes and CSS custom properties, so
     a chart cannot drift from the theme. On theme change we simply redraw. */

  function css(name, el) {
    return getComputedStyle(el || document.documentElement).getPropertyValue(name).trim();
  }
  function nums(attr) {
    return (attr || '').split(',').map(function (n) { return parseFloat(n); })
      .filter(function (n) { return !isNaN(n); });
  }
  var seq = 0;
  function uid() { seq += 1; return 'ariag' + seq; }

  /* Catmull-Rom to cubic bezier. Straight polylines make real telemetry look
     jagged and fake; a light smoothing reads as a trend without inventing
     peaks that are not in the data. */
  function spline(pts, tension) {
    if (pts.length < 2) return '';
    var t = tension === undefined ? 0.5 : tension;
    var d = 'M' + pts[0][0].toFixed(2) + ' ' + pts[0][1].toFixed(2);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      d += ' C' + (p1[0] + (p2[0] - p0[0]) / 6 * t).toFixed(2) + ' ' + (p1[1] + (p2[1] - p0[1]) / 6 * t).toFixed(2) +
           ',' + (p2[0] - (p3[0] - p1[0]) / 6 * t).toFixed(2) + ' ' + (p2[1] - (p3[1] - p1[1]) / 6 * t).toFixed(2) +
           ',' + p2[0].toFixed(2) + ' ' + p2[1].toFixed(2);
    }
    return d;
  }

  /* A chart is a graphic with role="img", and role="img" makes its whole
     subtree presentational: every <text> inside it is announced to nobody.
     So the name has to carry whatever those <text> nodes were carrying, and
     these three builders are the only place that decides it. Shipping the
     renderer without them re-creates the defect #9958 was filed for. */
  function nameSeries(label, vals) {
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    return (label ? label + ', ' : '') + vals.length + ' values, ' +
      (lo === hi ? 'flat at ' + lo
        : 'low ' + lo + ', high ' + hi + ', ending ' + vals[vals.length - 1]);
  }

  function nameArea(series, xs) {
    var name = series.map(function (s) {
      var lo = Math.min.apply(null, s.vals), hi = Math.max.apply(null, s.vals);
      return s.label + ' ' + (lo === hi ? 'flat at ' + lo : lo + ' to ' + hi);
    }).join(', ') + ' over time';
    if (xs.length) name += ', ' + xs[0] + ' to ' + xs[xs.length - 1];
    return name;
  }

  function nameBars(label, items) {
    return (label || 'Bar chart') + ': ' + items.map(function (it) {
      return it.label + ' ' + it.val;
    }).join(', ');
  }

  /* The peak is given as a position rather than an hour: the renderer is
     handed bare numbers and does not know what the axis means. A position is
     only "the peak" when the maximum occurs once — naming the first index of a
     tied maximum implies a spike that is not there — so ties are stated as a
     count instead, and the range is always given because the magnitude is
     announced nowhere else. */
  function nameRibbon(label, vals) {
    var hi = Math.max.apply(null, vals);
    var lo = Math.min.apply(null, vals);
    var ties = vals.filter(function (v) { return v === hi; }).length;
    return (label ? label + ', ' : '') + vals.length + ' values, ' +
      (lo === hi
        ? 'flat at ' + lo
        : 'low ' + lo + ', high ' + hi +
          (ties === 1
            ? ', peak at ' + (vals.indexOf(hi) + 1) + ' of ' + vals.length
            : ', high reached ' + ties + ' times'));
  }

  function mount(el, svg) {
    clear(el);
    el.appendChild(svg);
  }

  function gradient(defs, id, col, from, to) {
    var g = svgEl('linearGradient', { id: id, x1: '0', y1: '0', x2: '0', y2: '1' });
    g.appendChild(svgEl('stop', { offset: '0%', 'stop-color': col, 'stop-opacity': from }));
    g.appendChild(svgEl('stop', { offset: '100%', 'stop-color': col, 'stop-opacity': to }));
    defs.appendChild(g);
  }

  function bloom(defs, id, box, deviation) {
    var f = svgEl('filter', { id: id, x: box[0], y: box[1], width: box[2], height: box[3] });
    f.appendChild(svgEl('feGaussianBlur', { stdDeviation: deviation, result: 'x' }));
    var merge = svgEl('feMerge', {});
    merge.appendChild(svgEl('feMergeNode', { 'in': 'x' }));
    merge.appendChild(svgEl('feMergeNode', { 'in': 'SourceGraphic' }));
    f.appendChild(merge);
    defs.appendChild(f);
  }

  /* ---------------------------------------------------------- sparkline */
  function drawSpark(el) {
    var vals = nums(el.dataset.spark);
    if (vals.length < 2) return;

    var w = el.clientWidth || 260, h = el.clientHeight || 54;
    var tone = el.dataset.tone || 'cyan';
    var col = css('--' + tone);
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var pad = (hi - lo) * 0.18 || 1;
    lo -= pad; hi += pad;

    var pts = vals.map(function (v, i) {
      return [i / (vals.length - 1) * w, h - (v - lo) / (hi - lo) * h];
    });

    var id = uid();
    var line = spline(pts, 0.55);
    var area = line + ' L' + w + ' ' + h + ' L0 ' + h + ' Z';
    var last = pts[pts.length - 1];

    var svg = svgEl('svg', {
      'class': 'chart', viewBox: '0 0 ' + w + ' ' + h, preserveAspectRatio: 'none'
    });

    /* Two uses, two treatments.
       .kpi-spark: decorative BY DECISION. It sits in a KPI card where .kpi-val
       carries the current number and .kpi-meta the direction, so a name would
       announce a third time and add nothing.
       Anything else: the sparkline IS the card's content and the only copy of
       its series, so hiding it leaves a screen reader the caption and an
       average. That one gets a real name. */
    if (el.classList.contains('kpi-spark')) {
      svg.setAttribute('aria-hidden', 'true');
    } else {
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', nameSeries(el.dataset.label, vals));
    }

    var defs = svgEl('defs', {});
    gradient(defs, id, col, '.34', '0');
    bloom(defs, id + 'b', ['-30%', '-60%', '160%', '260%'], '3.2');
    svg.appendChild(defs);

    svg.appendChild(svgEl('path', { d: area, fill: 'url(#' + id + ')' }));
    svg.appendChild(svgEl('path', {
      d: line, fill: 'none', stroke: col, 'stroke-width': '1.9', 'stroke-linecap': 'round',
      'vector-effect': 'non-scaling-stroke', filter: 'url(#' + id + 'b)', opacity: '.95'
    }));
    svg.appendChild(svgEl('circle', {
      cx: last[0].toFixed(2), cy: last[1].toFixed(2), r: '2.6', fill: col
    }));

    mount(el, svg);
  }

  /* ------------------------------------------------------------ area chart
     data-area  = series, each "label:tone:v,v,v" separated by ";"
     data-xaxis = comma separated tick labels
     data-yfmt  = optional suffix appended to y labels */
  function drawArea(el) {
    var raw = (el.dataset.area || '').split(';').filter(Boolean);
    if (!raw.length) return;

    var series = raw.map(function (s) {
      var p = s.split(':');
      return { label: p[0], tone: p[1] || 'cyan', vals: nums(p[2]) };
    }).filter(function (s) { return s.vals.length > 1; });
    if (!series.length) return;

    var w = el.clientWidth || 700;
    var h = el.dataset.h === 'fill' ? (el.clientHeight || 230) : parseInt(el.dataset.h || '230', 10);
    var padL = 42, padR = 8, padT = 10, padB = 24;
    var iw = w - padL - padR, ih = h - padT - padB;

    var hi = 0;
    series.forEach(function (s) { s.vals.forEach(function (v) { if (v > hi) hi = v; }); });
    hi = hi * 1.14 || 1;

    var xs = (el.dataset.xaxis || '').split(',').filter(function (s) { return s !== ''; });

    var svg = svgEl('svg', {
      'class': 'chart', viewBox: '0 0 ' + w + ' ' + h,
      role: 'img', 'aria-label': nameArea(series, xs)
    });
    var defs = svgEl('defs', {});
    svg.appendChild(defs);

    var ticks = 4;
    for (var i = 0; i <= ticks; i++) {
      var y = padT + ih - (i / ticks) * ih;
      var gridline = svgEl('line', {
        'class': 'gridline', x1: padL, y1: y.toFixed(1), x2: w - padR, y2: y.toFixed(1)
      });
      if (i !== 0) gridline.setAttribute('stroke-dasharray', '2 4');
      svg.appendChild(gridline);

      var label = svgEl('text', {
        'class': 'axis', x: padL - 8, y: (y + 3.5).toFixed(1), 'text-anchor': 'end'
      });
      label.textContent = Math.round(hi * i / ticks) + (el.dataset.yfmt || '');
      svg.appendChild(label);
    }

    xs.forEach(function (t, i) {
      var x = padL + (xs.length > 1 ? (i / (xs.length - 1)) * iw : iw / 2);
      var tick = svgEl('text', {
        'class': 'axis', x: x.toFixed(1), y: h - 6, 'text-anchor': 'middle'
      });
      tick.textContent = t;
      svg.appendChild(tick);
    });

    series.forEach(function (s) {
      var col = css('--' + s.tone), id = uid();
      var pts = s.vals.map(function (v, i) {
        return [padL + (i / (s.vals.length - 1)) * iw, padT + ih - (v / hi) * ih];
      });
      var line = spline(pts, 0.5);
      gradient(defs, id, col, '.30', '0');
      bloom(defs, id + 'b', ['-10%', '-40%', '120%', '200%'], '3');

      svg.appendChild(svgEl('path', {
        d: line + ' L' + (padL + iw) + ' ' + (padT + ih) + ' L' + padL + ' ' + (padT + ih) + ' Z',
        fill: 'url(#' + id + ')'
      }));
      svg.appendChild(svgEl('path', {
        d: line, fill: 'none', stroke: col, 'stroke-width': '2.1',
        'stroke-linecap': 'round', 'stroke-linejoin': 'round', filter: 'url(#' + id + 'b)'
      }));
      svg.appendChild(svgEl('circle', {
        cx: pts[pts.length - 1][0].toFixed(1), cy: pts[pts.length - 1][1].toFixed(1),
        r: '3.1', fill: col
      }));
    });

    mount(el, svg);
  }

  /* ------------------------------------------------------------- bar chart
     data-bars = "label:tone:value" entries separated by ";" */
  function drawBars(el) {
    var items = (el.dataset.bars || '').split(';').filter(Boolean).map(function (s) {
      var p = s.split(':');
      return { label: p[0], tone: p[1] || 'cyan', val: parseFloat(p[2]) };
    }).filter(function (it) { return !isNaN(it.val); });
    if (!items.length) return;

    var w = el.clientWidth || 600;
    var h = parseInt(el.dataset.h || '180', 10);
    var padB = 22, padT = 6;
    var ih = h - padB - padT;
    var hi = Math.max.apply(null, items.map(function (i) { return i.val; })) * 1.12 || 1;
    var slot = w / items.length;
    var bw = Math.min(slot * 0.56, 34);

    var svg = svgEl('svg', {
      'class': 'chart', viewBox: '0 0 ' + w + ' ' + h,
      role: 'img', 'aria-label': nameBars(el.dataset.label, items)
    });
    var defs = svgEl('defs', {});
    svg.appendChild(defs);

    items.forEach(function (it, i) {
      var col = css('--' + it.tone), id = uid();
      var bh = (it.val / hi) * ih;
      var x = i * slot + (slot - bw) / 2;
      var y = padT + ih - bh;
      gradient(defs, id, col, '.95', '.22');

      svg.appendChild(svgEl('rect', {
        x: x.toFixed(1), y: y.toFixed(1), width: bw.toFixed(1),
        height: Math.max(bh, 2).toFixed(1), rx: '3', fill: 'url(#' + id + ')'
      }));
      var label = svgEl('text', {
        'class': 'axis', x: (i * slot + slot / 2).toFixed(1), y: h - 6, 'text-anchor': 'middle'
      });
      label.textContent = it.label;
      svg.appendChild(label);
    });

    mount(el, svg);
  }

  /* ----------------------------------------------------------------- gauge
     data-gauge = 0..100, data-tone, data-val, data-cap */
  function drawGauge(el) {
    var pct = Math.max(0, Math.min(100, parseFloat(el.dataset.gauge) || 0));
    var col = css('--' + (el.dataset.tone || 'cyan'));
    var track = css('--line-2');
    var r = 46, c = 2 * Math.PI * r, id = uid();

    /* The ring is decorative BY DECISION: .gauge-val and .gauge-cap below are
       real text in this same element and state the whole fact the ring encodes
       ("88%", "of $650"). Naming the svg as well would announce it twice. */
    var svg = svgEl('svg', {
      viewBox: '0 0 108 108', width: '108', height: '108', 'aria-hidden': 'true'
    });
    var defs = svgEl('defs', {});
    bloom(defs, id, ['-50%', '-50%', '200%', '200%'], '3.5');
    svg.appendChild(defs);

    svg.appendChild(svgEl('circle', {
      cx: '54', cy: '54', r: r, fill: 'none', stroke: track, 'stroke-width': '8'
    }));
    svg.appendChild(svgEl('circle', {
      cx: '54', cy: '54', r: r, fill: 'none', stroke: col, 'stroke-width': '8',
      'stroke-linecap': 'round', filter: 'url(#' + id + ')',
      'stroke-dasharray': (c * pct / 100).toFixed(1) + ' ' + c.toFixed(1)
    }));

    clear(el);
    el.appendChild(svg);
    el.appendChild(h('div', { className: 'gauge-mid' }, [
      h('div', {}, [
        h('div', { className: 'gauge-val', text: el.dataset.val || pct + '%' }),
        el.dataset.cap ? h('div', { className: 'gauge-cap', text: el.dataset.cap }) : null
      ])
    ]));
  }

  /* ---------------------------------------------------------------- ribbon
     data-ribbon = comma separated values, drawn as a bar column strip. */
  function drawRibbon(el) {
    var vals = nums(el.dataset.ribbon);
    if (!vals.length) return;
    var hi = Math.max.apply(null, vals) || 1;

    /* Unlike the other charts this one emits no <svg> and no text at all, just
       empty <i> columns, so it was announced as nothing without ever saying
       aria-hidden. Its row states a total but never the distribution, which is
       the only thing this strip shows, so it needs a real name. */
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', nameRibbon(el.dataset.label, vals));

    clear(el);
    vals.forEach(function (v) {
      var col = document.createElement('i');
      /* The one length here that is genuinely computed from data. Written
         through the style property, which style-src 'self' allows; a
         setAttribute('style', ...) of the same value would be blocked. */
      col.style.height = Math.max(6, v / hi * 100).toFixed(1) + '%';
      el.appendChild(col);
    });
  }

  function redrawCharts(root) {
    var scope = root || document;
    Array.prototype.forEach.call(scope.querySelectorAll('[data-spark]'), drawSpark);
    Array.prototype.forEach.call(scope.querySelectorAll('[data-area]'), drawArea);
    Array.prototype.forEach.call(scope.querySelectorAll('[data-bars]'), drawBars);
    Array.prototype.forEach.call(scope.querySelectorAll('[data-gauge]'), drawGauge);
    Array.prototype.forEach.call(scope.querySelectorAll('[data-ribbon]'), drawRibbon);
  }

  /* --------------------------------------------------------------- icon pass */
  function expandIcons(root) {
    var scope = root || document;
    Array.prototype.forEach.call(scope.querySelectorAll('[data-i]'), function (el) {
      /* class carries across so a sized icon keeps its size. The mock also
         carried a style attribute across; there are none to carry here. */
      var svg = icon(el.getAttribute('data-i'), el.getAttribute('class') || '');
      if (el.parentNode) el.parentNode.replaceChild(svg, el);
    });
  }

  /* ------------------------------------------------------------------ boot */
  function boot(cfg) {
    cfg = cfg || {};

    var rail = document.getElementById('rail');
    if (rail) renderRail(rail, cfg);

    var top = document.getElementById('topbar');
    if (top) renderTop(top, cfg);

    expandIcons();

    var themeBtn = document.getElementById('themeBtn');
    if (themeBtn && global.OpsTheme) {
      themeBtn.addEventListener('click', function () {
        global.OpsTheme.toggle();
        syncTheme();
      });
    }

    var seg = document.getElementById('stateSeg');
    if (seg) {
      seg.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('button') : null;
        if (b) applyState(b.getAttribute('data-value'));
      });
    }

    syncTheme();
    applyState(cfg.state || 'live');

    var t;
    global.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(function () { redrawCharts(); }, 140);
    });
  }

  /* boot, icon and redraw are the surface the mocks define. applyState is the
     fourth because the mocks drive it from a switcher this shell does not
     ship: a real pane calls it when its read resolves. There is no icons()
     accessor — icon() is the whole icon API. */
  global.Aria = {
    boot: boot,
    icon: icon,
    redraw: redrawCharts,
    applyState: applyState
  };
})(window);
