/* What happened: why did this fail, and is it happening to other people?

   WHAT CHANGED, AND WHY THE OLD DOCBLOCK IS GONE

   This pane used to say, at the top of this file, that there was no per-run
   record behind it and nothing served one. That was true and it is no longer:
   Stadiora/Aria#5561 landed job_lifecycle_events, an append-only log of every
   transition a generation job makes, and #5563 put GET /api/ops/runs over it.
   The alerting record this pane used to draw is still real and still worth
   reading, but it lives on the Problems pane, which owns it. This page now
   draws the runs themselves.

   WHAT IT READS

     GET /api/ops/runs ?range&type&outcome&limit
       -> { data: { window, selection, coverage, summary, facets,
                    failures[], runs[], truncated } }

     GET /api/ops/runs/:jobId ?range
       -> { data: { window, run, stages[], stagesTruncated, shared } }

   The second read only happens when an operator opens a run, and its failure
   degrades this pane rather than emptying it: the window above it is still
   true.

   THREE EMPTIES, AND WHY THEY MUST NOT LOOK ALIKE

   coverage.state is the whole reason this pane can be trusted, and it has
   three values because there are three different things an empty screen can
   mean:

     never_recorded  the table holds nothing at all. The writer may never have
                     deployed. This is NOT "no runs failed" and the pane says
                     so in its own words, with no figures under it.
     partial         recording started inside the window being read. The
                     figures are real but they do not cover the whole window,
                     and the pane says from when.
     ready           the record reaches back past the start of the window. An
                     empty window here is a genuinely quiet one.

   A pane that printed "0 failed" over the first of those would be telling an
   operator the system is healthy using data it never received. PR #98 fought
   this on the Overview pane and PR #106 found the same shape in a source scan;
   this is the same rule, applied to a different read.

   WHAT IS ABSENT RATHER THAN ZERO

   Every figure that can be unmeasured is drawn as words when it is. A median
   nobody could measure prints "Not measured", never 0ms, and every median
   carries the count it was taken over, because a p50 over 3 of 4,000 runs is
   not the same claim as a p50 over 4,000. Runs with no recorded duration keep
   an em dash. The API sends null for all of these and this pane never coalesces
   one to a number.

   THE REFRESH MECHANISM, AND WHAT STOPS IT WHEN THE OPERATOR LEAVES

   Nothing is started, so nothing has to be stopped.

   This pane reads once per selection: on load, when the window changes, when
   the request type or outcome changes, and when somebody presses Read again.
   There is no timer, no interval and no visibility listener. That is a
   deliberate choice rather than an omission, and it is the right one for this
   page specifically: this is the past tense. A run that finished is finished,
   and re-reading a 7-day window every thirty seconds spends a database read to
   redraw the same rows. Happening now (#5562) is the pane that must move on
   its own, because the thing it draws moves on its own.

   It also settles a class of bug this dashboard has already had: a pane that
   starts an interval and does not stop it keeps reading after the operator has
   gone (#5543). The strongest version of "what stops it" is that there was
   never anything running. The read is stamped instead, so the operator can see
   how old the figures are, and Read again is one press away.

   WHAT THIS PANE STILL CANNOT ANSWER, AND WHY

   Named on screen in a band of its own rather than drawn as an empty figure,
   because an operator who does not know a figure is missing assumes it was
   fine. All four are facts about the storage:

     what a run cost      job_lifecycle_events records no price. The approved
                          mock shows a per-run dollar figure; there is nothing
                          behind it, and an invented one is worse than a gap.
     who it was for       deliberate, and the strongest of the four. See below.
     which app asked      neither job_lifecycle_events nor generation_jobs
                          carries a client app or an environment, so a facet
                          by app would be a control narrowing nothing.
     refused              the mock shows Refused as a fourth outcome. Storage
                          has three terminal states and a safety refusal is not
                          one of them; a refused request completes.

   NO ACCOUNT IDENTITY IS PUBLISHED AT ALL

   Not masked here, not coded here: never sent. The route names user_id only
   inside COUNT(DISTINCT ...), so the only thing that crosses the wire about
   people is how many of them a fault reached.

   That is a stronger guarantee than the one this pane used to make, and the
   reason is worth writing down: job_lifecycle_events has no consent column.
   Client telemetry is gated at ingest; this table is not, so there is no flag
   a faceted search could be filtered on. A pane that published identities and
   filtered them would be relying on a filter that cannot be checked against
   anything. Publishing none cannot silently stop being true.

   coded() survives anyway, over every payload string this pane draws. Not
   because the payload is expected to carry an address, but because "the API
   does not send one" is a fact about today's route and this is a floor rather
   than a trust. */

