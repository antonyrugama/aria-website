/* Happening now: what is Aria working on, and is anything stuck?

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

   WORKING, BEHIND, OR STUCK — AND HOW THE PANE CAN TELL

   A job that is merely slow and a job that is wedged are different facts with
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

     oldest >= span   the job at the front was already waiting when the breach
                      began. Nothing has left the front of that queue in the
                      whole time it has been over the line: STUCK.

     oldest <  span   the job at the front arrived after the breach began, so
                      the queue has drained past its old front at least once.
                      Work is leaving; it is arriving faster: BEHIND.

   The unit is the reason the verdict can be unavailable. It lives on the rules
   read and not on the problem, which is the same reason the Problems pane
   prints no observed figure without it: a bare 620 beside a threshold of "over
   10 minutes" is worse than saying nothing. Where the unit, the observation or
   the breach start is missing, the pane says the verdict cannot be read. It
   does not guess, and it does not fall back to the more alarming of the two.

   A third fact sits beside those two and is neither: `ai_success_rate` firing
   means work is flowing and failing. Nothing is waiting; the answers are
   coming back wrong. It is drawn as its own thing.

   WHAT THIS PANE READS

     GET /api/ops/alerts/problems ?status=open&limit=100
       -> { data: { problems[], summary } }

       `status=open` is the route's own word for open AND acknowledged, and it
       excludes `pending` — a problem that has not held for its duration is not
       yet something a person should be looking at. That is exactly the present
       tense this pane wants.

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

  /* ------------------------------------------------ working, behind, stuck */

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
    return fmt.isNum(problem.observedValue) ? problem.observedValue : null;
  }

  /* How long the queue has been over the line, in seconds, or null. Both ends
     have to be real times: a span measured from a missing start is not a
     span. */
  function breachSeconds(problem) {
    var began = model.oldest([problem.firstBreachedAt]);
    var measured = model.latest([problem.lastObservedAt]);
    if (began === Infinity || measured === -Infinity) return null;
    var span = (measured - began) / 1000;
    return span >= 0 ? span : null;
  }

  /* One of three answers, never two of them merged. 'unknown' is a real
     answer here and is drawn as words: told "stuck" when the truth is
     unreadable, an operator restarts workers that were working. */
  function movement(problem, rule) {
    var oldest = observedSeconds(problem, rule);
    var span = breachSeconds(problem);
    if (oldest === null || span === null) {
      return { state: 'unknown', oldest: oldest, span: span };
    }
    return { state: oldest >= span ? 'stuck' : 'behind', oldest: oldest, span: span };
  }

  var MOVEMENT = {
    stuck: {
      label: 'Stuck',
      tone: 'down',
      sentence: 'Nothing has left the front of this queue since it went over the line.'
    },
    behind: {
      label: 'Moving, behind',
      tone: 'warn',
      sentence: 'Jobs are completing. They are arriving faster than they leave.'
    },
    unknown: {
      label: 'Cannot tell',
      tone: 'ghost',
      sentence: 'Whether the front of this queue is moving cannot be read from what was ' +
        'recorded, so it is not being guessed at.'
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

  /* Worst first, then the one that has been over the line longest. A queue
     that has been wedged for an hour outranks one that crossed the line a
     minute ago at the same severity. */
  function worstFirst(rows) {
    return rows.slice().sort(function (a, b) {
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
       states a live API will not produce on demand: a quiet system, a wedged
       queue, a system with nothing watching it.

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
       coffee down. Stuck outranks behind, behind outranks failing, and all
       three outrank a problem that belongs to another pane, because that is
       the order in which they cost an athlete something. */
    function hero(queues, failing, elsewhere) {
      var stuck = queues.filter(function (row) { return row.movement.state === 'stuck'; });
      var behind = queues.filter(function (row) { return row.movement.state === 'behind'; });
      var unreadable = queues.filter(function (row) { return row.movement.state === 'unknown'; });

      var tone = 'st-acc';
      var title = '';
      var sub = '';

      if (stuck.length) {
        tone = 'st-bad';
        title = stuck.length === 1
          ? coded(stuck[0].problem.scopeLabel || 'A queue') + ' is stuck'
          : stuck.length + ' queues are stuck';
        sub = 'Nothing has left the front of ' + (stuck.length === 1 ? 'it' : 'them') +
          ' since the queue went over the line.';
      } else if (behind.length) {
        tone = 'st-warn';
        title = behind.length === 1
          ? coded(behind[0].problem.scopeLabel || 'A queue') + ' is behind'
          : behind.length + ' queues are behind';
        sub = 'Jobs are completing. They are arriving faster than they leave.';
      } else if (unreadable.length) {
        tone = 'st-warn';
        title = unreadable.length === 1
          ? coded(unreadable[0].problem.scopeLabel || 'A queue') + ' is over the line'
          : unreadable.length + ' queues are over the line';
        sub = 'Whether the front of ' + (unreadable.length === 1 ? 'it is' : 'them are') +
          ' moving cannot be read from what was recorded.';
      } else if (failing.length) {
        tone = 'st-bad';
        title = failing.length === 1
          ? coded(failing[0].scopeLabel || 'Aria runs') + ' are failing'
          : failing.length + ' request types are failing';
        sub = 'Nothing is waiting. The work is flowing and the answers are coming back wrong.';
      } else {
        tone = 'st-warn';
        title = elsewhere.length === 1
          ? 'One problem is open, and it is not the queue'
          : elsewhere.length + ' problems are open, and none is the queue';
        sub = 'Nothing is queueing and nothing is failing. What is open belongs to ' +
          'another pane, and each one below says which.';
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
      var readable = queues.filter(function (row) { return row.movement.oldest !== null; });

      if (!queues.length) {
        return {
          label: 'Oldest job waiting',
          availability: 'unrecorded',
          words: 'Not over the line',
          note: 'the wait is only recorded while a queue is breaching'
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
      var section = S.band('Waiting, and whether it is moving',
        'The front of the queue, per request type');
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

      var facts = h('div', { className: 'queue-facts' });
      facts.appendChild(factPill('clock', 'oldest', row.movement.oldest === null
        ? 'not readable'
        : waited(row.movement.oldest)));
      facts.appendChild(factPill('history', 'over the line', row.movement.span === null
        ? 'not readable'
        : waited(row.movement.span)));
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
        var line = h('div', { className: 'queue-row' });

        var words = h('div', { className: 'queue-words' });
        words.appendChild(h('div', {
          className: 't-main',
          text: coded(problem.scopeLabel || 'Every request type')
        }));
        words.appendChild(h('div', {
          className: 't-sub',
          text: 'Work is being picked up and the answers are coming back wrong. This is not ' +
            'a queue: nothing is waiting.'
        }));
        line.appendChild(words);

        var facts = h('div', { className: 'queue-facts' });
        var observed = failingRule && failingRule.thresholdUnit === 'basis_points' &&
          fmt.isNum(problem.observedValue)
          ? fmt.percent(problem.observedValue)
          : null;
        facts.appendChild(factPill('check', 'finishing cleanly',
          observed === null ? 'not readable' : observed));
        line.appendChild(facts);

        var state = h('div', { className: 'queue-state' });
        state.appendChild(h('span', {
          className: 'pill ' + (model.SEVERITY_TONE[problem.severity] === 'crit' ? 'down' : 'warn'),
          text: model.SEVERITY_LABEL[problem.severity] || 'Unrated'
        }));
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
