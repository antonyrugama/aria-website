/* Look up a user: what is going on with this one account?

   This pane is the one place in the dashboard that touches a real person's
   record, so most of what follows is a constraint rather than a feature.

   THE FOUR RULES, and what each costs

     1. Exact match only. An identifier either names an account or it does not.
        There is no browse, no listing, and no near-match fallback, because a
        fuzzy list of real accounts is exactly the thing this pane exists not
        to produce. A wrong guess therefore cannot be used to find out who has
        an account.
     2. Masked by default. Every personal field arrives from the API already
        masked. This file never derives a mask from a real value, because that
        would mean the real value was sent to the browser in the first place.
        What is on screen is what the API chose to send, and nothing else.
     3. A reveal is one field, with a written reason, and it un-reveals itself.
        The reason is required by the form and again by the server. The value
        comes back with the moment it expires, and this file re-masks at that
        moment, when the drawer closes, and when a new search starts.
     4. Health data has no reveal control at all. Not a disabled one, not one
        that asks for a stronger role: the field carries no control, because a
        control that can never succeed still tells an operator that the value
        is somewhere within reach.

   Activity is a list of events and never their content. "Chat session, 8
   messages" is a fact about the service; what was said is not this pane's to
   show, at any role.

   Destructive account actions are absent by design rather than hidden behind a
   permission. Deleting an account runs through the account deletion workflow,
   which needs the athlete's own confirmation, and there is no path to it here.

   WHAT THIS PANE READS

     POST /api/ops/users/lookup
       { identifier, reason, scope, state, tier }
       -> { data: { recorded, matchCount, matches[] } }

     GET /api/ops/users/{reference}
       -> { data: { reference, kind, state, tier, memberSince, recorded,
                    summary{fields[]}, activity, devices, billing, access } }

     POST /api/ops/users/{reference}/reveal
       { field, reason }
       -> { data: { field, value, expiresAt, recorded } }

   The identifier is sent in a body rather than a querystring on purpose: it is
   the one value in this dashboard most likely to be somebody's email address,
   and a querystring is the part of a request that ends up in access logs,
   proxy logs, and browser history. A lookup also writes an access record, so a
   POST is what it is.

   summary.fields[] entries carry { key, label, value, maskedValue, masked,
   reveal } where reveal is 'allowed', 'never', or 'unavailable'. The server
   decides which; this file renders the decision and owns none of it. */
