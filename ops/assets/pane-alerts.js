/* Problems: what needs a person right now, who is on it, and whether the
   watching itself can be believed.

   Drawn on the v2 design system through assets/shell-pane-v2.js. The pane
   holds no session, filter or navigation logic of its own.

   Two things shape this file more than the layout does.

   The first is that **acknowledging and closing are different actions**, and
   the pane never collapses them. Acknowledge means a person has seen it.
   Close means the thing is not happening any more. One button for both buys a
   tidy list and loses the only distinction that matters at 02:00: is somebody
   on this, or has everyone assumed somebody else is? So a problem carries its
   own state in words, and an unacknowledged one says that nobody has picked
   it up rather than leaving the absence to be inferred from a missing name.

   The second is that **an empty page has to prove it is empty**. "No problems"
   and "the alerting stopped four hours ago" render identically as a blank
   list, and the second is the dangerous one. Every state here reads the rules
   to decide which of the two it is, and only the state that has a rule in a
   position to notice is allowed to say that anything is well.

   Four rules about what is NOT drawn:

     1. **A count from a full read is a floor, not a total.** A read answers
        with at most OpsAlertsModel.PAGE problems, worst first and then oldest,
        so a full page keeps the oldest of each severity and drops the most
        recent. The disclosures name WHICH problems went missing. The
        opened/closed counts, worked out over a window that ends today, are
        made unavailable rather than approximate. The closed LIST is still
        drawn from a capped read — it is a list, and a short list of real
        closures is still true of every row in it — but it says so in its own
        foot and prints no total over it. What it will not do is report a ZERO
        from one: the closed query carries no date bound, so a capped read can
        come back holding only closures older than the window the card is
        about, and "nothing has been closed" would then be a fact the sample
        was never in a position to carry.

        Second, the empty state reads the rules to decide which kind of empty
        it is, so when the RULES read is the one that failed it has not got
        that fact and states neither kind.
     2. **The severity filter is applied by the API and the category filter is
        applied here**, so a figure read over a severity-scoped answer says so
        rather than reading as a total.
     3. **What the approved design asks for and the API does not carry is
        named where it would have been drawn, never invented.** The rules
        table has no "right now" column, because the rules endpoint sends no
        current value for a rule; a problem card draws no meter, because
        observed and threshold are two numbers and the bar between them needs
        a full scale nothing sends.
     4. **A close note is content, not decoration.** The list endpoint does not
        carry one — the note is written onto the problem's `closed` event — so
        the closed list says where the note is and the problem's own details
        print it, rather than the pane quietly dropping the one sentence that
        says why something was closed.

   Everything a person can change from here is a call the server checks
   independently: acknowledging and closing need the operator or owner role,
   turning a rule on or off needs owner. What the client does with that is
   render a fact rather than dangle a control that will be refused.

   The detail a problem carries — the runbook, its timeline, earlier problems
   from the same rule — expands in place rather than opening a drawer over the
   page. A modal at 375px is a focus trap and a second overflow surface, and
   the expansion needs neither. */
