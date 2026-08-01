/* The Settings pane: who can get in, what we keep, and for how long.

   This pane is the one with real authority behind it, so two rules run through
   every line below.

   FIRST, IT NEVER CLAIMS AUTHORITY IT DOES NOT HAVE. The role in hand decides
   what this file draws and nothing else. It does not decide what is allowed:
   the server re-reads the account row on every request and answers 403 whether
   or not this page drew the control. A revoke button that should not be there
   is a cosmetic bug, not a security one, and the reverse is what matters, so
   every mutation is sent and the server's answer is what appears on screen.

   SECOND, IT SHOWS WHAT IS TRUE RATHER THAN WHAT THE MOCK DREW. Several cards
   in the approved mock are settings that no API can yet read or write:
   retention windows, the cost category mapping, integration connection state,
   the session and elevated-access windows. Rendering those as working selects
   and switches would be the worst outcome available, because a control that
   silently writes nothing is indistinguishable from one that works. Each of
   them therefore renders the mock's own not-configured pattern, says which of
   the two it is, and states the rules that will hold when it does become
   editable. What is real is real: administrators, sessions, revocation, and
   the access record all come from the API and nothing else.

   Mutations here are confirmed before they fire, carry the written reason the
   server requires, report what the server actually said, and are followed by a
   reload of the access record so the record of the change is on screen next to
   the change itself. */
