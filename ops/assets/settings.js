/* The Settings pane on the v2 design system: who can get in, what is kept,
   and for how long.

   Two rules run through every line below, and neither is a styling decision.

   FIRST, IT NEVER CLAIMS AUTHORITY IT DOES NOT HAVE. The role in hand decides
   what this file draws and nothing else. It does not decide what is allowed:
   the server re-reads the account row on every request and answers 403 whether
   or not this page drew the control. A Revoke button that should not be there
   is a cosmetic bug; the reverse is the one that matters, so every mutation is
   sent and the server's answer is what appears on screen. The pane is owner
   only in assets/pane-registry.js, and the shell renders its named refusal for
   every other role without ever asking this file for a pane — which is why
   nothing here reads anything until definePane's callback runs.

   SECOND, IT SAYS WHICH HALF OF ITSELF IS REAL. Six areas are on screen and
   five of them are read from an API: administrators, active sessions, the
   access record, cost categories and outside connections. The retention card
   has no endpoint to read or write, so it prints no figure at all.
   They say what is missing and which of "not built" and "not reported"
   applies. Rendering the remaining static cards as populated tables would be the worst outcome
   available, because a number nobody can check is indistinguishable from one
   that came from somewhere. Stadiora/Aria#11214 moves Outside connections
   across that line; Stadiora/Aria#5442 still tracks the static cards left
   behind it.

   The split is drawn three ways, and never in colour alone:

     1. every card head carries a source chip whose WORD says which it is;
     2. a card with nothing behind it is hatched and dashed rather than lit;
     3. a card with nothing behind it contains no numeral, anywhere.

   assets/pane-settings-v2.css carries the first two. This file carries the
   third, which is why the static prose below is written without a single
   digit in it — that is a rule, not an accident, and changing one of those
   sentences means keeping it. scripts/ops-settings-v2.test.mjs holds the
   partition in both directions: every card the pane marks as read names an
   endpoint the pane actually requested, every card it marks as static names
   none and prints no digit, and neither set is empty.

   Mutations here are confirmed before they fire, carry the written reason the
   server requires, report what the server actually said, and are followed by a
   reload of the access record, so the record of the change is on screen beside
   the change itself. */