(function (global) {
  'use strict';

  var S = global.OpsPaneShell;
  var model = global.OpsAlertsModel;
  var session = global.OpsSession;
  var h = S.h;
  var icon = S.icon;
  var fmt = S.fmt;

  var SEVERITY_LABEL = model.SEVERITY_LABEL;
  var SEVERITY_TONE = model.SEVERITY_TONE;
  var CLOSE_REASON_LABEL = model.CLOSE_REASON_LABEL;
  var EVENT_LABEL = model.EVENT_LABEL;
  var EVALUATION_LABEL = model.EVALUATION_LABEL;
  var INSUFFICIENT_REASON = model.INSUFFICIENT_REASON;
  var CHANNEL_STATUS = model.CHANNEL_STATUS;
  var CHANNEL_FAILURE = model.CHANNEL_FAILURE;
  var CATEGORIES = model.CATEGORIES;
  var SEVERITIES = model.SEVERITIES;
  var PAGE = model.PAGE;
  var time = model.time;

  var RANGE_DAYS = { '7d': 7, '30d': 30 };

  /* What the close endpoint keeps of a note, and the same number the textarea
     stops at, so the field cannot accept text the record will not hold.

     The attribute alone is not the whole fix. `maxlength` stops typing, but a
     PASTE past the limit is truncated by the browser without a word, so an
     operator who pastes a paragraph gets a note ending mid-sentence and no
     sign that anything was dropped (Stadiora/Aria#5498). The line beside the
     field is silent until the limit is actually reached and then says so. */
  var NOTE_LIMIT = 500;

  /* How far back the closed list looks, and how many of them it shows. The
     window is this pane's own rather than the shell's: the shell's range
     decides which problems are in the QUEUE, and a closed list that emptied
     itself whenever the queue was set to "open now" would take the record of
     what was closed off the screen with it. */
  var CLOSED_DAYS = 14;
  var CLOSED_SHOWN = 5;

  /* The v2 tone words, keyed by the model's severity tone. The accent down a
     card's edge, the ink on its title and its severity pill all read from
     here, so the three cannot disagree about which severity a card is. */
  var SEVERITY_ACCENT = { crit: 'acc-bad', warn: 'acc-warn', info: 'acc-blue' };
  var SEVERITY_INK = { crit: 'is-crit', warn: 'is-warn', info: 'is-info' };
  var SEVERITY_PILL = { crit: 'down', warn: 'warn', info: 'info' };
  var HERO_TONE = { crit: 'st-bad', warn: 'st-warn', info: 'st-acc' };

  /* The verdict a rule reached last time, as a pill tone. Anything that is
     not a verdict is amber: a rule that cannot judge is not a rule that is
     quiet. */
  var EVALUATION_PILL = {
    ok: 'up', firing: 'down', insufficient_data: 'warn',
    disabled: 'ghost', error: 'down'
  };

  /* The problems API names a work pane with the file-ish keys
     OpsAlertsModel.PANE_FILE holds; the registry keys differ for two of them.
     Translated rather than assumed, so a link that cannot be built from the
     registry falls back to the model's own file. */
  var WORK_PANE_KEY = { 'jobs-live': 'jobs', 'run-history': 'history' };

  function paneKey(workPane) {
    return WORK_PANE_KEY[workPane] || workPane;
  }

  /* A span of seconds in the words the v1 panes use for one, ported rather
     than re-invented so the same quantity does not read two ways on two
     screens an operator moves between in one incident. Pinned to
     assets/operate.js by scripts/ops-alerts-v2.test.mjs. */
  function duration(seconds) {
    if (!fmt.isNum(seconds) || seconds < 0) return fmt.none;
    if (seconds < 60) return (seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)) + 's';
    var m = Math.floor(seconds / 60);
    var s = Math.round(seconds % 60);
    if (m < 60) return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
    var hrs = Math.floor(m / 60);
    return hrs + 'h ' + (m % 60) + 'm';
  }

  function textOf(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  S.definePane('alerts', function (content) {
    var region = S.region(content);

    /* Reading is open to every role. Taking a problem on and closing it need
       operator or owner; tuning a rule needs owner. The server enforces all
       three independently. */
    var canAct = session.hasRole(['owner', 'operator']);
    var isOwner = session.hasRole(['owner']);

    var filters = S.filters();
    var picked = { severity: 'all', category: 'all' };
    var loadToken = 0;

    /* ---------------------------------------------------- pane-local filters

       Severity goes to the API, because it can filter on it. Category is
       applied here over what came back, because the API cannot, and the
       disclosure under the list says so rather than leaving the operator to
       assume the number is a total. */

    /* Marked in place, never rebuilt. The operator is standing on one of
       these buttons when they press it, so replacing the control replaces the
       element that has focus and the browser drops focus on <body> -- back to
       the top of the document, past the skip link and the rail, on every
       press. The v2 shell's own segmented control does the same thing for the
       same reason. Clearing the filters is the one case that still rebuilds,
       because it changes the category select as well and its own button is
       inside the region the re-read replaces either way. */
    function severityControl() {
      var seg = h('div', { className: 'seg', role: 'group', 'aria-label': 'Severity' });
      var options = [];
      SEVERITIES.forEach(function (option) {
        var button = h('button', { type: 'button', text: option.label });
        options.push({ node: button, value: option.value });
        button.addEventListener('click', function () {
          if (picked.severity === option.value) return;
          picked.severity = option.value;
          mark();
          reload();
        });
        seg.appendChild(button);
      });
      /* Read off `picked` rather than set from the click, so the pressed
         button is the one the pane is filtering on however it got there. */
      function mark() {
        options.forEach(function (option) {
          var on = option.value === picked.severity;
          option.node.className = on ? 'on' : '';
          option.node.setAttribute('aria-pressed', String(on));
        });
      }
      mark();
      return seg;
    }

    function categoryControl() {
      var select = h('select', { id: 'fCategory' });
      CATEGORIES.forEach(function (option) {
        var node = h('option', { value: option.value, text: option.label });
        if (option.value === picked.category) node.selected = true;
        select.appendChild(node);
      });
      select.addEventListener('change', function () {
        picked.category = select.value;
        reload();
      });
      return h('div', { className: 'sel' }, [select, icon('chev')]);
    }

    /* Rebuilt whole, so the bar always shows the selection this pane is
       actually filtering on — including after the empty state's "Clear the
       filters" puts both back. Called from that button and from first render,
       not from picking a severity: see severityControl() above for why. */
    function renderFilterControls() {
      S.paneFilters([
        h('span', { className: 'filter-label', text: 'Severity' }),
        severityControl(),
        h('label', { className: 'filter-label', 'for': 'fCategory', text: 'Category' }),
        categoryControl()
      ]);
    }

    renderFilterControls();

    global.addEventListener('ops:filters', function (e) {
      var next = e.detail;
      if (next.range === filters.range && next.env === filters.env) return;
      filters = next;
      reload();
    });

    /* ------------------------------------------------------------ loading */

    /* Three reads, each carried as a value or as the error it failed with.

       They fail on their own terms rather than through the pane. An operator
       who cannot read the rules can still act on a critical problem, and one
       who cannot read the problems can still be told whether anything is
       watching. Promise.all over three bare reads would take the whole pane
       off the screen for either.

       session.call rather than the shell's read(): the fixture hook is keyed
       on the pane, and this pane makes three different reads, so one fixture
       would answer all three with the same payload. */
    function settled(promise) {
      return promise.then(function (payload) {
        return { data: payload.data };
      }, function (err) {
        return { error: err };
      });
    }

    function query(status) {
      var q = { status: status, limit: PAGE };
      if (picked.severity !== 'all') q.severity = picked.severity;
      return settled(session.call('/api/ops/alerts/problems', { query: q }));
    }

    function load() {
      var token = ++loadToken;
      region.loading([
        { type: 'block', height: 62 },
        { type: 'rows', count: 4 },
        { type: 'rows', count: 6 },
        { type: 'block', height: 150 }
      ]);

      /* Returned so a caller that changed something can wait for the pane it
         changed to be back on screen before it moves focus. */
      return Promise.all([
        query('open'),
        /* The closed problems are read for what the queue cannot answer: what
           was closed recently and why, and how the watching has been doing. */
        query('closed'),
        settled(session.call('/api/ops/alerts/rules'))
      ]).then(function (results) {
        if (token !== loadToken) return;  /* a newer load is already in flight */
        render({ open: results[0], closed: results[1], rules: results[2] });
      });
    }

    /* --------------------------------------------------------- composition */

    function problemsOf(result) {
      return result && result.data ? list(result.data.problems) : [];
    }

    function rulesOf(data) {
      return data.rules && data.rules.data ? list(data.rules.data.rules) : [];
    }

    function inRange(problem) {
      var days = RANGE_DAYS[filters.range];
      if (!days) return problem.status !== 'closed';
      var fired = time(problem.firedAt);
      if (fired === null) return false;
      return fired >= Date.now() - days * 86400000;
    }

    function matchesCategory(problem) {
      return picked.category === 'all' || problem.category === picked.category;
    }

    /* The two reads can answer with the same problem — one closed between
       them is in both — and one problem cannot honestly be two rows, so the
       queue is keyed by id. */
    function visibleProblems(data) {
      return distinct(problemsOf(data.open).concat(problemsOf(data.closed)))
        .filter(inRange).filter(matchesCategory).sort(model.byWorstThenOldest);
    }

    /* A disclosure's id, unique within one render by counting rather than by
       deriving.

       `surface` is which list the card is in: one problem can be on screen
       twice -- once in the queue, once in "Recently closed" -- and an id built
       from the problem alone put two elements with one id in the document, so
       both buttons' aria-controls resolved to the first. Keying by surface
       fixes that collision and leaves another: an id derived from
       `problem.id` has to be sanitised into something an id attribute can
       hold, and any sanitiser maps distinct inputs onto one string. A counter
       cannot collide, so the question of what characters an id can contain
       stops needing an answer. */
    var discloseSeq = 0;

    function discloseId(kind, surface) {
      discloseSeq += 1;
      return kind + '-' + surface + '-' + discloseSeq;
    }

    /* One problem is one problem. The open read and the closed read are taken
       at different instants, so one closed between them comes back in both,
       and anything that counts or lists the two together has to say so once.
       The queue used to be the only place that did; the figures beside it
       were adding the same problem twice. */
    function distinct(problems) {
      var at = {};
      var all = [];
      problems.forEach(function (problem) {
        var key = problem && problem.id;
        if (key === undefined || key === null) return;
        if (!Object.prototype.hasOwnProperty.call(at, key)) {
          at[key] = all.length;
          all.push(problem);
          return;
        }
        /* Two copies of one problem are two answers taken at two instants, and
           the closed one is the later fact by construction: a problem goes open
           -> closed and never back, so a copy carrying `closedAt` was read after
           a copy without it. Keeping the first copy showed the same reference
           twice on one screen as "Still happening" in the queue and "Closed a
           minute ago" in the list below. */
        if (problem.closedAt && !all[at[key]].closedAt) all[at[key]] = problem;
      });
      return all;
    }

    /* Whether any control is narrowing what came back. The window is one of
       them: the pane's own default, "Open now", narrows nothing, but a 7 or
       30 day window does, and an empty result under one says nothing about
       the problems outside it. */
    function narrowed() {
      return picked.severity !== 'all' || picked.category !== 'all' ||
        Boolean(RANGE_DAYS[filters.range]);
    }

    function severityScope() {
      return picked.severity === 'all'
        ? null
        : (SEVERITY_LABEL[picked.severity] || picked.severity).toLowerCase();
    }

    function render(data) {
      var rulesFailed = Boolean(data.rules.error);
      var openFailed = Boolean(data.open.error);
      var armed = model.armedState(rulesFailed ? {} : data.rules.data);
      var queue = openFailed ? [] : visibleProblems(data);
      var openProblems = problemsOf(data.open);
      var capped = model.capped(openProblems);
      /* The queue is not the open read. On a window the queue draws from BOTH
         reads, so a capped closed read makes the queue short even when the
         open read came back with room to spare -- and short of exactly the
         closures a recent window is made of, because a read comes back worst
         first and then oldest. The figure the hero prints over that queue is
         a floor, and it has to say so itself; a sentence under a number that
         reads as exact is read after the number. */
      var queueCapped = capped ||
        Boolean(model.capped(problemsOf(data.closed)) && RANGE_DAYS[filters.range]);

      badgeProblems(openProblems, capped, openFailed);

      /* Both halves unreadable is the whole pane unreadable. Anything less
         renders what did come back, in the degraded state. */
      if (openFailed && rulesFailed) {
        region.failed(data.open.error, reload);
        return;
      }

      /* Empty is a real state with a real trigger, and a narrow one: nothing
         to list, from reads that landed. A read that never landed has not
         earned the sentence "there is nothing here". */
      if (!openFailed && !queue.length) {
        region.empty(emptyState(data, armed, queueCapped, rulesFailed));
        return;
      }

      var wrap = h('div', { className: 'stack' });
      wrap.appendChild(hero(queue, armed, capped, queueCapped, rulesFailed));

      var late = latenessNote(armed, rulesFailed, queue);
      if (late) wrap.appendChild(late);

      wrap.appendChild(openFailed
        ? failedBand('Open problems', 'The problems could not be read', data.open.error)
        : problemsBand(queue, data, armed, capped, queueCapped));

      wrap.appendChild(rulesFailed
        ? failedBand('What is being watched', 'The rules could not be read', data.rules.error)
        : rulesBand(armed, queue));

      wrap.appendChild(closedBand(data, armed));

      if (openFailed || rulesFailed || data.closed.error) region.degraded(wrap);
      else region.show(wrap);
    }

    /* A section whose own read failed, in place of what it would have drawn.
       Named where the content would have been rather than replacing the pane,
       because the rest of the page is still true. */
    function failedBand(title, headline, err) {
      var section = S.band(title);
      var box = S.card();
      var block = S.stateBlock('warn', headline, [
        S.failureMessage(err),
        'Nothing here is a zero. This part is unread, not empty.'
      ]);
      var again = h('button', { className: 'btn btn-primary', type: 'button', text: 'Try again' });
      nameRetry(block, again);
      again.addEventListener('click', function () { reload(); });
      block.appendChild(h('div', { className: 'row mt-sm' }, [again]));
      box.appendChild(block);
      section.appendChild(box);
      return section;
    }

    /* A control whose whole name is "Try again" says the action and never its
       object. A screen reader's control list enumerates by NAME, so an
       operator pulling one up is told what the button does and not which read
       it would repeat -- and this pane draws one of these on four different
       failures.

       #10760 says three are on screen at once. They are not: render() treats
       both reads failing as the whole pane unreadable and returns through
       region.failed(), so two of THESE can never share a screen. The pair the
       pane can really draw is one of these beside the record-detail retry,
       which carries its own `sr` span. So this is not about disambiguating a
       pair; it is about one button, on its own, saying nothing.

       #10760 proposed aria-describedby. That is what PR #98 tried first on
       the Overview pane and then replaced, because a description is announced
       on focus and every list that enumerates controls -- NVDA's Elements
       List, JAWS's button list, the VoiceOver rotor -- reads names, so both
       entries stayed "Try again" there. Composing the NAME out of the button
       and its own headline is what those lists read, and it keeps the visible
       word as the first token so voice control still works on what the
       operator can see. aria-label would have replaced that word.

       Copied from pane-overview.js rather than shared, because the two panes
       load no common module of their own and the shell is not this pane's to
       extend. */
    var retryN = 0;
    function nameRetry(block, again) {
      var kids = block.childNodes || [];
      for (var i = 0; i < kids.length; i++) {
        if (/^h[1-6]$/i.test(String(kids[i].tagName || ''))) {
          retryN += 1;
          /* setAttribute, not .id. The DOM harness these are tested through
             has no id accessor, so a property write leaves getAttribute('id')
             null: every reference would dangle in the tests while working in
             a browser. That is a false RED, not a false green -- five of the
             ten tests fail -- but it is the kind of false red that gets
             "fixed" by loosening the assertion, and then the loosened
             assertion is the false green. */
          var headingId = kids[i].getAttribute('id');
          if (!headingId) {
            headingId = 'pb-failed-' + retryN;
            kids[i].setAttribute('id', headingId);
          }
          var buttonId = 'pb-retry-' + retryN;
          again.setAttribute('id', buttonId);
          again.setAttribute('aria-labelledby', buttonId + ' ' + headingId);
          return;
        }
      }
    }

    /* The Problems count beside the rail item. A real read or nothing: it is
       cleared as well as set, so a page that lands on a quiet system does not
       keep a stale count from a previous render, and a read that failed takes
       the badge away rather than leaving yesterday's number beside the pane
       that is currently unreadable. */
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

    /* ---------------------------------------------------------------- hero */

    function hero(queue, armed, capped, queueCapped, rulesFailed) {
      var active = model.active(queue);
      var needing = model.needingAction(queue);
      var worst = model.worstSeverity(active.length ? active : queue);

      var tone = (armed.trustworthy || rulesFailed)
        ? (HERO_TONE[SEVERITY_TONE[worst]] || 'st-acc')
        : 'st-warn';

      var box = h('section', { className: 'hero ' + tone });
      box.appendChild(h('div', { className: 'hero-orb', 'aria-hidden': 'true' }, [
        h('i'), h('i'), h('b')
      ]));

      var words = h('div', {}, [
        h('h2', { className: 'hero-title', text: heroTitle(queue, active, capped, queueCapped) })
      ]);
      var sub = heroSub(needing, active, armed, rulesFailed);
      if (sub) words.appendChild(h('p', { className: 'hero-sub', text: sub }));
      box.appendChild(words);
      box.appendChild(heroChips(queue, armed, capped, rulesFailed));
      return box;
    }

    /* Two flags because the two branches count two different things: the
       window counts the QUEUE, which is both reads, and "open" counts only
       what the open read answered with. */
    function heroTitle(queue, active, capped, queueCapped) {
      if (RANGE_DAYS[filters.range]) {
        return model.atLeast(fmt.plural(queue.length, 'problem'), queueCapped) +
          ' in the last ' + RANGE_DAYS[filters.range] + ' days';
      }
      return model.atLeast(fmt.plural(active.length, 'problem'), capped) + ' open';
    }

    /* The chips carry the severities and the oldest, so the sub carries only
       what they cannot: who is on what, and whether anything is watching. */
    function heroSub(needing, active, armed, rulesFailed) {
      var bits = [];
      var scope = severityScope();
      if (needing.length) {
        bits.push(fmt.int(needing.length) +
          (needing.length === 1 ? ' needs a person' : ' need a person'));
      } else if (active.length) {
        bits.push('somebody is on every one of them');
      }
      var taken = model.takenOn(active).length;
      if (taken) bits.push(fmt.int(taken) + ' taken on');
      if (rulesFailed) bits.push('the rules could not be read');
      else if (!armed.trustworthy) bits.push(unarmedPhrase(armed));
      else bits.push(fmt.plural(armed.checking, 'rule') + ' watching');
      if (scope) bits.push('severity ' + scope + ' only');
      return bits.join(' · ');
    }

    /* The unarmed fact as a clause rather than a sentence, because the sub is
       a row of clauses. The full sentences live in notArmedSentence, which
       the states that have room for one use. */
    function unarmedPhrase(armed) {
      if (!armed.total) return 'no rules exist';
      if (!armed.enabled) return 'no rule is enabled';
      if (armed.neverRun === armed.enabled) return 'no rule has run yet';
      return 'no rule is reaching a verdict';
    }

    function chip(tone, iconName, text) {
      var pill = h('span', { className: 'pill' + (tone ? ' ' + tone : ' ghost') });
      if (iconName) pill.appendChild(icon(iconName));
      pill.appendChild(document.createTextNode(text));
      return pill;
    }

    function heroChips(queue, armed, capped, rulesFailed) {
      var strip = h('div', { className: 'hero-chips' });
      var active = model.active(queue);

      ['critical', 'warning', 'info'].forEach(function (severity) {
        var n = active.filter(function (problem) {
          return problem.severity === severity;
        }).length;
        if (!n) return;
        var tone = SEVERITY_TONE[severity];
        strip.appendChild(chip(SEVERITY_PILL[tone],
          severity === 'info' ? 'info' : 'warn',
          model.atLeast(fmt.int(n), capped) + ' ' + SEVERITY_LABEL[severity].toLowerCase()));
      });

      var needing = model.needingAction(queue);
      if (needing.length) {
        var oldest = model.iso(model.oldest(needing.map(function (problem) {
          return problem.firedAt;
        })));
        if (oldest) {
          strip.appendChild(chip('', 'clock', 'oldest unanswered ' + fmt.since(oldest)));
        }
      }

      if (!rulesFailed && armed.lastEvaluatedAt) {
        strip.appendChild(chip('', 'check', 'rules last ran ' + fmt.ago(armed.lastEvaluatedAt)));
      }
      return strip;
    }

    /* The band between the hero and the queue: the rules are running, but not
       well enough for the list under them to be read as everything that is
       wrong. It is not the degraded preview state — the reads all landed — it
       is the answer itself saying the watching is short. */
    function latenessNote(armed, rulesFailed, queue) {
      if (rulesFailed) return null;
      var bits = [];
      if (armed.total) {
        if (armed.errored) {
          bits.push(fmt.plural(armed.errored, 'rule') + ' failed the check itself.');
        }
        /* Waiting and never-wired are counted apart, because they ask the
           operator for different things: one for patience, one for a source.
           Saying "cannot reach a verdict yet" over a rule nothing feeds sends
           somebody back tomorrow to read the identical sentence
           (Stadiora/Aria#10812). */
        if (armed.insufficientData > armed.unconfigured) {
          bits.push(fmt.plural(armed.insufficientData - armed.unconfigured, 'rule') +
            ' cannot reach a verdict yet.');
        }
        if (armed.unconfigured) {
          bits.push(fmt.plural(armed.unconfigured, 'rule') +
            ' has nothing wired up to feed it, so waiting will not help.');
        }
        if (armed.neverRun) {
          bits.push(fmt.plural(armed.neverRun, 'rule') + ' has never run.');
        }
        if (bits.length) {
          bits.push('A rule that is not judging is not watching, whatever the list below says.');
        }
      }

      var undelivered = deliveryGap(armed, queue);
      if (undelivered) bits.push(undelivered);

      if (!bits.length) return null;

      var note = h('div', { className: 'note' });
      note.appendChild(icon('warn', 'is-warn'));
      note.appendChild(h('div', { text: bits.join(' ') }));
      return note;
    }

    /* Nothing has ever reached anybody, said where the problems are rather
       than three bands further down beside the destinations.

       "Where problems are sent" already reports each destination honestly, one
       row at a time. What no row can say is the thing that matters: that these
       open problems, the oldest of them 51 days old at the time of writing,
       have sat here without a single notification ever going out
       (Stadiora/Aria#10811). An operator reading a queue is entitled to know
       that reading it is the only way anyone finds out.

       Gated on there being something undelivered, because with an empty queue
       nothing has failed to arrive and the sentence would be an unprompted
       complaint about configuration. Gated on `channelsKnown` because a
       payload that did not mention delivery cannot support a claim about it. */
    function deliveryGap(armed, queue) {
      if (!armed.channelsKnown) return null;
      if (!queue || !queue.length) return null;
      if (armed.everDelivered) return null;
      if (!armed.channelsConfigured) {
        return 'No destination is set, so nothing here has been sent to anyone.';
      }
      return 'Nothing has ever been delivered, on any destination that is set up.';
    }

    /* -------------------------------------------------------- the problems */

    function problemsBand(queue, data, armed, capped, queueCapped) {
      var section = S.band(
        RANGE_DAYS[filters.range] ? 'Problems in this window' : 'Open problems',
        'Worst first, then oldest'
      );

      var box = S.card();
      var body = h('div', { className: 'card-body p-list' });
      queue.forEach(function (problem) {
        body.appendChild(problemCard(problem, data));
      });
      box.appendChild(body);

      var foot = rulesFoot(armed);
      if (foot) box.appendChild(foot);
      section.appendChild(box);

      var notes = disclosures(data, capped, queueCapped);
      if (notes) section.appendChild(notes);
      return section;
    }

    /* The queue's footer answers the question the queue cannot: would we
       know. It is here on every look rather than only on the empty screen,
       because a page that says nothing when nothing is wrong is
       indistinguishable from one that has stopped working. */
    function rulesFoot(armed) {
      if (!armed.total) return null;
      /* How many are watching and when they last ran are already in the hero,
         directly above this, so they are not repeated here in a second
         arithmetic. What is left is the dot's own meaning -- which may never
         be carried by the colour alone -- and the rules that are switched
         off, which nothing above the queue says. */
      var bits = [armed.trustworthy ? 'Watching' : 'Not watching'];
      if (armed.total > armed.enabled) {
        bits.push(fmt.int(armed.total - armed.enabled) + ' turned off');
      }

      var foot = h('div', { className: 'card-foot' });
      foot.appendChild(h('span', {
        className: 'dot ' + (armed.trustworthy ? 'ok live' : 'warn'), 'aria-hidden': 'true'
      }));
      foot.appendChild(h('span', { text: bits.join(' · ') }));
      return foot;
    }

    /* Only what is true is said. Nothing narrowing and nothing truncated
       leaves this off the page entirely: a line reading "showing 3 problems"
       under three problems is the count restated, and the hero has it. */
    function disclosures(data, capped, queueCapped) {
      var parts = [];
      var scope = severityScope();

      if (scope) {
        parts.push('Severity is filtered by the operations API, so every figure here ' +
          'was read over ' + scope + ' problems only.');
      }
      if (picked.category !== 'all') {
        parts.push('Category is filtered on what was read rather than on the whole record, ' +
          'so this is a count of the problems on screen.');
      }
      /* The disclosure names which problems went missing, not only that some
         did. A read comes back worst first and then oldest and stops at PAGE,
         so a full page keeps the oldest of each severity and drops the most
         recent: "older problems are not counted" would be the opposite of
         what happened.

         Open and closed are two reads and are disclosed separately. Warning
         that both are short when only one of them is tells the operator a
         complete figure is incomplete, and a disclosure that cries wolf is
         ignored on the day it is the one that matters. */
      if (capped) {
        parts.push('Only ' + PAGE + ' open problems can be read at once, worst first and ' +
          'then oldest, and that many came back, so the most recent ones are missing from ' +
          'this list and from the counts above.');
      }
      /* One cap, two surfaces, two consequences -- and each surface states
         only its own. The closed card's foot says which ROWS are missing from
         the list it draws; this says what the capped read does to the COUNT
         above it, which is the queue's fact and appears nowhere else. A dozen
         words rather than the card's sentence repeated: the earlier build
         printed both in full and said one thing twice.

         Not folded into `capped`: a queue is short whenever the CLOSED read
         came back full, even where the open read had room to spare, and on a
         window that is the ordinary shape -- a handful open over a long
         closed history. */
      if (queueCapped && !capped) {
        parts.push('The closed problems came back full as well, so the count above is a ' +
          'floor and the most recent closures are missing from this queue.');
      }
      if (!parts.length) return null;

      var notes = h('div', { className: 'p-notes' });
      parts.forEach(function (part) {
        notes.appendChild(h('p', { className: 'note-line', text: part }));
      });
      return notes;
    }

    function problemCard(problem, data) {
      var tone = SEVERITY_TONE[problem.severity] || 'info';
      var box = S.card('accent p-item ' + (SEVERITY_ACCENT[tone] || 'acc-blue'));
      var body = h('div', { className: 'card-body p-body' });

      body.appendChild(problemHead(problem, tone));

      var summary = textOf(problem.summary);
      if (summary) body.appendChild(h('p', { className: 'p-desc', text: summary }));

      body.appendChild(problemFacts(problem, data));
      body.appendChild(h('div', { className: 'divider' }));
      body.appendChild(problemFoot(problem, data));
      box.appendChild(body);
      return box;
    }

    /* The severity in words, for a severity the answer chose and this file did
       not. Three steps, the same three the Overview pane takes since #10393,
       because an operator moving between the two panes during one incident
       must meet one word for one state:

         - the label this file keeps for a severity it knows,
         - the severity itself when that is a word, so an unrecognised one is
           reported rather than hidden,
         - "Unknown" when neither is a word. Not a blank: shell-pane-v2.js:97
           skips textContent entirely for `undefined`, so an absent severity
           drew a pill with nothing in it and told the operator nothing was
           missing.

       Both lookups go through textOf(), which is what stops `constructor` and
       `toString` -- words every plain object in JavaScript answers to -- from
       reaching the screen as the source of a function. SEVERITY_LABEL is a
       plain object literal, so SEVERITY_LABEL['constructor'] is Object, and
       the pill printed it. */
    function severityWords(severity) {
      return textOf(SEVERITY_LABEL[severity]) || textOf(severity) || 'Unknown';
    }

    function problemHead(problem, tone) {
      var row = h('div', { className: 'p-head' });

      row.appendChild(icon(problem.severity === 'info' ? 'info' : 'warn',
        'p-ico ' + (SEVERITY_INK[tone] || 'is-info')));

      var words = h('div', { className: 'grow' });
      var strip = h('div', { className: 'row wrap gap-sm' });
      /* h3, because the band title is the h2 and the pane's own name is the
         h1 in the top bar. The severity is in the title's ink, in the accent
         down the card and in the glyph, and none of those three is readable
         to somebody who cannot see colour, so it is in words here as well. */
      strip.appendChild(h('h3', {
        className: 'p-title ' + (SEVERITY_INK[tone] || 'is-info'), text: problem.title
      }));
      strip.appendChild(h('span', {
        className: 'pill ' + (SEVERITY_PILL[tone] || 'info'),
        text: severityWords(problem.severity)
      }));
      if (textOf(problem.reference)) {
        strip.appendChild(h('span', { className: 'pill ghost' }, [
          h('span', { className: 'code', text: problem.reference })
        ]));
      }
      words.appendChild(strip);
      row.appendChild(words);

      row.appendChild(conditionPill(problem));
      return row;
    }

    /* Whether the thing is still happening, which is not the same question as
       whether anybody has taken it on. A problem whose condition has cleared
       but which nobody has closed is a different state from one that is still
       firing, and the queue is the wrong place to learn that only by reading
       a timestamp. */
    function conditionPill(problem) {
      if (problem.status === 'closed') {
        return chip('', 'check', 'Closed ' + fmt.ago(problem.closedAt));
      }
      if (problem.conditionClearedAt) {
        return chip('up', 'check', 'Stopped ' + fmt.ago(problem.conditionClearedAt));
      }
      var tone = SEVERITY_PILL[SEVERITY_TONE[problem.severity]] || 'info';
      var pill = h('span', { className: 'pill ' + tone + ' p-live' });
      pill.appendChild(h('span', {
        className: 'dot ' + (tone === 'down' ? 'bad live' : tone === 'warn' ? 'warn' : 'acc'),
        'aria-hidden': 'true'
      }));
      pill.appendChild(document.createTextNode('Still happening'));
      return pill;
    }

    /* The facts a problem is acted on from: what it measured against what it
       was meant to, how long it has been going, and where it lands.

       No meter. The answer carries an observed value and a threshold, and the
       bar between them would need a full scale — what 100% of "jobs waiting
       for a GPU" is — that nothing sends. An invented scale is a picture of a
       number nobody measured. */
    function problemFacts(problem, data) {
      var grid = h('div', { className: 'grid g3 p-facts' });

      var measured = h('div', { className: 'p-col' });
      var observed = observedText(problem, data);
      if (observed) measured.appendChild(factRow('Measured', observed, true));
      if (textOf(problem.ruleThreshold)) {
        measured.appendChild(factRow('Alerts on', problem.ruleThreshold, true));
      }
      if (textOf(problem.ruleTitle)) measured.appendChild(factRow('Rule', problem.ruleTitle));
      grid.appendChild(measured);

      var when = h('div', { className: 'p-col' });
      var started = fmt.utcStamp(problem.firedAt);
      if (started) when.appendChild(factRow('Started', started, true));
      /* "Open for" measures to now, so it is only true while the problem is
         open. On a closed one -- which a range filter admits -- it printed a
         number that grew after the thing had stopped. */
      if (problem.firedAt && problem.status !== 'closed') {
        when.appendChild(factRow('Open for', fmt.since(problem.firedAt), true));
      }
      /* When it was taken on is NOT a row here. The footer already prints it,
         and with the one fact this grid cannot carry -- who took it on. One
         fact, one slot, and the slot is the one that says more. */
      grid.appendChild(when);

      var where = h('div', { className: 'p-col' });
      var chips = h('div', { className: 'row wrap gap-sm' });
      /* The work pane is NOT a chip here. It is the link in the actions row
         below, and a name that is already a doorway does not also need to be
         a label: one fact, one slot. */
      [problem.scopeLabel, problem.categoryLabel]
        .filter(function (label) { return textOf(label); })
        .forEach(function (label) {
          chips.appendChild(h('span', { className: 'pill ghost', text: label }));
        });
      if (chips.childNodes.length) {
        where.appendChild(h('div', { className: 'p-col-label', text: 'Where it shows up' }));
        where.appendChild(chips);
      }
      grid.appendChild(where);
      return grid;
    }

    function factRow(label, value, mono) {
      var row = h('div', { className: 'p-fact' });
      row.appendChild(h('span', { className: 'muted', text: label }));
      row.appendChild(h('span', {
        className: 'p-fact-v' + (mono ? ' num' : ''), text: value
      }));
      return row;
    }

    /* The observed figure only means something with its unit, and the unit
       lives on the rules endpoint rather than on the problem. Where the rule
       is not in hand the row is left out: a bare 5870 next to a threshold of
       "below 95%" would be worse than saying nothing. */
    function observedText(problem, data) {
      if (!fmt.isNum(problem.observedValue)) return null;
      var rule = rulesOf(data).filter(function (r) {
        return r.ruleKey === problem.ruleKey;
      })[0];
      if (!rule || !rule.thresholdUnit) return null;
      if (rule.thresholdUnit === 'basis_points') return fmt.percent(problem.observedValue);
      if (rule.thresholdUnit === 'seconds') return duration(problem.observedValue);
      return fmt.int(problem.observedValue);
    }

    /* Who has it, and what can be done about it. The absence of an owner is
       stated rather than left as a gap, because "nobody" is the fact that
       decides whether the next person picks it up. */
    function problemFoot(problem, data) {
      var wrap = h('div', { className: 'p-foot' });
      var row = h('div', { className: 'p-foot-row' });

      if (problem.status === 'open') {
        row.appendChild(chip('warn', 'bell', 'Nobody has picked this up'));
      } else if (problem.status === 'acknowledged') {
        var who = textOf(problem.acknowledgedByEmail);
        if (who) {
          row.appendChild(h('span', {
            className: 'av', 'aria-hidden': 'true', text: initials(who)
          }));
        }
        row.appendChild(h('span', {
          className: 'tiny',
          text: (who || 'An administrator') + ' took this on ' + fmt.ago(problem.acknowledgedAt)
        }));
      } else if (problem.status === 'closed') {
        row.appendChild(h('span', {
          className: 'tiny muted', text: closedSentence(problem, true)
        }));
      }

      /* Details and the close form open under the whole footer rather than
         inside the action row, so a long runbook is not sized by the buttons
         beside it -- and they get ONE HOST EACH. Sharing a host made each
         button report itself expanded over the other one's content, and made
         Details silently destroy a part-filled close form. */
      var detailHost = h('div');
      var closeHost = h('div');
      row.appendChild(actions(problem, data, detailHost, closeHost, 'q'));
      wrap.appendChild(row);
      wrap.appendChild(detailHost);
      wrap.appendChild(closeHost);
      return wrap;
    }

    /* Who closed it and why. `whenIsAlready` is true where the card already
       carries a "Closed <ago>" pill: the reason and the person are new, the
       word and the elapsed time are not, and one fact gets one slot. */
    function closedSentence(problem, whenIsAlready) {
      var reason = problem.closeReason
        ? (CLOSE_REASON_LABEL[problem.closeReason] || problem.closeReason).toLowerCase()
        : null;
      var who = textOf(problem.closedByEmail);
      /* The card already carries a "Closed <ago>" pill, so the word and the
         elapsed time are not new here -- but two of the three reasons are not
         clauses ("Nothing to do by somebody" does not parse), so the person
         goes after a dash rather than after "by". */
      if (whenIsAlready) {
        if (!reason) return 'Closed' + (who ? ' by ' + who : '');
        var head = reason.charAt(0).toUpperCase() + reason.slice(1);
        return head + (who ? ' \u2014 ' + who : '');
      }
      return 'Closed' + (reason ? ' as ' + reason : '') + (who ? ' by ' + who : '') +
        ' ' + fmt.ago(problem.closedAt);
    }

    /* The initials in the avatar are a picture of the name printed beside it,
       so the chip is hidden from the accessible tree rather than read out as
       two stray letters. */
    function initials(email) {
      var name = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
      var parts = name.split(/\s+/).filter(Boolean);
      var letters = parts.length > 1
        ? parts[0].charAt(0) + parts[1].charAt(0)
        : name.slice(0, 2);
      return letters.toUpperCase();
    }

    function actions(problem, data, detailHost, closeHost, surface) {
      var row = h('div', { className: 'row wrap gap-sm p-actions' });

      var file = model.PANE_FILE[problem.workPane];
      if (file && problem.workPane !== 'alerts') {
        row.appendChild(S.link(S.paneHref(paneKey(problem.workPane)) || file,
          problem.workPaneLabel || 'Where the work happens'));
      }

      row.appendChild(detailsButton(problem, data, detailHost, surface));

      if (problem.status !== 'closed') {
        if (canAct) {
          row.appendChild(closeButton(problem, closeHost, surface));
          if (problem.status === 'open') row.appendChild(takeOnButton(problem));
        } else {
          /* A disabled button says "not now"; the absent one plus this says
             "not you", which is the true reason and the one that tells the
             operator what to go and ask for. */
          row.appendChild(h('span', {
            className: 'tiny muted',
            text: 'Taking this on and closing it need the operator role'
          }));
        }
      }

      return row;
    }

    function takeOnButton(problem) {
      var button = h('button', {
        className: 'btn btn-sm btn-primary', type: 'button', text: 'I am on it'
      });
      button.appendChild(h('span', {
        className: 'sr', text: ', take on ' + problem.reference
      }));
      button.addEventListener('click', function () {
        button.disabled = true;
        acknowledge(problem).catch(function () {
          button.disabled = false;
          handBack(button);
        });
      });
      return button;
    }

    /* ------------------------------------------------------------ details

       The runbook, the timeline and the rule's earlier problems, read only
       when somebody asks for them. That is one more request per problem
       opened, which is why it is not folded into the list read: a queue of
       thirty problems would otherwise make thirty-one requests to draw a
       screen nobody has asked a question of yet. */
    function detailsButton(problem, data, host, surface) {
      var id = discloseId('detail', surface);
      host.setAttribute('id', id);
      var button = h('button', {
        className: 'btn btn-sm', type: 'button', text: 'Details',
        'aria-expanded': 'false', 'aria-controls': id
      });
      button.appendChild(h('span', { className: 'sr', text: ' of ' + problem.reference }));
      function read() {
        clear(host);
        host.appendChild(h('p', { className: 'tiny muted', text: 'Reading the record…' }));
        session.call('/api/ops/alerts/problems/' + encodeURIComponent(problem.id))
          .then(function (payload) {
            /* Closed again while the read was in flight. Nothing is put back
               on screen, because the operator has already said they are done
               with it. */
            if (button.getAttribute('aria-expanded') !== 'true') return;
            clear(host);
            host.appendChild(detailBlock(payload.data, problem));
          })
          .catch(function (err) {
            if (button.getAttribute('aria-expanded') !== 'true') return;
            clear(host);
            /* Nothing else reports this read. It is the only request on the
               page whose failure is written into a disclosed region rather
               than toasted, so without a live role a screen reader is told
               nothing at all, and without the retry v1 offered the only way
               to ask again is to collapse the record and re-open it. */
            var failed = h('div', { role: 'alert' });
            failed.appendChild(h('p', {
              className: 'tiny is-warn', text: S.failureMessage(err)
            }));
            var again = h('button', {
              className: 'btn btn-sm', type: 'button', text: 'Try again'
            });
            again.appendChild(h('span', {
              className: 'sr', text: ' reading ' + problem.reference
            }));
            /* The retry is inside the region it replaces, so pressing it
               destroys it: the same class as every other control here, and
               the Details button that owns the region is what survives. */
            again.addEventListener('click', function () { read(); handBack(button); });
            failed.appendChild(again);
            host.appendChild(failed);
          });
      }

      button.addEventListener('click', function () {
        var open = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', open ? 'false' : 'true');
        if (open) { clear(host); return; }
        read();
      });
      return button;
    }

    function detailBlock(detail, problem) {
      var box = h('div', { className: 'p-detail' });

      var runbook = list(detail.runbook);
      if (runbook.length) {
        box.appendChild(h('h4', { className: 'p-detail-title', text: 'What to do' }));
        var steps = h('ol', { className: 'p-steps' });
        runbook.forEach(function (step) { steps.appendChild(h('li', { text: step })); });
        box.appendChild(steps);
      }

      var timeline = list(detail.timeline);
      if (timeline.length) {
        box.appendChild(h('h4', { className: 'p-detail-title', text: 'What has happened' }));
        var log = h('ul', { className: 'p-log' });
        timeline.forEach(function (event) { log.appendChild(eventRow(event)); });
        box.appendChild(log);
      }

      var history = list(detail.ruleHistory);
      if (history.length) {
        box.appendChild(h('h4', {
          className: 'p-detail-title', text: 'This rule has fired before'
        }));
        var earlier = h('ul', { className: 'p-log' });
        history.forEach(function (entry) {
          var outcome = entry.closedAt
            ? 'closed as ' + (CLOSE_REASON_LABEL[entry.closeReason] ||
                entry.closeReason || 'resolved').toLowerCase()
            : 'still open';
          var item = h('li', { className: 'p-log-row' });
          item.appendChild(h('span', {
            className: 'p-log-when num', text: fmt.utcDay(entry.firedAt) || fmt.none
          }));
          item.appendChild(h('div', {
            text: entry.reference + ', ' + entry.title + ', ' + outcome
          }));
          earlier.appendChild(item);
        });
        box.appendChild(earlier);
      }

      if (!box.childNodes.length) {
        box.appendChild(h('p', {
          className: 'tiny muted',
          text: 'Nothing is recorded against ' + (problem.reference || 'this problem') +
            ' beyond what is above.'
        }));
      }
      return box;
    }

    /* One line of the record. The note somebody wrote when they closed it is
       on the event rather than on the problem, and it is the one sentence
       that says WHY, so it is printed rather than summarised away. */
    function eventRow(event) {
      var row = h('li', { className: 'p-log-row' });
      row.appendChild(h('span', {
        className: 'p-log-when num', text: fmt.utcStamp(event.occurredAt) || fmt.none
      }));
      var words = h('div');
      words.appendChild(h('span', {
        text: (EVENT_LABEL[event.eventType] || event.eventType) +
          (textOf(event.actorEmail) ? ' by ' + event.actorEmail : '')
      }));
      var note = event.detail && textOf(event.detail.note);
      if (note) words.appendChild(h('p', { className: 'p-log-note', text: '“' + note + '”' }));
      row.appendChild(words);
      return row;
    }

    /* -------------------------------------------------------- closing one

       A form in the card rather than a dialog over the page. It says what
       closing does before it is done, because closing is not undoable: the
       condition coming back raises a new problem rather than reopening this
       one. */
    function closeButton(problem, host, surface) {
      var id = discloseId('close', surface);
      host.setAttribute('id', id);
      var button = h('button', {
        className: 'btn btn-sm', type: 'button', text: 'Close',
        'aria-expanded': 'false', 'aria-controls': id
      });
      button.appendChild(h('span', { className: 'sr', text: ' problem ' + problem.reference }));
      button.addEventListener('click', function () {
        var open = button.getAttribute('aria-expanded') === 'true';
        clear(host);
        button.setAttribute('aria-expanded', open ? 'false' : 'true');
        if (open) return;
        var form = closeForm(problem, surface, function () {
          button.setAttribute('aria-expanded', 'false');
          clear(host);
          button.focus();
        });
        host.appendChild(form.node);
        form.focus();
      });
      return button;
    }

    function closeForm(problem, surface, onCancel) {
      var reasonId = discloseId('close-reason', surface);
      var noteId = discloseId('close-note', surface);

      var box = h('form', { className: 'p-close' });
      box.appendChild(h('p', {
        className: 'tiny',
        text: 'Closing records who closed it and why. If the condition comes back, a new ' +
          'problem is raised rather than this one reopening.'
      }));

      var reasonWrap = h('div', { className: 'p-field' });
      reasonWrap.appendChild(h('label', {
        className: 'p-label', 'for': reasonId, text: 'Why is it being closed?'
      }));
      var reason = h('select', { id: reasonId });
      /* Two reasons, not three. `self_resolved` is the engine's own: when a
         condition clears with nobody on it, the route closes the problem that
         way itself. A person cannot choose it -- the close endpoint answers
         `ops_close_reason_invalid` -- so offering it is a button that can only
         fail. It is still printed on a record the engine closed. */
      [
        { value: 'resolved', label: 'Resolved, somebody fixed it' },
        { value: 'no_action_needed', label: 'Nothing to do, it did not need a person' }
      ].forEach(function (option) {
        reason.appendChild(h('option', { value: option.value, text: option.label }));
      });
      reasonWrap.appendChild(h('div', { className: 'sel' }, [reason, icon('chev')]));
      box.appendChild(reasonWrap);

      var noteWrap = h('div', { className: 'p-field' });
      noteWrap.appendChild(h('label', {
        className: 'p-label', 'for': noteId, text: 'What happened? Kept with the record'
      }));
      var limitId = discloseId('close-note-limit', surface);
      var note = h('textarea', {
        id: noteId, rows: '2', maxlength: String(NOTE_LIMIT),
        'aria-describedby': limitId
      });
      noteWrap.appendChild(note);
      /* Empty until the limit is reached, so the ordinary case carries no
         extra words, and a sentence the moment the field starts dropping
         what is put into it. role="status" rather than "alert": nothing is
         wrong, and it is not worth interrupting what is being typed. */
      var limit = h('p', { className: 'tiny muted', id: limitId, role: 'status' });
      noteWrap.appendChild(limit);
      note.addEventListener('input', function () {
        limit.textContent = String(note.value || '').length >= NOTE_LIMIT
          ? 'At the ' + NOTE_LIMIT + '-character limit. Anything past it is not kept.'
          : '';
      });
      box.appendChild(noteWrap);

      var confirm = h('button', {
        className: 'btn btn-sm btn-primary', type: 'submit', text: 'Close it'
      });
      var cancel = h('button', {
        className: 'btn btn-sm', type: 'button', text: 'Leave it open'
      });
      cancel.addEventListener('click', function () { onCancel(); });
      box.appendChild(h('div', { className: 'row wrap gap-sm' }, [confirm, cancel]));

      /* role="alert" because this is the ONLY place a refused close is
         reported: the form stays open and the message belongs beside it, not
         in a toast that would state the same refusal a second time. v1 said
         this through op.confirmAction's role="alert" paragraph; the inline
         form has to say it for itself. */
      var failure = h('p', { className: 'tiny is-warn', role: 'alert' });
      box.appendChild(failure);

      box.addEventListener('submit', function (e) {
        e.preventDefault();
        confirm.disabled = true;
        cancel.disabled = true;
        failure.textContent = '';
        closeProblem(problem, reason.value, note.value).catch(function (err) {
          confirm.disabled = false;
          cancel.disabled = false;
          failure.textContent = S.failureMessage(err);
          handBack(confirm);
        });
      });

      return { node: box, focus: function () { reason.focus(); } };
    }

    /* ------------------------------------------------------------ actions */

    /* A change that lands re-reads the pane, which throws away the control
       that was just used and with it whatever had focus. (A change the server
       REFUSES re-reads nothing and is handled by handBack() below.) The content region is the one
       element that survives a re-render, so focus goes there and the change
       is announced, rather than being dropped on the body where a keyboard
       user would have to tab back in from the top of the page.

       It waits for the re-read to land first: moving focus to a control the
       re-render is about to remove drops it on the body a moment later, which
       is the thing this is here to prevent. If the operator has already put
       focus somewhere themselves by then, it is left where they put it.

       load() is called directly in exactly one place -- the first read, at the
       bottom of this file, which is not a re-read and must not move focus off
       whatever the page loaded with. Every other call is a re-read and comes
       through here. Most of those controls sit inside the region the re-read
       replaces and are destroyed by it, exactly as a write control is; the
       severity and category controls do not, which is why they are marked in
       place instead (see severityControl() above) rather than protected here.

       This covers the RE-READS only. The class is every control that is
       disabled or destroyed by being used, and a refused write is disabled
       without re-reading anything: handBack() below is that half. */
    /* The other half of reload(), for the changes that never re-read.
       Disabling the focused control blurs it to <body> exactly as removing it
       does, and a REFUSED write re-reads nothing, so nothing else would put
       focus back: the operator is told the write did not go through and is
       left at the top of the document to tab back to the button they pressed.

       Guarded the same way reload() is. A close submitted with Enter from the
       note field never blurred -- the textarea is not the control that was
       disabled -- so the operator is left in the field they were typing in,
       and role="alert" on the failure line carries the refusal instead. */
    function handBack(node) {
      var live = document.activeElement;
      if (node && (!live || live === document.body)) node.focus();
    }

    function reload() {
      return load().then(function () {
        var host = document.getElementById('content');
        var live = document.activeElement;
        if (host && (!live || live === document.body)) host.focus();
      });
    }

    function afterChange(message) {
      S.announce(message);
      return reload();
    }

    function acknowledge(problem) {
      return session.call(
        '/api/ops/alerts/problems/' + encodeURIComponent(problem.id) + '/acknowledge',
        { method: 'POST' }
      ).then(function () {
        S.toast('check', 'You are on ' + problem.reference + '. Everyone else can see that.');
        afterChange('You are now on ' + problem.reference + '.');
      }).catch(function (err) {
        /* Somebody else got there first, or the problem moved on while the
           page was open. Neither is an error the operator caused, so the pane
           says what happened and re-reads rather than showing a failure. */
        if (err && err.code === 'ops_problem_moved') {
          S.toast('info', 'Somebody else changed ' + problem.reference + ' first.');
          afterChange('Somebody else changed ' + problem.reference +
            ' first. The page has been re-read.');
          return;
        }
        S.toast('warn', S.failureMessage(err));
        throw err;
      });
    }

    function closeProblem(problem, choice, note) {
      return session.call(
        '/api/ops/alerts/problems/' + encodeURIComponent(problem.id) + '/close',
        { method: 'POST', body: { reason: choice, note: textOf(note) || undefined } }
      ).then(function () {
        var words = problem.reference + ' closed as ' +
          (CLOSE_REASON_LABEL[choice] || choice).toLowerCase() + '.';
        S.toast('check', words);
        afterChange(words);
      }).catch(function (err) {
        /* Somebody else closed it while this form was open. The problem is in
           the state the operator wanted it in, so this is not a failure to
           show them: the pane re-reads and the form goes with the re-render,
           rather than leaving them staring at an error over a screen that is
           already stale. */
        if (err && err.code === 'ops_problem_moved') {
          S.toast('info', 'Somebody else changed ' + problem.reference + ' first.');
          afterChange('Somebody else changed ' + problem.reference +
            ' first. The page has been re-read.');
          return;
        }
        throw err;
      });
    }

    /* ------------------------------------------------------------- rules */

    /* The table names its own scroller, so the region's name and the table's
       name are one sentence that cannot drift apart. Same shape as
       pane-releases.js's HEALTH_CAPTION_ID. */
    var RULES_CAPTION_ID = 'alertsRulesCaption';

    function rulesBand(armed, queue) {
      var section = S.band('What is being watched',
        fmt.int(armed.enabled) + ' of ' + fmt.int(armed.total) + ' rules on');

      var box = S.card('rules-card');
      if (!armed.total) {
        box.appendChild(h('div', { className: 'card-body' }, [
          h('p', { className: 'tiny muted', text: 'No alert rule has been created.' })
        ]));
        section.appendChild(box);
        return section;
      }

      /* Six columns hold a 760px minimum, so on a phone this box scrolls
         sideways inside its card rather than taking the document with it
         (pane-alerts-v2.css). A box that scrolls has to be reachable from a
         keyboard, or the columns past the edge belong to a pointer alone —
         and for a non-owner every switch in here is disabled, so the box then
         holds nothing focusable at all and there is no other way in. tabindex
         gives it the stop, role="region" makes the stop a landmark, and the
         name is the table's own caption rather than a second sentence that
         could drift from it. Both sibling v2 panes do this: pane-releases.js
         .tbl-scroll and settings.js tableWrap(). */
      var scroll = h('div', {
        className: 'scrollx',
        tabindex: '0',
        role: 'region',
        'aria-labelledby': RULES_CAPTION_ID
      });
      var table = h('table', { className: 'tbl' });
      table.appendChild(h('caption', {
        className: 'sr', id: RULES_CAPTION_ID,
        text: 'Alert rules and what each one watches'
      }));
      var head = h('tr');
      [
        { label: 'Rule' },
        { label: 'What it watches' },
        { label: 'Alerts on', right: true },
        { label: 'State' },
        { label: 'Last fired', right: true },
        { label: 'On', right: true }
      ].forEach(function (column) {
        head.appendChild(h('th', { className: column.right ? 'r' : '', text: column.label }));
      });
      table.appendChild(h('thead', {}, [head]));

      var rows = h('tbody');
      armed.rules.forEach(function (rule) { rows.appendChild(ruleRow(rule, queue)); });
      table.appendChild(rows);
      scroll.appendChild(table);
      box.appendChild(scroll);

      /* The approved design has a "right now" column. The rules endpoint
         sends no current value for a rule, so the column is not drawn and its
         absence is stated where it would have been rather than filled in from
         somewhere else. */
      var foot = h('div', { className: 'card-foot' });
      foot.appendChild(icon('info'));
      foot.appendChild(h('span', {
        text: 'No current reading per rule is in this answer. ' +
          (isOwner
            ? 'Turning one off stops it firing; it keeps recording.'
            : 'Turning a rule on or off needs the owner role.')
      }));
      box.appendChild(foot);

      section.appendChild(box);
      return section;
    }

    function ruleRow(rule, queue) {
      var row = h('tr', { className: 'rule-row' });

      var name = h('td');
      name.appendChild(h('div', { className: 't-main', text: rule.title || rule.ruleKey }));
      var feeding = queue.filter(function (problem) {
        return problem.ruleKey === rule.ruleKey && problem.status !== 'closed';
      })[0];
      if (feeding && textOf(feeding.reference)) {
        var sub = h('div', { className: 't-sub' });
        sub.appendChild(document.createTextNode('Feeds problem '));
        sub.appendChild(h('span', { className: 'code', text: feeding.reference }));
        name.appendChild(sub);
      }
      row.appendChild(name);

      row.appendChild(h('td', {
        className: 'muted', text: textOf(rule.scopeDescription) || fmt.none
      }));
      row.appendChild(h('td', {
        className: 'r num', text: textOf(rule.thresholdLabel) || fmt.none
      }));

      row.appendChild(h('td', {}, [ruleState(rule)]));

      var fired = h('td', { className: 'r' });
      if (rule.lastFiredAt) {
        fired.appendChild(h('span', { className: 'num', text: fmt.ago(rule.lastFiredAt) }));
      } else {
        fired.appendChild(h('span', { className: 'muted', text: 'never fired' }));
      }
      row.appendChild(fired);

      row.appendChild(h('td', { className: 'r' }, [ruleToggle(rule)]));
      return row;
    }

    /* What the rule did the last time it ran, in words. A rule that is
       enabled but cannot reach a verdict is not a rule that is watching, and
       the row says so where the eye already is: the pill's tone repeats the
       word, it never carries it. */
    function ruleState(rule) {
      if (!rule.enabled) return chip('ghost', 'x', 'Turned off');
      if (!rule.lastEvaluatedAt) return chip('warn', 'clock', 'Has not run yet');

      var status = rule.lastEvaluationStatus;
      var words = EVALUATION_LABEL[status] || status || 'Unknown';
      if (status === 'insufficient_data' && rule.lastInsufficientReason) {
        words += ', ' + (INSUFFICIENT_REASON[rule.lastInsufficientReason] ||
          rule.lastInsufficientReason);
      }
      var glyph = status === 'ok' ? 'check'
        : status === 'firing' ? 'warn'
          : status === 'error' ? 'plug' : 'clock';
      return chip(EVALUATION_PILL[status] || 'warn', glyph, words);
    }

    /* A real checkbox carrying role="switch", so it is focusable, announced
       with its state, and named by the rule it belongs to. Only the owner may
       change one; everybody else sees the true state, disabled, which is a
       fact rather than a control that would be refused. */
    function ruleToggle(rule) {
      var input = h('input', {
        className: 'sw', type: 'checkbox', role: 'switch',
        'aria-label': (rule.enabled ? 'Turn off ' : 'Turn on ') + (rule.title || rule.ruleKey)
      });
      input.checked = Boolean(rule.enabled);
      if (!isOwner) {
        /* Shown in its true state rather than hidden, and disabled rather
           than left live to be refused by the server. The card's footer says
           which role would be needed, because a disabled control on its own
           does not say why. */
        input.disabled = true;
        return input;
      }

      input.addEventListener('change', function () {
        var next = input.checked;
        input.disabled = true;
        session.call('/api/ops/alerts/rules/' + encodeURIComponent(rule.ruleKey), {
          method: 'PATCH',
          body: { enabled: next }
        }).then(function () {
          S.toast('check', (rule.title || rule.ruleKey) + (next ? ' turned on' : ' turned off'));
          reload();
        }).catch(function (err) {
          /* Put the switch back where it was. It shows what the rule is, and
             a switch left in a position the server refused is a lie. */
          input.checked = !next;
          input.disabled = false;
          handBack(input);
          S.toast('warn', S.failureMessage(err));
        });
      });
      return input;
    }

    /* ------------------------------------------- closed, and the watching */

    function closedBand(data, armed) {
      var section = S.band('Closed, and how the watching is doing');
      var grid = h('div', { className: 'grid g-third' });
      grid.appendChild(closedCard(data));
      var side = h('div', { className: 'c-side' });
      side.appendChild(watchingCard(data));
      side.appendChild(routingCard(armed, Boolean(data.rules.error)));
      grid.appendChild(side);
      section.appendChild(grid);
      return section;
    }

    function closedRecently(data) {
      var cutoff = Date.now() - CLOSED_DAYS * 86400000;
      return problemsOf(data.closed).filter(function (problem) {
        var closed = time(problem.closedAt);
        return problem.status === 'closed' && closed !== null && closed >= cutoff;
      }).sort(function (a, b) { return time(b.closedAt) - time(a.closedAt); });
    }

    function closedCard(data) {
      var box = S.card();
      box.appendChild(S.cardHead('Recently closed', 'Last ' + CLOSED_DAYS + ' days'));
      var body = h('div', { className: 'card-body' });

      if (data.closed.error) {
        body.appendChild(h('p', {
          className: 'tiny is-warn',
          text: 'The closed problems could not be read. ' + S.failureMessage(data.closed.error)
        }));
        box.appendChild(body);
        return box;
      }

      /* Computed before the empty branch, not after it. The closed query sends
         no date bound, so once more than PAGE closures exist the PAGE that come
         back are the oldest and every one of them can predate this window --
         and that is the state where an undisclosed cap does the most damage,
         because the card renders "nothing has been closed" from a sample that
         was never in a position to say so. The figures beside it already refuse
         to count from that sample; this refuses to report a zero from it. */
      var cappedClosed = model.capped(problemsOf(data.closed));
      var recent = closedRecently(data);
      if (!recent.length) {
        body.appendChild(h('p', {
          className: 'tiny muted',
          text: cappedClosed
            ? 'Whether anything was closed in the last ' + CLOSED_DAYS + ' days cannot be ' +
              'told from this read.'
            : 'Nothing has been closed in the last ' + CLOSED_DAYS + ' days.'
        }));
        box.appendChild(body);
        if (cappedClosed) box.appendChild(closedCapFoot(true, 0));
        return box;
      }

      var rows = h('div', { className: 'c-list' });
      recent.slice(0, CLOSED_SHOWN).forEach(function (problem, i) {
        if (i) rows.appendChild(h('div', { className: 'divider' }));
        rows.appendChild(closedRow(problem, data));
      });
      body.appendChild(rows);
      box.appendChild(body);

      /* The note somebody wrote when they closed it is on the problem's own
         record rather than in this list, so this says where it is instead of
         leaving the sentence out with no explanation.

         The closed read is issued on EVERY load, whatever the range control
         says, so a capped one is disclosed here rather than beside the queue:
         the queue's own disclosure is about the queue, and on the default
         window the queue holds no closed problem to be short of. A count over
         a capped read is a floor, so it is not printed as a total. */
      box.appendChild(closedCapFoot(cappedClosed, recent.length));
      return box;
    }

    /* The closed card's foot, drawn from both branches. `listed` is 0 on the
       empty one, which has no row to send anybody into, so it says only what
       the read could not cover. */
    function closedCapFoot(cappedClosed, listed) {
      var foot = h('div', { className: 'card-foot' });
      foot.appendChild(icon('history'));
      foot.appendChild(h('span', {
        text: (cappedClosed
          ? 'Only ' + PAGE + ' closed problems can be read at once and that many came ' +
            'back, worst first and then oldest, so the most recent closures are missing ' +
            'from this list. '
          : listed > CLOSED_SHOWN ? fmt.int(listed) + ' closed. ' : '') +
          (listed ? 'Open one to read the note it was closed with.' : '')
      }));
      return foot;
    }

    function closedRow(problem, data) {
      var row = h('div', { className: 'c-row' });
      row.appendChild(h('span', { className: 'dot ok', 'aria-hidden': 'true' }));

      var words = h('div', { className: 'grow' });
      var strip = h('div', { className: 'row wrap gap-sm' });
      strip.appendChild(h('h4', { className: 'c-title', text: problem.title }));
      if (textOf(problem.reference)) {
        strip.appendChild(h('span', { className: 'pill ghost' }, [
          h('span', { className: 'code', text: problem.reference })
        ]));
      }
      words.appendChild(strip);
      words.appendChild(h('p', { className: 'tiny muted', text: closedSentence(problem) }));

      var host = h('div');
      words.appendChild(h('div', { className: 'row wrap gap-sm mt-xs' }, [
        detailsButton(problem, data, host, 'c')
      ]));
      words.appendChild(host);
      row.appendChild(words);
      return row;
    }

    /* How the watching has been doing, over the problems that were read.

       Every figure here is worked out over a window that ends today, so a
       full read makes them unavailable rather than approximate: the reads
       come back worst first and then oldest, so the days this card is about
       are exactly the days a full page is missing. */
    function watchingCard(data) {
      var box = S.card();
      box.appendChild(S.cardHead('How the watching is doing', 'Last ' + CLOSED_DAYS + ' days'));
      var body = h('div', { className: 'card-body' });

      if (data.open.error || data.closed.error) {
        body.appendChild(h('p', {
          className: 'tiny is-warn',
          text: 'Not every problem could be read, so these cannot be counted.'
        }));
        box.appendChild(body);
        return box;
      }

      if (model.capped(problemsOf(data.open)) || model.capped(problemsOf(data.closed))) {
        body.appendChild(h('p', {
          className: 'tiny muted',
          text: 'More problems exist than the ' + PAGE + ' a read can return, and the oldest ' +
            'come back first, so the last ' + CLOSED_DAYS + ' days would be counted short. ' +
            'Nothing is drawn from a sample missing exactly the days it is about.'
        }));
        box.appendChild(body);
        return box;
      }

      var cutoff = Date.now() - CLOSED_DAYS * 86400000;
      var everything = distinct(problemsOf(data.open).concat(problemsOf(data.closed)));
      var opened = everything.filter(function (problem) {
        var fired = time(problem.firedAt);
        return fired !== null && fired >= cutoff;
      });
      var closed = closedRecently(data);
      var acknowledged = opened.filter(function (problem) {
        return time(problem.acknowledgedAt) !== null && time(problem.firedAt) !== null;
      });

      var rows = h('div', { className: 'w-rows' });
      rows.appendChild(factRow('Opened', fmt.int(opened.length), true));
      rows.appendChild(factRow('Closed', fmt.int(closed.length), true));
      if (acknowledged.length) {
        rows.appendChild(factRow('Median time to take one on',
          duration(medianSeconds(acknowledged)), true));
      }
      body.appendChild(rows);

      /* A rate over too few closures says nothing, so below five it reports
         the counts instead of a percentage that would move twenty points on
         one problem. This figure is the one that decides whether a rule gets
         turned off. */
      var nothingToDo = closed.filter(function (problem) {
        return problem.closeReason === 'no_action_needed';
      });
      body.appendChild(h('div', { className: 'divider mt-sm' }));
      body.appendChild(h('div', { className: 'w-rows mt-sm' }, [
        factRow('Closed as nothing to do',
          closed.length < 5
            ? fmt.int(nothingToDo.length) + ' of ' + fmt.int(closed.length) + ', too few to rate'
            : fmt.int(nothingToDo.length) + ' of ' + fmt.int(closed.length),
          true)
      ]));

      box.appendChild(body);
      return box;
    }

    function medianSeconds(problems) {
      var spans = problems.map(function (problem) {
        return (time(problem.acknowledgedAt) - time(problem.firedAt)) / 1000;
      }).filter(function (n) {
        return isFinite(n) && n >= 0;
      }).sort(function (a, b) { return a - b; });
      if (!spans.length) return null;
      var middle = Math.floor(spans.length / 2);
      return spans.length % 2 ? spans[middle] : (spans[middle - 1] + spans[middle]) / 2;
    }

    /* Where a problem actually goes. A problem that only ever appears on this
       page is a log line pretending to be an alert, so the pane states, per
       channel, whether it is set up and what the last delivery did. */
    /* Where a problem goes once it is raised. The channels come out of the
       rules answer, so a rules read that never landed knows nothing about
       them: the card says the list could not be read rather than "no channel
       is set up", which is the one sentence on this pane that means alerts
       reach nobody. The pane does not get to say that from an empty object it
       built itself. */
    function routingCard(armed, rulesFailed) {
      var box = S.card();
      box.appendChild(S.cardHead('Where problems are sent'));
      var body = h('div', { className: 'card-body' });

      if (rulesFailed) {
        body.appendChild(h('p', {
          className: 'tiny is-warn',
          text: 'This could not be read, so whether anything is getting through ' +
            'is unknown.'
        }));
        box.appendChild(body);
        return box;
      }

      /* Absent is not empty. An answer that carried no channel list at all
         cannot support "No notification channel is set up" -- that is a
         statement about the world derived from a gap in the payload
         (Stadiora/Aria#10811). */
      if (!armed.channelsKnown) {
        body.appendChild(h('p', {
          className: 'tiny is-warn',
          text: 'The answer did not say where problems are sent, so whether ' +
            'anything is getting through is unknown.'
        }));
        box.appendChild(body);
        return box;
      }

      if (!armed.channels.length) {
        body.appendChild(h('p', {
          className: 'tiny muted', text: 'No notification channel is set up.'
        }));
        box.appendChild(body);
        return box;
      }

      var rows = h('div', { className: 'w-rows' });
      armed.channels.forEach(function (channel) {
        var row = h('div', { className: 'c-route' });
        var words = h('div', { className: 'grow' });
        /* Named by its key when the answer carries no label, because an empty
           element is indistinguishable from a row that is simply not there --
           to a reader, to a screen reader, and to a test (Stadiora/Aria#10821).
           The key is not pretty and is not meant to be: it is the only thing
           on hand that identifies WHICH destination this row is about, and a
           row that cannot say that is not worth drawing. */
        words.appendChild(h('div', { className: 'strong tiny',
          text: textOf(channel.label) || textOf(channel.channel) || 'Unnamed destination' }));
        words.appendChild(h('div', { className: 'tiny muted', text: channelNote(channel) }));
        row.appendChild(words);

        var status = channel.configured
          ? (CHANNEL_STATUS[channel.lastDeliveryStatus] || null)
          : CHANNEL_STATUS.unconfigured;
        var tone = !status ? 'ghost'
          : status.tone === 'ok' ? 'up'
            : status.tone === 'crit' ? 'down' : 'warn';
        row.appendChild(chip(tone, null, status ? status.label : 'Nothing sent yet'));
        rows.appendChild(row);
      });
      body.appendChild(rows);
      box.appendChild(body);
      return box;
    }

    function channelNote(channel) {
      if (!channel.configured) return 'No destination has been set';
      if (channel.lastDeliveryStatus === 'failed') {
        var why = CHANNEL_FAILURE[channel.lastFailureReason];
        return 'Last attempt ' + fmt.ago(channel.lastAttemptAt) +
          (why ? ', ' + why : '') +
          (channel.consecutiveFailures > 1
            ? ', ' + fmt.int(channel.consecutiveFailures) + ' in a row'
            : '');
      }
      if (channel.lastSuccessAt) return 'Last delivered ' + fmt.ago(channel.lastSuccessAt);
      return 'Set up, nothing sent through it yet';
    }

    /* --------------------------------------------------------- empty state

       Nothing to show is three different facts, and telling them apart is the
       whole point of this state. Either a filter matched nothing, or the
       rules are checking and found nothing, or the rules are not in a
       position to find anything. Only the second is a statement about the
       health of the system, and it is the only one allowed to make it. */
    function emptyState(data, armed, queueCapped, rulesFailed) {
      var wrap = h('div', { className: 'stack' });
      var box = S.card();
      var block;

      if (narrowed()) {
        /* A filter that matched nothing says nothing about anything outside
           it. A critical problem can be open one control away from this
           sentence, so this branch never claims the system is well and never
           reads the rules for a verdict on it.

           It is also the one empty state a full read can reach, when the
           hundred problems that came back are all outside the window or the
           category, so it carries the disclosure the list would have. */
        var missLines = [
          'No problem matches ' + filterSentence() + '.',
          'This says nothing about the problems these filters exclude.'
        ];
        if (rulesFailed) {
          missLines.push(UNREAD_WATCH +
            ' That is the case whatever these filters are set to.');
        } else if (!armed.trustworthy) {
          missLines.push(notArmedSentence(armed) +
            ' That is the case whatever these filters are set to.');
        }
        /* The same flag the hero hedges its count with, taken rather than
           recomputed: two spellings of one rule drift apart the first time
           only one of them is edited. */
        if (queueCapped) {
          missLines.push('Only ' + PAGE + ' problems could be read, worst first and then ' +
            'oldest, so the most recent ones were not looked at either.');
        }
        block = S.stateBlock('search', 'Nothing matches these filters', missLines);
        var clearButton = h('button', {
          className: 'btn btn-primary', type: 'button', text: 'Clear the filters'
        });
        clearButton.addEventListener('click', function () {
          picked.severity = 'all';
          picked.category = 'all';
          renderFilterControls();
          /* The window is a filter like the other two, counted as one by
             narrowed() and named by filterSentence(), so a button offering to
             clear the filters clears it as well. It belongs to the shell,
             which puts it back and announces the change; the pane hears that
             announcement and re-reads, so this only reloads itself when the
             window was already the one the pane starts on. */
          if (!S.resetRange()) reload();
        });
        block.appendChild(h('div', { className: 'row mt-sm' }, [clearButton]));
      } else if (rulesFailed) {
        /* An empty list and alerting that has stopped look identical, and the
           ONE thing that tells them apart is the rules read. When that read
           is the thing that failed, the page has not got the fact and does
           not get to state either one -- `armedState({})` is the empty object
           the pane built for itself at the top of render(), so every count in
           it is zero because nothing answered, not because nothing is there.
           "There are no alert rules at all" over that object is the same
           defect the routing card carried, in the state where it costs more:
           an operator reads it three inches from "this part is unread". */
        block = S.stateBlock('warn', 'Nothing is open, and whether anything is watching is unknown', [
          'An empty problems page and alerting that has stopped look identical, and the ' +
            'read that tells them apart is the one that failed. Treat this as unverified ' +
            'until the rules can be read.'
        ]);
      } else if (armed.trustworthy) {
        block = S.stateBlock('check', 'Nothing is wrong, and the watching is working', [
          fmt.plural(armed.checking, 'rule') + ' of ' + fmt.int(armed.total) +
            ' reached a verdict the last time they ran, and none of them is firing.',
          lastActivitySentence(armed),
          'This page is empty because there is no problem, not because the checks stopped.'
        ]);
      } else {
        block = S.stateBlock('warn', 'Nothing is being reported, and that is the problem', [
          notArmedSentence(armed),
          'An empty problems page and alerting that has stopped look identical, so this ' +
            'page says which one it is. Treat this as unmonitored until the rules are ' +
            'checking again.'
        ]);
      }

      box.appendChild(block);
      wrap.appendChild(box);
      wrap.appendChild(data.rules.error
        ? failedBand('What is being watched', 'The rules could not be read', data.rules.error)
        : rulesBand(armed, []));
      wrap.appendChild(closedBand(data, armed));
      return wrap;
    }

    /* The filters in the words the controls use, so the sentence names what
       to undo rather than saying "your filters" and leaving the operator to
       find them. */
    function filterSentence() {
      var bits = [];
      if (picked.severity !== 'all') {
        bits.push('severity ' +
          (SEVERITY_LABEL[picked.severity] || picked.severity).toLowerCase());
      }
      if (picked.category !== 'all') {
        var category = CATEGORIES.filter(function (c) {
          return c.value === picked.category;
        })[0];
        bits.push('category ' + (category ? category.label.toLowerCase() : picked.category));
      }
      if (RANGE_DAYS[filters.range]) {
        bits.push('the last ' + RANGE_DAYS[filters.range] + ' days');
      }
      if (!bits.length) return 'the current filters';
      if (bits.length === 1) return bits[0];
      return bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1];
    }

    function lastActivitySentence(armed) {
      var bits = [];
      if (armed.lastEvaluatedAt) bits.push('Last checked ' + fmt.ago(armed.lastEvaluatedAt) + '.');
      bits.push(armed.lastFiredAt
        ? 'The last problem fired ' + fmt.ago(armed.lastFiredAt) + '.'
        : 'No problem has ever fired.');
      return bits.join(' ');
    }

    /* Why nothing is being judged, each reading of it separately, because
       they need different things done about them. */
    /* Said wherever the page would otherwise have reported a verdict about
       the watching that it read off an answer that never arrived. */
    var UNREAD_WATCH = 'The rules could not be read, so whether anything is watching ' +
      'is unknown.';

    function notArmedSentence(armed) {
      if (!armed.total) return 'There are no alert rules at all.';
      if (!armed.enabled) {
        return 'None of the ' + fmt.int(armed.total) + ' rules are enabled, ' +
          'so nothing is being checked.';
      }
      if (armed.neverRun === armed.enabled) {
        return fmt.plural(armed.enabled, 'rule') + ' enabled but none of them has ' +
          'run yet, so nothing has been checked.';
      }
      if (armed.errored === armed.enabled) {
        return 'Every enabled rule failed its own check the last time it ran, ' +
          'so nothing is being judged. Last tried ' + fmt.ago(armed.lastEvaluatedAt) + '.';
      }
      if (armed.errored) {
        return 'No enabled rule reached a verdict the last time it ran, and ' +
          fmt.int(armed.errored) + ' of them failed the check itself. Last tried ' +
          fmt.ago(armed.lastEvaluatedAt) + '.';
      }
      return 'Every enabled rule is unable to reach a verdict, ' +
        'so nothing is being judged. Last checked ' + fmt.ago(armed.lastEvaluatedAt) + '.';
    }

    load();
  });
})(window);
