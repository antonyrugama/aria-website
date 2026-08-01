/* Overview: are people using it, is it working, is anything urgent.

   Overview owns no detail. Every figure on it is a doorway into the pane that
   owns the question, which is what stops it becoming the place investigations
   happen. That rule shapes this file more than anything else: nothing here
   renders a table, a facet, or a control that changes a system.

   **What this pane can answer today, and what it says instead of the rest.**

   Of the three questions Overview asks, only "is anything urgent" has anything
   behind it. The problems API is built and serving. The usage, reliability,
   cost and release figures the approved design puts across the top are
   collected but not yet served to a page, so this pane does not draw them.

   It does not draw them as zeroes either, and that is the point. The mocks
   make one rule about this explicit: empty never means zero. A tile reading 0
   active users and a tile whose pipeline is not connected look identical, and
   an operations screen that cannot tell an operator which one it is showing is
   worse than one that shows nothing. So the parts with no source say, in
   words, that they have no source, and name the pane that will own each of
   them.

   The same honesty runs through the status ribbon. "Everything is working" is
   only worth printing when something was in a position to notice that it was
   not, so the ribbon reads the alert rules and degrades to saying the checks
   themselves are not running when that is what is true. */
(function (global) {
  'use strict';

  var shell = global.OpsShell;
  var op = global.OpsOperate;
  var model = global.OpsAlertsModel;
  var session = global.OpsSession;
  var h = shell.h;
  var icon = shell.icon;
  var fmt = op.fmt;

  /* How many problems the needs-attention queue shows before it stops and
     sends the operator to the pane that owns them. Overview is a doorway, not
     a second Problems pane. */
  var QUEUE_LIMIT = 4;

  /* The figures the approved design puts on this pane that nothing serves yet.
     Each names the pane that will own it, so the gap is a signpost rather than
     a hole. */
  var AWAITING = [
    {
      title: 'How many people are using the apps',
      body: 'Active people, sessions, and how that is changing.',
      href: 'analytics.html',
      pane: 'People and usage'
    },
    {
      title: 'How much Aria is doing, and how often it works',
      body: 'Requests by type, how many succeeded, and how long they took.',
      href: 'run-history.html',
      pane: 'What happened'
    },
    {
      title: 'What we are spending',
      body: 'Cloud costs so far this month against the budget.',
      href: 'spend.html',
      pane: 'Cloud costs'
    },
    {
      title: 'Which app version people are on',
      body: 'Version spread across iOS and Android, and whether the newest is healthy.',
      href: 'releases.html',
      pane: 'App releases'
    }
  ];

  shell.definePane('overview', function (content) {
    var region = op.region(content);
    var loadToken = 0;

    /* This pane listens for no filter change, because it offers none. The
       scope, range and environment controls were on the bar while nothing
       could act on them: a request carrying none of the three answered the
       same way whichever was picked, so selecting Staging left production
       figures on screen looking like staging ones. The shell now states in the
       bar that they do not apply here rather than offering a control that
       cannot do what it says. */

    function load() {
      var token = ++loadToken;
      region.loading([
        { type: 'block', height: 78 },
        { type: 'tiles', count: 2 },
        { type: 'rows', count: 4 }
      ]);

      Promise.all([
        session.call('/api/ops/alerts/problems', { query: { status: 'open', limit: model.PAGE } })
          .then(function (p) { return p.data; }),
        session.call('/api/ops/alerts/rules').then(function (p) { return p.data; })
      ]).then(function (results) {
        if (token !== loadToken) return;
        render({ open: results[0], rules: results[1] });
      }).catch(function (err) {
        if (token !== loadToken) return;
        region.failed(err, load);
      });
    }

    function render(data) {
      var armed = model.armedState(data.rules);
      var problems = data.open.problems.slice().sort(model.byWorstThenOldest);
      /* A full read is a floor, not a total: problems come back worst first
         and then oldest and stop at model.PAGE, so every count on this pane is
         "at least" when the page came back full. */
      var capped = model.capped(data.open.problems);

      var wrap = h('div', { className: 'stack' });
      wrap.appendChild(ribbon(problems, armed, capped));
      wrap.appendChild(op.bandHead('What needs a person',
        'Everything here opens the pane that owns the work'));
      wrap.appendChild(queueCard(problems, armed, capped));
      wrap.appendChild(op.bandHead('Not on this page yet',
        'Four figures the design puts here, and where each will land'));
      wrap.appendChild(awaitingCard());
      region.show(wrap);
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
    function ribbon(problems, armed, capped) {
      var active = model.active(problems);
      var needing = model.needingAction(problems);
      var worst = model.worstSeverity(active);

      var card = h('div', { className: 'card ribbon' });
      var grid = h('div', { className: 'ribbon-grid' });

      var state = h('div', { className: 'ribbon-state' });
      var words = h('div');

      if (!armed.trustworthy) {
        state.appendChild(h('span', { className: 'dot dot-warn', 'aria-hidden': 'true' }));
        words.appendChild(h('p', {
          className: 'ribbon-title is-warn', text: 'Nothing is being checked'
        }));
        words.appendChild(h('p', {
          className: 'ribbon-sub is-warn', text: unarmedSentence(armed)
        }));
      } else if (!active.length) {
        state.appendChild(h('span', { className: 'dot dot-live', 'aria-hidden': 'true' }));
        words.appendChild(h('p', { className: 'ribbon-title', text: 'Everything is working' }));
        words.appendChild(h('p', {
          className: 'ribbon-sub',
          text: fmt.int(armed.checking) + ' of ' + fmt.int(armed.total) +
                ' rules are checking' +
                (armed.lastEvaluatedAt
                  ? ', last ' + fmt.ago(armed.lastEvaluatedAt)
                  : '') + '.'
        }));
      } else {
        /* The ribbon takes its tone from the worst thing that is actually
           open. Painting a single informational problem in warning colours
           would make the pane cry wolf, and a pane that cries wolf is a pane
           whose red is ignored the day it means something. */
        var tone = model.SEVERITY_TONE[worst] || 'info';
        state.appendChild(h('span', {
          className: 'dot dot-' + (tone === 'crit' ? 'crit' : tone === 'warn' ? 'warn' : 'idle'),
          'aria-hidden': 'true'
        }));
        words.appendChild(h('p', {
          className: 'ribbon-title is-' + tone,
          text: ribbonTitle(active, needing, capped)
        }));
        words.appendChild(h('p', {
          className: 'ribbon-sub is-' + tone, text: activeSentence(active, needing, capped)
        }));
      }

      state.appendChild(words);
      grid.appendChild(state);
      grid.appendChild(ribbonBadges(problems, armed, capped));

      var open = op.link('alerts.html', 'Open problems', 'btn');
      open.appendChild(icon('external'));
      grid.appendChild(open);
      card.appendChild(grid);

      card.appendChild(severityBar(problems, armed));
      return card;
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
      var taken = active.length - needing.length;
      var bits = [];

      if (needing.length) bits.push(oldestSentence(needing));
      else {
        bits.push('Somebody is on ' + (active.length === 1 ? 'it' : 'each of them') +
          ', and ' + (active.length === 1 ? 'it is' : 'they are') + ' still open.');
      }
      if (needing.length && taken > 0) {
        bits.push(fmt.plural(taken, 'other problem') +
          (taken === 1 ? ' already has somebody on it.' : ' already have somebody on them.'));
      }
      if (capped) bits.push(cappedSentence());
      return bits.join(' ');
    }

    /* Said in full wherever a count from a full read is printed, because "at
       least" on its own reads as a rounding rather than as a ceiling that was
       hit. */
    function cappedSentence() {
      return 'Only ' + fmt.int(model.PAGE) + ' problems can be read at a time and that many ' +
        'came back, so these counts are the lowest they could be.';
    }

    /* Why nothing can be believed, in the reading that is actually true.
       Every count here is over the enabled rules, so they can be read against
       each other. */
    function unarmedSentence(armed) {
      if (!armed.total) return 'There are no alert rules at all.';
      if (!armed.enabled) {
        return 'None of the ' + fmt.int(armed.total) +
          ' rules are enabled, so nothing would be noticed.';
      }
      if (armed.neverRun === armed.enabled) {
        return 'The rules are enabled but none has run yet, so nothing has been judged.';
      }
      if (armed.errored === armed.enabled) {
        return 'Every enabled rule failed its own check the last time it ran. ' +
          'Treat this as unmonitored.';
      }
      if (armed.errored) {
        return 'No enabled rule reached a verdict the last time it ran, and ' +
          fmt.int(armed.errored) + ' of them failed the check itself. ' +
          'Treat this as unmonitored.';
      }
      return 'Every enabled rule is short of the data it needs to judge. ' +
        'Treat this as unmonitored.';
    }

    function oldestSentence(needing) {
      var oldest = model.iso(model.oldest(needing.map(function (p) { return p.firedAt; })));
      var taken = needing.length === 1 ? 'Nobody is on it' : 'Nobody is on them';
      if (!oldest) return taken + '.';
      return 'Oldest started ' + fmt.stamp(oldest) + ', ' +
        fmt.since(oldest) + ' ago. ' + taken + '.';
    }

    /* The counts, as badges, each carrying a glyph so none of them relies on
       its colour to be read. */
    function ribbonBadges(problems, armed, capped) {
      var row = h('div', { className: 'ribbon-badges' });
      var counts = { critical: 0, warning: 0, info: 0 };
      /* Counted over everything still open, taken on or not, for the same
         reason the ribbon reads it that way: a problem with somebody's name on
         it is still a problem. */
      model.active(problems).forEach(function (p) {
        if (counts[p.severity] !== undefined) counts[p.severity]++;
      });

      ['critical', 'warning', 'info'].forEach(function (severity) {
        if (!counts[severity]) return;
        row.appendChild(op.statusBadge(model.SEVERITY_TONE[severity],
          model.atLeast(fmt.int(counts[severity]), capped) + ' ' + severity));
      });

      var taken = model.takenOn(problems);
      if (taken.length) {
        row.appendChild(op.statusBadge('info',
          model.atLeast(fmt.plural(taken.length, 'problem'), capped) + ' taken on'));
      }

      row.appendChild(op.statusBadge(
        armed.trustworthy ? 'ok' : 'warn',
        fmt.int(armed.checking) + ' of ' + fmt.int(armed.total) + ' rules checking'
      ));

      /* A channel that was never connected is where a problem goes to be
         missed, so it is stated here rather than only on the pane that owns
         it. */
      var unconfigured = armed.channels.filter(function (c) { return !c.configured; });
      if (unconfigured.length) {
        row.appendChild(op.statusBadge('warn',
          fmt.plural(unconfigured.length, 'route') + ' not set up'));
      }
      return row;
    }

    /* The bar under the ribbon. Full width and healthy only when nothing is
       open at all, split by severity when something is. It reads the same list
       the ribbon's words do: a green bar over a critical problem somebody has
       taken on would contradict the pane it is drawn on. */
    function severityBar(problems, armed) {
      var active = model.active(problems);
      var segments = [];

      if (!armed.trustworthy) {
        segments = [{ value: 1, color: 'var(--warn)', label: 'Nothing is being checked' }];
      } else if (!active.length) {
        segments = [{ value: 1, color: 'var(--ok)', label: 'Nothing needs attention' }];
      } else {
        ['critical', 'warning', 'info'].forEach(function (severity) {
          var n = active.filter(function (p) { return p.severity === severity; }).length;
          if (!n) return;
          segments.push({
            value: n,
            color: severity === 'critical' ? 'var(--crit)'
              : severity === 'warning' ? 'var(--warn)' : 'var(--info)',
            label: fmt.int(n) + ' ' + severity
          });
        });
      }
      return op.stackbar(segments, 'ribbon-bar');
    }

    /* -------------------------------------------------------------- queue */

    function queueCard(problems, armed, capped) {
      var card = h('div', { className: 'card' });
      var needing = model.needingAction(problems);
      var taken = model.takenOn(problems);

      /* A bare zero over a truncated read is the one figure on this card that
         cannot be qualified by the footer alone: a full page keeps the oldest
         of each severity and drops the newest, and a newer problem with nobody
         on it is exactly what it drops. */
      card.appendChild(op.cardHead('Needs attention',
        needing.length
          ? model.atLeast(fmt.plural(needing.length, 'problem'), capped) + ' with nobody on it'
          : (capped
              ? 'Nobody is being asked to do anything in the ' + fmt.int(model.PAGE) +
                ' problems that could be read'
              : 'Nobody is being asked to do anything'),
        [op.link('alerts.html', 'All problems')]));

      var body = h('div', { className: 'card-body' });

      if (!problems.length) {
        body.appendChild(armed.trustworthy
          ? quietBlock(armed)
          : op.partFailure('The checks are not running',
              unarmedSentence(armed) + ' Nothing on this page can tell you the system is healthy ' +
              'until they are.'));
        card.appendChild(body);
        return card;
      }

      var queue = h('div', { className: 'queue' });
      var shown = needing.concat(taken).slice(0, QUEUE_LIMIT);
      shown.forEach(function (problem) { queue.appendChild(queueItem(problem)); });
      body.appendChild(queue);
      card.appendChild(body);

      var rest = problems.length - shown.length;
      if (rest > 0 || capped) {
        card.appendChild(h('div', { className: 'card-foot' }, [
          h('span', {
            text: (rest > 0
              ? model.atLeast(fmt.plural(rest, 'more problem'), capped) + ' open. '
              : '') +
              'Overview shows the worst few and hands the rest to Problems.' +
              (capped ? ' ' + cappedSentence() : '')
          })
        ]));
      }
      return card;
    }

    /* A quiet queue has to prove it is quiet for the right reason, exactly as
       the Problems pane's own empty state does. */
    function quietBlock(armed) {
      var block = h('div', { className: 'callout' });
      block.appendChild(icon('check'));
      var body = h('div');
      body.appendChild(h('strong', { text: 'Nothing needs attention.' }));
      body.appendChild(document.createTextNode(
        ' ' + fmt.int(armed.checking) + ' of ' + fmt.int(armed.total) +
        ' rules are enabled and reached a verdict the last time they ran' +
        (armed.lastEvaluatedAt ? ', last ' + fmt.ago(armed.lastEvaluatedAt) : '') +
        '. ' +
        (armed.lastFiredAt
          ? 'The last problem fired ' + fmt.ago(armed.lastFiredAt) + '.'
          : 'No problem has ever fired.')
      ));
      block.appendChild(body);
      return block;
    }

    function queueItem(problem) {
      var tone = problem.severity === 'critical' ? 'crit'
        : problem.severity === 'warning' ? 'warn' : 'info';
      var box = h('div', { className: 'callout callout-' + tone });
      box.appendChild(icon(problem.severity === 'info' ? 'info' : 'warn'));

      var body = h('div', { className: 'queue-body' });
      body.appendChild(h('h3', { className: 'queue-title is-' + tone, text: problem.title }));
      body.appendChild(h('p', { className: 'queue-desc', text: problem.summary }));

      var actions = h('div', { className: 'queue-actions' });
      var file = model.PANE_FILE[problem.workPane];
      /* The doorway. Overview owns no detail, so the only thing it offers is
         the pane where the work happens and the pane that owns the problem. */
      if (file && problem.workPane !== 'overview') {
        actions.appendChild(op.link(file, problem.workPaneLabel));
      }
      actions.appendChild(op.link('alerts.html', 'Problem ' + problem.reference));
      if (problem.status === 'acknowledged' && problem.acknowledgedByEmail) {
        actions.appendChild(h('span', {
          className: 'tiny muted', text: problem.acknowledgedByEmail + ' is on it'
        }));
      }
      body.appendChild(actions);

      box.appendChild(body);
      return box;
    }

    /* ---------------------------------------------------------- the gap */

    function awaitingCard() {
      var card = h('div', { className: 'card' });
      card.appendChild(op.cardHead('These figures have nowhere to read from yet'));

      var body = h('div', { className: 'card-body stack-sm' });
      body.appendChild(op.notConfigured('Nothing is being hidden from you.',
        'Usage, reliability, cost and release figures are being collected, but they cannot ' +
        'be read onto a page yet. They are left out rather than shown as zeroes, because a ' +
        'real zero and a figure with nothing behind it would look the same here.'));

      var list = h('div', { className: 'queue' });
      AWAITING.forEach(function (entry) {
        var box = h('div', { className: 'callout' });
        box.appendChild(icon('clock'));
        var text = h('div', { className: 'queue-body' });
        text.appendChild(h('h3', { className: 'queue-title', text: entry.title }));
        text.appendChild(h('p', { className: 'queue-desc', text: entry.body }));
        var actions = h('div', { className: 'queue-actions' });
        actions.appendChild(op.link(entry.href, entry.pane));
        text.appendChild(actions);
        box.appendChild(text);
        list.appendChild(box);
      });
      body.appendChild(list);
      card.appendChild(body);

      card.appendChild(h('div', { className: 'card-foot' }, [
        h('span', {
          text: 'Each of these belongs to the pane named beside it. Overview will show the ' +
                'headline and hand the detail over, the way it does for problems today.'
        })
      ]));
      return card;
    }

    load();
  });
})(window);