(function (global) {
  'use strict';

  var S = global.OpsPaneShell;
  var session = global.OpsSession;
  var h = S.h;
  var icon = S.icon;
  var fmt = S.fmt;
  var maskContactDetails = global.OpsPaneRegistry.maskContactDetails;
  var jobActions = global.OpsJobActions || { controls: emptyJobActionControls };

  var RUNS_ENDPOINT = '/api/ops/runs';
  var PAGE = 50;

  var WINDOW_LABEL = {
    '24h': 'the last 24 hours',
    '7d': 'the last 7 days',
    '30d': 'the last 30 days'
  };

  /* The panes that own the questions this one does not. Both are doorways. */
  var USERS_FILE = 'users.html';
  var JOBS_FILE = 'jobs-live.html';
  var ALERTS_FILE = 'alerts.html';

  function emptyJobActionControls() {
    return h('div', { className: 'job-action-stack' });
  }

  /* ------------------------------------------------------------- privacy */

  /* The three things a run carries that are not this pane's to show, at any
     role. They are named because naming them is the point: a reveal is
     recorded by field name, so the names have to exist somewhere a person can
     read them, and they have to be the same names the record would use.

     Each carries a key and a label and nothing else. No masked flag, no reveal
     flag, no value: disclosure() below is what makes them hidden, so an API
     that later sends one of these keys with a value attached cannot unmask it
     by saying it is not personal. */
  var RUN_CONTENT = [
    { key: 'request', label: 'What was asked' },
    { key: 'response', label: 'What Aria answered' },
    { key: 'athleteDetails', label: 'Athlete details the run read' }
  ];

  var RUN_CONTENT_KEY = {};
  RUN_CONTENT.forEach(function (field) { RUN_CONTENT_KEY[field.key] = true; });

  function isRunContentKey(key) {
    return Object.prototype.hasOwnProperty.call(RUN_CONTENT_KEY, key);
  }

  /* What shape a field row takes. Deliberately narrower than the Look up a
     user pane's equivalent, and narrow in the safe direction: that pane can
     print a value the API says is not personal, because it has a reveal route
     and an access record behind it. This one has neither, so it has no branch
     that prints a value at all.

       run content        never shown here, whatever the payload says
       reveal 'never'     never shown here, whatever else the entry carries
       reveal 'allowed'   recorded where the account is, not here
       anything else      hidden, with no way to ask

     'allowed' does not become a control here. A control that cannot succeed
     still tells an operator the value is within reach, which PR #58 settled is
     worse than no control, so this pane draws a sentence instead. And run
     content outranks every other flag: a payload that marks it as not personal
     is a payload disagreeing with itself, and a contradiction must not be the
     thing that decides a disclosure. */
  function disclosure(field) {
    if (isRunContentKey(field.key) || field.reveal === 'never') return 'never';
    if (field.reveal === 'allowed') return 'elsewhere';
    return 'masked';
  }

  /* Anything that looks like a contact detail, replaced before it reaches the
     DOM. This pane prints service facts — a request type, a failure label, a
     model name — and none of them is a person. That is a property of today's
     payload rather than a promise the payload makes, so the pane enforces it
     instead of trusting it.

     The replacement names the kind of thing it hid rather than deleting it
     silently, because an operator reading a sentence with a hole in it needs
     to know a hole is what they are looking at. */
  function coded(text) {
    return maskContactDetails(text);
  }

  /* --------------------------------------------------------- the figures */

  /* A figure is a number only when it is one. Everything else renders words.

     A figure nobody recorded prints what it is instead, because a zero and an
     absence look identical once they are both set in the same type, and the
     confident reading is the wrong one. */
  function figureValue(figure) {
    if (figure.words) return { text: figure.words, words: true };
    return { text: figure.text, words: false };
  }

  function figureCard(figure) {
    var box = S.card('kpi');
    var body = h('div', { className: 'card-body' });
    body.appendChild(h('div', { className: 'kpi-label', text: figure.label }));

    var value = figureValue(figure);
    body.appendChild(h('div', {
      className: 'kpi-val' + (value.words ? ' words' : ''),
      text: value.text
    }));

    if (figure.note) {
      body.appendChild(h('div', { className: 'kpi-meta' }, [
        h('span', { text: figure.note })
      ]));
    }
    box.appendChild(body);
    return box;
  }

  /* --------------------------------------------------------- durations */

  /* Milliseconds, as a person reads them. Null is not zero and never becomes
     a numeral: it is the em dash the rest of the dashboard uses for absence. */
  function ms(value) {
    if (typeof value !== 'number' || !isFinite(value) || value < 0) return null;
    if (value < 1000) return Math.round(value) + 'ms';
    if (value < 10000) return (Math.round(value / 100) / 10) + 's';
    if (value < 60000) return Math.round(value / 1000) + 's';
    var minutes = Math.floor(value / 60000);
    var seconds = Math.round((value % 60000) / 1000);
    if (seconds === 60) { minutes += 1; seconds = 0; }
    return minutes + 'm' + (seconds ? ' ' + seconds + 's' : '');
  }

  /* fmt.utcStamp returns null for anything it cannot parse, and a null read
     straight into a sentence prints the word "null" in place of a time. Every
     timestamp this pane draws goes through here. */
  function at(iso) {
    return fmt.utcStamp(iso) || fmt.none;
  }

  function msOrNone(value) {
    var text = ms(value);
    return text === null ? fmt.none : text;
  }

  /* A median and the count it was taken over, as one sentence.

     The count is never dropped, even when it equals the run count: "half of
     4,000 runs" and "half of the 3 runs that recorded a duration" are
     different claims, and a bare p50 cannot tell them apart. */
  function measuredNote(measured, total) {
    if (!measured) return 'nothing recorded a figure to measure';
    if (measured === total) return 'measured on all ' + fmt.int(total) + ' of them';
    return 'measured on ' + fmt.int(measured) + ' of ' + fmt.int(total);
  }

  /* ------------------------------------------------------------ the pane */

  S.definePane('history', function (content) {
    var region = S.region(content);
    var loadToken = 0;
    var current = S.filters();

    /* Pane-local narrowing. The shell's filter bar carries the window; request
       type and outcome are read from the facet list the API sends back, so the
       controls can only ever offer values the window actually holds. A control
       built from a fixed list would offer a request type nobody has run. */
    var narrowing = { type: 'all', outcome: 'all' };

    var SKELETON = [
      { type: 'tiles', count: 4 },
      { type: 'rows', count: 6 },
      { type: 'block', height: 190 }
    ];

    /* The run an operator has opened, if any, and what came back for it.
       Cleared whenever the window or the narrowing changes, because a run
       drawn beside a different window's figures invites the comparison the
       detail is there to make and answers it wrongly. */
    var detail = null;
    var reveal = null;
    var revealGeneration = 0;
    var activeRevealDialog = null;

    /* When the figures on screen were read. Printed rather than implied: with
       no timer running, how old they are is the operator's to judge. */
    var readAt = null;
    var actionAnnouncement = null;

    /* The last window payload, kept so opening and closing a run can redraw
       without re-reading the window it sits in. */
    var lastWindow = null;

    global.addEventListener('resize', updateTableScrollerRegions);
    global.addEventListener('pagehide', clearOnPageExit);
    global.addEventListener('pageshow', function (event) {
      if (event && event.persisted) clearOnPageExit();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') clearOnPageExit();
    });

    /* The shell fires ops:filters with the starting selection once it is in
       the document, so the first read is that event rather than a call from
       here: reading in both places would double every request on boot and
       leave the two answers racing to land. */
    var booted = false;

    global.addEventListener('ops:filters', function (event) {
      var next = event.detail;
      var changed = !booted || next.range !== current.range;
      current = next;
      if (!changed) return;
      booted = true;
      load();
    });

    function load() {
      var token = ++loadToken;
      var selection = current;
      /* Every window read discards any open run, here rather than at each
         call site. Four of the six triggers nulled it themselves and two did
         not -- `Read again`, and `load` handed straight to the shell as its
         retry callback -- so a window read racing an in-flight detail read
         left `detail` at `{ loading: true }` for good: `openRun`'s callbacks
         correctly discard a landing they no longer own, and nothing then
         cleared the flag. The pane drew a `One run` band of two skeleton rows
         that never resolved, with no Close and nothing keyed in it, on every
         later redraw -- and `settleFocus()`'s in-flight exemption below read
         that stale flag, so unlanded requests stopped being dropped too.
         Measured in real Chrome at both viewports; the only way out was a
         trigger that happened to null it. One place, so there is no seventh
         trigger to forget. */
      detail = null;
         clearRevealed();
      /* Captured here, before anything is drawn, because after `region.failed()`
         the box is hidden and Chrome has already blurred to <body> -- the
         information cannot be reconstructed from the other side of the read.
         Round 4 used "a request is outstanding" as the proxy for "the operator
         is standing in the pane", and the two are not the same: `settleFocus()`
         clears the request when it lands, so pressing the retry the pane had
         just handed the operator, or arriving at a failure on first load and
         tabbing to it, found no request to redirect and dropped them back to
         <body>. Measured at 0 of 15 tab stops, both viewports. */
      var wasInPane = !!focusKeyNow();

      region.loading(SKELETON);

      window_(selection).then(function (result) {
        if (token !== loadToken) return;
        readAt = new Date().toISOString();
        render(result, selection);
        announceRead(result, selection);
        if (actionAnnouncement) {
          S.announce(actionAnnouncement);
          actionAnnouncement = null;
        }
      }, function (err) {
        if (token !== loadToken) return;
        region.failed(err, load);
        S.setBadge('history', null);
        /* The shell draws Try again, and it is the only control left on the
           pane. It carries no focus key of its own -- `shell-pane-v2.js` is
           shared by every pane and is not this PR's to change -- so the key is
           stamped on afterwards, from here. Measured before this: 13 tab stops
           from <body> to the retry, mid-incident, for the operator who just
           pressed Read again. */
        keyRetry();
        landOnRetry(wasInPane);
        settleFocus();
        /* Said as well as drawn. Without this the live region still holds the
           figures from the last successful read, so a screen reader is left
           standing behind numbers the pane has just stopped standing behind. */
        S.announce('The window could not be read. The figures on screen before this are ' +
          'unread now, not zero. Try again is the only control left on the pane.');
      });
    }

    /* The shell's retry button, given this pane's focus key so `settleFocus()`
       has somewhere to land. Found by walking the live panel for a button with
       no key rather than by a selector, because the shell owns the markup and
       may reshape it. */
    function keyRetry() {
      var content = document.getElementById('content');
      if (!content) return;
      var boxes = content.querySelectorAll('[data-state]');
      for (var b = 0; b < boxes.length; b += 1) {
        var state = boxes[b].getAttribute('data-state') || '';
        if (state.split(' ').indexOf('live') === -1) continue;
        var buttons = boxes[b].querySelectorAll('button');
        for (var i = 0; i < buttons.length; i += 1) {
          if (!buttons[i].getAttribute('data-rh-focus')) {
            buttons[i].setAttribute('data-rh-focus', 'rh-window-retry');
            return;
          }
        }
      }
    }

    /* The window read. Through the shell's loader so the same-origin fixture
       hook covers the states a live API will not produce on demand, which here
       is most of the interesting ones: a pipeline that was never connected, a
       record that starts mid-window, a window with nothing in it. */
    function window_(selection) {
      return S.read({
        paneId: 'history',
        endpoint: RUNS_ENDPOINT,
        query: {
          range: selection.range || '7d',
          type: narrowing.type,
          outcome: narrowing.outcome,
          limit: PAGE
        }
      }).then(function (result) { return result.data; });
    }

    /* One run. Carried as a value rather than a rejection, the same shape the
       Overview pane uses, so a failed detail read draws one failed card inside
       a pane whose other figures are still true. */
    function openRun(jobId, selection) {
      detail = { jobId: jobId, loading: true, data: null, error: null };
      clearRevealed();
      render(lastWindow, selection);
      S.announce('Opening one run.');

      var token = loadToken;
      session.call(RUNS_ENDPOINT + '/' + encodeURIComponent(jobId), {
        query: { range: selection.range || '7d' }
      }).then(function (payload) {
        if (token !== loadToken || !detail || detail.jobId !== jobId) return;
        detail = { jobId: jobId, loading: false, data: payload.data, error: null };
        render(lastWindow, selection);
        /* Said on arrival, not only on departure. The intent was announced
           before the read; without this a screen reader is told something is
           starting and never told how it ended. */
        S.announce(detailSentence(payload.data));
      }, function (err) {
        if (token !== loadToken || !detail || detail.jobId !== jobId) return;
        detail = { jobId: jobId, loading: false, data: null, error: err };
        render(lastWindow, selection);
        S.announce('That run could not be read. The window around it still came back.');
      });
    }

    /* Every exit from a redraw has to settle focus, and `draw()` has three of
       them. Round 3 put `settleFocus()` at the end of the body and the two
       empty states returned above it, so the two states an operator reaches by
       narrowing into a quiet window still dropped them to <body> -- the exact
       defect round 2 blocked on, surviving its own fix on two paths out of
       four. Wrapping is the shape that cannot regress that way: `draw()` may
       return wherever it likes. */
    function render(data, selection) {
      draw(data, selection);
      updateTableScrollerRegions();
      settleFocus();
    }

    function updateTableScrollerRegions() {
      var wraps = content.querySelectorAll('.tbl-wrap');
      for (var i = 0; i < wraps.length; i += 1) {
        var wrap = wraps[i];
        if (wrap.scrollWidth > wrap.clientWidth) {
          wrap.setAttribute('tabindex', '0');
          wrap.setAttribute('role', 'region');
          wrap.setAttribute('aria-label', wrap.getAttribute('data-scroll-label') || 'Scrollable table');
        } else {
          wrap.removeAttribute('tabindex');
          wrap.removeAttribute('role');
          wrap.removeAttribute('aria-label');
        }
      }
    }

    function draw(data, selection) {
      lastWindow = data;
      var coverage = (data && data.coverage) || { state: 'never_recorded' };
      var summary = (data && data.summary) || null;
      var runs = (data && data.runs) || [];
      var failures = (data && data.failures) || [];

      badge(coverage, summary, data);

      /* Nothing recorded at all is its own state and it is not an empty
         window. There are no figures to put under it, and putting zeroes there
         would be the pane asserting the system is quiet using a table it has
         never been written to. */
      if (coverage.state === 'never_recorded') {
        region.empty(neverRecorded(data));
        return;
      }

      /* A readable window with nothing in it. Separate from the above and
         worded so the two cannot be confused: this one has a record behind it,
         and the record says nothing finished. */
      if (!runs.length && summary && !summary.runs && !summary.unfinished) {
        region.empty(nothingFinished(data, coverage, selection));
        return;
      }

      var wrap = h('div', { className: 'stack' });
      wrap.setAttribute('data-rh-focus', 'rh-state');
      wrap.setAttribute('tabindex', '-1');
      wrap.appendChild(controls(data, selection));
      partialNote(coverage, wrap);
      if (data.truncated) {
        /* The second sentence names what the figures cover, and over a partly
           covered record that is NOT the picked window. Written when the
           footer still named the picked window, it survived the coverage work
           and turned into the one sentence on the screen contradicting the two
           around it -- phrased as the reassurance, and sitting directly above
           the figures, so an operator reading top-down met the false claim
           first. */
        wrap.appendChild(noteLine('warn',
          'The newest ' + fmt.int(data.selection.limit) + ' runs are listed, so the list below ' +
          'is the most recent part of this window rather than all of it. The figures above it ' +
          'are counted over ' + (partlyCovered(coverage)
            ? 'everything the record holds, which starts at ' + at(coverage.recordingSince) + '.'
            : 'the whole window.')));
      }
      wrap.appendChild(summaryBand(data, selection));
      if (failures.length) wrap.appendChild(failureBand(data, selection));
      wrap.appendChild(runsBand(data, selection));
      if (detail) wrap.appendChild(detailBand(selection));
      wrap.appendChild(privacyBand());
      wrap.appendChild(missingBand());

      /* Degraded is the pane on screen with one of its reads unusable. A
         failed detail read is exactly that: the window is true and one card
         inside it is not. */
      if (detail && detail.error) region.degraded(wrap);
      else region.show(wrap);
    }

    /* ------------------------------------------------------------- focus */

    /* Every redraw here replaces the whole pane, so the control the operator
       is standing on is destroyed under them and focus falls to <body>. From
       row forty of a window that is what it sounds like: past the skip link,
       ten rail items, the theme control, sign out, both pickers and every
       button above theirs to get back. `pane-spend.js` decided this one
       already; this is the same guard over six controls instead of one.

       Only when focus WAS on a control of this pane. A pointer user has focus
       nowhere in particular and moving it would be a jump they did not ask
       for, so a redraw from boot or from the shell's filter event moves
       nothing. */

    var wanted = null;
    var wantedFallback = null;

    function focusKeyNow() {
      var live = document.activeElement;
      return live && live.getAttribute ? live.getAttribute('data-rh-focus') : null;
    }

    /** Put focus back where it is, once the redraw has replaced that node. */
    function keepFocus() {
      /* With a fallback, because the control the operator is standing on may
         not survive the read they just asked for. Narrowing from a populated
         window into an empty one destroys the pickers and draws none, so
         `rh-type` resolves to nothing and the request is held forever with
         focus sitting at <body>. Empty states put `rh-state` on their heading;
         the live state puts it on the pane stack, so this fallback always
         lands on a connected focus target. */
      moveFocus(focusKeyNow(), 'rh-state');
    }

    /* Aim the failed read's landing at the shell's retry, which is the only
       control the failure card leaves on the pane. Takes the operator's
       position as it was BEFORE the read rather than testing for it now, for
       the reason `load()` explains. A read the operator was not standing in
       never moves them. */
    function landOnRetry(wasInPane) {
      if (!wasInPane) return;
      wanted = null;
      wantedFallback = 'rh-window-retry';
    }

    /* Make a card's heading a focus target. Empty and failure states have no
       control worth landing on, and the heading is the sentence that explains
       why -- so it is both the reachable node and the right one to read out. */
    function keyState(block) {
      var title = findFirst(block, function (n) {
        return /^H[1-6]$/.test(n.tagName || '');
      });
      if (!title) return block;
      title.setAttribute('data-rh-focus', 'rh-state');
      title.setAttribute('tabindex', '-1');
      return block;
    }

    function findFirst(node, want) {
      if (!node) return null;
      if (want(node)) return node;
      var kids = node.childNodes || [];
      for (var i = 0; i < kids.length; i += 1) {
        var hit = findFirst(kids[i], want);
        if (hit) return hit;
      }
      return null;
    }

    /** Ask for focus somewhere else, but only if it is here to begin with. */
    function moveFocus(key, fallback) {
      if (!focusKeyNow()) return;
      wanted = key || null;
      wantedFallback = fallback || null;
    }

    function forceFocus(key, fallback) {
      wanted = key || null;
      wantedFallback = fallback || null;
    }

    function byKey(key) {
      if (!key) return null;
      /* Matched by reading the attribute rather than by building a selector,
         because a key carries a job id that came off the wire. */
      var all = document.querySelectorAll('[data-rh-focus]');
      for (var i = 0; i < all.length; i += 1) {
        if (all[i].getAttribute('data-rh-focus') === key && onScreen(all[i])) return all[i];
      }
      return null;
    }

    /* A state box the shell is not showing keeps its children: `region.empty()`
       fills the empty box and aria.js moves `data-shown` to it, so the control
       the operator was standing on is still in the document under a
       `display:none`. Focusing it is worse than not settling at all -- the
       browser refuses, focus stays at <body>, and the pane believes it landed.
       So a key inside a hidden panel does not count as found. */
    function onScreen(node) {
      var cur = node;
      while (cur && cur !== document.documentElement) {
        if (cur.getAttribute && cur.getAttribute('data-state') !== null
          && cur.getAttribute('data-shown') === null) return false;
        cur = cur.parentNode;
      }
      return true;
    }

    /* One predicate, because four sites disagreeing about what "partial" means
       is how a heading ends up saying "since the record starts" over a footer
       printing the picked window. Both halves are required: a partial state
       with no instant cannot name where the record starts, so it is not
       something this pane can describe and is treated as full coverage. */
    function partlyCovered(coverage) {
      return !!(coverage && coverage.state === 'partial' && coverage.recordingSince);
    }

    /* What every window-scoped sentence on this screen has to name. Round 3
       blocked on the announcement saying "in the last 7 days" over a record
       three hours old, round 4 on the truncation note, and round 5 found the
       drawn twin of the round-3 sentence plus three more still saying it --
       so the span is one function now rather than a phrase each site spells
       for itself. */
    function coveredWords(coverage, selection, whenCovered) {
      return partlyCovered(coverage)
        ? 'what the record covers, which starts at ' + at(coverage.recordingSince)
        : (whenCovered || WINDOW_LABEL[selection.range] || 'the window you picked');
    }

    function settleFocus() {
      if (!wanted && !wantedFallback) return;
      var node = byKey(wanted) || byKey(wantedFallback);
      if (!node || !node.focus) {
        /* Held only while the read that will draw the target is still in
           flight: opening a run redraws twice -- once for the skeleton and
           once when it lands -- and Close only exists on the second. That
           hold is bound by `opening a run still lands on Close across the two
           redraws it takes`; dropping it unconditionally turns that test red.

           Otherwise dropped, because a request kept past its own redraw waits
           for some later, unrelated redraw to contain its target and then
           takes focus off whatever the operator moved to in the meantime.
           Review measured exactly that steal, off the shell's own Range
           picker, and it was reachable because the clear-narrowing site above
           asked for `rh-type` with no fallback.

           NOT BOUND BY A TEST, and deliberately so: with that fallback in
           place every remaining `moveFocus` call site names a key or a
           fallback the very next redraw draws, so no reachable sequence now
           strands a request, and a test claiming to prove this drop would
           pass with the drop removed. It is kept as the bound on the damage
           when some future site forgets its fallback -- mutation R5 in the
           round-5 battery is that site, and it is the pairing under which
           the steal reappears. */
        if (!(detail && detail.loading)) {
          wanted = null;
          wantedFallback = null;
        }
        return;
      }
      node.focus();
      wanted = null;
      wantedFallback = null;
    }

    /* What landed, for a screen that is listened to rather than looked at. The
       coverage state is said first because it changes what every figure after
       it means, and the never-recorded case has no figures to announce. */
    function announceRead(data, selection) {
      var words = WINDOW_LABEL[selection.range] || 'the window you picked';
      if (!data || !data.coverage || data.coverage.state === 'never_recorded') {
        S.announce('No run has ever been recorded. Nothing was counted for ' + words + '.');
        return;
      }
      var summary = data.summary;
      /* A partly-covered record does not get to name the window that was
         picked. Screen and speech publish the same span or they are two
         different claims about the same figure -- and the measured version of
         this said "0 runs finished in the last 7 days" over a record three
         hours old, which is the screen defect review blocked on, surviving in
         the live region after the screen was fixed. */
      if (partlyCovered(data.coverage)) {
        S.announce('Partly covered: ' +
          fmt.plural(summary.runs, 'run', 'runs') + ' finished since the record starts at ' +
          at(data.coverage.recordingSince) + ', which is inside ' + words + '. ' +
          fmt.int(summary.failed) + ' failed. The rest of ' + words + ' is unread.');
        return;
      }
      S.announce(
        fmt.plural(summary.runs, 'run', 'runs') + ' finished in ' + words + ', ' +
        fmt.int(summary.failed) + ' failed.');
    }

    /* The run that just landed, said rather than shown. Outcome first: it is
       what the operator opened the run to find out. */
    function detailSentence(data) {
      var run = data && data.run;
      if (!run) return 'That run came back.';
      var when = fmt.utcStamp(run.finishedAt);
      return coded(run.type.label) + ', ' + (coded(run.outcomeLabel) || 'still going') +
        (when ? ', finished ' + when : '') + '. ' +
        fmt.plural((data.stages || []).length, 'step', 'steps') + ' recorded.';
    }

    /* The count beside the rail item. A real read or nothing.

       Cleared rather than zeroed on an unread or never-recorded pipeline, for
       the reason PR #98 settled on Overview: a badge reading 0 over data the
       pane never received is the pane stating as fact the one thing it does
       not know. */
    /* The rail carries this pane's one figure, so it carries what the figure
       covers. The read is narrowed by whatever the operator picked, so the
       count is too; a `3` that becomes a `1` because the operator narrowed to
       one request type is a different number about a different set, and the
       rail is the one place on screen with no controls next to it to say so.

       Nothing failed under a narrowing clears the badge rather than showing a
       zero, because "no failures among nutrition plans" is not "no failures".
       Absence is the conservative answer and it is not a zero-fill. */
    function badge(coverage, summary, data) {
      if (!summary || coverage.state === 'never_recorded' || !summary.failed) {
        S.setBadge('history', null);
        return;
      }
      var facets = (data && data.facets) || {};
      var parts = [];
      if (narrowing.type !== 'all') parts.push(facetLabel(facets.types, narrowing.type));
      if (narrowing.outcome !== 'all') parts.push(facetLabel(facets.outcomes, narrowing.outcome));
      /* Coverage is the same class of qualifier as narrowing and gets the same
         treatment: over a partly covered record "in this window" names seven
         days for a count that may cover three hours. */
      var span = partlyCovered(coverage)
        ? ' since the record starts at ' + at(coverage.recordingSince)
        : ' in this window';
      var covers = parts.length
        ? span + ', among ' + parts.join(' and ') + ' only'
        : span;
      S.setBadge('history', {
        label: fmt.int(summary.failed),
        tone: 'hot',
        description: (summary.failed === 1
          ? 'one run failed'
          : fmt.int(summary.failed) + ' runs failed') + covers
      });
    }

    /* The label the route sent for a narrowing, or the raw token said as a
       raw token. A narrowing the new window no longer holds is not in the
       facets at all, and naming it anyway is what keeps the badge honest
       about what it counted. */
    function facetLabel(list, value) {
      var all = list || [];
      for (var i = 0; i < all.length; i += 1) {
        if (all[i].value === value) return coded(all[i].labelled === false ? value : all[i].label);
      }
      return coded(value);
    }

    /* ------------------------------------------------------ the controls */

    function controls(data, selection) {
      var box = S.card();
      var body = h('div', { className: 'card-body rh-controls' });

      body.appendChild(picker('Request type', 'rh-type', narrowing.type,
        [{ value: 'all', label: 'Every request type' }].concat(
          /* A request type this build has no label for is named as unnamed
             here too, not only in the table below. Printing the raw token in
             the control while the rows underneath say the page has no name
             for it reads as two different request types. */
          (data.facets.types || []).map(function (type) {
            return {
              value: type.value,
              label: (type.labelled ? coded(type.label)
                : coded(type.value) + ' (no name on this page)')
                + ' \u00b7 ' + fmt.int(type.runs)
            };
          })
        ),
        function (value) {
          narrowing.type = value;
          load();
        }));

      body.appendChild(picker('Outcome', 'rh-outcome', narrowing.outcome,
        [{ value: 'all', label: 'Every outcome' }].concat(
          (data.facets.outcomes || []).map(function (outcome) {
            return {
              value: outcome.value,
              label: coded(outcome.label) + ' \u00b7 ' + fmt.int(outcome.runs)
            };
          })
        ),
        function (value) {
          narrowing.outcome = value;
          load();
        }));

      var again = h('button', { className: 'btn btn-sm', type: 'button', text: 'Read again' });
      again.setAttribute('data-rh-focus', 'rh-read-again');
      again.addEventListener('click', function () {
        keepFocus();
        load();
      });

      var tail = h('div', { className: 'rh-controls-end' });
      tail.appendChild(h('span', {
        className: 'tiny muted',
        text: readAt ? 'Read at ' + at(readAt) : ''
      }));
      tail.appendChild(again);
      body.appendChild(tail);

      box.appendChild(body);
      return box;
    }

    /* A labelled select. The label is a real <label> bound by id rather than a
       styled span, because a control whose name is only visual has no name at
       all to anything reading the page out. */
    function picker(label, id, value, options, onChange) {
      var group = h('div', { className: 'rh-picker' });
      group.appendChild(h('label', { className: 'field-label', for: id, text: label }));

      var wrap = h('div', { className: 'sel' });
      var select = h('select', { id: id });
      select.setAttribute('data-rh-focus', id);
      var seen = false;
      options.forEach(function (option) {
        var node = h('option', { value: option.value, text: option.label });
        if (option.value === value) { node.setAttribute('selected', 'selected'); seen = true; }
        select.appendChild(node);
      });
      /* The narrowing an operator applied can outlive the window that held the
         value: pick a request type, then narrow to 24 hours, and the facet
         list no longer offers it. Naming it rather than silently resetting is
         the difference between a control that lost its value and a pane that
         quietly answered a different question. */
      if (!seen && value !== 'all') {
        var missing = h('option', {
          value: value,
          text: coded(value) + ' \u00b7 nothing in ' +
            coveredWords(lastWindow && lastWindow.coverage, current, 'this window')
        });
        missing.setAttribute('selected', 'selected');
        select.appendChild(missing);
      }
      select.addEventListener('change', function () {
        keepFocus();
        onChange(select.value);
      });
      wrap.appendChild(select);
      wrap.appendChild(icon('chev'));
      group.appendChild(wrap);
      return group;
    }

    /* ------------------------------------------------------ the empties */

    /* Nothing has ever been recorded. Not an empty window: an unread one. */
    function neverRecorded(data) {
      var box = S.card();
      box.appendChild(keyState(S.stateBlock('plug', 'No run has ever been recorded here', [
        'The run history table holds nothing at all — not nothing for this window, nothing ' +
          'ever. Either the lifecycle recorder has not been deployed yet, or it has never ' +
          'managed to write.',
        'This is not a quiet system. Nothing below it is a zero, because there is no ' +
          'nothing below it: no figure on this page can be computed from a table with no ' +
          'rows in it, so none is drawn.'
      ])));
      var row = h('div', { className: 'row mt-sm' });
      row.appendChild(S.link(S.paneHref('jobs') || JOBS_FILE, 'What is running now'));
      row.appendChild(S.link(S.paneHref('alerts') || ALERTS_FILE, 'What the watchers caught', 'btn btn-sm sp'));
      box.appendChild(row);
      if (data && data.window) box.appendChild(windowFoot(data.window));
      return box;
    }

    /* A readable record with nothing in this window. A genuine zero when the
       record covers the window, and something weaker when it does not -- and
       the weaker case is the one this pane got wrong first. A record three
       hours old under a seven-day window is `partial`, and round 3 sent it
       through here to be headed "No run finished in the last 7 days" and
       footed "Counted over <7 days ago>", both of which publish a figure over
       a span the record cannot speak for. Worse, it printed the one sentence
       this pane uses to separate a measured zero from an unread one -- "a quiet
       window rather than a missing one" -- over a window that is, by
       `partial`'s definition, partly missing.

       So the two are drawn as two states. Covered keeps the genuine zero.
       Partial says what it actually knows: nothing finished in the part it can
       see, and the rest of the window is unread. */
    function nothingFinished(data, coverage, selection) {
      var box = S.card();
      var words = WINDOW_LABEL[selection.range] || 'this window';
      var narrowed = narrowing.type !== 'all' || narrowing.outcome !== 'all';
      var partly = partlyCovered(coverage);
      var since = at(coverage.recordingSince);

      var head = partly
        ? 'No run finished since the record starts'
        : 'No run finished in ' + words;

      var first;
      if (partly && narrowed) {
        first = 'Nothing matched the request type and outcome you picked, in the part of ' +
          words + ' the record covers. Recording started at ' + since + ', which is inside ' +
          'this window, so the window before that is unread rather than empty.';
      } else if (partly) {
        first = 'Recording started at ' + since + ', which is inside ' + words + '. Nothing ' +
          'finished between then and now, and what happened before then is unread rather ' +
          'than empty. This is not a quiet window; it is a partly unread one with a quiet ' +
          'end.';
      } else if (narrowed) {
        first = 'Nothing matched the request type and outcome you picked. The record itself ' +
          'is readable and reaches back past the start of this window.';
      } else {
        first = 'The record is readable and reaches back past the start of this window, so ' +
          'this is a quiet window rather than a missing one.';
      }

      box.appendChild(keyState(S.stateBlock(partly ? 'warn' : 'check', head, [
        first,
        coverage.lastRecordedAt
          ? 'The most recent transition anywhere in the record was ' +
            at(coverage.lastRecordedAt) + '.'
          : 'Nothing has been recorded anywhere in the record.'
      ])));

      var row = h('div', { className: 'row mt-sm' });
      if (narrowed) {
        var clear = h('button', { className: 'btn btn-sm', type: 'button', text: 'Clear the narrowing' });
        clear.setAttribute('data-rh-focus', 'rh-clear-narrowing');
        clear.addEventListener('click', function () {
          /* This button is the one control that removes itself: with the
             narrowing gone there is nothing to clear. So the operator is put
             on the type picker, the nearest thing to where they were. */
          /* A stale narrowing carried into a quiet window clears into a
             window that is itself empty, which draws no pickers at all -- so
             the same `rh-state` fallback every other state relies on. */
          moveFocus('rh-type', 'rh-state');
          narrowing = { type: 'all', outcome: 'all' };
          load();
        });
        row.appendChild(clear);
      }
      row.appendChild(S.link(S.paneHref('jobs') || JOBS_FILE, 'What is running now', 'btn btn-sm sp'));
      box.appendChild(row);
      box.appendChild(windowFoot(data.window, coverage));
      return box;
    }

    /* The record starts inside the window being read. Said above the figures
       rather than under them, because it changes what every one of them
       means. */
    function partialNote(coverage, wrap) {
      if (!partlyCovered(coverage)) return;
      wrap.appendChild(noteLine('warn',
        'Recording started at ' + at(coverage.recordingSince) + ', which is inside ' +
        'this window. Every figure below covers from then, not from the start of the window, ' +
        'so nothing here can be read as a total for the window you picked.'));
    }

    function noteLine(iconName, text) {
      var note = h('div', { className: 'note' });
      note.appendChild(icon(iconName));
      note.appendChild(h('div', { text: text }));
      return note;
    }

    /* Every figure carries the window it covers. Half-open, and said so: the
       end is the moment the read was taken and is not itself included. */
    /* No figure without the window it covers -- and the window it covers is not
       always the window that was asked for. When the record starts inside the
       window, the span published here is the span the record can speak for, not
       the one the picker says. */
    function windowFoot(window, coverage) {
      var foot = h('div', { className: 'card-foot' });
      var partly = partlyCovered(coverage);
      foot.appendChild(icon('clock'));
      foot.appendChild(h('span', {
        text: partly
          ? 'Counted over ' + at(coverage.recordingSince) + ' up to but not including ' +
            at(window.endExclusiveAt) + ', which is where the record starts rather than ' +
            'where ' + at(window.startAt) + ' would have put it.'
          : 'Counted over ' + at(window.startAt) + ' up to but not including ' +
            at(window.endExclusiveAt) + '.'
      }));
      return foot;
    }

    /* ---------------------------------------------------- what happened */

    function summaryBand(data, selection) {
      var summary = data.summary;
      var section = S.band('What the record shows',
        coveredWords(data.coverage, selection));

      var grid = h('div', { className: 'grid g4' });

      grid.appendChild(figureCard({
        label: 'Runs finished',
        text: fmt.int(summary.runs),
        note: summary.unfinished
          ? fmt.int(summary.unfinished) + ' more moved and never finished'
          : 'every run that moved also finished'
      }));

      grid.appendChild(figureCard({
        label: 'Worked',
        text: fmt.int(summary.completed),
        note: summary.runs
          ? fmt.percent(Math.round((summary.completed / summary.runs) * 10000)) +
            ' of the runs that finished'
          : 'nothing finished to divide by'
      }));

      grid.appendChild(figureCard({
        label: 'Failed',
        text: fmt.int(summary.failed),
        note: summary.failureReasons
          ? fmt.plural(summary.failureReasons, 'distinct reason', 'distinct reasons')
          : 'no failure in ' + coveredWords(data.coverage, selection)
      }));

      grid.appendChild(figureCard({
        label: 'Cancelled',
        text: fmt.int(summary.canceled),
        note: 'somebody or something stopped these'
      }));

      section.appendChild(grid);

      var pair = h('div', { className: 'grid g2' });
      pair.appendChild(figureCard({
        label: 'Half of them took under',
        text: ms(summary.duration.p50Ms),
        words: summary.duration.p50Ms === null ? 'Not measured' : null,
        note: measuredNote(summary.duration.measured, summary.duration.total)
      }));
      pair.appendChild(figureCard({
        label: 'Half of them waited under',
        text: ms(summary.queued.p50Ms),
        words: summary.queued.p50Ms === null ? 'Not measured' : null,
        note: measuredNote(summary.queued.measured, summary.queued.total)
      }));
      section.appendChild(pair);

      var box = S.card();
      /* Same rule as the empty state: these figures cover from where the record
         starts, so that is the span the footer names. `partialNote()` says it
         above the figures as well; the footer is where the span is published. */
      box.appendChild(windowFoot(data.window, data.coverage));
      section.appendChild(box);
      return section;
    }

    /* ------------------------------------------------- why things failed */

    function failureBand(data, selection) {
      var section = S.band('Why things failed', 'Most runs first, then most recent');
      var box = S.card();
      var wrap = h('div', {
        className: 'tbl-wrap',
        'data-scroll-label': 'Why things failed'
      });
      var table = h('table', { className: 'tbl' });

      var head = h('thead');
      var headRow = h('tr');
      ['Reason', 'Where', 'Runs', 'First seen', 'Last seen', 'Worth retrying'].forEach(function (label, at) {
        headRow.appendChild(h('th', {
          className: at === 2 ? 'r' : '',
          text: label,
          scope: 'col'
        }));
      });
      head.appendChild(headRow);
      table.appendChild(head);

      var body = h('tbody');
      data.failures.forEach(function (group) { body.appendChild(failureRow(group)); });
      table.appendChild(body);

      wrap.appendChild(table);
      box.appendChild(wrap);

      var foot = h('div', { className: 'card-foot' });
      foot.appendChild(h('span', {
        text: 'Grouped by the label the worker recorded. Every failed run in ' +
          coveredWords(data.coverage, selection) + ' is in exactly one of these rows.'
      }));
      foot.appendChild(S.link(S.paneHref('alerts') || ALERTS_FILE, 'What the watchers caught', 'btn btn-sm sp'));
      box.appendChild(foot);

      section.appendChild(box);
      return section;
    }

    function failureRow(group) {
      var row = h('tr');

      var reason = h('td');
      /* A failure with no label is drawn as the absence it is. The worker's
         label is a bounded token and the write path drops anything that is not
         one, so "no label" is a real and reachable state rather than a
         defensive branch. */
      reason.appendChild(h('div', {
        className: 't-main' + (group.failureCode ? '' : ' words'),
        text: group.failureCode ? coded(group.failureCode) : 'No reason recorded'
      }));
      if (!group.failureCode) {
        reason.appendChild(h('div', {
          className: 't-sub',
          text: 'the run failed and the worker recorded no label for it'
        }));
      }
      row.appendChild(reason);

      var where = h('td');
      var first = group.byType[0];
      where.appendChild(h('div', {
        className: 't-main',
        text: first ? coded(first.type.label) : fmt.none
      }));
      if (group.byType.length > 1) {
        where.appendChild(h('div', {
          className: 't-sub',
          text: 'and ' + fmt.plural(group.byType.length - 1, 'other request type', 'other request types')
        }));
      }
      row.appendChild(where);

      row.appendChild(h('td', { className: 'r num', text: fmt.int(group.runs) }));
      row.appendChild(h('td', { text: at(group.firstSeenAt) }));
      row.appendChild(h('td', { text: at(group.lastSeenAt) }));

      /* Three answers, not two. Null is "the worker did not say", or "it said
         both", and neither is a no. The pill carries the words as well as the
         tone, so a screen that is read rather than looked at says the same
         thing. */
      var retry = h('td');
      retry.appendChild(h('span', {
        className: 'pill ' + (group.retryable === true ? 'up' : (group.retryable === false ? 'down' : 'ghost')),
        text: group.retryable === true ? 'Yes'
          : (group.retryable === false ? 'No' : 'Not recorded')
      }));
      row.appendChild(retry);

      return row;
    }

    /* ---------------------------------------------------------- the runs */

    function runsBand(data, selection) {
      var section = S.band('The runs', 'Newest first');
      var box = S.card();
      var wrap = h('div', {
        className: 'tbl-wrap',
        'data-scroll-label': 'The runs'
      });
      var table = h('table', { className: 'tbl' });

      var head = h('thead');
      var headRow = h('tr');
      ['Finished', 'Request type', 'Outcome', 'Took', 'Waited', 'Model', 'Actions', ''].forEach(function (label, at) {
        headRow.appendChild(h('th', {
          className: (at === 3 || at === 4) ? 'r' : '',
          text: label,
          scope: 'col'
        }));
      });
      head.appendChild(headRow);
      table.appendChild(head);

      var body = h('tbody');
      data.runs.forEach(function (run) { body.appendChild(runRow(run, selection)); });
      table.appendChild(body);

      wrap.appendChild(table);
      box.appendChild(wrap);

      var foot = h('div', { className: 'card-foot' });
      foot.appendChild(h('span', {
        text: data.truncated
          ? 'The newest ' + fmt.int(data.selection.limit) + ' of ' + fmt.int(data.summary.runs) +
            ' runs that finished in ' + coveredWords(data.coverage, selection) + '.'
          : 'Every run that finished in ' + coveredWords(data.coverage, selection) + '.'
      }));
      box.appendChild(foot);

      section.appendChild(box);
      return section;
    }

    var OUTCOME_TONE = { completed: 'up', failed: 'down', canceled: 'ghost' };

    function runRow(run, selection) {
      var row = h('tr');

      row.appendChild(h('td', { text: at(run.finishedAt) }));

      var type = h('td');
      type.appendChild(h('div', { className: 't-main', text: coded(run.type.label) }));
      /* A request type this build has no label for still draws, and says so
         rather than printing the raw token as though it were a name. */
      if (!run.type.labelled) {
        type.appendChild(h('div', { className: 't-sub', text: 'a request type this page has no name for' }));
      }
      row.appendChild(type);

      var outcome = h('td');
      outcome.appendChild(h('span', {
        className: 'pill ' + (OUTCOME_TONE[run.outcome] || 'ghost'),
        text: coded(run.outcomeLabel)
      }));
      if (run.failureCode) {
        outcome.appendChild(h('div', { className: 't-sub', text: coded(run.failureCode) }));
      }
      row.appendChild(outcome);

      row.appendChild(h('td', { className: 'r num', text: msOrNone(run.durationMs) }));
      row.appendChild(h('td', { className: 'r num', text: msOrNone(run.queuedMs) }));
      row.appendChild(h('td', { text: run.modelUsed ? coded(run.modelUsed) : fmt.none }));
      row.appendChild(h('td', { className: 'r' }, [
        jobActions.controls(run, {
          onSuccess: afterRunAction,
          onStale: afterRunAction,
          focusAttr: 'data-rh-focus',
          focusPrefix: 'rh-job-action'
        })
      ]));

      var end = h('td', { className: 'r' });
      var open = h('button', {
        className: 'btn btn-sm',
        type: 'button',
        text: 'Open'
      });
      /* Two dozen buttons reading "Open" are one list entry repeated two dozen
         times to anything that enumerates controls by name. The visible word
         stays first so voice control still works on what is on screen, and the
         run's own time follows it.

         fmt.utcStamp rather than at() here on purpose: at() substitutes the em
         dash the tables use for an absence, and "finished at —" is a name
         rather than a description, so this one branch wants the words. */
      open.setAttribute('aria-label', 'Open the run that finished at ' +
        (fmt.utcStamp(run.finishedAt) || 'an unrecorded time'));
      open.setAttribute('data-rh-focus', 'rh-open-' + run.jobId);
      open.addEventListener('click', function () {
        /* The run opens below, so focus follows it there rather than staying
           on a button the redraw is about to replace. Close sends it back.
           A read that fails draws Try again instead of Close, and focus has
           to land on one of them or it lands on nothing. */
        moveFocus('rh-detail-close', 'rh-detail-retry');
        openRun(run.jobId, selection);
      });
      end.appendChild(open);
      row.appendChild(end);

      return row;
    }

    /* -------------------------------------------------------- one run */

    function detailBand(selection) {
      var section = S.band('One run', 'What it did, and whether it is only this one');

      if (detail.loading) {
        var waiting = S.card();
        var waitBody = h('div', { className: 'card-body' });
        waitBody.appendChild(h('div', { className: 'skel skel-row' }));
        waitBody.appendChild(h('div', { className: 'skel skel-row' }));
        waiting.appendChild(waitBody);
        section.appendChild(waiting);
        return section;
      }

      if (detail.error) {
        var failedBox = S.card();
        var block = S.stateBlock('warn', 'This run could not be read', [
          coded(S.failureMessage(detail.error)),
          'Nothing here is a zero. This one run is unread; the window above it came back.'
        ], 3);
        var again = h('button', { className: 'btn btn-primary', type: 'button', text: 'Try again' });
        again.setAttribute('aria-label', 'Try reading this run again');
        again.setAttribute('data-rh-focus', 'rh-detail-retry');
        again.addEventListener('click', function () {
          /* A second attempt that works replaces this button with the run, so
             ask for Close and fall back to this button if it fails again. */
          moveFocus('rh-detail-close', 'rh-detail-retry');
          openRun(detail.jobId, selection);
        });
        /* A Close beside it, because `Try again` failing a second time is the
           likeliest next event and without this the band has no exit at all:
           a real-Chrome probe of the race found the failed band offering one
           control that reloads it and none that dismisses it. The retry above
           already asks focus for `rh-detail-close`, which until now named a
           control that did not exist in this branch. */
        block.appendChild(h('div', { className: 'row mt-sm' }, [again, closeButton('rh-detail-close-failed')]));
        failedBox.appendChild(block);
        section.appendChild(failedBox);
        return section;
      }

      var data = detail.data;
      var box = S.card();
      box.appendChild(S.cardHead(
        coded(data.run.type.label) + ' \u00b7 ' + (coded(data.run.outcomeLabel) || 'still going'),
        data.run.finishedAt
          ? 'Started ' + at(data.run.startedAt) + ', finished ' + at(data.run.finishedAt)
          : 'Started ' + at(data.run.startedAt) + ', and has not finished',
        [closeButton()]
      ));

      var body = h('div', { className: 'card-body col' });
      body.appendChild(runFacts(data.run));
      body.appendChild(jobActions.controls(data.run, {
        onSuccess: afterRunAction,
        onStale: afterRunAction,
        focusAttr: 'data-rh-focus',
        focusPrefix: 'rh-job-action-detail'
      }));
      body.appendChild(revealControls(data.run));
      body.appendChild(stageList(data));
      box.appendChild(body);
      section.appendChild(box);

      if (reveal && reveal.jobId === data.run.jobId && reveal.data) {
        section.appendChild(revealedContentCard(reveal.data));
      }
      section.appendChild(sharedCard(data, selection));
      return section;
    }

    /* `key` exists so the failure band's Close is NOT the control the retry
       asks for by name. Pressing `Try again` and failing again should leave
       the operator on `Try again`, not on a Close that throws the run away;
       giving the two bands different keys keeps `rh-detail-close` meaning
       "the read worked" and lets the fallback do its job. */
    function closeButton(key) {
      var close = h('button', { className: 'btn btn-sm', type: 'button', text: 'Close' });
      close.setAttribute('aria-label', 'Close this run');
      close.setAttribute('data-rh-focus', key || 'rh-detail-close');
      var back = detail ? 'rh-open-' + detail.jobId : null;
      close.addEventListener('click', function () {
        /* Back to the row the run was opened from, which is where the
           operator was before Open, and which may be halfway down a long
           table. Falling back to Read again keeps them inside the pane if
           that row is no longer listed. */
        moveFocus(back, 'rh-read-again');
        detail = null;
        clearRevealed();
        render(lastWindow, current);
        S.announce('Closed the run.');
      });
      return close;
    }

    function afterRunAction(result) {
      actionAnnouncement = result && result.message ? result.message : null;
      moveFocus('rh-read-again', 'rh-state');
      load();
    }

    function runFacts(run) {
      var list = h('div', { className: 'rh-facts' });
      [
        { label: 'Took', value: msOrNone(run.durationMs) },
        { label: 'Waited to start', value: msOrNone(run.queuedMs) },
        { label: 'Picked up by a worker', value: fmt.plural(run.attempts, 'time', 'times') },
        { label: 'Model', value: run.modelUsed ? coded(run.modelUsed) : fmt.none },
        {
          label: 'Reason',
          value: run.failureCode ? coded(run.failureCode)
            : (run.outcome === 'failed' ? 'No reason recorded' : fmt.none)
        },
        {
          label: 'Worth retrying',
          value: run.retryable === true ? 'Yes'
            : (run.retryable === false ? 'No' : fmt.none)
        }
      ].forEach(function (fact) {
        var item = h('div', { className: 'rh-fact' });
        item.appendChild(h('span', { className: 'field-label', text: fact.label }));
        item.appendChild(h('span', { className: 'rh-fact-val', text: fact.value }));
        list.appendChild(item);
      });
      return list;
    }

    function isOwner() { return session.hasRole(['owner']); }

    function revealControls(run) {
      var wrap = h('div', { className: 'rh-reveal-actions' });
      if (!isOwner()) return wrap;

      if (reveal && reveal.jobId === run.jobId && reveal.data) {
        var hide = h('button', { className: 'btn btn-sm', type: 'button', text: 'Hide content' });
        hide.setAttribute('data-rh-focus', 'rh-reveal-hide');
        hide.addEventListener('click', hideRevealedContent);
        wrap.appendChild(hide);
        return wrap;
      }

      var show = h('button', { className: 'btn btn-sm btn-primary', type: 'button', text: 'Show content' });
      show.setAttribute('data-rh-focus', 'rh-reveal-show');
      show.addEventListener('click', function () { openRevealDialog(run); });
      wrap.appendChild(show);
      return wrap;
    }

    function clearRevealed() {
      revealGeneration += 1;
      reveal = null;
      var nodes = content.querySelectorAll('.rh-content-card');
      for (var i = 0; i < nodes.length; i += 1) nodes[i].remove();
    }

    function revealFocusKey(key) {
      return key === 'rh-reveal-hide'
        || key === 'rh-reveal-hide-footer'
        || key === 'rh-content-first';
    }

    function clearOnPageExit() {
      if (activeRevealDialog) {
        activeRevealDialog.closeForCleanup();
        activeRevealDialog = null;
        forceFocus('rh-reveal-show', 'rh-state');
      } else if (reveal && revealFocusKey(focusKeyNow())) {
        forceFocus('rh-reveal-show', 'rh-state');
      } else {
        keepFocus();
      }
      clearRevealed();
      if (lastWindow) render(lastWindow, current);
    }

    function hideRevealedContent() {
      moveFocus('rh-reveal-show', 'rh-state');
      clearRevealed();
      render(lastWindow, current);
      S.announce('Stored content is hidden.');
    }

    function revealPath(run) {
      return RUNS_ENDPOINT + '/' + encodeURIComponent(run.jobId) + '/reveal';
    }

    function revealError(err) {
      if (err && err.code === 'ops_runs_reason_required') return 'Use 10 to 500 characters.';
      if (err && err.code === 'ops_runs_reference_invalid') return 'This run cannot be revealed from here.';
      if (err && err.code === 'ops_runs_run_not_found') return 'That run is no longer in the operations record.';
      if (err && err.code === 'ops_runs_reveal_unavailable') {
        return 'Content was not shown because the access record could not be written. Try again shortly.';
      }
      if (err && err.code === 'ops_reauth_required') return 'Confirm your password, then try again.';
      if (err && err.status === 403) return 'Your role can view runs but cannot reveal their stored content.';
      if (err && err.status === 404) return 'That run is no longer in the operations record.';
      if (err && err.status === 503) {
        return 'Content was not shown because the operations API could not commit the access record.';
      }
      if (err && (err.status === 0 || err.code === 'ops_unreachable')) {
        return 'The operations API could not be reached. Nothing was shown.';
      }
      return 'Content was not shown. Nothing changed.';
    }

    function openRevealDialog(run) {
      var busy = false;
      var titleId = 'runRevealTitle' + Math.random().toString(36).slice(2, 8);
      var reasonId = titleId + 'Reason';
      var hintId = titleId + 'Hint';
      var errorId = titleId + 'Error';
      var countId = titleId + 'Count';

      var card = h('div', { className: 'modal-card rh-reveal-card' });
      card.appendChild(h('div', { className: 'card-head' }, [
        h('h2', { className: 'card-title', id: titleId, text: 'Show stored run content?' })
      ]));
      var body = h('div', { className: 'card-body col' });
      body.appendChild(h('p', { className: 'small muted',
        text: 'This shows the stored input and output for this run. The view is recorded in the access record with your reason, and personal identifiers are masked.' }));
      body.appendChild(h('label', { className: 'field-label', for: reasonId, text: 'Reason' }));
      var reason = h('textarea', {
        className: 'field-input rh-reveal-reason',
        id: reasonId,
        rows: '4',
        maxlength: '500',
        autocomplete: 'off',
        'aria-describedby': hintId + ' ' + errorId + ' ' + countId
      });
      body.appendChild(reason);
      body.appendChild(h('p', {
        className: 'field-hint',
        id: hintId,
        text: 'Write why you need this content. Use 10 to 500 characters.'
      }));
      var error = h('p', { className: 'form-alert', id: errorId, role: 'alert' });
      body.appendChild(error);
      var counter = h('p', { className: 'tiny muted', id: countId, text: '0 / 500' });
      body.appendChild(counter);
      card.appendChild(body);

      var cancel = h('button', { className: 'btn', type: 'button', text: 'Cancel' });
      var show = h('button', { className: 'btn btn-primary', type: 'button', text: 'Show content' });
      card.appendChild(h('div', { className: 'row mt' }, [cancel, h('div', { className: 'spacer' }), show]));

      var node = h('div', {
        className: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1'
      }, [card]);

      function trimmed() { return reason.value.replace(/^\s+|\s+$/g, ''); }
      function sync() {
        counter.textContent = String(reason.value.length) + ' / 500';
        if (trimmed().length >= 10 && trimmed().length <= 500) {
          reason.removeAttribute('aria-invalid');
          error.textContent = '';
        }
      }
      function fail(message) {
        error.textContent = message;
        reason.setAttribute('aria-invalid', 'true');
        busy = false;
        cancel.disabled = false;
        show.disabled = false;
        show.textContent = 'Show content';
        reason.focus();
      }
      function submit(modal) {
        var value = trimmed();
        if (busy) return;
        if (value.length < 10 || value.length > 500) {
          fail('Use 10 to 500 characters.');
          return;
        }
        busy = true;
        reason.removeAttribute('aria-invalid');
        error.textContent = '';
        cancel.disabled = true;
        show.disabled = true;
        show.textContent = 'Showing';
        var generation = revealGeneration;
        session.call(revealPath(run), {
          method: 'POST',
          body: { reason: value }
        }).then(function (payload) {
          if (generation !== revealGeneration) return;
          reveal = { jobId: run.jobId, data: payload.data };
          busy = false;
          activeRevealDialog = null;
          modal.close();
          moveFocus('rh-content-first', 'rh-content-first');
          render(lastWindow, current);
          S.announce('Stored content is shown.');
        }, function (err) {
          if (generation !== revealGeneration) return;
          fail(revealError(err));
        });
      }

      reason.addEventListener('input', sync);
      var modal = jobActions.openModal(node, function () { return reason; }, function () {
        if (busy) return false;
        activeRevealDialog = null;
        return true;
      });
      activeRevealDialog = {
        closeForCleanup: function () {
          busy = false;
          cancel.disabled = false;
          show.disabled = false;
          show.textContent = 'Show content';
          modal.close();
        }
      };
      cancel.addEventListener('click', function () {
        if (!busy) {
          activeRevealDialog = null;
          modal.close();
        }
      });
      show.addEventListener('click', function () { submit(modal); });
      sync();
    }

    function pretty(value) {
      if (typeof value !== 'string') return '';
      try { return JSON.stringify(JSON.parse(value), null, 2); } catch (e) { return value; }
    }

    function revealedContentCard(data) {
      var box = S.card('accent acc-vio rh-content-card');
      box.appendChild(S.cardHead('Stored content', 'Masked by the server and recorded before it was returned'));
      var body = h('div', { className: 'card-body col' });
      (data.sections || []).forEach(function (section, at) {
        body.appendChild(revealSection(section, at === 0));
      });
      box.appendChild(body);
      var foot = h('div', { className: 'card-foot' });
      foot.appendChild(icon('lock'));
      foot.appendChild(h('span', { text: 'This content is not stored by the page. Hide it before leaving this run.' }));
      var hide = h('button', { className: 'btn btn-sm sp', type: 'button', text: 'Hide content' });
      hide.setAttribute('data-rh-focus', 'rh-reveal-hide-footer');
      hide.addEventListener('click', hideRevealedContent);
      foot.appendChild(hide);
      box.appendChild(foot);
      return box;
    }

    function revealSection(section, first) {
      var label = section && section.label ? coded(section.label) : 'Stored content';
      var region = h('div', {
        className: 'rh-content-region',
        role: 'region',
        'aria-label': label + ' content',
        tabindex: '0'
      });
      if (first) region.setAttribute('data-rh-focus', 'rh-content-first');
      region.appendChild(h('h4', { className: 'card-title', text: label }));
      if (section.status === 'retained') {
        region.appendChild(h('pre', { className: 'rh-content-pre', text: pretty(section.value) }));
      } else {
        region.appendChild(h('p', {
          className: 'state-desc',
          text: 'Not kept: ' + coded(section.notRetainedReason || 'The server did not retain this section.')
        }));
      }
      return region;
    }

    /* Every transition the recorder won, in the order it wrote them. This is
       the one place on the dashboard where a retry is visible as a retry: a
       job that went queued, running, queued, running, failed was picked up
       twice, and the list says so rather than the summary implying it. */
    function stageList(data) {
      var wrap = h('div', { className: 'rh-stages' });
      wrap.appendChild(h('h4', { className: 'card-title', text: 'What it did, step by step' }));

      var list = h('ol', { className: 'rh-stage-list' });
      data.stages.forEach(function (stage) {
        var item = h('li', { className: 'rh-stage' });
        item.appendChild(h('span', {
          className: 'pill ' + (OUTCOME_TONE[stage.status] || 'ghost'),
          text: coded(stage.label)
        }));
        item.appendChild(h('span', { className: 'rh-stage-at', text: at(stage.occurredAt) }));

        var extra = [];
        if (typeof stage.queuedMs === 'number') extra.push('waited ' + ms(stage.queuedMs));
        if (typeof stage.durationMs === 'number') extra.push('took ' + ms(stage.durationMs));
        if (stage.failureCode) extra.push(coded(stage.failureCode));
        if (stage.modelUsed) extra.push(coded(stage.modelUsed));
        if (extra.length) {
          item.appendChild(h('span', { className: 'rh-stage-note', text: extra.join(' \u00b7 ') }));
        }
        list.appendChild(item);
      });
      wrap.appendChild(list);

      if (data.stagesTruncated) {
        wrap.appendChild(noteLine('warn',
          'This run has more transitions than this page reads. The earliest are shown, so the ' +
          'list ends before the run does.'));
      }
      return wrap;
    }

    /* "Is this happening to other people?", which is the question this pane is
       named for. Counts only: how many runs hit the same label, and how many
       accounts those runs belonged to. No account is named, and none is sent. */
    function sharedCard(data, selection) {
      var box = S.card();

      if (!data.shared) {
        box.appendChild(S.cardHead('Is it happening to other people?', 'Nothing to compare'));
        var body = h('div', { className: 'card-body' });
        body.appendChild(h('p', {
          className: 'state-desc',
          text: data.run.outcome === null
            ? 'This run has not finished, so there is no fault to compare against anything yet.'
            : 'This run did not fail, so there is no fault to compare against anything. A count ' +
              'of nought other people here would be a figure about nothing.'
        }));
        box.appendChild(body);
        return box;
      }

      var shared = data.shared;
      /* The detail route sends no coverage of its own, so this borrows the
         window read's -- the read this count was taken alongside. Without it
         the card says "in this window" over a span the window read has
         already told the operator it cannot speak for. */
      var span = coveredWords(lastWindow && lastWindow.coverage, selection, 'this window');
      var label = shared.failureCode
        ? 'Everything in ' + span + ' that failed with ' + coded(shared.failureCode)
        : 'Everything in ' + span + ' that failed with no label recorded';

      /* The count can come back with nothing in it, and nothing is not nought.
         `Runs that hit it: 0` would read as "nobody else", which is the one
         reassurance this pane must never invent. The route sends null; this
         says so and stops, rather than drawing a grid of dashes. */
      if (shared.runs === null) {
        box.appendChild(S.cardHead('Nobody could be counted', label));
        var none = h('div', { className: 'card-body' });
        none.appendChild(h('p', {
          className: 'state-desc',
          text: 'No run under this label is in the window above, so there was nothing to ' +
            'count. That is not a count of nought: this run is not alone until something ' +
            'says so, and nothing here does. Widen the range to ask again.'
        }));
        box.appendChild(none);
        return box;
      }

      box.appendChild(S.cardHead(
        shared.isolated === null
          ? 'Counted, but not around this run'
          : shared.isolated
            ? 'This is the only run that hit it'
            : 'It is happening to other people',
        label
      ));

      var body = h('div', { className: 'card-body col' });

      /* The window is the selection's, not the run's. Open a run from outside it
         and the figures below are true about other runs and silent about this
         one, so the heading above refuses to call it isolated and this says why. */
      if (!shared.countIncludesThisRun) {
        body.appendChild(h('p', {
          className: 'state-desc',
          text: 'This run finished outside the window these figures cover, so they are about ' +
            'other runs. Whether this one is alone is not something they can say.'
        }));
      }

      var grid = h('div', { className: 'grid g2' });
      grid.appendChild(figureCard({
        label: 'Runs that hit it',
        text: fmt.int(shared.runs),
        note: shared.firstSeenAt
          ? 'first at ' + at(shared.firstSeenAt) + ', last at ' + at(shared.lastSeenAt)
          : 'no times recorded'
      }));
      grid.appendChild(figureCard({
        label: 'Accounts affected',
        text: fmt.int(shared.accounts),
        note: shared.runsWithoutAccount
          ? fmt.plural(shared.runsWithoutAccount, 'run', 'runs') + ' had no account left to count'
          : 'counted once each across every request type'
      }));
      body.appendChild(grid);

      /* Null when nothing was counted, which the branch above already sent
         elsewhere. Read defensively anyway: this is the one field on the wire
         whose absence and whose counted zero are both legal. */
      if (shared.byType && shared.byType.length > 1) {
        var split = h('ul', { className: 'list-tick' });
        shared.byType.forEach(function (row) {
          var item = h('li');
          item.appendChild(icon('empty'));
          item.appendChild(h('span', {
            text: coded(row.type.label) + ': ' + fmt.plural(row.runs, 'run', 'runs') + ', ' +
              fmt.plural(row.accounts, 'account', 'accounts')
          }));
          split.appendChild(item);
        });
        body.appendChild(split);
      }

      box.appendChild(body);

      var foot = h('div', { className: 'card-foot' });
      foot.appendChild(icon('lock'));
      foot.appendChild(h('span', {
        text: 'Counts only. Which accounts these are is not sent to this page, at any role. ' +
          'The per-type split is counted per type, so the same person hitting this on two ' +
          'request types is one account in the figure above and one in each line here.'
      }));
      box.appendChild(foot);
      return box;
    }

    /* -------------------------------------------------------- privacy */

    function privacyBand() {
      var section = S.band('What was asked, and what Aria answered');
      var box = S.card('accent acc-vio');

      box.appendChild(S.cardHead('Hidden until a recorded reveal', 'Stored input and output are not shown in the table'));

      var body = h('div', { className: 'card-body col' });

      RUN_CONTENT.forEach(function (field) { body.appendChild(lockedRow(field)); });

      var promises = h('ul', { className: 'list-tick' });
      [
        'Nothing here names a person. The run history route sends no account identity at ' +
          'all — not a masked one, not a coded one — so there is nothing on this page to ' +
          'unmask. What it prints is a request type, a failure label, a model and a count.',
        'What was asked, what Aria answered and the athlete details a run read stay ' +
          'out of the run table.',
        'An access is recorded by field name and never by content, so the record of an ' +
          'access never becomes a second copy of the thing accessed.',
        'The athlete can see that a reveal happened and who did it.',
        'Those records outlive the view. Hiding content here does not erase the access record.'
      ].forEach(function (line) {
        var item = h('li');
        item.appendChild(icon('check'));
        item.appendChild(h('span', { text: line }));
        promises.appendChild(item);
      });
      body.appendChild(promises);

      box.appendChild(body);

      var foot = h('div', { className: 'card-foot' });
      foot.appendChild(icon('lock'));
      foot.appendChild(h('span', {
        text: 'Access records are kept with the account: '
      }));
      foot.appendChild(S.link(S.paneHref('users') || USERS_FILE, 'Look up a user', 'btn btn-sm sp'));
      box.appendChild(foot);

      section.appendChild(box);
      return section;
    }

    /* One field name and the fact that it is hidden. There is no value node in
       this row at all, revealed or masked: the name is the whole of what this
       pane knows, which is also the whole of what a reveal is recorded by. */
    function lockedRow(field) {
      var row = h('div', { className: 'locked-row' });
      row.appendChild(h('span', { className: 'field-label', text: field.label }));

      var kind = disclosure(field);
      var state = h('span', { className: 'locked' });
      state.appendChild(icon('lock'));
      state.appendChild(h('span', { text: 'Hidden' }));
      row.appendChild(state);

      if (kind === 'never') {
        var never = h('span', { className: 'locked-never' });
        never.appendChild(icon('x'));
        never.appendChild(h('span', { text: 'Never shown here' }));
        row.appendChild(never);
        return row;
      }

      /* Neither branch below is reachable for the three fields this pane
         declares, and both exist for the same reason: disclosure() is a floor
         over a field list, and the list is fixed here only until a route
         serves one. A floor with a single exit is a floor nobody can see the
         shape of. */
      if (kind === 'elsewhere') {
        row.appendChild(h('span', { className: 'tiny muted', text: 'Revealed where the account is' }));
        return row;
      }
      row.appendChild(h('span', { className: 'tiny muted', text: 'Not revealable' }));
      return row;
    }

    /* --------------------------------------------- what is not here yet */

    function missingBand() {
      var section = S.band('What this pane cannot answer yet',
        'Named rather than drawn as an empty figure');
      var box = S.card();
      var body = h('div', { className: 'card-body omit' });

      [
        {
          title: 'What a run cost',
          desc: 'The run record carries no price. Spend answers this per model and per day.'
        },
        {
          title: 'Who the run was for',
          desc: 'The run record has no consent flag, so the route sends no account ' +
            'identity it could not gate. Counts only, at every role.'
        },
        {
          title: 'Which app asked',
          desc: 'Neither the run record nor the job table carries a client app. Request ' +
            'type is the nearest real answer, and it is offered above.'
        },
        {
          title: 'Whether a run was refused on safety grounds',
          desc: 'A run ends worked, failed or cancelled. A refusal completed, because the ' +
            'refusal was the answer.'
        }
      ].forEach(function (item) {
        var line = h('div', { className: 'omit-item' });
        line.appendChild(icon('empty'));
        var words = h('div');
        words.appendChild(h('div', { className: 'omit-title', text: item.title }));
        words.appendChild(h('div', { className: 'omit-desc', text: item.desc }));
        line.appendChild(words);
        body.appendChild(line);
      });

      box.appendChild(body);
      section.appendChild(box);
      return section;
    }

    /* The skeleton goes up now rather than inside the listener, because the
       listener is added before the event arrives and the pane would otherwise
       be a blank rectangle until the answer lands. */
    region.loading(SKELETON);
  });
}(window));
