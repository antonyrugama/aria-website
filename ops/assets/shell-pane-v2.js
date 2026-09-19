/* The v2 pane bootstrap: session gate, rail, top bar, filter bar, and the
   four preview states.

   assets/aria.js draws a rail and a top bar from one page-level config and
   knows nothing else about a pane page. Everything a pane page needs on top of
   that — waiting for a session before anything renders, refusing to open a
   pane the signed-in role may not have, offering only the filters the pane's
   own reads can honour, and finding out whether a pane has been built at all —
   lived in assets/shell.js, wired to the v1 design system. This file is that
   gap closed once, against v2, so a pane remodel is a pane module and a
   stylesheet rather than a fresh set of decisions.

   A page loads v1 or v2, never both: both stylesheets define .card, .rail,
   .topbar, .btn, .seg, .pill, .tbl and .nav-item from different token sets. A
   v2 pane page therefore loads assets/aria.css, assets/shell-pane-v2.css and
   its own pane stylesheet, and none of ops.css, operate.css or shell.js.

   Public surface — window.OpsPaneShell:

     definePane(id, render)  register what a pane draws. render(content, pane)
                             is called with the pane's <main> and its registry
                             entry, after the document has finished parsing and
                             after the session is confirmed. A pane with no
                             registration renders the not-built state.
     init()                  boot this page. Called automatically on a page
                             whose <body data-pane> names a registered pane.
     filters()               a copy of the current filter selection
     resetRange()            put the range back to the pane's own default;
                             answers whether that changed anything
     paneHref(paneId)        a link to another pane carrying the selection
     setBadge(railId, badge) put a count beside a rail item, or remove it with
                             null. badge is { label, tone, description }
     region(content)         the four preview states, as a region a pane owns
     h(tag, opts, children)  DOM builder. Never innerHTML
     icon(name, className)   assets/aria.js's icon set, as an SVGElement
     card / cardHead / bandHead / stateBlock   the v2 panel shapes
     announce(message)       polite live-region announcement
     toast(iconName, text)   transient confirmation
     fmt                     the formatters every pane prints figures through
     read(source)            a pane's own read, with the local fixture hook
     panes                   the registry, read-only

   Two events fire on window once the shell is in the document, in this order:
   ops:ready (detail { pane, filters }) and then ops:filters (detail = the
   selection). ops:filters fires again on every change. Both carry the starting
   selection so a pane does not have to read the querystring itself.

   Nothing here uses innerHTML and nothing here writes a style attribute. The
   pane displays production operational data to an administrator, so no value
   from the API, the querystring or storage may become markup, and the page's
   Content-Security-Policy carries no 'unsafe-inline'.

   Theme is not decided here. assets/theme.js is a blocking script in every
   <head> and owns the pre-paint decision; assets/aria.js reads what it wrote. */
