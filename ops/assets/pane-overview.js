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
    var filters = shell.filters();
    var loadToken = 0;

    global.addEventListener('ops:filters', function (e) {
      if (e.detail.range === filters.range && e.detail.env === filters.env) return;
      filters = e.detail;
      load();
    });

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

      var wrap = h('div', { className: 'stack' });
      wrap.appendChild(ribbon(problems, armed));
      wrap.appendChild(op.bandHead('What needs a person',
        'Everything here opens the pane that owns the work'));
      wrap.appendChild(queueCard(problems, armed));
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
       drawing it as the first. */
    function ribbon(problems, armed) {
      var needing = model.needingAction(problems);
      var worst = model.worstSeverity(needing);

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
      } else if (!needing.length) {
        state.appendChild(h('span', { className: 'dot dot-live', 'aria-hidden': 'true' }));
        words.appendChild(h('p', { className: 'ribbon-title', text: 'Everything is working' }));
        words.appendChild(h('p', {
          className: 'ribbon-sub',
          text: fmt.int(armed.summary.enabled) + ' of ' + fmt.int(armed.summary.total) +
                ' rules are checking' +
                (armed.summary.lastEvaluatedAt
                  ? ', last ' + fmt.ago(armed.summary.lastEvaluatedAt)
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
          text: needing.length === 1
            ? needing[0].title
            : fmt.plural(needing.length, 'problem') + ' need a person'
        }));
        words.appendChild(h('p', {
          className: 'ribbon-sub is-' + tone, text: oldestSentence(needing)
        }));
      }

      state.appendChild(words);
      grid.appendChild(state);
      grid.appendChild(ribbonBadges(problems, armed));

      var open = op.link('alerts.html', 'Open problems', 'btn');
      open.appendChild(icon('external'));
      grid.appendChild(open);
      card.appendChild(grid);

      card.appendChild(severityBar(problems, armed));
      return card;
    }

    function unarmedSentence(armed) {
      if (!armed.summary.total) return 'There are no alert rules at all.';
      if (!armed.summary.enabled) {
        return 'None of the ' + fmt.int(armed.summary.total) +
          ' rules are enabled, so nothing would be noticed.';
      }
      if (armed.summary.lastEvaluatedAt === null) {
        return 'The rules are enabled but none has run yet, so nothing has been judged.';
      }
      return 'Every enabled rule is short of the data it needs to judge. ' +
        'Treat this as unmonitored.';
    }

    function oldestSentence(needing) {
      var oldest = needing.map(function (p) { return model.time(p.firedAt); })
        .filter(function (t) { return t !== null; }).sort()[0];
      var taken = needing.length === 1 ? 'Nobody is on it' : 'Nobody is on them';
      if (!oldest) return taken + '.';
      return 'Oldest started ' + fmt.stamp(new Date(oldest).toISOString()) + ', ' +
        fmt.since(new Date(oldest).toISOString()) + ' ago. ' + taken + '.';
    }

    /* The counts, as badges, each carrying a glyph so none of them relies on
       its colour to be read. */
    function ribbonBadges(problems, armed) {
      var row = h('div', { className: 'ribbon-badges' });
      var counts = { critical: 0, warning: 0, info: 0 };
      model.needingAction(problems).forEach(function (p) {
        if (counts[p.severity] !== undefined) counts[p.severity]++;
      });

      if (counts.critical) row.appendChild(op.statusBadge('crit', fmt.int(counts.critical) + ' critical'));
      if (counts.warning) row.appendChild(op.statusBadge('warn', fmt.int(counts.warning) + ' warning'));
      if (counts.info) row.appendChild(op.statusBadge('info', fmt.int(counts.info) + ' info'));

      var taken = model.takenOn(problems);
      if (taken.length) {
        row.appendChild(op.statusBadge('info', fmt.plural(taken.length, 'problem') + ' taken on'));
      }

      row.appendChild(op.statusBadge(
        armed.trustworthy ? 'ok' : 'warn',
        fmt.int(armed.summary.enabled) + ' of ' + fmt.int(armed.summary.total) + ' rules on'
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

    /* The bar under the ribbon. Full width and healthy when nothing needs a
       person, split by severity when something does. */
    function severityBar(problems, armed) {
      var needing = model.needingAction(problems);
      var segments = [];

      if (!armed.trustworthy) {
        segments = [{ value: 1, color: 'var(--warn)', label: 'Nothing is being checked' }];
      } else if (!needing.length) {
        segments = [{ value: 1, color: 'var(--ok)', label: 'Nothing needs attention' }];
      } else {
        ['critical', 'warning', 'info'].forEach(function (severity) {
          var n = needing.filter(function (p) { return p.severity === severity; }).length;
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

    function queueCard(problems, armed) {
      var card = h('div', { className: 'card' });
      var needing = model.needingAction(problems);
      var taken = model.takenOn(problems);

      card.appendChild(op.cardHead('Needs attention',
        needing.length
          ? fmt.plural(needing.length, 'problem') + ' with nobody on it'
          : 'Nobody is being asked to do anything',
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

      if (problems.length > shown.length) {
        card.appendChild(h('div', { className: 'card-foot' }, [
          h('span', {
            text: fmt.plural(problems.length - shown.length, 'more problem') +
                  ' open. Overview shows the worst few and hands the rest to Problems.'
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
        ' ' + fmt.int(armed.summary.enabled) + ' of ' + fmt.int(armed.summary.total) +
        ' rules are enabled and checking' +
        (armed.summary.lastEvaluatedAt ? ', last ' + fmt.ago(armed.summary.lastEvaluatedAt) : '') +
        '. ' +
        (armed.summary.lastFiredAt
          ? 'The last problem fired ' + fmt.ago(armed.summary.lastFiredAt) + '.'
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
        'Usage, reliability, cost and release figures are being collected, but no part of ' +
        'the operations API serves them to a page yet. They are left out rather than drawn ' +
        'as zeroes, because a zero and a disconnected pipeline look identical in a tile.'));

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
