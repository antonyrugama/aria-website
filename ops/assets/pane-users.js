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
     4. Health data has no reveal control at all, and no row. Not a disabled
        control, not one that asks for a stronger role: the field is not drawn,
        because a control that can never succeed still tells an operator that
        the value is somewhere within reach.

   Activity is a list of events and never their content. "Chat session, 8
   messages" is a fact about the service; what was said is not this pane's to
   show, at any role.

   THE PROMISES THIS PANE MAKES TO THE ATHLETE, and where each is on screen

   There is one sentence on the page, under the Account card: "Owner only ·
   Reason required · Logged". It is the whole of what the pane says about
   itself, and each word is backed by a mechanism rather than the reverse:

     owner only        a reveal is an owner action; every other role gets a
                       disabled control and the words "Owner action"
     reason required   the form refuses fewer than three characters and the
                       server asks again
     logged            a reveal is recorded by field name and never by value,
                       and the Access history lists it, with who and why, so
                       the athlete can see that it happened and who did it

   Two more hold without a sentence. A personal field is hidden for every
   role, the owner included, until a reveal is recorded: the payload never
   carries the value, so there is nothing to hide behind a style. Request and
   reply content is not shown at any role: the activity list holds a label and
   a time and nothing else.

   scripts/ops-users-v2.test.mjs asserts the mechanism behind each, and not the
   sentence, because a sentence that outlives the thing it describes is the
   worse of the two failures.

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
         platforms[] { key, label }
         flags[]     { key, label, tone }

       scope, state and tier are all read by the server, so all three are
       sent. They live behind the Filters control under the search, one level
       deeper than the mock draws them, because the mock has no room for three
       selects and the API still honours every one.

     GET /api/ops/users/{reference}?reason=
       -> { data: { reference, kind, state, tier, memberSince, recorded,
                    summary{fields[]}, record{fields[], note},
                    activity{windowDays, events[]}, devices[],
                    billing{fields[]}, access{windowDays, entries[]},
                    supportActions{available[]} } }

       reason      the reason the operator typed for the lookup this account
                   came from, as it was when they pressed Search. The route
                   records it on the access entry for opening the account and
                   falls back to a generic line when it is absent, so every
                   read carries the operator's own words rather than the
                   fallback. It rides in the querystring because that is where
                   the route reads it; the identifier never does, and the
                   reference in the path is the coded one, never an address.

       kind        'coach' or 'athlete'
       recorded    as above, for the record this request wrote
       record      the fuller field list, falling back to summary.fields when
                   it is absent
       activity    absent when the account has not shared it, which is a
                   different fact from an empty list and is drawn differently
       events[]    { occurredAt, label, tone, reference, href }: a list of
                   events and never their content. href is followed only when
                   it stays on this origin, so it cannot become an off-site
                   destination reached from a privacy pane.
       devices[]   { label, appVersion, os, lastSeenAt }
       access.entries[] { occurredAt, actor, fields, reason, revealed }
       supportActions.available[] is read by nothing: the operations API has no
                   route that performs an account action, so the pane draws no
                   account actions

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

   WHAT THE ROWS CHOOSE

   The API sends raw values ('pro', 'monthly', 'apple') and ISO times. This
   file words them for reading and writes every time in UTC, because an
   operator and an athlete are rarely in the same zone and a local time on a
   privacy pane is a time nobody can check. It never decides what a value
   means beyond that: a status or a store it does not recognise is printed as
   it arrived.

   The avatar carries one letter, and only the one the API's own mask already
   shows: maskName sends "J••••••", so the initial is on screen in the Name row
   anyway. A name that is not set, or a mask that starts with anything but a
   letter, draws a person glyph instead. Nothing is ever worked out from a
   revealed value. */
