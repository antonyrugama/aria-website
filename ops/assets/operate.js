/* Shared behaviour for the four operate panes.

   Overview, Happening now, What happened and Problems draw the same furniture:
   charts, a detail drawer, a typed confirmation, and the loading / ready /
   empty / unavailable states every section has to be able to be in. That
   furniture lives here rather than in the design system because nothing else
   on the dashboard uses it yet, and a shared file that only four pages read is
   easier to promote later than it is to unpick.

   Two constraints from the shell carry through every line of this file:

     - No innerHTML. Everything, including the SVG charts, is built as DOM with
       textContent. Values arriving from the operations API are operational
       data about real accounts, and the cheapest way to be sure none of it can
       become markup is to have no path by which it could.
     - No inline style attributes. The pages carry style-src 'self' with no
       'unsafe-inline', so anything that cannot be a class is set through
       CSSOM, on the element's style property from script rather than as a
       style attribute in markup. That still creates an inline declaration, and
       it is worth being exact about why it is allowed: the policy governs
       style that arrives as markup, and every value set this way is a number
       this file computed or a fixed internal token, never a string from the
       operations API. A bar segment's width, a skeleton block's height and a
       legend swatch's colour are the whole list.

   Every renderer here takes plain values and returns an element. None of them
   fetch, and none of them know what a pane is. */