(function (global) {
  'use strict';

  var S = global.OpsPaneShell;
  var session = global.OpsSession;
  var h = S.h;
  var icon = S.icon;
  var fmt = S.fmt;

  var ADMINS = '/api/ops/admins';
  var SESSIONS = '/api/ops/sessions';
  var AUDIT = '/api/ops/audit';
  var INTEGRATIONS = '/api/ops/integrations';
  var COST_CATEGORIES = '/api/ops/settings/cost-categories';
  var COST_CATEGORY_OVERRIDES = '/api/ops/settings/cost-categories/overrides';
  var OPS_SOURCE_PARTS = ['', 'api', 'ops'];
  var AUDIT_PAGE = 50;

  var ROLE_LABELS = { owner: 'Owner', operator: 'Operator', viewer: 'Viewer' };
  var STATUS_LABELS = { active: 'Active', disabled: 'Disabled', suspended: 'Suspended' };

  /* Plain language for the actions the identity boundary records. An action
     with no entry here renders as the raw name in monospace rather than as a
     guess, so one added server side is visible rather than mislabelled. */
  var ACTION_LABELS = {
    'admin.login': 'Signed in',
    'admin.login_failed': 'Sign in refused',
    'admin.logout': 'Signed out',
    'admin.reauth': 'Confirmed password',
    'admin.reauth_failed': 'Password confirmation refused',
    'admin.password_changed': 'Changed password',
    'admin.provisioned': 'Account provisioned',
    'admin.session_revoke': 'Revoked a session',
    'admin.session_revoke_failed': 'Revoke refused',
    'admin.refresh_failed': 'Sign in refresh failed',
    'admin.refresh_reuse_detected': 'Session token reused',
    'admin.refresh_grace_used': 'Two tabs refreshed at once',
    'settings.cost_category_override_upsert': 'Changed a cost category',
    'settings.cost_category_override_delete': 'Cleared a cost category override'
  };

  /* What kind of thing an action was done to, said the way the rest of the
     dashboard says it. An unrecognised kind is shown as recorded, for the same
     reason an unrecognised action is. */
  var TARGET_LABELS = {
    ops_admin_session: 'sign in session',
    ops_admin_account: 'administrator account',
    ops_cost_category_override: 'cost category override'
  };

  var INTEGRATION_FAILURE_LABELS = {
    auth: 'Authentication failed',
    timeout: 'The service timed out',
    transport: 'The service did not answer',
    throttled: 'The service is throttling requests',
    http_error: 'The service returned an error response',
    malformed: 'The service returned data this dashboard cannot read',
    config: 'Configuration is invalid',
    untrusted_next_link: 'The service returned an unsafe next-page link'
  };
  var INTEGRATION_UNKNOWN_FAILURE = 'An unrecognised failure reason was reported';

  var COST_CATEGORY_FALLBACK_LABELS = {
    ci_and_build: 'CI and build',
    ai_and_models: 'AI and models',
    data: 'Data',
    application_compute: 'Application compute',
    platform_and_observability: 'Platform and observability'
  };
  var COST_SOURCE_LABELS = {
    seed: 'Default',
    resource_group_override: 'Your override',
    service_override: 'Your override',
    ungrouped: 'No default or override'
  };
  var COST_READ_ERRORS = {
    ops_role_insufficient: 'You do not have access to cost categories.',
    ops_auth_required: 'Sign in again to read cost categories.'
  };
  var COST_WRITE_ERRORS = {
    ops_cost_category_invalid: 'Choose one of the listed cost categories.',
    ops_cost_category_scope_invalid: 'Choose whether the change applies here or to the service.',
    ops_cost_service_invalid: 'Choose the Azure service this change applies to.',
    ops_cost_resource_group_invalid: 'Choose a resource group for this scoped change.',
    ops_cost_category_override_version_invalid: 'This row is missing its latest version. Reload and try again.',
    ops_reauth_required: 'Confirm your password to change cost categories.',
    ops_role_insufficient: 'You do not have access to change cost categories.'
  };

  /* ------------------------------------------------------------ formatting */

  function parseDate(value) {
    if (typeof value !== 'string' || !value) return null;
    var d = new Date(value);
    return isFinite(d.getTime()) ? d : null;
  }

  /* A length of time in the largest unit that still reads as a quantity. The
     shell's fmt has ago/since, which measure from now to a stamp; neither can
     express a gap between two stamps or a gap that has not happened yet, and
     both of those are on this pane. */
  function spanWords(ms) {
    var minutes = Math.round(Math.abs(ms) / 60000);
    if (minutes < 60) return fmt.plural(Math.max(1, minutes), 'minute');
    var hours = Math.round(minutes / 60);
    if (hours < 48) return fmt.plural(hours, 'hour');
    return fmt.plural(Math.round(hours / 24), 'day');
  }

  function endsIn(value) {
    var date = parseDate(value);
    if (!date) return null;
    var ms = date.getTime() - Date.now();
    return ms <= 0 ? 'expired' : 'in ' + spanWords(ms);
  }

  function ago(value) {
    var words = fmt.ago(value);
    return words === fmt.none ? null : words;
  }

  /* A cell carrying a relative time with the exact one behind it. The relative
     age is the readable form and the timestamp is what an incident is
     reconstructed from, so both are carried rather than one chosen. A value
     that is not there says so rather than rendering blank: "never" and "not
     recorded" are different facts and an empty cell is neither. */
  function timeCell(value, words, absent) {
    if (!words) return h('td', { className: 'muted cell-nowrap', text: absent });
    return h('td', {
      className: 'num dim cell-nowrap', text: words, title: fmt.utcStamp(value) || ''
    });
  }

  function pill(tone, glyph, text) {
    var el = h('span', { className: 'pill' + (tone ? ' ' + tone : '') });
    if (glyph) el.appendChild(icon(glyph));
    el.appendChild(h('span', { text: text }));
    return el;
  }

  /* Role and status both carry a word as well as a tone. Nothing on this pane
     is readable by colour alone. */
  function rolePill(role) {
    var label = ROLE_LABELS[role] || role || 'unknown';
    if (role === 'owner') return pill('vio', 'lock', label);
    if (role === 'operator') return pill('acc', null, label);
    return pill('', null, label);
  }

  function statusPill(status) {
    var active = status === 'active';
    return pill(active ? 'up' : 'warn', active ? 'check' : 'warn',
      STATUS_LABELS[status] || status || 'Unknown');
  }

  /* ---------------------------------------------------- live against static

     Both chips are the same neutral ghost pill and differ only in the word and
     the glyph. A chip that carried the distinction in its tone would be
     carrying it in colour alone. */
  var LIVE_WORD = 'Live';
  var STATIC_WORD = 'No API yet';

  function sourceChip(word, glyph) {
    var el = h('span', { className: 'pill ghost src-chip' });
    el.appendChild(icon(glyph));
    el.appendChild(h('span', { text: word }));
    return el;
  }

  function sourceEndpoint(slug) {
    return OPS_SOURCE_PARTS.concat([slug]).join('/');
  }

  /* A card holding what a read answered. The endpoint is written onto the
     card, so the claim the chip makes is checkable against the requests the
     pane actually issued rather than against a list somebody maintains. */
  function liveCard(sourceSlug, title, note, end) {
    var box = S.card();
    box.setAttribute('data-source', 'live');
    box.setAttribute('data-endpoint', sourceEndpoint(sourceSlug));
    box.appendChild(S.cardHead(title, note, (end || []).concat([
      sourceChip(LIVE_WORD, 'radio')
    ])));
    return box;
  }

  /* A card for one of the areas nothing serves yet. It carries no
     endpoint and prints no numeral: what it has to say is which of "not built"
     and "not reported" applies, and what stays true regardless. */
  function staticCard(title, note, lines, rules) {
    var box = S.card();
    box.setAttribute('data-source', 'static');
    box.appendChild(S.cardHead(title, note, [sourceChip(STATIC_WORD, 'layers')]));

    var body = h('div', { className: 'card-body' });
    lines.forEach(function (line) {
      body.appendChild(h('p', { className: 'static-line', text: line }));
    });
    if (rules && rules.length) {
      var list = h('ul', { className: 'rules' });
      rules.forEach(function (rule) {
        list.appendChild(h('li', {}, [icon('lock'), h('span', { text: rule })]));
      });
      body.appendChild(list);
    }
    box.appendChild(body);
    return box;
  }

  function cardFoot(text, glyph, end) {
    var foot = h('div', { className: 'card-foot' });
    if (glyph) foot.appendChild(icon(glyph));
    foot.appendChild(h('span', { text: text }));
    if (end) {
      foot.appendChild(h('div', { className: 'sp' }));
      foot.appendChild(end);
    }
    return foot;
  }

  /* A table wide enough to need its own scroll rather than the document's, and
     reachable from a keyboard, so the columns past the edge are not a
     pointer's alone. */
  function tableWrap(label, table) {
    var wrap = h('div', {
      className: 'tbl-wrap', tabindex: '0', role: 'region', 'aria-label': label
    });
    wrap.appendChild(table);
    return wrap;
  }

  function table(columns) {
    var el = h('table', { className: 'tbl' });
    var row = h('tr');
    columns.forEach(function (column) {
      row.appendChild(h('th', { className: column.right ? 'r' : '', text: column.label }));
    });
    el.appendChild(h('thead', {}, [row]));
    el.appendChild(h('tbody'));
    return el;
  }

  function bodyOf(el) { return el.querySelector('tbody'); }

  /* Replaces what a card is showing without touching its head or its foot, so
     a reload does not make the heading the rows are filed under disappear and
     come back. */
  function setCardBody(host, node) {
    var stale = host.querySelector('.card-body, .tbl-wrap');
    while (stale) {
      stale.parentNode.removeChild(stale);
      stale = host.querySelector('.card-body, .tbl-wrap');
    }
    var foot = host.querySelector('.card-foot');
    if (foot) host.insertBefore(node, foot);
    else host.appendChild(node);
  }

  /* The failure state for one card. Deliberately per card rather than per
     pane: the access record failing to load is no reason to take the
     administrator list off the screen, and a pane that blanks itself on any
     error tells an operator less than one that says which part is missing. */
  function failureBody(err, retry) {
    var body = h('div', { className: 'card-body' });
    var block = S.stateBlock('warn', 'This could not be read', [
      S.failureMessage(err),
      'Nothing here is a zero. These rows are unread, not absent.'
    ], 4);
    var again = h('button', { className: 'btn btn-sm', type: 'button', text: 'Try again' });
    again.addEventListener('click', retry);
    block.appendChild(h('div', { className: 'row mt-sm' }, [again]));
    body.appendChild(block);
    return body;
  }

  /* ---------------------------------------------------------- confirm modal */

  /* The same shape as the re-authentication prompt the session layer already
     draws: focus trapped, Escape closes, focus restored, everything behind it
     inert. Nothing destructive on this pane fires without one.

     onConfirm receives the typed reason and a small controller, and owns the
     dialog until it resolves. A refusal stays in the dialog rather than
     closing it and reporting elsewhere, so the operator can correct and retry
     with the context still on screen. */
  function confirmAction(opts) {
    var previous = document.activeElement;
    var closed = false;

    var scrim = h('div', { className: 'scrim' });
    /* novalidate, because the browser's own bubble for a required field is
       transient, styled by the browser, and pre-empts the submit handler that
       would otherwise put the same message in the alert region below, where a
       screen reader is told about it and it stays on screen. */
    var form = h('form', {
      className: 'modal', role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': 'setConfirmTitle', novalidate: 'novalidate'
    });

    form.appendChild(h('h2', {
      className: 'modal-title', id: 'setConfirmTitle', text: opts.title
    }));
    opts.lines.forEach(function (line) {
      form.appendChild(h('p', { className: 'modal-line', text: line }));
    });

    var alertBox = h('div', { className: 'modal-alert', role: 'alert' });
    alertBox.hidden = true;
    form.appendChild(alertBox);

    form.appendChild(h('label', {
      className: 'modal-label', 'for': 'setConfirmReason', text: opts.reasonLabel
    }));
    var reason = h('input', {
      className: 'modal-input', id: 'setConfirmReason', type: 'text',
      autocomplete: 'off', maxlength: '200', required: 'required'
    });
    form.appendChild(reason);
    form.appendChild(h('p', {
      className: 'modal-hint',
      text: 'Recorded against your name. It cannot be edited or removed afterwards.'
    }));

    var row = h('div', { className: 'row mt' });
    var cancel = h('button', { className: 'btn', type: 'button', text: 'Cancel' });
    var confirm = h('button', {
      className: 'btn btn-danger', type: 'submit', text: opts.confirmLabel
    });
    row.appendChild(cancel);
    row.appendChild(h('div', { className: 'sp' }));
    row.appendChild(confirm);
    form.appendChild(row);

    document.body.appendChild(scrim);
    document.body.appendChild(form);

    /* Live regions stay out of the inert set. One carrying aria-hidden
       announces nothing, which would silence exactly the messages a dialog
       produces, and neither holds anything focusable. */
    var backdrop = Array.prototype.filter.call(document.body.children, function (el) {
      return el !== form && el !== scrim &&
        !el.hasAttribute('aria-live') && !el.classList.contains('toast-host');
    });
    backdrop.forEach(function (el) {
      if ('inert' in el) el.inert = true;
      el.setAttribute('aria-hidden', 'true');
    });

    function focusables() {
      return Array.prototype.filter.call(
        form.querySelectorAll('button, input'),
        function (el) { return !el.disabled; }
      );
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      var items = focusables();
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    /* Focus reset to <body>, or returning from browser chrome, matches neither
       Tab branch above and would otherwise walk straight out of the dialog. */
    function onFocusIn(e) {
      if (!form.contains(e.target)) {
        var items = focusables();
        if (items.length) items[0].focus();
      }
    }

    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn, true);
      backdrop.forEach(function (el) {
        if ('inert' in el) el.inert = false;
        el.removeAttribute('aria-hidden');
      });
      form.remove();
      scrim.remove();

      /* Focus goes back where it came from, unless the action that just ran
         redrew the thing it came from. A revoked row is replaced by the reload
         that follows it, so the control that opened the dialog is no longer in
         the document and focusing it drops the keyboard back to the top of the
         page. The caller names somewhere inside the region that changed. */
      if (previous && previous.isConnected && previous.focus) {
        previous.focus();
        return;
      }
      var fallback = opts.focusOnClose && opts.focusOnClose();
      if (fallback && fallback.focus) {
        if (!fallback.hasAttribute('tabindex')) fallback.setAttribute('tabindex', '-1');
        fallback.focus();
      }
    }

    var controller = {
      close: close,
      fail: function (message) {
        /* The dialog can be dismissed while the request it fired is still in
           flight, and a refusal that lands afterwards has nowhere to go in a
           detached dialog. It goes where a confirmation would go instead. An
           operator who pressed Escape still fired the action, and being told
           nothing is the one outcome a refusal must never produce. */
        if (closed) {
          S.toast('warn', message);
          S.announce(message);
          return;
        }
        alertBox.hidden = false;
        alertBox.textContent = '';
        alertBox.appendChild(icon('warn'));
        alertBox.appendChild(h('span', { text: message }));
        reason.setAttribute('aria-invalid', 'true');
        confirm.disabled = false;
        confirm.textContent = opts.confirmLabel;
        reason.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocusIn, true);
    cancel.addEventListener('click', close);
    scrim.addEventListener('click', close);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = (reason.value || '').trim();
      /* The server refuses a revocation with no reason, so asking here saves a
         round trip. It is not the check that matters: that one is the
         server's, and it still runs. */
      if (!text) {
        controller.fail('Give a reason. It is recorded with this action.');
        return;
      }
      reason.removeAttribute('aria-invalid');
      confirm.disabled = true;
      confirm.textContent = 'Working';
      opts.onConfirm(text, controller);
    });

    reason.focus();
  }

  /* -------------------------------------------------------------- the pane */

  S.definePane('settings', function (content) {
    var region = S.region(content);
    var loadToken = 0;
    var costFocusAfterLoad = null;

    /* The access record pages in place, so its rows outlive a redraw of the
       card they sit in and the controls that describe the state of the record
       stay put while the rows under them change.

       token is the record's own generation, and it is a separate one from
       loadToken above. loadToken discards a whole-pane read that a newer one
       has overtaken; this one discards a RECORD page that the window it was
       asked for no longer exists in. A Load more page already in flight when
       load() resets the record belongs to the window before the reset, and
       landing it appends rows from before the reload and advances offset past
       them, so the next Load more asks for the wrong window and a page is
       skipped (Stadiora/Aria#10408). */
    var record = {
      host: null, rows: [], offset: 0, more: false, busy: false, pending: false, seen: null,
      token: 0
    };

    /* ---------------------------------------------------------------- reads */

    /* The account list goes through the shell's loader and the other two go
       straight to session.call. The loader's local fixture hook is one file
       per pane, so it can stand in for exactly one read; this is the read that
       decides which of the four preview states the pane is in, so it is the
       one worth being able to fake locally. */
    function readAdmins() {
      return S.read({ paneId: 'settings', endpoint: ADMINS })
        .then(function (result) { return result.data; });
    }

    /* Sessions and the record fail on their own terms rather than through the
       pane. Who can get in is the question this pane owns, and a record that
       will not load is no reason to hide the account list: the rejection is
       carried as a value and drawn as one failed card, with the pane degraded
       rather than gone. */
    function soft(promise) {
      return promise.then(function (payload) {
        return { rows: Array.isArray(payload && payload.data) ? payload.data : [] };
      }, function (err) {
        return { error: err };
      });
    }

    function softObject(promise) {
      return promise.then(function (payload) {
        return { data: payload && payload.data ? payload.data : null };
      }, function (err) {
        return { error: err };
      });
    }

    function load() {
      var token = ++loadToken;
      region.loading([
        { type: 'block', height: 74 },
        { type: 'rows', count: 4 },
        { type: 'rows', count: 5 }
      ]);
      record.rows = [];
      record.offset = 0;
      record.seen = null;
      record.busy = false;
      record.pending = false;
      /* Whatever the record had in flight was asked for in the window this
         line has just thrown away. Clearing busy without this hands that
         response an unowned record to land in. */
      record.token += 1;
      /* `more` describes the window the five lines above have just discarded,
         and it is the only field left doing so. When the reload's own record
         read fails, recordBand() takes the error branch and calls
         syncControls() directly -- acceptPage(), which is the only other place
         `more` is written, never runs -- so the card came up with a failure
         body and a live Load more over zero rows (Stadiora/Aria#10689). */
      record.more = false;

      Promise.all([
        readAdmins(),
        soft(session.call(SESSIONS)),
        soft(session.call(AUDIT, { query: { limit: AUDIT_PAGE, offset: 0 } })),
        softObject(session.call(COST_CATEGORIES)),
        softObject(session.call(INTEGRATIONS))
      ]).then(function (results) {
        if (token !== loadToken) return;
        render(results[0], results[1], results[2], results[3], results[4]);
      }, function (err) {
        if (token !== loadToken) return;
        region.failed(err, load);
      });
    }

    function render(adminRows, sessionResult, recordResult, costResult, integrationResult) {
      var admins = Array.isArray(adminRows) ? adminRows : [];

      /* Empty is a real state with a real trigger, and here it is a narrow
         one. There is always at least one owner, so an empty account list is
         the settings store failing to answer rather than a dashboard nobody
         can open — and "0 administrators" reads as "everyone is locked out",
         which is the sentence that makes an operator start breaking things to
         fix a problem that does not exist. */
      if (!admins.length) {
        region.empty(nothingBehindIt());
        return;
      }

      var sessions = sessionResult.rows || [];
      var degraded = !!(sessionResult.error || recordResult.error ||
        costResult.error || integrationResult.error);

      var stack = h('div', { className: 'stack' });
      stack.appendChild(hero(admins, sessions, sessionResult.error));
      stack.appendChild(administratorsBand(admins, sessions, sessionResult));
      stack.appendChild(sessionsBand(admins, sessions, sessionResult));
      stack.appendChild(recordBand(recordResult));
      stack.appendChild(keepBand(costResult));
      stack.appendChild(integrationsBand(integrationResult));

      if (degraded) region.degraded(stack);
      else region.show(stack);
      restoreCostFocus(stack);
    }

    function nothingBehindIt() {
      var box = S.card();
      var block = S.stateBlock('plug', 'The settings store did not answer', [
        'This is not an empty administrator list. There is always at least one owner.',
        'Access is enforced on the server on every request, so nobody has lost or ' +
          'gained anything because this failed to load.'
      ]);
      var again = h('button', {
        className: 'btn btn-primary', type: 'button', text: 'Try again'
      });
      again.addEventListener('click', load);
      block.appendChild(h('div', { className: 'row mt-sm' }, [again]));
      box.appendChild(block);
      return box;
    }

    /* ------------------------------------------------------------- the hero */

    /* The answer to the pane's own first question, before any detail, counted
       from the account list and from nothing else. It is not a card and it
       carries no source chip, because there is no second thing it could be:
       it exists only on the path where that read answered, and every figure on
       it is a count of rows drawn below it. */
    function hero(admins, sessions, sessionsUnread) {
      var counts = { owner: 0, operator: 0, viewer: 0 };
      var off = 0;
      admins.forEach(function (admin) {
        if (Object.prototype.hasOwnProperty.call(counts, admin.role)) counts[admin.role] += 1;
        if (admin.status !== 'active') off += 1;
      });

      var words = [];
      ['owner', 'operator', 'viewer'].forEach(function (role) {
        if (counts[role]) words.push(fmt.plural(counts[role], ROLE_LABELS[role].toLowerCase()));
      });
      var sub = words.join(', ');
      if (!sessionsUnread) {
        sub += ' \u00b7 ' + fmt.plural(liveOnes(sessions).length, 'live session');
      }

      var box = h('section', { className: 'hero ' + (off ? 'st-warn' : 'st-ok') });
      box.appendChild(h('div', { className: 'hero-orb', 'aria-hidden': 'true' }, [
        h('i'), h('i'), h('b')
      ]));
      box.appendChild(h('div', {}, [
        h('h2', {
          className: 'hero-title',
          text: fmt.plural(admins.length, 'person', 'people') + ' can sign in'
        }),
        h('p', { className: 'hero-sub', text: sub })
      ]));

      var chips = h('div', { className: 'hero-chips' });
      chips.appendChild(pill('vio', 'lock', 'Owner only'));
      var ceiling = sessionCeiling(sessions);
      if (ceiling) chips.appendChild(pill('ghost', 'clock', 'Sessions end after ' + ceiling));
      if (off) chips.appendChild(pill('warn', 'warn', fmt.plural(off, 'account') + ' not active'));
      box.appendChild(chips);
      return box;
    }

    function liveOnes(sessions) {
      var now = Date.now();
      return sessions.filter(function (row) {
        if (row.revokedAt) return false;
        var expires = parseDate(row.expiresAt);
        return !expires || expires.getTime() > now;
      });
    }

    /* How long a session lasts, measured rather than asserted. Every session
       is issued with the same window, so the longest live one answers it; a
       page with nothing to measure says nothing rather than printing the
       number this file happens to believe. A hard-coded thirty days here would
       keep reading "30 days" for as long as it took somebody to notice the
       server had been changed. */
    function sessionCeiling(sessions) {
      var widest = 0;
      liveOnes(sessions).forEach(function (row) {
        var from = parseDate(row.createdAt);
        var to = parseDate(row.expiresAt);
        if (!from || !to) return;
        widest = Math.max(widest, to.getTime() - from.getTime());
      });
      return widest > 0 ? spanWords(widest) : null;
    }

    function myId() {
      return (session.state.admin && session.state.admin.id) || null;
    }

    /* ---------------------------------------------------------- the accounts */

    function administratorsBand(admins, sessions, sessionResult) {
      var band = S.band('Administrators', 'Everyone who can open this dashboard');

      var host = liveCard('admins', 'Accounts', fmt.plural(admins.length, 'account'));
      var tbl = table([
        { label: 'Person' }, { label: 'Role' }, { label: 'Status' },
        { label: 'Last signed in' }, { label: 'Session ends' }, { label: 'Action', right: true }
      ]);
      var rows = bodyOf(tbl);
      var mine = myId();

      admins.forEach(function (admin) {
        var row = h('tr');

        var who = h('td');
        who.appendChild(h('div', { className: 't-main', text: admin.email }));
        if (admin.id === mine) {
          who.appendChild(h('div', { className: 't-sub', text: 'This is you' }));
        } else if (admin.displayName && admin.displayName !== admin.email) {
          who.appendChild(h('div', { className: 't-sub', text: admin.displayName }));
        }
        row.appendChild(who);

        row.appendChild(h('td', {}, [rolePill(admin.role)]));
        row.appendChild(h('td', {}, [statusPill(admin.status)]));
        row.appendChild(timeCell(admin.lastLoginAt, ago(admin.lastLoginAt), 'never'));
        row.appendChild(timeCell(admin.activeSessionExpiresAt,
          endsIn(admin.activeSessionExpiresAt), 'no live session'));
        row.appendChild(accountAction(host, admin, sessions, sessionResult, mine));

        rows.appendChild(row);
      });

      host.appendChild(tableWrap('Administrator accounts', tbl));
      host.appendChild(cardFoot(
        'Accounts are provisioned with production access, not invited from here.', 'lock'));
      band.appendChild(host);
      band.appendChild(rolesNote());
      return band;
    }

    /* Three roles and no custom permission set, said once, under the table
       whose Role column is the thing it explains. */
    function rolesNote() {
      var note = h('div', { className: 'note' });
      note.appendChild(icon('info'));
      var words = h('div');
      [
        ['Owner', ' reveals personal data, changes settings and revokes access. '],
        ['Operator', ' takes on problems, closes them and retries runs. '],
        ['Viewer', ' reads, and nothing else. ']
      ].forEach(function (pair) {
        words.appendChild(h('b', { text: pair[0] }));
        words.appendChild(document.createTextNode(pair[1]));
      });
      words.appendChild(document.createTextNode(
        'Three fixed roles; there is no custom permission set.'));
      note.appendChild(words);
      return note;
    }

    function accountAction(host, admin, sessions, sessionResult, mine) {
      var cell = h('td', { className: 'r' });
      var wrap = h('div', { className: 'cell-act' });
      cell.appendChild(wrap);

      if (sessionResult.error) {
        /* The account list answered and the session list did not, so what
           there is to revoke is unknown. A Revoke button drawn against an
           unread list would be a control acting on a guess. */
        wrap.appendChild(h('span', { className: 'muted tiny', text: 'sessions unread' }));
        return cell;
      }

      var theirs = liveOnes(sessions).filter(function (row) {
        return row.adminId === admin.id;
      });

      if (admin.id === mine) {
        /* Your own access ends by signing out, which revokes the session in
           your hand and only that one. Doing it from this table would sign you
           out mid-action with no way left to see the result. */
        wrap.appendChild(h('span', { className: 'muted tiny', text: 'sign out to end yours' }));
        return cell;
      }
      if (!theirs.length) {
        wrap.appendChild(h('span', { className: 'muted tiny', text: 'nothing to revoke' }));
        return cell;
      }

      /* The name carries the account, because a column of identical Revoke
         buttons is a list of unlabelled buttons to anybody reading it out of
         context. An aria-label rather than a visually hidden span: .sr is
         absolutely positioned, and one inside a table that scrolls inside its
         own card lands at its static position out past the right edge on a
         phone and takes the whole page's scroll width with it. */
      var button = h('button', {
        className: 'btn btn-sm btn-danger', type: 'button', text: 'Revoke',
        'aria-label': 'Revoke access for ' + admin.email
      });
      button.addEventListener('click', function () {
        promptRevoke(host, admin, theirs);
      });
      wrap.appendChild(button);
      return cell;
    }

    function promptRevoke(host, admin, rows) {
      confirmAction({
        title: 'Revoke access for ' + admin.email,
        lines: [
          'This ends ' + fmt.plural(rows.length, 'live session') + ' for this account. ' +
            'They lose the dashboard on their next request and sign in again.',
          'The account is left alone. This does not change their role.'
        ],
        reasonLabel: 'Why are you revoking this',
        confirmLabel: 'Revoke access',
        focusOnClose: function () { return host; },
        onConfirm: function (reason, dialog) {
          revokeSessions(rows.map(function (row) { return row.id; }), reason).then(
            function (count) {
              /* Redraw first, close second. The button that opened this dialog
                 is inside the table being replaced, so starting the reload
                 before the dialog closes is what lets close() see that where
                 focus came from has gone, and put it on the card instead of
                 dropping it to the top of the page. */
              load();
              dialog.close();
              S.toast('check', count === 0
                ? 'Those sessions had already ended.'
                : fmt.plural(count, 'session') + ' revoked for ' + admin.email);
              S.announce(fmt.plural(count, 'session') + ' revoked.');
            },
            function (err) {
              var done = (err && err.revoked) || 0;
              var refusal = S.failureMessage(err);
              /* Part of it ran, so the table and the record on screen are both
                 out of date. Reloading is what makes the sentence below
                 checkable rather than something to be believed. */
              if (done) load();
              dialog.fail(done
                ? refusal + ' ' + fmt.plural(done, 'session') + ' had already been revoked ' +
                  'before it stopped, and the pane is reloading.'
                : refusal + ' Nothing has been revoked.');
            }
          );
        }
      });
    }

    function revokeSessions(ids, reason) {
      /* Sequential, not parallel. Each revocation writes its own entry in the
         access record, and a burst of concurrent deletes against one account
         makes the order of that record arbitrary for no gain on a list this
         size. */
      var revoked = 0;
      var failure = null;
      return ids.reduce(function (chain, id) {
        return chain.then(function () {
          if (failure) return null;
          return session.call(SESSIONS + '/' + encodeURIComponent(id), {
            method: 'DELETE',
            body: { reason: reason }
          }).then(function () {
            revoked += 1;
          }, function (err) {
            /* A session revoked by somebody else between the list and the
               click is not a failure of this action: the outcome asked for is
               the outcome in place. Anything else stops the run, because
               carrying on past a refusal would hide it behind a success. */
            if (err && (err.code === 'ops_session_already_revoked' ||
              err.code === 'ops_session_not_found')) return;
            failure = err;
          });
        });
      }, Promise.resolve()).then(function () {
        if (failure) {
          /* The refusal carries what ran before it. A run that revoked two of
             three sessions and then stopped has changed the world, and a
             caller that only learns "refused" leaves a stale table on screen
             and tells the operator nothing was revoked, which by then is
             false. */
          failure.revoked = revoked;
          throw failure;
        }
        return revoked;
      });
    }

    /* ---------------------------------------------------------- the sessions */

    function sessionsBand(admins, sessions, sessionResult) {
      var rows = liveOnes(sessions);
      var band = S.band('Active sessions', sessionResult.error
        ? 'Could not be read'
        : fmt.plural(rows.length, 'session') + ' across ' +
          fmt.plural(distinctAdmins(rows), 'person', 'people'));

      var host = liveCard('sessions', 'Signed in now', null);

      if (sessionResult.error) {
        host.appendChild(failureBody(sessionResult.error, load));
        band.appendChild(host);
        return band;
      }

      if (!rows.length) {
        /* Not a state the API can reach from a page somebody is reading: the
           request that asked for this list was made with a live session. */
        var body = h('div', { className: 'card-body' });
        body.appendChild(S.stateBlock('warn', 'No live sessions came back', [
          'Yours was used to ask for this list, so at least one was live a moment ago.'
        ], 4));
        host.appendChild(body);
        band.appendChild(host);
        return band;
      }

      var byId = {};
      admins.forEach(function (admin) { byId[admin.id] = admin; });

      var tbl = table([
        { label: 'Session' }, { label: 'Administrator' }, { label: 'Started' },
        { label: 'Last used' }, { label: 'Ends' }, { label: 'Action', right: true }
      ]);
      var tbody = bodyOf(tbl);
      var mine = myId();

      rows.forEach(function (row) {
        var admin = byId[row.adminId] || {};
        var tr = h('tr');

        tr.appendChild(h('td', {}, [h('span', {
          className: 'code', text: shortId(row.id), title: String(row.id || '')
        })]));

        var who = h('td');
        who.appendChild(h('div', { className: 't-main', text: admin.email || 'unknown account' }));
        who.appendChild(h('div', {
          className: 't-sub', text: ROLE_LABELS[admin.role] || 'role not reported'
        }));
        tr.appendChild(who);

        tr.appendChild(timeCell(row.createdAt, ago(row.createdAt), 'not recorded'));
        tr.appendChild(timeCell(row.lastUsedAt, ago(row.lastUsedAt), 'not recorded'));
        tr.appendChild(timeCell(row.expiresAt, endsIn(row.expiresAt), 'not recorded'));

        var action = h('td', { className: 'r' });
        var wrap = h('div', { className: 'cell-act' });
        if (row.current) {
          wrap.appendChild(pill('up', 'check', 'This session'));
        } else if (row.adminId && row.adminId === mine) {
          wrap.appendChild(h('span', { className: 'muted tiny', text: 'another of yours' }));
        } else {
          var button = h('button', {
            className: 'btn btn-sm btn-danger', type: 'button', text: 'Revoke',
            'aria-label': 'Revoke session ' + shortId(row.id) + ' for ' +
              (admin.email || 'an unknown account')
          });
          button.addEventListener('click', function () {
            promptRevoke(host, {
              id: row.adminId, email: admin.email || 'an unknown account'
            }, [row]);
          });
          wrap.appendChild(button);
        }
        action.appendChild(wrap);
        tr.appendChild(action);

        tbody.appendChild(tr);
      });

      host.appendChild(tableWrap('Active sessions', tbl));
      host.appendChild(cardFoot(
        'A hard ceiling, not an idle timeout. Revoking signs out on the next request.',
        'clock'));
      band.appendChild(host);
      return band;
    }

    function distinctAdmins(rows) {
      var seen = {};
      var n = 0;
      rows.forEach(function (row) {
        var key = String(row.adminId);
        if (!Object.prototype.hasOwnProperty.call(seen, key)) { seen[key] = true; n += 1; }
      });
      return n;
    }

    /* An identifier long enough to be unique on screen and short enough to
       read out. The whole value stays in the title, because the short form is
       for finding a row and the long one is for quoting it. */
    function shortId(id) {
      var text = String(id === null || id === undefined ? 'unknown' : id);
      return text.length > 12 ? text.slice(0, 12) : text;
    }

    /* ------------------------------------------------------------ the record */

    function recordBand(recordResult) {
      var band = S.band('Access record', 'Privileged actions, newest first');

      var refresh = h('button', { className: 'btn btn-sm', type: 'button' });
      refresh.appendChild(icon('refresh'));
      refresh.appendChild(h('span', { text: 'Refresh' }));
      refresh.addEventListener('click', function () { loadRecord(true); });

      var exportButton = h('button', {
        className: 'btn btn-sm', type: 'button', 'data-role': 'export'
      });
      exportButton.appendChild(icon('dl'));
      exportButton.appendChild(h('span', { text: 'Export what is loaded' }));
      exportButton.addEventListener('click', function () { exportRows(record.rows); });

      var host = liveCard('audit', 'What was done', null, [refresh, exportButton]);

      var more = h('button', {
        className: 'btn btn-sm', type: 'button', 'data-role': 'more', text: 'Load more'
      });
      more.hidden = true;
      more.addEventListener('click', function () { loadRecord(false); });

      /* The append-only rule, on the card it governs, next to the only write
         path there is. Export writes a copy; nothing on this pane can edit or
         remove an entry, and that includes whoever is reading it. */
      host.appendChild(cardFoot(
        'Append only. Nobody can edit or delete an entry, including an owner.', 'lock', more));

      record.host = host;
      if (recordResult.error) {
        setCardBody(host, failureBody(recordResult.error, function () { loadRecord(true); }));
        syncControls();
      } else {
        acceptPage(recordResult.rows, true);
      }

      band.appendChild(host);
      return band;
    }

    function whatCell(event) {
      var cell = h('td', { className: 'cell-nowrap' });
      var label = ACTION_LABELS[event.action];
      if (label) {
        cell.appendChild(pill('', null, label));
      } else {
        /* An action this page has no wording for is shown exactly as recorded.
           A guess would be a worse answer than the raw name. */
        cell.appendChild(h('span', { className: 'code', text: String(event.action || 'unknown') }));
      }
      if (event.outcome && event.outcome !== 'success') {
        cell.appendChild(document.createTextNode(' '));
        cell.appendChild(pill('warn', 'warn', String(event.outcome)));
      }
      return cell;
    }

    function targetCell(event) {
      if (!event.targetId && !event.targetType) {
        return h('td', { className: 'muted', text: 'nothing' });
      }
      var cell = h('td');
      cell.appendChild(h('span', {
        className: 'code', text: shortId(event.targetId || event.targetType),
        title: String(event.targetId || event.targetType)
      }));
      if (event.targetId && event.targetType) {
        cell.appendChild(h('div', {
          className: 't-sub',
          text: TARGET_LABELS[event.targetType] || String(event.targetType)
        }));
      }
      return cell;
    }

    function recordTable(rows) {
      var tbl = table([
        { label: 'When' }, { label: 'Who' }, { label: 'What' },
        { label: 'To what' }, { label: 'Why' }
      ]);
      var tbody = bodyOf(tbl);

      rows.forEach(function (event) {
        var tr = h('tr');
        tr.appendChild(timeCell(event.occurredAt, ago(event.occurredAt), 'not recorded'));

        var actor = h('td');
        actor.appendChild(h('div', { className: 't-main', text: event.actorEmail || 'unknown' }));
        if (event.actorRole) {
          actor.appendChild(h('div', {
            className: 't-sub', text: ROLE_LABELS[event.actorRole] || String(event.actorRole)
          }));
        }
        tr.appendChild(actor);

        tr.appendChild(whatCell(event));
        tr.appendChild(targetCell(event));
        /* The only free-text column, and the one worth reading. Every other
           cell here is nowrap, which would push a written reason off the side
           of the card and behind a horizontal scrollbar. */
        tr.appendChild(h('td', {
          className: 'cell-wrap ' + (event.reason ? 'dim' : 'muted'),
          text: event.reason ? String(event.reason) : 'none given'
        }));
        tbody.appendChild(tr);
      });

      return tableWrap('Access record', tbl);
    }

    function renderRecord() {
      if (!record.host) return;
      if (!record.rows.length) {
        var body = h('div', { className: 'card-body' });
        body.appendChild(S.stateBlock('empty', 'Nothing recorded yet', [
          'Every sign in, refused sign in, revoked session and privileged action is ' +
            'written here. An empty record means none has happened, not that recording ' +
            'is off.'
        ], 4));
        setCardBody(record.host, body);
      } else {
        setCardBody(record.host, recordTable(record.rows));
      }
      syncControls();
    }

    /* The two controls that describe the state of the record rather than its
       contents. Kept out of the body so a reload leaves them where they are. */
    function syncControls() {
      if (!record.host) return;
      var exportButton = record.host.querySelector('[data-role="export"]');
      if (exportButton) exportButton.disabled = !record.rows.length;
      var more = record.host.querySelector('[data-role="more"]');
      if (more) {
        more.hidden = !record.more;
        more.disabled = record.busy;
        more.textContent = record.busy ? 'Loading' : 'Load more';
      }
    }

    /* Paging by offset over a newest-first log that is still being written
       means an entry recorded between two pages shifts the window and the next
       page repeats a row already on screen. A cursor is the server's answer
       and belongs in its own issue; until then a row is not shown twice in a
       record people are told they can check. Rows with no id are kept as they
       come, because dropping them would be worse. */
    function acceptPage(rows, first) {
      if (!record.seen) record.seen = Object.create(null);
      var fresh = rows.filter(function (event) {
        var id = event && event.id;
        if (!id) return true;
        if (record.seen[id]) return false;
        record.seen[id] = true;
        return true;
      });
      record.rows = record.rows.concat(fresh);
      /* The offset advances by what the server sent, not by what survived the
         filter, or a repeated row would make the next page ask for one it has
         already been given. */
      record.offset += rows.length;
      /* A short page is the end of the record. Asking for another would return
         the same nothing. */
      record.more = rows.length === AUDIT_PAGE;
      renderRecord();
      if (!first && rows.length && !fresh.length) {
        /* A page of rows already on screen: say so, or the click looks like it
           did nothing. The offset advanced, so where more remains the next
           click asks for the page after it. */
        S.toast('warn', record.more
          ? 'That page held no new entries. Load more to continue.'
          : 'That page held no new entries, and it was the end of the record.');
      }
    }

    function loadRecord(reset) {
      if (!record.host) return;
      /* A reload asked for while a page is in flight is held, not dropped. A
         record request already running when a revocation succeeds would
         otherwise leave the record on screen missing the very entry the
         confirmation says was written. */
      if (record.busy) {
        if (reset) record.pending = true;
        return;
      }
      record.busy = true;
      record.pending = false;
      var token = ++record.token;

      if (reset) {
        record.offset = 0;
        record.rows = [];
        record.seen = null;
        /* Same reason as load()'s reset (Stadiora/Aria#10689, #10740): `more`
           describes the window the three lines above have just discarded. The
           failure arm below calls syncControls() with no rows, acceptPage() --
           the only other place `more` is written -- never runs, and the card
           came up saying it could not read the record while still offering to
           load more of it. Reachable from Refresh, not only from a revoke.

           Only on a reset. A later page failing with rows still on screen
           keeps its `more`, because that flag still describes the window the
           operator is looking at and the retry below is worth offering. */
        record.more = false;
        /* The skeleton, not the empty state. An empty record and a record that
           has not arrived yet are different answers to the same question, and
           showing the first while waiting for the second is how a pane says
           something false for a second and a half. */
        var body = h('div', { className: 'card-body' });
        for (var i = 0; i < 5; i++) {
          body.appendChild(h('div', { className: 'skel skel-row', 'aria-hidden': 'true' }));
        }
        body.appendChild(h('span', { className: 'sr', role: 'status', text: 'Loading' }));
        setCardBody(record.host, body);
      }
      syncControls();

      session.call(AUDIT, { query: { limit: AUDIT_PAGE, offset: record.offset } }).then(
        function (payload) {
          /* Before anything else, both arms. A response the record has moved
             past is not merely un-renderable: clearing busy first would hand
             the flag a newer read owns to a page nobody is waiting for, and
             the held-reload machinery below reads that flag to decide whether
             to run or to wait. Freshness is checked before the state it
             protects is touched, not after. */
          if (token !== record.token) return;
          record.busy = false;
          acceptPage(Array.isArray(payload && payload.data) ? payload.data : [], false);
          drain();
        },
        function (err) {
          if (token !== record.token) return;
          record.busy = false;
          if (record.rows.length) {
            /* Losing a later page is not a reason to throw away the rows
               already being read. */
            S.toast('warn', S.failureMessage(err));
            syncControls();
            drain();
            return;
          }
          setCardBody(record.host, failureBody(err, function () { loadRecord(true); }));
          syncControls();
          drain();
        }
      );
    }

    /* Runs the reload that arrived while a request was in flight. Once: the
       flag is cleared as the held reload starts, so a request answering during
       it can hold another and no chain of them runs away. */
    function drain() {
      if (record.pending) loadRecord(true);
    }

    /* Quoted, and defused. A spreadsheet reads a cell beginning with =, +, -,
       @ or a control character as a formula, and two columns of this export
       carry text somebody else wrote: the reason an operator typed, and the
       address submitted on a refused sign in, which anybody on the internet
       can choose. Exporting the access record must not be a way to run
       something on the machine of the person auditing it. */
    function csvCell(value) {
      var text = value === null || value === undefined ? '' : String(value);
      if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    }

    /* Exports what is on screen, which is why the button says so. There is no
       server-side export, and pretending otherwise by offering "everything"
       while sending only the loaded pages would be a quiet lie about a record
       people are meant to be able to check. */
    function exportRows(rows) {
      var columns = ['occurredAt', 'actorEmail', 'actorRole', 'action', 'outcome',
        'targetType', 'targetId', 'reason', 'ipAddress'];
      var lines = [columns.map(csvCell).join(',')];
      rows.forEach(function (event) {
        lines.push(columns.map(function (key) { return csvCell(event[key]); }).join(','));
      });

      var blob = new global.Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      var url = global.URL.createObjectURL(blob);
      var link = h('a', {
        href: url,
        download: 'aria-ops-access-record-' + new Date().toISOString().slice(0, 10) + '.csv'
      });
      document.body.appendChild(link);
      link.click();
      link.remove();
      global.URL.revokeObjectURL(url);
      S.announce(fmt.plural(rows.length, 'row') + ' exported.');
    }

    /* ------------------------------------------------------- integrations */

    function integrationRows(result) {
      var data = result && result.data;
      return Array.isArray(data && data.integrations) ? data.integrations : [];
    }

    function integrationSummary(result) {
      var rows = integrationRows(result);
      if (result && result.error) return 'Could not be read';
      if (!rows.length) return 'No connection states came back';
      var notConnected = rows.filter(function (row) {
        return row.connectionState !== 'connected';
      }).length;
      var problemCount = notConnected === 1 ? '1 not connected' : notConnected + ' not connected';
      return fmt.plural(rows.length, 'connection') + ' · ' +
        (notConnected ? problemCount : 'all connected');
    }

    function integrationStateMeta(state) {
      if (state === 'connected') {
        return { label: 'Connected', tone: 'up', dot: 'ok' };
      }
      if (state === 'stale') {
        return { label: 'Connected, stale', tone: 'warn integration-state-stale', dot: 'warn' };
      }
      if (state === 'failed') {
        return { label: 'Failed', tone: 'down', dot: 'bad' };
      }
      if (state === 'disabled') {
        return { label: 'Disabled', tone: 'ghost integration-state-muted', dot: 'vio' };
      }
      if (state === 'unconfigured') {
        return { label: 'Not configured', tone: 'ghost integration-state-muted', dot: 'acc' };
      }
      if (state === 'not_reporting') {
        return { label: 'Not reporting', tone: 'warn integration-state-missing', dot: 'warn' };
      }
      return { label: 'State not readable', tone: 'warn integration-state-missing', dot: 'warn' };
    }

    function integrationStatePill(row) {
      var meta = integrationStateMeta(row && row.connectionState);
      var el = h('span', { className: 'pill integration-state ' + meta.tone });
      el.appendChild(h('span', { className: 'dot ' + meta.dot, 'aria-hidden': 'true' }));
      el.appendChild(h('span', { text: meta.label }));
      return el;
    }

    function freshnessWindowWords(row) {
      var seconds = row && row.freshnessThreshold && row.freshnessThreshold.seconds;
      if (seconds === 900) return 'stale after 15 minutes';
      if (seconds === 3600) return 'stale after 1 hour';
      if (seconds === 86400) return 'stale after 24 hours';
      if (seconds && seconds % 3600 === 0) {
        return 'stale after ' + fmt.plural(seconds / 3600, 'hour');
      }
      if (seconds && seconds % 60 === 0) {
        return 'stale after ' + fmt.plural(seconds / 60, 'minute');
      }
      return null;
    }

    function failureCopy(row) {
      if (!row || !row.failureReason) return null;
      var label = INTEGRATION_FAILURE_LABELS[row.failureReason] ||
        INTEGRATION_UNKNOWN_FAILURE;
      if (row.consecutiveFailures && row.consecutiveFailures > 0) {
        return label + ' on ' + fmt.plural(row.consecutiveFailures, 'attempt') + '.';
      }
      return label + '.';
    }

    function scopeLine(row) {
      if (!row || row.scopeKey === null || row.scopeKey === undefined) return 'Scope not reported';
      if (row.scopeKey === '(none)') return 'Default scope';
      return 'Scope ' + row.scopeKey;
    }

    function integrationLastSuccess(row) {
      if (row && row.connectionState === 'not_reporting') {
        return h('td', {}, [
          h('div', { className: 't-main muted', text: 'No reporting record exists' }),
          h('div', { className: 't-sub', text: 'Nothing has succeeded or failed here yet' })
        ]);
      }
      if (!row || !row.lastSuccessAt) {
        var attempted = row && row.lastAttemptAt ? ago(row.lastAttemptAt) : null;
        var failed = failureCopy(row);
        var sub = failed || (attempted ? 'Last attempt ' + attempted : 'No attempt reported');
        if (failed && attempted) sub += ' Last attempt ' + attempted + '.';
        return h('td', {}, [
          h('div', { className: 't-main muted', text: 'Never succeeded' }),
          h('div', { className: 't-sub', text: sub })
        ]);
      }

      var sub = [];
      var age = ago(row.lastSuccessAt);
      if (age) sub.push(age);
      var fail = failureCopy(row);
      sub.push(fail || freshnessWindowWords(row) || 'freshness window reported');
      return h('td', {}, [
        h('div', {
          className: row.connectionState === 'stale'
            ? 'num integration-last-stale'
            : 'num dim',
          text: fmt.utcStamp(row.lastSuccessAt) || 'Last success reported'
        }),
        h('div', { className: 't-sub', text: sub.join(' · ') })
      ]);
    }

    function integrationsTable(rows) {
      var tbl = table([
        { label: 'Connection' }, { label: 'State' }, { label: 'Used for' },
        { label: 'Last successful run' }
      ]);
      var tbody = bodyOf(tbl);

      rows.forEach(function (row) {
        var tr = h('tr');
        var connection = h('td');
        connection.appendChild(h('div', {
          className: 't-main',
          text: row && row.label ? row.label : 'Unnamed connection'
        }));
        connection.appendChild(h('div', { className: 't-sub', text: scopeLine(row) }));
        tr.appendChild(connection);
        tr.appendChild(h('td', {}, [integrationStatePill(row)]));
        tr.appendChild(h('td', { className: 'cell-wrap', text: row && row.usedFor
          ? row.usedFor
          : 'Use not reported' }));
        tr.appendChild(integrationLastSuccess(row));
        tbody.appendChild(tr);
      });

      return tableWrap('Outside connections', tbl);
    }

    function noIntegrationsBody() {
      var body = h('div', { className: 'card-body' });
      body.appendChild(S.stateBlock('warn', 'No connection states came back', [
        'This is not a clean bill. It means the route answered without the known connections.',
        'Nothing here is zero-filled, and no credential is shown on this page.'
      ], 4));
      return body;
    }

    function integrationDeniedBody() {
      var body = h('div', { className: 'card-body' });
      body.appendChild(S.stateBlock('lock', 'You do not have access to outside connections', [
        'The integrations read is limited to the owner role.',
        'Nothing here is zero-filled, and no credential is shown on this page.'
      ], 4));
      return body;
    }

    function deniedIntegrationError(err) {
      return err && (err.code === 'ops_role_insufficient' || err.status === 403);
    }

    /* ------------------------------------------------------- cost mapping */

    function costData(result) {
      return result && result.data ? result.data : {};
    }

    function costCategories(result) {
      var rows = costData(result).categories;
      return Array.isArray(rows) ? rows : [];
    }

    function costLines(result) {
      var rows = costData(result).lines;
      return Array.isArray(rows) ? rows : [];
    }

    function costOverrides(result) {
      var rows = costData(result).overrides;
      return Array.isArray(rows) ? rows : [];
    }

    function costLabelMap(result) {
      var labels = {};
      costCategories(result).forEach(function (category) {
        if (category && category.key) {
          labels[category.key] = category.label || COST_CATEGORY_FALLBACK_LABELS[category.key] ||
            String(category.key);
        }
      });
      Object.keys(COST_CATEGORY_FALLBACK_LABELS).forEach(function (key) {
        if (!labels[key]) labels[key] = COST_CATEGORY_FALLBACK_LABELS[key];
      });
      return labels;
    }

    function costCategoryLabel(key, labels) {
      if (key === 'ungrouped') return 'Uncategorised';
      return labels[key] || String(key || 'Unknown category');
    }

    function costOverrideKey(scope, serviceKey, resourceGroupKey) {
      return String(scope || '') + '|' + String(serviceKey || '') + '|' +
        String(resourceGroupKey || '');
    }

    function costOverrideIndex(result) {
      var out = {};
      costOverrides(result).forEach(function (override) {
        if (!override) return;
        out[costOverrideKey(override.scope, override.serviceKey, override.resourceGroupKey)] =
          override;
      });
      return out;
    }

    function costOverrideFor(line, scope, index) {
      if (!line) return null;
      var resourceKey = scope === 'resource_group_service' ? line.resourceGroupKey : '';
      return index[costOverrideKey(scope, line.serviceKey, resourceKey)] || null;
    }

    function costSourceLabel(line) {
      return COST_SOURCE_LABELS[line && line.source] || 'Source not reported';
    }

    function costScopeDefault(line) {
      if (line && line.override && line.override.scope) return line.override.scope;
      return line && line.resourceGroup ? 'resource_group_service' : 'service';
    }

    function costLineFocusKey(line) {
      if (!line) return '';
      return String(line.serviceKey || line.serviceName || '') + '|' +
        String(line.resourceGroupKey || line.resourceGroup || '');
    }

    function costRestoreAfterReload(line) {
      costFocusAfterLoad = { key: costLineFocusKey(line) };
      load();
    }

    function restoreCostFocus(stack) {
      if (!costFocusAfterLoad) return;
      var target = stack.querySelector('[data-role="category"][data-cost-line-key="' +
        costFocusAfterLoad.key.replace(/"/g, '\\"') + '"]');
      if (!target) {
        var card = stack.querySelector('[data-endpoint="' + COST_CATEGORIES + '"]');
        target = card && card.querySelector('.card-title');
        if (target && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      }
      costFocusAfterLoad = null;
      if (target && target.focus) target.focus();
    }

    function costReadMessage(err) {
      if (err && COST_READ_ERRORS[err.code]) return COST_READ_ERRORS[err.code];
      if (err && (err.status === 403 || err.code === 'ops_role_insufficient')) {
        return COST_READ_ERRORS.ops_role_insufficient;
      }
      return 'The cost category settings could not be read. Try again.';
    }

    function costWriteMessage(err) {
      if (err && COST_WRITE_ERRORS[err.code]) return COST_WRITE_ERRORS[err.code];
      return 'The cost category settings could not be saved. Reload and try again.';
    }

    function costFailureBody(err, retry) {
      var body = h('div', { className: 'card-body' });
      var block = S.stateBlock('warn', 'Cost categories could not be read', [
        costReadMessage(err),
        'Nothing here is a zero. These rows are unread, not absent.'
      ], 4);
      var again = h('button', { className: 'btn btn-sm', type: 'button', text: 'Try again' });
      again.addEventListener('click', retry);
      block.appendChild(h('div', { className: 'row mt-sm' }, [again]));
      body.appendChild(block);
      return body;
    }

    function costDeniedBody() {
      var body = h('div', { className: 'card-body' });
      body.appendChild(S.stateBlock('lock', 'You do not have access to cost categories', [
        'The cost-category mapping is limited to the owner role.',
        'Nothing here is zero-filled, and no category is guessed.'
      ], 4));
      return body;
    }

    function noCostLinesBody() {
      var body = h('div', { className: 'card-body' });
      body.appendChild(S.stateBlock('empty', 'No observed cost lines yet', [
        'The route answered, but it did not return any Azure service lines.',
        'Nothing has been guessed. A new service stays out of the five categories until the owner maps it.'
      ], 4));
      return body;
    }

    function costScopeSelect(line, index) {
      var id = 'costScope-' + index;
      var label = h('label', {
        className: 'cost-field-label', 'for': id, text: 'Scope'
      });
      var select = h('select', {
        className: 'cost-select', id: id, 'data-role': 'scope',
        'aria-label': 'Scope for ' + line.serviceName
      });
      if (line.resourceGroup) {
        select.appendChild(h('option', {
          value: 'resource_group_service',
          text: 'This resource group only'
        }));
      }
      select.appendChild(h('option', { value: 'service', text: 'This service everywhere' }));
      select.value = costScopeDefault(line);
      return h('div', { className: 'cost-field' }, [label, select]);
    }

    function costCategorySelect(line, labels, categories, index) {
      var id = 'costCategory-' + index;
      var label = h('label', {
        className: 'cost-field-label', 'for': id, text: 'Category'
      });
      var select = h('select', {
        className: 'cost-select', id: id, 'data-role': 'category',
        'aria-label': 'Category for ' + line.serviceName,
        'data-cost-line-key': costLineFocusKey(line)
      });
      if (line.effectiveCategory === 'ungrouped') {
        select.appendChild(h('option', { value: '', text: 'Choose a category' }));
      }
      categories.forEach(function (category) {
        select.appendChild(h('option', {
          value: category.key,
          text: costCategoryLabel(category.key, labels)
        }));
      });
      select.value = line.effectiveCategory === 'ungrouped' ? '' : line.effectiveCategory;
      return h('div', { className: 'cost-field' }, [label, select]);
    }

    function costClearLabel(override) {
      if (!override) return 'Use default';
      return override.scope === 'service'
        ? 'Use default (removes the override for all resource groups)'
        : 'Use default (removes the override for this resource group)';
    }

    function costResourceGroupLabel(line) {
      return line && line.resourceGroup
        ? 'Resource group ' + line.resourceGroup
        : 'Resource group not reported';
    }

    function costSaveSuccessMessage(line, scopeValue, categoryValue, labels) {
      var label = costCategoryLabel(categoryValue, labels);
      if (scopeValue === 'service' && line.override &&
        line.override.scope === 'resource_group_service') {
        return 'Saved ' + label + ' as the service-wide default for ' +
          line.serviceName + '. This line keeps its resource-group override.';
      }
      return 'Saved ' + label + ' for ' + line.serviceName + '.';
    }

    function costActionCell(result, line, index) {
      var labels = costLabelMap(result);
      var categories = costCategories(result);
      var overrides = costOverrideIndex(result);
      var cell = h('td', { className: 'cell-wrap' });
      var form = h('div', { className: 'cost-editor' });
      var categoryField = costCategorySelect(line, labels, categories, index);
      var scopeField = costScopeSelect(line, index);
      var category = categoryField.querySelector('[data-role="category"]');
      var scope = scopeField.querySelector('[data-role="scope"]');
      var save = h('button', {
        className: 'btn btn-sm btn-primary', type: 'button', text: 'Save',
        'data-role': 'save',
        'aria-label': 'Save category for ' + line.serviceName
      });
      var useDefault = h('button', {
        className: 'btn btn-sm', type: 'button', text: costClearLabel(line.override),
        'data-role': 'default',
        'aria-label': costClearLabel(line.override) + ' for ' + line.serviceName
      });
      var busy = false;

      function selectedScope() {
        return scope.value === 'service' ? 'service' : 'resource_group_service';
      }

      function selectedOverride() {
        return costOverrideFor(line, selectedScope(), overrides);
      }

      function targetBody(expected) {
        var s = selectedScope();
        return {
          scope: s,
          serviceName: line.serviceName,
          resourceGroup: s === 'resource_group_service' ? line.resourceGroup : null,
          category: category.value,
          expectedUpdatedAt: expected
        };
      }

      function updateControlState() {
        save.disabled = busy || !category.value;
        useDefault.disabled = busy || !line.override;
      }

      function lock(on, word) {
        busy = on;
        updateControlState();
        save.textContent = on ? word : 'Save';
      }

      category.addEventListener('change', updateControlState);
      updateControlState();

      save.addEventListener('click', function () {
        if (!category.value) {
          var choose = 'Choose a category before saving.';
          S.toast('warn', choose);
          S.announce(choose);
          return;
        }
        var override = selectedOverride();
        var expected = override ? override.updatedAt : null;
        var saveScope = selectedScope();
        lock(true, 'Saving');
        session.call(COST_CATEGORY_OVERRIDES, {
          method: 'PUT',
          body: targetBody(expected)
        }).then(function () {
          var message = costSaveSuccessMessage(line, saveScope, category.value, labels);
          S.toast('check', message);
          S.announce(message);
          costRestoreAfterReload(line);
        }, function (err) {
          lock(false);
          if (err && err.code === 'ops_cost_category_override_stale') {
            var stale = 'That cost-category row changed somewhere else. The pane is reloading.';
            S.toast('warn', stale);
            S.announce(stale);
            costRestoreAfterReload(line);
            return;
          }
          var message = costWriteMessage(err);
          S.toast('warn', message);
          S.announce(message);
        });
      });

      useDefault.addEventListener('click', function () {
        var override = line.override;
        if (!override) return;
        save.disabled = true;
        useDefault.disabled = true;
        useDefault.textContent = 'Clearing';
        session.call(COST_CATEGORY_OVERRIDES, {
          method: 'DELETE',
          body: {
            scope: override.scope,
            serviceName: override.serviceName || line.serviceName,
            resourceGroup: override.scope === 'resource_group_service'
              ? override.resourceGroup || line.resourceGroup
              : null,
            expectedUpdatedAt: override.updatedAt
          }
        }).then(function () {
          var message = override.scope === 'service'
            ? 'Using the default for ' + line.serviceName + ' across all resource groups.'
            : 'Using the default for ' + line.serviceName + ' in this resource group.';
          S.toast('check', message);
          S.announce(message);
          costRestoreAfterReload(line);
        }, function (err) {
          save.disabled = false;
          useDefault.disabled = false;
          useDefault.textContent = 'Use default';
          if (err && err.code === 'ops_cost_category_override_stale') {
            var stale = 'That cost-category row changed somewhere else. The pane is reloading.';
            S.toast('warn', stale);
            S.announce(stale);
            costRestoreAfterReload(line);
            return;
          }
          var message = costWriteMessage(err);
          S.toast('warn', message);
          S.announce(message);
        });
      });

      form.appendChild(categoryField);
      form.appendChild(scopeField);
      form.appendChild(h('div', { className: 'cost-actions' }, [save, useDefault]));
      cell.appendChild(form);
      return cell;
    }

    function costCategoriesTable(result) {
      var labels = costLabelMap(result);
      var tbl = table([
        { label: 'Cost line' }, { label: 'Category' }, { label: 'Source' },
        { label: 'Edit', right: true }
      ]);
      var tbody = bodyOf(tbl);
      costLines(result).forEach(function (line, index) {
        var row = h('tr');
        var name = h('td');
        name.appendChild(h('div', {
          className: 't-main',
          text: line.serviceName || 'Unnamed Azure service'
        }));
        name.appendChild(h('div', {
          className: 't-sub',
          text: costResourceGroupLabel(line)
        }));
        row.appendChild(name);
        row.appendChild(h('td', {}, [
          pill(line.effectiveCategory === 'ungrouped' ? 'warn' : '', null,
            costCategoryLabel(line.effectiveCategory, labels))
        ]));
        row.appendChild(h('td', { className: 'cell-wrap' }, [
          h('div', { className: 't-main', text: costSourceLabel(line) }),
          h('div', {
            className: 't-sub',
            text: line.source === 'ungrouped'
              ? 'No category is guessed for this line'
              : line.source === 'seed'
                ? 'Seed mapping'
                : line.override && line.override.scope === 'service'
                  ? 'Service-wide override'
                  : 'Resource-group override'
          })
        ]));
        row.appendChild(costActionCell(result, line, index));
        tbody.appendChild(row);
      });
      return tableWrap('Cost category mapping', tbl);
    }

    function costCategoriesCard(result) {
      var lines = costLines(result);
      var host = liveCard('settings/cost-categories', 'Cost categories', result && result.error
        ? 'Could not be read'
        : lines.length
          ? fmt.plural(lines.length, 'cost line')
          : 'No observed cost lines yet');

      if (result && deniedIntegrationError(result.error)) {
        host.appendChild(costDeniedBody());
      } else if (result && result.error) {
        host.appendChild(costFailureBody(result.error, load));
      } else if (!lines.length) {
        host.appendChild(noCostLinesBody());
      } else {
        host.appendChild(costCategoriesTable(result));
        host.appendChild(cardFoot(
          'The current mapping applies to every period Cloud costs shows. A new service is not guessed into a category.',
          'info'));
      }

      return host;
    }

    /* --------------------------------------------- what nothing serves yet

       Every static string below is written without a digit in it, on purpose. See the
       third rule in this file's opening block: a card with no API behind it
       prints no numeral, so that no figure on this pane can be read as
       measured when it was typed. */

    function keepBand(costResult) {
      var band = S.band('What we keep, and for how long');
      var grid = h('div', { className: 'grid g2' });

      grid.appendChild(staticCard(
        'Data retention', 'Windows, and which of them are fixed',
        ['No API reports the windows in force, so a length printed here would be invented.'],
        [
          'Some windows are configurable. The access record and the reveal record are ' +
            'fixed by policy, because they record who looked at an athlete.',
          'Shortening a configurable window deletes rows on the next nightly pass. It is ' +
            'not a filter on what is read back.'
        ]
      ));

      grid.appendChild(costCategoriesCard(costResult));

      band.appendChild(grid);
      return band;
    }

    function integrationsBand(result) {
      var band = S.band('Integrations', integrationSummary(result));
      var host = liveCard('integrations', 'Outside connections', 'Whether each one is working');
      var rows = integrationRows(result);

      if (result && deniedIntegrationError(result.error)) {
        host.appendChild(integrationDeniedBody());
      } else if (result && result.error) {
        host.appendChild(failureBody(result.error, load));
      } else if (!rows.length) {
        host.appendChild(noIntegrationsBody());
      } else {
        host.appendChild(integrationsTable(rows));
        host.appendChild(cardFoot(
          'A stale connection keeps its last good answer. The age is shown beside it.',
          'info'));
      }

      band.appendChild(host);
      return band;
    }

    load();
  });
})(window);