(function (global) {
  'use strict';

  var shell = global.OpsShell;
  var session = global.OpsSession;
  var h = shell.h;
  var icon = shell.icon;

  var TONE_ICON = { ok: 'check', warn: 'warn', crit: 'warn', info: 'info' };

  /* --------------------------------------------------------- formatting */

  function parseTime(iso) {
    if (!iso) return null;
    var t = new Date(iso).getTime();
    return isFinite(t) ? t : null;
  }

  function ago(iso) {
    var t = parseTime(iso);
    if (t === null) return null;
    var mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hours = Math.round(mins / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.round(hours / 24);
    return days === 1 ? '1d ago' : days + 'd ago';
  }

  function dateTime(iso) {
    var t = parseTime(iso);
    if (t === null) return null;
    try { return new Date(t).toLocaleString(); } catch (e) { return new Date(t).toISOString(); }
  }

  /* "Today 09:52", "Yesterday 18:04", "26 Jul 07:14". A support conversation
     is about what happened today or the day before far more often than about a
     date, and a full locale timestamp on every row buries that. */
  function whenLabel(iso) {
    var t = parseTime(iso);
    if (t === null) return null;
    var d = new Date(t);
    var time;
    try { time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { time = d.toISOString().slice(11, 16); }

    var startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    var dayDiff = Math.floor((startOfToday.getTime() - d.getTime()) / 86400000);
    if (d.getTime() >= startOfToday.getTime()) return 'Today ' + time;
    if (dayDiff < 1) return 'Yesterday ' + time;

    var opts = { day: 'numeric', month: 'short' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    var day;
    try { day = d.toLocaleDateString(undefined, opts); } catch (e2) { day = d.toISOString().slice(0, 10); }
    return day + ' ' + time;
  }

  /* How long a revealed value has left. Rounding a short window up to
     "1 minutes" is both wrong and ungrammatical, and the window is the server's
     to choose, so both units are handled here. */
  function countdownLabel(ms) {
    var seconds = Math.max(1, Math.round(ms / 1000));
    if (seconds < 90) return seconds + (seconds === 1 ? ' second' : ' seconds');
    var minutes = Math.round(seconds / 60);
    return minutes + (minutes === 1 ? ' minute' : ' minutes');
  }

  function dateOnly(iso) {
    var t = parseTime(iso);
    if (t === null) return null;
    try {
      return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { return new Date(t).toISOString().slice(0, 10); }
  }

  /* ------------------------------------------------------- small pieces */

  function badge(tone, text, iconName) {
    var b = h('span', { className: 'badge' + (tone ? ' badge-' + tone : '') });
    var glyph = iconName || TONE_ICON[tone];
    if (glyph) b.appendChild(icon(glyph));
    b.appendChild(h('span', { text: text }));
    return b;
  }

  function stateBadge(state) {
    if (!state) return badge('', 'State not reported');
    return badge(state.tone || '', state.label || state.key || 'Unknown');
  }

  function tierBadge(tier) {
    if (!tier) return badge('', 'Tier not reported');
    return badge(tier.brand ? 'brand' : '', tier.label || tier.key || 'Unknown');
  }

  function flagChip(flag) {
    var chip = h('span', { className: 'flagchip' + (flag.tone ? ' is-' + flag.tone : '') });
    var glyph = TONE_ICON[flag.tone];
    if (glyph) chip.appendChild(icon(glyph));
    chip.appendChild(h('span', { text: flag.label || flag.key }));
    return chip;
  }

  function platformTag(p) {
    var cls = p.key === 'coaches' ? 'tag tag-coaches' : 'tag tag-mobile';
    return h('span', { className: cls, text: p.label || p.key });
  }

  /* The recording confirmation. It appears after a lookup rather than before
     it, because it reports something that has already happened: this is the
     row the athlete would be shown if they asked. */
  function recordedCallout(recorded) {
    if (!recorded) return null;
    var box = h('div', { className: 'callout callout-info' });
    box.appendChild(icon('lock'));
    var body = h('div');
    body.appendChild(h('strong', { text: 'This lookup is on the record.' }));
    var parts = [];
    if (recorded.at) parts.push('at ' + (dateTime(recorded.at) || recorded.at));
    if (recorded.actor) parts.push('by ' + recorded.actor);
    if (recorded.fields) parts.push('as ' + recorded.fields);
    if (recorded.reason) parts.push('reason ' + recorded.reason);
    body.appendChild(document.createTextNode(' Written ' + parts.join(', ') + '.'));
    box.appendChild(body);
    return box;
  }

  /* ------------------------------------------------------- privacy bar */

  function privacyBar() {
    var bar = h('div', { className: 'privacy-bar' });
    bar.appendChild(icon('lock'));
    var body = h('div');
    body.appendChild(h('strong', { text: 'Every lookup on this page is recorded.' }));
    body.appendChild(document.createTextNode(
      ' Your account, the account you viewed, the time, and the reason you gave are written to ' +
      'the access record, and the athlete can be shown that record. Personal details stay hidden ' +
      'until you show them one at a time, and each one you show is recorded by name.'
    ));
    bar.appendChild(body);
    return bar;
  }

  /* --------------------------------------------------------- the search */

  var form = null;
  var identifierInput = null;
  var reasonInput = null;
  var stateSelect = null;
  var tierSelect = null;
  var formError = null;

  function selectControl(id, label, options) {
    var sel = h('select', { className: 'select', id: id });
    options.forEach(function (o) {
      sel.appendChild(h('option', { value: o.v, text: o.l }));
    });
    return h('div', { className: 'lookup-field' }, [
      h('label', { className: 'field-label', for: id, text: label }),
      sel
    ]);
  }

  function searchCard(onSubmit) {
    var card = h('div', { className: 'card' });
    card.appendChild(h('div', { className: 'card-head' }, [
      h('h2', { className: 'card-title', text: 'Find an account' }),
      h('span', { className: 'card-hint', text: 'Exact identifier only. There is no way to browse everyone.' })
    ]));

    var body = h('div', { className: 'card-body' });
    form = h('form', { className: 'lookup-form', novalidate: 'novalidate' });

    identifierInput = h('input', {
      className: 'lookup-input', id: 'lookupIdentifier', type: 'text',
      autocomplete: 'off', spellcheck: 'false',
      placeholder: 'Exact email, user id, or support reference'
    });
    var idField = h('div', { className: 'lookup-field' }, [
      h('label', { className: 'field-label', for: 'lookupIdentifier', text: 'Identifier' }),
      identifierInput
    ]);

    reasonInput = h('input', {
      className: 'lookup-input', id: 'lookupReason', type: 'text',
      autocomplete: 'off', placeholder: 'Ticket number or short reason'
    });
    var reasonField = h('div', { className: 'lookup-field' }, [
      h('label', { className: 'field-label', for: 'lookupReason', text: 'Reason for this lookup' }),
      reasonInput
    ]);

    var stateField = selectControl('lookupState', 'State', [
      { v: '', l: 'Any state' },
      { v: 'active', l: 'Active' },
      { v: 'payment_failed', l: 'Payment failed' },
      { v: 'deletion_requested', l: 'Deletion requested' },
      { v: 'suspended', l: 'Suspended' }
    ]);
    stateSelect = stateField.querySelector('select');

    var tierField = selectControl('lookupTier', 'Tier', [
      { v: '', l: 'Any tier' },
      { v: 'free', l: 'Free' },
      { v: 'pro', l: 'Pro' },
      { v: 'coach_team', l: 'Coach team' }
    ]);
    tierSelect = tierField.querySelector('select');

    var submit = h('button', { className: 'btn btn-primary', type: 'submit' });
    submit.appendChild(icon('search'));
    submit.appendChild(h('span', { text: 'Look up' }));

    form.appendChild(idField);
    form.appendChild(reasonField);
    form.appendChild(stateField);
    form.appendChild(tierField);
    form.appendChild(h('div', { className: 'lookup-field' }, [submit]));

    formError = h('p', { className: 'field-error', role: 'alert' });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      onSubmit();
    });

    body.appendChild(form);
    body.appendChild(formError);
    body.appendChild(h('p', {
      className: 'field-hint',
      text: 'A reason is required because it is written to the access record beside your name. ' +
        'Near matches are never returned, so a wrong guess tells you nothing about who has an account.'
    }));
    card.appendChild(body);
    return card;
  }

  function setFormError(message) {
    if (!formError) return;
    formError.textContent = '';
    if (!message) {
      if (identifierInput) identifierInput.removeAttribute('aria-invalid');
      if (reasonInput) reasonInput.removeAttribute('aria-invalid');
      return;
    }
    formError.appendChild(icon('warn'));
    formError.appendChild(h('span', { text: message }));
  }

  /* --------------------------------------------------------- match list */

  function matchesCard(data, onPick, selectedRef) {
    var card = h('div', { className: 'card' });
    var head = h('div', { className: 'card-head' });
    head.appendChild(h('h3', { className: 'card-title', text: 'Matches' }));
    head.appendChild(h('span', {
      className: 'card-hint',
      text: data.matchCount === 1 ? '1 account, exact identifier match'
        : data.matchCount + ' accounts, exact identifier match'
    }));
    head.appendChild(h('div', { className: 'spacer', 'aria-hidden': 'true' }));
    head.appendChild(badge('info', 'Details hidden', 'lock'));
    card.appendChild(head);

    var wrap = h('div', { className: 'table-wrap' });
    var table = h('table', { className: 'data' });
    table.appendChild(h('caption', { className: 'sr-only', text: 'Accounts matching the identifier you entered' }));

    table.appendChild(h('thead', {}, [
      h('tr', {}, [
        h('th', { scope: 'col', text: 'Account' }),
        h('th', { scope: 'col', text: 'State' }),
        h('th', { scope: 'col', text: 'Tier' }),
        h('th', { scope: 'col', text: 'Platforms' }),
        h('th', { scope: 'col', text: 'Last active' }),
        h('th', { scope: 'col', text: 'Flags' })
      ])
    ]));

    var tbody = h('tbody');
    (data.matches || []).forEach(function (m) {
      var tr = h('tr');
      if (m.reference === selectedRef) tr.className = 'is-selected';

      /* The whole row is not the control. A row click is unreachable from a
         keyboard, so the account cell carries a real button and that button is
         what selects the account. */
      var pick = h('button', {
        className: 'match-row-btn', type: 'button',
        'data-ref': m.reference,
        'aria-pressed': String(m.reference === selectedRef)
      });
      pick.appendChild(h('div', { className: 'cell-strong mono', text: m.reference }));
      if (m.maskedEmail) {
        pick.appendChild(h('div', { className: 'tiny' }, [
          h('span', { className: 'masked', text: m.maskedEmail })
        ]));
      }
      pick.appendChild(h('span', { className: 'sr-only', text: ', open this account' }));
      pick.addEventListener('click', function () { onPick(m.reference); });

      var cell = h('th', { scope: 'row' });
      cell.appendChild(pick);
      tr.appendChild(cell);

      tr.appendChild(h('td', {}, [stateBadge(m.state)]));
      tr.appendChild(h('td', {}, [tierBadge(m.tier)]));

      var platforms = h('td');
      (m.platforms || []).forEach(function (p) { platforms.appendChild(platformTag(p)); });
      if (!(m.platforms || []).length) platforms.appendChild(h('span', { className: 'muted tiny', text: 'not reported' }));
      tr.appendChild(platforms);

      tr.appendChild(h('td', { className: 'mono', text: ago(m.lastActiveAt) || 'not reported' }));

      var flags = h('td');
      (m.flags || []).forEach(function (f) { flags.appendChild(flagChip(f)); });
      if (!(m.flags || []).length) flags.appendChild(h('span', { className: 'muted tiny', text: 'none' }));
      tr.appendChild(flags);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    card.appendChild(wrap);

    card.appendChild(h('div', { className: 'card-foot' }, [
      h('span', {
        text: 'Rows show coded ids. The part-hidden email is only enough to check you have the ' +
          'right person, and it is masked by the operations API rather than by this page.'
      })
    ]));
    return card;
  }

  /* ------------------------------------------------------ field reveal */

  /* Every revealed field on screen, so that one call re-masks all of them:
     closing the drawer, running a new search, or an expiry falling due. */
  var revealed = [];

  function clearReveals() {
    revealed.slice().forEach(function (entry) { entry.hide(); });
    revealed = [];
  }

  function isOwner() { return session.hasRole(['owner']); }

  /* One field row. Three shapes, and which one is drawn is the API's decision:

       reveal 'never'        no control at all, and a line saying so
       reveal 'unavailable'  no control, and the reason there is none
       reveal 'allowed'      a control that asks for a written reason first */
  function fieldValue(reference, field) {
    var row = h('div', { className: 'reveal-row' });

    var masked = h('span', {
      className: 'masked',
      text: field.maskedValue || (field.masked ? 'Hidden' : '')
    });
    var shown = h('span', { className: 'reveal-value hidden' });
    var note = h('span', { className: 'reveal-note hidden' });

    /* A plain value the API did not consider personal. Rendered as it came. */
    if (!field.masked) {
      return h('span', { className: 'reveal-value', text: field.value === null || field.value === undefined ? 'not reported' : String(field.value) });
    }

    row.appendChild(masked);
    row.appendChild(shown);
    row.appendChild(note);

    if (field.reveal === 'never') {
      var never = h('span', { className: 'reveal-never' });
      never.appendChild(icon('lock'));
      never.appendChild(h('span', { text: field.neverShownNote || 'Never shown here' }));
      row.appendChild(never);
      return row;
    }

    if (field.reveal !== 'allowed') {
      row.appendChild(h('span', {
        className: 'tiny muted',
        text: field.unavailableNote || 'Not revealable'
      }));
      return row;
    }

    if (!isOwner()) {
      /* The rail already renders role facts rather than hiding destinations,
         so this does the same: the control is present, plainly unavailable,
         and names the role. The server enforces it regardless. */
      var locked = h('button', { className: 'btn btn-sm', type: 'button', disabled: 'disabled' });
      locked.appendChild(icon('eye'));
      locked.appendChild(h('span', { text: 'Reveal' }));
      row.appendChild(locked);
      row.appendChild(h('span', { className: 'tiny muted', text: 'Owner action' }));
      return row;
    }

    var timer = null;
    var entry = null;

    function hide() {
      if (timer) { global.clearTimeout(timer); timer = null; }
      shown.textContent = '';
      shown.classList.add('hidden');
      note.textContent = '';
      note.classList.add('hidden');
      masked.classList.remove('hidden');
      revealBtn.classList.remove('hidden');
      hideBtn.classList.add('hidden');
      var at = revealed.indexOf(entry);
      if (at !== -1) revealed.splice(at, 1);
    }

    var revealBtn = h('button', { className: 'btn btn-sm', type: 'button' });
    revealBtn.appendChild(icon('eye'));
    revealBtn.appendChild(h('span', { text: 'Reveal' }));

    var hideBtn = h('button', { className: 'btn btn-sm hidden', type: 'button', text: 'Hide again' });
    hideBtn.addEventListener('click', function () {
      hide();
      shell.announce(field.label + ' hidden again');
    });

    var reasonForm = h('form', { className: 'reveal-row hidden' });
    var reasonId = 'reveal-' + reference + '-' + field.key;
    var reasonBox = h('input', {
      className: 'lookup-input', id: reasonId, type: 'text', autocomplete: 'off',
      placeholder: 'Reason, recorded by field name'
    });
    var confirm = h('button', { className: 'btn btn-sm btn-primary', type: 'submit', text: 'Show ' + (field.label || field.key).toLowerCase() });
    var cancel = h('button', { className: 'btn btn-sm', type: 'button', text: 'Cancel' });
    var problem = h('span', { className: 'tiny reveal-note' });

    reasonForm.appendChild(h('label', { className: 'sr-only', for: reasonId, text: 'Reason for revealing ' + (field.label || field.key) }));
    reasonForm.appendChild(reasonBox);
    reasonForm.appendChild(confirm);
    reasonForm.appendChild(cancel);
    reasonForm.appendChild(problem);

    function closeForm(restoreFocus) {
      reasonForm.classList.add('hidden');
      reasonBox.value = '';
      problem.textContent = '';
      revealBtn.classList.remove('hidden');
      if (restoreFocus) revealBtn.focus();
    }

    cancel.addEventListener('click', function () { closeForm(true); });

    revealBtn.addEventListener('click', function () {
      reasonForm.classList.remove('hidden');
      revealBtn.classList.add('hidden');
      reasonBox.focus();
    });

    reasonForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var reason = reasonBox.value.trim();
      if (reason.length < 3) {
        problem.textContent = 'Give a reason. It is written beside your name.';
        reasonBox.setAttribute('aria-invalid', 'true');
        reasonBox.focus();
        return;
      }
      reasonBox.removeAttribute('aria-invalid');
      confirm.disabled = true;
      problem.textContent = '';

      session.call('/api/ops/users/' + encodeURIComponent(reference) + '/reveal', {
        method: 'POST',
        body: { field: field.key, reason: reason }
      }).then(function (payload) {
        confirm.disabled = false;
        var out = (payload && payload.data) || {};
        closeForm(false);

        shown.textContent = out.value === null || out.value === undefined ? 'not reported' : String(out.value);
        shown.classList.remove('hidden');
        masked.classList.add('hidden');
        hideBtn.classList.remove('hidden');
        revealBtn.classList.add('hidden');

        var expiresIn = parseTime(out.expiresAt);
        if (expiresIn !== null) {
          var ms = Math.max(0, expiresIn - Date.now());
          note.textContent = 'Hides itself in ' + countdownLabel(ms);
          note.classList.remove('hidden');
          timer = global.setTimeout(function () {
            hide();
            shell.announce(field.label + ' hidden again automatically');
          }, ms);
        } else {
          note.textContent = 'Recorded by field name';
          note.classList.remove('hidden');
        }

        entry = { hide: hide };
        revealed.push(entry);
        hideBtn.focus();
        shell.announce(field.label + ' revealed and recorded');
      }).catch(function (err) {
        confirm.disabled = false;
        problem.textContent = err && err.code === 'ops_role_insufficient'
          ? 'Revealing a field is an owner action.'
          : (err && err.message) || 'The operations API refused that.';
        reasonBox.focus();
      });
    });

    row.appendChild(revealBtn);
    row.appendChild(hideBtn);
    row.appendChild(reasonForm);
    return row;
  }

  function fieldList(reference, fields, columns) {
    var dl = h('dl', { className: 'dl' + (columns ? ' ' + columns : '') });
    (fields || []).forEach(function (f) {
      dl.appendChild(h('dt', { text: f.label || f.key }));
      var dd = h('dd', { className: 'plain' });
      dd.appendChild(fieldValue(reference, f));
      dl.appendChild(dd);
    });
    return dl;
  }

  /* -------------------------------------------------------- the account */

  function summaryCard(detail, onOpenDrawer) {
    var card = h('div', { className: 'card' });
    var head = h('div', { className: 'card-head' });
    head.appendChild(h('h3', { className: 'card-title', text: 'Account summary' }));
    head.appendChild(h('span', { className: 'mono small', text: detail.reference }));
    head.appendChild(h('div', { className: 'spacer', 'aria-hidden': 'true' }));
    var full = h('button', { className: 'btn btn-sm', type: 'button', text: 'Full record' });
    full.addEventListener('click', onOpenDrawer);
    head.appendChild(full);
    card.appendChild(head);

    var body = h('div', { className: 'card-body' });
    body.appendChild(fieldList(detail.reference, (detail.summary && detail.summary.fields) || []));
    card.appendChild(body);

    var foot = h('div', { className: 'card-foot' });
    foot.appendChild(icon('lock'));
    foot.appendChild(h('span', {
      text: 'Weight, injuries, journal entries, and messages are never shown here at all. ' +
        'There is no button on this page that would reveal them.'
    }));
    card.appendChild(foot);
    return card;
  }

  function activityCard(detail) {
    var card = h('div', { className: 'card' });
    var activity = detail.activity;
    var head = h('div', { className: 'card-head' });
    head.appendChild(h('h3', { className: 'card-title', text: 'Recent activity' }));
    head.appendChild(h('span', {
      className: 'card-hint',
      text: activity && activity.windowDays
        ? 'Last ' + activity.windowDays + ' days, events only'
        : 'Events only'
    }));
    card.appendChild(head);

    var body = h('div', { className: 'card-body' });
    var events = (activity && activity.events) || [];

    if (!events.length) {
      body.appendChild(shell.stateBlock('empty', 'No activity in this window', [
        activity
          ? 'The account exists and reported nothing in the window. That is a quiet account, not a missing one.'
          : 'The operations API did not report activity for this account.'
      ], 4));
      card.appendChild(body);
      return card;
    }

    var timeline = h('div', { className: 'timeline' });
    events.forEach(function (ev) {
      var item = h('div', { className: 'tl-item' + (ev.tone ? ' ' + ev.tone : '') });
      item.appendChild(h('div', { className: 'tl-time', text: whenLabel(ev.occurredAt) || 'time not reported' }));
      var line = h('div');
      line.appendChild(h('span', { text: ev.label }));
      /* Only a link when the API gave one, and only ever to another pane in
         this dashboard. */
      if (ev.reference && ev.href) {
        line.appendChild(document.createTextNode(' '));
        line.appendChild(h('a', { className: 'tiny mono', href: ev.href, text: ev.reference }));
      } else if (ev.reference) {
        line.appendChild(document.createTextNode(' '));
        line.appendChild(h('span', { className: 'tiny mono muted', text: ev.reference }));
      }
      item.appendChild(line);
      timeline.appendChild(item);
    });
    body.appendChild(timeline);
    card.appendChild(body);

    card.appendChild(h('div', { className: 'card-foot' }, [
      h('span', {
        text: 'Activity is a list of events, never content. "Chat session, 8 messages" is shown. ' +
          'What was said is not, at any role.'
      })
    ]));
    return card;
  }

  /* The support card exists to say what is not here as much as what is. The
     destructive half is absent by design: no button, no permission check, no
     path. That is the point, so it is stated rather than left to be noticed. */
  function supportCard(detail) {
    var card = h('div', { className: 'card' });
    card.appendChild(h('div', { className: 'card-head' }, [
      h('h3', { className: 'card-title', text: 'Support actions' })
    ]));

    var body = h('div', { className: 'card-body stack-sm' });
    var actions = (detail.supportActions && detail.supportActions.available) || [];

    if (!actions.length) {
      body.appendChild(h('p', { className: 'state-desc', text:
        'No support action is wired up to this pane yet. When one is, it appears here as a ' +
        'button that names exactly what it does.' }));
    } else {
      var list = h('ul', { className: 'notbuilt-list' });
      actions.forEach(function (a) { list.appendChild(h('li', { text: a.label || a.key })); });
      body.appendChild(list);
    }

    var warn = h('div', { className: 'callout callout-warn' });
    warn.appendChild(icon('warn'));
    warn.appendChild(h('div', { className: 'small', text:
      'Destructive actions, deleting an account or wiping its data, are not available here at ' +
      'all. They are not hidden behind a permission: there is no control for them on this page. ' +
      "They run through the account deletion workflow, which needs the athlete's own confirmation." }));
    body.appendChild(warn);

    card.appendChild(body);
    return card;
  }

  /* --------------------------------------------------------- the drawer */

  var drawer = null;
  var drawerScrim = null;
  var drawerReturnFocus = null;
  var drawerInert = [];

  function setBackgroundInert(on) {
    if (!on) {
      drawerInert.forEach(function (el) {
        if ('inert' in el) el.inert = false;
        el.removeAttribute('aria-hidden');
      });
      drawerInert = [];
      return;
    }
    drawerInert = Array.prototype.filter.call(document.body.children, function (el) {
      /* Live regions stay reachable. One carrying aria-hidden announces
         nothing, and neither holds focusable content, so leaving them out
         costs the drawer's modality nothing. */
      return el !== drawer && el !== drawerScrim &&
        !el.hasAttribute('aria-live') && !el.classList.contains('toast-host');
    });
    drawerInert.forEach(function (el) {
      if ('inert' in el) el.inert = true;
      el.setAttribute('aria-hidden', 'true');
    });
  }

  function focusables() {
    if (!drawer) return [];
    return Array.prototype.filter.call(
      drawer.querySelectorAll('a[href], button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])'),
      function (el) { return el.offsetParent !== null || el === document.activeElement; }
    );
  }

  function onDrawerKey(e) {
    if (!drawer) return;
    if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); return; }
    if (e.key !== 'Tab') return;
    var items = focusables();
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function onDrawerFocus(e) {
    if (drawer && !drawer.contains(e.target)) {
      var items = focusables();
      if (items.length) items[0].focus();
    }
  }

  function closeDrawer() {
    if (!drawer) return;
    /* Anything revealed inside the drawer goes back behind its mask on the way
       out. A revealed field left alive in a detached node would come back on
       screen the next time the drawer opened. */
    clearReveals();
    document.removeEventListener('keydown', onDrawerKey, true);
    document.removeEventListener('focusin', onDrawerFocus, true);
    setBackgroundInert(false);
    drawer.remove();
    drawer = null;
    if (drawerScrim) { drawerScrim.remove(); drawerScrim = null; }
    if (drawerReturnFocus && document.contains(drawerReturnFocus)) drawerReturnFocus.focus();
    drawerReturnFocus = null;
  }

  function tabPanel(id, labelledBy, selected) {
    var panel = h('div', {
      className: 'mt', role: 'tabpanel', id: id, 'aria-labelledby': labelledBy, tabindex: '0'
    });
    panel.hidden = !selected;
    return panel;
  }

  function openDrawer(detail) {
    closeDrawer();
    drawerReturnFocus = document.activeElement;

    drawerScrim = h('div', { className: 'scrim is-open' });
    drawerScrim.addEventListener('click', function () { closeDrawer(); });
    document.body.appendChild(drawerScrim);

    drawer = h('aside', {
      className: 'drawer is-open', role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': 'drawerTitle'
    });

    var head = h('div', { className: 'drawer-head' });
    var titleWrap = h('div', { className: 'drawer-title' });
    var titleRow = h('div', { className: 'row row-wrap' });
    titleRow.appendChild(h('h2', { className: 'mono strong', id: 'drawerTitle', text: detail.reference }));
    titleRow.appendChild(stateBadge(detail.state));
    titleRow.appendChild(tierBadge(detail.tier));
    titleWrap.appendChild(titleRow);
    titleWrap.appendChild(h('p', {
      className: 'small muted',
      text: (detail.kind === 'coach' ? 'Coach account' : 'Athlete account') +
        (detail.memberSince ? ', member since ' + (dateOnly(detail.memberSince) || detail.memberSince) : '')
    }));
    head.appendChild(titleWrap);

    var close = h('button', { className: 'icon-btn', type: 'button', 'aria-label': 'Close the account record' });
    close.appendChild(icon('close'));
    close.addEventListener('click', function () { closeDrawer(); });
    head.appendChild(close);
    drawer.appendChild(head);

    var body = h('div', { className: 'drawer-body stack' });

    var opened = h('div', { className: 'callout callout-info' });
    opened.appendChild(icon('lock'));
    opened.appendChild(h('div', {
      text: 'You are viewing the masked record. Opening it has already been recorded. Revealing ' +
        'any single field needs its own reason and is recorded by field name.'
    }));
    body.appendChild(opened);

    var TABS = [
      { key: 'account', label: 'Account' },
      { key: 'devices', label: 'Devices' },
      { key: 'billing', label: 'Billing' },
      { key: 'access', label: 'Who looked' }
    ];

    var list = h('div', { className: 'tabs', role: 'tablist', 'aria-label': 'Account record sections' });
    var panels = h('div');

    TABS.forEach(function (t, i) {
      var tabId = 'drawerTab-' + t.key;
      var panelId = 'drawerPanel-' + t.key;
      var tab = h('button', {
        className: '', type: 'button', role: 'tab', id: tabId,
        'aria-controls': panelId, 'aria-selected': String(i === 0), text: t.label
      });
      list.appendChild(tab);

      var panel = tabPanel(panelId, tabId, i === 0);
      if (t.key === 'account') panel.appendChild(accountPanel(detail));
      if (t.key === 'devices') panel.appendChild(devicesPanel(detail));
      if (t.key === 'billing') panel.appendChild(billingPanel(detail));
      if (t.key === 'access') panel.appendChild(accessPanel(detail));
      panels.appendChild(panel);
    });

    body.appendChild(list);
    body.appendChild(panels);
    drawer.appendChild(body);

    var foot = h('div', { className: 'drawer-foot' });
    foot.appendChild(h('span', {
      className: 'tiny muted',
      text: 'Everything on this page is masked by the operations API before it is sent here.'
    }));
    drawer.appendChild(foot);

    document.body.appendChild(drawer);
    setBackgroundInert(true);
    document.addEventListener('keydown', onDrawerKey, true);
    document.addEventListener('focusin', onDrawerFocus, true);
    shell.wireTabs(drawer);
    close.focus();
  }

  function accountPanel(detail) {
    var wrap = h('div');
    wrap.appendChild(fieldList(detail.reference, (detail.record && detail.record.fields) ||
      (detail.summary && detail.summary.fields) || []));
    if (detail.record && detail.record.note) {
      var box = h('div', { className: 'callout callout-warn mt' });
      box.appendChild(icon('warn'));
      box.appendChild(h('div', { text: detail.record.note }));
      wrap.appendChild(box);
    }
    return wrap;
  }

  function devicesPanel(detail) {
    var devices = detail.devices || [];
    if (!devices.length) {
      return shell.stateBlock('empty', 'No devices reported', [
        'No device on this account has reported an app version. Device level version data is ' +
          'sent by the apps themselves, so an account that has not opened one recently has none.'
      ], 3);
    }

    var wrap = h('div', { className: 'table-wrap' });
    var table = h('table', { className: 'data' });
    table.appendChild(h('caption', { className: 'sr-only', text: 'Devices on this account' }));
    table.appendChild(h('thead', {}, [
      h('tr', {}, [
        h('th', { scope: 'col', text: 'Device' }),
        h('th', { scope: 'col', text: 'App version' }),
        h('th', { scope: 'col', text: 'OS' }),
        h('th', { scope: 'col', text: 'Last seen' })
      ])
    ]));
    var tbody = h('tbody');
    devices.forEach(function (d) {
      tbody.appendChild(h('tr', {}, [
        h('th', { scope: 'row', className: 'cell-strong', text: d.label || 'Unnamed device' }),
        h('td', { className: 'mono', text: d.appVersion || 'not reported' }),
        h('td', { text: d.os || 'not reported' }),
        h('td', { className: 'mono', text: ago(d.lastSeenAt) || 'not reported' })
      ]));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function billingPanel(detail) {
    var billing = detail.billing;
    if (!billing || !(billing.fields || []).length) {
      return shell.stateBlock('empty', 'No billing record', [
        'This account has no subscription record. On the free tier that is the expected answer ' +
          'rather than a missing one.'
      ], 3);
    }
    var wrap = h('div');
    wrap.appendChild(fieldList(detail.reference, billing.fields));
    var box = h('div', { className: 'callout mt' });
    box.appendChild(icon('info'));
    box.appendChild(h('div', {
      className: 'small',
      text: 'Tier is read from the subscription record, which is the single source of truth. ' +
        'An expired period end resolves to free regardless of any cached state elsewhere.'
    }));
    wrap.appendChild(box);
    return wrap;
  }

  /* The access record, per account. This is the tab that makes the rest of the
     pane defensible: it is built so that it would be safe to show the athlete
     whose account it belongs to. */
  function accessPanel(detail) {
    var access = detail.access;
    var wrap = h('div');

    var head = h('div', { className: 'sec-head' });
    head.appendChild(h('h3', { className: 'sec-title', text: 'Who has looked at this account' }));
    if (access && access.windowDays) {
      head.appendChild(h('span', { className: 'sec-hint', text: 'Last ' + access.windowDays + ' days' }));
    }
    wrap.appendChild(head);

    var entries = (access && access.entries) || [];
    if (!entries.length) {
      wrap.appendChild(shell.stateBlock('empty', 'No recorded access', [
        access
          ? 'Nobody has opened this account inside the retention window, including you until this ' +
            'lookup is written.'
          : 'The operations API did not report an access record for this account.'
      ], 4));
      return wrap;
    }

    var tableWrap = h('div', { className: 'table-wrap' });
    var table = h('table', { className: 'data' });
    table.appendChild(h('caption', { className: 'sr-only', text: 'Recorded access to this account' }));
    table.appendChild(h('thead', {}, [
      h('tr', {}, [
        h('th', { scope: 'col', text: 'When' }),
        h('th', { scope: 'col', text: 'Who' }),
        h('th', { scope: 'col', text: 'Fields' }),
        h('th', { scope: 'col', text: 'Reason' })
      ])
    ]));
    var tbody = h('tbody');
    entries.forEach(function (e) {
      var fields = h('td', { className: 'tiny' });
      if (e.revealed) fields.appendChild(h('span', { className: 'reveal-note', text: e.fields || 'field revealed' }));
      else fields.appendChild(h('span', { text: e.fields || 'summary only' }));

      tbody.appendChild(h('tr', {}, [
        h('th', { scope: 'row', className: 'mono', text: whenLabel(e.occurredAt) || 'not reported' }),
        h('td', { text: e.actor || 'not reported' }),
        fields,
        h('td', { className: 'tiny', text: e.reason || 'no reason recorded' })
      ]));
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    wrap.appendChild(tableWrap);

    var box = h('div', { className: 'callout callout-info mt' });
    box.appendChild(icon('info'));
    box.appendChild(h('div', {
      className: 'small',
      text: 'The athlete can ask for this record. Building it so that it is safe to show them is ' +
        'what keeps the rest of this pane defensible.'
    }));
    wrap.appendChild(box);
    return wrap;
  }

  /* ------------------------------------------------------------- states */

  function idleState() {
    var card = h('div', { className: 'card' });
    card.appendChild(shell.stateBlock('search', 'Nothing looked up yet', [
      'Enter an exact email, user id, or support reference above, with the reason you are ' +
        'looking. This pane has no list of accounts to start from, on purpose.'
    ]));
    return card;
  }

  function noMatchState() {
    var card = h('div', { className: 'card' });
    card.appendChild(shell.stateBlock('search', 'No account matches that identifier', [
      'Nothing matched the email, id, or reference you typed. Near matches are never returned, ' +
        'so a wrong guess cannot be used to find out who has an account.',
      'That is a real answer rather than a failed one: the operations API looked and found nothing.'
    ]));
    return card;
  }

  function skeleton() {
    var stack = h('div', { className: 'stack' });
    stack.appendChild(h('div', { className: 'card' }, [
      h('div', { className: 'card-body' }, [
        h('div', { className: 'skel skel-row', 'aria-hidden': 'true' }),
        h('div', { className: 'skel skel-row', 'aria-hidden': 'true' }),
        h('div', { className: 'skel skel-row', 'aria-hidden': 'true' })
      ])
    ]));
    return stack;
  }

  function errorState(err, retry) {
    var card = h('div', { className: 'card' });
    var missing = err && err.code === 'ops_route_missing';
    var block = missing
      ? shell.stateBlock('build', 'This pane has no API yet', [
        'The operations API does not answer the account lookup routes on this deployment. The ' +
          'page is built and is asking for the right thing; the endpoints behind it have not shipped.',
        'Nothing has been recorded, because nothing was looked up.'
      ])
      : shell.stateBlock('warn', 'Could not look that up', [
        (err && err.message) || 'The operations API did not answer.',
        'Nothing has been signed out.'
      ]);

    if (retry) {
      var row = h('div', { className: 'row mt' });
      var again = h('button', { className: 'btn btn-primary', type: 'button', text: 'Try again' });
      again.addEventListener('click', retry);
      row.appendChild(again);
      block.appendChild(row);
    }
    card.appendChild(block);
    return card;
  }

  /* ------------------------------------------------------------ wiring */

  var content = null;
  var resultRegion = null;
  var lastResult = null;
  var selectedRef = null;
  var scope = 'all';
  var seq = 0;

  function paintResult(node) {
    if (!resultRegion) return;
    resultRegion.textContent = '';
    if (node) resultRegion.appendChild(node);
  }

  function runLookup() {
    var identifier = (identifierInput.value || '').trim();
    var reason = (reasonInput.value || '').trim();

    if (!identifier) {
      setFormError('Enter an exact email, user id, or support reference.');
      identifierInput.setAttribute('aria-invalid', 'true');
      identifierInput.focus();
      return;
    }
    if (reason.length < 3) {
      setFormError('Give a reason. It is written to the access record beside your name.');
      reasonInput.setAttribute('aria-invalid', 'true');
      reasonInput.focus();
      return;
    }
    setFormError(null);

    /* A new search starts from a clean screen: nothing revealed carries over
       into a different account's record. */
    clearReveals();
    closeDrawer();
    selectedRef = null;

    var mine = ++seq;
    resultRegion.setAttribute('aria-busy', 'true');
    paintResult(skeleton());

    session.call('/api/ops/users/lookup', {
      method: 'POST',
      body: {
        identifier: identifier,
        reason: reason,
        scope: scope,
        state: stateSelect.value || undefined,
        tier: tierSelect.value || undefined
      }
    }).then(function (payload) {
      if (mine !== seq) return;
      resultRegion.removeAttribute('aria-busy');
      lastResult = (payload && payload.data) || {};
      renderResult();
    }).catch(function (err) {
      if (mine !== seq) return;
      resultRegion.removeAttribute('aria-busy');
      lastResult = null;
      paintResult(errorState(err, runLookup));
    });
  }

  function renderResult() {
    if (!lastResult) return;
    var matches = lastResult.matches || [];

    var stack = h('div', { className: 'stack' });
    var recorded = recordedCallout(lastResult.recorded);
    if (recorded) stack.appendChild(recorded);

    if (!matches.length) {
      stack.appendChild(noMatchState());
      paintResult(stack);
      shell.announce('No account matches that identifier');
      return;
    }

    var grid = h('div', { className: 'grid g-main-b' });
    grid.appendChild(matchesCard(lastResult, selectAccount, selectedRef));

    var side = h('div', { className: 'stack', id: 'accountColumn' });
    side.appendChild(h('div', { className: 'card' }, [
      shell.stateBlock('users', 'Pick an account', [
        'Choose one of the matches to see its summary, its recent activity, and who has looked ' +
          'at it. Opening one is itself recorded.'
      ], 3)
    ]));
    grid.appendChild(side);
    stack.appendChild(grid);
    paintResult(stack);

    shell.announce(matches.length === 1 ? '1 account matched' : matches.length + ' accounts matched');

    /* One match is not a choice, so it is opened rather than offered. */
    if (matches.length === 1) selectAccount(matches[0].reference);
  }

  function selectAccount(reference) {
    selectedRef = reference;
    clearReveals();

    var column = document.getElementById('accountColumn');
    if (!column) return;
    column.textContent = '';
    column.appendChild(h('div', { className: 'card' }, [
      h('div', { className: 'card-body' }, [
        h('p', { className: 'sr-only', role: 'status', text: 'Loading account record' }),
        h('div', { className: 'skel skel-row', 'aria-hidden': 'true' }),
        h('div', { className: 'skel skel-row', 'aria-hidden': 'true' })
      ])
    ]));

    var mine = ++seq;
    session.call('/api/ops/users/' + encodeURIComponent(reference)).then(function (payload) {
      if (mine !== seq) return;
      var detail = (payload && payload.data) || {};
      detail.reference = detail.reference || reference;

      /* Redraw the matches so the selected row is marked, then fill the
         column beside it. */
      renderSelectedRow();
      var col = document.getElementById('accountColumn');
      if (!col) return;
      col.textContent = '';
      col.appendChild(summaryCard(detail, function () { openDrawer(detail); }));
      col.appendChild(activityCard(detail));
      col.appendChild(supportCard(detail));
      shell.announce('Account ' + detail.reference + ' opened and recorded');
    }).catch(function (err) {
      if (mine !== seq) return;
      var col = document.getElementById('accountColumn');
      if (!col) return;
      col.textContent = '';
      col.appendChild(errorState(err, function () { selectAccount(reference); }));
    });
  }

  function renderSelectedRow() {
    if (!resultRegion) return;
    Array.prototype.forEach.call(resultRegion.querySelectorAll('.match-row-btn'), function (btn) {
      var on = btn.getAttribute('data-ref') === selectedRef;
      btn.setAttribute('aria-pressed', String(on));
      var row = btn.parentNode && btn.parentNode.parentNode;
      if (row && row.tagName === 'TR') row.className = on ? 'is-selected' : '';
    });
  }

  var started = false;

  function begin() {
    if (started) return;
    started = true;
    content = document.getElementById('content');
    if (!content) return;

    scope = shell.filters().scope || 'all';
    content.textContent = '';
    var stack = h('div', { className: 'stack' });
    stack.appendChild(privacyBar());
    stack.appendChild(searchCard(runLookup));

    resultRegion = h('div', { className: 'stack', id: 'lookupResult' });
    resultRegion.appendChild(idleState());
    stack.appendChild(resultRegion);
    content.appendChild(stack);
  }

  global.addEventListener('ops:ready', function (e) {
    if (!e.detail || e.detail.pane !== 'users') return;
    begin();
  });

  global.addEventListener('ops:filters', function (e) {
    if (!started || !e.detail) return;
    var next = e.detail.scope || 'all';
    if (next === scope) return;
    scope = next;
    /* Refiltering is a new lookup, and a new lookup is a new access record, so
       it is not run behind the operator's back. */
    if (lastResult) {
      paintResult(h('div', { className: 'card' }, [
        shell.stateBlock('search', 'App filter changed', [
          'The App filter is part of the query, and running it again writes another access ' +
            'record, so it is not run for you. Look up again when you are ready.'
        ])
      ]));
      lastResult = null;
      selectedRef = null;
      closeDrawer();
    }
  });

  /* The shell dispatches ops:ready from a promise callback, which the parser
     can run while it is still fetching this file, so the event can be gone
     before the listener above exists. OpsShell.ready() is the same fact
     recorded rather than announced, and begin() is idempotent. */
  if (shell.ready()) begin();
})(window);
