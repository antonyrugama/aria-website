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

   Every field below is what the code actually consumes, because this contract
   is the only specification a backend author has for these three routes.

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
       record      the fuller field list shown in the drawer, falling back to
                   summary.fields when it is absent
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
                  anything absent, draws no control. Health field keys are
                  always 'never'; the client refuses them a control and
                  refuses to print them in the clear whatever the API says,
                  because a server that gets rule 4 wrong should not be able
                  to make this page the place it goes wrong.
     neverShownNote / unavailableNote
                  the sentence shown in place of a control. */
(function (global) {
  'use strict';

  var shell = global.OpsShell;
  var session = global.OpsSession;
  var h = shell.h;
  var icon = shell.icon;

  var TONE_ICON = { ok: 'check', warn: 'warn', crit: 'warn', info: 'info' };

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

  /* The recording confirmation. It appears after a request rather than before
     it, because it reports something that has already happened: this is the
     row the athlete would be shown if they asked.

     When the response does not carry one, the surface says so. The privacy bar
     above states that every lookup is recorded, and a response that stayed
     silent about it is the one case where that sentence might not be true.
     Looking identical either way would make the promise unfalsifiable, so this
     returns a warning rather than nothing. */
  function recordingNotice(recorded, what) {
    /* what names the thing that was recorded, and both sentences are built
       from it. The confirmed branch used to be the word "lookup" hard coded,
       so opening an account, which is its own access record, was reported as
       "This lookup is on the record" on the column beside the matches. */
    var subject = what || 'this request';
    var Subject = subject.charAt(0).toUpperCase() + subject.slice(1);

    if (!recorded) {
      var warn = h('div', { className: 'callout callout-warn' });
      warn.appendChild(icon('warn'));
      var wbody = h('div');
      wbody.appendChild(h('strong', { text: 'No record was confirmed.' }));
      wbody.appendChild(document.createTextNode(
        ' The operations API handled ' + subject + ' without confirming that it ' +
        'wrote an access record. It may still have written one. Treat this as unrecorded until ' +
        'the access record shows otherwise.'
      ));
      warn.appendChild(wbody);
      return warn;
    }

    var box = h('div', { className: 'callout callout-info' });
    box.appendChild(icon('lock'));
    var body = h('div');
    body.appendChild(h('strong', { text: Subject + ' is on the record.' }));
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

  /* The invalid marks are cleared on every pass, not only when the message is
     cleared, and the caller then marks the one field it is complaining about.
     Clearing only on success left aria-invalid="true" on an identifier that
     had since been filled in, so a screen reader was told the wrong control
     was the problem. */
  function setFormError(message) {
    if (!formError) return;
    formError.textContent = '';
    if (identifierInput) identifierInput.removeAttribute('aria-invalid');
    if (reasonInput) reasonInput.removeAttribute('aria-invalid');
    if (!message) return;
    formError.appendChild(icon('warn'));
    formError.appendChild(h('span', { text: message }));
  }

  /* --------------------------------------------------------- match list */

  function matchesCard(data, onPick, selectedRef) {
    var card = h('div', { className: 'card' });
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

    var head = h('div', { className: 'card-head' });
    head.appendChild(h('h3', { className: 'card-title', text: 'Matches' }));
    head.appendChild(h('span', {
      className: 'card-hint',
      text: short
        ? rows + ' of ' + plural(claimed, 'account') + ' shown, exact identifier match'
        : plural(rows, 'account') + ', exact identifier match'
    }));
    head.appendChild(h('div', { className: 'spacer', 'aria-hidden': 'true' }));
    head.appendChild(badge('info', 'Details hidden', 'lock'));
    card.appendChild(head);

    if (short) {
      var capped = h('div', { className: 'callout callout-warn' });
      capped.appendChild(icon('warn'));
      capped.appendChild(h('div', {
        className: 'small',
        text: 'The operations API says ' + plural(claimed, 'account') + ' matched but sent ' + rows +
          '. The rest are not on this page and this pane has no way to ask for them. Narrow the ' +
          'identifier rather than reading the number above as a list you can work through.'
      }));
      card.appendChild(capped);
    }

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
       ""` as no mask and unmasked the field. */
    var carriesMask = Object.prototype.hasOwnProperty.call(field, 'maskedValue') &&
      field.maskedValue !== null && field.maskedValue !== undefined;
    var unmaskedByDesign = field.masked === false && !carriesMask && !health;

    var masked = h('span', {
      className: 'masked',
      text: field.maskedValue || 'Hidden'
    });
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
      never.appendChild(icon('lock'));
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
       which is the drawer closing or a new search replacing the container, the
       pane's content region takes it rather than document.body. */
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
           pane that cannot be recovered from by closing the drawer. parseTime
           is total, so this is belt as well as braces. */
        var expiresAt = parseTime(out.expiresAt);
        var serverSaid = expiresAt !== null;
        var ms = serverSaid
          ? Math.max(0, Math.min(expiresAt - Date.now(), REVEAL_MAX_MS))
          : REVEAL_CEILING_MS;

        /* The reveal writes its own access record, and the response says
           whether it did. Claiming otherwise in the announcement while the
           drawer behind it warns that nothing was confirmed is the same
           contradiction the lookup callout exists to avoid, so the sentence on
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
    /* Says what the weaker of the two guarantees says. Which fields count as
       health data is the operations API's call, and the client's key list is a
       floor under it rather than the authority, so the sentence names the API
       rather than implying this page holds the definitive list. */
    foot.appendChild(h('span', {
      text: 'Weight, injuries, journal entries, and messages are never shown here at all, and ' +
        'there is no button on this page that would reveal them. Which fields count as health ' +
        'data is decided by the operations API; this page keeps its own list of health keys ' +
        'underneath that decision and refuses those whatever a payload says.'
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
        ? 'Last ' + plural(activity.windowDays, 'day') + ', events only'
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
         this dashboard. safeHref is what makes that second half true rather
         than a claim: an off-origin href renders as the plain reference it
         would otherwise link to, so a page with somebody's account open cannot
         be turned into a referrer leak by a payload. */
      var href = ev.reference ? safeHref(ev.href) : null;
      if (href) {
        line.appendChild(document.createTextNode(' '));
        line.appendChild(h('a', { className: 'tiny mono', href: href, text: ev.reference }));
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
    /* The opener is normally still there. It is not when the pane has
       re-rendered underneath the open drawer, which the App filter does, and
       an unguarded focus() on a detached node drops focus to document.body
       with nothing announced. The content region is the fallback, and the body
       counts as no opener rather than as one, because focusing it is the same
       outcome the fallback exists to avoid. */
    var back = drawerReturnFocus;
    drawerReturnFocus = null;
    if (back && back !== document.body && document.contains(back)) back.focus();
    else focusFallback();
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

    /* The claim that opening this was recorded is only made when the response
       said so. It is the same fact recordingNotice() reports on the column
       behind the drawer, and asserting it here regardless would have the
       drawer contradict the card underneath it. */
    var confirmedRecord = !!detail.recorded;
    var opened = h('div', { className: 'callout ' + (confirmedRecord ? 'callout-info' : 'callout-warn') });
    opened.appendChild(icon(confirmedRecord ? 'lock' : 'warn'));
    opened.appendChild(h('div', {
      text: confirmedRecord
        ? 'You are viewing the masked record. Opening it has already been recorded. Revealing ' +
          'any single field needs its own reason and is recorded by field name.'
        : 'You are viewing the masked record. The operations API did not confirm that opening it ' +
          'was recorded, so treat it as unrecorded. Revealing any single field still needs its own ' +
          'reason and is recorded by field name.'
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
      head.appendChild(h('span', {
        className: 'sec-hint', text: 'Last ' + plural(access.windowDays, 'day')
      }));
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
  /* Whether a lookup has been issued under the current scope, landed or not.
     lastResult cannot answer that: it is null both before the first lookup and
     while one is in flight, and those need different handling on a scope
     change. */
  var looked = false;

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
    looked = true;
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
    stack.appendChild(recordingNotice(lastResult.recorded, 'this lookup'));

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
      /* Opening an account is its own access record, so the same confirmation
         the lookup gets is reported here. detail.recorded was declared in the
         contract and never read, which meant a response that confirmed nothing
         looked exactly like one that did. */
      col.appendChild(recordingNotice(detail.recorded, 'opening this account'));
      col.appendChild(summaryCard(detail, function () { openDrawer(detail); }));
      col.appendChild(activityCard(detail));
      col.appendChild(supportCard(detail));
      /* The same fact the callout directly above this reports. Announcing
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

  /* The shell calls this once, with the pane's content region, after the
     session is confirmed and the document has finished parsing. A pane with no
     registration renders the not-built state, so there is no flag anywhere
     claiming this pane is built: the fact is this file being on the page. */
  shell.definePane('users', function (host) {
    content = host;
    scope = shell.filters().scope || 'all';

    var stack = h('div', { className: 'stack' });
    stack.appendChild(privacyBar());
    stack.appendChild(searchCard(runLookup));

    resultRegion = h('div', { className: 'stack', id: 'lookupResult' });
    resultRegion.appendChild(idleState());
    stack.appendChild(resultRegion);
    content.appendChild(stack);
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
    if (resultRegion) resultRegion.removeAttribute('aria-busy');

    /* Refiltering is a new lookup, and a new lookup is a new access record, so
       it is not run behind the operator's back. The card is drawn whenever a
       lookup has been run under the old scope, in flight or landed, because
       the skeleton of a lookup that has just been invalidated would otherwise
       sit on screen forever. */
    if (looked) {
      paintResult(h('div', { className: 'card' }, [
        shell.stateBlock('search', 'App filter changed', [
          'The App filter is part of the query, and running it again writes another access ' +
            'record, so it is not run for you. Look up again when you are ready.'
        ])
      ]));
      lastResult = null;
      selectedRef = null;
      looked = false;
      closeDrawer();
    }
  });
})(window);
