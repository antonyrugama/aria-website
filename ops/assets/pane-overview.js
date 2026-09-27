/* Overview: are people using it, is it working, is anything urgent.

   Overview owns no detail. Every figure on it is a doorway into the pane that
   owns the question, which is what stops it becoming the place investigations
   happen. That rule shapes this file more than anything else: nothing here
   renders a table, a facet, or a control that changes a system.

   Drawn on the v2 design system through assets/shell-pane-v2.js. The pane
   holds no session, filter or navigation logic of its own.

   Four rules from the /api/ops/summary contract are load bearing here rather
   than decorative, and every one of them is a rule about NOT drawing
   something:

     1. **Every figure is labelled with the window it actually covers**, read
        from the answer rather than written into this file. Production may send
        either the older day-grain activity window or the newer hour-grain
        window; the pane labels the grain it receives so the website can deploy
        before or after the API.
     2. **Empty never means zero.** Every block carries an `availability`
        state, and the figures are absent from the payload when it is not
        `ready`. A tile reading 0 active people and a tile whose pipeline is
        not connected look identical, so a state that is not `ready` renders
        words rather than a number, and `not_reporting` in particular is never
        drawn as a zero.
     3. **Mobile and Coaches Web are never summed.** The activity line is one
        series per app sharing an x scale, and the headline people figure is
        the platform's own distinct count rather than the sum of the two:
        somebody who used both is one person.
     4. **Nothing absent is filled in.** A day an app has no stored reading for
        arrives as `null` and breaks the line rather than dropping it to the
        floor; an absent comparison is drawn as "no comparison available" with
        the reason, never as 0% and never as a rise from nothing; and anything
        the design asks for that has no source at all is named in `omissions`
        with its reason instead of being drawn as an empty bar.

   The cost tile is where the fourth rule is most visible. Nothing in this
   platform records a cloud budget, so the route marks the figure
   `basis: 'spend'` and names the gap in `omissions`; the approved design's
   budget bar is not drawn, because an empty track reads as a budget with
   nothing spent against it and a full one as a budget already gone. The
   omissions list is rendered FROM the answer rather than from a list in this
   file, so a figure that gains a source leaves the list without an edit here.

   The change figure beside active people is computed here rather than sent,
   because the route hands over the two counts and the reporting floor instead
   of a percentage: a rate over a group this small moves several points on one
   person, so the floor is applied at the moment of display, where the rule
   about what may be shown belongs.

   The same honesty runs through the status ribbon. "Everything is working" is
   only worth printing when something was in a position to notice that it was
   not, so the ribbon reads the alert rules and degrades to saying the checks
   themselves are not running when that is what is true. */