(function (global) {
  'use strict';

  var shell = global.OpsShell;
  var h = shell.h;
  var icon = shell.icon;

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svg(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) {
      el.setAttribute(k, String(attrs[k]));
    });
    return el;
  }

  function svgText(attrs, text) {
    var el = svg('text', attrs);
    el.textContent = text;
    return el;
  }

  /* ------------------------------------------------------------ formatting

     Every formatter answers "what does a person read here", and every one of
     them has to survive the value being missing. An operations screen that
     prints NaN or "undefined" next to a real figure has told the operator
     nothing about which of the two is trustworthy, so a missing value is an
     em-free dash and nothing else. */

  var NONE = '-';

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function int(v) {
    if (!isNum(v)) return NONE;
    return Math.round(v).toLocaleString('en-GB');
  }

  function pct(v, digits) {
    if (!isNum(v)) return NONE;
    return v.toFixed(digits === undefined ? 1 : digits) + '%';
  }

  /* Durations read as an operator says them: seconds under a minute, minutes
     and seconds up to an hour, hours and minutes above it. */
  function duration(seconds) {
    if (!isNum(seconds) || seconds < 0) return NONE;
    if (seconds < 60) return (seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)) + 's';
    var m = Math.floor(seconds / 60);
    var s = Math.round(seconds % 60);
    if (m < 60) return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
    var hrs = Math.floor(m / 60);
    return hrs + 'h ' + (m % 60) + 'm';
  }

  function parseTime(iso) {
    if (!iso) return null;
    var t = new Date(iso);
    return isFinite(t.getTime()) ? t : null;
  }

  /* UTC throughout. Two operators in two time zones reading the same incident
     have to be able to quote the same timestamp to each other. */
  function clock(iso, withSeconds) {
    var t = parseTime(iso);
    if (!t) return NONE;
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(t.getUTCHours()) + ':' + p(t.getUTCMinutes()) +
      (withSeconds === false ? '' : ':' + p(t.getUTCSeconds()));
  }

  function stamp(iso) {
    var t = parseTime(iso);
    if (!t) return NONE;
    return clock(iso) + ' UTC';
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

  /* "22 minutes" rather than "22 minutes ago", for the sentences that already
     supply their own tense. */
  function since(iso) {
    var a = ago(iso);
    return a === NONE ? NONE : a.replace(/ ago$/, '');
  }

  function plural(n, one, many) {
    return (isNum(n) ? int(n) : NONE) + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  var fmt = {
    none: NONE, int: int, pct: pct,
    duration: duration, clock: clock, stamp: stamp, ago: ago, since: since,
    plural: plural, isNum: isNum
  };

  /* ---------------------------------------------------------------- charts

     Dependency-free inline SVG, ported from the approved mocks and rebuilt as
     DOM. Each one takes numbers and an accessible label and returns an
     element; none of them read the document.

     Colour never carries meaning on its own here. Charts are decoration over
     a figure that is already stated in text beside them, and every chart
     carries role="img" with a label that says what it shows. */

  /* Multi-series line chart with gridlines and both axes labelled.

     cfg: { height, unit, labels: [], series: [{ color, values, marks }],
            band, bandLabel, label } */
  function lineChart(cfg) {
    var wrap = h('div');
    var series = (cfg.series || []).filter(function (s) {
      return Array.isArray(s.values) && s.values.length && s.values.every(isNum);
    });
    if (!series.length) return wrap;

    var w = 720, hgt = cfg.height || 200;
    var padL = 44, padR = 12, padT = 12, padB = 26;
    var all = series.reduce(function (a, s) { return a.concat(s.values); }, []);
    var peak = Math.max.apply(null, all);
    var max = cfg.max || Math.max(1, Math.ceil(peak * 1.15));
    var n = series[0].values.length;
    var xs = function (i) { return padL + (i * (w - padL - padR)) / Math.max(1, n - 1); };
    var ys = function (v) { return hgt - padB - (v / max) * (hgt - padT - padB); };
    var dashes = ['', '5 3', '2 3', '8 3'];

    var s = svg('svg', {
      class: 'chart', viewBox: '0 0 ' + w + ' ' + hgt,
      role: 'img', 'aria-label': cfg.label || 'Line chart'
    });

    for (var i = 0; i <= 4; i++) {
      var y = padT + (i * (hgt - padT - padB)) / 4;
      s.appendChild(svg('line', {
        x1: padL, y1: y, x2: w - padR, y2: y, stroke: 'var(--border)', 'stroke-width': '1'
      }));
      s.appendChild(svgText(
        { x: padL - 7, y: y + 3.5, 'text-anchor': 'end', class: 'ax ax-y' },
        (cfg.unit === '$' ? '$' : '') + Math.round(max - (i * max) / 4)
      ));
    }

    (cfg.labels || []).forEach(function (label, idx) {
      if (n > 12 && idx % Math.ceil(n / 8) !== 0 && idx !== n - 1) return;
      s.appendChild(svgText(
        { x: xs(idx), y: hgt - 8, 'text-anchor': 'middle', class: 'ax' }, label
      ));
    });

    series.forEach(function (one, si) {
      var d = one.values.map(function (v, idx) {
        return (idx ? 'L' : 'M') + xs(idx).toFixed(1) + ' ' + ys(v).toFixed(1);
      }).join(' ');

      if (series.length === 1 && one.fill !== false) {
        s.appendChild(svg('path', {
          d: d + ' L' + xs(n - 1) + ' ' + (hgt - padB) + ' L' + padL + ' ' + (hgt - padB) + ' Z',
          fill: one.color, opacity: '.12'
        }));
      }
      var line = svg('path', {
        d: d, fill: 'none', stroke: one.color, 'stroke-width': '1.9',
        'stroke-linejoin': 'round', 'stroke-linecap': 'round'
      });
      /* Series are told apart by dash pattern as well as by hue, so the chart
         still separates them for anyone who cannot tell the hues apart. */
      if (dashes[si]) line.setAttribute('stroke-dasharray', dashes[si]);
      s.appendChild(line);

      (one.marks || []).forEach(function (m) {
        if (!isNum(one.values[m])) return;
        s.appendChild(svg('circle', {
          cx: xs(m), cy: ys(one.values[m]), r: '3.6',
          fill: 'var(--crit)', stroke: 'var(--surface-1)', 'stroke-width': '1.5'
        }));
      });
    });

    if (isNum(cfg.band)) {
      s.appendChild(svg('line', {
        x1: padL, y1: ys(cfg.band), x2: w - padR, y2: ys(cfg.band),
        stroke: 'var(--warn)', 'stroke-width': '1.2', 'stroke-dasharray': '4 3'
      }));
      s.appendChild(svgText(
        { x: w - padR, y: ys(cfg.band) - 5, 'text-anchor': 'end', class: 'ax ax-band' },
        cfg.bandLabel || 'threshold'
      ));
    }

    wrap.appendChild(s);
    return wrap;
  }

  /* A single bar split into proportional segments. */
  function stackbar(segments, className) {
    var bar = h('div', { className: 'stackbar' + (className ? ' ' + className : '') });
    var total = segments.reduce(function (a, s) { return a + (isNum(s.value) ? s.value : 0); }, 0);
    if (!total) return bar;
    segments.forEach(function (seg) {
      if (!isNum(seg.value) || seg.value <= 0) return;
      var span = h('span');
      span.style.width = ((seg.value / total) * 100).toFixed(2) + '%';
      span.style.background = seg.color;
      if (seg.label) span.title = seg.label;
      bar.appendChild(span);
    });
    return bar;
  }

  /* ------------------------------------------------------------- overlays

     One focus trap, shared by the drawer and the confirmation, because a
     second copy of this is a second place for it to be subtly wrong. It does
     what the shell's rail drawer does: traps Tab, closes on Escape, makes
     everything else inert so a virtual cursor cannot walk behind it, and hands
     focus back to whatever opened it.

     Overlays stack. Closing a problem opens a confirmation over the drawer the
     operator opened it from, and two overlays that each believe they are the
     only one get both halves of modality wrong:

       - Escape. Each overlay listens on the document, so the drawer's listener
         runs first and takes an Escape aimed at the confirmation sitting on
         top of it. One key press closed both. Only the topmost overlay may act
         on a key, so every listener checks the stack before it does anything.

       - Background modality. The confirmation makes the page inert on the way
         up, and on the way down it put back what it found, which included the
         drawer's own inert page. Cancelling the confirmation therefore handed
         the background back to a virtual cursor while a modal drawer was still
         open. Each overlay now records what every element was before it
         touched it and restores only what it changed.

       - Closing order. Those snapshots only compose while the stack comes down
         in the order it went up. An action started in the drawer settles on
         its own schedule, and the operator can have opened the confirmation in
         the meantime, so a close request can arrive for an overlay that is no
         longer the top one. Honouring it there would hand the background back
         while a dialog is still on screen, and the dialog would then restore
         the snapshot it took while the drawer was up, leaving every element
         inert with no overlay to explain it. A request from underneath is
         therefore remembered and honoured when that overlay is the top again:
         an action closes its own layer, in order, rather than whichever layer
         happens to be on screen when it finishes. */

  var stack = [];

  function isTop(api) {
    return stack.length > 0 && stack[stack.length - 1] === api;
  }

  /* Closes whatever is now on top if it asked to be closed while it was not.
     Called after every close, so a chain of deferred requests unwinds in stack
     order rather than all at once. */
  function drainStack() {
    var top = stack[stack.length - 1];
    if (top && top.wantsClose) top.close();
  }

  function focusable(root) {
    return Array.prototype.slice.call(root.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
      ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(function (el) { return el.offsetParent !== null || el === document.activeElement; });
  }

  /* The live region and the toast host are siblings of everything else on the
     body. A live region carrying aria-hidden announces nothing, so they are
     left alone; neither holds focusable content, so the overlay's modality
     costs nothing. The shell applies the same test for the same reason. */
  function isLiveRegion(el) {
    return el.hasAttribute('aria-live') || el.classList.contains('toast-host');
  }

  function overlay(opts) {
    var opener = document.activeElement;
    var inerted = [];
    var closed = false;
    /* wantsClose is a close this overlay was asked for while it was not the
       top of the stack, still owed once the overlays above it have gone. */
    var api = { close: close, node: opts.node, wantsClose: false };

    var scrim = h('div', { className: 'scrim is-open' });
    document.body.appendChild(scrim);
    document.body.appendChild(opts.node);

    /* What each element was before this overlay touched it, so the overlay
       under this one keeps the modality it set. */
    Array.prototype.forEach.call(document.body.children, function (el) {
      if (el === opts.node || el === scrim || isLiveRegion(el)) return;
      inerted.push({
        el: el,
        inert: 'inert' in el ? el.inert : false,
        hidden: el.getAttribute('aria-hidden')
      });
      if ('inert' in el) el.inert = true;
      el.setAttribute('aria-hidden', 'true');
    });

    function close() {
      if (closed) return;
      var at = stack.indexOf(api);
      /* Not the top: the request is owed, not refused. drainStack() pays it
         the moment the overlays above this one have come down. */
      if (at !== -1 && at !== stack.length - 1) {
        api.wantsClose = true;
        return;
      }
      closed = true;
      if (at !== -1) stack.splice(at, 1);
      document.removeEventListener('keydown', onKey, true);
      inerted.forEach(function (was) {
        if ('inert' in was.el) was.el.inert = was.inert;
        if (was.hidden === null) was.el.removeAttribute('aria-hidden');
        else was.el.setAttribute('aria-hidden', was.hidden);
      });
      scrim.remove();
      opts.node.remove();

      if (opener && document.contains(opener) && opener.focus) {
        opener.focus();
      } else {
        /* An action taken inside an overlay makes the pane re-read itself, and
           the control that opened the overlay does not survive that. Focus
           falls back to the content region, which does, so a keyboard user is
           left where they were working rather than on the body with the whole
           page to tab through again. */
        var host = document.getElementById('content');
        if (host && host.focus) host.focus();
      }

      if (opts.onClose) opts.onClose();
      drainStack();
    }

    /* Escape and the scrim, which are the operator asking to be let out rather
       than the overlay deciding it is finished. An overlay in the middle of an
       action it cannot abandon refuses both, because dismissing it there would
       strand whatever it was opened over: its buttons are already disabled for
       exactly that window, and a key that walks past a disabled button is the
       same bug wearing a different input. Everything else about the overlay,
       including a close that its own action asks for, is unaffected. */
    function dismiss() {
      if (opts.canDismiss && !opts.canDismiss()) return;
      close();
    }

    function onKey(e) {
      /* The overlay under this one is still listening. It does not get to act
         on a key aimed at the dialog sitting on top of it. */
      if (!isTop(api)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        dismiss();
        return;
      }
      if (e.key !== 'Tab') return;
      var items = focusable(opts.node);
      if (!items.length) { e.preventDefault(); return; }
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    scrim.addEventListener('click', function () { if (isTop(api)) dismiss(); });
    document.addEventListener('keydown', onKey, true);
    stack.push(api);

    var target = opts.initialFocus && opts.initialFocus() ;
    if (!target) target = focusable(opts.node)[0] || opts.node;
    target.focus();

    return api;
  }

  /* A detail drawer. head/body are filled by the caller through the returned
     handle, so a drawer can open on a summary and fill in when its detail
     call answers, which is what every one of these panes needs: the operator
     clicked a row, so the drawer opens now and says it is loading. */
  function drawer(opts) {
    var titleId = 'drawerTitle' + Math.random().toString(36).slice(2, 8);

    var head = h('div', { className: 'drawer-head' });
    var headBody = h('div', { className: 'drawer-head-body' });
    head.appendChild(headBody);

    var close = h('button', {
      className: 'icon-btn', type: 'button', 'aria-label': 'Close'
    });
    close.appendChild(icon('close'));
    head.appendChild(close);

    var body = h('div', { className: 'drawer-body stack' });
    var foot = h('div', { className: 'drawer-foot' });

    var node = h('aside', {
      className: 'drawer is-open', role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': titleId, tabindex: '-1'
    }, [head, body, foot]);

    var handle = overlay({
      node: node,
      onClose: opts.onClose,
      initialFocus: function () { return close; }
    });
    close.addEventListener('click', function () { handle.close(); });

    return {
      close: handle.close,
      titleId: titleId,
      head: headBody,
      body: body,
      foot: foot,
      /* Replaces the body, so a drawer that opened on a loading state can be
         filled in without the caller tracking what it put there. */
      setBody: function (nodes) {
        body.textContent = '';
        (nodes || []).forEach(function (n) { if (n) body.appendChild(n); });
      }
    };
  }

  /* A destructive confirmation.

     confirmText makes the operator retype something specific rather than
     click through: it is the difference between confirming an action and
     confirming that they read which action it was. choices adds the required
     pick where the action needs one, and reasonLabel the free note where
     somebody may have to explain it later.

     onConfirm receives { choice, reason } and returns a promise. The dialog
     stays open, disabled, until it settles, so a failure is visible where the
     decision was made rather than as a toast over a screen that has already
     moved on. Disabled means disabled: Escape and the scrim are refused for
     that window too, because the caller's action is what closes the dialog on
     success, and a dialog dismissed out from under a call in flight leaves
     nothing behind to close what it was opened over. A failure re-arms all
     three together. */
  function confirmAction(opts) {
    var titleId = 'confirmTitle' + Math.random().toString(36).slice(2, 8);
    var card = h('div', { className: 'card modal-card confirm-card' });

    card.appendChild(h('div', { className: 'card-head' }, [
      h('h2', { className: 'card-title', id: titleId, text: opts.title })
    ]));

    var body = h('div', { className: 'confirm-body' });
    (opts.lines || []).forEach(function (line) {
      body.appendChild(h('p', { className: 'small muted', text: line }));
    });
    (opts.callouts || []).forEach(function (c) {
      var box = h('div', { className: 'callout callout-' + (c.tone || 'info') });
      box.appendChild(icon(c.tone === 'warn' ? 'warn' : 'info'));
      box.appendChild(h('div', { text: c.text }));
      body.appendChild(box);
    });

    var typed = null;
    if (opts.confirmText) {
      var typedId = titleId + 'Typed';
      var label = h('label', { className: 'confirm-label', for: typedId });
      label.appendChild(document.createTextNode('Type '));
      label.appendChild(h('span', { className: 'mono strong', text: opts.confirmText }));
      label.appendChild(document.createTextNode(' to confirm'));
      typed = h('input', {
        className: 'input', id: typedId, type: 'text', autocomplete: 'off',
        spellcheck: 'false'
      });
      body.appendChild(label);
      body.appendChild(typed);
    }

    var choice = null;
    if (opts.choices) {
      var choiceId = titleId + 'Choice';
      choice = h('select', { className: 'select', id: choiceId });
      opts.choices.options.forEach(function (o) {
        var opt = h('option', { value: o.value, text: o.label });
        if (o.value === opts.choices.value) opt.selected = true;
        choice.appendChild(opt);
      });
      body.appendChild(h('label', {
        className: 'confirm-label', for: choiceId, text: opts.choices.label
      }));
      body.appendChild(choice);
    }

    var reason = null;
    if (opts.reasonLabel) {
      var reasonId = titleId + 'Reason';
      reason = h('input', { className: 'input', id: reasonId, type: 'text' });
      body.appendChild(h('label', {
        className: 'confirm-label', for: reasonId, text: opts.reasonLabel
      }));
      body.appendChild(reason);
    }

    /* Says the dialog is busy while it is. Everything on it is refused for
       that window, Escape and the scrim included, and a control that ignores
       an operator without saying why is indistinguishable from one that has
       broken. */
    var sending = h('p', { className: 'small muted confirm-sending', role: 'status' });
    body.appendChild(sending);

    var error = h('p', { className: 'field-error', role: 'alert' });
    body.appendChild(error);
    card.appendChild(body);

    var cancel = h('button', {
      className: 'btn', type: 'button', text: opts.cancelLabel || 'Keep it running'
    });
    var go = h('button', {
      className: 'btn ' + (opts.tone === 'danger' ? 'btn-danger' : 'btn-primary'),
      type: 'button', text: opts.confirmLabel || 'Confirm'
    });

    var foot = h('div', { className: 'drawer-foot' }, [
      cancel, h('div', { className: 'spacer' }), go
    ]);
    card.appendChild(foot);

    var node = h('div', {
      className: 'modal', role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': titleId, tabindex: '-1'
    }, [card]);

    function ready() {
      if (typed && typed.value.trim() !== opts.confirmText) return false;
      if (reason && opts.reasonRequired && !reason.value.trim()) return false;
      return true;
    }

    /* settling is hoisted; while the action is in flight nothing an input
       event does may re-enable the primary. Disabled means disabled. */
    function sync() { go.disabled = settling || !ready(); }
    if (typed) typed.addEventListener('input', sync);
    if (reason) reason.addEventListener('input', sync);
    sync();

    /* True from the moment the action is sent until it settles. */
    var settling = false;

    var handle = overlay({
      node: node,
      onClose: opts.onClose,
      initialFocus: function () { return typed || choice || cancel; },
      canDismiss: function () { return !settling; }
    });

    cancel.addEventListener('click', function () { if (!settling) handle.close(); });
    go.addEventListener('click', function () {
      if (!ready() || settling) return;
      settling = true;
      go.disabled = true;
      cancel.disabled = true;
      error.textContent = '';
      sending.textContent = 'Sending. This stays open until the operations API answers.';
      Promise.resolve(opts.onConfirm({
        choice: choice ? choice.value : null,
        reason: reason ? reason.value.trim() : null
      }))
        .then(function () {
          settling = false;
          sending.textContent = '';
          handle.close();
        })
        .catch(function (err) {
          settling = false;
          sending.textContent = '';
          cancel.disabled = false;
          sync();
          error.textContent = (err && err.message) ||
            'That did not go through. Nothing has changed.';
        });
    });

    return handle;
  }

  /* --------------------------------------------------------------- states

     A pane is a set of sections, and a section is in one of four states. They
     are the four the mocks previewed, with the difference that the trigger is
     now real: loading is a call in flight, empty is a call that answered with
     nothing, and unavailable is a call that failed or a feature that is not
     configured. Nothing on these pages can be put into a state by hand. */

  /* Whole-pane loading. Deliberately shaped like the pane it precedes, so the
     layout does not jump when the data lands. */
  function skeleton(rows) {
    var wrap = h('div', { className: 'stack' });
    (rows || []).forEach(function (row) {
      if (row.type === 'tiles') {
        var grid = h('div', { className: 'grid g4' });
        for (var i = 0; i < (row.count || 4); i++) {
          grid.appendChild(h('div', { className: 'card' }, [
            h('div', { className: 'card-body' }, [h('div', { className: 'skel skel-tile' })])
          ]));
        }
        wrap.appendChild(grid);
        return;
      }
      var body = h('div', { className: 'card-body' });
      if (row.type === 'rows') {
        for (var r = 0; r < (row.count || 6); r++) {
          body.appendChild(h('div', { className: 'skel skel-row' }));
        }
      } else {
        var block = h('div', { className: 'skel' });
        block.style.height = (row.height || 60) + 'px';
        body.appendChild(block);
      }
      wrap.appendChild(h('div', { className: 'card' }, [body]));
    });
    wrap.setAttribute('aria-busy', 'true');
    wrap.appendChild(h('p', { className: 'sr-only', role: 'status', text: 'Loading' }));
    return wrap;
  }

  /* A whole-pane state: nothing matched, nothing came in, or the pane could
     not be loaded. actions are buttons or links that offer the way out, which
     is the part that stops an empty screen being a dead end. */
  function paneState(iconName, title, lines, actions) {
    var card = h('div', { className: 'card' });
    var block = shell.stateBlock(iconName, title, lines);
    if (actions && actions.length) {
      var row = h('div', { className: 'row row-wrap mt-sm' });
      actions.forEach(function (a) { row.appendChild(a); });
      block.appendChild(row);
    }
    card.appendChild(block);
    return card;
  }

  /* A section inside a pane that could not be loaded, where the rest of the
     pane is fine. Small on purpose: one failed card must not look like a
     failed dashboard. */
  function partFailure(title, message, onRetry) {
    var wrap = h('div', { className: 'part-fail' });
    wrap.appendChild(icon('warn'));
    var body = h('div');
    body.appendChild(h('div', { className: 'part-fail-title', text: title }));
    body.appendChild(h('p', { className: 'small', text: message }));
    if (onRetry) {
      var row = h('div', { className: 'row' });
      var retry = h('button', { className: 'btn btn-sm', type: 'button', text: 'Try again' });
      retry.addEventListener('click', onRetry);
      row.appendChild(retry);
      body.appendChild(row);
    }
    wrap.appendChild(body);
    return wrap;
  }

  /* A capability the operations API reports as not set up. Distinct from a
     failure on purpose: "this was never configured" and "this broke" call for
     different actions, and a screen that renders both as an error teaches an
     operator to ignore both. */
  function notConfigured(title, message) {
    var wrap = h('div', { className: 'callout' });
    wrap.appendChild(icon('info'));
    var body = h('div');
    body.appendChild(h('strong', { text: title }));
    body.appendChild(document.createTextNode(' ' + message));
    wrap.appendChild(body);
    return wrap;
  }

  /* Turns any failure into the sentence an operator should read. The API's own
     message is used where there is one, because it is written for this screen;
     the fallbacks cover the cases where there is not. */
  function failureMessage(err) {
    if (!err) return 'Something went wrong loading this.';
    if (err.code === 'ops_unreachable') {
      return 'Could not reach the operations API. Check your connection and try again.';
    }
    if (err.code === 'ops_role_insufficient') {
      return 'Your role does not allow this. Ask an owner if you need it.';
    }
    if (err.code === 'ops_route_missing') {
      return 'This part of the dashboard is not answering yet.';
    }
    return err.message || 'Something went wrong loading this.';
  }

  /* ---------------------------------------------------------------- pieces */

  function badge(tone, iconName, text) {
    var b = h('span', { className: 'badge' + (tone ? ' badge-' + tone : '') });
    if (iconName) b.appendChild(icon(iconName));
    b.appendChild(document.createTextNode(text));
    return b;
  }

  /* Status is never colour alone: every badge here carries a glyph, and the
     text says the state in words. */
  var TONES = {
    ok: { tone: 'ok', icon: 'check' },
    warn: { tone: 'warn', icon: 'warn' },
    crit: { tone: 'crit', icon: 'warn' },
    info: { tone: 'info', icon: 'info' },
    idle: { tone: '', icon: 'clock' }
  };

  function statusBadge(tone, text) {
    var t = TONES[tone] || TONES.idle;
    return badge(t.tone, t.icon, text);
  }

  function cardHead(title, hint, extras) {
    var head = h('div', { className: 'card-head' });
    head.appendChild(h('h3', { className: 'card-title', text: title }));
    if (hint) head.appendChild(h('span', { className: 'card-hint', text: hint }));
    if (extras && extras.length) {
      head.appendChild(h('div', { className: 'spacer' }));
      extras.forEach(function (e) { if (e) head.appendChild(e); });
    }
    return head;
  }

  function bandHead(title, hint) {
    var band = h('div', { className: 'band-head' });
    band.appendChild(h('h2', { className: 'band-title', text: title }));
    if (hint) band.appendChild(h('span', { className: 'band-hint', text: hint }));
    return band;
  }

  function secHead(title, hint, level) {
    var head = h('div', { className: 'sec-head' });
    head.appendChild(h('h' + (level || 2), { className: 'sec-title', text: title }));
    if (hint) head.appendChild(h('span', { className: 'sec-hint', text: hint }));
    return head;
  }

  function dl(rows) {
    var list = h('dl', { className: 'dl' });
    rows.forEach(function (row) {
      if (row.value === undefined || row.value === null || row.value === '') return;
      list.appendChild(h('dt', { text: row.label }));
      list.appendChild(h('dd', {
        className: row.plain ? 'plain' : '', text: String(row.value)
      }));
    });
    return list;
  }

  function timeline(items) {
    var wrap = h('div', { className: 'timeline' });
    items.forEach(function (item) {
      wrap.appendChild(h('div', { className: 'tl-item' + (item.tone ? ' ' + item.tone : '') }, [
        h('div', { className: 'tl-time', text: item.time }),
        h('div', { text: item.text })
      ]));
    });
    return wrap;
  }

  function link(href, text, className) {
    return h('a', { className: className || 'btn btn-sm', href: href, text: text });
  }

  /* --------------------------------------------------------- pane plumbing */

  /* Pane-local filters go into the shell's filter bar rather than into the
     content, so every control that changes what the pane shows is in one
     place. The shell owns the bar and the shared controls; a pane appends and
     never rewrites.

     A pane is rendered while the shell is still assembling itself, so the bar
     exists but is not in the document yet. Waiting for ops:ready, which is
     dispatched once the shell is in the document, is the difference between
     this working and silently doing nothing. */
  function paneFilters(nodes) {
    function install() {
      var bar = document.querySelector('.filterbar');
      if (!bar) return;
      nodes.forEach(function (n) { if (n) bar.appendChild(n); });
    }
    if (document.querySelector('.filterbar')) install();
    else global.addEventListener('ops:ready', install, { once: true });
  }

  function filterItem(labelText, control, id) {
    var item = h('div', { className: 'filter-item filter-gap' });
    if (id) {
      control.setAttribute('id', id);
      item.appendChild(h('label', { className: 'filter-label', for: id, text: labelText }));
    } else {
      item.appendChild(h('span', { className: 'filter-label', text: labelText }));
    }
    item.appendChild(control);
    return item;
  }

  function select(options, current, onChange, ariaLabel) {
    var el = h('select', { className: 'select' });
    if (ariaLabel) el.setAttribute('aria-label', ariaLabel);
    options.forEach(function (o) {
      var opt = h('option', { value: o.value, text: o.label });
      if (o.value === current) opt.selected = true;
      el.appendChild(opt);
    });
    el.addEventListener('change', function () { onChange(el.value); });
    return el;
  }

  function segmented(ariaLabel, options, current, onPick) {
    var seg = h('div', { className: 'seg', role: 'group', 'aria-label': ariaLabel });
    options.forEach(function (o) {
      var b = h('button', {
        type: 'button', text: o.label, 'aria-pressed': String(o.value === current)
      });
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(seg.querySelectorAll('button'), function (x) {
          x.setAttribute('aria-pressed', 'false');
        });
        b.setAttribute('aria-pressed', 'true');
        onPick(o.value);
      });
      seg.appendChild(b);
    });
    return seg;
  }

  /* Swaps a host element between the four states without the caller keeping
     track of what is currently in it. Every pane's top level is one of these,
     which is what makes "the four preview states are real" true rather than
     asserted. */
  function region(host) {
    function put(node) {
      host.textContent = '';
      if (node) host.appendChild(node);
      return node;
    }
    return {
      loading: function (rows) { return put(skeleton(rows)); },
      show: function (node) { return put(node); },
      empty: function (title, lines, actions) {
        return put(paneState('empty', title, lines, actions));
      },
      failed: function (err, onRetry) {
        var retry = h('button', { className: 'btn btn-primary', type: 'button', text: 'Try again' });
        retry.addEventListener('click', onRetry);
        return put(paneState('warn', 'Could not load this pane', [
          failureMessage(err),
          'Nothing has changed and nothing has been signed out.'
        ], [retry]));
      }
    };
  }

  global.OpsOperate = {
    fmt: fmt,
    lineChart: lineChart,
    stackbar: stackbar,
    drawer: drawer,
    confirmAction: confirmAction,
    skeleton: skeleton,
    paneState: paneState,
    partFailure: partFailure,
    notConfigured: notConfigured,
    failureMessage: failureMessage,
    badge: badge,
    statusBadge: statusBadge,
    cardHead: cardHead,
    bandHead: bandHead,
    secHead: secHead,
    dl: dl,
    timeline: timeline,
    link: link,
    paneFilters: paneFilters,
    filterItem: filterItem,
    select: select,
    segmented: segmented,
    region: region
  };
})(window);
