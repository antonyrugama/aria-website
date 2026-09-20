/* Happening now: what is Aria working on, and is any of it not clearing?

   WHAT THIS PANE CAN ACTUALLY ANSWER TODAY, AND WHAT IT CANNOT

   There is no queue behind this page. Nothing serves one: app-backend mounts
   no route that lists jobs, their lanes, their ages or their retries, so every
   figure of that kind is absent rather than zero. What does exist is the
   alerting record, and two of its rules are pointed at this pane by the server
   itself — `queue_backlog_age` and `ai_success_rate` both carry
   linkPane: 'jobs-live'. Those two are the present tense: how long the oldest
   queued job has been waiting, and whether the work that is flowing is
   failing.

   So this pane draws what is being reported right now and NAMES the rest as
   missing. A tile reading zero and a tile with no pipeline behind it look
   identical, and on a pane whose whole job is to say whether anything is
   wrong, the confident reading is the wrong one.

   MOVING, NOT CLEARING, OR UNREADABLE — AND WHAT THE RECORD CAN ACTUALLY PROVE

   A queue that is draining and a queue that is not are different facts with
   different fixes, and an operator sent to the wrong one wastes the only time
   that matters. The pane never collapses them into a single "needs attention".

   `queue_backlog_age` records the age of the OLDEST QUEUED JOB for a request
   type, in seconds ("Oldest queued job age, per request type"). A problem also
   carries when the queue first crossed the line (firstBreachedAt) and when it
   was last measured (lastObservedAt). Let

     oldest = observedValue, the age of the job at the front of the queue
     span   = lastObservedAt - firstBreachedAt, how long it has been over the
              line

   then

     oldest <  span   the job at the front arrived AFTER the breach began.
                      Everything the queue was holding when it crossed the line
                      has therefore left it — a job older than the front cannot
                      still be queued — and what is waiting now arrived after
                      that: MOVING, BEHIND.

     oldest >= span   the front arrived at or before the breach began, so
                      nothing queued since then has reached the front and the
                      job at the front of that backlog is still waiting:
                      NOT CLEARING.

   Neither reading is a rate, and neither is a statement about the whole queue.

   NOT CLEARING does not prove the front has not moved. A burst that all
   arrived before the breach can drain one job at a time and satisfy
   oldest >= span the whole way, because each new front is still older than the
   breach — so most of that backlog can be gone. What is left is the
   existential: the job now at the front was already waiting when the line was
   crossed, and still is.

   MOVING, BEHIND does not prove work is arriving faster than it leaves. One
   sample of one age counts nothing and times nothing, so a queue that shrank
   from five jobs to one and then stalled for seven minutes still reads this
   way. What is left is that the queue turned over during the breach — jobs
   left it, because the ones it held are no longer in it — and that everything
   in it now arrived after the line was crossed. "Left it" is also as far as it
   goes: a job leaves a queue by being cancelled, expired or permanently failed
   as well as by succeeding, and these two numbers cannot tell those apart.

   The unit is one reason the verdict can be unavailable. It lives on the rules
   read and not on the problem, which is the same reason the Problems pane
   prints no observed figure without it: a bare 620 beside a threshold of "over
   10 minutes" is worse than saying nothing. A span of zero is another: two
   readings taken at the same instant leave no elapsed time for either statement
   to be about. Where the unit, the observation, the breach start or the elapsed
   time is missing, the pane says the verdict cannot be read. It does not guess,
   and it does not fall back to the more alarming of the two.

   A third fact sits beside those two and is neither: `ai_success_rate` firing
   means work is flowing and failing. Nothing is waiting; the answers are
   coming back wrong. It is drawn as its own thing.

   WHEN T IS, AND WHEN IT IS NOT NOW

   Every figure on this pane is a statement about the last observation that was
   OVER THE LINE. Call that time T. A pane called "Happening now" presents each
   of them as a statement about now, so the step from "at T" to "now" needs a
   reason, and there is exactly one field that supplies it.

   The engine does not close a problem when its condition stops. On the first
   non-breaching check it records a recovery and sets conditionClearedAt, and
   the problem STAYS OPEN until a person closes it
   (opsAlertLifecycle.ts record_recovery -> opsAlertRepository.setConditionCleared,
   which writes conditionClearedAt and nothing else). observedValue and
   lastObservedAt are written only by refreshProblem, and refreshProblem runs
   only on a breaching observation. So after recovery both figures are frozen
   at T and T stops advancing, while `status=open` — the route maps it to open
   AND acknowledged and never looks at conditionClearedAt — keeps returning the
   problem indefinitely.

   That is the ordinary state of every incident between "it stopped" and "a
   human closed it", which on a small team is hours. Drawn in the present tense
   it says a queue that recovered forty minutes ago is not clearing, with an
   oldest-wait figure that has not been true since T.

   So conditionClearedAt is read FIRST, ahead of the arithmetic above, and a
   problem carrying it is drawn in the past tense: the verdict becomes STOPPED,
   the two figures keep their values but get past-tense labels, the row says
   when it stopped, and the "Oldest job waiting" tile excludes it rather than
   quoting a wait nobody is doing. This matches the Problems pane, which has
   said "Stopped <ago>" against conditionClearedAt since before this pane
   existed; the two must not disagree about the same record.

   The remaining gap is honest and named: T is the last BREACHING sample, so
   while a problem is still going the figures are as fresh as the last check
   and no fresher. The pane draws lastObservedAt-derived spans, not wall-clock
   ones, so it never inflates a wait past what was measured.

   WHAT THIS PANE READS

     GET /api/ops/alerts/problems ?status=open&limit=100
       -> { data: { problems[], summary } }

       `status=open` is the route's own word for open AND acknowledged, and it
       excludes `pending` — a problem that has not held for its duration is not
       yet something a person should be looking at. It is NOT a filter on
       whether the condition is still happening: see WHEN T IS above, and
       conditionClearedAt on each problem, which is.

     GET /api/ops/alerts/rules
       -> { data: { rules[], summary, channels[] } }

       Read for two things: the threshold UNIT, without which an observed
       figure cannot be turned into a duration or a percentage, and the armed
       proof — whether anything was in a position to notice. Nothing being
       reported is only good news if the watchers answered, so this read is the
       difference between an idle night and an outage nobody is measuring. Its
       failure degrades the pane rather than emptying it.

   THE FILTER BAR

   The registry gives this pane an app control and an environment control, and
   no window at all, because the answer is "now". Neither of the two it does
   give can act on the read:

     app scope     the record is kept per request type, not per app, so no
                   selection narrows it. The pane says so
     environment   there is no staging alerting record. Staging is refused
                   rather than answered with production figures

   NO CONTROL THAT CANNOT SUCCEED. The approved mock draws Cancel, Retry and
   Export buttons. Nothing serves a route behind any of them, and PR #58
   settled that a control an operator cannot complete is worse than no control:
   it says the thing is within reach. They are named in the band of what this
   pane cannot do yet instead. */