(function (global) {
  'use strict';

  var S = global.OpsPaneShell;
  var model = global.OpsAlertsModel;
  var session = global.OpsSession;
  var h = S.h;
  var icon = S.icon;
  var fmt = S.fmt;
  var maskContactDetails = global.OpsPaneRegistry.maskContactDetails;

  /* How many problems the needs-attention queue shows before it stops and
     sends the operator to the pane that owns them. Overview is a doorway, not
     a second Problems pane. */
  var QUEUE_LIMIT = 3;

  var SUMMARY_ENDPOINT = '/api/ops/summary';

  /* The group size a share may be reported over, used only when the answer
     does not carry its own floor. Kept the same as the understand panes'
     OpsPaneData.REPORTING_FLOOR, and pinned to it by
     scripts/ops-overview-v2.test.mjs so the two cannot drift. */
  var REPORTING_FLOOR = 50;

  /* The pane each figure hands its detail to. Overview owns no detail, so
     every tile is a doorway into the pane that owns the question behind it. */
  var OWNER_PANE = {
    people: { href: 'analytics.html', label: 'People and usage' },
    runs: { href: 'run-history.html', label: 'Run history' },
    cost: { href: 'spend.html', label: 'Cloud costs' },
    release: { href: 'releases.html', label: 'App releases' }
  };

  /* The response names a series colour from the closed set the v1 design
     system published. Mapped rather than passed through: an unrecognised name
     takes the first series colour, exactly as OpsPaneData.seriesStroke does,
     so a line is never drawn with no stroke at all. */
  var SERIES_TONE = {
    s1: 'tone-cyan', s2: 'tone-violet', s3: 'tone-emerald',
    s4: 'tone-amber', s5: 'tone-rose', s6: 'tone-blue',
    muted: 'tone-muted'
  };
  var DEFAULT_SERIES_TONE = 'tone-cyan';

  function seriesTone(name) {
    return (typeof name === 'string' &&
      Object.prototype.hasOwnProperty.call(SERIES_TONE, name))
      ? SERIES_TONE[name] : DEFAULT_SERIES_TONE;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(name, attrs) {
    var el = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  S.definePane('overview', function (content) {
    var region = S.region(content);
    var loadToken = 0;

    /* This pane listens for no filter change, because the registry gives it
       none. A request carrying scope, range or environment is answered the
       same way whichever is picked, so a control here would leave somebody who
       chose Staging looking at production figures with their own selection
       sitting above them. The bar states the absence instead. */

    function load() {
      var token = ++loadToken;
      region.loading([
        { type: 'block', height: 78 },
        { type: 'rows', count: 3 },
        { type: 'tiles', count: 4 },
        { type: 'block', height: 210 }
      ]);

      /* Three reads, each carried as a value or as the error it failed with.

         Every one of them fails on its own terms rather than through the
         pane. The halves of this page answer different questions from
         different tables, and a read that is down must not take the others
         off the screen with it: an operator who cannot see spend can still
         act on a critical problem, and one who cannot read the queue can
         still be told what the figures say. Each rejection is therefore
         carried as a value and drawn as one failed section, with the pane in
         its degraded state rather than its live one.

         Bare reads under Promise.all did the opposite. A single failed
         problems or rules request rejected the whole thing and replaced the
         entire pane with "This pane could not be read", including the
         sections whose own reads had landed (Stadiora/Aria#5498). */
      /* Returned, not fired and forgotten. A control that re-renders the pane
         has to be able to act AFTER the new nodes exist -- the one that
         pressed it is gone by then -- and a promise is the only deterministic
         way to know when that is. Sleeping for a plausible interval is how a
         focus test passes on one machine and fails on the runner. */
      return Promise.all([
        settled(session.call('/api/ops/alerts/problems',
          { query: { status: 'open', limit: model.PAGE } })),
        settled(session.call('/api/ops/alerts/rules')),
        summary().then(function (payload) {
          return { data: (payload && typeof payload === 'object') ? payload : null };
        }, function (err) {
          return { error: err };
        })
      ]).then(function (results) {
        /* Whether THIS read is the one on screen, handed back so a retry can
           ask. Two presses in quick succession start two reads, loadToken
           suppresses the older render, and without this the older promise
           still fulfils and still lands: the operator is dragged back to a
           heading by a request that drew nothing, after they have moved on.
           Reported rather than inferred, because the reason the render was
           skipped is not visible from outside. */
        if (token !== loadToken) return false;
        render({ open: results[0], rules: results[1], summary: results[2] });
        return true;
      }).catch(function (err) {
        /* Not a failed read any more — the three above cannot reject. This is
           the backstop for render() itself throwing, which is the one failure
           that really does leave nothing on screen. */
        if (token !== loadToken) return false;
        region.failed(err, retryAction(ATTENTION_BAND));
        return true;
      });
    }

    /* A read as a value: { data } or { error }, never a rejection. */
    function settled(promise) {
      return promise.then(function (payload) {
        return { data: payload.data };
      }, function (err) {
        return { error: err };
      });
    }

    /* The summary read.
       No querystring, because this pane registers no controls and the route
       accepts no parameter: it reports the environment it answered for in the
       payload rather than taking one. Through the shell's loader so that the
       same-origin fixture hook covers the states a live API will not produce
       on demand, which here is most of them: a window nothing reported, a
       comparison the retention horizon refused, a day with no stored
       reading. */
    function summary() {
      return S.read({ paneId: 'overview', endpoint: SUMMARY_ENDPOINT })
        .then(function (result) { return result.data; });
    }

    function render(data) {
      var openFailed = !!data.open.error;
      var rulesFailed = !!data.rules.error;
      var failed = !!(data.summary && data.summary.error);

      /* armedState({}) is the empty answer, not the unread one, so every
         branch that reads `armed` has to be told which it is looking at.
         Without that, an unreadable rules request renders as "no rule
         exists", which is the pane stating as fact the one thing it does not
         know. */
      var armed = model.armedState(rulesFailed ? {} : (data.rules.data || {}));
      var openProblems = openFailed ? [] : list(data.open.data && data.open.data.problems);
      var problems = openProblems.slice().sort(model.byWorstThenOldest);
      /* A full read is a floor, not a total: problems come back worst first
         and then oldest and stop at model.PAGE, so every count on this pane is
         "at least" when the page came back full. */
      var capped = model.capped(openProblems);
      var figures = data.summary && data.summary.data;

      badgeProblems(problems, capped, openFailed);

      /* Every read unreadable is the whole pane unreadable. Anything less
         renders what did come back.

         The shell draws this card and its retry, and takes the action as an
         argument -- so the landing has to be handed in here. Bare load was
         Stadiora/Aria#10784's third site: pressing it re-read the pane and
         dropped focus on <body>. The band id is the target because a retry
         that works draws bands, and landOn falls through to this card's own
         heading when it does not. */
      if (openFailed && rulesFailed && failed) {
        region.failed(data.open.error, retryAction(ATTENTION_BAND));
        return;
      }

      /* Empty is a real state with a real trigger, and a narrow one: not one
         quiet window, but a pane with nothing behind either of its halves,
         from reads that landed. A read that never landed has not earned the
         sentence "there is nothing here". */
      if (!failed && !openFailed && !rulesFailed &&
          !figures && !problems.length && !armed.total) {
        region.empty(nothingBehindIt());
        return;
      }

      var wrap = h('div', { className: 'stack' });
      wrap.appendChild(ribbon(problems, armed, capped, openFailed, rulesFailed));

      var attention = S.band('What needs a person');
      attention.setAttribute('id', ATTENTION_BAND);
      /* Where the rules failure gets to say so. The queue card draws it when
         the queue card exists AND has no rows, because there it is also the
         reason the list is short. Every other state has no room for it inside
         the card, so it becomes a card of its own -- exactly one of the two
         renders on any screen that got this far, never both, because the same
         words twice is the density this dashboard was redrawn to remove. The
         qualifier is load-bearing: every read down returns above without
         drawing a band, and then the headline is not on screen at all,
         because the shell's own card has already said the whole pane is
         unread. */
      var rulesHosted = !openFailed && !problems.length;
      if (openFailed) {
        failedSection(attention, 'The problems could not be read', data.open.error);
      } else {
        attention.appendChild(queueCard(problems, armed, capped, data.rules.error));
      }
      if (rulesFailed && !rulesHosted) {
        var rulesBox = S.card();
        rulesBox.appendChild(rulesUnreadBlock(data.rules.error, 3, ATTENTION_BAND));
        attention.appendChild(rulesBox);
      }
      wrap.appendChild(attention);

      var going = S.band('How things are going');
      going.setAttribute('id', FIGURES_BAND);
      figuresSection(going, data.summary, openFailed);
      wrap.appendChild(going);

      /* Degraded is the pane on screen with one of its reads unusable, which
         is exactly this: some of it answered and some of it did not. It is not
         the empty state, because a read that never landed has not earned the
         sentence "there is nothing here". */
      if (failed || openFailed || rulesFailed) region.degraded(wrap);
      else region.show(wrap);
    }

    /* A section whose own read failed, in place of what it would have drawn.
       Named where the content would have been rather than replacing the pane,
       because the rest of the page is still true. The same shape the Problems
       pane uses for the same two reads, so an operator moving between the two
       during one incident meets one treatment. */
    function failedSection(band, headline, err) {
      var box = S.card();
      var block = S.stateBlock('warn', headline, [
        S.failureMessage(err),
        'Nothing here is a zero. This part is unread, not empty.'
      ], 3);
      var again = h('button', { className: 'btn btn-primary', type: 'button', text: 'Try again' });
      nameRetry(block, again);
      retryHandler(again, band.getAttribute('id'));
      block.appendChild(h('div', { className: 'row mt-sm' }, [again]));
      box.appendChild(block);
      band.appendChild(box);
    }

    /* The two bands, by a name that survives the re-render. The nodes do not:
       every retry here replaces the whole panel, so a control that wants to
       put the operator back where they were has to name a PLACE, not hold a
       node. */
    var ATTENTION_BAND = 'ov-band-attention';
    var FIGURES_BAND = 'ov-band-figures';

    /* What a retry does, all of it: re-read, then put the operator somewhere
       they can perceive. The second half is Stadiora/Aria#10784 and it is the
       reason load() returns its promise.

       Available as a value and not only as a listener, because the shell draws
       the whole-pane failure card's retry itself and takes the action as an
       argument: region.failed(err, retry). Handing it bare load was the third
       site Stadiora/Aria#10784 names, and it stranded focus on <body> exactly
       like the other two. */
    function retryAction(bandId, want) {
      return function () {
        return load().then(function (landed) {
          if (landed) landOn(bandId, want);
        });
      };
    }

    function retryHandler(button, bandId) {
      button.addEventListener('click', function () {
        retryAction(bandId, String(button.getAttribute('data-retry') || ''))();
      });
    }

    /* The panel the operator can actually see.

       #content holds the loading, empty and live panels at the same time, and
       aria.js shows one of them by putting data-shown on it. Every box is
       cleared when it is filled -- but only the box being filled, so a render
       that switches panels leaves the previous one populated and hidden. A
       band only ever reaches the live box, so the stale node a retry can find
       is the one this pane itself drew a render ago, sitting in a live box
       that is no longer shown. There is no second node with that id to choose
       between: document.getElementById would return that one, being the only
       one, put focus on a heading nobody can see, and read the previous
       render's failure back as if it were this one's. Every lookup below
       starts from the shown panel for that reason. */
    function shownPanel() {
      return first(content, '[data-shown]');
    }

    function first(root, selector) {
      var found = root.querySelectorAll(selector);
      return found.length ? found[0] : null;
    }

    /* Where the operator is put when the read comes back, and why it is a
       heading rather than the button they pressed.

       Pressing Try again re-renders the whole panel, which destroys that
       button. Focus falls back to <body>: everything the operator can perceive
       goes quiet, and the next Tab starts again from the top of the document.
       Restoring focus to the rebuilt button is the obvious repair and it is
       the wrong one, because a retry that SUCCEEDS deletes its own control --
       the section it was in has nothing left to press. The band's heading is
       the node that exists either way, it names the section, and reading on
       from it reaches whatever replaced the content.

       A render that draws no bands at all -- the empty state, or the shell's
       own whole-pane failure card -- lands on that panel's first state
       heading instead. That is the result rather than a place, which is the
       better target when the place is gone.

       Nothing happens if neither is there, and one state reaches that: a
       second load started before this one's landing ran, so the loading
       skeleton is what is shown. Leaving focus alone is right there -- the
       newer read has its own landing coming. */
    function landOn(bandId, want) {
      var panel = shownPanel();
      if (!panel) return;
      var band = first(panel, '[id="' + bandId + '"]');
      var head = band ? first(band, '.band-title') : first(panel, '.state-title');
      if (!head) return;
      /* tabindex -1 so a heading can hold focus without joining the tab order:
         the operator is put there, and Tab carries on into the section rather
         than back to it. */
      head.setAttribute('tabindex', '-1');
      head.focus();
      announceOutcome(head, band, want);
    }

    /* What happened to the read, said out loud, because moving focus to a
       heading announces the heading and not the outcome.

       Whether a section is still unreadable is read off the rendered band
       rather than off the read, so the sentence describes what is now on the
       screen. Every retry this pane draws carries data-retry holding the
       headline of the failure it would re-read, written by nameRetry out of
       the same heading it composes the button's name from -- so the spoken
       outcome and the button's own name cannot drift apart.

       One band can hold two failures, and then the answer has to be about the
       read the operator actually asked for: retrying the rules read and being
       told the problems read is down is a true sentence about the wrong
       thing. So the retried headline wins when it is still on screen. When it
       is gone, what is left in the band is the news -- one read came back and
       another did not, and the one that did not is what the operator needs.
       Only a band with nothing stuck in it is read back as read again. */
    function announceOutcome(head, band, want) {
      var title = String(head.textContent || '');
      if (!band) { S.announce(title + '.'); return; }
      var stuck = band.querySelectorAll('[data-retry]');
      if (!stuck.length) { S.announce(title + ' was read again.'); return; }
      var say = String(stuck[0].getAttribute('data-retry') || '');
      for (var i = 0; i < stuck.length; i++) {
        if (String(stuck[i].getAttribute('data-retry') || '') === want) { say = want; break; }
      }
      S.announce(title + ': ' + say + '.');
    }

    /* The rules read's own failure, in the shape the other two reads already
       get: what went wrong, that it is unread rather than zero, and a control
       that asks again.

       It was the one read with no retry (Stadiora/Aria#10771). Its failure
       was surfaced honestly -- the ribbon says `rules unread` and the queue
       card says whether the checks are running could not be read -- and then
       the operator was stranded, with nothing to press and no error to read.
       Reloading the whole pane was the only way to ask again, which also
       re-runs the two reads that already worked. */
    function rulesUnreadBlock(err, level, bandId) {
      var block = S.stateBlock('warn', 'Whether the checks are running could not be read', [
        S.failureMessage(err),
        'Nothing here is a zero. This part is unread, not empty.'
      ], level);
      var again = h('button', { className: 'btn btn-primary', type: 'button', text: 'Try again' });
      nameRetry(block, again);
      retryHandler(again, bandId);
      block.appendChild(h('div', { className: 'row mt-sm' }, [again]));
      return block;
    }

    /* Two reads can fail at once, and then two buttons reading "Try again" are
       on the page with nothing between them.

       aria-describedby was the first attempt and it was the wrong tool: it
       supplies a DESCRIPTION, announced on focus, and every list that
       enumerates controls — NVDA's Elements List, the VoiceOver rotor — reads
       NAMES. Both entries stayed "Try again" there. Composing the name out of
       the button and its own headline is what those lists read, and it keeps
       the visible word as the first token, so voice control still works on
       what the operator can see. aria-label would have replaced that word. */
    var retryN = 0;
    function nameRetry(block, again) {
      var kids = block.childNodes || [];
      for (var i = 0; i < kids.length; i++) {
        if (/^h[1-6]$/i.test(String(kids[i].tagName || ''))) {
          retryN += 1;
          /* setAttribute, not .id. The DOM harness these are tested through
             has no id accessor, so a property write leaves getAttribute('id')
             null: every reference would dangle in the tests while working in
             a browser. That is a false RED, not a false green -- measured on
             this head, three tests fail, one in
             ops-overview-degraded.test.mjs and two in
             ops-overview-retry-focus.test.mjs -- but it is the kind of false
             red that gets "fixed" by loosening the assertion, and then the
             loosened assertion is the false green. (Stadiora/Aria#10824: this
             comment used to say "false green by construction", which is
             backwards, and the clone of this function in pane-alerts.js was
             corrected first.) */
          var headingId = kids[i].getAttribute('id');
          if (!headingId) {
            headingId = 'ov-failed-' + retryN;
            kids[i].setAttribute('id', headingId);
          }
          var buttonId = 'ov-retry-' + retryN;
          again.setAttribute('id', buttonId);
          again.setAttribute('aria-labelledby', buttonId + ' ' + headingId);
          /* The same heading again, as a value this time, for the spoken
             outcome after a retry lands. Written here rather than at the three
             call sites so the sentence an operator hears and the name their
             screen reader speaks are the same string by construction. */
          again.setAttribute('data-retry', String(kids[i].textContent || ''));
          return;
        }
      }
    }

    /* The Problems count beside the rail item.

       A real read or nothing: this is the count this pane just asked for, and
       a rail badge that invents one is worse than a rail with no badge. It is
       cleared as well as set, so a page that lands on a quiet system does not
       keep a stale count from a previous render, and a read that failed takes
       the badge away rather than leaving yesterday's number beside a queue
       this pane could not read. */
    function badgeProblems(problems, capped, failed) {
      var needing = failed ? 0 : model.needingAction(problems).length;
      if (!needing) {
        S.setBadge('alerts', null);
        return;
      }
      S.setBadge('alerts', {
        label: fmt.int(needing) + (capped ? '+' : ''),
        tone: 'hot',
        description: needing === 1
          ? 'one problem with nobody on it'
          : fmt.int(needing) + ' problems with nobody on them'
      });
    }

    function nothingBehindIt() {
      var box = S.card();
      var block = S.stateBlock('empty', 'Nothing is behind this pane yet', [
        'No alert rule has been created and the operations API returned no figures.',
        'Nothing is being hidden from you, and nothing here is a zero.'
      ]);
      block.appendChild(h('div', { className: 'row mt-sm' }, [
        S.link(S.paneHref('settings') || 'settings.html', 'Settings', 'btn btn-primary')
      ]));
      box.appendChild(block);
      return box;
    }

    /* ------------------------------------------------------------- ribbon

       The scan-first answer to "is anything wrong right now". It has three
       readings and they are genuinely different facts:

         nothing is wrong and the checks are running
         something is wrong, and here is the worst of it
         we do not know, because the checks are not running

       The third is the one an operations dashboard usually gets wrong by
       drawing it as the first.

       Which problems count as "something is wrong" is the other thing this is
       easy to get wrong. It is every problem that is still open, whether or
       not somebody has taken it on. Taking a problem on answers who owns it,
       not whether it is fixed, so reading only the unassigned ones lets a
       critical incident turn this ribbon green the moment an engineer puts
       their name against it. The queue below still separates the two, because
       what needs a person and what is being worked on are different lists. */
    var RIBBON_TONE = { crit: 'st-bad', warn: 'st-warn', info: 'st-acc' };

    function ribbon(problems, armed, capped, openFailed, rulesFailed) {
      var active = model.active(problems);
      var needing = model.needingAction(problems);
      var worst = model.worstSeverity(active);

      var title;
      var sub;
      var tone;

      /* Two more readings of "we do not know", both of them a read that never
         landed rather than a check that is not running. They come first
         because every branch below states something this pane was not told:
         an unread queue cannot say "everything is working", and an unread
         rules list cannot tell an empty queue apart from nothing looking. */
      if (openFailed) {
        tone = 'st-warn';
        title = 'Whether anything is wrong is unknown';
        /* No sub. "The problems could not be read" is the heading of the card
           directly beneath this ribbon, and saying it twice in two inches is
           the density the whole remodel is trying to remove. The title above
           already states what is unknown. */
        sub = '';
      } else if (rulesFailed && !active.length) {
        tone = 'st-warn';
        title = 'Nothing is open, and whether anything is watching is unknown';
        sub = 'The rules could not be read, so a quiet queue cannot be told apart ' +
          'from nothing looking.';
      } else if (!rulesFailed && !armed.trustworthy) {
        tone = 'st-warn';
        title = 'Nothing is being checked';
        sub = unarmedSentence(armed);
      } else if (!active.length) {
        tone = 'st-ok';
        title = 'Everything is working';
        /* The chip beside this one already says how many rules are checking,
           so the sub carries only the part the chip cannot: when they last
           reached a verdict. A rule that is armed and has not run in a day is
           not checking anything, and nothing else on this row says so. */
        sub = armed.lastEvaluatedAt
          ? 'Rules last reached a verdict ' + fmt.ago(armed.lastEvaluatedAt)
          : 'No rule has reached a verdict yet';
      } else {
        /* The ribbon takes its tone from the worst thing that is actually
           open. Painting a single informational problem in warning colours
           would make the pane cry wolf, and a pane that cries wolf is a pane
           whose red is ignored the day it means something. */
        tone = RIBBON_TONE[model.SEVERITY_TONE[worst]] || 'st-acc';
        title = ribbonTitle(active, needing, capped);
        sub = activeSentence(active, needing, capped);
      }

      var hero = h('section', { className: 'hero ' + tone });
      hero.appendChild(h('div', { className: 'hero-orb', 'aria-hidden': 'true' }, [
        h('i'), h('i'), h('b')
      ]));
      var words = h('div', {}, [h('h2', { className: 'hero-title', text: title })]);
      if (sub) words.appendChild(h('p', { className: 'hero-sub', text: sub }));
      hero.appendChild(words);
      hero.appendChild(ribbonChips(problems, armed, capped, rulesFailed));
      return hero;
    }

    /* One problem is named. More than one is counted, and the count says
       whether anybody is on them, because "3 problems need a person" over
       three problems that all have somebody on them is the same lie in
       smaller type.

       The counted branch is reached with a count of one as well, whenever the
       single unassigned problem has acknowledged problems beside it, so the
       verb is chosen from the count rather than assumed plural. */
    function ribbonTitle(active, needing, capped) {
      if (!needing.length) {
        return active.length === 1
          ? active[0].title
          : model.atLeast(fmt.plural(active.length, 'problem'), capped) + ' still open';
      }
      if (needing.length === 1 && active.length === 1) return needing[0].title;
      return model.atLeast(fmt.plural(needing.length, 'problem'), capped) +
        (needing.length === 1 ? ' needs a person' : ' need a person');
    }

    function activeSentence(active, needing, capped) {
      var bits = [];

      if (needing.length) bits.push(oldestSentence(needing));
      else {
        bits.push('Somebody is on ' + (active.length === 1 ? 'it' : 'each of them') +
          ', still open.');
      }
      if (capped) bits.push(cappedSentence());
      return bits.join(' ');
    }

    /* Said wherever a count from a full read is printed, because "at least" on
       its own reads as a rounding rather than as a ceiling that was hit. */
    function cappedSentence() {
      return 'Read stopped at ' + fmt.int(model.PAGE) + ', so counts are the lowest possible.';
    }

    /* Why nothing can be believed, in the reading that is actually true.
       Every count here is over the enabled rules, so they can be read against
       each other. */
    function unarmedSentence(armed) {
      /* No sentence: the chip beside the title already says `0 of 0 rules
         checking`, which is the whole of "there are no alert rules at all".
         The other three branches each carry a cause the chip cannot. */
      if (!armed.total) return '';
      if (!armed.enabled) {
        return 'None of the ' + fmt.int(armed.total) +
          ' rules are enabled, so nothing would be noticed.';
      }
      if (armed.neverRun === armed.enabled) {
        return 'The rules are enabled but none has run yet, so nothing has been judged.';
      }
      if (armed.errored === armed.enabled) {
        return 'Every enabled rule failed its own check the last time it ran.';
      }
      if (armed.errored) {
        return 'No enabled rule reached a verdict the last time it ran, and ' +
          fmt.int(armed.errored) + ' of them failed the check itself.';
      }
      return 'Every enabled rule is short of the data it needs to judge.';
    }

    function oldestSentence(needing) {
      var oldest = model.iso(model.oldest(needing.map(function (p) { return p.firedAt; })));
      var taken = needing.length === 1 ? 'Nobody is on it' : 'Nobody is on them';
      /* Dated, not a bare clock: an incident two days old stamped 06:00:00 UTC
         reads as six this morning, and the whole point of a UTC stamp is that
         two operators in two time zones can quote the same instant. Every
         other absolute time on this pane carries its date too. */
      var when = fmt.utcStamp(oldest);
      if (!oldest || !when) return taken + '.';
      return 'Oldest started ' + when + ', ' + fmt.since(oldest) + ' ago. ' +
        taken + '.';
    }

    /* The counts, as chips, each carrying a glyph and a word so none of them
       relies on its colour to be read. */
    var CHIP_CLASS = { crit: 'down', warn: 'warn', info: 'info', ok: 'up' };
    var CHIP_ICON = { crit: 'warn', warn: 'warn', info: 'info', ok: 'check' };

    /* The severities this pane can name, worst first, which is both the order
       the chips are read in and the test for whether a severity is one of
       them. A list rather than a lookup on the label map, because every plain
       object already answers to `constructor` and `toString`, and a severity
       arriving with one of those words in it would pass a truthiness test on
       a map and then be counted as a severity the pane knows. */
    var KNOWN_SEVERITIES = ['critical', 'warning', 'info'];

    function chip(tone, text) {
      var pill = h('span', { className: 'pill ' + (CHIP_CLASS[tone] || '') });
      pill.appendChild(icon(CHIP_ICON[tone] || 'info'));
      pill.appendChild(h('span', { text: text }));
      return pill;
    }

    function ribbonChips(problems, armed, capped, rulesFailed) {
      var row = h('div', { className: 'hero-chips' });
      var counts = { critical: 0, warning: 0, info: 0 };
      /* Everything still open whose severity is not one of the three. Counted
         rather than skipped: the ribbon above this row counts every open
         problem, so a breakdown that quietly drops the ones it cannot name
         sits under a title that contradicts it, and the problems that vanish
         are exactly the ones nobody has looked at yet. */
      var unknown = 0;
      /* Counted over everything still open, taken on or not, for the same
         reason the ribbon reads it that way: a problem with somebody's name on
         it is still a problem. */
      model.active(problems).forEach(function (p) {
        if (KNOWN_SEVERITIES.indexOf(p.severity) !== -1) counts[p.severity]++;
        else unknown++;
      });

      KNOWN_SEVERITIES.forEach(function (severity) {
        if (!counts[severity]) return;
        row.appendChild(chip(model.SEVERITY_TONE[severity],
          model.atLeast(fmt.int(counts[severity]), capped) + ' ' + severity));
      });

      /* One chip for all of them rather than one per unrecognised word: the
         count is the part that has to add up here, and the words themselves
         are on the rows below, each shown as it arrived. */
      if (unknown) {
        row.appendChild(chip('info',
          model.atLeast(fmt.int(unknown), capped) + ' of unknown severity'));
      }

      var taken = model.takenOn(problems);
      if (taken.length) {
        row.appendChild(chip('info',
          model.atLeast(fmt.plural(taken.length, 'problem'), capped) + ' taken on'));
      }

      /* The armed proof. `0 of 0 rules checking` is a real answer when the
         rules read landed and a fabrication when it did not, and the two look
         identical on screen, so the unread case says it is unread instead of
         printing a count nobody reported. */
      if (rulesFailed) {
        row.appendChild(chip('warn', 'rules unread'));
      } else {
        row.appendChild(chip(armed.trustworthy ? 'ok' : 'warn',
          fmt.int(armed.checking) + ' of ' + fmt.int(armed.total) + ' rules checking'));
      }

      /* A channel that was never connected is where a problem goes to be
         missed, so it is stated here rather than only on the pane that owns
         it. */
      var unconfigured = armed.channels.filter(function (c) { return c.configured !== true; });
      if (unconfigured.length) {
        row.appendChild(chip('warn', fmt.plural(unconfigured.length, 'route') + ' not set up'));
      }
      return row;
    }

    /* -------------------------------------------------------------- queue */

    function queueCard(problems, armed, capped, rulesError) {
      var card = S.card();
      var rulesFailed = !!rulesError;
      var needing = model.needingAction(problems);
      var taken = model.takenOn(problems);

      /* A bare zero over a truncated read is the one figure on this card that
         cannot be qualified by the footer alone: a full page keeps the oldest
         of each severity and drops the newest, and a newer problem with nobody
         on it is exactly what it drops. */
      /* No count here. The ribbon above already says how many need a person,
         the chips beside it say the same by severity, and the rows below are
         the count. The empty case keeps a sentence because it says something
         the rows cannot: the list is short because nobody is being asked to
         do anything, not because the read came back thin. */
      card.appendChild(S.cardHead('Needs attention',
        needing.length
          ? null
          : (capped
              ? 'Nobody is being asked to do anything in the ' + fmt.int(model.PAGE) +
                ' problems that could be read'
              : 'Nobody is being asked to do anything'),
        [S.link(S.paneHref('alerts') || 'alerts.html', 'All problems', 'btn btn-sm btn-ghost')]));

      var body = h('div', { className: 'card-body' });

      if (!problems.length) {
        /* The ribbon above already carries the reason, and it carries it in
           these exact words. This block keeps its own heading, because a
           reader who scrolled to the queue needs to know why it is empty
           without scrolling back, and adds nothing the ribbon said.

           Three readings, not two: the checks are running, the checks are not
           running, and nobody could read which. The third used to render as
           the second, because an unread rules list reaches armedState as the
           empty one. */
        body.appendChild(rulesFailed
          ? rulesUnreadBlock(rulesError, 4, ATTENTION_BAND)
          : (armed.trustworthy
              ? quietBlock(armed)
              : S.stateBlock('warn', 'The checks are not running', [], 4)));
        card.appendChild(body);
        return card;
      }

      var list = h('div', { className: 'q-list' });
      var shown = needing.concat(taken).slice(0, QUEUE_LIMIT);
      shown.forEach(function (problem) { list.appendChild(queueItem(problem)); });
      body.appendChild(list);
      card.appendChild(body);

      var foot = h('div', { className: 'card-foot' });
      var rest = problems.length - shown.length;
      if (rest > 0 || capped) {
        foot.appendChild(h('span', {
          text: (rest > 0
            ? model.atLeast(fmt.plural(rest, 'more problem'), capped) + ' open'
            : cappedSentence())
        }));
      } else {
        foot.appendChild(h('span', {
          className: 'dot ok', 'aria-hidden': 'true'
        }));
        /* The chip beside the ribbon already counts the rules that are
           checking. The fact this footer owns is that the rows above are all
           of them. */
        foot.appendChild(h('span', {
          text: 'Nothing else has tripped'
        }));
      }
      card.appendChild(foot);
      return card;
    }

    /* A quiet queue has to prove it is quiet for the right reason, exactly as
       the Problems pane's own empty state does. */
    function quietBlock(armed) {
      /* How many rules are checking is on the chip, and when they last
         reached a verdict is in the ribbon sub directly above. Neither says
         when a problem last fired, which is the fact that tells a quiet queue
         apart from a queue nothing has ever reached. */
      return S.stateBlock('check', 'Nothing needs attention', [
        armed.lastFiredAt
          ? 'Last problem fired ' + fmt.ago(armed.lastFiredAt) + '.'
          : 'No problem has ever fired.'
      ], 4);
    }

    var SEVERITY_ACCENT = { crit: 'acc-bad', warn: 'acc-warn', info: 'acc-blue' };
    var SEVERITY_INK = { crit: 'is-crit', warn: 'is-warn', info: 'is-info' };

    /* A severity in words, for a value that may not be one of the three this
       dashboard has a word for.

       An unrecognised severity is shown exactly as it arrived rather than
       translated, which is what alerts-model.js says its lookups do. The
       Problems pane takes the same three steps for the same problem
       (`severityWords()` there too, Stadiora/Aria#10630), so two panes an
       operator moves between during one incident say one word for one state.

       Both panes' `textOf()` TRIM, which is what makes the agreement hold on
       every payload rather than on the three #10630 tabulated. Until
       Stadiora/Aria#10799 this one did not, so a severity of nothing but
       spaces read "Unknown" on the Problems pane and printed a blank prefix
       here — #10630's defect 1 surviving on the other pane by another route.

       Only a severity that did not arrive at all, or arrived as something
       that is not a word, falls back to "Unknown", because there is nothing
       to show and a row that silently drops its prefix tells the operator
       nothing is missing.

       Both lookups go through textOf(), so a severity of `constructor` or
       `toString` — words every plain object in JavaScript answers to — cannot
       reach the screen as the source of a function. */
    function severityWords(severity) {
      return textOf(model.SEVERITY_LABEL[severity]) || textOf(severity) || 'Unknown';
    }

    function queueItem(problem) {
      var tone = model.SEVERITY_TONE[problem.severity] || 'info';
      var box = S.card('accent q-item ' + (SEVERITY_ACCENT[tone] || 'acc-blue'));
      var body = h('div', { className: 'card-body' });
      var row = h('div', { className: 'q-row' });

      var glyph = icon(problem.severity === 'info' ? 'info' : 'warn',
        'q-ico ' + (SEVERITY_INK[tone] || 'is-info'));
      glyph.setAttribute('aria-hidden', 'true');
      row.appendChild(glyph);

      var words = h('div');
      /* The severity in words as well as in the accent colour and the glyph,
         because the accent is the only thing separating a critical item from
         an informational one at a glance. */
      /* h4, not h3: this row sits inside the queue card, whose own title is
         the h3. */
      words.appendChild(h('h4', {
        className: 'q-title ' + (SEVERITY_INK[tone] || 'is-info'),
        text: severityWords(problem.severity) + ': ' + problem.title
      }));
      words.appendChild(h('p', { className: 'q-desc', text: problem.summary }));

      var actions = h('div', { className: 'q-actions' });
      /* Through textOf() for the reason severityWords() is: the answer names
         the pane, and a pane named `constructor` would make this lookup true
         and put a function into an href. */
      var file = textOf(model.PANE_FILE[problem.workPane]);
      /* The doorway. Overview owns no detail, so the only thing it offers is
         the pane where the work happens and the pane that owns the problem. */
      if (file && problem.workPane !== 'overview') {
        actions.appendChild(S.link(S.paneHref(paneKey(problem.workPane)) || file,
          problem.workPaneLabel));
      }
      actions.appendChild(S.link(S.paneHref('alerts') || 'alerts.html',
        'Problem ' + problem.reference));
      if (problem.status === 'acknowledged' && problem.acknowledgedByEmail) {
        actions.appendChild(h('span', {
          className: 'q-who', text: problem.acknowledgedByEmail + ' is on it'
        }));
      }
      words.appendChild(actions);

      row.appendChild(words);
      body.appendChild(row);
      box.appendChild(body);
      return box;
    }

    /* The problems API names a work pane with the file-ish keys
       OpsAlertsModel.PANE_FILE holds; the registry keys differ for two of
       them. Translated rather than assumed, so a link that cannot be built
       from the registry falls back to the model's own file. */
    var WORK_PANE_KEY = { 'jobs-live': 'jobs', 'run-history': 'history' };

    function paneKey(workPane) {
      return WORK_PANE_KEY[workPane] || workPane;
    }

    /* ------------------------------------------------------- the figures */

    /* A number the answer actually sent, or null.

       Never a substituted zero. On a pane whose one stated rule is that empty
       never means zero, a missing field coerced to 0 is that rule broken in
       the exact place it was written for, and it is broken silently: the tile
       still renders, confidently, in the same type as a billed figure. */
    function num(value) {
      return (typeof value === 'number' && isFinite(value)) ? value : null;
    }

    /* A list the answer actually sent, or an empty one.

       `value || []` is not this. It rescues null and undefined and then hands
       a number, a string or an object straight through to .filter or .length,
       which either throws or, worse, reads undefined and draws the state for
       "there were none". Every list on this pane decides whether something is
       said at all, so a shape the route did not promise has to land on
       "nothing to say" rather than on a silent zero. */
    function list(value) {
      return Array.isArray(value) ? value : [];
    }

    function stateOf(block) {
      var state = block && block.availability && block.availability.state;
      return typeof state === 'string' ? state : null;
    }

    function detailOf(block, fallback) {
      var detail = block && block.availability && block.availability.detail;
      return (typeof detail === 'string' && detail) ? detail : fallback;
    }

    /* A string worth showing, or nothing.

       Trimmed, because a severity of three spaces is a non-empty string and
       would otherwise print as a blank where a word belongs — visible to
       nobody, and indistinguishable from a row that never had one
       (Stadiora/Aria#10799). The Problems pane's `textOf()` has always
       trimmed; this is the two of them agreeing on every payload rather than
       on the three #10630 happened to tabulate.

       Every caller uses the RESOLVED value rather than testing with this and
       rendering the raw field, because a predicate that trims over a value
       that does not is the same defect wearing the fix.

       No count of those callers lives here. Three were written into this
       comment across three rounds of PR #124's review and all three were
       wrong; the invariant is checked by
       `ops-overview-blank-text.test.mjs`'s "padding any string the answer
       carries changes nothing on the screen", which pads every string the
       fixture holds and requires the rendered panel to come back
       byte-identical. Check the render, not this line.

       And note what this function returns for a value that does not
       resolve: null. `S.h` maps that to an empty string, but a caller that
       CONCATENATES it prints the four characters `null` — which is how
       `chartName()` came to say "over the last 7 whole UTC days, null to
       null" in review round 3. Concatenating callers must guard. */
    function textOf(value) {
      if (typeof value !== 'string') return null;
      var trimmed = value.trim();
      return trimmed || null;
    }

    /* The window a figure covers, in words, read from the answer rather than
       written here.

       Day-grain production answers carry `days`; hour-grain answers carry
       `hours` and `grain: "hour"`. Reading both is what lets the website and
       API deploy in either order without a label that claims a window the
       payload did not measure. A window the answer did not describe says so
       rather than guessing. */
    function isHourWindow(win) {
      return !!(win && (textOf(win.grain) === 'hour' || num(win.hours) !== null));
    }

    function activityUnit(win) {
      return isHourWindow(win) ? 'hour' : 'day';
    }

    function windowLabel(win) {
      if (isHourWindow(win)) {
        var hours = num(win && win.hours);
        if (hours === null) return 'Window not reported';
        return 'Last ' + fmt.plural(hours, 'hour') + ' (UTC)';
      }
      var days = num(win && win.days);
      if (days === null) return 'Window not reported';
      return 'Last ' + fmt.plural(days, 'whole UTC day');
    }

    /* The same window mid-sentence, for the chart's spoken description. */
    function windowPhrase(win) {
      if (isHourWindow(win)) {
        var hours = num(win && win.hours);
        if (hours === null) return 'a window the answer did not describe';
        return 'the last ' + fmt.plural(hours, 'hour') + ' (UTC)';
      }
      var days = num(win && win.days);
      if (days === null) return 'a window the answer did not describe';
      return 'the last ' + fmt.plural(days, 'whole UTC day');
    }

    function tile(label) {
      var card = S.card('kpi');
      var body = h('div', { className: 'card-body' });
      body.appendChild(h('h3', { className: 'kpi-label', text: label }));
      card.appendChild(body);
      card.body = body;
      return card;
    }

    function value(card, text) {
      card.body.appendChild(h('div', { className: 'kpi-val', text: text }));
    }

    function meta(card, nodes) {
      card.body.appendChild(h('div', { className: 'kpi-meta' }, nodes));
    }

    function why(card, text, tone) {
      card.body.appendChild(h('div', {
        className: 'kpi-why' + (tone === 'warn' ? ' is-warn' : ''), text: text
      }));
    }

    /* The doorway. Overview owns no detail, so a tile ends at the pane that
       owns the question behind it. */
    function doorway(card, owner, extra) {
      var foot = h('div', { className: 'kpi-foot' });
      var before = list(extra);
      before.forEach(function (node) { foot.appendChild(node); });
      if (before.length) foot.appendChild(h('div', { className: 'spacer' }));
      foot.appendChild(h('a', { href: owner.href, text: owner.label }));
      card.appendChild(foot);
    }

    /* What a tile says when its block is not `ready`.

       This is the branch the whole contract is shaped around, so it is the
       default rather than the exception: a tile draws a figure only when the
       state is `ready` AND the figure is a number the answer sent. Everything
       else lands here, including a state this file has never heard of, and
       every wording here is words rather than a numeral. `not_reporting` in
       particular reads "no reading", never 0: the two are different facts and
       an operator who cannot tell them apart will go looking for the wrong
       problem, or for none at all. */
    var UNAVAILABLE_WORDS = {
      not_reporting: 'No reading',
      not_collected: 'Not collected',
      not_reported: 'Not reported',
      not_published: 'Not published',
      mixed_currency: 'Two currencies',
      insufficient: 'Too few to report'
    };

    function unavailable(card, block, fallbackDetail) {
      var state = stateOf(block);
      card.body.appendChild(h('div', {
        className: 'kpi-val words',
        text: (state && UNAVAILABLE_WORDS[state]) || 'Not reported'
      }));
      why(card, detailOf(block, fallbackDetail));
      return card;
    }

    /* ------------------------------------------------------ active people */

    function peopleTile(people) {
      var card = tile('Active people');
      var active = num(people && people.platform && people.platform.active);

      if (stateOf(people) !== 'ready' || active === null) {
        unavailable(card, people,
          'The answer carried no active-people figure for this window.');
        doorway(card, OWNER_PANE.people);
        return card;
      }

      value(card, fmt.int(active));
      meta(card, peopleChange(people, active));
      var environment = textOf(people.environment);
      why(card, windowLabel(people.window) + (environment ? ', ' + environment : ''));

      /* The two apps, side by side and never added. The headline above them is
         the platform's own distinct count rather than their sum, so a reader
         who adds the two by eye and gets a larger number is looking at the one
         person who used both. */
      var apps = list(people.apps).filter(function (app) {
        return num(app && app.active) !== null;
      });
      var pills = apps.map(function (app) {
        var pill = h('span', { className: 'pill' });
        pill.appendChild(h('span', {
          className: 'dot ' + seriesTone(app.tone), 'aria-hidden': 'true'
        }));
        pill.appendChild(h('span', { text: textOf(app.label) || textOf(app.app) || 'Unnamed app' }));
        pill.appendChild(h('span', { className: 'mono', text: fmt.int(app.active) }));
        return pill;
      });

      doorway(card, OWNER_PANE.people, pills);
      return card;
    }

    /* The change in active people, computed here from the two counts.

       The route hands over this window's count, the window before it, and the
       reporting floor, rather than a percentage, so that the floor is applied
       at the moment of display: whether a figure may be SHOWN is a rule about
       this screen, and it has to hold whatever a later version of the route
       decides to send.

       The floor is tested against the count being divided by. A share over a
       group that small moves several points when one person does, and a reader
       has no way to tell that from a real change, so the two counts are printed
       instead. They are always safe: a count is not a rate, and one person
       moves it by one.

       An absent comparison is not a zero and not a rise from nothing. The
       payload leaves `comparison` and `previousActive` out entirely when the
       window before has no reading or is past the retention horizon, and both
       of those are the absence of a measurement rather than a collapse to
       nobody. The reason travels in the block's own note, which is printed
       under the tiles. */
    function peopleChange(people, active) {
      var before = num(people.platform && people.platform.previousActive);
      var floor = num(people.reportingFloor);
      if (floor === null) floor = REPORTING_FLOOR;

      if (before === null || !people.comparison) {
        return [h('span', { text: 'No comparison available' })];
      }
      if (before < floor) {
        return [
          h('span', { className: 'mono', text: fmt.int(before) + ' before' }),
          h('span', {
            text: 'no rate under ' + fmt.plural(floor, 'person', 'people')
          })
        ];
      }

      var basisPoints = Math.round(((active - before) / before) * 10000);
      /* The comparison window is the window before this one, and the route
         says how long it was. A missing `days` is the length of that window
         being unreported, so it is left unsaid: "in the 0 days before" is a
         number this pane invented, on the one tile whose rule is that a
         figure it did not read is never drawn. */
      var days = num(people.comparison.days);
      return [
        deltaPill(basisPoints, basisPoints > 0 ? 'up' : basisPoints < 0 ? 'down' : ''),
        h('span', {
          text: 'against ' + fmt.int(before) + ' in the ' +
            (days === null ? 'window' : fmt.plural(days, 'day')) + ' before'
        })
      ];
    }

    /* A change, with its direction carried by a glyph and a sign as well as by
       the pill's colour.

       The glyph reads the figure's own sign; the tone is a separate argument
       because direction and valence are different facts and the tiles disagree
       about them. More people is good news and more spend is not, so the cost
       tile passes `down` for a rise — and until this was found in review the
       glyph was derived from that same word, which drew a falling chevron
       beside `+6.4%`. */
    function deltaPill(basisPoints, tone) {
      var pill = h('span', { className: 'pill' + (tone ? ' ' + tone : '') });
      var bp = num(basisPoints);
      if (tone && bp !== null && bp !== 0) pill.appendChild(icon(bp > 0 ? 'up' : 'down'));
      pill.appendChild(h('span', { text: fmt.signedPercent(basisPoints) }));
      return pill;
    }

    /* ----------------------------------------------------------- AI runs */

    function aiRunsTile(aiRuns) {
      var card = tile('Aria AI runs');
      var runs = num(aiRuns && aiRuns.runs);

      if (stateOf(aiRuns) !== 'ready' || runs === null) {
        unavailable(card, aiRuns, 'The answer carried no AI run count for this window.');
        doorway(card, OWNER_PANE.runs);
        return card;
      }

      value(card, fmt.int(runs));

      /* Counts rather than a percentage, and absent rather than zero when the
         window before was never reconciled: a comparison against a window
         nothing was collected for reads as a collapse in AI use. */
      var previous = num(aiRuns.previous && aiRuns.previous.runs);
      meta(card, [h('span', {
        text: previous === null
          ? 'No comparison available'
          : 'against ' + fmt.int(previous) + ' in the window before'
      })]);

      why(card, windowLabel(aiRuns.window));

      /* A day with no reconciliation row has no reading, which is not a day
         with no runs. Saying how many days are behind the total is what lets a
         reader tell a quiet week from a stalled nightly job. */
      var missing = list(aiRuns.daysMissing).length;
      var reported = num(aiRuns.daysReported);
      if (missing > 0) {
        why(card, 'Counted from ' +
          (reported === null ? 'the days that reconciled' : fmt.plural(reported, 'day')) +
          ', ' + fmt.plural(missing, 'day') + ' not reconciled yet.', 'warn');
      }

      doorway(card, OWNER_PANE.runs);
      return card;
    }

    /* -------------------------------------------------------- cloud spend */

    /* Spend, and deliberately no budget bar.

       Nothing in this platform records a cloud budget. The route says so in
       `omissions` and marks the figure `basis: 'spend'` rather than sending a
       zero, and a bar drawn against an absent target is the one way this tile
       could push an operator into an action: an empty track reads as a budget
       with nothing spent against it, and a full one as a budget already gone.
       The omission is printed instead, with the reason, under the tiles. */
    function costTile(cost) {
      var card = tile('Cloud spend');
      var micros = num(cost && cost.micros);

      if (stateOf(cost) !== 'ready' || micros === null) {
        unavailable(card, cost, 'The answer carried no billed total for this period.');
        doorway(card, OWNER_PANE.cost);
        return card;
      }

      value(card, fmt.money(micros, cost.currency));

      var change = num(cost.comparison && cost.comparison.changeBasisPoints);
      var against = textOf(cost.comparison && cost.comparison.label);

      if (change === null) {
        meta(card, [h('span', { text: 'No comparison available' })]);
      } else {
        /* Sent, not computed. The comparison window is clamped inside the
           previous period by the route that owns the cost arithmetic, and a
           second implementation of it here would be a second figure with
           nothing on screen saying which one an operator is reading. Spending
           more is the direction that costs money, so a rise takes the falling
           tone the Cloud costs pane gives it.

           The pill is the size and the direction; what the figure is measured
           against is a different fact and appears nowhere else, so it is said
           beside it in the route's own words. */
        meta(card, [
          deltaPill(change, change > 0 ? 'down' : change < 0 ? 'up' : ''),
          h('span', { text: against || 'against the same stretch of the period before' })
        ]);
      }

      /* Where in the billing period this total stops, and when it was read.
         One line, because "day 12 of 31" on its own invites the reading that
         the rest of the month is already known. */
      var period = cost.window || {};
      var dayOf = num(period.dayOfPeriod);
      var daysIn = num(period.daysInPeriod);
      var asOf = fmt.utcStamp(cost.asOf);
      var where = dayOf !== null && daysIn !== null
        ? 'Day ' + fmt.int(dayOf) + ' of ' + fmt.int(daysIn)
        : 'Month to date';
      why(card, asOf ? where + ', billed usage as of ' + asOf + '.'
        : where + '. The time of this reading was not reported.',
        asOf ? null : 'warn');

      /* `basis` says what was measured, and "Cloud spend" above the figure
         already says it is money spent rather than a share of a budget, so a
         basis this tile is labelled for adds no sentence. The gap where a
         budget would be is named once, in the omissions card, in the route's
         words. A basis this pane has no label for is stated rather than
         quietly drawn under the wrong one. */
      var basis = textOf(cost.basis);
      if (basis && basis !== 'spend') why(card, 'Measured as ' + basis + '.', 'warn');

      doorway(card, OWNER_PANE.cost);
      return card;
    }

    /* --------------------------------------------------- the app version */

    /* Per platform and never merged. iOS and Android ship separately and
       really do sit on different versions, so one headline "the app version"
       would be true of at most one store. */
    function releaseTile(release) {
      var card = tile('App version in production');
      var platforms = list(release && release.platforms).filter(function (platform) {
        return textOf(platform && platform.versionName);
      });

      if (stateOf(release) !== 'ready' || !platforms.length) {
        unavailable(card, release, 'Neither store reported a production version.');
        doorway(card, OWNER_PANE.release);
        return card;
      }

      var rows = h('div', { className: 'kpi-rows' });
      var newest = null;
      platforms.forEach(function (platform) {
        var code = textOf(platform.versionCode);
        rows.appendChild(h('div', { className: 'kpi-row' }, [
          h('span', {
            className: 'kpi-plat',
            text: textOf(platform.label) || textOf(platform.platform) || 'Unnamed platform'
          }),
          h('div', { className: 'spacer' }),
          h('span', {
            className: 'num',
            text: textOf(platform.versionName) + (code ? ' (' + code + ')' : '')
          })
        ]));
        var read = fmt.hoursSince(platform.fetchedAt);
        if (read !== null && (newest === null || read < newest)) newest = read;
      });
      card.body.appendChild(rows);

      if (newest !== null) {
        why(card, newest <= 0
          ? 'Read from the stores within the hour.'
          : 'Read from the stores ' + fmt.hours(newest) + ' ago.');
      }
      doorway(card, OWNER_PANE.release);
      return card;
    }

    /* ------------------------------------------------- the activity line */

    function finiteCount(values) {
      var n = 0;
      list(values).forEach(function (v) { if (num(v) !== null) n += 1; });
      return n;
    }

    function activityCard(activity) {
      var series = list(activity && activity.series);
      var unit = activityUnit(activity && activity.window);
      var card = S.card();

      var legend = h('div', { className: 'legend' });
      series.forEach(function (one) {
        var key = h('span', { className: seriesTone(one.color) });
        key.appendChild(h('i', { 'aria-hidden': 'true' }));
        key.appendChild(h('span', { text: textOf(one.label) || textOf(one.key) || 'Unnamed series' }));
        legend.appendChild(key);
      });

      card.appendChild(S.cardHead('People active each ' + unit,
        windowLabel(activity && activity.window),
        series.length ? [legend] : null));

      var body = h('div', { className: 'card-body' });

      if (stateOf(activity) !== 'ready' || !series.length) {
        /* Words rather than an empty chart. An axis with no line on it is read
           as a measured flat zero, which is the one thing a window with no
           stored reading must not look like. */
        body.appendChild(S.stateBlock('empty', 'There is no line to draw for this window',
          [detailOf(activity, unit === 'hour'
            ? 'The answer carried no hourly figures for this window.'
            : 'The answer carried no daily figures for this window.')], 4));
        card.appendChild(body);
        appendNote(card, activity && activity.note);
        return card;
      }

      var labels = list(activity.labels).slice();
      var missing = list(isHourWindow(activity && activity.window)
        ? activity.hoursMissingRollups : activity.daysMissingRollups)
        .filter(function (gap) { return typeof gap === 'string'; });
      var drawable = series.filter(function (one) { return finiteCount(one.values) > 1; });

      if (drawable.length) {
        body.appendChild(lineChart(series, labels, activity.window, missing));
        if (labels.length) {
          var axis = h('div', { className: 'axis-x', 'aria-hidden': 'true' });
          axis.appendChild(h('span', { text: labelAt(labels, 0) }));
          if (labels.length > 1) {
            axis.appendChild(h('span', { text: labelAt(labels, labels.length - 1) }));
          }
          body.appendChild(axis);
        }
      } else {
        /* One reading is a point, not a line, and there is nothing
           to join up. The figures below still say what was counted. */
        body.appendChild(S.stateBlock('empty',
          'Not enough ' + unit + 's to draw a line yet',
          ['Fewer than two ' + unit + 's in this window have a stored reading.'], 4));
      }

      /* The chart's own numbers, in text. Nothing on this pane may exist only
         inside a picture, and a reader who cannot see the line still has to be
         able to tell a reported zero from a day with no reading. */
      var rows = h('div', { className: 'series-rows' });
      series.forEach(function (one) {
        rows.appendChild(seriesRow(one, labels, activity.window));
      });
      body.appendChild(rows);

      card.appendChild(body);

      if (missing.length && isHourWindow(activity && activity.window)) {
        card.appendChild(h('div', { className: 'card-foot' }, [
          icon('info'),
          h('span', {
            text: fmt.plural(missing.length, 'hour') + ' did not report. Drawn as breaks, not zeroes.'
          })
        ]));
      } else if (missing.length) {
        card.appendChild(h('div', { className: 'card-foot' }, [
          icon('info'),
          h('span', {
            text: 'No stored figures on ' + listDays(missing) + '. Drawn as breaks, not zeroes.'
          })
        ]));
      }

      appendNote(card, activity.note);
      return card;
    }

    /* The line, drawn here rather than through aria.js's area renderer.

       That renderer filters its values before plotting them, so a null day is
       removed and the path is drawn straight across the gap: the picture then
       shows people who were never counted. Both alternatives to a break are a
       lie about a real quantity, the other being a zero, which draws a day the
       app was open and nobody used it.

       role="img" makes the whole subtree presentational, so every <text> in
       here is announced to nobody and the accessible NAME has to carry the
       data. chartName() is the only thing that decides it. */
    var CHART_W = 720;
    var CHART_H = 210;
    var PAD_L = 44, PAD_R = 10, PAD_T = 10, PAD_B = 16;

    function lineChart(series, labels, win, missingRollups) {
      var iw = CHART_W - PAD_L - PAD_R;
      var ih = CHART_H - PAD_T - PAD_B;

      var hi = 0;
      var span = 0;
      series.forEach(function (one) {
        var values = list(one.values);
        if (values.length > span) span = values.length;
        values.forEach(function (v) {
          var n = num(v);
          if (n !== null && n > hi) hi = n;
        });
      });
      hi = hi * 1.14 || 1;

      var svg = svgEl('svg', {
        'class': 'chart',
        viewBox: '0 0 ' + CHART_W + ' ' + CHART_H,
        role: 'img',
        'aria-label': chartName(series, labels, win, missingRollups)
      });

      var ticks = 4;
      for (var i = 0; i <= ticks; i++) {
        var y = PAD_T + ih - (i / ticks) * ih;
        var gridline = svgEl('line', {
          'class': 'gridline', x1: PAD_L, y1: y.toFixed(1), x2: CHART_W - PAD_R, y2: y.toFixed(1)
        });
        if (i !== 0) gridline.setAttribute('stroke-dasharray', '2 4');
        svg.appendChild(gridline);

        var label = svgEl('text', {
          'class': 'axis', x: PAD_L - 8, y: (y + 3.5).toFixed(1), 'text-anchor': 'end'
        });
        label.textContent = fmt.int(Math.round(hi * i / ticks));
        svg.appendChild(label);
      }

      series.forEach(function (one) {
        /* The series key on the group, so which app a shape belongs to is a
           fact in the document rather than a colour: the tones repeat across
           panes and two apps can share one. */
        var group = svgEl('g', { 'class': seriesTone(one.color), 'data-series': one.key || one.label || '' });
        var values = list(one.values);
        var x = function (index) {
          return PAD_L + (span > 1 ? (index / (span - 1)) * iw : iw / 2);
        };
        var y2 = function (v) { return PAD_T + ih - (v / hi) * ih; };

        /* Consecutive readings become one path. A gap ends the path and the
           next reading starts a new one, so the break is the absence of a
           stroke rather than a stroke through nothing. */
        var run = [];
        var flush = function () {
          if (run.length > 1) {
            group.appendChild(svgEl('path', {
              'class': 'ln',
              d: run.map(function (p, i) {
                return (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2);
              }).join(' ')
            }));
          } else if (run.length === 1) {
            /* A single reading between two gaps has no line to belong to, and
               drawing nothing for it would hide a day that was measured. */
            group.appendChild(svgEl('circle', {
              'class': 'ln-pt', cx: run[0][0].toFixed(2), cy: run[0][1].toFixed(2), r: '2.6'
            }));
          }
          run = [];
        };

        values.forEach(function (v, index) {
          var n = num(v);
          if (n === null) { flush(); return; }
          run.push([x(index), y2(n)]);
        });
        flush();
        svg.appendChild(group);
      });

      return svg;
    }

    /* The chart's accessible name, and the only place its data is announced.

       Every series says how much of the window it has a reading for, its range
       and its last reading, because none of that is announced from the <text>
       nodes inside a role="img". A series with no reading at all says so
       rather than being left out of the name. */
    /* A day label the answer sent, resolved. The chart draws labels in four
       places -- both ends of the x axis, both ends of the spoken chart name,
       and the day a series last reported -- and every one of them read the
       raw array. A label of spaces put its own padding into the axis and into
       what a screen reader says. */
    function labelAt(labels, index) {
      return textOf(list(labels)[index]);
    }

    function chartName(series, labels, win, missingRollups) {
      var unit = activityUnit(win);
      var head = unit === 'hour'
        ? 'People active each hour over ' + windowPhrase(win) + ', one line per app'
        : 'People active each day, one line per app, over ' + windowPhrase(win);
      var first = labelAt(labels, 0);
      var last = labelAt(labels, labels.length - 1);
      /* Named only when BOTH ends resolve, and this guard is the whole point.
         `labelAt()` returns null for a label that is blank or not a string,
         and this is a string concatenation: without the guard the four
         characters `null` land in the accessible name, which for a
         role="img" chart is the only thing a screen-reader user gets. Saying
         nothing costs nothing here -- `windowPhrase(win)` has already said
         how long the window is. Naming one end and not the other would read
         as a one-day window, so a half-resolved pair says neither. */
      if (first && last) {
        head += ', ' + first + (labels.length > 1 ? ' to ' + last : '');
      }
      var missing = list(missingRollups);
      if (unit === 'hour' && missing.length) {
        head += ', ' + fmt.plural(missing.length, 'hour') + ' did not report';
      }
      return head + '. ' + series.map(function (one) {
        return seriesSentence(one, labels, win);
      }).join(' ');
    }

    function seriesSentence(one, labels, win) {
      var name = textOf(one.label) || textOf(one.key) || 'Unnamed series';
      var values = list(one.values);
      var unit = activityUnit(win);
      var reported = [];
      var lastIndex = -1;
      values.forEach(function (v, index) {
        var n = num(v);
        if (n === null) return;
        reported.push(n);
        lastIndex = index;
      });

      if (!reported.length) {
        return name + ': no reading on any of ' + fmt.plural(values.length, unit) + '.';
      }
      var lo = Math.min.apply(null, reported);
      var high = Math.max.apply(null, reported);
      return name + ': ' + fmt.int(reported.length) + ' of ' +
        fmt.plural(values.length, unit) + ' with a reading, ' +
        (lo === high ? 'flat at ' + fmt.int(lo) : 'low ' + fmt.int(lo) + ', high ' + fmt.int(high)) +
        ', ending ' + fmt.int(values[lastIndex]) +
        (labelAt(labels, lastIndex) ? ' on ' + labelAt(labels, lastIndex) : '') + '.';
    }

    /* One app's line, said in words: how much of the window it has a reading
       for, and its last reading with the day or hour it was taken. */
    function seriesRow(one, labels, win) {
      var values = list(one.values);
      var reported = finiteCount(values);
      var lastIndex = -1;
      var unit = activityUnit(win);
      values.forEach(function (v, index) { if (num(v) !== null) lastIndex = index; });

      var row = h('div', { className: 'series-row ' + seriesTone(one.color) }, [
        h('i', { className: 'dot', 'aria-hidden': 'true' }),
        h('span', { text: textOf(one.label) || textOf(one.key) || 'Unnamed series' }),
        h('div', { className: 'spacer' })
      ]);
      row.appendChild(h('span', {
        className: 'num series-read',
        text: lastIndex === -1
          ? 'No reading'
          : fmt.plural(values[lastIndex], 'person', 'people') +
            (labelAt(labels, lastIndex) ? ' on ' + labelAt(labels, lastIndex) : '')
      }));
      row.appendChild(h('span', {
        className: 'series-cover',
        text: fmt.int(reported) + ' of ' + fmt.plural(values.length, unit)
      }));
      return row;
    }

    /* Most days named in full before the list is summarised, the same way the
       People and usage pane lists its gaps. */
    var MAX_LISTED_GAP_DAYS = 8;

    function listDays(days) {
      var shown = days.slice(0, MAX_LISTED_GAP_DAYS).map(function (day) {
        return fmt.utcDay(day) || day;
      });
      var rest = days.length - shown.length;
      return shown.join(', ') + (rest > 0 ? ', and ' + fmt.plural(rest, 'more day') : '');
    }

    function appendNote(card, note) {
      var words = textOf(note);
      if (!words) return;
      card.appendChild(h('div', { className: 'card-foot' }, [h('span', { text: words })]));
    }

    /* --------------------------------------------- what is not drawn here */

    /* The figures the approved design puts on this pane that have no source,
       named with the route's own reason for each.

       Rendered from `omissions` rather than from a list in this file, so a
       figure that loses or gains a source moves here by itself rather than
       when somebody remembers to edit the client. */
    var STATIC_OMISSIONS = [
      {
        key: 'what_aria_has_been_doing',
        title: 'What Aria has been doing',
        detail: 'No route serves per-request-type requests, reliability, latency and cost yet. The summary route returns platform totals only, so this pane cannot split requests into the approved reliability, latency and cost rows.'
      },
      {
        key: 'where_the_money_goes',
        title: 'Where the money goes',
        detail: 'Cloud costs draws the spend breakdown by category and resource group. Overview has no smaller spend-breakdown field to draw beside the live operating summary.'
      }
    ];

    function omissionIdentityKey(entry) {
      var key = textOf(entry && entry.key);
      return key ? key.toLowerCase() : null;
    }

    function omissionsCard(omissions) {
      var seen = {};
      var entries = STATIC_OMISSIONS.concat(list(omissions)).filter(function (entry) {
        return entry && (textOf(entry.title) || textOf(entry.key));
      }).filter(function (entry) {
        var identity = omissionIdentityKey(entry);
        if (identity && seen[identity]) return false;
        if (identity) seen[identity] = true;
        return true;
      });
      if (!entries.length) return null;

      var card = S.card();
      card.appendChild(S.cardHead('Not drawn here, and why',
        entries.length === 1
          ? 'One figure the design asks for has no source'
          : fmt.int(entries.length) + ' figures the design asks for have no source'));

      var body = h('div', { className: 'card-body omit' });
      entries.forEach(function (entry) {
        var item = h('div', { className: 'omit-item' });
        var glyph = icon('clock');
        glyph.setAttribute('aria-hidden', 'true');
        var identity = omissionIdentityKey(entry);
        if (identity) item.setAttribute('data-omission-key', identity);
        item.appendChild(glyph);
        item.appendChild(h('div', {}, [
          h('h4', { className: 'omit-title', text: textOf(entry.title) || textOf(entry.key) }),
          h('p', {
            className: 'omit-desc',
            text: (textOf(entry.detail) ? maskContactDetails(textOf(entry.detail)) : null) ||
              'The answer named this as unavailable and gave no reason.'
          })
        ]));
        body.appendChild(item);
      });
      card.appendChild(body);
      return card;
    }

    /* ------------------------------------------------ the figures section */

    /* The blocks' own notes, under the tiles they belong to rather than inside
       them.

       Printed for a block that is not drawn in full, which is where the reason
       lives: the route appends its refusal to the note, so "no comparison
       available" on a tile and why there is none are the same sentence in two
       places on one screen. A block drawn in full says everything it has to say
       in the tile itself and is left out here, so this stays a footnote rather
       than becoming an essay nobody reads. */
    function figureNotes(data) {
      var wrap = h('div', { className: 'notes' });
      [
        { label: 'Active people', block: data.people, whole: hasPeopleComparison(data.people) },
        { label: 'Aria AI runs', block: data.aiRuns, whole: num(data.aiRuns &&
            data.aiRuns.previous && data.aiRuns.previous.runs) !== null },
        { label: 'Cloud spend', block: data.cost, whole: num(data.cost &&
            data.cost.comparison && data.cost.comparison.changeBasisPoints) !== null },
        { label: 'App version in production', block: data.release, whole: true }
      ].forEach(function (entry) {
        var note = textOf(entry.block && entry.block.note);
        if (!note) return;
        if (stateOf(entry.block) === 'ready' && entry.whole) return;
        wrap.appendChild(h('p', { className: 'note-line', text: entry.label + ': ' + note }));
      });
      return wrap.childNodes.length ? wrap : null;
    }

    function hasPeopleComparison(people) {
      return !!(people && people.comparison) &&
        num(people.platform && people.platform.previousActive) !== null;
    }

    function figuresSection(band, result, openFailed) {
      if (result && result.error) {
        var box = S.card();
        /* The second sentence is a claim about the OTHER read, so it is made
           only when that read actually landed. Both halves down and it would
           be telling the operator their queue is fine while the section above
           says it could not be read. */
        var lines = [
          S.failureMessage(result.error),
          openFailed
            ? 'Nothing here is a zero: the figures are unread, not absent. The ' +
              'problems above could not be read either.'
            : 'Nothing here is a zero: the figures are unread, not absent. The ' +
              'problems above were read separately and are unaffected.'
        ];
        var block = S.stateBlock('warn', 'These figures could not be read', lines, 3);
        var again = h('button', { className: 'btn btn-primary', type: 'button', text: 'Try again' });
        nameRetry(block, again);
        retryHandler(again, band.getAttribute('id'));
        block.appendChild(h('div', { className: 'row mt-sm' }, [again]));
        box.appendChild(block);
        band.appendChild(box);
        return;
      }

      var data = result && result.data;
      if (!data) {
        var empty = S.card();
        empty.appendChild(S.stateBlock('empty', 'These figures have nothing behind them yet', [
          'The operations API answered without the headline figures.',
          'Nothing is being hidden from you, and nothing here is a zero.'
        ], 3));
        band.appendChild(empty);
        return;
      }

      var tiles = h('div', { className: 'grid g4' });
      tiles.appendChild(peopleTile(data.people));
      tiles.appendChild(aiRunsTile(data.aiRuns));
      tiles.appendChild(costTile(data.cost));
      tiles.appendChild(releaseTile(data.release));
      band.appendChild(tiles);

      var notes = figureNotes(data);
      if (notes) band.appendChild(notes);

      band.appendChild(activityCard(data.activity));

      var omissions = omissionsCard(data.omissions);
      if (omissions) band.appendChild(omissions);

      var stamp = fmt.utcStamp(data.generatedAt);
      band.appendChild(h('p', {
        className: 'note-line',
        text: (stamp ? 'Read at ' + stamp + '. '
          : 'The time these figures were read was not reported. ') +
          (textOf(data.consent && data.consent.detail) || '')
      }));
    }

    load();
  });
})(window);
