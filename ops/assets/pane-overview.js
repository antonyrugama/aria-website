/* Overview: are people using it, is it working, is anything urgent.

   Overview owns no detail. Every figure on it is a doorway into the pane that
   owns the question, which is what stops it becoming the place investigations
   happen. That rule shapes this file more than anything else: nothing here
   renders a table, a facet, or a control that changes a system.

   **What this pane draws, and what it says instead of the rest.**

   Both of Overview's questions now have something behind them. The problems
   API answers "is anything urgent", and /api/ops/summary answers "are people
   using it" with the figures that have a real source: active people, Aria AI
   runs, cloud spend so far this month, and the production app version, plus a
   day-grain activity line.

   Four rules from that contract are load bearing here rather than decorative,
   and every one of them is a rule about NOT drawing something:

     1. **Every figure is labelled with the window it actually covers**, read
        from `window.days` rather than written into this file. The approved
        design asks for active people over 24 hours; there is no hourly grain
        anywhere in this pipeline, so the answer covers seven whole UTC days
        and the tile says seven. A figure labelled 24 hours that means seven
        days is worse than one labelled seven days.
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

  var shell = global.OpsShell;
  var op = global.OpsOperate;
  /* The understand panes' plumbing, for the half of this pane that reads
     figures. It is loaded here for three things this file must not hold a
     second copy of: the transport and its local fixture hook, the money and
     count formatting the Cloud costs pane already publishes its bill through,
     and the line chart that breaks on a missing point. The operate charts
     cannot draw this line: they drop a whole series that carries one, which
     turns a day nothing was recorded for into an app that never reported. */
  var d = global.OpsPaneData;
  var model = global.OpsAlertsModel;
  var session = global.OpsSession;
  var h = shell.h;
  var icon = shell.icon;
  var fmt = op.fmt;

  /* How many problems the needs-attention queue shows before it stops and
     sends the operator to the pane that owns them. Overview is a doorway, not
     a second Problems pane. */
  var QUEUE_LIMIT = 4;

  var SUMMARY_ENDPOINT = '/api/ops/summary';

  /* The pane each figure hands its detail to. Overview owns no detail, so
     every tile is a doorway into the pane that owns the question behind it. */
  var OWNER_PANE = {
    people: { href: 'analytics.html', label: 'People and usage' },
    cost: { href: 'spend.html', label: 'Cloud costs' },
    release: { href: 'releases.html', label: 'App releases' }
  };

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
        { type: 'rows', count: 4 },
        { type: 'tiles', count: 4 },
        { type: 'block', height: 190 }
      ]);

      Promise.all([
        session.call('/api/ops/alerts/problems', { query: { status: 'open', limit: model.PAGE } })
          .then(function (p) { return p.data; }),
        session.call('/api/ops/alerts/rules').then(function (p) { return p.data; }),
        /* The figures fail on their own terms rather than through the pane.
           The two halves of this page answer different questions from
           different tables, and a summary read that is down must not take the
           urgent queue off the screen with it: an operator who cannot see
           spend can still act on a critical problem. The rejection is
           therefore carried as a value and drawn as one failed section. */
        summary().then(function (payload) {
          return { data: (payload && typeof payload === 'object') ? payload : null };
        }, function (err) {
          return { error: err };
        })
      ]).then(function (results) {
        if (token !== loadToken) return;
        render({ open: results[0], rules: results[1], summary: results[2] });
      }).catch(function (err) {
        if (token !== loadToken) return;
        region.failed(err, load);
      });
    }

    /* The summary read.
       No querystring, because this pane registers no controls and the route
       accepts no parameter: it reports the environment it answered for in the
       payload rather than taking one. Through the understand panes' loader so
       that the same-origin fixture hook they are reviewed with covers the
       states a live API will not produce on demand, which here is most of
       them: a window nothing reported, a comparison the retention horizon
       refused, and a day with no stored reading. */
    function summary() {
      return d.load({ paneId: 'overview', endpoint: SUMMARY_ENDPOINT })
        .then(function (result) { return result.data; });
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
      wrap.appendChild(op.bandHead('How things are going',
        'Every figure says the window it covers'));
      wrap.appendChild(figuresSection(data.summary));
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
          ? model.atLeast(fmt.plural(needing.length, 'problem'), capped) +
            (needing.length === 1 ? ' with nobody on it' : ' with nobody on them')
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

    /* ------------------------------------------------------- the figures */

    /* A number the answer actually sent, or null.

       Never a substituted zero. On a pane whose one stated rule is that empty
       never means zero, a missing field coerced to 0 is that rule broken in
       the exact place it was written for, and it is broken silently: the tile
       still renders, confidently, in the same type as a billed figure. */
    function num(value) {
      return (typeof value === 'number' && isFinite(value)) ? value : null;
    }

    function stateOf(block) {
      var state = block && block.availability && block.availability.state;
      return typeof state === 'string' ? state : null;
    }

    function detailOf(block, fallback) {
      var detail = block && block.availability && block.availability.detail;
      return (typeof detail === 'string' && detail) ? detail : fallback;
    }

    function textOf(value) {
      return (typeof value === 'string' && value) ? value : null;
    }

    /* The window a figure covers, in words, read from the answer rather than
       written here.

       The approved design labels the active-people tile "last 24 hours". There
       is no hourly grain anywhere behind it, so the route answers over seven
       whole UTC days and publishes the window beside every figure precisely so
       that a wrong one moves a label on screen. Reading `days` is what makes
       that check real; hardcoding seven would put this file back in the
       business of asserting a window it did not measure. A window the answer
       did not describe says so rather than guessing. */
    function windowLabel(window) {
      var days = num(window && window.days);
      if (days === null) return 'Window not reported';
      return 'Last ' + fmt.plural(days, 'whole UTC day');
    }

    /* The same window mid-sentence, for the chart's spoken description. */
    function windowPhrase(window) {
      var days = num(window && window.days);
      if (days === null) return 'a window the answer did not describe';
      return 'the last ' + fmt.plural(days, 'whole UTC day');
    }

    function tile(label) {
      var card = h('div', { className: 'card tile' });
      card.appendChild(h('h3', { className: 'tile-label', text: label }));
      return card;
    }

    function metaLine(text) {
      return h('div', { className: 'tile-meta' }, [h('span', { text: text })]);
    }

    function tinyLine(text, tone) {
      return h('div', { className: 'tiny mt-xs ' + (tone === 'warn' ? 'ink-warn' : 'muted'), text: text });
    }

    /* The doorway. Overview owns no detail, so a tile ends at the pane that
       owns the question behind it. */
    function doorway(owner) {
      return h('div', { className: 'row mt-sm' }, [op.link(owner.href, owner.label)]);
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
      var words = (state && UNAVAILABLE_WORDS[state]) || 'Not reported';
      card.appendChild(h('div', { className: 'tile-value sm muted', text: words }));
      /* A block rather than a tile-meta row: this is a sentence, and the row
         is a line of short items that would push a narrow tile sideways. */
      card.appendChild(h('div', {
        className: 'small muted mt-xs', text: detailOf(block, fallbackDetail)
      }));
      return card;
    }

    /* ------------------------------------------------------ active people */

    function peopleTile(people) {
      var card = tile('Active people');
      var active = num(people && people.platform && people.platform.active);

      if (stateOf(people) !== 'ready' || active === null) {
        unavailable(card, people,
          'The answer carried no active-people figure for this window.');
        card.appendChild(doorway(OWNER_PANE.people));
        return card;
      }

      card.appendChild(h('div', { className: 'tile-value', text: fmt.int(active) }));
      card.appendChild(peopleChange(people, active));
      card.appendChild(metaLine(windowLabel(people.window) +
        (textOf(people.environment) ? ', ' + people.environment : '')));

      /* The two apps, side by side and never added. The headline above them is
         the platform's own distinct count rather than their sum, so a reader
         who adds the two by eye and gets a larger number is looking at the one
         person who used both. */
      var apps = (people.apps || []).filter(function (app) {
        return num(app && app.active) !== null;
      });
      if (apps.length) {
        var row = h('div', { className: 'tile-meta row-wrap mt-xs' });
        apps.forEach(function (app) {
          var tag = h('span', {
            className: 'tag tag-' + (app.tone === 'coaches' ? 'coaches' : 'mobile'),
            text: app.label || app.app
          });
          row.appendChild(h('span', { className: 'row' }, [
            tag, h('span', { className: 'mono', text: fmt.int(app.active) })
          ]));
        });
        card.appendChild(row);
        card.appendChild(tinyLine('Not the sum of the two: somebody who used both is one person.'));
      }

      card.appendChild(doorway(OWNER_PANE.people));
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
      if (floor === null) floor = d.REPORTING_FLOOR;

      if (before === null || !people.comparison) {
        return metaLine('No comparison available');
      }
      if (before < floor) {
        return h('div', { className: 'tile-meta row-wrap' }, [
          h('span', { text: 'No change shown, only ' + fmt.plural(before, 'person', 'people') +
            ' in the window before, under the ' + fmt.int(floor) + ' we report rates from' }),
          h('span', { className: 'mono', text: fmt.int(active) + ' now, ' + fmt.int(before) + ' before' })
        ]);
      }

      var basisPoints = Math.round(((active - before) / before) * 10000);
      var row = h('div', { className: 'tile-meta row-wrap' });
      row.appendChild(h('span', {
        className: 'delta ' + (basisPoints > 0 ? 'delta-up' : basisPoints < 0 ? 'delta-down' : 'delta-flat'),
        text: d.signedPercent(basisPoints)
      }));
      row.appendChild(h('span', {
        text: 'against ' + fmt.int(before) + ' in the ' +
          fmt.plural(num(people.comparison.days) === null ? 0 : people.comparison.days, 'day') +
          ' before'
      }));
      return row;
    }

    /* ----------------------------------------------------------- AI runs */

    function aiRunsTile(aiRuns) {
      var card = tile('Aria AI runs');
      var runs = num(aiRuns && aiRuns.runs);

      if (stateOf(aiRuns) !== 'ready' || runs === null) {
        return unavailable(card, aiRuns,
          'The answer carried no AI run count for this window.');
      }

      card.appendChild(h('div', { className: 'tile-value', text: fmt.int(runs) }));

      /* Counts rather than a percentage, and absent rather than zero when the
         window before was never reconciled: a comparison against a window
         nothing was collected for reads as a collapse in AI use. */
      var previous = num(aiRuns.previous && aiRuns.previous.runs);
      card.appendChild(metaLine(previous === null
        ? 'No comparison available'
        : 'against ' + fmt.int(previous) + ' in the window before'));

      card.appendChild(metaLine(windowLabel(aiRuns.window)));

      /* A day with no reconciliation row has no reading, which is not a day
         with no runs. Saying how many days are behind the total is what lets a
         reader tell a quiet week from a stalled nightly job. */
      var missing = (aiRuns.daysMissing || []).length;
      var reported = num(aiRuns.daysReported);
      if (missing > 0) {
        card.appendChild(tinyLine('Counted from ' +
          (reported === null ? fmt.plural(0, 'day') : fmt.plural(reported, 'day')) +
          ', ' + fmt.plural(missing, 'day') + ' in this window ' +
          (missing === 1 ? 'has' : 'have') + ' not been reconciled yet.', 'warn'));
      }
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
        card.appendChild(doorway(OWNER_PANE.cost));
        return card;
      }

      card.appendChild(h('div', { className: 'tile-value', text: d.money(micros, cost.currency) }));

      var change = num(cost.comparison && cost.comparison.changeBasisPoints);
      if (change === null) {
        card.appendChild(metaLine('No comparison available'));
      } else {
        /* Sent, not computed. The comparison window is clamped inside the
           previous period by the route that owns the cost arithmetic, and a
           second implementation of it here would be a second figure with
           nothing on screen saying which one an operator is reading. Spending
           more is the direction that costs money, so it takes the tone the
           Cloud costs pane gives it rather than the green a rise gets above. */
        var row = h('div', { className: 'tile-meta row-wrap' });
        row.appendChild(h('span', {
          className: 'delta ' + (change > 0 ? 'delta-down' : change < 0 ? 'delta-up' : 'delta-flat'),
          text: d.signedPercent(change)
        }));
        row.appendChild(h('span', {
          text: textOf(cost.comparison.label) || 'against the same stretch of the period before'
        }));
        card.appendChild(row);
      }

      var period = cost.window || {};
      var dayOf = num(period.dayOfPeriod);
      var daysIn = num(period.daysInPeriod);
      card.appendChild(metaLine(dayOf !== null && daysIn !== null
        ? 'Month to date, day ' + fmt.int(dayOf) + ' of ' + fmt.int(daysIn)
        : 'Month to date'));

      if (cost.basis === 'spend') {
        card.appendChild(tinyLine('Spend so far, not spend against a target.'));
      }

      var asOf = d.utcStamp(cost.asOf);
      card.appendChild(tinyLine(asOf
        ? 'Billed usage as of ' + asOf + '.'
        : 'The time of this reading was not reported, so it cannot be read as current.'));

      card.appendChild(doorway(OWNER_PANE.cost));
      return card;
    }

    /* --------------------------------------------------- the app version */

    /* Per platform and never merged. iOS and Android ship separately and
       really do sit on different versions, so one headline "the app version"
       would be true of at most one store. */
    function releaseTile(release) {
      var card = tile('App version in production');
      var platforms = (release && release.platforms) || [];

      if (stateOf(release) !== 'ready' || !platforms.length) {
        unavailable(card, release, 'Neither store reported a production version.');
        card.appendChild(doorway(OWNER_PANE.release));
        return card;
      }

      var newest = null;
      platforms.forEach(function (platform) {
        var version = textOf(platform.versionName);
        if (!version) return;
        card.appendChild(h('div', {
          className: 'tile-meta', text: textOf(platform.label) || platform.platform
        }));
        card.appendChild(h('div', {
          className: 'tile-value sm',
          text: version + (textOf(platform.versionCode) ? ' (' + platform.versionCode + ')' : '')
        }));
        var read = d.hoursSince(platform.fetchedAt);
        if (read !== null && (newest === null || read < newest)) newest = read;
      });

      if (newest !== null) {
        card.appendChild(tinyLine(newest <= 0
          ? 'Read from the stores within the hour.'
          : 'Read from the stores ' + d.hours(newest) + ' ago.'));
      }
      card.appendChild(doorway(OWNER_PANE.release));
      return card;
    }

    /* ------------------------------------------------- the activity line */

    function finiteCount(values) {
      var n = 0;
      (values || []).forEach(function (value) { if (num(value) !== null) n += 1; });
      return n;
    }

    /* One line per app over the same days, drawn through the understand
       panes' chart because it is the one that breaks a path on a missing
       point. A day an app has no stored reading for arrives as null, and both
       of the alternatives are a lie about a real quantity: joining across it
       draws people who were never counted, and plotting it as zero draws a day
       the app was open and nobody used it. */
    function activityCard(activity) {
      var series = (activity && activity.series) || [];
      var card = h('div', { className: 'card' });

      var legend = h('div', { className: 'legend' });
      series.forEach(function (one) {
        var swatch = h('i', { 'aria-hidden': 'true' });
        swatch.style.setProperty('background', d.seriesStroke(one.color));
        legend.appendChild(h('span', {}, [swatch, h('span', { text: one.label || one.key })]));
      });

      card.appendChild(op.cardHead('People active each day',
        windowLabel(activity && activity.window) + ', one line per app',
        series.length ? [legend] : null));

      var body = h('div', { className: 'card-body' });

      if (stateOf(activity) !== 'ready' || !series.length) {
        /* A callout rather than an empty chart. An axis with no line on it is
           read as a measured flat zero, which is the one thing a window with
           no stored reading must not look like. */
        body.appendChild(op.notConfigured('There is no line to draw for this window.',
          detailOf(activity, 'The answer carried no daily figures for this window.')));
        card.appendChild(body);
        appendNote(card, activity && activity.note);
        return card;
      }

      var labels = (activity.labels || []).slice();
      var drawable = series.filter(function (one) { return finiteCount(one.values) > 1; });

      if (drawable.length) {
        body.appendChild(d.lineChart({
          height: 190,
          label: 'People active each day, ' + series.map(function (one) {
            return one.label || one.key;
          }).join(' and ') + ', over ' + windowPhrase(activity.window),
          series: series.map(function (one) {
            return { color: one.color, values: one.values || [] };
          })
        }));
        if (labels.length) {
          var axis = h('div', { className: 'axis-x', 'aria-hidden': 'true' });
          labels.forEach(function (label) { axis.appendChild(h('span', { text: label })); });
          body.appendChild(axis);
        }
      } else {
        /* One day with a reading is a point, not a line, and the chart draws
           nothing from it. The figures below still say what was counted. */
        body.appendChild(op.notConfigured('Not enough days to draw a line yet.',
          'Fewer than two days in this window have a stored reading, so there is ' +
          'nothing to join up. The days that do have one are listed below.'));
      }

      /* The chart's own numbers, in text. Nothing on this pane may exist only
         inside a picture, and a reader who cannot see the line still has to be
         able to tell a reported zero from a day with no reading. */
      var rows = h('div', { className: 'stack-sm mt-sm' });
      series.forEach(function (one) { rows.appendChild(seriesRow(one, labels)); });
      body.appendChild(rows);

      card.appendChild(body);

      var missing = (activity.daysMissingRollups || []).filter(function (day) {
        return typeof day === 'string';
      });
      if (missing.length) {
        var box = h('div', { className: 'card-body' }, [
          op.notConfigured(missing.length === 1
            ? 'One day inside this window has no stored figures.'
            : fmt.plural(missing.length, 'day') + ' inside this window have no stored figures.',
            listDays(missing) + '. These days are drawn as breaks in the line rather ' +
            'than as zeroes: no app reported on them, which is not the same as nobody ' +
            'using the apps.')
        ]);
        card.appendChild(box);
      }

      appendNote(card, activity.note);
      return card;
    }

    /* One app's line, said in words: how much of the window it has a reading
       for, and its last reading with the day it was taken. */
    function seriesRow(one, labels) {
      var values = one.values || [];
      var reported = finiteCount(values);
      var lastIndex = -1;
      values.forEach(function (value, index) { if (num(value) !== null) lastIndex = index; });

      var row = h('div', { className: 'row row-wrap' }, [
        h('span', { className: 'small', text: one.label || one.key }),
        h('div', { className: 'spacer' })
      ]);
      row.appendChild(h('span', {
        className: 'mono',
        text: lastIndex === -1
          ? 'No reading'
          : fmt.plural(values[lastIndex], 'person', 'people') +
            (labels[lastIndex] ? ' on ' + labels[lastIndex] : '')
      }));
      row.appendChild(h('span', {
        className: 'tiny muted',
        text: fmt.int(reported) + ' of ' + fmt.plural(values.length, 'day') + ' with a reading'
      }));
      return row;
    }

    /* Most days named in full before the list is summarised, the same way the
       People and usage pane lists its gaps. */
    var MAX_LISTED_GAP_DAYS = 8;

    function listDays(days) {
      var shown = days.slice(0, MAX_LISTED_GAP_DAYS).map(function (day) {
        return d.utcDay(day) || day;
      });
      var rest = days.length - shown.length;
      return shown.join(', ') + (rest > 0 ? ', and ' + fmt.plural(rest, 'more day') : '');
    }

    function appendNote(card, note) {
      if (!textOf(note)) return;
      card.appendChild(h('div', { className: 'card-foot' }, [h('span', { text: note })]));
    }

    /* --------------------------------------------- what is not drawn here */

    /* The figures the approved design puts on this pane that have no source,
       named with the route's own reason for each.

       This replaces the "Not on this page yet" block, and it is a shorter list
       than that block was because three of its four entries are now drawn. It
       is rendered from `omissions` rather than from a list in this file, so a
       figure that loses or gains a source moves here by itself rather than
       when somebody remembers to edit the client. */
    function omissionsCard(omissions) {
      var entries = (omissions || []).filter(function (entry) {
        return entry && (textOf(entry.title) || textOf(entry.key));
      });
      if (!entries.length) return null;

      var card = h('div', { className: 'card' });
      card.appendChild(op.cardHead('Not drawn here, and why',
        entries.length === 1
          ? 'One figure the design asks for has no source'
          : fmt.int(entries.length) + ' figures the design asks for have no source'));

      var body = h('div', { className: 'card-body stack-sm' });
      entries.forEach(function (entry) {
        var box = h('div', { className: 'callout' });
        box.appendChild(icon('clock'));
        var text = h('div', { className: 'queue-body' });
        text.appendChild(h('h4', {
          className: 'queue-title', text: textOf(entry.title) || entry.key
        }));
        text.appendChild(h('p', {
          className: 'queue-desc',
          text: textOf(entry.detail) ||
            'The answer named this as unavailable and gave no reason.'
        }));
        box.appendChild(text);
        body.appendChild(box);
      });
      card.appendChild(body);

      card.appendChild(h('div', { className: 'card-foot' }, [
        h('span', {
          text: 'These are left out rather than drawn as zeroes or as empty bars. A ' +
                'figure with nothing behind it and a real one look the same once ' +
                'either is on a tile.'
        })
      ]));
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
      var wrap = h('div', { className: 'stack-sm' });
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
        wrap.appendChild(h('p', {
          className: 'axis-note', text: entry.label + ': ' + note
        }));
      });
      return wrap.childNodes.length ? wrap : null;
    }

    function hasPeopleComparison(people) {
      return !!(people && people.comparison) &&
        num(people.platform && people.platform.previousActive) !== null;
    }

    function figuresSection(summary) {
      var wrap = h('div', { className: 'stack' });

      if (summary && summary.error) {
        var card = h('div', { className: 'card' });
        card.appendChild(h('div', { className: 'card-body' }, [
          op.partFailure('These figures could not be read',
            op.failureMessage(summary.error) +
            ' Nothing here is a zero: the figures are unread, not absent. The problems ' +
            'above were read separately and are unaffected.',
            load)
        ]));
        wrap.appendChild(card);
        return wrap;
      }

      var data = summary && summary.data;
      if (!data) {
        wrap.appendChild(op.paneState('empty', 'These figures have nothing behind them yet', [
          'This pane asked the operations API for the headline figures and what came ' +
            'back did not carry them.',
          'Nothing is being hidden from you, and nothing here is a zero.'
        ]));
        return wrap;
      }

      var tiles = h('div', { className: 'grid g4' });
      tiles.appendChild(peopleTile(data.people));
      tiles.appendChild(aiRunsTile(data.aiRuns));
      tiles.appendChild(costTile(data.cost));
      tiles.appendChild(releaseTile(data.release));
      wrap.appendChild(tiles);

      var notes = figureNotes(data);
      if (notes) wrap.appendChild(notes);

      wrap.appendChild(activityCard(data.activity));

      var omissions = omissionsCard(data.omissions);
      if (omissions) wrap.appendChild(omissions);

      var stamp = d.utcStamp(data.generatedAt);
      wrap.appendChild(h('p', {
        className: 'axis-note',
        text: (stamp
          ? 'Read at ' + stamp + '. '
          : 'The time these figures were read was not reported, so they cannot be ' +
            'read as current. ') +
          (textOf(data.consent && data.consent.detail) || '')
      }));
      return wrap;
    }

    load();
  });
})(window);