(function (global) {
  'use strict';

  var registry = global.OpsPaneRegistry;
  if (!registry) {
    throw new Error('ops/assets/pane-registry.js must load before ops/assets/shell-pane-v2.js');
  }
  var aria = global.Aria;
  if (!aria) {
    throw new Error('ops/assets/aria.js must load before ops/assets/shell-pane-v2.js');
  }

  var session = global.OpsSession;
  var PANES = registry.PANES;
  var RANGES = registry.RANGES;
  var SCOPES = registry.SCOPES;
  var ENVS = registry.ENVS;
  var WAVES = registry.WAVES;

  /* ------------------------------------------------------- DOM shorthand */

  function h(tag, opts, children) {
    var el = document.createElement(tag);
    opts = opts || {};
    if (opts.className) el.className = opts.className;
    if (opts.text !== undefined) el.textContent = opts.text;
    Object.keys(opts).forEach(function (k) {
      if (k === 'className' || k === 'text') return;
      el.setAttribute(k, opts[k]);
    });
    (children || []).forEach(function (c) { if (c) el.appendChild(c); });
    return el;
  }

  function icon(name, className) { return aria.icon(name, className); }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  /* ---------------------------------------------------------- formatting

     Ported from the v1 panes rather than reached for across the two design
     systems: assets/operate.js and assets/pane-data.js both read OpsShell at
     module scope, so pulling either onto a v2 page would drag the v1 shell
     onto it as well, and every DOM builder in them carries a v1 class name.

     Two implementations of "what does a person read here" is a real risk while
     both systems are live, so scripts/ops-shell-pane-v2.test.mjs runs this set
     and the v1 set over one table of inputs and fails on any disagreement.

     Every formatter survives the value being missing. An operations screen
     that prints NaN or "undefined" beside a real figure has said nothing about
     which of the two can be trusted. */

  var NONE = '-';
  var MICROS = 1000000;
  var MONEY_DIGITS = 2;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function int(v) {
    if (!isNum(v)) return NONE;
    return Math.round(v).toLocaleString('en-GB');
  }

  function plural(n, one, many) {
    return (isNum(n) ? int(n) : NONE) + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  function parseTime(iso) {
    if (typeof iso !== 'string' || !iso) return null;
    var t = new Date(iso);
    return isFinite(t.getTime()) ? t : null;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* UTC throughout. Two operators in two time zones reading the same incident
     have to be able to quote the same timestamp to each other. */
  function clock(iso) {
    var t = parseTime(iso);
    if (!t) return NONE;
    return pad2(t.getUTCHours()) + ':' + pad2(t.getUTCMinutes()) + ':' + pad2(t.getUTCSeconds());
  }

  function stamp(iso) {
    return parseTime(iso) ? clock(iso) + ' UTC' : NONE;
  }

  function ago(iso) {
    var t = parseTime(iso);
    if (!t) return NONE;
    var secs = Math.max(0, Math.round((Date.now() - t.getTime()) / 1000));
    if (secs < 60) return secs === 1 ? '1 second ago' : secs + ' seconds ago';
    if (secs < 120) return 'a minute ago';
    if (secs < 3600) return Math.floor(secs / 60) + ' minutes ago';
    if (secs < 7200) return 'an hour ago';
    if (secs < 172800) return Math.floor(secs / 3600) + ' hours ago';
    return Math.floor(secs / 86400) + ' days ago';
  }

  /* "22 minutes" rather than "22 minutes ago", for sentences that supply their
     own tense. */
  function since(iso) {
    var a = ago(iso);
    return a === NONE ? NONE : a.replace(/ ago$/, '');
  }

  /* A billed total. en-US rather than the operator's own locale: the bill is
     issued in one currency and compared against itself, so a browser in
     another region must not relabel or re-group it. */
  function money(micros, currency, digits) {
    if (!isNum(micros)) return 'n/a';
    var places = digits === undefined ? MONEY_DIGITS : digits;
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency || 'USD',
        minimumFractionDigits: places,
        maximumFractionDigits: places
      }).format(micros / MICROS);
    } catch (e) {
      return (micros / MICROS).toFixed(places);
    }
  }

  function percent(basisPoints, digits) {
    if (!isNum(basisPoints)) return 'n/a';
    return (basisPoints / 100).toFixed(digits === undefined ? 1 : digits) + '%';
  }

  function signedPercent(basisPoints, digits) {
    if (!isNum(basisPoints)) return 'n/a';
    return (basisPoints > 0 ? '+' : '') + percent(basisPoints, digits);
  }

  function utcStamp(iso) {
    var t = parseTime(iso);
    if (!t) return null;
    return t.getUTCDate() + ' ' + MONTHS[t.getUTCMonth()] + ' ' + t.getUTCFullYear() +
      ' ' + pad2(t.getUTCHours()) + ':' + pad2(t.getUTCMinutes()) + ' UTC';
  }

  function utcDay(iso) {
    var t = parseTime(iso);
    if (!t) return null;
    return t.getUTCDate() + ' ' + MONTHS[t.getUTCMonth()] + ' ' + t.getUTCFullYear();
  }

  function hoursSince(iso) {
    var t = parseTime(iso);
    if (!t) return null;
    var raw = (Date.now() - t.getTime()) / 3600000;
    return raw >= 0 ? Math.floor(raw) : -Math.floor(-raw);
  }

  function hours(n) {
    return n + (Math.abs(n) === 1 ? ' hour' : ' hours');
  }

  var fmt = {
    none: NONE, isNum: isNum, int: int, plural: plural,
    clock: clock, stamp: stamp, ago: ago, since: since,
    money: money, percent: percent, signedPercent: signedPercent,
    utcStamp: utcStamp, utcDay: utcDay, hoursSince: hoursSince, hours: hours
  };

  /* ------------------------------------------------------------ the read */

  var UNSAFE_CHARS = /[\u0000-\u001F\u007F\s]/;

  /* Same-origin and relative, or nothing. Enforced here rather than left to
     the page's connect-src, so the rule holds wherever the value came from. */
  function safeHref(href) {
    if (typeof href !== 'string' || !href) return null;
    var text = href.trim();
    if (!text) return null;
    if (UNSAFE_CHARS.test(text)) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return null;
    if (text.slice(0, 2).replace(/\\/g, '/') === '//') return null;
    var resolved;
    try {
      resolved = new global.URL(text, global.location.href);
    } catch (e) {
      return null;
    }
    if (resolved.origin !== global.location.origin) return null;
    if (resolved.protocol !== global.location.protocol) return null;
    return text;
  }

  function isLoopback() {
    var host = global.location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  }

  /* The local verification hook, honoured only when the page itself is served
     from a loopback address and only for a relative path. It is what drives
     the states a live API will not produce on demand — a window nothing
     reported, a comparison the retention horizon refused, a day with no stored
     reading — so the four preview states can be looked at for real. */
  function fixtureUrl(paneId) {
    if (!isLoopback()) return null;
    try {
      return safeHref(global.localStorage.getItem('ops-pane-fixture-' + paneId));
    } catch (e) {
      return null;
    }
  }

  /* Resolves { data }. Rejects with the OpsApiError the transport raised,
     which a pane turns into a state rather than into a stack trace.

     source.query matters as much as source.endpoint: a request with no
     querystring is answered rather than refused, so a pane that sets the path
     and forgets the query draws confident figures for a selection nobody made,
     with the operator's own choice sitting in the bar above them. */
  function read(source) {
    var fixture = fixtureUrl(source.paneId);
    if (fixture) {
      return global.fetch(fixture, { cache: 'no-store' }).then(function (res) {
        if (!res.ok) throw new Error('fixture responded ' + res.status);
        return res.json();
      }).then(function (payload) {
        return { data: payload && payload.data };
      });
    }
    return session.call(source.endpoint, { query: source.query })
      .then(function (payload) { return { data: payload.data }; });
  }

  /* --------------------------------------------------------- filter state */

  /* Filter selections live in the querystring so a pane can be linked to and
     reloading keeps what was on screen. */
  var filters = { scope: 'all', range: null, env: 'production' };

  function shallow(o) {
    var c = {};
    Object.keys(o).forEach(function (k) { c[k] = o[k]; });
    return c;
  }

  function readFilters(pane) {
    var q = new URLSearchParams(global.location.search);

    var scope = q.get('scope');
    filters.scope = (pane.scope && SCOPES.some(function (s) { return s.v === scope; }))
      ? scope : 'all';

    if (pane.range) {
      var r = q.get('range');
      filters.range = pane.range.indexOf(r) !== -1
        ? r
        : (pane.rangeDefault || pane.range[0]);
    } else {
      filters.range = null;
    }

    var env = q.get('env');
    filters.env = (pane.env && ENVS.some(function (e) { return e.v === env; }))
      ? env : 'production';
  }

  function writeFilters(pane) {
    var q = new URLSearchParams(global.location.search);
    if (pane.scope) q.set('scope', filters.scope); else q.delete('scope');
    if (pane.range) q.set('range', filters.range); else q.delete('range');
    if (pane.env) q.set('env', filters.env); else q.delete('env');
    var qs = q.toString();
    global.history.replaceState(null, '',
      global.location.pathname + (qs ? '?' + qs : ''));
    refreshNavHrefs();
    emitFilters();
  }

  /* Fired for the selection the pane starts with as well as for every change
     to it. A pane that only hears about changes has to duplicate the reading
     of the querystring to know what it is showing before the operator touches
     anything, which is the duplication this bar exists to remove. */
  function emitFilters() {
    global.dispatchEvent(new CustomEvent('ops:filters', { detail: shallow(filters) }));
  }

  /* Carries the current selection onto a link to another pane, so moving
     between panes keeps the window you were looking at instead of silently
     resetting it. Only the filters the destination actually has are carried. */
  function hrefFor(pane) {
    var q = new URLSearchParams();
    if (pane.scope) q.set('scope', filters.scope);
    if (pane.range && pane.range.indexOf(filters.range) !== -1) q.set('range', filters.range);
    if (pane.env) q.set('env', filters.env);
    var qs = q.toString();
    return pane.file + (qs ? '?' + qs : '');
  }

  function paneHref(paneId) {
    var pane = PANES[paneId];
    return pane ? hrefFor(pane) : null;
  }

  /* assets/aria.js draws the rail from its own list and writes a bare filename
     into every href, because it knows nothing about filters. Rewriting them
     here is what stops changing the range and then moving pane from silently
     dropping you back onto the default window.

     Only hrefs the registry recognises are touched. A rail item this registry
     has never heard of is left exactly as aria.js wrote it rather than being
     guessed at or dropped. */
  var byFile = {};
  Object.keys(PANES).forEach(function (id) { byFile[PANES[id].file] = PANES[id]; });

  function refreshNavHrefs() {
    var rail = document.getElementById('rail');
    if (!rail) return;
    Array.prototype.forEach.call(rail.querySelectorAll('.nav-item'), function (link) {
      var file = (link.getAttribute('href') || '').split('?')[0];
      var pane = byFile[file];
      if (pane) link.setAttribute('href', hrefFor(pane));
    });
  }

  /* The range control this bar drew, and the pane it was drawn for. A pane
     owns its own filters but not this one, and a pane that offers to clear
     every filter has to be able to reach the one the shell holds. */
  var rangeControl = null;
  var rangePane = null;

  function resetRange() {
    if (!rangePane || !rangePane.range || !rangeControl) return false;
    var startsOn = rangePane.rangeDefault || rangePane.range[0];
    if (filters.range === startsOn) return false;
    filters.range = startsOn;
    rangeControl.value = startsOn;
    writeFilters(rangePane);
    return true;
  }

  /* -------------------------------------------------------- the filter bar */

  function segment(ariaLabel, options, current, onPick) {
    var seg = h('div', { className: 'seg', role: 'group', 'aria-label': ariaLabel });
    options.forEach(function (o) {
      var b = h('button', {
        type: 'button', text: o.l,
        className: o.v === current ? 'on' : '',
        'aria-pressed': String(o.v === current)
      });
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(seg.querySelectorAll('button'), function (x) {
          x.setAttribute('aria-pressed', 'false');
          x.classList.remove('on');
        });
        b.setAttribute('aria-pressed', 'true');
        b.classList.add('on');
        onPick(o.v);
      });
      seg.appendChild(b);
    });
    return seg;
  }

  function dropdown(id, options, current, onPick) {
    var select = h('select', { id: id });
    options.forEach(function (o) {
      var option = h('option', { value: o.v, text: o.l });
      if (o.v === current) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener('change', function () { onPick(select.value); });
    var wrap = h('div', { className: 'sel' }, [select, icon('chev')]);
    return { wrap: wrap, select: select };
  }

  /* A pane declares only the filters its own reads can act on. A control that
     changes nothing is worse than no control: picking Staging and being left
     looking at production, with the selection sitting in the bar as though it
     had been applied, is the failure this bar is shaped around. Where the
     approved design has a control nothing can carry yet, the note says so
     where the control would have been. */
  function renderFilters(pane) {
    if (!pane.scope && !pane.range && !pane.env && !pane.scopeNote && !pane.filterNote) {
      return null;
    }

    var bar = h('div', { className: 'filters' });

    if (pane.scope) {
      bar.appendChild(h('span', { className: 'filter-label', text: 'App' }));
      bar.appendChild(segment('App scope', SCOPES, filters.scope, function (v) {
        filters.scope = v;
        writeFilters(pane);
      }));
    }

    if (pane.range) {
      bar.appendChild(h('label', { className: 'filter-label', 'for': 'fRange', text: 'Range' }));
      var range = dropdown('fRange', pane.range.map(function (v) {
        return { v: v, l: RANGES[v] || v };
      }), filters.range, function (v) {
        filters.range = v;
        writeFilters(pane);
      });
      rangeControl = range.select;
      rangePane = pane;
      bar.appendChild(range.wrap);
    }

    if (pane.env) {
      bar.appendChild(h('label', { className: 'filter-label', 'for': 'fEnv', text: 'Env' }));
      bar.appendChild(dropdown('fEnv', ENVS, filters.env, function (v) {
        filters.env = v;
        writeFilters(pane);
      }).wrap);
    }

    [pane.scopeNote, pane.filterNote].forEach(function (note) {
      if (note) bar.appendChild(h('span', { className: 'pill ghost filter-note', text: note }));
    });

    return bar;
  }

  /* ------------------------------------------------------ the panel shapes */

  function card(className) {
    return h('div', { className: 'card' + (className ? ' ' + className : '') });
  }

  function cardHead(title, note, end) {
    var head = h('div', { className: 'card-head' });
    var words = h('div');
    words.appendChild(h('div', { className: 'card-title', text: title }));
    if (note) words.appendChild(h('div', { className: 'card-note', text: note }));
    head.appendChild(words);
    if (end && end.length) {
      var tail = h('div', { className: 'card-end' });
      end.forEach(function (node) { if (node) tail.appendChild(node); });
      head.appendChild(tail);
    }
    return head;
  }

  /* A titled section. The heading level is 2 because the pane's own name is
     the h1 in the top bar. */
  function bandHead(title, note, end) {
    var head = h('div', { className: 'band-head' });
    head.appendChild(h('h2', { className: 'band-title', text: title }));
    if (note) head.appendChild(h('span', { className: 'band-note', text: note }));
    if (end && end.length) {
      var tail = h('div', { className: 'band-end' });
      end.forEach(function (node) { if (node) tail.appendChild(node); });
      head.appendChild(tail);
    }
    return head;
  }

  function band(title, note, end) {
    var section = h('section', { className: 'band' });
    section.appendChild(bandHead(title, note, end));
    return section;
  }

  /* level defaults to 2, because a state block normally sits under the pane
     title in the top bar. The boot-failure card renders with no shell around
     it, so it passes 1 and becomes the page's only heading. */
  function stateBlock(iconName, title, lines, level) {
    var block = h('div', { className: 'state-block' });
    block.appendChild(h('div', { className: 'state-icon' }, [icon(iconName)]));
    block.appendChild(h('h' + (level || 2), { className: 'state-title', text: title }));
    (lines || []).forEach(function (line) {
      block.appendChild(h('p', { className: 'state-desc', text: line }));
    });
    return block;
  }

  function link(href, label, className) {
    return h('a', { className: className || 'btn btn-sm', href: href, text: label });
  }

  /* ------------------------------------------------------- the four states */

  /* Preview states are real states with real triggers here, not a switcher:
     loading is the read in flight, empty is a read that came back with nothing
     behind it, degraded is a pane on screen with at least one of its reads
     unreadable, and live is everything read. Visibility is aria.css's, keyed on
     data-shown, so a shown element keeps its own display type. */
  function region(content) {
    var loadingBox = h('div', { className: 'stack', 'data-state': 'loading' });
    var emptyBox = h('div', { className: 'stack', 'data-state': 'empty' });
    var liveBox = h('div', { className: 'stack', 'data-state': 'live degraded' });
    content.appendChild(loadingBox);
    content.appendChild(emptyBox);
    content.appendChild(liveBox);

    function fill(box, node) {
      clear(box);
      if (node) box.appendChild(node);
    }

    function loading(spec) {
      clear(loadingBox);
      (spec || [{ type: 'block', height: 80 }]).forEach(function (part) {
        loadingBox.appendChild(skeleton(part));
      });
      aria.applyState('loading');
    }

    function show(node) {
      fill(liveBox, node);
      aria.applyState('live');
    }

    function degraded(node) {
      fill(liveBox, node);
      aria.applyState('degraded');
    }

    function empty(node) {
      fill(emptyBox, node);
      aria.applyState('empty');
    }

    /* The whole read failed, so the pane is on screen and unreadable: that is
       the degraded state with nothing left in it, not an empty one. Empty says
       "there is nothing here", and a read that never landed has not earned
       that sentence. */
    function failed(err, retry) {
      var box = card();
      var block = stateBlock('warn', 'This pane could not be read', [
        failureMessage(err),
        'Nothing here is a zero. The figures are unread, not absent.'
      ]);
      if (retry) {
        var again = h('button', { className: 'btn btn-primary', type: 'button', text: 'Try again' });
        again.addEventListener('click', function () { retry(); });
        block.appendChild(h('div', { className: 'row mt-sm' }, [again]));
      }
      box.appendChild(block);
      degraded(box);
    }

    return {
      loading: loading, show: show, degraded: degraded, empty: empty, failed: failed
    };
  }

  function skeleton(part) {
    var box = card();
    var body = h('div', { className: 'card-body' });
    if (part.type === 'tiles') {
      var grid = h('div', { className: 'grid g4' });
      for (var i = 0; i < (part.count || 4); i++) {
        grid.appendChild(h('div', { className: 'card' }, [
          h('div', { className: 'card-body' }, [h('div', { className: 'skel skel-tile' })])
        ]));
      }
      return grid;
    }
    if (part.type === 'rows') {
      for (var r = 0; r < (part.count || 4); r++) {
        body.appendChild(h('div', { className: 'skel skel-row' }));
      }
    } else {
      var bar = h('div', { className: 'skel' });
      bar.style.setProperty('height', (part.height || 80) + 'px');
      body.appendChild(bar);
    }
    box.appendChild(body);
    return box;
  }

  function failureMessage(err) {
    if (err && typeof err.message === 'string' && err.message) return err.message;
    return 'The operations API did not answer.';
  }

  /* What a pane shows before the wave that builds it has shipped. An empty
     screen and a broken screen look identical, so this one says which it is. */
  function renderNotBuilt(pane) {
    var box = card();
    box.appendChild(stateBlock('layers', 'Not built yet', [
      pane.label + ' is part of ' + pane.wave + ', the ' +
        (WAVES[pane.wave] || '').toLowerCase() + '. Nothing behind this page is ' +
        'built yet, and nothing is being hidden from you.',
      'When it lands it answers: ' + pane.question
    ]));
    return box;
  }

  /* A pane the signed-in role may not open. Named plainly, with the role that
     would be needed, because "nothing here" is the wrong answer to "why". */
  function renderDenied(pane) {
    var box = card();
    box.appendChild(stateBlock('lock', 'You do not have access to this pane', [
      pane.label + ' is limited to ' + roleList(pane.roles) + '. You are signed in as ' +
        roleLabel(session.role()).toLowerCase() + '.',
      'Ask an owner if you need something here.'
    ]));
    return box;
  }

  function roleLabel(r) {
    if (r === 'owner') return 'Owner';
    if (r === 'operator') return 'Operator';
    if (r === 'viewer') return 'Viewer';
    return 'Signed in';
  }

  function roleList(roles) {
    var words = (roles || []).map(function (r) { return roleLabel(r).toLowerCase(); });
    if (!words.length) return 'nobody';
    if (words.length === 1) return 'the ' + words[0] + ' role';
    return 'the ' + words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1] + ' roles';
  }

  /* ------------------------------------------------------- announcements */

  var liveRegion = null;

  function announce(message) {
    if (!liveRegion) {
      liveRegion = h('div', { className: 'sr', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(liveRegion);
    }
    liveRegion.textContent = message;
  }

  function toast(iconName, message) {
    var host = document.querySelector('.toast-host');
    if (!host) {
      host = h('div', { className: 'toast-host' });
      document.body.appendChild(host);
    }
    var t = h('div', { className: 'toast', role: 'status' });
    t.appendChild(icon(iconName));
    t.appendChild(h('div', { text: message }));
    host.appendChild(t);
    global.setTimeout(function () { t.remove(); }, 4000);
  }

  /* ------------------------------------------------------- rail furniture */

  /* A count beside a rail item, or null to take one away.

     Badges are operational facts. aria.js renders none of its own and this
     shell invents none: a pane passes what it read, and a pane that read
     nothing passes nothing. A dashboard that invents a count is worse than one
     that shows nothing. */
  function setBadge(railId, badge) {
    var rail = document.getElementById('rail');
    if (!rail) return;
    var link = null;
    Array.prototype.forEach.call(rail.querySelectorAll('.nav-item'), function (item) {
      if (item.getAttribute('data-rail-id') === railId) link = item;
    });
    if (!link) return;

    Array.prototype.forEach.call(link.querySelectorAll('.nav-badge, .nav-badge-sr'), function (old) {
      link.removeChild(old);
    });
    if (!badge || !badge.label) return;

    link.appendChild(h('span', {
      className: 'nav-badge' + (badge.tone ? ' ' + badge.tone : ''),
      text: badge.label
    }));
    /* A bare number beside a pane name reads as part of the name when it is
       announced, and what it counts is only obvious on screen. */
    if (badge.description) {
      link.appendChild(h('span', { className: 'sr nav-badge-sr', text: ', ' + badge.description }));
    }
  }

  /* aria.js writes no id onto a rail item, so the item a badge belongs to is
     found by the href the registry gave it. Stamped once, right after boot, so
     setBadge() never has to re-derive it. */
  function stampRailIds() {
    var rail = document.getElementById('rail');
    if (!rail) return;
    Array.prototype.forEach.call(rail.querySelectorAll('.nav-item'), function (link) {
      var file = (link.getAttribute('href') || '').split('?')[0];
      var pane = byFile[file];
      if (pane && pane.railId) link.setAttribute('data-rail-id', pane.railId);
    });
  }

  /* --------------------------------------------------- rail as a drawer */

  /* aria.css hides the rail below 980px, which on a phone leaves a pane page
     with no navigation at all. Below that width it becomes an overlay, and an
     overlay is a dialog: it traps focus while it is open, closes on Escape,
     and hands focus back to the control that opened it. */
  var RAIL_BREAKPOINT = '(max-width: 980px)';

  function wireRail() {
    var rail = document.getElementById('rail');
    var toggle = document.getElementById('railToggle');
    if (!rail || !toggle) return;

    var scrim = null;
    var inerted = [];

    /* The live region and the toast host are appended to the body, so they are
       siblings of the app wrapper and would otherwise be inerted with it — and
       a live region carrying aria-hidden announces nothing. Neither holds
       focusable content, so leaving them out costs the drawer's modality
       nothing. */
    function isLiveRegion(el) {
      return el.hasAttribute('aria-live') || el.classList.contains('toast-host');
    }

    /* A scrim stops a pointer reaching the shell behind the drawer, but a
       virtual cursor walks straight past a scrim. Everything that is not the
       rail goes inert as well, so the drawer is modal for a screen reader and
       not only for a mouse. */
    function setBackgroundInert(on) {
      if (!on) {
        inerted.forEach(function (el) {
          if ('inert' in el) el.inert = false;
          el.removeAttribute('aria-hidden');
        });
        inerted = [];
        return;
      }
      /* The rail sits inside the app wrapper, so "everything else" is not a
         list of body children: it is the rail's siblings at every level up to
         the body. Inerting an ancestor of the rail would inert the rail. */
      inerted = [];
      var node = rail;
      while (node && node !== document.body && node.parentElement) {
        var parent = node.parentElement;
        var self = node;
        Array.prototype.forEach.call(parent.children, function (sib) {
          if (sib !== self && sib !== scrim && !isLiveRegion(sib)) inerted.push(sib);
        });
        node = parent;
      }
      inerted.forEach(function (el) {
        if ('inert' in el) el.inert = true;
        el.setAttribute('aria-hidden', 'true');
      });
    }

    function open() {
      rail.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Close navigation');
      scrim = h('div', { className: 'scrim' });
      scrim.addEventListener('click', function () { close(); });
      document.body.appendChild(scrim);
      setBackgroundInert(true);
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('focusin', onFocusIn, true);
      var first = rail.querySelector('a, button');
      if (first) first.focus();
    }

    function close(restore) {
      rail.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open navigation');
      setBackgroundInert(false);
      if (scrim) { scrim.remove(); scrim = null; }
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn, true);
      if (restore !== false) toggle.focus();
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      var items = rail.querySelectorAll('a, button');
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    function onFocusIn(e) {
      if (!rail.contains(e.target)) {
        var first = rail.querySelector('a, button');
        if (first) first.focus();
      }
    }

    toggle.addEventListener('click', function () {
      if (rail.classList.contains('is-open')) close();
      else open();
    });

    /* Growing past the breakpoint turns the overlay back into a permanent
       column, at which point trapping focus inside it would be a bug. */
    var mq = global.matchMedia(RAIL_BREAKPOINT);
    var onBreakpoint = function (e) {
      if (!e.matches && rail.classList.contains('is-open')) close(false);
    };
    if (mq.addEventListener) mq.addEventListener('change', onBreakpoint);
    else if (mq.addListener) mq.addListener(onBreakpoint);
  }

  /* ------------------------------------------------------- pane contents */

  /* A pane page loads this file and then its own module, which calls
     definePane() as it executes. A pane with no registration renders the
     not-built state.

     The shell must not read this until the parser has run every script on the
     page, and "the session call is slower than parsing" is not a substitute
     for waiting. A classic script blocks the parser, but while the browser is
     downloading the next one the event loop is free, so the session response
     can land, and its handler run, in the gap between this file executing and
     the pane's module executing. Against a fast server that race is lost more
     often than won, and it renders the pane as not built while its module is
     one request behind. So init() waits for the document to finish parsing
     before it asks what a pane's contents are.

     Registration rather than a flag in the registry, because the thing that
     knows whether a pane is built is the pane's own module being on the page.
     A boolean could claim "built" on a page that loads nothing to build it. */
  var paneContent = {};
  function definePane(id, render) { paneContent[id] = render; }

  function whenParsed() {
    if (document.readyState !== 'loading') return Promise.resolve();
    return new Promise(function (resolve) {
      document.addEventListener('DOMContentLoaded', function () { resolve(); }, { once: true });
    });
  }

  /* ------------------------------------------------------------- booting */

  function setGate(name) {
    document.body.className = 'is-' + name;
  }

  /* Each gate carries its own h1 and its own <main>, so the heading and
     landmark structure is correct while that gate is the only thing on screen.
     Once the outcome is known the losing gates come out of the document
     entirely: display:none would keep them out of the accessibility tree, but
     removing them leaves exactly one h1 and exactly one <main>. */
  function dropGates(selectors) {
    selectors.forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el) el.remove();
    });
  }

  var FAILURE_TITLES = {
    ops_role_insufficient: 'Your role does not allow this',
    ops_reauth_rate_limited: 'Too many attempts',
    ops_login_rate_limited: 'Too many attempts',
    ops_route_missing: 'That page is not there',
    ops_bad_response: 'The operations API answered with something unreadable',
    ops_storage_unavailable: 'This browser would not store your session'
  };

  var FAILURE_NOTES = {
    ops_storage_unavailable:
      'Nothing has been signed out, and the session is still live on the server. ' +
      'It is this browser that cannot keep hold of it.'
  };

  function renderFailure(err) {
    var host = document.getElementById('gateFailed');
    if (!host) return;
    host.textContent = '';

    var code = err && err.code;
    var box = card();
    var block = stateBlock('warn', FAILURE_TITLES[code] || 'Could not check your session', [
      err && err.message ? err.message :
        'The operations API did not answer. Your session has not been ended.',
      FAILURE_NOTES[code] || 'Nothing has been signed out. Try again in a moment.'
    ], 1);

    var row = h('div', { className: 'row mt-sm' });
    var retry = h('button', { className: 'btn btn-primary', type: 'button', text: 'Try again' });
    retry.addEventListener('click', function () { global.location.reload(); });
    var out = h('button', { className: 'btn', type: 'button', text: 'Sign out' });
    out.addEventListener('click', function () {
      /* The whole sign-out, not the local half of one: signOut() revokes first
         and clears afterwards, and it resolves whether or not the call got
         through. Dropping the stored credential here and calling it done would
         leave the session alive on the server for every other copy of it. */
      out.disabled = true;
      session.signOut();
    });
    row.appendChild(retry);
    row.appendChild(out);
    block.appendChild(row);

    box.appendChild(block);
    host.appendChild(box);
    setGate('failed');
    dropGates(['.gate-boot', '.gate-app']);
    /* The boot placeholder said "Checking your session" and then silently
       became something else. Move focus so a screen reader is told. */
    host.focus();
  }

  function sessionLabel() {
    var d = session.daysLeft();
    if (d === null) return '';
    if (d === 0) return 'session ends today';
    return 'session ' + d + 'd left';
  }

  /* The rail footer, from the session rather than from a literal. It is passed
     to aria.js, which renders nothing at all when it is absent. */
  function accountConfig() {
    var admin = session.state.admin;
    if (!admin) return null;
    return {
      name: admin.displayName || '',
      email: admin.email || '',
      meta: [roleLabel(admin.role), sessionLabel()].filter(Boolean).join(' \u00b7 ')
    };
  }

  /* The one badge this shell knows without asking a pane: a pane the signed-in
     role cannot open. The rail still links to it, because the destination says
     which role it needs and that is a better answer than a dead span. */
  function lockedBadges() {
    var badges = {};
    Object.keys(PANES).forEach(function (id) {
      var pane = PANES[id];
      if (!pane.roles || !pane.railId) return;
      if (session.hasRole(pane.roles)) return;
      badges[pane.railId] = {
        label: 'locked', tone: 'soon',
        description: pane.roles.length === 1
          ? pane.roles[0] + ' access only'
          : 'you do not have access'
      };
    });
    return badges;
  }

  function railToggle() {
    var toggle = h('button', {
      className: 'btn btn-icon btn-ghost rail-toggle', type: 'button', id: 'railToggle',
      'aria-label': 'Open navigation', 'aria-expanded': 'false', 'aria-controls': 'rail'
    });
    toggle.appendChild(icon('layers'));
    return toggle;
  }

  /* Boots a pane page. The app markup stays behind the gate until the API has
     confirmed a session, so there is no state in which a partly built shell is
     on screen: it is the boot placeholder, the failure card, or the real
     thing. */
  function init() {
    var pageId = document.body.getAttribute('data-pane');
    var pane = PANES[pageId];
    if (!pane) throw new Error('Unknown pane: ' + pageId);

    document.title = pane.label + ' | Aria Operations';
    setGate('booting');

    session.boot().then(whenParsed).then(function () {
      readFilters(pane);

      var app = document.getElementById('app');
      clear(app);

      app.appendChild(h('nav', { className: 'rail', id: 'rail', 'aria-label': 'Panes' }));

      var main = h('div', { className: 'main' });
      main.appendChild(h('header', { className: 'topbar', id: 'topbar' }));
      var bar = renderFilters(pane);
      if (bar) main.appendChild(bar);

      var content = h('main', { className: 'content', id: 'content', tabindex: '-1' });
      main.appendChild(content);
      app.appendChild(main);

      /* The rail and the top bar are aria.js's, drawn from the id the registry
         gave this pane. Everything below is this file's. */
      aria.boot({
        id: pane.railId,
        title: pane.label,
        sub: pane.question,
        badges: lockedBadges(),
        account: accountConfig()
      });
      stampRailIds();
      refreshNavHrefs();

      var topbar = document.getElementById('topbar');
      if (topbar) topbar.insertBefore(railToggle(), topbar.firstChild);

      if (pane.roles && !session.hasRole(pane.roles)) content.appendChild(renderDenied(pane));
      else if (paneContent[pageId]) paneContent[pageId](content, pane);
      else content.appendChild(renderNotBuilt(pane));

      setGate('ready');
      dropGates(['.gate-boot', '.gate-failed']);
      wireRail();

      /* Both events fire after the session is confirmed and the shell is in
         the document, so a pane script that adds its listeners while this file
         is still booting cannot miss them. ops:ready is the signal that
         #content exists; ops:filters then carries the starting selection. */
      global.dispatchEvent(new CustomEvent('ops:ready', {
        detail: { pane: pageId, filters: shallow(filters) }
      }));
      emitFilters();
    }).catch(function (err) {
      /* A terminal failure has already navigated to the sign-in screen and its
         promise never settles, so anything arriving here is a fault the
         operator can retry rather than a session that has ended. */
      renderFailure(err);
    });
  }

  /* Pane pages carry no script of their own. Loading this file on a page whose
     body names a pane is the whole contract. data-pane rather than data-page,
     so the two shells cannot both claim the same document. */
  if (document.body && PANES[document.body.getAttribute('data-pane')]) init();

  global.OpsPaneShell = {
    init: init,
    definePane: definePane,
    panes: PANES,
    filters: function () { return shallow(filters); },
    resetRange: resetRange,
    paneHref: paneHref,
    setBadge: setBadge,
    region: region,
    read: read,
    safeHref: safeHref,
    isLoopback: isLoopback,
    failureMessage: failureMessage,
    h: h,
    icon: icon,
    card: card,
    cardHead: cardHead,
    band: band,
    bandHead: bandHead,
    stateBlock: stateBlock,
    link: link,
    announce: announce,
    toast: toast,
    fmt: fmt
  };
})(window);
