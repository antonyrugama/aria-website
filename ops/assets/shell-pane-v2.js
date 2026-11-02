/* The v2 pane bootstrap: session gate, navigation, top bar, filter bar, and
   the four preview states.

   assets/aria.js draws the navigation (a rail on a desktop, a bottom bar on a
   phone) and the top bar from one page-level config and
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
     paneFilters(nodes)      put the pane's own controls in the shared filter
                             bar, replacing any it put there before. A pane
                             declares in the registry what the shell can filter
                             on; this is for a control only the pane's own read
                             can honour, such as a facet one endpoint takes
     paneHref(paneId)        a link to another pane carrying the selection
     setBadge(paneId, badge) put a count beside every place the navigation
                             names that pane: its destination in the rail and
                             on the phone, its link in the row under the title,
                             its menu item. Remove it with null. badge is
                             { label, tone, description }
     region(content)         the four preview states, as a region a pane owns
     h(tag, opts, children)  DOM builder. Never innerHTML
     icon(name, className)   assets/aria.js's icon set, as an SVGElement
     card / cardHead / band / bandHead / stateBlock / link   the v2 shapes
     announce(message)       polite live-region announcement
     toast(iconName, text)   transient confirmation
     fmt                     the formatters every pane prints figures through
     read(source)            a pane's own read, with the local fixture hook
     safeHref(text)          a same-origin, same-scheme href, or null
     isLoopback()            whether this page is being served locally, which
                             is the only place a fixture may be read from
     failureMessage(error)   what to tell a person about a failed read, with
                             contact details masked
     panes                   the registry, read-only

   That list is the whole of it, in both directions: a test boots the page and
   compares Object.keys(OpsPaneShell) against the names in this block and
   against ops/README.md's table, so neither can document a function that does
   not exist or miss one that does.

   Two events fire on window once the shell is in the document, in this order:
   ops:ready (detail { pane, filters }) and then ops:filters (detail = the
   selection). ops:filters fires again on every change. Both carry the starting
   selection so a pane does not have to read the querystring itself.

   Nothing here uses innerHTML, and no style attribute is written into markup.
   The pane displays production operational data to an administrator, so no
   value from the API, the querystring or storage may become markup, and the
   page's Content-Security-Policy carries no 'unsafe-inline'. The one style
   write, the skeleton height in skeleton(), goes through CSSOM, which CSP does not
   gate; it materialises a style attribute on the two .skel elements and on
   nothing else.

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
  var maskContactDetails = registry.maskContactDetails;

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

  /* assets/aria.js draws its navigation from its own list and writes a bare
     filename into every href, because it knows nothing about filters.
     Rewriting them here is what stops changing the range and then moving pane
     from silently dropping you back onto the default window.

     Only hrefs the registry recognises are touched. A link this registry has
     never heard of is left exactly as aria.js wrote it rather than being
     guessed at or dropped. The menu's anchors (settings.html#sessions) are
     matched on the file alone and keep their fragment. */
  var byFile = {};
  Object.keys(PANES).forEach(function (id) { byFile[PANES[id].file] = PANES[id]; });

  function refreshNavHrefs() {
    var links = document.querySelectorAll('.nav-item, .tab-item, .subnav-item, .menu-item');
    Array.prototype.forEach.call(links, function (link) {
      var raw = link.getAttribute('href') || '';
      var hash = raw.indexOf('#') === -1 ? '' : raw.slice(raw.indexOf('#'));
      var file = raw.split('#')[0].split('?')[0];
      var pane = byFile[file];
      if (pane) link.setAttribute('href', hrefFor(pane) + hash);
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

  /* The pane's own controls, in the bar the shell drew.

     The registry says what the SHELL can filter on, and it is deliberately a
     closed set: scope, range and environment mean the same thing on every
     pane, so they are decided once. A facet only one endpoint takes — the
     severity the problems API filters on, say — cannot live there without the
     registry growing a column per pane, so the pane builds those controls and
     hands them over.

     The same rule still applies to what a pane puts here: a control that
     changes nothing is worse than no control. What this adds is where the
     controls go, not permission to draw one that does nothing.

     Replaces whatever the pane put here last, so a pane that re-renders its
     controls to show a cleared selection swaps its own nodes and touches
     neither the shell's controls nor the notes. The slot sits after the
     shell's controls and before the notes, which state an absence and belong
     at the end of the bar. */
  var paneSlot = null;

  function paneFilters(nodes) {
    var bar = document.querySelector('.filters');
    if (!bar) {
      /* A pane with no shell filters and no note has no bar to stand in, so
         one is made. It is put where renderFilters would have put it: after
         the top bar, before the content. */
      var main = document.querySelector('.main');
      var content = document.getElementById('content');
      if (!main || !content) return null;
      bar = h('div', { className: 'filters' });
      main.insertBefore(bar, content);
    }
    if (!paneSlot || paneSlot.parentNode !== bar) {
      paneSlot = h('div', { className: 'filters-pane' });
      var notes = bar.querySelectorAll('.filter-note');
      if (notes.length) bar.insertBefore(paneSlot, notes[0]);
      else bar.appendChild(paneSlot);
    }
    clear(paneSlot);
    (nodes || []).forEach(function (node) { if (node) paneSlot.appendChild(node); });
    return paneSlot;
  }

  /* ------------------------------------------------------ the panel shapes */

  function card(className) {
    return h('div', { className: 'card' + (className ? ' ' + className : '') });
  }

  /* The title is a heading, not a styled div, so a card cannot be a section a
     screen reader navigating by heading jumps straight past. h3 because
     bandHead is the h2 and the pane's own name is the h1 in the top bar.
     Nothing has to be undone for the tag: aria.css:131 is `* { margin: 0 }`,
     so the heading arrives with no box of its own and .card-title's type
     rules land on it unchanged. */
  function cardHead(title, note, end) {
    var head = h('div', { className: 'card-head' });
    var words = h('div');
    words.appendChild(h('h3', { className: 'card-title', text: title }));
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

  var FAILURE_FALLBACK = 'The operations API did not answer.';
  var FAILURE_MESSAGES = {
    ops_unreachable: 'Could not reach the operations API. Check your connection and try again.',
    ops_role_insufficient: 'Your role does not allow this. Ask an owner if you need it.',
    ops_route_missing: 'This part of the dashboard is not answering yet.',
    ops_bad_response: 'The operations API answered with something this page could not read.'
  };

  function failureMessage(err) {
    var code = err && err.code;
    if (err && typeof err.message === 'string' && err.message) {
      return maskContactDetails(err.message);
    }
    if (Object.prototype.hasOwnProperty.call(FAILURE_MESSAGES, code)) {
      return FAILURE_MESSAGES[code];
    }
    return FAILURE_FALLBACK;
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

  /* ----------------------------------------------------------- navigation */

  /* A count beside every place the navigation names a pane, or null to take
     it away.

     Badges are operational facts. aria.js renders none of its own and this
     shell invents none: a pane passes what it read, and a pane that read
     nothing passes nothing. A dashboard that invents a count is worse than one
     that shows nothing.

     The key is a pane id. aria.js files each destination under the id of the
     pane it opens on, and the row under the title and the avatar menu carry
     the id of the pane they link to, so one call reaches the rail, the phone
     bar and the row at once and a pane never has to know which of them wears
     its count. */
  function setBadge(paneId, badge) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-badge-key]'), function (link) {
      if (link.getAttribute('data-badge-key') !== paneId) return;
      Array.prototype.forEach.call(link.querySelectorAll('.nav-badge, .nav-badge-sr'), function (old) {
        link.removeChild(old);
      });
      aria.appendBadge(link, badge);
    });
  }

  /* The row of sibling panes under the title. A destination is five links in
     the rail, but Health is three pages (problems, what is running, what
     happened) and Growth two, and a deep link to any of them has to land
     somewhere that can reach the others. The destination's own pages are
     listed with the one on screen marked; a destination with a single page, and
     a page that belongs to none, has no row. */
  function renderSubnav(pane) {
    if (!pane.destination) return null;
    var ids = registry.panesOf(pane.destination);
    if (ids.length < 2) return null;

    var destination = null;
    registry.DESTINATIONS.forEach(function (d) { if (d.id === pane.destination) destination = d; });

    var nav = h('nav', {
      className: 'subnav', id: 'subnav',
      'aria-label': (destination ? destination.label : 'Section') + ' pages'
    });
    ids.forEach(function (id) {
      var target = PANES[id];
      var on = target === pane;
      var link = h('a', {
        className: 'subnav-item' + (on ? ' on' : ''),
        href: hrefFor(target), 'data-badge-key': id, text: target.label
      });
      if (on) link.setAttribute('aria-current', 'page');
      nav.appendChild(link);
    });
    return nav;
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
      err && err.message ? failureMessage(err) :
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

  /* The rail footer and the avatar menu, from the session rather than from a
     literal. It is passed to aria.js, which renders nothing at all when it is
     absent. */
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
     role cannot open. The navigation still links to it, because the
     destination says which role it needs and that is a better answer than a
     dead span. Filed under the pane's own id, which is where aria.js looks. */
  function lockedBadges() {
    var badges = {};
    Object.keys(PANES).forEach(function (id) {
      var pane = PANES[id];
      if (!pane.roles) return;
      if (session.hasRole(pane.roles)) return;
      badges[id] = {
        label: 'locked', tone: 'soon',
        description: pane.roles.length === 1
          ? pane.roles[0] + ' access only'
          : 'you do not have access'
      };
    });
    return badges;
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

      app.appendChild(h('nav', { className: 'rail', id: 'rail', 'aria-label': 'Main' }));

      var main = h('div', { className: 'main' });
      main.appendChild(h('header', { className: 'topbar', id: 'topbar' }));
      var subnav = renderSubnav(pane);
      if (subnav) main.appendChild(subnav);
      var bar = renderFilters(pane);
      if (bar) main.appendChild(bar);

      var content = h('main', { className: 'content', id: 'content', tabindex: '-1' });
      main.appendChild(content);
      app.appendChild(main);
      app.appendChild(h('nav', { className: 'bottom-nav', id: 'bottomNav', 'aria-label': 'Main' }));

      /* The navigation and the top bar are aria.js's, drawn from the
         destination the registry gave this pane. Everything below is this
         file's. */
      aria.boot({
        id: pane.destination,
        title: pane.label,
        sub: pane.datedHead ? '' : pane.question,
        subSlot: !!pane.datedHead,
        badges: lockedBadges(),
        account: accountConfig(),
        lookup: { href: paneHref('users') }
      });
      refreshNavHrefs();

      if (pane.roles && !session.hasRole(pane.roles)) content.appendChild(renderDenied(pane));
      else if (paneContent[pageId]) paneContent[pageId](content, pane);
      else content.appendChild(renderNotBuilt(pane));

      setGate('ready');
      dropGates(['.gate-boot', '.gate-failed']);

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
     so the two shells cannot both claim the same document. Exported first, so
     the surface exists before anything init() reaches can call back into it. */
  global.OpsPaneShell = {
    init: init,
    definePane: definePane,
    panes: PANES,
    filters: function () { return shallow(filters); },
    resetRange: resetRange,
    paneFilters: paneFilters,
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

  if (document.body && PANES[document.body.getAttribute('data-pane')]) init();
})(window);
