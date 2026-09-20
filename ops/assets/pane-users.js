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
        moment, when a new account is opened, and when a new search starts.
     4. Health data has no reveal control at all. Not a disabled one, not one
        that asks for a stronger role: the field carries no control, because a
        control that can never succeed still tells an operator that the value
        is somewhere within reach.

   Activity is a list of events and never their content. "Chat session, 8
   messages" is a fact about the service; what was said is not this pane's to
   show, at any role.

   THE SIX PROMISES THIS PANE MAKES TO THE ATHLETE, and where each is on screen

   They are the reason the pane is shaped the way it is, so each one is a
   sentence somebody can read rather than a property of the code:

     1. personal fields are hidden for every role, the owner included, until a
        reveal is recorded   -> the privilege strip, and the account card foot
     2. a reveal is owner only and needs a written reason
                             -> the reveal band note, the reason box itself,
                                and the disabled control a non-owner gets
     3. a reveal is recorded by field name, never by value
                             -> the reveal band note and the note a landed
                                reveal leaves beside the value
     4. the athlete can see that it happened and who did it
                             -> the privilege strip, and the access band
     5. reveal records outlive the reveal and cannot be erased by one
                             -> the access band foot
     6. request and reply content is not shown here, at any role
                             -> the activity card foot

   scripts/ops-users-v2.test.mjs asserts all six are present, and asserts the
   mechanism behind each separately from the sentence, because a sentence that
   outlives the thing it describes is the worse of the two failures.

   WHAT THIS PANE READS

   Every field below is what the code actually consumes, because this contract
   is the only specification a backend author has for these three routes. The
   routes are unchanged by the v2 remodel: this file draws the same answers
   differently.

     POST /api/ops/users/lookup
       { identifier, reason, scope, state, tier }
       -> { data: { recorded, matchCount, matches[] } }

       recorded    { at, actor, fields, reason }: the access record this
                   request wrote. Its absence is reported on screen rather
                   than assumed away, because "every lookup is recorded" is a
                   promise this page makes to the athlete.
       matchCount  how many accounts matched. matches[] must be the whole of
                   that set: a capped array beside an uncapped count would
                   have the header name accounts the operator cannot see, and
                   would breach "no bulk listing" quietly. If the two ever
                   disagree the pane says so rather than picking one.
       matches[]   { reference, maskedEmail, state, tier, platforms[],
                     lastActiveAt, flags[] }
         state       { key, label, tone }, tone one of ok, warn, crit, info
         tier        { key, label, brand }
         platforms[] { key, label }, key 'coaches' tags differently
         flags[]     { key, label, tone }

     GET /api/ops/users/{reference}
       -> { data: { reference, kind, state, tier, memberSince, recorded,
                    summary{fields[]}, record{fields[], note},
                    activity{windowDays, events[]}, devices[],
                    billing{fields[]}, access{windowDays, entries[]},
                    supportActions{available[]} } }

       kind        'coach' or 'athlete'
       recorded    as above, for the record this request wrote
       record      the fuller field list, falling back to summary.fields when
                   it is absent
       events[]    { occurredAt, label, tone, reference, href }: a list of
                   events and never their content. href is followed only when
                   it stays on this origin, so it cannot become an off-site
                   destination reached from a privacy pane.
       devices[]   { label, appVersion, os, lastSeenAt }
       access.entries[] { occurredAt, actor, fields, reason, revealed }
       supportActions.available[] { key, label }

     POST /api/ops/users/{reference}/reveal
       { field, reason }
       -> { data: { field, value, expiresAt, recorded } }

       expiresAt   when the value stops being shown. A response that omits it,
                   or sends something unreadable, does not buy an indefinite
                   reveal: this file applies REVEAL_CEILING_MS instead and
                   says on screen that it did.

   The identifier is sent in a body rather than a querystring on purpose: it is
   the one value in this dashboard most likely to be somebody's email address,
   and a querystring is the part of a request that ends up in access logs,
   proxy logs, and browser history. A lookup also writes an access record, so a
   POST is what it is.

   THE FIELD SHAPE, and the one rule inside it that carries weight

   Every field list on this pane, summary.fields[], record.fields[] and
   billing.fields[], carries entries of

     { key, label, masked, maskedValue, value, reveal,
       neverShownNote, unavailableNote }

     masked       true, or absent, means the value is personal and is not in
                  this payload. Only an explicit false says otherwise, and
                  only then may value appear. The two never travel together:
                  an entry carrying both a real value and a mask is
                  contradictory rather than unmasked, and this file reads it
                  as masked. Rule 2 above is only true if the payload for a
                  masked field never contains the real value at all, so the
                  shape has to make that statable, and this is how.
     maskedValue  what to show while it is masked, already masked by the API.
     reveal       'allowed', 'never', or 'unavailable'. Anything else, and
                  anything absent, draws no control. 'never' also dominates
                  masked: false, for the same reason a mask beside a value
                  does: the two are not supposed to travel together, so an
                  entry carrying both is contradictory rather than unmasked.
                  Health field keys are always 'never'; the client refuses
                  them a control and refuses to print them in the clear
                  whatever the API says, because a server that gets rule 4
                  wrong should not be able to make this page the place it
                  goes wrong.
     neverShownNote / unavailableNote
                  the sentence shown in place of a control.

   WHAT THE V2 REMODEL CHANGED, and what it deliberately did not

   The drawer is gone. Four tabs behind a "Full record" button held the fuller
   field list, the devices, the billing record and the access record, and the
   access record is the one thing on this pane that makes the rest of it
   defensible. It is a band on the page now, so "who has looked at this
   account" is read without asking for it.

   Nothing about the reveal flow moved. fieldValue below is the same function,
   with the same three floors under the API's decision, because every one of
   them was put there by a defect that had already shipped once.

   The danger zone is stated and not drawn as controls. The mock carries four
   account actions behind re-authentication; the operations API has no route
   that performs one, so this pane draws the rows, says re-authentication is
   required, and draws no button. A control that cannot succeed is worse than
   no control, and hiding the section entirely would only make people ask
   whether it exists. */
