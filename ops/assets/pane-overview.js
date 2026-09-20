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

      Promise.all([
        session.call('/api/ops/alerts/problems', { query: { status: 'open', limit: model.PAGE } })
          .then(function (p) { return p.data; }),
        session.call('/api/ops/alerts/rules').then(function (p) { return p.data; }),
        /* The figures fail on their own terms rather than through the pane.
           The two halves of this page answer different questions from
           different tables, and a summary read that is down must not take the
           urgent queue off the screen with it: an operator who cannot see
           spend can still act on a critical problem. The rejection is
           therefore carried as a value and drawn as one failed section, with
           the pane in its degraded state rather than its live one. */
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
      var armed = model.armedState(data.rules);
      var problems = data.open.problems.slice().sort(model.byWorstThenOldest);
      /* A full read is a floor, not a total: problems come back worst first
         and then oldest and stop at model.PAGE, so every count on this pane is
         "at least" when the page came back full. */
      var capped = model.capped(data.open.problems);
      var failed = !!(data.summary && data.summary.error);
      var figures = data.summary && data.summary.data;

      badgeProblems(problems, capped);

      /* Empty is a real state with a real trigger, and a narrow one: not one
         quiet window, but a pane with nothing behind either of its halves.
         Anything less than that renders whatever did come back. */
      if (!failed && !figures && !problems.length && !armed.total) {
        region.empty(nothingBehindIt());
        return;
      }

      var wrap = h('div', { className: 'stack' });
      wrap.appendChild(ribbon(problems, armed, capped));

      var attention = S.band('What needs a person',
        'Each one opens the pane that owns the work');
      attention.appendChild(queueCard(problems, armed, capped));
      wrap.appendChild(attention);

      var going = S.band('How things are going', 'Every figure says its window');
      figuresSection(going, data.summary);
      wrap.appendChild(going);

      /* Degraded is the pane on screen with one of its reads unusable, which
         is exactly this: the problems half answered and the figures half did
         not. It is not the empty state, because a read that never landed has
         not earned the sentence "there is nothing here". */
      if (failed) region.degraded(wrap);
      else region.show(wrap);
    }

    /* The Problems count beside the rail item.

       A real read or nothing: this is the count this pane just asked for, and
       a rail badge that invents one is worse than a rail with no badge. It is
       cleared as well as set, so a page that lands on a quiet system does not
       keep a stale count from a previous render. */
    function badgeProblems(problems, capped) {
      var needing = model.needingAction(problems).length;
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

    function ribbon(problems, armed, capped) {
      var active = model.active(problems);
      var needing = model.needingAction(problems);
      var worst = model.worstSeverity(active);

      var title;
      var sub;
      var tone;

      if (!armed.trustworthy) {
        tone = 'st-warn';
        title = 'Nothing is being checked';
        sub = unarmedSentence(armed);
      } else if (!active.length) {
        tone = 'st-ok';
        title = 'Everything is working';
        sub = fmt.int(armed.checking) + ' of ' + fmt.int(armed.total) + ' rules checking' +
          (armed.lastEvaluatedAt ? ', last ' + fmt.ago(armed.lastEvaluatedAt) : '');
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
      hero.appendChild(h('div', {}, [
        h('h2', { className: 'hero-title', text: title }),
        h('p', { className: 'hero-sub', text: sub })
      ]));
      hero.appendChild(ribbonChips(problems, armed, capped));
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
      var taken = active.length - needing.length;
      var bits = [];

      if (needing.length) bits.push(oldestSentence(needing));
      else {
        bits.push('Somebody is on ' + (active.length === 1 ? 'it' : 'each of them') +
          ', still open.');
      }
      if (needing.length && taken > 0) {
        bits.push(fmt.plural(taken, 'other problem') +
          (taken === 1 ? ' has somebody on it.' : ' have somebody on them.'));
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
      if (!armed.total) return 'There are no alert rules at all.';
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
      if (!oldest) return taken + '.';
      return 'Oldest started ' + fmt.stamp(oldest) + ', ' + fmt.since(oldest) + ' ago. ' +
        taken + '.';
    }

    /* The counts, as chips, each carrying a glyph and a word so none of them
       relies on its colour to be read. */
    var CHIP_CLASS = { crit: 'down', warn: 'warn', info: 'info', ok: 'up' };
    var CHIP_ICON = { crit: 'warn', warn: 'warn', info: 'info', ok: 'check' };

    function chip(tone, text) {
      var pill = h('span', { className: 'pill ' + (CHIP_CLASS[tone] || '') });
      pill.appendChild(icon(CHIP_ICON[tone] || 'info'));
      pill.appendChild(h('span', { text: text }));
      return pill;
    }

    function ribbonChips(problems, armed, capped) {
      var row = h('div', { className: 'hero-chips' });
      var counts = { critical: 0, warning: 0, info: 0 };
      /* Counted over everything still open, taken on or not, for the same
         reason the ribbon reads it that way: a problem with somebody's name on
         it is still a problem. */
      model.active(problems).forEach(function (p) {
        if (counts[p.severity] !== undefined) counts[p.severity]++;
      });

      ['critical', 'warning', 'info'].forEach(function (severity) {
        if (!counts[severity]) return;
        row.appendChild(chip(model.SEVERITY_TONE[severity],
          model.atLeast(fmt.int(counts[severity]), capped) + ' ' + severity));
      });

      var taken = model.takenOn(problems);
      if (taken.length) {
        row.appendChild(chip('info',
          model.atLeast(fmt.plural(taken.length, 'problem'), capped) + ' taken on'));
      }

      row.appendChild(chip(armed.trustworthy ? 'ok' : 'warn',
        fmt.int(armed.checking) + ' of ' + fmt.int(armed.total) + ' rules checking'));

      /* A channel that was never connected is where a problem goes to be
         missed, so it is stated here rather than only on the pane that owns
         it. */
      var unconfigured = armed.channels.filter(function (c) { return !c.configured; });
      if (unconfigured.length) {
        row.appendChild(chip('warn', fmt.plural(unconfigured.length, 'route') + ' not set up'));
      }
      return row;
    }

    /* -------------------------------------------------------------- queue */

    function queueCard(problems, armed, capped) {
      var card = S.card();
      var needing = model.needingAction(problems);
      var taken = model.takenOn(problems);

      /* A bare zero over a truncated read is the one figure on this card that
         cannot be qualified by the footer alone: a full page keeps the oldest
         of each severity and drops the newest, and a newer problem with nobody
         on it is exactly what it drops. */
      card.appendChild(S.cardHead('Needs attention',
        needing.length
          ? model.atLeast(fmt.plural(needing.length, 'problem'), capped) +
            (needing.length === 1 ? ' with nobody on it' : ' with nobody on them')
          : (capped
              ? 'Nobody is being asked to do anything in the ' + fmt.int(model.PAGE) +
                ' problems that could be read'
              : 'Nobody is being asked to do anything'),
        [S.link(S.paneHref('alerts') || 'alerts.html', 'All problems', 'btn btn-sm btn-ghost')]));

      var body = h('div', { className: 'card-body' });

      if (!problems.length) {
        body.appendChild(armed.trustworthy
          ? quietBlock(armed)
          : S.stateBlock('warn', 'The checks are not running', [unarmedSentence(armed)]));
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
        foot.appendChild(h('span', {
          text: fmt.plural(armed.checking, 'rule') + ' watching, nothing else tripped'
        }));
      }
      card.appendChild(foot);
      return card;
    }

    /* A quiet queue has to prove it is quiet for the right reason, exactly as
       the Problems pane's own empty state does. */
    function quietBlock(armed) {
      return S.stateBlock('check', 'Nothing needs attention', [
        fmt.int(armed.checking) + ' of ' + fmt.int(armed.total) +
          ' rules reached a verdict the last time they ran' +
          (armed.lastEvaluatedAt ? ', ' + fmt.ago(armed.lastEvaluatedAt) : '') + '.',
        armed.lastFiredAt
          ? 'Last problem fired ' + fmt.ago(armed.lastFiredAt) + '.'
          : 'No problem has ever fired.'
      ]);
    }

    var SEVERITY_ACCENT = { crit: 'acc-bad', warn: 'acc-warn', info: 'acc-blue' };
    var SEVERITY_INK = { crit: 'is-crit', warn: 'is-warn', info: 'is-info' };

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
      words.appendChild(h('h3', {
        className: 'q-title ' + (SEVERITY_INK[tone] || 'is-info'),
        text: model.SEVERITY_LABEL[problem.severity] + ': ' + problem.title
      }));
      words.appendChild(h('p', { className: 'q-desc', text: problem.summary }));

      var actions = h('div', { className: 'q-actions' });
      var file = model.PANE_FILE[problem.workPane];
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
    function windowLabel(win) {
      var days = num(win && win.days);
      if (days === null) return 'Window not reported';
      return 'Last ' + fmt.plural(days, 'whole UTC day');
    }

    /* The same window mid-sentence, for the chart's spoken description. */
    function windowPhrase(win) {
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
      why(card, windowLabel(people.window) +
        (textOf(people.environment) ? ', ' + people.environment : ''));

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
          className: 'dot ' + (app.tone === 'coaches' ? 'vio' : 'acc'), 'aria-hidden': 'true'
        }));
        pill.appendChild(h('span', { text: app.label || app.app }));
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
        rows.appendChild(h('div', { className: 'kpi-row' }, [
          h('span', { className: 'kpi-plat', text: textOf(platform.label) || platform.platform }),
          h('div', { className: 'spacer' }),
          h('span', {
            className: 'num',
            text: platform.versionName +
              (textOf(platform.versionCode) ? ' (' + platform.versionCode + ')' : '')
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
      var card = S.card();

      var legend = h('div', { className: 'legend' });
      series.forEach(function (one) {
        var key = h('span', { className: seriesTone(one.color) });
        key.appendChild(h('i', { 'aria-hidden': 'true' }));
        key.appendChild(h('span', { text: one.label || one.key }));
        legend.appendChild(key);
      });

      card.appendChild(S.cardHead('People active each day',
        windowLabel(activity && activity.window),
        series.length ? [legend] : null));

      var body = h('div', { className: 'card-body' });

      if (stateOf(activity) !== 'ready' || !series.length) {
        /* Words rather than an empty chart. An axis with no line on it is read
           as a measured flat zero, which is the one thing a window with no
           stored reading must not look like. */
        body.appendChild(S.stateBlock('empty', 'There is no line to draw for this window',
          [detailOf(activity, 'The answer carried no daily figures for this window.')]));
        card.appendChild(body);
        appendNote(card, activity && activity.note);
        return card;
      }

      var labels = list(activity.labels).slice();
      var drawable = series.filter(function (one) { return finiteCount(one.values) > 1; });

      if (drawable.length) {
        body.appendChild(lineChart(series, labels, activity.window));
        if (labels.length) {
          var axis = h('div', { className: 'axis-x', 'aria-hidden': 'true' });
          axis.appendChild(h('span', { text: labels[0] }));
          if (labels.length > 1) {
            axis.appendChild(h('span', { text: labels[labels.length - 1] }));
          }
          body.appendChild(axis);
        }
      } else {
        /* One day with a reading is a point, not a line, and there is nothing
           to join up. The figures below still say what was counted. */
        body.appendChild(S.stateBlock('empty', 'Not enough days to draw a line yet',
          ['Fewer than two days in this window have a stored reading.']));
      }

      /* The chart's own numbers, in text. Nothing on this pane may exist only
         inside a picture, and a reader who cannot see the line still has to be
         able to tell a reported zero from a day with no reading. */
      var rows = h('div', { className: 'series-rows' });
      series.forEach(function (one) { rows.appendChild(seriesRow(one, labels)); });
      body.appendChild(rows);

      card.appendChild(body);

      var missing = list(activity.daysMissingRollups).filter(function (day) {
        return typeof day === 'string';
      });
      if (missing.length) {
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

    function lineChart(series, labels, win) {
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
        'aria-label': chartName(series, labels, win)
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
    function chartName(series, labels, win) {
      var head = 'People active each day, one line per app, over ' + windowPhrase(win);
      if (labels.length) {
        head += ', ' + labels[0] +
          (labels.length > 1 ? ' to ' + labels[labels.length - 1] : '');
      }
      return head + '. ' + series.map(function (one) {
        return seriesSentence(one, labels);
      }).join(' ');
    }

    function seriesSentence(one, labels) {
      var name = one.label || one.key;
      var values = list(one.values);
      var reported = [];
      var lastIndex = -1;
      values.forEach(function (v, index) {
        var n = num(v);
        if (n === null) return;
        reported.push(n);
        lastIndex = index;
      });

      if (!reported.length) {
        return name + ': no reading on any of ' + fmt.plural(values.length, 'day') + '.';
      }
      var lo = Math.min.apply(null, reported);
      var high = Math.max.apply(null, reported);
      return name + ': ' + fmt.int(reported.length) + ' of ' +
        fmt.plural(values.length, 'day') + ' with a reading, ' +
        (lo === high ? 'flat at ' + fmt.int(lo) : 'low ' + fmt.int(lo) + ', high ' + fmt.int(high)) +
        ', ending ' + fmt.int(values[lastIndex]) +
        (labels[lastIndex] ? ' on ' + labels[lastIndex] : '') + '.';
    }

    /* One app's line, said in words: how much of the window it has a reading
       for, and its last reading with the day it was taken. */
    function seriesRow(one, labels) {
      var values = list(one.values);
      var reported = finiteCount(values);
      var lastIndex = -1;
      values.forEach(function (v, index) { if (num(v) !== null) lastIndex = index; });

      var row = h('div', { className: 'series-row ' + seriesTone(one.color) }, [
        h('i', { className: 'dot', 'aria-hidden': 'true' }),
        h('span', { text: one.label || one.key }),
        h('div', { className: 'spacer' })
      ]);
      row.appendChild(h('span', {
        className: 'num series-read',
        text: lastIndex === -1
          ? 'No reading'
          : fmt.plural(values[lastIndex], 'person', 'people') +
            (labels[lastIndex] ? ' on ' + labels[lastIndex] : '')
      }));
      row.appendChild(h('span', {
        className: 'series-cover',
        text: fmt.int(reported) + ' of ' + fmt.plural(values.length, 'day')
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
      if (!textOf(note)) return;
      card.appendChild(h('div', { className: 'card-foot' }, [h('span', { text: note })]));
    }

    /* --------------------------------------------- what is not drawn here */

    /* The figures the approved design puts on this pane that have no source,
       named with the route's own reason for each.

       Rendered from `omissions` rather than from a list in this file, so a
       figure that loses or gains a source moves here by itself rather than
       when somebody remembers to edit the client. */
    function omissionsCard(omissions) {
      var entries = list(omissions).filter(function (entry) {
        return entry && (textOf(entry.title) || textOf(entry.key));
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
        item.appendChild(glyph);
        item.appendChild(h('div', {}, [
          h('h3', { className: 'omit-title', text: textOf(entry.title) || entry.key }),
          h('p', {
            className: 'omit-desc',
            text: textOf(entry.detail) ||
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

    function figuresSection(band, result) {
      if (result && result.error) {
        var box = S.card();
        var block = S.stateBlock('warn', 'These figures could not be read', [
          S.failureMessage(result.error),
          'Nothing here is a zero: the figures are unread, not absent. The problems ' +
            'above were read separately and are unaffected.'
        ]);
        var again = h('button', { className: 'btn btn-primary', type: 'button', text: 'Try again' });
        again.addEventListener('click', function () { load(); });
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
        ]));
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