(function (global) {
  'use strict';

  var S = global.OpsPaneShell;
  var model = global.OpsAlertsModel;
  var session = global.OpsSession;
  var h = S.h;
  var icon = S.icon;
  var fmt = S.fmt;

  var PROBLEMS_ENDPOINT = '/api/ops/alerts/problems';
  var RULES_ENDPOINT = '/api/ops/alerts/rules';

  /* The two rules the server itself points at this pane. Anything else that is
     open belongs to another pane and is drawn as a doorway, not as a figure. */
  var QUEUE_RULE = 'queue_backlog_age';
  var FAILING_RULE = 'ai_success_rate';

  var HISTORY_FILE = 'run-history.html';
  var ALERTS_FILE = 'alerts.html';

  /* Ported from the v1 panes' formatter rather than re-invented, so a wait
     reads the same here as it does in the Problems drawer. */
  function waited(seconds) {
    if (!fmt.isNum(seconds) || seconds < 0) return fmt.none;
    if (seconds < 60) return (seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)) + 's';
    var m = Math.floor(seconds / 60);
    var s = Math.round(seconds % 60);
    if (m < 60) return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
    var hrs = Math.floor(m / 60);
    return hrs + 'h ' + (m % 60) + 'm';
  }

  /* Anything that looks like a contact detail, replaced before it reaches the
     DOM. This pane prints service facts — a rule title, a request type — and
     none of them is a person. That is a property of today's payload rather
     than a promise it makes, so the pane enforces it instead of trusting it.

     The replacement names the kind of thing it hid rather than deleting it
     silently: an operator reading a sentence with a hole in it needs to know a
     hole is what they are looking at. */
  var EMAIL = /[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/g;

  function coded(text) {
    if (typeof text !== 'string' || !text) return '';
    return text.replace(EMAIL, '[hidden contact detail]');
  }

  /* A figure is a number only when it is one. Everything else renders words:
     a zero and an absence look identical once they are set in the same type,
     and on this pane the absence is the more dangerous of the two. */
  function figureValue(figure) {
    if (figure.availability !== 'ready') return { text: figure.words, words: true };
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
      body.appendChild(h('div', { className: 'kpi-meta' }, [h('span', { text: figure.note })]));
    }
    box.appendChild(body);
    return box;
  }

  /* --------------------------------------- moving, not clearing, unreadable */

  function ruleFor(rules, ruleKey) {
    var list = (rules && rules.rules) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].ruleKey === ruleKey) return list[i];
    }
    return null;
  }

  /* The observed figure in seconds, or null. Gated on the rule's own unit:
     the problem carries a bare number, and a number whose unit is a guess is
     not a reading. */
  function observedSeconds(problem, rule) {
    if (!rule || rule.thresholdUnit !== 'seconds') return null;
    if (!fmt.isNum(problem.observedValue) || problem.observedValue < 0) return null;
    return problem.observedValue;
  }

  /* How long the queue has been over the line, in seconds, or null. Both ends
     have to be real times and the second has to be after the first: a span
     measured from a missing start is not a span, and a span of zero is two
     readings taken at the same instant, which supports no statement about what
     happened between them. */
  function breachSeconds(problem) {
    var began = model.oldest([problem.firstBreachedAt]);
    var measured = model.latest([problem.lastObservedAt]);
    if (began === Infinity || measured === -Infinity) return null;
    var span = (measured - began) / 1000;
    return span > 0 ? span : null;
  }

  /* When the condition stopped, or null while it is still going. This is the
     one field that decides whether anything else on the row is present tense,
     which is why it is read before the arithmetic and not after it: see WHEN
     T IS, AND WHEN IT IS NOT NOW in the docblock. */
  function clearedAt(problem) {
    var when = model.latest([problem.conditionClearedAt]);
    return when === -Infinity ? null : when;
  }

  /* One of four answers, never two of them merged. 'stopped' comes first
     because a cleared condition makes the other three unaskable: both of them
     are statements about a queue that is over the line, and this one is not
     any more. 'unknown' is a real answer too and is drawn as words: told the
     backlog is not clearing when the truth is unreadable, an operator goes
     looking for a queue that is working. */
  function movement(problem, rule) {
    var oldest = observedSeconds(problem, rule);
    var span = breachSeconds(problem);
    var cleared = clearedAt(problem);
    if (cleared !== null) {
      return { state: 'stopped', oldest: oldest, span: span, cleared: cleared };
    }
    if (oldest === null || span === null) {
      return { state: 'unknown', oldest: oldest, span: span, cleared: null };
    }
    return {
      state: oldest >= span ? 'holding' : 'behind',
      oldest: oldest,
      span: span,
      cleared: null
    };
  }

  /* The sentences say only what two numbers can carry. 'holding' is not a
     claim that the front has not moved — see the docblock — it is a claim that
     nothing queued since the breach has reached it. */
  var MOVEMENT = {
    holding: {
      label: 'Not clearing',
      tone: 'down',
      sentence: 'Work that was already waiting when this queue went over the line is still ' +
        'waiting. Nothing queued since has reached the front.'
    },
    behind: {
      label: 'Moving, behind',
      tone: 'warn',
      sentence: 'Everything this queue was holding when it went over the line has since left ' +
        'it. What is waiting now arrived after that.'
    },
    unknown: {
      label: 'Cannot tell',
      tone: 'ghost',
      sentence: 'Whether this queue is clearing cannot be read from what was recorded, so it ' +
        'is not being guessed at.'
    },
    stopped: {
      label: 'Stopped',
      tone: 'ghost',
      sentence: 'This queue is no longer over the line. The readings beside it are from when ' +
        'it was, and it is still on this page because closing a problem is somebody\'s ' +
        'decision rather than the engine\'s.'
    }
  };

  function queueProblems(problems) {
    return problems.filter(function (problem) { return problem.ruleKey === QUEUE_RULE; });
  }

  function failingProblems(problems) {
    return problems.filter(function (problem) { return problem.ruleKey === FAILING_RULE; });
  }

  function elsewhereProblems(problems) {
    return problems.filter(function (problem) {
      return problem.ruleKey !== QUEUE_RULE && problem.ruleKey !== FAILING_RULE;
    });
  }

  /* Still going first, then worst, then the one that has been over the line
     longest. A queue that has stopped goes below every queue that has not,
     whatever its severity: severity is how bad it was, and a critical row that
     recovered is not more urgent than a warning row that is still going. At
     equal standing a queue that has been over the line for an hour outranks
     one that crossed it a minute ago. */
  function worstFirst(rows) {
    return rows.slice().sort(function (a, b) {
      var byLive = (a.movement.state === 'stopped' ? 1 : 0) -
        (b.movement.state === 'stopped' ? 1 : 0);
      if (byLive) return byLive;
      var bySeverity = model.severityRank(a.problem.severity) -
        model.severityRank(b.problem.severity);
      if (bySeverity) return bySeverity;
      var aSpan = a.movement && a.movement.span !== null ? a.movement.span : -1;
      var bSpan = b.movement && b.movement.span !== null ? b.movement.span : -1;
      return bSpan - aSpan;
    });
  }

  /* ------------------------------------------------------------- the pane */

  S.definePane('jobs', function (content) {
    var region = S.region(content);
    var loadToken = 0;
    var current = S.filters();

    global.addEventListener('ops:filters', function (event) {
      var next = event.detail;
      var changed = next.scope !== current.scope || next.env !== current.env;
      current = next;
      if (changed) load();
    });

    function load() {
      var token = ++loadToken;
      var selection = current;

      /* Staging is refused before the read rather than after it. There is one
         alerting record and it is production's, so a staging selection has no
         answer at all, and answering it with production figures would be the
         quietest possible way to mislead somebody. */
      if (selection.env !== 'production') {
        region.empty(noStagingRecord(selection.env));
        return;
      }

      region.loading([
        { type: 'block', height: 62 },
        { type: 'tiles', count: 4 },
        { type: 'rows', count: 5 }
      ]);

      Promise.all([
        problems(),
        session.call(RULES_ENDPOINT).then(function (payload) {
          return { data: payload.data };
        }, function (err) {
          return { error: err };
        })
      ]).then(function (results) {
        if (token !== loadToken) return;
        render(results[0], results[1], selection);
      }).catch(function (err) {
        if (token !== loadToken) return;
        region.failed(err, load);
      });
    }

    /* Through the shell's loader, so the same-origin fixture hook covers the
       states a live API will not produce on demand: a quiet system, a queue
       that is not clearing, a system with nothing watching it.

       status 'open' is the route's word for open and acknowledged. This pane
       is the present tense: a problem somebody closed on Tuesday belongs to
       What happened, not here. */
    function problems() {
      return S.read({
        paneId: 'jobs',
        endpoint: PROBLEMS_ENDPOINT,
        query: { status: 'open', limit: model.PAGE }
      }).then(function (result) { return result.data; });
    }

    function render(record, rules, selection) {
      var open = (record && record.problems) || [];
      var capped = model.capped(open);
      var armed = rules.error ? null : model.armedState(rules.data || {});
      var queueRule = rules.error ? null : ruleFor(rules.data, QUEUE_RULE);
      var failingRule = rules.error ? null : ruleFor(rules.data, FAILING_RULE);

      var queues = worstFirst(queueProblems(open).map(function (problem) {
        return { problem: problem, movement: movement(problem, queueRule) };
      }));
      var failing = failingProblems(open);
      var elsewhere = elsewhereProblems(open);

      if (!open.length) {
        region.empty(nothingReported(armed));
        return;
      }

      var wrap = h('div', { className: 'stack' });
      wrap.appendChild(hero(queues, failing, elsewhere));
      selectionNotes(selection, capped).forEach(function (note) { wrap.appendChild(note); });
      wrap.appendChild(rightNow(open, queues, capped));
      wrap.appendChild(watchingCard(armed));
      if (queues.length) wrap.appendChild(queueBand(queues, queueRule));
      if (failing.length) wrap.appendChild(failingBand(failing, failingRule));
      if (elsewhere.length) wrap.appendChild(elsewhereBand(elsewhere));
      wrap.appendChild(missingBand());

      if (rules.error) region.degraded(wrap);
      else region.show(wrap);
    }

    /* ---------------------------------------------------------- refusals */

    function noStagingRecord(env) {
      var box = S.card();
      box.appendChild(S.stateBlock('layers', 'There is no ' + env + ' record here', [
        'The alerting watches production and only production, so there is no ' + env +
          ' queue to report on. Nothing is being withheld: the record does not exist.',
        'Switch the environment control back to Production to see what is happening there.'
      ]));
      return box;
    }

    /* Nothing is being reported. Whether that is a quiet system or a system
       nothing is watching is the whole question, so it is what the state
       answers. An empty queue is only good news if the watchers replied. */
    function nothingReported(armed) {
      var box = S.card();
      var block;

      if (armed && armed.trustworthy) {
        var lastRun = fmt.utcStamp(armed.lastEvaluatedAt);
        block = S.stateBlock('check', 'Nothing is being reported right now', [
          armed.checking + ' of ' + armed.total + ' rules were checking, and none of them ' +
            'reached a verdict worth raising' + (lastRun ? ', last at ' + lastRun : '') + '.',
          'That covers the queue and the runs. It does not count jobs: nothing serves a ' +
            'job list to this page, so an idle night and a worker that stopped picking work ' +
            'up would look the same here if the rules were not answering.'
        ]);
      } else if (armed) {
        block = S.stateBlock('warn', 'Nothing is being reported, and nothing is watching', [
          'None of the ' + armed.total + ' rules reached a verdict the last time they ran, ' +
            'so an empty page here is not the same as a quiet system.',
          'This is the silence to go and fix rather than the one to take comfort from.'
        ]);
      } else {
        block = S.stateBlock('warn', 'Nothing is being reported right now', [
          'The rules could not be read, so whether anything was watching is unknown. An ' +
            'empty page cannot be read as a quiet system until that answers.',
          'Everything else on this page came back.'
        ]);
      }

      var row = h('div', { className: 'row mt-sm' });
      row.appendChild(S.link(S.paneHref('history') || HISTORY_FILE, 'What happened earlier'));
      block.appendChild(row);
      box.appendChild(block);
      return box;
    }

    /* ------------------------------------------------------------- hero */

    /* The one sentence somebody reads before they decide whether to put their
       coffee down. Not clearing outranks behind, behind outranks failing, and
       all three outrank a problem that belongs to another pane, because that
       is the order in which they cost an athlete something. */
    function hero(queues, failing, elsewhere) {
      var holding = queues.filter(function (row) { return row.movement.state === 'holding'; });
      var behind = queues.filter(function (row) { return row.movement.state === 'behind'; });
      var unreadable = queues.filter(function (row) { return row.movement.state === 'unknown'; });
      var stillFailing = failing.filter(function (problem) {
        return clearedAt(problem) === null;
      });
      var stillElsewhere = elsewhere.filter(function (problem) {
        return clearedAt(problem) === null;
      });
      /* Every open problem whose condition has stopped, across all three
         groups. The three groups partition the open list by ruleKey, so when
         nothing above matches, this is the whole of it. */
      var stopped = queues.length + failing.length + elsewhere.length -
        queues.filter(function (row) { return row.movement.state !== 'stopped'; }).length -
        stillFailing.length - stillElsewhere.length;

      var tone = 'st-acc';
      var title = '';
      var sub = '';

      if (holding.length) {
        tone = 'st-bad';
        title = holding.length === 1
          ? coded(holding[0].problem.scopeLabel || 'A queue') + ' is not clearing'
          : holding.length + ' queues are not clearing';
        sub = 'Work that was already waiting when ' + (holding.length === 1 ? 'it' : 'they') +
          ' went over the line is still waiting.';
      } else if (behind.length) {
        tone = 'st-warn';
        title = behind.length === 1
          ? coded(behind[0].problem.scopeLabel || 'A queue') + ' is behind'
          : behind.length + ' queues are behind';
        sub = 'Everything ' + (behind.length === 1 ? 'it was' : 'they were') +
          ' holding when the line was crossed has since left. What is waiting now arrived ' +
          'after that.';
      } else if (unreadable.length) {
        tone = 'st-warn';
        title = unreadable.length === 1
          ? coded(unreadable[0].problem.scopeLabel || 'A queue') + ' is over the line'
          : unreadable.length + ' queues are over the line';
        sub = 'Whether ' + (unreadable.length === 1 ? 'it is' : 'they are') +
          ' clearing cannot be read from what was recorded.';
      } else if (stillFailing.length) {
        tone = 'st-bad';
        title = stillFailing.length === 1
          ? coded(stillFailing[0].scopeLabel || 'Aria runs') + ' are failing'
          : stillFailing.length + ' request types are failing';
        sub = 'Nothing is waiting. The work is flowing and the answers are coming back wrong.';
      } else if (stillElsewhere.length) {
        tone = 'st-warn';
        title = stillElsewhere.length === 1
          ? 'One problem is going, and it is not the queue'
          : stillElsewhere.length + ' problems are going, and none is the queue';
        sub = 'Nothing is queueing and nothing is failing. What is still going belongs to ' +
          'another pane, and each one below says which.' + (stopped
            ? ' The rest have stopped and are waiting to be closed.'
            : '');
      } else {
        /* Nothing is happening now, and that is the answer somebody paged an
           hour ago came here for. It is not the all-clear: the engine never
           closes a problem itself, so these are waiting on a person to say
           which of "we fixed it" and "it went away" happened. */
        tone = 'st-ok';
        title = stopped === 1
          ? 'It has stopped, and nobody has closed it'
          : stopped + ' have stopped, and nobody has closed them';
        sub = 'Nothing is over the line now. What is below stopped on its own and stays open ' +
          'until somebody says which of "we fixed it" and "it went away" happened.';
      }

      var section = h('section', { className: 'hero ' + tone });
      section.appendChild(h('div', { className: 'hero-orb', 'aria-hidden': 'true' }, [
        h('i'), h('i'), h('b')
      ]));
      section.appendChild(h('div', {}, [
        h('h2', { className: 'hero-title', text: title }),
        h('p', { className: 'hero-sub', text: sub })
      ]));
      return section;
    }

    /* ------------------------------------------------ selection honesty */

    function selectionNotes(selection, capped) {
      var notes = [];

      if (selection.scope !== 'all') {
        notes.push(noteLine('info',
          'The record is kept per request type, not per app, so the app filter does not ' +
          'narrow anything below. Everything here covers both Mobile and Coaches Web.'));
      }

      if (capped) {
        notes.push(noteLine('warn',
          'A full page of open problems came back, worst first. Less severe ones can be ' +
          'missing from it, so every count below is a floor rather than a total.'));
      }

      return notes;
    }

    function noteLine(iconName, text) {
      var note = h('div', { className: 'note' });
      note.appendChild(icon(iconName));
      note.appendChild(h('div', { text: text }));
      return note;
    }

    /* --------------------------------------------------------- right now */

    function rightNow(open, queues, capped) {
      var section = S.band('Right now', 'What is being reported this minute');
      var grid = h('div', { className: 'grid g4' });

      var needing = model.needingAction(open).length;
      var takenOn = model.takenOn(open).length;

      grid.appendChild(figureCard({
        label: 'Needs a person',
        availability: 'ready',
        text: model.atLeast(fmt.int(needing), capped),
        note: needing ? 'open, nobody on it yet' : 'nothing open without somebody on it'
      }));

      grid.appendChild(figureCard({
        label: 'Somebody is on it',
        availability: 'ready',
        text: model.atLeast(fmt.int(takenOn), capped),
        note: takenOn ? 'taken on, still not closed' : 'nothing taken on'
      }));

      grid.appendChild(figureCard(oldestWaitFigure(queues)));

      /* The mock's headline figure. Nothing serves a job list, so it stays on
         the page as words: an operator who does not know a figure is missing
         reads its absence as a zero. */
      grid.appendChild(figureCard({
        label: 'Jobs running',
        availability: 'unrecorded',
        words: 'Not recorded',
        note: 'no route serves a job list yet'
      }));

      section.appendChild(grid);
      return section;
    }

    /* The longest any job is known to have been waiting. Known only while a
       queue is over the line: the alerting records the oldest job's age when
       it breaches and at no other time, so below the threshold this is an
       absence rather than a zero, and it says which. */
    function oldestWaitFigure(queues) {
      /* A stopped queue's figure is the age at its last breaching sample, not
         a wait anybody is doing now, so it cannot be the answer to "what is
         the longest wait". Excluded here rather than clamped: the tile has an
         absence to say and it should say it. */
      var live = queues.filter(function (row) { return row.movement.state !== 'stopped'; });
      var readable = live.filter(function (row) { return row.movement.oldest !== null; });

      if (!live.length) {
        return {
          label: 'Oldest job waiting',
          availability: 'unrecorded',
          words: 'Not over the line',
          /* Queue-scoped, deliberately: this figure is built from the queue
             rows alone and cannot see the failing or elsewhere groups, so a
             note about what is "open below" would be false whenever one of
             those is still going. The hero is the thing that speaks for the
             whole page. */
          note: queues.length
            ? 'no queue is over the line now; the queues below have stopped'
            : 'the wait is only recorded while a queue is breaching'
        };
      }

      if (!readable.length) {
        return {
          label: 'Oldest job waiting',
          availability: 'unrecorded',
          words: 'Cannot be read',
          note: 'the observation or its unit did not come back'
        };
      }

      var longest = readable.reduce(function (worst, row) {
        return row.movement.oldest > worst.movement.oldest ? row : worst;
      });

      return {
        label: 'Oldest job waiting',
        availability: 'ready',
        text: waited(longest.movement.oldest),
        note: 'in ' + coded(longest.problem.scopeLabel || 'a request type')
      };
    }

    /* Whether anything is in a position to notice. On this pane it is
       structural rather than decorative: everything above is what the rules
       caught, and a rule that is not answering catches nothing. */
    function watchingCard(armed) {
      if (!armed) {
        return noteLine('warn',
          'The rules could not be read, so how much of this is actually being watched is ' +
          'unknown. What is above is what was reported, not necessarily what is happening.');
      }

      if (!armed.trustworthy) {
        return noteLine('warn',
          'None of the ' + armed.total + ' rules reached a verdict the last time they ran, ' +
          'so nothing here is being watched now. What is above is what was caught before ' +
          'that.');
      }

      var lastRun = fmt.utcStamp(armed.lastEvaluatedAt);
      return noteLine('info',
        armed.checking + ' of ' + armed.total + ' rules were checking' +
        (lastRun ? ', last at ' + lastRun : '') +
        (armed.insufficientData
          ? '. ' + armed.insufficientData + ' had too little data to judge.'
          : '.'));
    }

    /* --------------------------------------------------------- the queues */

    function queueBand(queues, queueRule) {
      var anyStopped = queues.some(function (row) {
        return row.movement.state === 'stopped';
      });
      var section = S.band('Waiting, and whether it is clearing',
        'The front of the queue, per request type' + (anyStopped
          ? '. Rows that have stopped are last.'
          : ''));
      var box = S.card();
      var body = h('div', { className: 'card-body col' });

      queues.forEach(function (row) { body.appendChild(queueRow(row)); });
      box.appendChild(body);

      var foot = h('div', { className: 'card-foot' });
      foot.appendChild(h('span', {
        text: queueRule && queueRule.thresholdLabel
          ? 'The line is ' + coded(queueRule.thresholdLabel) + '.'
          : 'The threshold did not come back, so the line these crossed is not shown.'
      }));
      foot.appendChild(S.link(S.paneHref('alerts') || ALERTS_FILE, 'Open Problems', 'btn btn-sm sp'));
      box.appendChild(foot);

      section.appendChild(box);
      return section;
    }

    function queueRow(row) {
      var problem = row.problem;
      var verdict = MOVEMENT[row.movement.state];

      var line = h('div', { className: 'queue-row' });

      var words = h('div', { className: 'queue-words' });
      words.appendChild(h('div', {
        className: 't-main',
        text: coded(problem.scopeLabel || 'Every request type')
      }));
      words.appendChild(h('div', { className: 't-sub', text: verdict.sentence }));
      line.appendChild(words);

      /* Past tense for a queue that has stopped, because both figures froze
         when it did: the engine writes observedValue and lastObservedAt only
         on a BREACHING observation, so "oldest" is the age at the last sample
         that was over the line and "over the line" stops growing there. Drawn
         with a live label they are a measurement of now that nobody took. */
      var stopped = row.movement.state === 'stopped';
      var facts = h('div', { className: 'queue-facts' });
      facts.appendChild(factPill('clock', stopped ? 'oldest when it stopped' : 'oldest',
        row.movement.oldest === null ? 'not readable' : waited(row.movement.oldest)));
      facts.appendChild(factPill('history', stopped ? 'was over the line' : 'over the line',
        row.movement.span === null ? 'not readable' : waited(row.movement.span)));
      if (stopped) {
        facts.appendChild(factPill('check', 'stopped', fmt.ago(problem.conditionClearedAt)));
      }
      line.appendChild(facts);

      /* The verdict carries its words as well as its tone: a screen that is
         read rather than looked at says the same thing. */
      var state = h('div', { className: 'queue-state' });
      state.appendChild(h('span', {
        className: 'pill ' + verdict.tone,
        text: verdict.label
      }));
      if (problem.status === 'acknowledged') {
        state.appendChild(h('span', { className: 'pill ghost', text: 'somebody is on it' }));
      }
      line.appendChild(state);

      return line;
    }

    function factPill(iconName, label, value) {
      var pill = h('span', { className: 'pill ghost' });
      pill.appendChild(icon(iconName));
      pill.appendChild(h('span', { text: label + ' ' + value }));
      return pill;
    }

    /* -------------------------------------------------------- failing now */

    function failingBand(failing, failingRule) {
      var section = S.band('Flowing, and failing', 'Nothing is waiting for these');
      var box = S.card();
      var body = h('div', { className: 'card-body col' });

      failing.forEach(function (problem) {
        var cleared = clearedAt(problem);
        var line = h('div', { className: 'queue-row' });

        var words = h('div', { className: 'queue-words' });
        words.appendChild(h('div', {
          className: 't-main',
          text: coded(problem.scopeLabel || 'Every request type')
        }));
        words.appendChild(h('div', {
          className: 't-sub',
          text: cleared === null
            ? 'Work is being picked up and the answers are coming back wrong. This is not ' +
              'a queue: nothing is waiting.'
            : 'The answers were coming back wrong and are not any more. The figure beside ' +
              'this is from when they were.'
        }));
        line.appendChild(words);

        var facts = h('div', { className: 'queue-facts' });
        var observed = failingRule && failingRule.thresholdUnit === 'basis_points' &&
          fmt.isNum(problem.observedValue) && problem.observedValue >= 0
          ? fmt.percent(problem.observedValue)
          : null;
        facts.appendChild(factPill('check',
          cleared === null ? 'finishing cleanly' : 'was finishing cleanly',
          observed === null ? 'not readable' : observed));
        if (cleared !== null) {
          facts.appendChild(factPill('history', 'stopped', fmt.ago(problem.conditionClearedAt)));
        }
        line.appendChild(facts);

        /* Severity keeps its own tone whether or not the condition has
           stopped, and the condition is stated separately beside it. That is
           how the Problems pane draws the same record — a severity pill at
           pane-alerts.js:1031 and a Condition of "Stopped <ago>" or "Still
           happening" at :1080 — and how the elsewhere band below draws it.
           Severity is how bad it is rated, not a claim about the present. */
        var state = h('div', { className: 'queue-state' });
        state.appendChild(h('span', {
          className: 'pill ' + (model.SEVERITY_TONE[problem.severity] === 'crit' ? 'down' : 'warn'),
          text: model.SEVERITY_LABEL[problem.severity] || 'Unrated'
        }));
        if (cleared !== null) {
          state.appendChild(h('span', { className: 'pill ghost', text: 'Stopped' }));
        }
        line.appendChild(state);

        body.appendChild(line);
      });

      box.appendChild(body);

      var foot = h('div', { className: 'card-foot' });
      foot.appendChild(h('span', {
        text: failingRule && failingRule.thresholdLabel
          ? 'The line is ' + coded(failingRule.thresholdLabel) + '.'
          : 'The threshold did not come back, so the line these crossed is not shown.'
      }));
      foot.appendChild(S.link(S.paneHref('history') || HISTORY_FILE,
        'Why they failed', 'btn btn-sm sp'));
      box.appendChild(foot);

      section.appendChild(box);
      return section;
    }

    /* ------------------------------------------------------ everything else */

    /* Open problems that are not about this pane. They are listed because an
       operator standing here should not have to go looking to find out
       something else is on fire, and each one names the pane that owns it
       rather than pretending the work happens here. */
    function elsewhereBand(elsewhere) {
      var section = S.band('Open elsewhere', 'Not the queue, and not this pane');
      var box = S.card();
      var body = h('div', { className: 'card-body col' });

      elsewhere.forEach(function (problem) {
        var line = h('div', { className: 'queue-row' });

        var words = h('div', { className: 'queue-words' });
        words.appendChild(h('div', {
          className: 't-main',
          text: coded(problem.ruleTitle || problem.ruleKey || 'Unnamed rule')
        }));
        words.appendChild(h('div', {
          className: 't-sub',
          text: coded(problem.scopeLabel || 'Every request type')
        }));
        line.appendChild(words);

        var facts = h('div', { className: 'queue-facts' });
        facts.appendChild(h('span', {
          className: 'pill ' + (model.SEVERITY_TONE[problem.severity] === 'crit' ? 'down' : 'warn'),
          text: model.SEVERITY_LABEL[problem.severity] || 'Unrated'
        }));
        if (clearedAt(problem) !== null) {
          facts.appendChild(factPill('check', 'stopped', fmt.ago(problem.conditionClearedAt)));
        }
        line.appendChild(facts);

        var state = h('div', { className: 'queue-state' });
        var file = model.PANE_FILE[problem.workPane];
        if (file && problem.workPane !== 'jobs-live') {
          state.appendChild(S.link(S.paneHref(paneKey(problem.workPane)) || file,
            problem.workPaneLabel || 'Where the work is', 'btn btn-sm'));
        } else {
          state.appendChild(S.link(S.paneHref('alerts') || ALERTS_FILE, 'Open Problems', 'btn btn-sm'));
        }
        line.appendChild(state);

        body.appendChild(line);
      });

      box.appendChild(body);
      section.appendChild(box);
      return section;
    }

    /* The server names panes in its own words. This is the one place the two
       vocabularies meet. */
    var PANE_KEY = {
      overview: 'overview',
      'jobs-live': 'jobs',
      'run-history': 'history',
      spend: 'spend',
      releases: 'releases'
    };

    function paneKey(workPane) {
      return PANE_KEY[workPane] || null;
    }

    /* ------------------------------------------------- what is not here */

    /* Named rather than drawn as an empty figure, and named as the thing that
       is missing rather than as a feature that is coming. */
    function missingBand() {
      var section = S.band('What this pane cannot answer yet',
        'Named rather than drawn as an empty figure');
      var box = S.card();
      var body = h('div', { className: 'card-body omit' });

      [
        ['The jobs themselves',
          'No route lists jobs, so there is no per-job table, no lane, no age per job and ' +
            'no retry count. What is above is what a rule reported, which is a narrower thing.'],
        ['How many are running or queued',
          'Nothing serves a count of either. A tile reading zero and a tile with nothing ' +
            'behind it look identical, so neither is drawn.'],
        ['Cancel, retry and export',
          'The approved design offers all three. Nothing serves a route behind any of them, ' +
            'and a control that cannot succeed says the thing is within reach.']
      ].forEach(function (entry) {
        var item = h('div', { className: 'omit-item' });
        item.appendChild(icon('layers'));
        var words = h('div');
        words.appendChild(h('div', { className: 'omit-title', text: entry[0] }));
        words.appendChild(h('div', { className: 'omit-desc', text: entry[1] }));
        item.appendChild(words);
        body.appendChild(item);
      });

      box.appendChild(body);

      var foot = h('div', { className: 'card-foot' });
      foot.appendChild(h('span', {
        text: 'This page does not refresh itself. What is above is a reading, not a feed.'
      }));
      box.appendChild(foot);

      section.appendChild(box);
      return section;
    }

    load();
  });
})(window);
