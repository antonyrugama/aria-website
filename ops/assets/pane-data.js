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
     future read API decides to send.

     What it covers, stated exactly rather than generously: every rate drawn
     over a group of people, whether it arrives as a numerator and denominator
     or already computed. A rate that arrives with no denominator at all is not
     drawn either, because a base that is unknown cannot be known to clear the
     floor. Two figures on these panes are deliberately outside it, because
     neither is a rate over people: coverage, which is a share of sessions on
     an app version, and unit cost, which is money. */
  var REPORTING_FLOOR = 50;

  /* Whether a value from the payload may be used as a link target.

     Every href on these panes comes from the response, so the pane decides
     what a link may be rather than trusting the sender. Relative paths on this
     origin only: anything carrying a scheme, anything protocol-relative, and
     anything that resolves off this origin is refused. The pages' content
     policy would already stop a javascript: URL from running, but the
     guarantee belongs next to the code that builds the link rather than in a
     meta tag somebody may loosen later.

     Four checks rather than two, because the first version tested the text and
     the browser navigates the *resolved* URL, and the two are not the same
     string:

       1. No control characters or whitespace anywhere inside the value. The
          URL parser strips tabs and newlines before it looks for a scheme, so
          "java\tscript:alert(1)" reaches the browser as "javascript:" while
          sailing past a scheme test that only knows [a-z0-9+.-]. Refused
          rather than stripped: a target that had to be edited to be safe is
          not a target this pane was handed.
       2. No scheme.
       3. No authority. A backslash is a path separator to the URL parser, so
          "/\evil.example/x" is protocol-relative in every way that matters and
          resolves cross-origin; the leading pair is normalised before it is
          compared, which covers //, /\, \\ and \/.
       4. The resolved URL is on this origin. This is the check that actually
          holds the guarantee, because it is made against the same value the
          browser would navigate rather than against the text it started as.

     Returns the original relative text, so a link that passes stays relative
     and keeps working under whatever origin the page is served from. */
  var UNSAFE_CHARS = /[\u0000-\u0020\u007f]/;

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

  /* Series colours arrive as token names, never as colour values.

     A raw colour from the payload is the one way a figure can end up unreadable
     on a theme it was not picked against: brand cyan at full brightness on the
     light theme's white card is roughly 1.3:1. Naming a token instead keeps
     both themes' answers in the stylesheet, where they were measured.

     The set is closed: the six series tokens, plus "muted" for the comparison
     line a trend is read against, which is deliberately not one of the six.
     Anything else falls back to the default series token rather than being
     applied. */
  var SERIES_TOKENS = {
    s1: 'var(--s1)', s2: 'var(--s2)', s3: 'var(--s3)',
    s4: 'var(--s4)', s5: 'var(--s5)', s6: 'var(--s6)',
    muted: 'var(--text-3)'
  };

  function seriesColor(name) {
    return (typeof name === 'string' &&
      Object.prototype.hasOwnProperty.call(SERIES_TOKENS, name))
      ? SERIES_TOKENS[name] : null;
  }

  /* The colour a series is actually drawn in, which is the fallback above
     applied rather than described.

     Everything that draws a series reads it from here: the line, and the
     legend key beside it. Two call sites doing `seriesColor(x) || default`
     independently is how the legend ended up with transparent swatches beside
     lines that had taken the fallback, which is worse than an unrecognised
     colour, because the key and the picture then disagree about which line is
     which. */
  function seriesStroke(name) {
    return seriesColor(name) || SERIES_TOKENS.s1;
  }

  /* A link the response asked for, or its label as plain text.

     A target safeHref refuses still leaves a label the payload wrote into a
     sentence, so the words stay and only the navigation is withheld. Dropping
     the whole element instead leaves a sentence pointing at a button that is
     not there. */
  function payloadLink(link, className) {
    if (!link || typeof link !== 'object') return null;
    var label = typeof link.label === 'string' ? link.label : '';
    if (!label) return null;
    var href = safeHref(link.href);
    if (!href) return h('span', { className: 'small muted', text: label });
    return h('a', { className: className || 'btn btn-sm', href: href, text: label });
  }

  /* A link to another pane, or to this one under a different window, with the
     operator's current selection carried across.

     Built from the shell's own registry and filter state rather than by
     concatenating a querystring by hand, so a recovery link cannot silently
     return somebody scoped to Coaches Web on Staging to All on Production.
     Only the filters the destination actually has are carried. */
  function paneUrl(paneId, overrides) {
    var pane = (shell.panes || {})[paneId];
    if (!pane) return null;
    var now = shell.filters();
    var q = new URLSearchParams();
    if (pane.scope) q.set('scope', now.scope);
    if (pane.env) q.set('env', now.env);
    if (pane.range) {
      var range = (overrides && overrides.range) || now.range;
      if (pane.range.indexOf(range) !== -1) q.set('range', range);
    }
    var qs = q.toString();
    return pane.file + (qs ? '?' + qs : '');
  }

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
     deployment on the real origin can never read one, and only when the stored
     value is a relative path, so "same-origin" is enforced here rather than
     left to the page's connect-src. */
  function fixtureUrl(paneId) {
    if (!isLoopback()) return null;
    try {
      return safeHref(global.localStorage.getItem('ops-pane-fixture-' + paneId));
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
     under a date it was not counted on.

     Which is why parsing cannot go straight to `new Date`. A date-time string
     with no offset, "2026-07-31T06:00:00", is parsed as *local* time by the
     language, so formatting it back out with getUTC* and appending " UTC"
     produces a stamp that is wrong by the operator's own offset and wrong by a
     different amount for the next operator. Anything without a designator is
     read as the UTC the pipeline meant; anything carrying Z or an offset is
     left alone, because it already says what it is.

     Anything that is not a string, and any string this cannot read, is absent
     rather than approximate. That is a rule about `null` specifically: `null`
     is the ordinary way a JSON API says "not known", and `new Date(null)` is
     the epoch rather than an invalid date, so a timestamp nobody reported used
     to render "1 Jan 1970 00:00 UTC" and an age of half a million hours, both
     computed from a field that was never sent. `0` does the same. A Date is
     accepted because a caller may already hold one; nothing else is coerced. */
  var HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

  function parseUtc(value) {
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? null : value;
    }
    if (typeof value !== 'string') return null;
    var text = value.trim().replace(' ', 'T');
    /* Date-only strings are already UTC by specification, so only the
       date-time forms are stamped. */
    if (/^\d{4}-\d{2}-\d{2}T/.test(text) && !HAS_ZONE.test(text)) text += 'Z';
    var d = new Date(text);
    return isNaN(d.getTime()) ? null : d;
  }

  function utcStamp(iso) {
    var d = parseUtc(iso);
    if (!d) return null;
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear() +
      ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ' UTC';
  }

  function utcDay(iso) {
    var d = parseUtc(iso);
    if (!d) return null;
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  /* Whole hours since an instant, for staleness. Signed, and truncated towards
     zero: a reading eight and a half hours old is "8 hours old" rather than
     nine, and a reading stamped ahead of now comes back negative rather than
     clamped to fresh.

     The sign is the point. A reading from the future is not a fresh reading;
     it is a clock that disagrees with this page, and clamping it to zero hides
     exactly the case the staleness check exists to catch. Truncating rather
     than flooring also keeps a stamp slightly ahead, which is ordinary clock
     drift between two machines, from being reported as an hour.

     State the tolerance rather than imply it: truncation makes it sub-hour,
     not "a few minutes", so a stamp up to 59 minutes ahead comes back as
     negative zero and reads as fresh. That is deliberate. The two realistic
     causes of a stamp ahead of a browser clock are a timezone or DST error,
     which is a whole hour or more and is caught, and NTP drift, which is
     seconds; a 59-minute skew is neither, and the stamp itself is on screen
     for a reader who wants to check it. */
  function hoursSince(iso) {
    var d = parseUtc(iso);
    if (!d) return null;
    var raw = (Date.now() - d.getTime()) / 3600000;
    return raw >= 0 ? Math.floor(raw) : -Math.floor(-raw);
  }

  /* "1 hour", "3 hours". Small, but it is in every staleness sentence. */
  function hours(n) {
    return n + (Math.abs(n) === 1 ? ' hour' : ' hours');
  }

  /* The article a spoken number wants: an 8, an 11, an 18, an 80. Used where a
     figure from the payload lands mid-sentence. */
  function article(n) {
    var s = String(n);
    if (s === '11' || s === '18') return 'an';
    if (s.charAt(0) === '8' && s.length <= 2) return 'an';
    return 'a';
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

  /* Where keyboard focus goes when a pane replaces the subtree that held it.

     "Try again" and "Check again" both repaint synchronously, which removes
     the button the reader just activated while it holds focus, and the browser
     answers that by dropping focus to the document body. The announcement says
     what happened; this says where the reader now is. Focus moves to the first
     control the replacement offers, or to the replacement itself when it
     offers none, which is why the container takes a programmatic tabindex
     rather than a real one: it is a landing place, not a tab stop. */
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), ' +
    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function refocus(host) {
    var target = host.querySelector(FOCUSABLE);
    if (!target) {
      /* Only the fallback takes the attribute. Putting tabindex="-1" on a
         control that is already focusable would take it out of the tab order,
         which is the opposite of the repair. */
      target = host.firstElementChild || host;
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    }
    try { target.focus(); } catch (e) { /* a detached node is not worth a throw */ }
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
     underneath, and saying that plainly is the whole point of the state.

     The closing sentence used to promise that figures would appear "without
     another release". They will not: the pane holds no path to call, so the
     slice that builds the reporting has to ship the path with it. Promising
     otherwise would make this state the one place on the pane that says
     something the code cannot do. */
  function noSource(opts) {
    return stateCard('empty', opts.title, [
      opts.detail,
      opts.closing ||
        'Nothing is being hidden from you, and nothing here is a zero. This ' +
        'page shows these figures once the reporting behind it is built and ' +
        'the release that builds it points this pane at it.'
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

  function finiteCount(values) {
    var n = 0;
    (values || []).forEach(function (v) {
      if (typeof v === 'number' && isFinite(v)) n += 1;
    });
    return n;
  }

  function pointY(v, bounds, height, pad) {
    return height - pad - ((v - bounds.min) / (bounds.max - bounds.min)) * (height - pad * 2);
  }

  /* One series against an x step handed in from outside.

     The step is a parameter rather than something derived from this series'
     own length on purpose. Two series drawn on one chart are the same days, so
     a day missing from one of them must leave a gap in that line rather than
     stretch it across the full width and put the two lines on different
     scales. A missing point breaks the path and the pen restarts, which is
     what a gap in a daily series actually is. */
  function seriesPath(values, bounds, step, height, pad) {
    var d = '';
    var pen = 'M';
    (values || []).forEach(function (v, i) {
      if (typeof v !== 'number' || !isFinite(v)) { pen = 'M'; return; }
      d += pen + (pad + i * step).toFixed(2) + ' ' +
        pointY(v, bounds, height, pad).toFixed(2);
      pen = 'L';
    });
    return d;
  }

  function stepFor(length, width, pad) {
    return length > 1 ? (width - pad * 2) / (length - 1) : 0;
  }

  /* A twelve-point trend beside a figure. Deliberately unlabelled on its axes:
     it says "rising, and by roughly this much", and the exact current value is
     the number it sits under. */
  function sparkline(values, opts) {
    opts = opts || {};
    var width = 260;
    var height = 44;
    var svg = chartFrame(width, height, opts.label || 'Trend', 'spark');
    if (finiteCount(values) < 2) return svg;

    var bounds = extent(values || []);
    var line = svgEl('path', {
      d: seriesPath(values, bounds, stepFor((values || []).length, width, 4), height, 4),
      fill: 'none',
      stroke: seriesStroke(opts.color),
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
    var length = 0;
    (config.series || []).forEach(function (s) {
      var values = s.values || [];
      if (values.length > length) length = values.length;
      values.forEach(function (v) { all.push(v); });
    });
    if (finiteCount(all) < 2) return svg;
    var bounds = extent(all.concat([0]));

    /* One x scale for the whole chart, taken from the longest series, so both
       lines put day seven in the same place whatever either of them is
       missing. Marks index the series as it arrived rather than a filtered
       copy of it, so a mark cannot slide onto the wrong day. */
    var step = stepFor(length, width, pad);

    (config.series || []).forEach(function (s) {
      var values = s.values || [];
      if (finiteCount(values) < 2) return;
      svg.appendChild(svgEl('path', {
        d: seriesPath(values, bounds, step, height, pad),
        fill: 'none',
        stroke: seriesStroke(s.color),
        'stroke-width': s.dashed ? 1.4 : 2,
        'stroke-dasharray': s.dashed ? '5 4' : '',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'vector-effect': 'non-scaling-stroke'
      }));

      (s.marks || []).forEach(function (index) {
        var v = values[index];
        if (typeof v !== 'number' || !isFinite(v)) return;
        svg.appendChild(svgEl('circle', {
          cx: (pad + index * step).toFixed(2),
          cy: pointY(v, bounds, height, pad).toFixed(2),
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
      var tone = seriesColor(r.color);
      if (tone) bar.style.setProperty('background', tone);

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

     opts.onSelect, if given, is called with the id of the tab that is selected
     after every selection, which is what a card needs when its heading names
     the thing the selected tab switched to.

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
        'data-tab': t.id,
        text: t.label
      });
      list.appendChild(button);

      var panel = h('div', {
        id: panelId, role: 'tabpanel', tabindex: '0', 'aria-labelledby': tabId
      }, [t.panel]);
      if (i !== 0) panel.hidden = true;
      panels.appendChild(panel);
    });

    /* Listened for on the tablist rather than on each tab, so it runs after
       the shell's own handler on the tab that was clicked or arrowed to has
       already moved the selection: a listener on the button itself would read
       the selection it is about to replace. */
    if (opts.onSelect) {
      var relay = function () {
        var selected = list.querySelector('[role="tab"][aria-selected="true"]');
        if (selected) opts.onSelect(selected.getAttribute('data-tab'));
      };
      list.addEventListener('click', relay);
      list.addEventListener('keydown', relay);
    }

    wrap.appendChild(list);
    wrap.appendChild(panels);
    return { root: wrap, tablist: list, panels: panels };
  }

  global.OpsPaneData = {
    REPORTING_FLOOR: REPORTING_FLOOR,
    load: load,
    isLoopback: isLoopback,
    safeHref: safeHref,
    seriesColor: seriesColor,
    seriesStroke: seriesStroke,
    payloadLink: payloadLink,
    paneUrl: paneUrl,
    refocus: refocus,

    utcStamp: utcStamp,
    utcDay: utcDay,
    hoursSince: hoursSince,
    hours: hours,
    article: article,
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