(function (global) {
  'use strict';

  var shell = global.OpsPaneShell;
  var session = global.OpsSession;
  var h = shell.h;
  var icon = shell.icon;

  var TONE_ICON = { ok: 'check', warn: 'warn', crit: 'warn', info: 'info' };
  var TONE_PILL = { ok: 'up', warn: 'warn', crit: 'down', info: 'info' };

  /* Field keys that are health data. Rule 4 puts these out of reach at every
     role, and the operations API is what decides which fields those are: it is
     supposed to send every one of them with reveal 'never'.

     This list is a floor under that decision and not a second authority, and
     the difference is worth being exact about because the copy on the page has
     to be true of the weaker of the two claims. It is deliberately not
     exhaustive and cannot be: a health field whose key is not on it is refused
     by the API's own 'never', which is the mechanism that actually holds. What
     the list adds is that a key on it gets no control and is never printed in
     the clear whatever the payload says, so a server that got rule 4 wrong for
     one of these could not make this page the place it went wrong. Nothing on
     screen claims more than that. */
  var HEALTH_KEYS = {
    weight: 1, height: 1, bodyFat: 1, body_fat: 1,
    injury: 1, injuries: 1, injuryHistory: 1, injury_history: 1,
    healthNotes: 1, health_notes: 1, journal: 1, journalEntry: 1,
    menstrualCycle: 1, menstrual_cycle: 1, sleep: 1, restingHeartRate: 1,
    resting_heart_rate: 1
  };

  /* A reveal that never expires is a disclosure, not a reveal. The window is
     the server's to choose and arrives as expiresAt; when it does not arrive,
     or cannot be read, this ceiling applies instead. It is deliberately short,
     because the failure it covers is a server that forgot to say, and the safe
     reading of silence is "not for long". The cap covers the other end: an
     expiry far enough in the future is indefinite in every way that matters on
     a screen somebody walks away from. */
  var REVEAL_CEILING_MS = 60000;
  var REVEAL_MAX_MS = 900000;

  /* --------------------------------------------------------- formatting */

  /* Emptying a container. `node.textContent = ''` is the one-liner for this in
     a browser and it is not used anywhere in this file, because it is a
     property assignment whose child-removing side effect only a real DOM has:
     a test stub that models textContent as a plain field reports the container
     as empty while every stale node is still under it, and a test reading the
     result would be reading a screen nobody has. assets/shell-pane-v2.js
     clears the same way. */
  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function isHealthKey(key) {
    return !!(key && Object.prototype.hasOwnProperty.call(HEALTH_KEYS, key));
  }

  /* An API supplied link is followed only when it stays on this origin. The
     dashboard's own panes are the only destination one is ever meant to name,
     and an off-site href on a pane that has somebody's account open leaks the
     referrer along with the fact that it was being looked at. Anything else,
     including a scheme this file does not recognise, renders as plain text
     instead of a link. */
  function safeHref(href) {
    if (typeof href !== 'string' || !href) return null;
    try {
      var url = new URL(href, global.location.href);
      if (url.origin !== global.location.origin) return null;
      return url.pathname + url.search + url.hash;
    } catch (e) { return null; }
  }

  /* Total by construction. Every caller renders "not reported" from null, and
     one of them is the reveal expiry, where a throw would be a privacy bug
     rather than a formatting one: it would land after the value was already on
     screen and before the timer was armed and the entry was pushed onto the
     re-mask registry, leaving a revealed field that nothing would ever hide.
     So a time that arrives as an object, an array, or anything else the Date
     constructor would coerce through its own toString leaves by the null door.
     A string or a number is the only shape the three routes document. */
  function parseTime(iso) {
    if (typeof iso !== 'string' && typeof iso !== 'number') return null;
    if (iso === '') return null;
    var t;
    try { t = new Date(iso).getTime(); } catch (e) { return null; }
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

  /* A count and its noun, agreeing.

     Every number on this pane comes from the answer, so every one of them can
     be one: a lookup that matched a single account, a window a day long. "1
     accounts" is the same defect the countdown below already guards against,
     read by somebody deciding whether they are looking at a whole list. */
  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
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

  /* ------------------------------------------------------- small pieces */

  /* A status, never as colour alone: every pill carries a glyph or a word that
     says the same thing the colour does. */
  function pill(tone, text, iconName) {
    var p = h('span', { className: 'pill' + (tone ? ' ' + tone : '') });
    if (iconName) p.appendChild(icon(iconName));
    p.appendChild(h('span', { text: text }));
    return p;
  }

  function tonePill(tone, text) {
    return pill(TONE_PILL[tone] || '', text, TONE_ICON[tone]);
  }

  function stateePill(state) {
    if (!state) return pill('', 'State not reported', 'info');
    return tonePill(state.tone, state.label || state.key || 'Unknown');
  }

  function tierPill(tier) {
    if (!tier) return pill('', 'Tier not reported', 'info');
    return pill(tier.brand ? 'acc' : '', tier.label || tier.key || 'Unknown');
  }

  function code(text) {
    return h('span', { className: 'code', text: text });
  }

  /* The recording confirmation. It appears after a request rather than before
     it, because it reports something that has already happened: this is the
     row the athlete would be shown if they asked.

     When the response does not carry one, the surface says so. The privilege
     strip above states that every lookup is recorded, and a response that
     stayed silent about it is the one case where that sentence might not be
     true. Looking identical either way would make the promise unfalsifiable,
     so this returns a warning rather than nothing. */
  function recordingNotice(recorded, what) {
    /* what names the thing that was recorded, and both sentences are built
       from it. The confirmed branch used to be the word "lookup" hard coded,
       so opening an account, which is its own access record, was reported as
       "This lookup is on the record" on the column beside the matches. */
    var subject = what || 'this request';
    var Subject = subject.charAt(0).toUpperCase() + subject.slice(1);

    if (!recorded) {
      var warn = h('div', { className: 'note note-warn' });
      warn.appendChild(icon('warn'));
      var wbody = h('div');
      wbody.appendChild(h('b', { text: 'No record was confirmed.' }));
      wbody.appendChild(document.createTextNode(
        ' The operations API handled ' + subject + ' without confirming an access record. ' +
        'Treat it as unrecorded until the access record shows otherwise.'
      ));
      warn.appendChild(wbody);
      return warn;
    }

    var box = h('div', { className: 'note' });
    box.appendChild(icon('lock'));
    var body = h('div');
    body.appendChild(h('b', { text: Subject + ' is on the record.' }));
    var parts = [];
    if (recorded.at) parts.push('at ' + (dateTime(recorded.at) || recorded.at));
    if (recorded.actor) parts.push('by ' + recorded.actor);
    if (recorded.fields) parts.push('as ' + recorded.fields);
    if (recorded.reason) parts.push('reason ' + recorded.reason);
    body.appendChild(document.createTextNode(
      parts.length ? ' Written ' + parts.join(', ') + '.' : ' Written, without the details being reported.'
    ));
    box.appendChild(body);
    return box;
  }

  /* --------------------------------------------------- the privilege strip

     Promise 1 and promise 4, as pills, at the top of the pane. The registry
     gives this pane an App filter and nothing else, so this is not the filter
     bar restated: it is what the signed-in role may do here. */
  function privilegeStrip() {
    var strip = h('div', { className: 'privilege' });
    strip.appendChild(pill(isOwner() ? 'vio' : '', isOwner() ? 'Owner' : 'Not an owner', 'lock'));
    strip.appendChild(pill('', 'Personal fields hidden until revealed', 'eye'));
    strip.appendChild(pill('', 'Every reveal is visible to the athlete', 'person'));
    return strip;
  }

  /* --------------------------------------------------------- the search */

  var form = null;
  var identifierInput = null;
  var reasonInput = null;
  var stateSelect = null;
  var tierSelect = null;
  var formError = null;

  function selectControl(id, label, options) {
    var sel = h('select', { id: id, 'aria-label': label });
    options.forEach(function (o) {
      sel.appendChild(h('option', { value: o.v, text: o.l }));
    });
    var wrap = h('div', { className: 'sel' }, [sel, icon('chev')]);
    return wrap;
  }

  function huntPanel(onSubmit) {
    var panel = h('section', { className: 'hunt', 'aria-labelledby': 'huntTitle' });
    panel.appendChild(h('h2', { className: 'hunt-title', id: 'huntTitle', text: 'Find one account' }));
    panel.appendChild(h('p', {
      className: 'hunt-sub',
      text: 'Exact identifier only. Near matches are never returned.'
    }));

    form = h('form', { className: 'hunt-form', novalidate: 'novalidate' });

    identifierInput = h('input', {
      id: 'lookupIdentifier', type: 'text',
      autocomplete: 'off', spellcheck: 'false',
      'aria-label': 'Identifier',
      placeholder: 'Coded reference, email address, or support ticket'
    });
    var idField = h('div', { className: 'field field-lg' }, [icon('search'), identifierInput]);

    var submit = h('button', { className: 'btn btn-primary', type: 'submit' });
    submit.appendChild(icon('search'));
    submit.appendChild(h('span', { text: 'Look up' }));

    form.appendChild(h('div', { className: 'hunt-line' }, [idField, submit]));

    reasonInput = h('input', {
      id: 'lookupReason', type: 'text', autocomplete: 'off',
      'aria-label': 'Reason for this lookup',
      placeholder: 'Reason, written to the access record beside your name'
    });
    var stateSel = selectControl('lookupState', 'State', [
      { v: '', l: 'Any state' },
      { v: 'active', l: 'Active' },
      { v: 'payment_failed', l: 'Payment failed' },
      { v: 'deletion_requested', l: 'Deletion requested' },
      { v: 'suspended', l: 'Suspended' }
    ]);
    stateSelect = stateSel.querySelector('select');

    var tierSel = selectControl('lookupTier', 'Tier', [
      { v: '', l: 'Any tier' },
      { v: 'free', l: 'Free' },
      { v: 'pro', l: 'Pro' },
      { v: 'coach_team', l: 'Coach team' }
    ]);
    tierSelect = tierSel.querySelector('select');

    form.appendChild(h('div', { className: 'hunt-line' }, [
      h('div', { className: 'field' }, [icon('history'), reasonInput]),
      stateSel,
      tierSel
    ]));

    formError = h('p', { className: 'field-error', role: 'alert' });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      onSubmit();
    });

    panel.appendChild(form);
    panel.appendChild(formError);
    return panel;
  }

  /* The invalid marks are cleared on every pass, not only when the message is
     cleared, and the caller then marks the one field it is complaining about.
     Clearing only on success left aria-invalid="true" on an identifier that
     had since been filled in, so a screen reader was told the wrong control
     was the problem. */
  function setFormError(message) {
    if (!formError) return;
    clear(formError);
    if (identifierInput) identifierInput.removeAttribute('aria-invalid');
    if (reasonInput) reasonInput.removeAttribute('aria-invalid');
    if (!message) return;
    formError.appendChild(icon('warn'));
    formError.appendChild(h('span', { text: message }));
  }

  /* --------------------------------------------------------- match list */

  function matchesCard(data, onPick, selectedRef) {
    var box = shell.card();
    var rows = (data.matches || []).length;
    /* The count and the rows are two numbers for the same thing, so the header
       states the one that is on screen. A server that ever capped the array
       while leaving the count whole would otherwise have this header name
       accounts the operator cannot see, which is the "no bulk listing" rule
       breached without anybody being told. Saying both is the honest reading
       of a payload that contradicts itself. */
    var claimed = typeof data.matchCount === 'number' && isFinite(data.matchCount)
      ? data.matchCount : null;
    var short = claimed !== null && claimed > rows;

    box.appendChild(shell.cardHead(
      'Accounts matching that reference',
      short
        ? rows + ' of ' + plural(claimed, 'account') + ' shown'
        : plural(rows, 'account'),
      [pill('', 'Details hidden', 'lock')]
    ));

    if (short) {
      var capped = h('div', { className: 'note note-warn' });
      capped.appendChild(icon('warn'));
      capped.appendChild(h('div', {
        text: 'The operations API says ' + plural(claimed, 'account') + ' matched but sent ' + rows +
          '. The rest are not on this page and cannot be asked for. Narrow the identifier.'
      }));
      box.appendChild(h('div', { className: 'card-body' }, [capped]));
    }

    var wrap = h('div', { className: 'tbl-wrap' });
    var table = h('table', { className: 'tbl' });
    table.appendChild(h('caption', { className: 'sr', text: 'Accounts matching the identifier you entered' }));

    table.appendChild(h('thead', {}, [
      h('tr', {}, [
        h('th', { scope: 'col', text: 'Account' }),
        h('th', { scope: 'col', text: 'State' }),
        h('th', { scope: 'col', text: 'Tier' }),
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
        className: 'btn btn-ghost btn-sm match-row-btn', type: 'button',
        'data-ref': m.reference,
        'aria-pressed': String(m.reference === selectedRef)
      });
      pick.appendChild(code(m.reference));
      pick.appendChild(h('span', { className: 'sr', text: ', open this account' }));
      pick.addEventListener('click', function () { onPick(m.reference); });

      var cell = h('th', { scope: 'row' });
      cell.appendChild(pick);
      if (m.maskedEmail) {
        cell.appendChild(h('div', { className: 't-sub' }, [
          h('span', { className: 'locked' }, [icon('lock'), h('span', { text: m.maskedEmail })])
        ]));
      }
      tr.appendChild(cell);

      tr.appendChild(h('td', {}, [stateePill(m.state)]));
      tr.appendChild(h('td', {}, [tierPill(m.tier)]));
      tr.appendChild(h('td', { className: 'num dim', text: ago(m.lastActiveAt) || 'not reported' }));

      var flags = h('td');
      (m.flags || []).forEach(function (f) { flags.appendChild(tonePill(f.tone, f.label || f.key)); });
      if (!(m.flags || []).length) flags.appendChild(h('span', { className: 'muted tiny', text: 'none' }));
      tr.appendChild(flags);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    box.appendChild(wrap);

    box.appendChild(h('div', { className: 'card-foot' }, [
      icon('lock'),
      h('span', { text: 'The part-hidden email is masked by the operations API, not by this page.' })
    ]));
    return box;
  }

  /* ------------------------------------------------------ field reveal */

  /* Every revealed field on screen, so that one call re-masks all of them:
     opening another account, running a new search, or an expiry falling due. */
  var revealed = [];

  /* Reveals whose request is still out. Abandoning the screen has to abandon
     these too: a response landing afterwards would push an entry onto
     revealed and arm a timer against a node that is no longer in the
     document, and that timer would later announce that a field nobody can see
     has hidden itself. */
  var pending = [];

  function clearReveals() {
    pending.splice(0, pending.length).forEach(function (token) { token.cancelled = true; });
    revealed.slice().forEach(function (entry) { entry.hide(); });
    revealed = [];
  }

  function dropPending(token) {
    var at = pending.indexOf(token);
    if (at !== -1) pending.splice(at, 1);
  }

  function isOwner() { return session.hasRole(['owner']); }

  /* Where focus goes when the thing holding it is about to be hidden or
     detached. #content carries tabindex="-1" for exactly this, and it is a
     better answer than document.body, which announces nothing. */
  function focusFallback() {
    var main = document.getElementById('content');
    if (main) main.focus();
  }

  /* One field row. Which shape is drawn is the API's decision, with two
     floors under it that this file will not let the API cross:

       masked absent or true  masked, whatever else the entry carries
       reveal 'never'         no control at all, and a line saying so
       reveal 'unavailable'   no control, and the reason there is none
       reveal 'allowed'       a control that asks for a written reason first
       a health key           treated as 'never' regardless of what arrived */
  function fieldValue(reference, field) {
    var row = h('div', { className: 'reveal-row' });
    var health = isHealthKey(field.key);

    /* Masked by default, and the default is what a missing flag gets. The
       earlier test here was falsy rather than an equality, so an entry whose
       masked flag was absent, null or 0 while value was populated printed the
       real value in the clear, with no reveal control, no reason, and no
       per-field access record, at every role, because this return sat above
       the owner gate below. Only an explicit false unmasks a field now, and
       an entry that carries a mask as well is contradictory rather than
       unmasked, so it is read as masked too. A health key is never unmasked
       here whatever the payload says.

       The mask half of that is a test of presence, not of truthiness. What
       makes an entry contradictory is carrying a maskedValue at all beside
       masked: false, and an empty string is carrying one: it is a mask the API
       built and got wrong, which is a reason to trust the entry less rather
       than a reason to print the real value. A falsy test read `maskedValue:
       ""` as no mask and unmasked the field.

       `reveal: 'never'` is the same idea once more. A field the API says is
       never shown here, in the same breath as saying it is not personal, is a
       payload disagreeing with itself, and the row it draws already refuses a
       control on the strength of the 'never'. Reading the other flag as a
       licence to print the value would let the contradiction decide the
       disclosure. No such payload exists today; this is why it would not
       matter if one did. */
    var carriesMask = Object.prototype.hasOwnProperty.call(field, 'maskedValue') &&
      field.maskedValue !== null && field.maskedValue !== undefined;
    var unmaskedByDesign = field.masked === false && !carriesMask && !health &&
      field.reveal !== 'never';

    /* The mask carries the word as well as the hatching, so it is never the
       texture alone that says a value is withheld. */
    var masked = h('span', { className: 'masked locked' }, [
      icon('lock'),
      h('span', { text: field.maskedValue || 'Hidden' })
    ]);
    var shown = h('span', { className: 'reveal-value hidden' });
    var note = h('span', { className: 'reveal-note hidden' });

    /* A plain value the API said, in as many words, is not personal. */
    if (unmaskedByDesign) {
      return h('span', { className: 'reveal-value', text: field.value === null || field.value === undefined ? 'not reported' : String(field.value) });
    }

    row.appendChild(masked);
    row.appendChild(shown);
    row.appendChild(note);

    if (health || field.reveal === 'never') {
      var never = h('span', { className: 'reveal-never' });
      never.appendChild(icon('x'));
      never.appendChild(h('span', {
        text: field.neverShownNote ||
          (health ? 'Health data is never shown here' : 'Never shown here')
      }));
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

    /* Re-mask. Both ways in here hide the button that may be holding focus:
       the operator pressing "Hide again", and the expiry falling due while
       focus happens to be sitting on it. Focus left on a display:none control
       is focus nobody can see and a keyboard cannot move on from, so it goes
       back to the Reveal control in the same row. If that control has gone too,
       which is another account being opened or a new search replacing the
       container, the pane's content region takes it rather than document.body. */
    function hide() {
      if (timer) { global.clearTimeout(timer); timer = null; }
      var heldFocus = row.contains(document.activeElement);
      shown.textContent = '';
      shown.classList.add('hidden');
      note.textContent = '';
      note.classList.add('hidden');
      masked.classList.remove('hidden');
      revealBtn.classList.remove('hidden');
      hideBtn.classList.add('hidden');
      var at = revealed.indexOf(entry);
      if (at !== -1) revealed.splice(at, 1);
      if (heldFocus) {
        if (document.contains(revealBtn) && revealBtn.offsetParent !== null) revealBtn.focus();
        else focusFallback();
      }
    }

    var revealBtn = h('button', { className: 'btn btn-sm', type: 'button' });
    revealBtn.appendChild(icon('eye'));
    revealBtn.appendChild(h('span', { text: 'Reveal' }));

    var hideBtn = h('button', { className: 'btn btn-sm hidden', type: 'button', text: 'Hide again' });
    hideBtn.addEventListener('click', function () {
      hide();
      shell.announce(field.label + ' hidden again');
    });

    var reasonForm = h('form', { className: 'reveal-form hidden' });
    var reasonId = 'reveal-' + reference + '-' + field.key;
    var reasonBox = h('input', {
      id: reasonId, type: 'text', autocomplete: 'off',
      placeholder: 'Reason, recorded by field name'
    });
    var confirm = h('button', { className: 'btn btn-sm btn-primary', type: 'submit', text: 'Show ' + (field.label || field.key).toLowerCase() });
    var cancel = h('button', { className: 'btn btn-sm', type: 'button', text: 'Cancel' });
    var problem = h('span', { className: 'tiny reveal-note' });

    reasonForm.appendChild(h('label', { className: 'sr', for: reasonId, text: 'Reason for revealing ' + (field.label || field.key) }));
    reasonForm.appendChild(h('div', { className: 'field' }, [icon('history'), reasonBox]));
    reasonForm.appendChild(h('div', { className: 'row' }, [confirm, cancel, problem]));

    function closeForm(restoreFocus) {
      reasonForm.classList.add('hidden');
      reasonBox.value = '';
      clear(problem);
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
      clear(problem);

      /* Abandoning the screen while this is out cancels it. clearReveals()
         flips this token, and both callbacks below check it before touching
         anything, so a late response cannot put a value on a detached node or
         arm a timer that announces a field nobody is looking at. */
      var token = { cancelled: false };
      pending.push(token);

      session.call('/api/ops/users/' + encodeURIComponent(reference) + '/reveal', {
        method: 'POST',
        body: { field: field.key, reason: reason }
      }).then(function (payload) {
        dropPending(token);
        if (token.cancelled) return;
        confirm.disabled = false;
        var out = (payload && payload.data) || {};
        closeForm(false);

        /* The window is the server's to choose and this file's to enforce. A
           response that carries no expiresAt, or one that cannot be read, does
           not buy an indefinite reveal: the ceiling applies and the note says
           that the page picked it. A window longer than the cap is trimmed to
           the cap for the same reason, because a value still on screen an hour
           later has not un-revealed itself in any sense that matters.

           Worked out before anything is put on screen, and deliberately so.
           Every step between the value appearing and the timer being armed is
           a step in which a throw would leave a revealed field with no expiry
           and outside the re-mask registry, which is the one failure on this
           pane that cannot be recovered from by closing something. parseTime
           is total, so this is belt as well as braces. */
        var expiresAt = parseTime(out.expiresAt);
        var serverSaid = expiresAt !== null;
        var ms = serverSaid
          ? Math.max(0, Math.min(expiresAt - Date.now(), REVEAL_MAX_MS))
          : REVEAL_CEILING_MS;

        /* The reveal writes its own access record, and the response says
           whether it did. Claiming otherwise in the announcement while the
           surface beside it warns that nothing was confirmed is the same
           contradiction the lookup note exists to avoid, so the sentence on
           screen and the one a screen reader hears are both built from it. */
        var onRecord = !!out.recorded;
        var noteText = serverSaid
          ? 'Hides itself in ' + countdownLabel(ms)
          : 'Hides itself in ' + countdownLabel(ms) + ', a limit this page set because the ' +
            'response did not give one.';
        noteText += onRecord
          ? ' Recorded by field name.'
          : ' The operations API did not confirm a record for it. Treat it as unrecorded.';

        shown.textContent = out.value === null || out.value === undefined ? 'not reported' : String(out.value);
        shown.classList.remove('hidden');
        masked.classList.add('hidden');
        hideBtn.classList.remove('hidden');
        revealBtn.classList.add('hidden');

        note.textContent = noteText;
        note.classList.remove('hidden');
        timer = global.setTimeout(function () {
          hide();
          shell.announce(field.label + ' hidden again automatically');
        }, ms);

        entry = { hide: hide };
        revealed.push(entry);
        hideBtn.focus();
        shell.announce(onRecord
          ? field.label + ' revealed and recorded'
          : field.label + ' revealed, with no record confirmed');
      }).catch(function (err) {
        dropPending(token);
        if (token.cancelled) return;
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

  /* A key and value list, one field per line. The key is a <dt> and the value
     a <dd> so the pairing survives a screen reader reading down the column,
     which a pair of styled divs does not. */
  function fieldList(reference, fields) {
    var kv = h('dl', { className: 'kv' });
    (fields || []).forEach(function (f) {
      var line = h('div');
      line.appendChild(h('dt', { className: 'k', text: f.label || f.key }));
      var dd = h('dd', { className: 'v' });
      dd.appendChild(fieldValue(reference, f));
      line.appendChild(dd);
      kv.appendChild(line);
    });
    return kv;
  }

  /* -------------------------------------------------------- the account */

  /* Promise 1 lives in this card's foot, next to the fields it is about. */
  function accountCard(detail) {
    var box = shell.card();
    var kind = detail.kind === 'coach' ? 'Coach' : 'Athlete';
    box.appendChild(shell.cardHead('Account', null, [
      code(detail.reference),
      stateePill(detail.state),
      tierPill(detail.tier)
    ]));

    var body = h('div', { className: 'card-body' });
    var facts = h('dl', { className: 'kv' });
    facts.appendChild(h('div', {}, [
      h('dt', { className: 'k', text: 'Kind' }),
      h('dd', { className: 'v dim', text: kind })
    ]));
    if (detail.memberSince) {
      facts.appendChild(h('div', {}, [
        h('dt', { className: 'k', text: 'Member since' }),
        h('dd', { className: 'v num dim', text: whenLabel(detail.memberSince) || detail.memberSince })
      ]));
    }
    body.appendChild(facts);

    var fields = (detail.record && detail.record.fields) ||
      (detail.summary && detail.summary.fields) || [];
    body.appendChild(h('div', { className: 'divider mt-sm' }));
    body.appendChild(h('div', { className: 'mt-sm' }, [fieldList(detail.reference, fields)]));

    if (detail.record && detail.record.note) {
      var box2 = h('div', { className: 'note note-warn mt-sm' });
      box2.appendChild(icon('warn'));
      box2.appendChild(h('div', { text: detail.record.note }));
      body.appendChild(box2);
    }
    box.appendChild(body);

    box.appendChild(h('div', { className: 'card-foot' }, [
      icon('lock'),
      h('span', { text: 'Hidden for every role, including this one, until a reveal is recorded.' })
    ]));
    return box;
  }

  /* Promises 2 and 3. The controls themselves are per field, beside the field
     they uncover, so this card states the rule once and then shows what has
     already been revealed on this account. */
  function revealCard(detail) {
    var box = shell.card();
    box.appendChild(shell.cardHead('Revealing a personal field', null, [
      pill(isOwner() ? 'vio' : '', 'Owner only', 'lock')
    ]));

    var body = h('div', { className: 'card-body' });
    var rules = h('ul', { className: 'list-tick' });
    [
      'A written reason is required, and the server asks for it again.',
      'Recorded by field name, never by value.',
      'Shown once, then it hides itself.'
    ].forEach(function (line) {
      rules.appendChild(h('li', {}, [icon('check'), h('span', { text: line })]));
    });
    body.appendChild(rules);

    if (!isOwner()) {
      body.appendChild(h('p', { className: 'tiny muted mt-sm', text:
        'You are not an owner, so every Reveal control on this page is dead. It is shown rather ' +
        'than hidden so the rule is legible.' }));
    }

    var entries = ((detail.access && detail.access.entries) || [])
      .filter(function (e) { return e.revealed; });
    var inset = h('div', { className: 'inset mt-sm' });
    inset.appendChild(h('div', { className: 'row' }, [
      h('span', { className: 'dot vio' }),
      h('span', { className: 'inset-title', text: 'Previously revealed' })
    ]));
    if (!entries.length) {
      inset.appendChild(h('p', { className: 'tiny muted mt-xs', text:
        'No field has been revealed on this account inside the reported window.' }));
    } else {
      var list = h('dl', { className: 'kv mt-xs' });
      entries.slice(0, 6).forEach(function (e) {
        list.appendChild(h('div', {}, [
          h('dt', { className: 'k', text: e.fields || 'field revealed' }),
          h('dd', { className: 'v tiny dim', text:
            (whenLabel(e.occurredAt) || 'time not reported') + ' · ' + (e.actor || 'actor not reported') })
        ]));
      });
      inset.appendChild(list);
    }
    body.appendChild(inset);
    box.appendChild(body);
    return box;
  }

  /* Promise 6 lives in this card's foot. */
  function activityCard(detail) {
    var box = shell.card();
    var activity = detail.activity;
    var events = (activity && activity.events) || [];

    box.appendChild(shell.cardHead(
      'What this account has done',
      activity && activity.windowDays ? 'Last ' + plural(activity.windowDays, 'day') : null,
      null
    ));

    if (!events.length) {
      box.appendChild(h('div', { className: 'card-body' }, [
        shell.stateBlock('empty', 'No activity in this window', [
          activity
            ? 'The account exists and reported nothing. A quiet account, not a missing one.'
            : 'The operations API did not report activity for this account.'
        ], 4)
      ]));
      return box;
    }

    var wrap = h('div', { className: 'tbl-wrap' });
    var table = h('table', { className: 'tbl' });
    table.appendChild(h('caption', { className: 'sr', text: 'Recent activity on this account' }));
    table.appendChild(h('thead', {}, [
      h('tr', {}, [
        h('th', { scope: 'col', text: 'When' }),
        h('th', { scope: 'col', text: 'What happened' }),
        h('th', { scope: 'col', text: 'Reference' })
      ])
    ]));

    var tbody = h('tbody');
    events.forEach(function (ev) {
      var what = h('td');
      what.appendChild(h('div', { className: 't-main', text: ev.label }));
      if (ev.tone) what.appendChild(h('div', { className: 'mt-xs' }, [tonePill(ev.tone, ev.tone === 'ok' ? 'Delivered' : ev.tone === 'info' ? 'Noted' : 'Needs a look')]));

      var ref = h('td');
      /* Only a link when the API gave one, and only ever to another pane in
         this dashboard. safeHref is what makes that second half true rather
         than a claim: an off-origin href renders as the plain reference it
         would otherwise link to, so a page with somebody's account open cannot
         be turned into a referrer leak by a payload. */
      var href = ev.reference ? safeHref(ev.href) : null;
      if (href) ref.appendChild(h('a', { className: 'code', href: href, text: ev.reference }));
      else if (ev.reference) ref.appendChild(code(ev.reference));
      else ref.appendChild(h('span', { className: 'muted tiny', text: '—' }));

      tbody.appendChild(h('tr', {}, [
        h('th', { scope: 'row', className: 'num dim', text: whenLabel(ev.occurredAt) || 'time not reported' }),
        what,
        ref
      ]));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    box.appendChild(wrap);

    box.appendChild(h('div', { className: 'card-foot' }, [
      icon('lock'),
      h('span', { text: 'Request and reply content is not shown, for any role.' })
    ]));
    return box;
  }

  function devicesCard(detail) {
    var box = shell.card();
    var devices = detail.devices || [];
    box.appendChild(shell.cardHead('Devices', null,
      [pill('', plural(devices.length, 'device'), 'plug')]));

    if (!devices.length) {
      box.appendChild(h('div', { className: 'card-body' }, [
        shell.stateBlock('empty', 'No device reported', [
          'Device level version data is sent by the apps themselves, so an account that has not ' +
            'opened one recently has none.'
        ], 4)
      ]));
      return box;
    }

    var wrap = h('div', { className: 'tbl-wrap' });
    var table = h('table', { className: 'tbl' });
    table.appendChild(h('caption', { className: 'sr', text: 'Devices on this account' }));
    table.appendChild(h('thead', {}, [
      h('tr', {}, [
        h('th', { scope: 'col', text: 'Device' }),
        h('th', { scope: 'col', text: 'App' }),
        h('th', { scope: 'col', text: 'Last seen' })
      ])
    ]));
    var tbody = h('tbody');
    devices.forEach(function (d) {
      var app = h('td');
      app.appendChild(h('div', { className: 't-main num', text: d.appVersion || 'not reported' }));
      if (d.os) app.appendChild(h('div', { className: 't-sub', text: d.os }));
      tbody.appendChild(h('tr', {}, [
        h('th', { scope: 'row', className: 't-main', text: d.label || 'Unnamed device' }),
        app,
        h('td', { className: 'num dim', text: ago(d.lastSeenAt) || 'not reported' })
      ]));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    box.appendChild(wrap);
    return box;
  }

  function billingCard(detail) {
    var box = shell.card();
    var billing = detail.billing;
    box.appendChild(shell.cardHead('Subscription', null, null));

    if (!billing || !(billing.fields || []).length) {
      /* Which of the two this is turns on the account's own tier. A paid tier
         with no billing record is a contradiction; on the free tier the same
         empty answer is correct. The head carried the tier as a pill until the
         pill was a third copy of it, so the state block names it instead. */
      var paid = detail.tier && detail.tier.brand;
      box.appendChild(h('div', { className: 'card-body' }, [
        shell.stateBlock('empty', 'No subscription record', [
          paid
            ? 'The account is on ' + (detail.tier.label || detail.tier.key) +
              ', so a record was expected here.'
            : 'On the free tier that is the expected answer rather than a missing one.'
        ], 4)
      ]));
      return box;
    }

    box.appendChild(h('div', { className: 'card-body' }, [
      fieldList(detail.reference, billing.fields)
    ]));
    return box;
  }

  /* Promises 4 and 5. This is the band that makes the rest of the pane
     defensible: it is built so that it would be safe to show the athlete whose
     account it belongs to, which is why it is a band on the page rather than a
     tab behind a button, as it was before the remodel. */
  function accessCard(detail) {
    var access = detail.access;
    var box = shell.card();
    var entries = (access && access.entries) || [];

    box.appendChild(shell.cardHead(
      'Who has looked at this account',
      access && access.windowDays ? 'Last ' + plural(access.windowDays, 'day') : null,
      [pill('', 'Shown to the athlete on request', 'person')]
    ));

    if (!entries.length) {
      box.appendChild(h('div', { className: 'card-body' }, [
        shell.stateBlock('empty', 'No recorded access', [
          access
            ? 'Nobody has opened this account inside the reported window, including you until this lookup is written.'
            : 'The operations API did not report an access record for this account.'
        ], 4)
      ]));
    } else {
      var wrap = h('div', { className: 'tbl-wrap' });
      var table = h('table', { className: 'tbl' });
      table.appendChild(h('caption', { className: 'sr', text: 'Recorded access to this account' }));
      table.appendChild(h('thead', {}, [
        h('tr', {}, [
          h('th', { scope: 'col', text: 'When' }),
          h('th', { scope: 'col', text: 'Who' }),
          h('th', { scope: 'col', text: 'What' }),
          h('th', { scope: 'col', text: 'Reason' })
        ])
      ]));
      var tbody = h('tbody');
      entries.forEach(function (e) {
        var what = h('td');
        /* A revealed entry is marked with a word as well as a colour, because
           "somebody read a personal field" is the row on this table that an
           athlete reading it would care about most. */
        if (e.revealed) what.appendChild(pill('vio', e.fields || 'field revealed', 'eye'));
        else what.appendChild(h('span', { className: 'tiny dim', text: e.fields || 'summary only' }));

        tbody.appendChild(h('tr', {}, [
          h('th', { scope: 'row', className: 'num dim', text: whenLabel(e.occurredAt) || 'not reported' }),
          h('td', { text: e.actor || 'not reported' }),
          what,
          h('td', { className: 'tiny dim', text: e.reason || 'no reason recorded' })
        ]));
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      box.appendChild(wrap);
    }

    box.appendChild(h('div', { className: 'card-foot' }, [
      icon('history'),
      h('span', { text: 'Kept for the life of the account. A reveal cannot erase one.' })
    ]));
    return box;
  }

  /* The danger zone. The mock carries four account actions behind
     re-authentication; the operations API answers no route that performs one,
     so the rows are named and none of them is a button. A control that cannot
     succeed is worse than no control, and hiding the band entirely would only
     make people ask whether it exists. */
  function dangerCard(detail) {
    var box = shell.card('accent acc-bad');
    var actions = (detail.supportActions && detail.supportActions.available) || [];

    box.appendChild(shell.cardHead(
      'Account actions',
      'Named here, not performed here. Audited, and the athlete is told.',
      [pill('ghost', 'Re-authentication required', 'lock')]
    ));

    var body = h('div', { className: 'card-body' });
    if (!actions.length) {
      body.appendChild(h('p', { className: 'tiny muted', text:
        'The operations API reports no account action on this deployment, so there is nothing ' +
        'here to press. Deleting an account runs through the deletion workflow, which needs the ' +
        "athlete's own confirmation." }));
    } else {
      actions.forEach(function (a) {
        body.appendChild(h('div', { className: 'srow' }, [
          h('div', { className: 's-main', text: a.label || a.key })
        ]));
      });
    }
    box.appendChild(body);
    return box;
  }

  /* ------------------------------------------------------------- states */

  function idleState() {
    var box = shell.card();
    box.appendChild(shell.stateBlock('search', 'Nothing looked up yet', [
      'Enter an exact coded reference, email address or support ticket above, with your reason.',
      'This pane has no list of accounts to start from, on purpose.'
    ]));
    return box;
  }

  function noMatchState(identifier) {
    var box = shell.card();
    var block = shell.stateBlock('search', 'No account matches that identifier', [
      'The operations API looked and found nothing. Near matches are never returned, so a wrong ' +
        'guess cannot be used to find out who has an account.'
    ]);
    if (identifier) {
      block.appendChild(h('div', { className: 'row mt-sm' }, [code(identifier)]));
    }
    box.appendChild(block);
    return box;
  }

  function errorState(err, retry) {
    var box = shell.card();
    var missing = err && err.code === 'ops_route_missing';
    var block = missing
      ? shell.stateBlock('plug', 'This pane has no API yet', [
        'The operations API does not answer the account lookup routes on this deployment.',
        'Nothing has been recorded, because nothing was looked up.'
      ])
      : shell.stateBlock('warn', 'Could not look that up', [
        shell.failureMessage(err),
        'Nothing has been signed out.'
      ]);

    if (retry) {
      var again = h('button', { className: 'btn btn-primary', type: 'button', text: 'Try again' });
      again.addEventListener('click', retry);
      block.appendChild(h('div', { className: 'row mt-sm' }, [again]));
    }
    box.appendChild(block);
    return box;
  }

  /* ------------------------------------------------------------ wiring */

  var content = null;
  var region = null;
  var resultRegion = null;
  var lastResult = null;
  var lastIdentifier = '';
  var selectedRef = null;
  var scope = 'all';
  var seq = 0;
  /* Whether a lookup has been issued under the current scope, landed or not.
     lastResult cannot answer that: it is null both before the first lookup and
     while one is in flight, and those need different handling on a scope
     change. */
  var looked = false;

  function paintResult(node) {
    if (!resultRegion) return;
    clear(resultRegion);
    if (node) resultRegion.appendChild(node);
  }

  function runLookup() {
    var identifier = (identifierInput.value || '').trim();
    var reason = (reasonInput.value || '').trim();

    if (!identifier) {
      setFormError('Enter an exact coded reference, email address or support ticket.');
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
    selectedRef = null;
    lastIdentifier = identifier;

    var mine = ++seq;
    looked = true;
    region.loading([{ type: 'rows', count: 3 }]);

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
      lastResult = (payload && payload.data) || {};
      renderResult();
    }).catch(function (err) {
      if (mine !== seq) return;
      lastResult = null;
      paintResult(errorState(err, runLookup));
      region.degraded(resultRegion);
    });
  }

  /* live or degraded, decided by the one fact that separates them here: a
     surface on screen that could not confirm the access record it promised is
     a half-read pane, not a healthy one. */
  function settle(recorded) {
    if (recorded) region.show(resultRegion);
    else region.degraded(resultRegion);
  }

  function renderResult() {
    if (!lastResult) return;
    var matches = lastResult.matches || [];

    if (!matches.length) {
      paintResult(noMatchState(lastIdentifier));
      region.empty(resultRegion);
      shell.announce('No account matches that identifier');
      return;
    }

    var stack = h('div', { className: 'stack' });
    stack.appendChild(recordingNotice(lastResult.recorded, 'this lookup'));

    var matchBand = shell.band('Matches', null, null);
    matchBand.appendChild(matchesCard(lastResult, selectAccount, selectedRef));
    stack.appendChild(matchBand);

    stack.appendChild(h('div', { className: 'stack', id: 'accountColumn' }, [
      h('div', { className: 'card' }, [
        shell.stateBlock('person', 'Pick an account', ['Opening one is itself recorded.'], 3)
      ])
    ]));
    paintResult(stack);
    settle(lastResult.recorded);

    shell.announce(matches.length === 1 ? '1 account matched' : matches.length + ' accounts matched');

    /* One match is not a choice, so it is opened rather than offered. */
    if (matches.length === 1) selectAccount(matches[0].reference);
  }

  function selectAccount(reference) {
    selectedRef = reference;
    clearReveals();

    var column = document.getElementById('accountColumn');
    if (!column) return;
    clear(column);
    column.appendChild(h('div', { className: 'card' }, [
      h('div', { className: 'card-body' }, [
        h('p', { className: 'sr', role: 'status', text: 'Loading account record' }),
        h('div', { className: 'skel skel-row', 'aria-hidden': 'true' }),
        h('div', { className: 'skel skel-row', 'aria-hidden': 'true' })
      ])
    ]));

    var mine = ++seq;
    session.call('/api/ops/users/' + encodeURIComponent(reference)).then(function (payload) {
      if (mine !== seq) return;
      var detail = (payload && payload.data) || {};
      detail.reference = detail.reference || reference;

      renderSelectedRow();
      var col = document.getElementById('accountColumn');
      if (!col) return;
      clear(col);
      /* Opening an account is its own access record, so the same confirmation
         the lookup gets is reported here. detail.recorded was declared in the
         contract and never read, which meant a response that confirmed nothing
         looked exactly like one that did. */
      col.appendChild(recordingNotice(detail.recorded, 'opening this account'));

      var one = shell.band('One account', null, null);
      one.appendChild(h('div', { className: 'grid g2' }, [
        accountCard(detail),
        revealCard(detail)
      ]));
      col.appendChild(one);

      var story = shell.band('Recent activity', null, null);
      story.appendChild(activityCard(detail));
      col.appendChild(story);

      var subs = shell.band('Subscription and devices', null, null);
      subs.appendChild(h('div', { className: 'grid g2' }, [
        billingCard(detail),
        devicesCard(detail)
      ]));
      col.appendChild(subs);

      var seen = shell.band('Access record', null, null);
      seen.appendChild(accessCard(detail));
      col.appendChild(seen);

      var danger = shell.band('Danger zone', 'Not reversible from this pane', [
        pill('vio', 'Owner only', 'lock')
      ]);
      danger.appendChild(dangerCard(detail));
      col.appendChild(danger);

      settle(lastResult && lastResult.recorded && detail.recorded);

      /* The same fact the note directly above this reports. Announcing
         "opened and recorded" over a warning that says no record was confirmed
         would leave a screen reader with the one version of events the page
         has just said it cannot vouch for. */
      shell.announce(detail.recorded
        ? 'Account ' + detail.reference + ' opened and recorded'
        : 'Account ' + detail.reference + ' opened, with no record confirmed');
    }).catch(function (err) {
      if (mine !== seq) return;
      var col = document.getElementById('accountColumn');
      if (!col) return;
      clear(col);
      col.appendChild(errorState(err, function () { selectAccount(reference); }));
      region.degraded(resultRegion);
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

  /* The shell calls this once, with the pane's content region, after the
     session is confirmed and the document has finished parsing. A pane with no
     registration renders the not-built state, so there is no flag anywhere
     claiming this pane is built: the fact is this file being on the page. */
  shell.definePane('users', function (host) {
    content = host;
    scope = shell.filters().scope || 'all';

    content.appendChild(h('div', { className: 'stack' }, [
      privilegeStrip(),
      huntPanel(runLookup)
    ]));

    region = shell.region(content);
    resultRegion = h('div', { className: 'stack', id: 'lookupResult' });
    resultRegion.appendChild(idleState());
    region.empty(resultRegion);
  });

  global.addEventListener('ops:filters', function (e) {
    if (!content || !e.detail) return;
    var next = e.detail.scope || 'all';
    if (next === scope) return;
    scope = next;

    /* The scope is part of the query, so anything already out was asked under
       a scope that is no longer on screen. The sequence is bumped whether or
       not a result has landed: leaving it alone let an in-flight lookup
       resolve and render under the old scope while the filter bar showed the
       new one, which is the pane silently answering a question nobody asked.
       Anything revealed under the old scope goes back behind its mask. */
    ++seq;
    clearReveals();

    /* Refiltering is a new lookup, and a new lookup is a new access record, so
       it is not run behind the operator's back. The card is drawn whenever a
       lookup has been run under the old scope, in flight or landed, because
       the skeleton of a lookup that has just been invalidated would otherwise
       sit on screen forever. */
    if (looked) {
      paintResult(h('div', { className: 'card' }, [
        shell.stateBlock('search', 'App filter changed', [
          'Running the lookup again writes another access record, so it is not run for you.'
        ])
      ]));
      region.empty(resultRegion);
      lastResult = null;
      selectedRef = null;
      looked = false;
    }
  });
})(window);