(function (global) {
  'use strict';

  var shell = global.OpsPaneShell;
  var session = global.OpsSession;
  var h = shell.h;
  var icon = shell.icon;

  var DOT_TONE = { ok: 'ok', warn: 'warn', crit: 'bad', info: 'acc' };

  /* The three narrowings the lookup route reads. The app values mirror
     OpsPaneRegistry.SCOPES, which scripts/ops-users-v2.test.mjs compares. */
  var SCOPE_OPTIONS = [
    { v: 'all', l: 'All' },
    { v: 'mobile', l: 'Mobile' },
    { v: 'coaches', l: 'Coaches Web' }
  ];
  var STATE_OPTIONS = [
    { v: '', l: 'Any' },
    { v: 'active', l: 'Active' },
    { v: 'payment_failed', l: 'Payment failed' },
    { v: 'deletion_requested', l: 'Deletion requested' },
    { v: 'suspended', l: 'Suspended' }
  ];
  var TIER_OPTIONS = [
    { v: '', l: 'Any' },
    { v: 'free', l: 'Free' },
    { v: 'pro', l: 'Pro' },
    { v: 'coach_team', l: 'Coach team' }
  ];

  /* The rows each card leads with, in the order the mock draws them. A field
     the API sends that is not named here is reachable behind the card's More
     control rather than dropped, and a field it does not send draws no row. */
  var ACCOUNT_ROWS = [
    ['email', 'Email'],
    ['displayName', 'Name'],
    ['authProvider', 'Sign-in'],
    ['emailVerified', 'Verified'],
    ['lastSignInAt', 'Last sign-in'],
    ['usageAnalytics', 'Usage analytics']
  ];
  /* Said in the result header, so not repeated as rows. */
  var HEAD_KEYS = { reference: 1, memberSince: 1 };
  var BILLING_KEYS = {
    tier: 1, billingStatus: 1, billingPlatform: 1, billingCycle: 1,
    currentPeriodStart: 1, currentPeriodEnd: 1
  };

  var STORES = {
    apple: 'App Store', ios: 'App Store', app_store: 'App Store',
    google: 'Google Play', android: 'Google Play', google_play: 'Google Play'
  };
  var STATUS_TONE = {
    active: 'ok', trialing: 'ok', trial: 'ok',
    past_due: 'warn', payment_failed: 'warn', grace_period: 'warn', billing_retry: 'warn',
    canceled: 'bad', cancelled: 'bad', expired: 'bad', refunded: 'bad'
  };

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* "Nov 12", with the year only when it is not this one. The year is read in
     UTC like everything else here, so the label does not change with the
     machine the operator happens to be on. */
  function dayLabel(iso) {
    var t = parseTime(iso);
    if (t === null) return null;
    var d = new Date(t);
    var label = MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
    if (d.getUTCFullYear() !== new Date().getUTCFullYear()) label += ', ' + d.getUTCFullYear();
    return label;
  }

  /* "Nov 1, 08:42". The zone is named once on the card or row that carries
     the time, not on every time. */
  function stamp(iso) {
    var t = parseTime(iso);
    if (t === null) return null;
    var d = new Date(t);
    return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' +
      pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  }

  function headDate() {
    var d = new Date();
    return WEEKDAYS[d.getUTCDay()] + ', ' + MONTHS[d.getUTCMonth()] + ' ' +
      d.getUTCDate() + ', ' + d.getUTCFullYear();
  }

  /* "Active", "Payment failed". Raw values arrive snake or lower case. */
  function words(value) {
    var text = String(value).replace(/[_-]+/g, ' ').trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
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

  function code(text) {
    return h('span', { className: 'code', text: text });
  }

  /* A status is a dot and a word, never the dot alone. */
  function dotWord(tone, text) {
    var wrap = h('span', { className: 'u-dotword' });
    wrap.appendChild(h('span', { className: 'dot' + (tone ? ' ' + tone : ''), 'aria-hidden': 'true' }));
    wrap.appendChild(h('span', { text: text }));
    return wrap;
  }

  function stateWord(state) {
    if (!state) return h('span', { className: 'u-dim', text: 'State not reported' });
    return dotWord(DOT_TONE[state.tone] || '', state.label || state.key || 'Unknown');
  }

  function tierWord(tier) {
    if (!tier) return h('span', { className: 'u-dim', text: 'Tier not reported' });
    return h('span', { text: tier.label || tier.key || 'Unknown' });
  }

  /* The recording confirmation, for the one case that matters. A lookup or an
     open that the API handled without confirming an access record is the only
     time the promise "every lookup is recorded" might not be true, so it is the
     only time the page says anything. Confirmed is not said at all: the Access
     history lists the row, which is a better witness than a banner.

     Looking identical either way would make the promise unfalsifiable, so a
     missing record returns a warning rather than nothing. */
  function recordingNotice(recorded, what) {
    if (recorded) return null;
    var warn = h('div', { className: 'note note-warn' });
    warn.appendChild(icon('warn'));
    var body = h('div');
    body.appendChild(h('b', { text: 'No record confirmed.' }));
    body.appendChild(document.createTextNode(
      ' The API did not confirm an access record for ' + (what || 'this request') + '.'
    ));
    warn.appendChild(body);
    return warn;
  }

  /* --------------------------------------------------------- the search */

  var form = null;
  var identifierInput = null;
  var reasonInput = null;
  var scopeSelect = null;
  var stateSelect = null;
  var tierSelect = null;
  var filtersButton = null;
  var formError = null;

  function labelledInput(id, label, placeholder) {
    var input = h('input', {
      id: id, type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: placeholder
    });
    var field = h('label', { className: 'u-field', for: id }, [
      h('span', { className: 'u-label', text: label }),
      input
    ]);
    return { field: field, input: input };
  }

  function narrowSelect(id, label, options) {
    var sel = h('select', { id: id });
    options.forEach(function (o) {
      sel.appendChild(h('option', { value: o.v, text: o.l }));
    });
    var wrap = h('label', { className: 'u-narrow-field', for: id }, [
      h('span', { className: 'u-label', text: label }),
      h('span', { className: 'sel' }, [sel, icon('chev')])
    ]);
    return { wrap: wrap, select: sel };
  }

  /* How many of the three narrowings are on, said on the control that opens
     them. A narrowing that is on and out of sight is a lookup that finds
     nothing for a reason nobody can see. */
  function filterCount() {
    var n = 0;
    if (scopeSelect && scopeSelect.value && scopeSelect.value !== 'all') n += 1;
    if (stateSelect && stateSelect.value) n += 1;
    if (tierSelect && tierSelect.value) n += 1;
    return n;
  }

  function syncFiltersLabel() {
    if (!filtersButton) return;
    var n = filterCount();
    filtersButton.textContent = n ? 'Filters · ' + n : 'Filters';
  }

  function searchStrip(onSubmit, onNarrow) {
    form = h('form', { className: 'u-find', novalidate: 'novalidate' });

    var account = labelledInput('lookupIdentifier', 'Account', 'Reference or email');
    var reason = labelledInput('lookupReason', 'Reason', 'Ticket or note');
    identifierInput = account.input;
    reasonInput = reason.input;

    var go = h('button', { className: 'btn btn-primary u-go', type: 'submit', text: 'Search' });
    form.appendChild(h('div', { className: 'u-bar' }, [account.field, reason.field, go]));

    var scopeSel = narrowSelect('lookupScope', 'App', SCOPE_OPTIONS);
    var stateSel = narrowSelect('lookupState', 'State', STATE_OPTIONS);
    var tierSel = narrowSelect('lookupTier', 'Tier', TIER_OPTIONS);
    scopeSelect = scopeSel.select;
    stateSelect = stateSel.select;
    tierSelect = tierSel.select;

    /* The page may have been opened with an App already chosen: a link from
       another pane carries it, and so does a reload. The shell has read the
       querystring by now, and this control starts from what it read rather
       than from "All", so the lookup that follows asks the question the link
       asked. */
    scopeSelect.value = shell.filters().scope || 'all';

    var panel = h('div', { className: 'u-narrow', id: 'lookupFilters', hidden: 'hidden' },
      [scopeSel.wrap, stateSel.wrap, tierSel.wrap]);

    filtersButton = h('button', {
      className: 'u-link', type: 'button',
      'aria-expanded': 'false', 'aria-controls': 'lookupFilters', text: 'Filters'
    });
    filtersButton.addEventListener('click', function () {
      var open = filtersButton.getAttribute('aria-expanded') !== 'true';
      filtersButton.setAttribute('aria-expanded', String(open));
      if (open) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', 'hidden');
    });

    /* The App choice is the one narrowing the rest of the dashboard shares, so
       the shell is told: it is what keeps the address, the links to other
       panes and a reload on the same App. */
    scopeSelect.addEventListener('change', function () {
      shell.setScope(scopeSelect.value || 'all');
    });

    [scopeSelect, stateSelect, tierSelect].forEach(function (sel) {
      sel.addEventListener('change', function () {
        syncFiltersLabel();
        onNarrow();
      });
    });

    formError = h('p', { className: 'field-error', role: 'alert' });
    form.appendChild(h('div', { className: 'u-sub' }, [filtersButton, formError]));
    form.appendChild(panel);
    syncFiltersLabel();

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      onSubmit();
    });
    return form;
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

  /* The mark a picked row carries beside its coded reference. A word, not a
     tint: colour is the one channel an operator may not have, and this is the
     control that decides which account everything below the list describes.
     The glyph is decorative (assets/aria.js hides every icon it builds), so
     the word is what carries the fact. */
  function selectedMark() {
    var mark = h('span', { className: 'sel-mark' });
    mark.appendChild(icon('check'));
    mark.appendChild(h('span', { text: 'Selected' }));
    return mark;
  }

  /* Selection, said four ways, because three of the four readers of this list
     cannot see the fourth:

       the class     what assets/pane-users-v2.css draws the wash and the rail
                     from. Stadiora/Aria#10456: the pane wrote this class and
                     no sheet users.html loads had a rule for it, so picking a
                     match changed nothing on screen at all.
       aria-current  the ROW saying it is the one the pane is describing.
                     aria-pressed below is a fact about the button, and a
                     screen reader walking the list by row never enters it.
                     Chrome's CDP property enumeration does not list
                     aria-current on anything, so this one is correct ARIA that
                     a tree dump cannot evidence, and it is deliberately not
                     the channel anything relies on.
       aria-pressed  the control's own state, for a reader on the button. This
                     one IS in the tree: pressed="true" on the picked control
                     and "false" on the rest. Stadiora/Aria#10648: until that
                     issue was fixed it was the only channel the button
                     carried, so the control announced "pressed" and was drawn
                     pixel-for-pixel like the one beside it. It is painted too:
                     a ring, a heavier reference and a tint.
       the word      "Selected", in the row, so the affordance is never the
                     wash alone, and, being real text, it reaches every
                     assistive technology rather than the ones that map a given
                     attribute.

     One function for the first paint and for every later change. The two used
     to be written twice, once in the row builder and once in the repaint, and
     a repaint that forgets one channel is invisible to everybody except the
     person who needed that channel. */
  function applySelection(row, on) {
    row.className = on ? 'match-row is-selected' : 'match-row';
    if (on) row.setAttribute('aria-current', 'true');
    else row.removeAttribute('aria-current');

    var pick = row.querySelector('.match-row-btn');
    if (pick) pick.setAttribute('aria-pressed', String(on));

    var mark = row.querySelector('.sel-mark');
    if (on && !mark) {
      /* Into the line the coded reference is on rather than after the rest of
         the row: the mark belongs beside the name. The line is its own element
         so this is an appendChild with one possible outcome. */
      var line = row.querySelector('.match-id');
      if (line) line.appendChild(selectedMark());
    } else if (!on && mark && mark.parentNode) {
      mark.parentNode.removeChild(mark);
    }
  }

  /* The count and the rows are two numbers for the same thing. Where the count
     is the larger, the API has said it matched accounts it did not send, which
     is the "no bulk listing" rule breached without anybody being told unless
     the page says so. Answers the two numbers, or null when they agree or the
     count was not a number. Asked of every result, whether or not it needs a
     picker: one row beside a count of nine is the same contradiction. */
  function countShortfall(data) {
    var rows = (data.matches || []).length;
    var claimed = typeof data.matchCount === 'number' && isFinite(data.matchCount)
      ? data.matchCount : null;
    return claimed !== null && claimed > rows ? { rows: rows, claimed: claimed } : null;
  }

  function matchesCard(data, onPick, selectedRef) {
    var box = shell.card();
    var rows = (data.matches || []).length;
    /* The header states the number that is on screen, and the note beside it
       says the other one. A server that ever capped the array while leaving
       the count whole would otherwise have this header name accounts the
       operator cannot see. Saying both is the honest reading of a payload that
       contradicts itself. */
    var gap = countShortfall(data);

    box.appendChild(shell.cardHead(
      'Matches',
      null,
      [h('span', { className: 'u-win', text: gap
        ? gap.rows + ' of ' + plural(gap.claimed, 'account') + ' shown'
        : plural(rows, 'account') })]
    ));

    if (gap) {
      var capped = h('div', { className: 'note note-warn' });
      capped.appendChild(icon('warn'));
      capped.appendChild(h('div', {
        text: 'The API says ' + plural(gap.claimed, 'account') + ' matched but sent ' + gap.rows +
          '. Narrow the account.'
      }));
      box.appendChild(h('div', { className: 'card-body' }, [capped]));
    }

    var list = h('ul', { className: 'u-matches' });
    (data.matches || []).forEach(function (m) {
      var li = h('li');

      /* The whole row is not the control. A row click is unreachable from a
         keyboard, so the account line carries a real button and that button is
         what selects the account. `match-row-btn` and `match-row` are query
         hooks as well as painted: applySelection finds the control by the one
         and renderSelectedRow finds the rows by the other. */
      var pick = h('button', {
        className: 'match-row-btn', type: 'button', 'data-ref': m.reference
      });
      pick.appendChild(code(m.reference));
      pick.appendChild(h('span', { className: 'sr', text: ', open this account' }));
      pick.addEventListener('click', function () { onPick(m.reference); });
      li.appendChild(h('div', { className: 'match-id' }, [pick]));

      var facts = h('div', { className: 'u-facts' });
      if (m.maskedEmail) facts.appendChild(h('span', { className: 'u-dim', text: m.maskedEmail }));
      facts.appendChild(stateWord(m.state));
      facts.appendChild(tierWord(m.tier));
      var last = stamp(m.lastActiveAt);
      facts.appendChild(h('span', { className: 'u-dim', text: last ? 'Active ' + last : 'Last active not reported' }));
      (m.flags || []).forEach(function (f) {
        facts.appendChild(dotWord(DOT_TONE[f.tone] || '', f.label || f.key));
      });
      li.appendChild(facts);

      /* After the children, because it writes into one of them. */
      applySelection(li, m.reference === selectedRef);
      list.appendChild(li);
    });
    box.appendChild(list);
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

  /* A plain value the API said, in as many words, is not personal. The test is
     the three floors below, in one place so the row and the formatter cannot
     disagree about which fields are in the clear:

       masked absent or true  masked, whatever else the entry carries
       reveal 'never'         never plain
       a health key           never plain, whatever arrived

     The earlier test here was falsy rather than an equality, so an entry whose
     masked flag was absent, null or 0 while value was populated printed the
     real value in the clear, with no reveal control, no reason, and no
     per-field access record, at every role. Only an explicit false unmasks a
     field now, and an entry that carries a mask as well is contradictory
     rather than unmasked, so it is read as masked too.

     The mask half of that is a test of presence, not of truthiness. What makes
     an entry contradictory is carrying a maskedValue at all beside masked:
     false, and an empty string is carrying one: it is a mask the API built and
     got wrong, which is a reason to trust the entry less rather than a reason
     to print the real value. A falsy test read `maskedValue: ""` as no mask and
     unmasked the field.

     `reveal: 'never'` is the same idea once more. A field the API says is never
     shown here, in the same breath as saying it is not personal, is a payload
     disagreeing with itself, and the row it draws already refuses a control on
     the strength of the 'never'. Reading the other flag as a licence to print
     the value would let the contradiction decide the disclosure. No such
     payload exists today; this is why it would not matter if one did. */
  function isPlain(field) {
    var carriesMask = Object.prototype.hasOwnProperty.call(field, 'maskedValue') &&
      field.maskedValue !== null && field.maskedValue !== undefined;
    return field.masked === false && !carriesMask && !isHealthKey(field.key) &&
      field.reveal !== 'never';
  }

  /* A field that has no row on this pane at any role. */
  function isWithheld(field) {
    return isHealthKey(field.key) || field.reveal === 'never';
  }

  /* One field row. Which shape is drawn is the API's decision, with the floors
     above under it that this file will not let the API cross:

       masked absent or true  masked, whatever else the entry carries
       reveal 'never'         no control at all
       reveal 'unavailable'   no control, and the reason there is none
       reveal 'allowed'       a control that asks for a written reason first
       a health key           treated as 'never' regardless of what arrived */
  function fieldValue(reference, field) {
    var row = h('div', { className: 'reveal-row' });
    var health = isHealthKey(field.key);

    /* A plain value the API said is not personal. */
    if (isPlain(field)) {
      return h('span', { className: 'reveal-value', text: field.value === null || field.value === undefined ? 'Not reported' : String(field.value) });
    }

    /* The mask is the API's own text. It is never the hatching or a glyph
       alone that says a value is withheld. */
    var masked = h('span', { className: 'masked', text: field.maskedValue || 'Hidden' });
    var shown = h('span', { className: 'reveal-value hidden' });
    var note = h('span', { className: 'reveal-note hidden' });

    row.appendChild(masked);
    row.appendChild(shown);
    row.appendChild(note);

    if (health || field.reveal === 'never') {
      row.appendChild(h('span', {
        className: 'reveal-never',
        text: field.neverShownNote ||
          (health ? 'Health data is never shown here' : 'Never shown here')
      }));
      return row;
    }

    if (field.reveal !== 'allowed') {
      row.appendChild(h('span', {
        className: 'u-dim',
        text: field.unavailableNote || 'Not revealable'
      }));
      return row;
    }

    if (!isOwner()) {
      /* The rail already renders role facts rather than hiding destinations,
         so this does the same: the control is present, plainly unavailable,
         and names the role. The server enforces it regardless. */
      row.appendChild(h('button', { className: 'u-act', type: 'button', disabled: 'disabled', text: 'Reveal' }));
      row.appendChild(h('span', { className: 'u-dim', text: 'Owner action' }));
      return row;
    }

    var timer = null;
    var entry = null;

    /* Re-mask. Both ways in here hide the button that may be holding focus:
       the operator pressing "Hide", and the expiry falling due while focus
       happens to be sitting on it. Focus left on a display:none control is
       focus nobody can see and a keyboard cannot move on from, so it goes
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

    var revealBtn = h('button', { className: 'u-act', type: 'button', text: 'Reveal' });
    revealBtn.setAttribute('aria-label', 'Reveal ' + (field.label || field.key).toLowerCase());

    var hideBtn = h('button', { className: 'u-act hidden', type: 'button', text: 'Hide' });
    hideBtn.setAttribute('aria-label', 'Hide ' + (field.label || field.key).toLowerCase());
    hideBtn.addEventListener('click', function () {
      hide();
      shell.announce(field.label + ' hidden again');
    });

    var reasonForm = h('form', { className: 'reveal-form hidden' });
    var reasonId = 'reveal-' + reference + '-' + field.key;
    var reasonBox = h('input', {
      id: reasonId, type: 'text', autocomplete: 'off',
      placeholder: 'Reason'
    });
    var confirm = h('button', { className: 'btn btn-primary u-ok', type: 'submit', text: 'Show' });
    var cancel = h('button', { className: 'btn u-no', type: 'button', text: 'Cancel' });
    var problem = h('span', { className: 'reveal-problem' });

    reasonForm.appendChild(h('label', { className: 'sr', for: reasonId, text: 'Reason for revealing ' + (field.label || field.key) }));
    reasonForm.appendChild(h('div', { className: 'field' }, [reasonBox]));
    reasonForm.appendChild(h('div', { className: 'u-acts' }, [confirm, cancel, problem]));

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
        problem.textContent = 'Add a reason.';
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
        var noteText = 'Hides in ' + countdownLabel(ms) + (serverSaid ? '' : ' (page limit)') +
          ' · ' + (onRecord ? 'Logged' : 'No record confirmed');

        shown.textContent = out.value === null || out.value === undefined ? 'Not reported' : String(out.value);
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
          : shell.failureMessage(err);
        reasonBox.focus();
      });
    });

    row.appendChild(revealBtn);
    row.appendChild(hideBtn);
    row.appendChild(reasonForm);
    return row;
  }

  /* ------------------------------------------------------------- rows */

  /* A label and a value, as a <dt> and a <dd> so the pairing survives a screen
     reader reading down the column, which a pair of styled divs does not. */
  function dataRow(label, node) {
    var dd = h('dd', { className: 'u-v' });
    if (node) dd.appendChild(node);
    return h('div', { className: 'u-row' }, [h('dt', { className: 'u-k', text: label }), dd]);
  }

  function textValue(text) {
    return h('span', { text: text });
  }

  function fieldsByKey(fields) {
    var map = {};
    (fields || []).forEach(function (f) {
      if (f && f.key && !Object.prototype.hasOwnProperty.call(map, f.key)) map[f.key] = f;
    });
    return map;
  }

  /* What a plain field says, worded for reading. A value this does not
     recognise is printed as it arrived, so a new value is never mistaken for
     a different one. */
  function plainNode(field) {
    var value = field.value;
    if (value === null || value === undefined || value === '') {
      return h('span', { className: 'u-dim', text: 'Not reported' });
    }
    var raw = String(value);
    switch (field.key) {
      case 'authProvider':
        return textValue(words(raw));
      case 'emailVerified':
        if (raw === 'Verified') {
          var yes = h('span', { className: 'u-dotword' });
          yes.appendChild(h('span', { className: 'u-tick' }, [icon('check')]));
          yes.appendChild(h('span', { text: 'Yes' }));
          return yes;
        }
        return textValue(raw === 'Not verified' ? 'No' : raw);
      case 'lastSignInAt':
      case 'currentPeriodStart':
      case 'currentPeriodEnd':
        return textValue(stamp(raw) ? stamp(raw) + ' UTC' : raw);
      default:
        return textValue(raw);
    }
  }

  function rowNode(reference, field) {
    return isPlain(field) ? plainNode(field) : fieldValue(reference, field);
  }

  /* The card's own fields past the ones it leads with, behind one control. The
     reveal rules still apply to every one of them, so a guardian's address is
     as reachable as it ever was. */
  function moreRows(reference, extras) {
    var list = h('dl', { className: 'u-rows u-extra', id: 'more-' + reference + '-' + extras.length, hidden: 'hidden' });
    extras.forEach(function (f) {
      list.appendChild(dataRow(f.label || f.key, rowNode(reference, f)));
    });
    return list;
  }

  function moreToggle(list) {
    var btn = h('button', {
      className: 'u-link', type: 'button',
      'aria-expanded': 'false', 'aria-controls': list.getAttribute('id'), text: 'More'
    });
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      if (open) list.removeAttribute('hidden');
      else list.setAttribute('hidden', 'hidden');
    });
    return btn;
  }

  /* -------------------------------------------------------- the account */

  /* The initial the API's own mask already shows, or nothing. */
  function initialOf(detail) {
    var fields = (detail.record && detail.record.fields) ||
      (detail.summary && detail.summary.fields) || [];
    var name = fieldsByKey(fields).displayName;
    if (!name || isPlain(name) || name.reveal !== 'allowed' || typeof name.maskedValue !== 'string') return null;
    var first = name.maskedValue.trim().charAt(0);
    try { return /^\p{L}$/u.test(first) ? first.toUpperCase() : null; } catch (e) { return null; }
  }

  function resultHead(detail) {
    var head = h('div', { className: 'u-head' });

    var av = h('span', { className: 'u-av', 'aria-hidden': 'true' });
    var initial = initialOf(detail);
    if (initial) av.appendChild(document.createTextNode(initial));
    else av.appendChild(icon('person'));
    head.appendChild(av);

    var id = h('div', { className: 'u-id' });
    id.appendChild(h('h2', { className: 'u-ref', text: detail.reference }));
    var meta = h('div', { className: 'u-meta' });
    meta.appendChild(stateWord(detail.state));
    meta.appendChild(tierWord(detail.tier));
    var since = dayLabel(detail.memberSince);
    if (since) meta.appendChild(h('span', { text: 'Member since ' + since }));
    id.appendChild(meta);
    head.appendChild(id);

    var ro = h('div', { className: 'u-ro' });
    ro.appendChild(icon('lock'));
    ro.appendChild(h('span', { text: 'Read only' }));
    head.appendChild(ro);
    return head;
  }

  function accountCard(detail) {
    var box = shell.card();
    box.appendChild(shell.cardHead('Account'));

    var fields = ((detail.record && detail.record.fields) ||
      (detail.summary && detail.summary.fields) || []).filter(function (f) { return f && !isWithheld(f); });
    var byKey = fieldsByKey(fields);
    var led = {};

    var body = h('div', { className: 'card-body' });
    var rows = h('dl', { className: 'u-rows' });
    ACCOUNT_ROWS.forEach(function (spec) {
      var f = byKey[spec[0]];
      if (!f) return;
      led[spec[0]] = true;
      rows.appendChild(dataRow(spec[1], rowNode(detail.reference, f)));
    });
    body.appendChild(rows);

    var extras = fields.filter(function (f) {
      return !led[f.key] && !HEAD_KEYS[f.key];
    });
    var foot = h('div', { className: 'u-foot' });
    var line = h('p', { className: 'u-fine' });
    line.appendChild(icon('lock'));
    line.appendChild(h('span', { text: 'Owner only · Reason required · Logged' }));
    foot.appendChild(line);
    if (extras.length) {
      var more = moreRows(detail.reference, extras);
      foot.appendChild(moreToggle(more));
      body.appendChild(foot);
      body.appendChild(more);
    } else {
      body.appendChild(foot);
    }

    if (detail.record && detail.record.note) {
      body.appendChild(h('p', { className: 'u-fine', text: detail.record.note }));
    }
    box.appendChild(body);
    return box;
  }

  function billingCard(detail) {
    var box = shell.card();
    box.appendChild(shell.cardHead('Subscription'));
    var billing = detail.billing;
    var fields = ((billing && billing.fields) || []).filter(function (f) { return f && !isWithheld(f); });

    if (!fields.length) {
      /* Named by tier when the API gave one, because an empty subscription
         means different things on different tiers and this pane cannot tell
         which. Saying the tier leaves the reading to the operator. */
      var tier = detail.tier && (detail.tier.label || detail.tier.key);
      box.appendChild(h('div', { className: 'card-body' }, [
        h('p', { className: 'u-empty', text: tier ? 'No subscription · ' + tier : 'No subscription' })
      ]));
      return box;
    }

    var byKey = fieldsByKey(fields);
    var rows = h('dl', { className: 'u-rows' });

    function plainOf(key) {
      var f = byKey[key];
      return f && isPlain(f) && f.value !== null && f.value !== undefined && f.value !== ''
        ? String(f.value) : null;
    }

    if (byKey.tier) {
      var tierValue = plainOf('tier');
      rows.appendChild(dataRow('Tier', tierValue ? textValue(words(tierValue)) : rowNode(detail.reference, byKey.tier)));
    }
    if (byKey.billingStatus) {
      var status = plainOf('billingStatus');
      rows.appendChild(dataRow('Status', status
        ? dotWord(STATUS_TONE[String(status).toLowerCase()] || '', words(status))
        : rowNode(detail.reference, byKey.billingStatus)));
    }
    if (byKey.billingPlatform) {
      var store = plainOf('billingPlatform');
      rows.appendChild(dataRow('Store', store
        ? textValue(STORES[String(store).toLowerCase()] || words(store))
        : rowNode(detail.reference, byKey.billingPlatform)));
    }
    if (byKey.billingCycle) {
      var cycle = plainOf('billingCycle');
      rows.appendChild(dataRow('Cycle', cycle ? textValue(words(cycle)) : rowNode(detail.reference, byKey.billingCycle)));
    }

    var from = dayLabel(plainOf('currentPeriodStart'));
    var until = dayLabel(plainOf('currentPeriodEnd'));
    if (from && until) rows.appendChild(dataRow('Period', textValue(from + '–' + until)));
    if (until) rows.appendChild(dataRow('Access until', textValue(until)));

    var body = h('div', { className: 'card-body' }, [rows]);

    var extras = fields.filter(function (f) { return !BILLING_KEYS[f.key]; });
    if (extras.length) {
      var more = moreRows(detail.reference + '-billing', extras);
      body.appendChild(h('div', { className: 'u-foot u-foot-end' }, [moreToggle(more)]));
      body.appendChild(more);
    }
    box.appendChild(body);
    return box;
  }

  function devicesCard(detail) {
    var box = shell.card();
    box.appendChild(shell.cardHead('Devices'));
    var devices = detail.devices || [];

    if (!devices.length) {
      box.appendChild(h('div', { className: 'card-body' }, [
        h('p', { className: 'u-empty', text: 'No device reported' })
      ]));
      return box;
    }

    var body = h('div', { className: 'card-body u-devices' });
    devices.forEach(function (d) {
      var one = h('div', { className: 'u-dev' });
      var name = h('div', { className: 'u-dev-name' }, [
        h('span', { className: 'u-strong', text: d.label || 'Unnamed device' })
      ]);
      if (d.os) name.appendChild(h('span', { className: 'u-dim', text: d.os }));
      var seen = stamp(d.lastSeenAt);
      one.appendChild(h('div', { className: 'u-dev-top' }, [
        name,
        h('span', { className: 'u-dev-seen', text: seen ? 'Last seen ' + seen + ' UTC' : 'Last seen not reported' })
      ]));
      one.appendChild(h('dl', { className: 'u-rows' }, [
        dataRow('App version', h('span', { className: d.appVersion ? '' : 'u-dim', text: d.appVersion || 'Not reported' }))
      ]));
      body.appendChild(one);
    });
    box.appendChild(body);
    return box;
  }

  function windowNote(activity, fallback) {
    var days = activity && activity.windowDays;
    return h('span', { className: 'u-win', text: (days ? plural(days, 'day') + ' · ' : '') + 'UTC' + (fallback || '') });
  }

  function activityCard(detail) {
    var box = shell.card();
    var activity = detail.activity;
    box.appendChild(shell.cardHead('Recent activity', null, activity ? [windowNote(activity)] : null));

    var events = (activity && activity.events) || [];
    if (!events.length) {
      /* Two different facts. An account that has not shared activity is not a
         quiet account, and drawing them the same would read the first as the
         second. */
      box.appendChild(h('div', { className: 'card-body' }, [
        h('p', { className: 'u-empty', text: activity ? 'No activity' : 'Not shared' })
      ]));
      return box;
    }

    var list = h('ul', { className: 'u-list' });
    events.forEach(function (ev) {
      var label = ev.label || 'Activity';
      /* Only a link when the API gave one, and only ever to another pane in
         this dashboard. safeHref is what makes that second half true rather
         than a claim: an off-origin href renders as the plain label it would
         otherwise link from, so a page with somebody's account open cannot
         be turned into a referrer leak by a payload. */
      var href = ev.reference ? safeHref(ev.href) : null;
      var what = h('span', { className: 'u-what' });
      if (href) what.appendChild(h('a', { className: 'u-link', href: href, text: label }));
      else what.appendChild(document.createTextNode(label));
      if (ev.tone === 'warn' || ev.tone === 'crit') {
        what.appendChild(h('span', { className: 'sr', text: ', needs a look' }));
      }
      list.appendChild(h('li', {}, [
        h('span', { className: 'u-when', text: stamp(ev.occurredAt) || 'Time not reported' }),
        what
      ]));
    });
    box.appendChild(list);
    return box;
  }

  /* The record of who has opened this account. It is built so that it would be
     safe to show the athlete it belongs to, which is why it is on the page
     and open rather than behind a control. */
  function accessCard(detail) {
    var access = detail.access;
    var box = shell.card();
    box.appendChild(shell.cardHead('Access history', null, access ? [windowNote(access)] : null));

    var entries = (access && access.entries) || [];
    if (!entries.length) {
      box.appendChild(h('div', { className: 'card-body' }, [
        h('p', { className: 'u-empty', text: access ? 'No access recorded' : 'Not reported' })
      ]));
      return box;
    }

    /* The explicit roles are not redundant: the phone layout lays rows out
       with display:grid, which makes a browser drop a table's own semantics. */
    var table = h('table', { className: 'u-log', role: 'table' });
    table.appendChild(h('caption', { className: 'sr', text: 'Recorded access to this account' }));
    table.appendChild(h('thead', { role: 'rowgroup' }, [
      h('tr', { role: 'row' }, ['When', 'Who', 'Fields', 'Reason'].map(function (name) {
        return h('th', { scope: 'col', role: 'columnheader', text: name });
      }))
    ]));

    var tbody = h('tbody', { role: 'rowgroup' });
    entries.forEach(function (e) {
      var who = h('td', { role: 'cell' });
      var actor = e.actor || 'Not reported';
      var lead = h('span', { className: 'u-who' });
      lead.appendChild(h('span', { className: 'who-av', 'aria-hidden': 'true', text: /^[\p{L}\p{N}]/u.test(actor) ? actor.charAt(0).toUpperCase() : '·' }));
      lead.appendChild(h('span', { className: 'u-actor', text: actor }));
      who.appendChild(lead);

      /* A revealed entry is marked with a word, because "somebody read a
         personal field" is the row on this table that an athlete reading it
         would care about most, and colour is the one channel they may not
         have. */
      var fieldsCell = h('td', { role: 'cell' });
      if (e.revealed) {
        var flag = h('span', { className: 'u-revealed' });
        flag.appendChild(icon('eye'));
        flag.appendChild(h('span', { text: e.fields ? 'Revealed ' + e.fields : 'Revealed' }));
        fieldsCell.appendChild(flag);
      } else {
        fieldsCell.appendChild(document.createTextNode(e.fields || 'Summary only'));
      }

      tbody.appendChild(h('tr', { role: 'row' }, [
        h('td', { role: 'cell', className: 'u-when', text: stamp(e.occurredAt) || 'Not reported' }),
        who,
        fieldsCell,
        h('td', { role: 'cell', text: e.reason || 'No reason' })
      ]));
    });
    table.appendChild(tbody);
    box.appendChild(table);
    return box;
  }

  /* ------------------------------------------------------------- states */

  function stateCard(iconName, title, lines) {
    var box = shell.card();
    box.appendChild(shell.stateBlock(iconName, title, lines, 3));
    return box;
  }

  function loadingCard() {
    return h('div', { className: 'card' }, [
      h('div', { className: 'card-body' }, [
        h('p', { className: 'sr', role: 'status', text: 'Loading account' }),
        h('div', { className: 'skel skel-row', 'aria-hidden': 'true' }),
        h('div', { className: 'skel skel-row', 'aria-hidden': 'true' })
      ])
    ]);
  }

  function idleState() {
    return stateCard('search', 'Nothing looked up yet', ['An exact reference or email, and a reason.']);
  }

  function noMatchState(identifier) {
    var box = stateCard('search', 'No account found', ['Matches are exact.']);
    if (identifier) {
      box.querySelector('.state-block').appendChild(h('div', { className: 'row mt-sm' }, [code(identifier)]));
    }
    return box;
  }

  function errorState(err, retry) {
    var missing = err && err.code === 'ops_route_missing';
    var box = missing
      ? stateCard('plug', 'No API yet', ['This deployment does not answer account lookups.'])
      : stateCard('warn', 'Could not look that up', [shell.failureMessage(err)]);

    if (retry) {
      var again = h('button', { className: 'btn btn-sm', type: 'button', text: 'Try again' });
      again.addEventListener('click', function () {
        refocus = true;
        retry();
      });
      box.querySelector('.state-block').appendChild(h('div', { className: 'row mt-sm' }, [again]));
    }
    return box;
  }

  /* ------------------------------------------------------------ wiring */

  var content = null;
  var region = null;
  var resultRegion = null;
  var lastResult = null;
  var lastIdentifier = '';
  var lastReason = '';
  var selectedRef = null;
  var seq = 0;
  /* Whether a lookup has been issued since the last time the result was
     cleared, landed or not. lastResult cannot answer that: it is null both
     before the first lookup and while one is in flight, and those need
     different handling when a narrowing changes. */
  var looked = false;
  /* Set by Try again. Redrawing the result removes the button that held focus,
     and focus falls to the body unless it is put somewhere on purpose. */
  var refocus = false;

  function paintResult(node) {
    if (!resultRegion) return;
    clear(resultRegion);
    if (node) resultRegion.appendChild(node);
  }

  /* After the region is shown again, because focus cannot be placed on
     something that is still display:none. */
  function landFocus() {
    if (!refocus || !resultRegion) return;
    refocus = false;
    var head = resultRegion.querySelector('.state-title, .u-ref, .card-title');
    if (!head) return;
    head.setAttribute('tabindex', '-1');
    head.focus();
  }

  function runLookup() {
    var identifier = (identifierInput.value || '').trim();
    var reason = (reasonInput.value || '').trim();

    if (!identifier) {
      setFormError('Enter an account.');
      identifierInput.setAttribute('aria-invalid', 'true');
      identifierInput.focus();
      return;
    }
    if (reason.length < 3) {
      setFormError('Add a reason.');
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
    /* Kept as it was typed when Search was pressed, not read back from the
       field later: the operator may edit the box before they pick an account,
       and the record of opening it should carry the reason the lookup was
       made under. */
    lastReason = reason;

    var mine = ++seq;
    looked = true;
    region.loading([{ type: 'rows', count: 3 }]);

    session.call('/api/ops/users/lookup', {
      method: 'POST',
      body: {
        identifier: identifier,
        reason: reason,
        scope: scopeSelect.value || 'all',
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
      landFocus();
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
      landFocus();
      shell.announce('No account found');
      return;
    }

    var stack = h('div', { className: 'stack' });
    var notice = recordingNotice(lastResult.recorded, 'this lookup');
    if (notice) stack.appendChild(notice);

    /* One match is not a choice, so it is opened rather than offered. The card
       is still drawn for a result whose count disagrees with its rows, because
       that warning is not about whether there is anything to pick. */
    var gap = countShortfall(lastResult);
    if (matches.length > 1 || gap) {
      stack.appendChild(matchesCard(lastResult, selectAccount, selectedRef));
    }

    stack.appendChild(h('div', { className: 'stack', id: 'accountColumn' }, [
      matches.length > 1 ? stateCard('person', 'Pick an account', []) : loadingCard()
    ]));
    paintResult(stack);
    settle(lastResult.recorded);
    landFocus();

    shell.announce(gap
      ? gap.rows + ' of ' + plural(gap.claimed, 'account') + ' shown'
      : matches.length === 1 ? '1 account matched' : matches.length + ' accounts matched');

    if (matches.length === 1) selectAccount(matches[0].reference);
  }

  function selectAccount(reference) {
    selectedRef = reference;
    clearReveals();

    /* Before the request, not after it. The row is what the operator just
       acted on, and a list that only marks the pick once the account has
       answered leaves the one control on the page with no feedback for the
       length of a network round trip, which is most of the time anybody is
       looking at it. */
    renderSelectedRow();

    var column = document.getElementById('accountColumn');
    if (!column) return;
    clear(column);
    column.appendChild(loadingCard());

    var mine = ++seq;
    session.call('/api/ops/users/' + encodeURIComponent(reference), {
      query: { reason: lastReason }
    }).then(function (payload) {
      if (mine !== seq) return;
      var detail = (payload && payload.data) || {};
      detail.reference = detail.reference || reference;

      var col = document.getElementById('accountColumn');
      if (!col) return;
      clear(col);

      /* Opening an account is its own access record, so the same check the
         lookup gets is made here: a response that confirmed nothing must not
         look like one that did. */
      var notice = recordingNotice(detail.recorded, 'opening this account');
      if (notice) col.appendChild(notice);

      col.appendChild(resultHead(detail));
      col.appendChild(h('div', { className: 'grid g2' }, [accountCard(detail), billingCard(detail)]));
      col.appendChild(h('div', { className: 'grid g2' }, [devicesCard(detail), activityCard(detail)]));
      col.appendChild(accessCard(detail));

      settle(lastResult && lastResult.recorded && detail.recorded);
      landFocus();

      /* The same fact the note above reports. Announcing "opened and recorded"
         over a warning that says no record was confirmed would leave a screen
         reader with the one version of events the page has just said it cannot
         vouch for. */
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
      landFocus();
    });
  }

  function renderSelectedRow() {
    if (!resultRegion) return;
    Array.prototype.forEach.call(resultRegion.querySelectorAll('.match-row'), function (row) {
      var pick = row.querySelector('.match-row-btn');
      applySelection(row, !!pick && pick.getAttribute('data-ref') === selectedRef);
    });
  }

  /* A narrowing is part of the query, so anything already out was asked under
     a value that is no longer on screen. The sequence is bumped whether or not
     a result has landed: leaving it alone let an in-flight lookup resolve and
     render under the old value while the control showed the new one, which is
     the pane silently answering a question nobody asked. Anything revealed
     under the old value goes back behind its mask.

     Refiltering is a new lookup, and a new lookup is a new access record, so it
     is not run behind the operator's back. The result is drawn over whenever a
     lookup has been run, in flight or landed, because the skeleton of a
     lookup that has just been invalidated would otherwise sit on screen
     forever. */
  function narrowingChanged() {
    ++seq;
    clearReveals();
    if (!looked || !resultRegion) return;
    paintResult(stateCard('search', 'Filters changed', ['Search again to apply them.']));
    region.empty(resultRegion);
    lastResult = null;
    selectedRef = null;
    looked = false;
  }

  /* The header's "Look up a user" hands over what was typed and nothing else:
     no search runs, because this pane owns the reason a lookup is audited
     under. The identifier is filled in and the cursor is put on the field that
     is still empty, so pressing Enter in the header is one step short of a
     lookup rather than a lookup with no reason. It came through sessionStorage
     rather than the address, so it is never in a log or a shared link.

     On the first draw the application is still behind the ready gate, and a
     browser ignores focus() on anything it is hiding, so the field is
     focused when ops:ready says the gate has gone. */
  function receiveLookup(untilReady) {
    var typed = global.Aria && global.Aria.takeLookup ? global.Aria.takeLookup() : '';
    if (!typed || !identifierInput) return;
    identifierInput.value = typed;
    setFormError('');
    if (!reasonInput) return;
    if (!untilReady) {
      reasonInput.focus();
      return;
    }
    global.addEventListener('ops:ready', function focusReason() {
      global.removeEventListener('ops:ready', focusReason);
      if (reasonInput) reasonInput.focus();
    });
  }

  /* The date, in the slot the shell leaves under the title. */
  function drawHead() {
    var slot = document.getElementById('pageSub');
    if (!slot) return;
    clear(slot);
    slot.appendChild(h('span', { className: 'sub-date', text: headDate() }));
  }

  global.addEventListener('ops:lookup', function () { receiveLookup(false); });

  /* The shell calls this once, with the pane's content region, after the
     session is confirmed and the document has finished parsing. A pane with no
     registration renders the not-built state, so there is no flag anywhere
     claiming this pane is built: the fact is this file being on the page. */
  shell.definePane('users', function (host) {
    content = host;
    drawHead();

    var root = h('div', { className: 'stack users' });
    content.appendChild(root);
    root.appendChild(searchStrip(runLookup, narrowingChanged));

    region = shell.region(root);
    receiveLookup(true);
    resultRegion = h('div', { className: 'stack', id: 'lookupResult' });
    resultRegion.appendChild(idleState());
    region.empty(resultRegion);
  });
})(window);