(function (global) {
  'use strict';

  var session = global.OpsSession;
  var shell = global.OpsShell;
  var h = shell.h;
  var icon = shell.icon;

  var AUDIT_PAGE = 50;

  var ROLE_LABELS = { owner: 'Owner', operator: 'Operator', viewer: 'Viewer' };

  /* Plain language for the actions the identity boundary records. An action
     with no entry here renders as the raw name in monospace rather than as a
     guess, so a new one added server side is visible rather than mislabelled. */
  var ACTION_LABELS = {
    'admin.login': 'signed in',
    'admin.login_failed': 'sign in failed',
    'admin.logout': 'signed out',
    'admin.reauth': 'confirmed password',
    'admin.reauth_failed': 'password confirmation failed',
    'admin.password_changed': 'password changed',
    'admin.provisioned': 'account provisioned',
    'admin.session_revoke': 'access revoked',
    'admin.session_revoke_failed': 'revoke refused',
    'admin.refresh_failed': 'sign in refresh failed',
    'admin.refresh_reuse_detected': 'session token reused',
    'admin.refresh_grace_used': 'two tabs refreshed at once'
  };

  /* The sections in the rail, in the order they appear. One list, so the rail
     and the page cannot disagree about what exists or what it is called. */
  var SECTIONS = [
    { id: 'setAdmins', label: 'Administrators' },
    { id: 'setSessions', label: 'Sessions and access' },
    { id: 'setRetention', label: 'What we keep, and for how long' },
    { id: 'setCosts', label: 'Cost mapping' },
    { id: 'setIntegrations', label: 'Integrations' },
    { id: 'setAudit', label: 'Access record' }
  ];

  /* ------------------------------------------------------------ formatting */

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function parseDate(value) {
    if (!value) return null;
    var d = new Date(value);
    return isFinite(d.getTime()) ? d : null;
  }

  /* The exact moment, for the title attribute. A relative age is the readable
     form and a precise timestamp is the one an incident is reconstructed from,
     so both are carried rather than one chosen. */
  function absolute(date) {
    try { return date.toLocaleString(); } catch (e) { return date.toISOString(); }
  }

  function gap(ms) {
    var seconds = Math.round(Math.abs(ms) / 1000);
    if (seconds < 60) return 'under a minute';
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return plural(minutes, 'minute');
    var hours = Math.round(minutes / 60);
    if (hours < 48) return plural(hours, 'hour');
    return plural(Math.round(hours / 24), 'day');
  }

  function ago(date) {
    var ms = Date.now() - date.getTime();
    if (ms < 45000) return 'just now';
    return gap(ms) + ' ago';
  }

  function until(date) {
    var ms = date.getTime() - Date.now();
    if (ms <= 0) return 'expired';
    return 'in ' + gap(ms);
  }

  /* A cell carrying a relative time with the exact one behind it. Absent
     values say so rather than rendering an empty cell, because "never" and
     "not reported" are different facts and a blank is neither. */
  function timeCell(value, mode, absent) {
    var date = parseDate(value);
    if (!date) return h('td', { className: 'muted', text: absent });
    var text = mode === 'until' ? until(date) : ago(date);
    return h('td', { className: 'mono', text: text, title: absolute(date) });
  }

  function roleBadge(role) {
    var label = ROLE_LABELS[role] || role || 'unknown';
    var badge = h('span', {
      className: 'badge' + (role === 'owner' ? ' badge-brand' : ''),
      text: label
    });
    return badge;
  }

  var STATUS_LABELS = { active: 'Active', disabled: 'Disabled', suspended: 'Suspended' };

  /* Status carries a glyph as well as its word, so it never reads by colour
     alone. An unrecognised status shows exactly what the API said. */
  function statusBadge(status) {
    var active = status === 'active';
    var badge = h('span', { className: 'badge ' + (active ? 'badge-ok' : 'badge-warn') });
    badge.appendChild(icon(active ? 'check' : 'warn'));
    badge.appendChild(h('span', { text: STATUS_LABELS[status] || status || 'Unknown' }));
    return badge;
  }

  /* -------------------------------------------------------------- scaffold */

  function card(children) { return h('div', { className: 'card' }, children); }

  function cardHead(title, hint, trailing) {
    var head = h('div', { className: 'card-head' }, [
      h('h2', { className: 'card-title', text: title })
    ]);
    if (hint) head.appendChild(h('span', { className: 'card-hint', text: hint }));
    if (trailing) {
      head.appendChild(h('div', { className: 'spacer' }));
      head.appendChild(trailing);
    }
    return head;
  }

  /* A footnote of more than one sentence stops being a row and becomes a
     paragraph, so its glyph aligns to the first line rather than to the middle
     of the block. */
  function cardFoot(lines, iconName) {
    var foot = h('div', {
      className: 'card-foot' + (lines.length > 1 ? ' card-foot-note' : '')
    });
    if (iconName) foot.appendChild(icon(iconName));
    var body = h('div');
    lines.forEach(function (line) { body.appendChild(h('p', { text: line })); });
    foot.appendChild(body);
    return foot;
  }

  function skeletonRows(count) {
    var body = h('div', { className: 'card-body' }, [
      h('span', { className: 'sr-only', role: 'status', text: 'Loading' })
    ]);
    for (var i = 0; i < count; i++) {
      body.appendChild(h('div', { className: 'skel skel-row', 'aria-hidden': 'true' }));
    }
    return body;
  }

  /* Replaces a card's body without touching its head, so a reload does not
     make the heading it is filed under disappear and come back. */
  function swapBody(host, node) {
    var existing = host.querySelector('.card-body, .table-wrap, .state-block');
    while (existing) {
      existing.parentNode.removeChild(existing);
      existing = host.querySelector('.card-body, .table-wrap, .state-block');
    }
    var foot = host.querySelector('.card-foot');
    if (foot) host.insertBefore(node, foot);
    else host.appendChild(node);
  }

  /* The failure state for one card. Deliberately per card rather than per
     pane: the access record failing to load is no reason to hide the
     administrator list, and a pane that blanks itself on any error tells an
     operator less than one that says which part is missing. */
  function errorBody(err, retry) {
    var block = shell.stateBlock('warn', 'Could not load this', [
      (err && err.message) || 'The operations API did not answer.',
      'Nothing has been changed. Try again in a moment.'
    ], 3);
    var button = h('button', { className: 'btn mt', type: 'button', text: 'Try again' });
    button.addEventListener('click', retry);
    block.appendChild(button);
    return block;
  }

  /* A card for something the API cannot report yet. The distinction it draws
     is the whole point: "not built" is a promise about a release, "not
     configured" is a fact about production, and an empty card is neither. */
  function unavailableBody(title, lines) {
    return shell.stateBlock('build', title, lines, 3);
  }

  /* ---------------------------------------------------------- confirm modal */

  /* Same shape as the re-authentication prompt the session layer already
     draws: focus trapped, Escape closes, focus restored, everything behind it
     inert. Nothing destructive on this pane fires without one.

     onConfirm receives the typed reason and a small controller, and owns the
     dialog until it resolves. Failures stay in the dialog rather than closing
     it and reporting elsewhere, so the operator can correct and retry with the
     context still on screen. */
  function confirmAction(opts) {
    var previous = document.activeElement;
    var closed = false;

    var scrim = h('div', { className: 'scrim is-open' });
    var modal = h('div', {
      className: 'modal', role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': 'setConfirmTitle'
    });
    /* novalidate, because the browser's own bubble for a required field is
       transient, styled by the browser, and blocks the submit handler that
       would otherwise put the same message in the alert region below, where a
       screen reader is told about it and it stays on screen. */
    var form = h('form', { className: 'modal-card', novalidate: 'novalidate' });

    form.appendChild(h('h2', {
      className: 'sec-title', id: 'setConfirmTitle', text: opts.title
    }));
    opts.lines.forEach(function (line) {
      form.appendChild(h('p', { className: 'field-hint', text: line }));
    });

    var alertBox = h('div', { className: 'form-alert mt', role: 'alert' });
    alertBox.appendChild(h('span'));
    form.appendChild(alertBox);
    alertBox.classList.add('hidden');

    form.appendChild(h('label', {
      className: 'field-label mt', for: 'setConfirmReason', text: opts.reasonLabel
    }));
    var reason = h('input', {
      className: 'field-input set-reason', id: 'setConfirmReason', type: 'text',
      autocomplete: 'off', maxlength: '200', required: 'required'
    });
    form.appendChild(reason);
    form.appendChild(h('p', {
      className: 'field-hint',
      text: 'Recorded with your name against this action. It cannot be edited or removed later.'
    }));

    var row = h('div', { className: 'row mt' });
    var cancel = h('button', { className: 'btn', type: 'button', text: 'Cancel' });
    var confirm = h('button', {
      className: 'btn btn-primary', type: 'submit', text: opts.confirmLabel
    });
    row.appendChild(cancel);
    row.appendChild(h('div', { className: 'spacer' }));
    row.appendChild(confirm);
    form.appendChild(row);

    modal.appendChild(form);
    document.body.appendChild(scrim);
    document.body.appendChild(modal);

    /* Live regions stay out of the inert set. One carrying aria-hidden
       announces nothing, which would silence exactly the messages a dialog
       produces, and neither holds anything focusable. */
    var backdrop = Array.prototype.filter.call(document.body.children, function (el) {
      return el !== modal && el !== scrim &&
        !el.hasAttribute('aria-live') && !el.classList.contains('toast-host');
    });
    backdrop.forEach(function (el) {
      if ('inert' in el) el.inert = true;
      el.setAttribute('aria-hidden', 'true');
    });

    function focusables() {
      return Array.prototype.filter.call(
        modal.querySelectorAll('button, input'),
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
      if (!modal.contains(e.target)) {
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
      modal.remove();
      scrim.remove();

      /* Focus goes back where it came from, unless the action that just ran
         redrew the thing it came from. A revoked row is replaced by the reload
         that follows it, so the control that opened the dialog is no longer in
         the document and focusing it drops the keyboard back to the top of the
         page. The caller names somewhere in the region that changed instead. */
      if (previous && previous.isConnected && previous.focus) {
        previous.focus();
        return;
      }
      var fallback = opts.focusOnClose && opts.focusOnClose();
      if (fallback) {
        if (!fallback.hasAttribute('tabindex')) fallback.setAttribute('tabindex', '-1');
        fallback.focus();
      }
    }

    var controller = {
      close: close,
      fail: function (message) {
        /* The dialog can be dismissed while the request it fired is still in
           flight, and a refusal that lands afterwards has nowhere to go in a
           detached dialog. It goes where the success message goes instead. An
           operator who pressed Escape still fired the action, and being told
           nothing is the one outcome a refusal must never produce. */
        if (closed) {
          shell.toast('warn', message);
          shell.announce(message);
          return;
        }
        alertBox.classList.remove('hidden');
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
      var text = reason.value.trim();
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

  /* ------------------------------------------------------- administrators */

  /* One administrator's live sessions. The account list carries the furthest
     expiry, which is what the table shows, but a revocation is per session, so
     the ids come from the session list. */
  function activeSessionsFor(adminId, sessions) {
    var now = Date.now();
    return sessions.filter(function (s) {
      if (s.adminId !== adminId || s.revokedAt) return false;
      var expires = parseDate(s.expiresAt);
      return !expires || expires.getTime() > now;
    });
  }

  function revokeSessions(ids, reason) {
    /* Sequential, not parallel. Each revocation writes its own record, and a
       burst of concurrent deletes against one account makes the order of that
       record arbitrary for no gain on a list this size. */
    var revoked = 0;
    var failure = null;
    return ids.reduce(function (chain, id) {
      return chain.then(function () {
        if (failure) return null;
        return session.call('/api/ops/sessions/' + encodeURIComponent(id), {
          method: 'DELETE',
          body: { reason: reason }
        }).then(function () {
          revoked += 1;
        }, function (err) {
          /* A session revoked by somebody else between the list and the click
             is not a failure of this action: the outcome asked for is the
             outcome in place. Anything else stops the run, because carrying on
             after a refusal would hide it behind a success message. */
          if (err && err.code === 'ops_session_already_revoked') return;
          if (err && err.code === 'ops_session_not_found') return;
          failure = err;
        });
      });
    }, Promise.resolve()).then(function () {
      if (failure) {
        /* The refusal carries what ran before it. A run that revoked two of
           three sessions and then stopped has changed the world, and a caller
           that only learns "refused" leaves a stale table on screen and tells
           the operator nothing has been revoked, which by then is false. */
        failure.revoked = revoked;
        throw failure;
      }
      return revoked;
    });
  }

  /* What signing out actually does to your own row. The session list marks the
     one this tab is holding, so the others can be counted exactly; where that
     mark is missing, every live session but one is still the honest floor. */
  function otherSessionNote(live) {
    var marked = live.some(function (s) { return s.current; });
    var others = marked
      ? live.filter(function (s) { return !s.current; }).length
      : Math.max(0, live.length - 1);
    if (!others) return 'sign out to end this session';
    return 'sign out ends this one, not your other ' + plural(others, 'session');
  }

  /* The line beside a card's heading says what the card is currently showing,
     so every path that changes what the card is showing has to set it. It
     starts on "Loading", and a card that only rewrote it on the populated path
     would leave the word Loading over a rendered empty state or a rendered
     failure, which reads as a card still waiting for an answer it already got. */
  function setHint(host, text) {
    var hint = host.querySelector('.card-hint');
    if (hint) hint.textContent = text;
  }

  function renderAdmins(host, admins, sessions) {
    var mine = (session.state.admin && session.state.admin.id) || null;

    if (!admins.length) {
      setHint(host, 'no accounts returned');
      swapBody(host, unavailableBody('No administrator accounts', [
        'The API returned an empty account list. That is not a state a signed in ' +
        'administrator should be able to see, so treat it as the API being wrong ' +
        'rather than as an empty list.'
      ]));
      return;
    }

    var wrap = h('div', { className: 'table-wrap' });
    var table = h('table', { className: 'data' });
    var head = h('tr');
    ['Account', 'Role', 'Status', 'Last signed in', 'Session expires', 'Actions']
      .forEach(function (label) { head.appendChild(h('th', { text: label })); });
    table.appendChild(h('thead', {}, [head]));

    var body = h('tbody');
    admins.forEach(function (admin) {
      var row = h('tr');

      var account = h('td', { className: 'cell-strong' });
      account.appendChild(h('span', { className: 'set-actor', text: admin.email }));
      if (admin.displayName && admin.displayName !== admin.email) {
        account.appendChild(h('span', { className: 'set-cell-note', text: admin.displayName }));
      }
      row.appendChild(account);

      row.appendChild(h('td', {}, [roleBadge(admin.role)]));
      row.appendChild(h('td', {}, [statusBadge(admin.status)]));
      row.appendChild(timeCell(admin.lastLoginAt, 'ago', 'never signed in'));
      row.appendChild(timeCell(admin.activeSessionExpiresAt, 'until', 'no live session'));

      var live = activeSessionsFor(admin.id, sessions);
      var actions = h('td');
      if (admin.id === mine) {
        /* Your own access is ended by signing out, which revokes the session
           you are holding and only that one. Doing it from this table would
           sign you out mid-action with no way to see the result.

           Which is why the count is said out loud when there is more than one.
           Signing out of the tab in your hand leaves your other live sessions
           running, and a row that says otherwise is the sentence somebody reads
           on the day a laptop goes missing. */
        actions.appendChild(h('span', {
          className: 'set-cell-note', text: otherSessionNote(live)
        }));
      } else if (!live.length) {
        actions.appendChild(h('span', { className: 'set-cell-note', text: 'nothing to revoke' }));
      } else {
        /* The name carries the account, because a table of identical Revoke
           buttons is a list of unlabelled buttons to anybody reading it out of
           context. An aria-label rather than a visually hidden span: the span
           is absolutely positioned, and one inside a table that scrolls inside
           its card lands at its static position out past the right edge of a
           phone and takes the whole page's scroll width with it. */
        var button = h('button', {
          className: 'btn btn-sm', type: 'button', text: 'Revoke',
          'aria-label': 'Revoke access for ' + admin.email
        });
        button.addEventListener('click', function () {
          promptRevoke(host, admin, live);
        });
        actions.appendChild(button);
      }
      row.appendChild(actions);

      body.appendChild(row);
    });
    table.appendChild(body);
    wrap.appendChild(table);
    swapBody(host, wrap);

    setHint(host, plural(admins.length, 'account') + ', no shared credentials');
  }

  function promptRevoke(host, admin, live) {
    confirmAction({
      title: 'Revoke access for ' + admin.email,
      lines: [
        'This ends ' + plural(live.length, 'live session') + ' for this account. They ' +
        'lose the dashboard on their next request and have to sign in again.',
        'The account itself is left alone, and this does not change their role.'
      ],
      reasonLabel: 'Why are you revoking this',
      confirmLabel: 'Revoke access',
      focusOnClose: function () { return host; },
      onConfirm: function (reason, dialog) {
        revokeSessions(live.map(function (s) { return s.id; }), reason).then(function (count) {
          /* Redraw first, close second. The button that opened this dialog is
             inside the table being replaced, so starting the reload before the
             dialog closes is what lets close() see that where focus came from
             has gone and put it on the card instead of dropping it to the top
             of the page. */
          loadAdmins(host);
          /* The record of the change, beside the change. */
          reloadAudit();
          dialog.close();
          shell.toast('check', count === 0
            ? 'Those sessions had already ended.'
            : plural(count, 'session') + ' revoked for ' + admin.email);
          shell.announce(plural(count, 'session') + ' revoked.');
        }, function (err) {
          var done = (err && err.revoked) || 0;
          var refusal = (err && err.message) || 'The operations API refused that.';
          if (done) {
            /* Part of this ran, so the table and the record on screen are both
               out of date. Redrawing them is what makes the sentence below
               checkable rather than something the operator has to believe. */
            loadAdmins(host);
            reloadAudit();
          }
          dialog.fail(done
            ? refusal + ' ' + plural(done, 'session') + ' had already been revoked before ' +
              'it stopped, and the table is reloading.'
            : refusal + ' Nothing has been revoked.');
        });
      }
    });
  }

  function loadAdmins(host) {
    setHint(host, 'Loading');
    swapBody(host, skeletonRows(4));
    Promise.all([
      session.call('/api/ops/admins'),
      session.call('/api/ops/sessions')
    ]).then(function (answers) {
      var admins = answers[0] && answers[0].data;
      var sessions = answers[1] && answers[1].data;
      renderAdmins(host, Array.isArray(admins) ? admins : [],
        Array.isArray(sessions) ? sessions : []);
    }, function (err) {
      setHint(host, 'could not load');
      swapBody(host, errorBody(err, function () { loadAdmins(host); }));
    });
  }

  function adminsCard() {
    /* The mock draws this as the card's primary action. It is not one yet:
       there is no invitation endpoint, so it is rendered inert and the reason
       is in the footnote below rather than in a tooltip nobody on a keyboard
       would find. Deliberately not the primary button style, which would read
       as the thing to do next. */
    var invite = h('button', {
      className: 'btn btn-sm', type: 'button',
      text: 'Invite administrator', disabled: 'disabled'
    });
    var host = card([
      cardHead('Administrators', 'Loading', invite),
      cardFoot([
        'Administrator accounts are separate identities from athlete or coach accounts. ' +
        'The same person signing in as an athlete gets no dashboard access at all.',
        'Inviting an administrator is not built yet, so the button above does nothing. ' +
        'Accounts are provisioned by someone with production access.',
        'Sign in is by password today. Passkeys and one time codes are designed but not built, ' +
        'so this table reports the account status rather than a sign in method.'
      ], 'lock')
    ]);
    host.id = 'setAdmins';
    host.className = 'card set-section';
    loadAdmins(host);
    return host;
  }

  /* ------------------------------------------------------------------ roles */

  /* Every row here is a claim about the server, so every row is written from
     the server rather than from the design.

     "except Settings" is not a footnote to the first row, it is the row. This
     pane is the only one in the shell's registry that carries a role at all,
     and the two endpoints behind it, the administrator list and the access
     record, are the two that carry requireOpsRole('owner'). A matrix that told
     an operator they can view every pane would be wrong about the very page it
     is printed on, and would be read as an entitlement by the person least able
     to check it.

     A row carrying the trailing marker says its endpoint does not exist yet,
     so the row is the rule that endpoint will be written against rather than
     one anything refuses today. Marked on the row rather than counted in the
     footnote, because a count is a second place to be wrong the moment
     somebody reorders this. */
  var ROLE_MATRIX = [
    ['View every pane except Settings', true, true, true],
    ['Open Settings, including this page', true, false, false],
    ['Take on and close problems', true, true, false],
    ['Change an alert rule', true, false, false],
    ['See every administrator\'s sessions', true, false, false],
    ['Revoke another administrator', true, false, false],
    ['Revoke a session of your own', true, true, true],
    ['Cancel or requeue jobs', true, true, false, true],
    ['Run quality checks', true, true, false, true],
    ['Override a ship check', true, false, false, true],
    ['Show a hidden personal detail', true, false, false, true],
    ['See what was asked and answered', true, false, false, true]
  ];

  function rolesCard() {
    var wrap = h('div', { className: 'table-wrap' });
    var table = h('table', { className: 'data' });
    var head = h('tr');
    ['Capability', 'Owner', 'Operator', 'Viewer'].forEach(function (label) {
      head.appendChild(h('th', { text: label }));
    });
    table.appendChild(h('thead', {}, [head]));

    var body = h('tbody');
    ROLE_MATRIX.forEach(function (entry) {
      var row = h('tr');
      var name = h('td', { className: 'cell-strong', text: entry[0] });
      if (entry[4]) {
        name.appendChild(h('span', {
          className: 'set-cell-note', text: 'no endpoint yet, so nothing refuses it'
        }));
      }
      row.appendChild(name);
      for (var i = 1; i <= 3; i++) {
        row.appendChild(h('td', { text: entry[i] ? 'Yes' : 'No' }));
      }
      body.appendChild(row);
    });
    table.appendChild(body);
    wrap.appendChild(table);

    return card([
      cardHead('What each role can do'),
      wrap,
      cardFoot([
        'There is no custom role builder. Three roles everyone understands beat twenty ' +
        'nobody checks.',
        'This table describes the rules the server enforces. It is not a control, and ' +
        'editing this page would not change what a role can do.',
        'A row marked as having no endpoint yet names the rule its endpoint will be written ' +
        'against. Where a row says No, the server refuses it today. A row that is Yes for ' +
        'every role needs no refusal, and pane visibility is decided by the shell and then ' +
        'enforced by this pane\'s own owner-only endpoints, the only ones a role can be ' +
        'turned away from.'
      ])
    ]);
  }

  /* ------------------------------------------------------ sessions and access */

  function settingRow(name, description, value, note) {
    var row = h('div', { className: 'set-row' });
    var left = h('div', {}, [
      h('div', { className: 'set-name', text: name }),
      h('p', { className: 'set-desc', text: description })
    ]);
    var right = h('div', { className: 'set-value' });
    if (typeof value === 'string') right.appendChild(h('span', { text: value }));
    else right.appendChild(value);
    if (note) right.appendChild(h('span', { className: 'tiny', text: note }));
    row.appendChild(left);
    row.appendChild(right);
    return row;
  }

  function sessionWindowRow() {
    var current = session.state.session || {};
    var created = parseDate(current.createdAt);
    var expires = parseDate(current.expiresAt);

    if (!created || !expires) {
      return settingRow(
        'Stay signed in for',
        'How long before an administrator has to sign in again. Longer is more ' +
        'convenient on a private tool, and worse if someone steals a laptop.',
        'Not reported'
      );
    }

    var days = Math.max(1, Math.round((expires.getTime() - created.getTime()) / 86400000));
    return settingRow(
      'Stay signed in for',
      'How long before an administrator has to sign in again. Longer is more ' +
      'convenient on a private tool, and worse if someone steals a laptop. Refreshing ' +
      'does not extend it, so a session ends the same number of days after it started ' +
      'however often it is used.',
      plural(days, 'day'),
      'this session ends ' + until(expires)
    );
  }

  function reauthRows() {
    var seconds = session.state.reauthWindowSeconds;
    var minutes = typeof seconds === 'number' && seconds > 0
      ? Math.max(1, Math.round(seconds / 60)) : null;

    return [
      settingRow(
        'Ask me to sign in again for sensitive things',
        'Showing a personal detail, seeing what was asked and answered, and overriding a ' +
        'ship check ask for your password again, unless you signed in or last confirmed it ' +
        'inside the window below. This is not a switch, and there is no way to turn it off ' +
        'from here.',
        'Always on'
      ),
      settingRow(
        'How long extra access lasts',
        'Once you have confirmed your password, it stays confirmed for this long, then ' +
        'the next sensitive action asks again.',
        minutes === null ? 'Not reported' : plural(minutes, 'minute')
      ),
      settingRow(
        'Sign in from known locations only',
        'Restricting sign in to a list of addresses. Not built, and off by consequence ' +
        'rather than by choice: sign in is allowed from anywhere.',
        'Not built'
      )
    ];
  }

  function sessionsCard() {
    var body = h('div', { className: 'card-body' });
    body.appendChild(sessionWindowRow());
    reauthRows().forEach(function (row) { body.appendChild(row); });

    var host = card([
      cardHead('Sessions and access', 'What is in force now'),
      body,
      cardFoot([
        'These read the session you are holding. Changing them needs a settings API that ' +
        'is not built yet, so this card shows values rather than controls. A control that ' +
        'quietly wrote nothing would be worse than no control.'
      ], 'lock')
    ]);
    host.id = 'setSessions';
    host.className = 'card set-section';
    return host;
  }

  /* --------------------------------------------------------------- retention */

  function retentionCard() {
    var body = h('div', { className: 'card-body' });
    body.appendChild(unavailableBody('Retention windows are not readable here yet', [
      'Nothing on this page currently sets how long activity history, what was asked and ' +
      'answered, or the access record are kept. The API does not expose those windows yet, ' +
      'so showing a number would mean making one up.',
      'Two rules are fixed and will not become options when it does:'
    ]));

    var rules = h('ul', { className: 'set-rules' });
    [
      'Changes apply from now on. Nothing already recorded is deleted early by shortening ' +
      'a window.',
      'The record of who looked at which account can never be set below 90 days, by anyone, ' +
      'including an owner.'
    ].forEach(function (rule) { rules.appendChild(h('li', { text: rule })); });
    body.appendChild(rules);

    var host = card([
      cardHead('What we keep, and for how long'),
      body,
      cardFoot([
        'Activity history is metadata only: timing, state, cost, model version, and the reason ' +
        'something failed. What was asked and answered is stored encrypted and stays hidden on ' +
        'screen whatever the window says.'
      ], 'lock')
    ]);
    host.id = 'setRetention';
    host.className = 'card set-section';
    return host;
  }

  /* ------------------------------------------------------------ cost mapping */

  function costsCard() {
    var body = h('div', { className: 'card-body' });
    body.appendChild(unavailableBody('The mapping is not editable here yet', [
      'Which cloud service counts as which category is held server side and used by the ' +
      'Cloud costs pane. There is no read or write API for it yet, so this page cannot ' +
      'show you the mapping in force, and it would be worse to show a copy that could be ' +
      'out of date.'
    ]));

    var callout = h('div', { className: 'callout callout-warn mt' });
    callout.appendChild(icon('warn'));
    var text = h('div');
    text.appendChild(h('strong', { text: 'New services start ungrouped, never guessed. ' }));
    text.appendChild(document.createTextNode(
      'Anything ungrouped appears as its own line with a warning on the Cloud costs pane, ' +
      'so nothing quietly disappears into "other" and the groups always add up to the exact bill.'
    ));
    callout.appendChild(text);
    body.appendChild(callout);

    var host = card([
      cardHead('Cost mapping', 'Which cloud service counts as what'),
      body
    ]);
    host.id = 'setCosts';
    host.className = 'card set-section';
    return host;
  }

  /* ------------------------------------------------------------ integrations */

  function integrationsCard() {
    var body = h('div', { className: 'card-body' });
    body.appendChild(unavailableBody('Connection state is not reported yet', [
      'This card is where each outside connection says whether it is working and how fresh ' +
      'its last read was. The API does not report that yet, so nothing here would be a ' +
      'measurement.',
      'A connection being unreported here says nothing about whether it is working. Check ' +
      'the pane that depends on it.'
    ]));

    var host = card([
      cardHead('Integrations', 'Connection state only'),
      body,
      cardFoot([
        'Passwords and keys are never shown here, not even partly, and this page never ' +
        'receives one. When this card fills in, it will show whether each connection is ' +
        'working and nothing else.'
      ], 'lock')
    ]);
    host.id = 'setIntegrations';
    host.className = 'card set-section';
    return host;
  }

  /* --------------------------------------------------------------- the record */

  var auditState = {
    host: null, rows: [], offset: 0, more: false, busy: false, pending: false, seen: {}
  };

  function actionCell(event) {
    var cell = h('td');
    var label = ACTION_LABELS[event.action];
    if (label) {
      cell.appendChild(h('span', { className: 'badge', text: label }));
    } else {
      /* An action this page has no wording for is shown exactly as recorded.
         A guess would be a worse answer than the raw name. */
      cell.appendChild(h('span', { className: 'tag', text: String(event.action || 'unknown') }));
    }
    if (event.outcome && event.outcome !== 'success') {
      var outcome = h('span', { className: 'badge badge-warn' });
      outcome.appendChild(icon('warn'));
      outcome.appendChild(h('span', { text: String(event.outcome) }));
      cell.appendChild(document.createTextNode(' '));
      cell.appendChild(outcome);
    }
    return cell;
  }

  /* What kind of thing an action was done to, said the way the rest of the
     dashboard says it. An unrecognised kind is shown as recorded, for the same
     reason an unrecognised action is. */
  var TARGET_LABELS = {
    ops_admin_session: 'sign in session',
    ops_admin_account: 'administrator account'
  };

  function targetCell(event) {
    if (!event.targetId && !event.targetType) {
      return h('td', { className: 'muted', text: 'none' });
    }
    var cell = h('td');
    cell.appendChild(h('span', {
      className: 'mono', text: String(event.targetId || event.targetType)
    }));
    if (event.targetId && event.targetType) {
      cell.appendChild(h('span', {
        className: 'set-cell-note',
        text: TARGET_LABELS[event.targetType] || String(event.targetType)
      }));
    }
    return cell;
  }

  function auditTable(rows) {
    var wrap = h('div', { className: 'table-wrap' });
    var table = h('table', { className: 'data' });
    var head = h('tr');
    ['When', 'Who', 'What', 'To what', 'Why'].forEach(function (label) {
      head.appendChild(h('th', { text: label }));
    });
    table.appendChild(h('thead', {}, [head]));

    var body = h('tbody');
    rows.forEach(function (event) {
      var row = h('tr');
      row.appendChild(timeCell(event.occurredAt, 'ago', 'not recorded'));

      var actor = h('td');
      actor.appendChild(h('span', { className: 'set-actor', text: event.actorEmail || 'unknown' }));
      if (event.actorRole) {
        actor.appendChild(h('span', {
          className: 'set-cell-note', text: ROLE_LABELS[event.actorRole] || event.actorRole
        }));
      }
      row.appendChild(actor);

      row.appendChild(actionCell(event));
      row.appendChild(targetCell(event));
      /* The only free text column, and the one worth reading. Every other cell
         in the design system's table is nowrap, which would push a written
         reason off the side of the card and behind a horizontal scrollbar. */
      row.appendChild(h('td', {
        className: 'set-wrap ' + (event.reason ? 'small' : 'muted'),
        text: event.reason ? String(event.reason) : 'none given'
      }));
      body.appendChild(row);
    });
    table.appendChild(body);
    wrap.appendChild(table);
    return wrap;
  }

  /* Quoted, and defused. A spreadsheet reads a cell beginning with =, +, -, @
     or a control character as a formula, and two columns of this export carry
     text somebody else wrote: the reason an operator typed, and the address
     submitted on a failed sign in, which anybody on the internet can choose.
     Exporting the access record must not be a way to run something on the
     machine of the person auditing it. */
  function csvCell(value) {
    var text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  /* Exports what is on screen, which is why the button says so. There is no
     server side export, and pretending otherwise by exporting "everything"
     while sending only the loaded page would be a quiet lie about a record
     people are meant to be able to check. */
  function exportRows(rows) {
    var columns = ['occurredAt', 'actorEmail', 'actorRole', 'action', 'outcome',
      'targetType', 'targetId', 'reason', 'ipAddress'];
    var lines = [columns.map(csvCell).join(',')];
    rows.forEach(function (event) {
      lines.push(columns.map(function (key) { return csvCell(event[key]); }).join(','));
    });

    var blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = h('a', {
      href: url,
      download: 'aria-ops-access-record-' + new Date().toISOString().slice(0, 10) + '.csv'
    });
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    shell.announce(plural(rows.length, 'row') + ' exported.');
  }

  /* The two controls that describe the state of the record rather than its
     contents. Kept apart from the table so that a reload can leave the rows
     already on screen where they are. */
  function syncAuditControls() {
    var host = auditState.host;
    if (!host) return;

    var exportButton = host.querySelector('[data-role="export"]');
    if (exportButton) exportButton.disabled = !auditState.rows.length;

    var more = host.querySelector('[data-role="more"]');
    if (more) {
      more.hidden = !auditState.more;
      more.disabled = auditState.busy;
      more.textContent = auditState.busy ? 'Loading' : 'Load more';
    }
  }

  function renderAudit() {
    var host = auditState.host;
    if (!host) return;

    if (!auditState.rows.length) {
      swapBody(host, unavailableBody('Nothing recorded yet', [
        'Every sign in, every refused sign in, every revoked session, and every privileged ' +
        'action is written here. An empty record means none of those has happened, not that ' +
        'recording is off.'
      ]));
    } else {
      swapBody(host, auditTable(auditState.rows));
    }
    syncAuditControls();
  }

  function loadAudit(reset) {
    var host = auditState.host;
    if (!host) return;
    /* A reload asked for while a page is in flight is held, not dropped. The
       one caller that asks for it is the revocation that just succeeded, and
       an audit request already running when it fires would otherwise leave the
       record on screen missing the very event the toast says was written. */
    if (auditState.busy) {
      if (reset) auditState.pending = true;
      return;
    }
    auditState.busy = true;
    auditState.pending = false;

    if (reset) {
      auditState.offset = 0;
      auditState.rows = [];
      auditState.seen = {};
      /* The skeleton, not the empty state. An empty record and a record that
         has not arrived yet are different answers to the same question, and
         showing the first one while waiting for the second is how a pane says
         something false for a second and a half. */
      swapBody(host, skeletonRows(6));
    }
    syncAuditControls();

    session.call('/api/ops/audit', {
      query: { limit: AUDIT_PAGE, offset: auditState.offset }
    }).then(function (payload) {
      var rows = Array.isArray(payload.data) ? payload.data : [];
      /* Paging by offset over a newest-first log that is still being written
         means an event recorded between two pages shifts the window and the
         next page repeats a row already on screen. A cursor is the server's
         answer and belongs in its own issue; until then a row is not shown
         twice in a record people are told they can check. Rows without an id
         are kept as they come, because dropping them would be worse. */
      var fresh = rows.filter(function (event) {
        var id = event && event.id;
        if (!id) return true;
        if (auditState.seen[id]) return false;
        auditState.seen[id] = true;
        return true;
      });
      auditState.rows = auditState.rows.concat(fresh);
      /* The offset advances by what the server sent, not by what survived the
         filter, or a repeated row would make the next page ask for one it has
         already been given. */
      auditState.offset += rows.length;
      /* A short page is the end of the record. Asking for another one would
         return the same nothing. */
      auditState.more = rows.length === AUDIT_PAGE;
      auditState.busy = false;
      renderAudit();
      if (!fresh.length && rows.length) {
        /* A full page of rows already on screen: say so, or the click looks
           like it did nothing. The offset advanced, so the next click asks
           for the page after it. */
        shell.announce('That page held no new entries. Load more to continue.');
      }
      drainPendingAudit();
    }, function (err) {
      auditState.busy = false;
      if (auditState.rows.length) {
        /* Losing a later page is not a reason to throw away the rows already
           being read. */
        shell.toast('warn', (err && err.message) || 'Could not load more of the record.');
        syncAuditControls();
        drainPendingAudit();
        return;
      }
      swapBody(host, errorBody(err, function () { loadAudit(true); }));
      syncAuditControls();
      drainPendingAudit();
    });
  }

  /* Runs the reload that arrived while a request was in flight. Once: the flag
     is cleared as the held reload starts, so a request answering during it can
     hold another one and no chain of them can run away. */
  function drainPendingAudit() {
    if (auditState.pending) loadAudit(true);
  }

  function reloadAudit() { loadAudit(true); }

  function auditCard() {
    var actions = h('div', { className: 'row' });
    var exportButton = h('button', {
      className: 'btn btn-sm', type: 'button', 'data-role': 'export', disabled: 'disabled'
    });
    exportButton.appendChild(icon('download'));
    exportButton.appendChild(h('span', { text: 'Export what is loaded' }));
    exportButton.addEventListener('click', function () { exportRows(auditState.rows); });

    var refresh = h('button', { className: 'btn btn-sm', type: 'button' });
    refresh.appendChild(icon('refresh'));
    refresh.appendChild(h('span', { text: 'Refresh' }));
    refresh.addEventListener('click', function () { loadAudit(true); });

    actions.appendChild(refresh);
    actions.appendChild(exportButton);

    var foot = h('div', { className: 'card-foot' });
    var more = h('button', {
      className: 'btn btn-sm', type: 'button', 'data-role': 'more', text: 'Load more'
    });
    more.hidden = true;
    more.addEventListener('click', function () { loadAudit(false); });
    foot.appendChild(h('span', {
      text: 'Nothing here can be deleted, including by an owner. The export covers the rows ' +
        'loaded on this page, not the whole record.'
    }));
    foot.appendChild(h('div', { className: 'spacer' }));
    foot.appendChild(more);

    var host = card([
      cardHead('Access record', 'Newest first', actions),
      foot
    ]);
    host.id = 'setAudit';
    host.className = 'card set-section';
    auditState.host = host;
    loadAudit(true);
    return host;
  }

  /* ------------------------------------------------------------- the rail */

  function sectionNav() {
    var nav = h('nav', { className: 'card set-nav', 'aria-label': 'Settings sections' });
    var body = h('div', { className: 'set-nav-body' });
    var list = h('ul');

    var links = [];
    SECTIONS.forEach(function (section) {
      var link = h('a', { href: '#' + section.id, text: section.label });
      /* Marked on the way, not only once the scroll has settled. Following the
         link is the deterministic half of this, and it is the half that has to
         work: the observer below is an enhancement that a browser can decline
         to run. */
      link.addEventListener('click', function () { mark(section.id); });
      links.push({ el: link, id: section.id });
      list.appendChild(h('li', {}, [link]));
    });
    body.appendChild(list);
    nav.appendChild(body);

    function mark(id) {
      links.forEach(function (entry) {
        if (entry.id === id) entry.el.setAttribute('aria-current', 'location');
        else entry.el.removeAttribute('aria-current');
      });
    }
    /* A link into a section is a link into a section, so the rail agrees with
       the address bar on arrival as well as after a click. */
    function markFromHash() {
      var id = (global.location.hash || '').replace('#', '');
      mark(SECTIONS.some(function (s) { return s.id === id; }) ? id : SECTIONS[0].id);
    }
    markFromHash();
    global.addEventListener('hashchange', markFromHash);

    /* Which section you are reading, without a scroll handler that runs on
       every frame. Absent IntersectionObserver, the rail still navigates and
       simply keeps the first entry marked, which is a cosmetic loss. */
    if (typeof global.IntersectionObserver === 'function') {
      var seen = {};
      var observer = new global.IntersectionObserver(function (entries) {
        entries.forEach(function (entry) { seen[entry.target.id] = entry.isIntersecting; });
        for (var i = 0; i < SECTIONS.length; i++) {
          if (seen[SECTIONS[i].id]) { mark(SECTIONS[i].id); return; }
        }
      }, { rootMargin: '-72px 0px -55% 0px' });
      global.setTimeout(function () {
        SECTIONS.forEach(function (section) {
          var el = document.getElementById(section.id);
          if (el) observer.observe(el);
        });
      }, 0);
    }

    return nav;
  }

  /* ---------------------------------------------------------------- render */

  function intro() {
    var callout = h('div', { className: 'callout' });
    callout.appendChild(icon('lock'));
    var body = h('div');
    body.appendChild(h('strong', { text: 'Owner role required. ' }));
    body.appendChild(document.createTextNode(
      'Every request behind this pane is checked against your account on the server, not ' +
      'against what this page drew. Changes made here take effect immediately and are ' +
      'written to the access record at the bottom of the page.'
    ));
    callout.appendChild(body);
    return callout;
  }

  function render() {
    var content = document.getElementById('content');
    if (!content) return;
    content.textContent = '';
    content.appendChild(intro());

    var layout = h('div', { className: 'settings' });
    layout.appendChild(sectionNav());

    var stack = h('div', { className: 'stack' });
    stack.appendChild(adminsCard());
    stack.appendChild(rolesCard());
    stack.appendChild(sessionsCard());
    stack.appendChild(retentionCard());
    stack.appendChild(costsCard());
    stack.appendChild(integrationsCard());
    stack.appendChild(auditCard());
    layout.appendChild(stack);

    content.appendChild(layout);
  }

  /* onReady rather than a listener on ops:ready, because this file is its own
     network request and the shell can have finished before it is parsed.

     The shell renders the denied state for a role that may not open this pane,
     and this file adds nothing in that case. It is not the gate: the server
     refuses every request behind this pane on its own, and would refuse them
     if this check were deleted. */
  shell.onReady(function (detail) {
    if (!detail || detail.pane !== 'settings') return;
    if (!session.hasRole(['owner'])) return;
    render();
  });
})(window);
