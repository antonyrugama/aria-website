/* Problems: what needs a person right now, and who is on it.

   The pane owns the whole lifecycle of a problem: it fires, somebody takes it
   on, they work it in the pane that owns the work, and it gets closed with a
   reason. Nothing here is a second Overview, and no figure on this page is
   computed from anything but what the operations API returned.

   Two rules from the approved mocks are load bearing and are worth naming,
   because they are the reason several parts of this file are longer than they
   look like they need to be.

   **A quiet pane has to prove it is armed.** "Nothing is wrong" and "the
   alerting stopped" look identical on an empty screen, so the empty state
   reads the rules and says how many are enabled, when they were last
   evaluated, and when one last fired. If the rules are not actually checking,
   because none are enabled or because they have not got enough data to judge,
   the empty state says that instead and says it as a warning. An empty pane is
   never allowed to imply a healthy one.

   **A state that was never set up is not a failure.** A notification channel
   with no webhook and a notification channel that is being refused need
   different actions, so they get different words. Rendering both as an error
   teaches an operator to ignore both. */
(function (global) {
  'use strict';

  var shell = global.OpsShell;
  var op = global.OpsOperate;
  var session = global.OpsSession;
  var h = shell.h;
  var icon = shell.icon;
  var fmt = op.fmt;

  var model = global.OpsAlertsModel;

  var SEVERITY_LABEL = model.SEVERITY_LABEL;
  var SEVERITY_TONE = model.SEVERITY_TONE;
  var STATUS_LABEL = model.STATUS_LABEL;
  var STATUS_TONE = model.STATUS_TONE;
  var CLOSE_REASON_LABEL = model.CLOSE_REASON_LABEL;
  var EVENT_LABEL = model.EVENT_LABEL;
  var EVENT_TONE = model.EVENT_TONE;
  var EVALUATION_LABEL = model.EVALUATION_LABEL;
  var EVALUATION_TONE = model.EVALUATION_TONE;
  var INSUFFICIENT_REASON = model.INSUFFICIENT_REASON;
  var CHANNEL_STATUS = model.CHANNEL_STATUS;
  var CHANNEL_FAILURE = model.CHANNEL_FAILURE;
  var PANE_FILE = model.PANE_FILE;
  var CATEGORIES = model.CATEGORIES;
  var SEVERITIES = model.SEVERITIES;
  var PAGE = model.PAGE;
  var time = model.time;

  var RANGE_DAYS = { '7d': 7, '30d': 30 };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function dayLabel(date) {
    return date.getUTCDate() + ' ' + MONTHS[date.getUTCMonth()];
  }

  /* ------------------------------------------------------------- the pane */

  shell.definePane('alerts', function (content) {
    var region = op.region(content);

    /* Reading is open to every role. Taking a problem on and closing it need
       operator or owner; tuning a rule needs owner. The server enforces all
       three independently: what the client does with them is render a fact
       rather than dangle a control that will be refused. */
    var canAct = session.hasRole(['owner', 'operator']);
    var isOwner = session.hasRole(['owner']);

    var filters = shell.filters();
    var picked = { severity: 'all', category: 'all' };
    var loadToken = 0;

    /* ---------------------------------------------------- pane-local filters

       Severity goes to the API, because it can filter on it. Category is
       applied here over what came back, because the API cannot, and the count
       line under the list says so rather than leaving the operator to assume
       the number is a total. */
    var severityControl = null;
    var categoryControl = null;

    function buildFilterControls() {
      severityControl = op.filterItem('Severity',
        op.segmented('Severity', SEVERITIES, picked.severity, function (v) {
          picked.severity = v;
          load();
        }));
      categoryControl = op.filterItem('Category',
        op.select(CATEGORIES, picked.category, function (v) {
          picked.category = v;
          load();
        }, 'Category'), 'fCategory');
      return [severityControl, categoryControl];
    }

    /* Swaps this pane's own two controls for freshly built ones showing the
       current selection. It replaces the nodes it put there and touches
       nothing else, because the bar it is standing in also holds the shell's
       range and environment controls. */
    function resetFilterControls() {
      var old = [severityControl, categoryControl];
      var next = buildFilterControls();
      old.forEach(function (node, i) {
        if (node && node.parentNode) node.replaceWith(next[i]);
      });
    }

    op.paneFilters(buildFilterControls());

    global.addEventListener('ops:filters', function (e) {
      var next = e.detail;
      if (next.range === filters.range && next.env === filters.env) return;
      filters = next;
      load();
    });

    /* ------------------------------------------------------------ loading */

    function query(status) {
      var q = { status: status, limit: PAGE };
      if (picked.severity !== 'all') q.severity = picked.severity;
      return session.call('/api/ops/alerts/problems', { query: q })
        .then(function (payload) { return payload.data; });
    }

    function load() {
      var token = ++loadToken;
      region.loading([
        { type: 'tiles' },
        { type: 'block', height: 62 },
        { type: 'block', height: 62 },
        { type: 'block', height: 62 }
      ]);

      /* Returned so a caller that changed something can wait for the pane it
         changed to be back on screen before it moves focus. */
      return Promise.all([
        query('open'),
        /* Closed problems are read for three things that would otherwise be
           guesses: the ranges that look back over a window, the false-alarm
           rate, and the volume chart. */
        query('closed'),
        session.call('/api/ops/alerts/rules').then(function (p) { return p.data; })
      ]).then(function (results) {
        if (token !== loadToken) return;  /* a newer load is already in flight */
        render({ open: results[0], closed: results[1], rules: results[2] });
      }).catch(function (err) {
        if (token !== loadToken) return;
        region.failed(err, load);
      });
    }

    /* --------------------------------------------------------- composition */

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

    function visibleProblems(data) {
      var all = data.open.problems.concat(data.closed.problems);
      return all.filter(inRange).filter(matchesCategory).sort(model.byWorstThenOldest);
    }

    /* Whether any control is narrowing what came back. The window is one of
       them: the pane's own default, "Open now", narrows nothing, but a 7 or 30
       day window does, and an empty result under one says nothing about the
       problems outside it. */
    function narrowed() {
      return picked.severity !== 'all' || picked.category !== 'all' ||
        Boolean(RANGE_DAYS[filters.range]);
    }

    function render(data) {
      var list = visibleProblems(data);
      var armed = model.armedState(data.rules);

      if (!list.length) {
        region.show(emptyState(data, armed));
        return;
      }

      var wrap = h('div', { className: 'stack' });
      wrap.appendChild(tiles(data, armed));
      wrap.appendChild(op.secHead(
        RANGE_DAYS[filters.range] ? 'Problems in this window' : 'Open problems',
        'Worst first, then oldest. Newest is not the same as most important.'
      ));
      wrap.appendChild(problemList(list, data));
      wrap.appendChild(countLine(list, data));
      wrap.appendChild(lowerBand(data, armed));
      region.show(wrap);
    }

    /* -------------------------------------------------------------- tiles */

    /* The severity filter is applied by the operations API, so every figure on
       this pane is computed over a severity-scoped read. A tile labelled as a
       total while it counts one severity is the same untruth the empty state
       was fixed for: with Critical selected, "Nobody has taken a problem on"
       is printed over a warning problem somebody is on. The scope therefore
       goes into the label of every tile that carries a problem count, and into
       the sentences that would otherwise read as claims about everything. */
    function severityScope() {
      return picked.severity === 'all'
        ? null
        : (SEVERITY_LABEL[picked.severity] || picked.severity).toLowerCase();
    }

    function scopedLabel(label) {
      var scope = severityScope();
      return scope ? label + ' (' + scope + ' only)' : label;
    }

    function tiles(data, armed) {
      var grid = h('div', { className: 'grid g4' });

      var needing = model.needingAction(data.open.problems);
      var takenOn = model.takenOn(data.open.problems);
      var openCapped = model.capped(data.open.problems);
      var scope = severityScope();

      /* A floor of zero is not a floor, so the "at least" only goes on a count
         that has something in it. The note carries the bound either way. */
      grid.appendChild(tile(
        scopedLabel('Open, needs action'),
        model.atLeast(fmt.int(needing.length), openCapped && needing.length > 0),
        needing.length ? 'crit' : 'ok',
        openCapped
          ? 'More are open than this page can read at once'
          : oldestNote(needing)
      ));

      grid.appendChild(tile(
        scopedLabel('Someone is on it'),
        model.atLeast(fmt.int(takenOn.length), openCapped && takenOn.length > 0),
        null,
        openCapped
          ? 'Counted over the ' + PAGE + ' problems that could be read'
          : (takenOn.length
              ? owners(takenOn)
              : 'Nobody has taken ' +
                (scope
                  ? (/^[aeiou]/.test(scope) ? 'an ' : 'a ') + scope + ' problem'
                  : 'a problem') + ' on')
      ));

      grid.appendChild(tile(
        'Rules running',
        fmt.int(armed.enabled) + ' of ' + fmt.int(armed.total),
        armed.trustworthy ? null : 'warn',
        rulesNote(armed)
      ));

      grid.appendChild(falseAlarmTile(data));
      return grid;
    }

    function tile(label, value, tone, note) {
      var card = h('div', { className: 'card tile' });
      card.appendChild(h('div', { className: 'tile-label', text: label }));
      var v = h('div', { className: 'tile-value', text: value });
      if (tone === 'crit') v.classList.add('is-crit');
      if (tone === 'warn') v.classList.add('is-warn');
      card.appendChild(v);
      card.appendChild(h('div', { className: 'tile-meta' }, [h('span', { text: note })]));
      return card;
    }

    function oldestNote(needing) {
      if (!needing.length) {
        var scope = severityScope();
        return scope
          ? 'No ' + scope + ' problem is waiting for a person'
          : 'Nothing is waiting for a person';
      }
      var oldest = model.iso(model.oldest(needing.map(function (p) { return p.firedAt; })));
      if (!oldest) return fmt.plural(needing.length, 'problem') + ' waiting';
      return 'Oldest ' + fmt.since(oldest);
    }

    function owners(takenOn) {
      var names = takenOn.map(function (p) { return p.acknowledgedByEmail; })
        .filter(Boolean);
      if (!names.length) return 'Taken on';
      if (names.length === 1) return 'Owned by ' + names[0];
      return 'Owned by ' + names.length + ' people';
    }

    /* Every one of these is a count of enabled rules, so they can be read
       against each other and against the number beside them. */
    function rulesNote(armed) {
      if (!armed.enabled) return 'None are enabled, so nothing is checking';
      if (armed.neverRun === armed.enabled) return 'None have run yet';
      /* Both are said when both are true. A ladder that reports only the worst
         reason leaves the rules that cannot judge unmentioned anywhere on the
         tile, and "1 failed their own check" beside "5 of 5" reads as though
         the other four are fine. */
      if (armed.errored && armed.insufficientData) {
        return fmt.int(armed.errored) + ' failed their own check, ' +
          fmt.int(armed.insufficientData) + ' cannot judge yet';
      }
      if (armed.errored) {
        return fmt.int(armed.errored) + ' failed their own check';
      }
      if (armed.insufficientData) {
        return fmt.int(armed.insufficientData) + ' cannot judge yet';
      }
      if (armed.checking < armed.enabled) {
        return fmt.int(armed.checking) + ' of them reached a verdict last time';
      }
      return 'All checking normally, last ' + fmt.ago(armed.lastEvaluatedAt);
    }

    /* A rate over too few closures says nothing, so below five it reports the
       counts instead of a percentage that would move ten points per problem.

       A full page of closures makes the rate unavailable rather than
       approximate. The read keeps the oldest closures and drops the newest, so
       a window that ends today is missing precisely the closures it is meant
       to be measuring, and a wrong rate is worse here than no rate: this
       figure is the one that decides whether a rule gets turned off. */
    function falseAlarmTile(data) {
      var scope = severityScope();
      var label = scopedLabel('False alarms, 30 days');

      if (model.capped(data.closed.problems)) {
        return tile(label, fmt.none, null,
          'More problems have been closed than this page can read, and the oldest are ' +
          'read first, so the last 30 days cannot be worked out from them');
      }

      var cutoff = Date.now() - 30 * 86400000;
      var recent = data.closed.problems.filter(function (p) {
        var closed = time(p.closedAt);
        return closed !== null && closed >= cutoff;
      });
      var nothingToDo = recent.filter(function (p) {
        return p.closeReason === 'no_action_needed';
      });

      if (!recent.length) {
        return tile(label, 'None yet', null,
          scope
            ? 'No ' + scope + ' problem has been closed in the last 30 days'
            : 'Nothing has been closed in the last 30 days');
      }
      if (recent.length < 5) {
        return tile(label,
          fmt.int(nothingToDo.length) + ' of ' + fmt.int(recent.length), null,
          'Too few closures to give a rate');
      }
      return tile(label,
        fmt.pct((nothingToDo.length / recent.length) * 100, 0), null,
        'Closed as nothing to do');
    }

    /* ------------------------------------------------------- problem list */

    function problemList(list, data) {
      var wrap = h('div', { className: 'alert-list' });
      list.forEach(function (problem) {
        wrap.appendChild(problemItem(problem, data));
      });
      return wrap;
    }

    function problemItem(problem, data) {
      var item = h('div', {
        className: 'alert-item sev-' + (SEVERITY_TONE[problem.severity] || 'info')
      });
      item.appendChild(h('div', { className: 'sev', 'aria-hidden': 'true' }));

      var body = h('div', { className: 'alert-body' });

      var tags = h('div', { className: 'row row-wrap' });
      tags.appendChild(op.statusBadge(
        SEVERITY_TONE[problem.severity],
        SEVERITY_LABEL[problem.severity] || problem.severity
      ));
      tags.appendChild(h('span', { className: 'mono tiny muted', text: problem.reference }));
      tags.appendChild(h('span', { className: 'badge', text: problem.categoryLabel }));
      body.appendChild(tags);

      /* The heading holds the button rather than the other way round: a
         heading is not phrasing content and cannot live inside a button, and
         the list needs real headings to be navigable. */
      var open = h('button', { className: 'alert-open', type: 'button' });
      open.appendChild(h('span', { text: problem.title }));
      open.appendChild(h('span', {
        className: 'sr-only', text: ', open details for ' + problem.reference
      }));
      open.addEventListener('click', function () { openDrawer(problem, data); });
      body.appendChild(h('h3', { className: 'alert-title' }, [open]));

      body.appendChild(h('p', { className: 'alert-desc', text: problem.summary }));

      var meta = h('div', { className: 'alert-meta' });
      if (problem.firedAt) {
        meta.appendChild(h('span', {
          text: 'Fired ' + fmt.stamp(problem.firedAt) + ', ' + fmt.ago(problem.firedAt)
        }));
      }
      if (problem.ruleThreshold) {
        meta.appendChild(h('span', {
          text: 'Rule: ' + problem.ruleTitle + ', ' + problem.ruleThreshold
        }));
      } else {
        meta.appendChild(h('span', { text: 'Rule: ' + problem.ruleTitle }));
      }
      if (problem.scopeLabel) {
        meta.appendChild(h('span', { text: 'Affects: ' + problem.scopeLabel }));
      }
      body.appendChild(meta);
      item.appendChild(body);

      item.appendChild(problemSide(problem));
      return item;
    }

    function problemSide(problem) {
      var side = h('div', { className: 'alert-side' });

      if (problem.status === 'closed') {
        side.appendChild(op.badge('', 'check',
          CLOSE_REASON_LABEL[problem.closeReason] || 'Closed'));
        side.appendChild(h('span', {
          className: 'tiny muted',
          text: problem.closedByEmail
            ? 'by ' + problem.closedByEmail
            : 'Closed ' + fmt.ago(problem.closedAt)
        }));
      } else {
        side.appendChild(op.statusBadge(
          STATUS_TONE[problem.status], STATUS_LABEL[problem.status] || problem.status
        ));
        if (problem.status === 'acknowledged' && problem.acknowledgedByEmail) {
          side.appendChild(h('span', { className: 'tiny muted', text: problem.acknowledgedByEmail }));
        }
        if (problem.status === 'open') {
          if (canAct) side.appendChild(takeOnButton(problem));
          else {
            side.appendChild(h('span', {
              className: 'tiny muted', text: 'Taking this on needs the operator role'
            }));
          }
        }
      }

      var file = PANE_FILE[problem.workPane];
      if (file) side.appendChild(op.link(file, problem.workPaneLabel));
      return side;
    }

    function takeOnButton(problem) {
      var btn = h('button', {
        className: 'btn btn-sm btn-primary', type: 'button', text: 'I am on it'
      });
      btn.appendChild(h('span', {
        className: 'sr-only', text: ', take on ' + problem.reference
      }));
      btn.addEventListener('click', function () {
        btn.disabled = true;
        acknowledge(problem).catch(function () { btn.disabled = false; });
      });
      return btn;
    }

    /* ---------------------------------------------------------- the count */

    function countLine(list, data) {
      var line = h('p', { className: 'vrow' });
      var parts = [];

      parts.push('Showing ' + fmt.plural(list.length, 'problem') + '.');
      var scope = severityScope();
      if (scope) {
        parts.push('The severity filter is applied by the operations API, so the problem ' +
          'counts above were read over ' + scope + ' problems only.');
      }
      if (picked.category !== 'all') {
        parts.push('The category filter is applied to what was read rather than to the whole ' +
          'record, so this is a count of the problems on screen.');
      }
      /* The disclosure has to name which problems went missing, not only that
         some did. A read comes back worst first and then oldest and stops at
         PAGE, so a full page keeps the oldest of each severity and drops the
         most recent. Saying "older problems are not counted" would be the
         opposite of what happened.

         Open and closed are two reads and are disclosed separately. Warning
         that both are short when only one of them is tells the operator a
         complete figure is incomplete, and a disclosure that cries wolf is
         ignored on the day it is the one that matters. The closed read is
         named here only when the window puts closed problems in this list; the
         false-alarm tile states its own truncation where it happens. */
      if (model.capped(data.open.problems)) {
        parts.push('Only ' + PAGE + ' open problems can be read at a time, worst first and then ' +
          'oldest, and that many came back, so the most recent ones are missing from this ' +
          'count and from the figures above.');
      }
      if (model.capped(data.closed.problems) && RANGE_DAYS[filters.range]) {
        parts.push('The closed problems were read the same way and also came back full, so the ' +
          'most recent closures are missing from this count too.');
      }
      line.textContent = parts.join(' ');
      return line;
    }

    /* --------------------------------------------------------- empty state */

    /* Nothing to show is three different facts, and telling them apart is the
       whole point of this state. Either a filter matched nothing, or the rules
       are checking and found nothing, or the rules are not in a position to
       find anything. Only the second of those is a statement about the health
       of the system, and it is the only one allowed to make it. */
    function emptyState(data, armed) {
      var wrap = h('div', { className: 'stack' });
      var actions = [];
      var filtered = narrowed();

      if (filtered) {
        var clear = h('button', {
          className: 'btn', type: 'button', text: 'Clear the filters'
        });
        clear.addEventListener('click', function () {
          picked.severity = 'all';
          picked.category = 'all';
          resetFilterControls();
          /* The window is a filter like the other two and is counted as one by
             narrowed() and named by filterSentence(), so a button that offers
             to clear the filters has to clear it as well. It belongs to the
             shell, which puts it back and announces the change; the pane hears
             that announcement and re-reads, so this only reloads itself when
             the window was already the one the pane starts on. */
          if (!shell.resetRange()) load();
        });
        actions.push(clear);
      }

      if (filtered) {
        /* A filter that matched nothing says nothing about anything outside
           it. A critical problem can be open one control away from this
           sentence, so this branch never claims the system is well and never
           reads the rules for a verdict on it.

           It is also the one empty state a full read can reach, when the
           hundred problems that came back are all outside the window or the
           category, so it carries the same disclosure the count line would
           have. */
        var missLines = [
          'No problem matches ' + filterSentence() + '.',
          'This says nothing about the problems these filters exclude. Clear them to see ' +
            'everything that is open.'
        ];
        /* A filtered miss replaces the whole pane, headline included, so the
           one thing that is true whatever the filters say has to be said in
           this state as well. Otherwise selecting a severity over stopped
           alerting reports only that nothing matched. */
        if (!armed.trustworthy) {
          missLines.push(notArmedSentence(armed) +
            ' That is the case whatever these filters are set to.');
        }
        if (model.capped(data.open.problems) ||
            (model.capped(data.closed.problems) && RANGE_DAYS[filters.range])) {
          missLines.push('Only ' + PAGE + ' problems could be read, worst first and then ' +
            'oldest, so the most recent ones were not looked at either.');
        }
        wrap.appendChild(op.paneState('empty', 'Nothing matches these filters', missLines, actions));
      } else if (armed.trustworthy) {
        wrap.appendChild(op.paneState('check', 'Nothing needs attention', [
          'Nothing is wrong that any rule can see. ' +
            fmt.int(armed.checking) + ' of ' + fmt.int(armed.total) +
            ' rules are enabled and reached a verdict the last time they ran.',
          lastActivitySentence(armed)
        ], actions));
      } else {
        wrap.appendChild(op.paneState('warn', 'Nothing is being reported, and that is the problem', [
          notArmedSentence(armed),
          'An empty problems page and alerting that has stopped look identical, so this page ' +
            'says which one it is. Treat this as unmonitored until the rules are checking again.'
        ], actions));
      }

      wrap.appendChild(lowerBand(data, armed));
      return wrap;
    }

    /* The filters in the words the controls use, so the sentence names what to
       undo rather than saying "your filters" and leaving the operator to find
       them. */
    function filterSentence() {
      var bits = [];
      if (picked.severity !== 'all') {
        bits.push('severity ' + (SEVERITY_LABEL[picked.severity] || picked.severity).toLowerCase());
      }
      if (picked.category !== 'all') {
        var category = CATEGORIES.filter(function (c) { return c.value === picked.category; })[0];
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
      if (armed.lastEvaluatedAt) {
        bits.push('Last checked ' + fmt.ago(armed.lastEvaluatedAt) + '.');
      }
      bits.push(armed.lastFiredAt
        ? 'The last problem fired ' + fmt.ago(armed.lastFiredAt) + '.'
        : 'No problem has ever fired.');
      return bits.join(' ');
    }

    /* Why nothing is being judged, each reading of it separately, because they
       need different things done about them. */
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

    /* -------------------------------------------------- rules and routing */

    /* The band under the queue answers a different question from the queue
       itself: not "what is wrong" but "would we know". It gets its own heading
       so the pane can be navigated by structure, and so the cards in it are
       not filed under the list of open problems. */
    function lowerBand(data, armed) {
      var band = h('div', { className: 'stack' });
      band.appendChild(op.bandHead('Would we know',
        'The rules that watch, and where what they find is sent'));

      var grid = h('div', { className: 'grid g2' });
      grid.appendChild(rulesCard(armed));

      var right = h('div', { className: 'stack' });
      right.appendChild(volumeCard(data));
      right.appendChild(routingCard(armed));
      grid.appendChild(right);

      band.appendChild(grid);
      return band;
    }

    function rulesCard(armed) {
      var card = h('div', { className: 'card' });
      card.appendChild(op.cardHead('Alert rules',
        fmt.int(armed.enabled) + ' of ' + fmt.int(armed.total) + ' enabled, ' +
        fmt.int(armed.checking) + ' reaching a verdict'));

      var body = h('div', { className: 'card-body' });

      var head = h('div', { className: 'rule-row rule-head', 'aria-hidden': 'true' }, [
        h('span', { text: 'Rule' }),
        h('span', { text: 'Threshold' }),
        h('span', { text: 'Route' }),
        h('span', { text: 'On' })
      ]);
      body.appendChild(head);

      armed.rules.forEach(function (rule) {
        body.appendChild(ruleRow(rule));
      });
      card.appendChild(body);

      card.appendChild(h('div', { className: 'card-foot' }, [
        h('span', {
          text: 'Every rule states a threshold and a duration. A rule without a duration ' +
                'fires on a single sample and becomes noise within a week.' +
                (isOwner ? '' : ' Only the owner role can turn a rule on or off.')
        })
      ]));
      return card;
    }

    function ruleRow(rule) {
      var row = h('div', { className: 'rule-row' });

      var name = h('div');
      name.appendChild(h('div', { className: 'strong', text: rule.title }));
      if (rule.scopeDescription) {
        name.appendChild(h('div', { className: 'tiny muted', text: rule.scopeDescription }));
      }

      /* A rule that is enabled but cannot judge is not a rule that is
         checking, and the row has to say so where the eye already is. */
      if (rule.enabled && rule.lastEvaluationStatus &&
          rule.lastEvaluationStatus !== 'ok' && rule.lastEvaluationStatus !== 'firing') {
        var note = EVALUATION_LABEL[rule.lastEvaluationStatus] || rule.lastEvaluationStatus;
        if (rule.lastEvaluationStatus === 'insufficient_data' && rule.lastInsufficientReason) {
          note += ', ' + (INSUFFICIENT_REASON[rule.lastInsufficientReason] ||
            rule.lastInsufficientReason);
        }
        name.appendChild(op.statusBadge(
          EVALUATION_TONE[rule.lastEvaluationStatus] || 'warn', note
        ));
      } else if (rule.enabled && rule.lastEvaluatedAt === null) {
        name.appendChild(op.statusBadge('warn', 'Has not run yet'));
      }
      row.appendChild(name);

      row.appendChild(h('span', {
        className: 'mono tiny', text: rule.thresholdLabel || fmt.none
      }));
      row.appendChild(h('span', {
        className: 'tiny',
        text: (rule.channels || []).length
          ? rule.channels.map(channelWord).join(', ')
          : 'Nowhere'
      }));
      row.appendChild(ruleToggle(rule));
      return row;
    }

    function channelWord(channel) {
      return channel === 'teams' ? 'Teams' : channel === 'email' ? 'Email' : channel;
    }

    /* A real checkbox carrying role="switch", so it is focusable, announced
       with its state, and driven by the label the row already gives it. Only
       the owner may change one; everybody else sees the true state, disabled,
       which is a fact rather than a control that would be refused. */
    function ruleToggle(rule) {
      var input = h('input', {
        className: 'switch', type: 'checkbox', role: 'switch',
        'aria-label': (rule.enabled ? 'Turn off ' : 'Turn on ') + rule.title
      });
      input.checked = rule.enabled;
      if (!isOwner) {
        /* Shown in its true state rather than hidden, and disabled rather than
           left live to be refused by the server. The card's footer says which
           role would be needed, because a disabled control on its own does not
           say why. */
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
          shell.toast('check', rule.title + (next ? ' turned on' : ' turned off'));
          load();
        }).catch(function (err) {
          /* Put the switch back where it was. It shows what the rule is, and
             a switch left in a position the server refused is a lie. */
          input.checked = !next;
          input.disabled = false;
          shell.toast('warn', op.failureMessage(err));
        });
      });
      return input;
    }

    /* Volume over the last thirty days, bucketed in fives, from the problems
       that were read. It is a check on the rules rather than on the system:
       if this climbs while incidents do not, the rules are wrong. */
    function volumeCard(data) {
      var card = h('div', { className: 'card' });
      var legend = h('div', { className: 'legend' }, [
        legendItem('var(--s5)', 'Critical'),
        legendItem('var(--s3)', 'Warning')
      ]);
      card.appendChild(op.cardHead('Problem volume', 'Last 30 days by severity', [legend]));

      var body = h('div', { className: 'card-body' });

      /* A full read cannot be bucketed into a window that ends today. The
         problems that came back are the oldest of each severity, so the last
         bucket would be short by an unknown amount and the chart would read as
         volume falling away exactly when it was rising. There is no honest
         chart to draw from this, so none is drawn. */
      if (model.capped(data.open.problems) || model.capped(data.closed.problems)) {
        body.appendChild(op.partFailure('Volume cannot be counted right now',
          'More problems exist than the ' + PAGE + ' this page can read at a time, and the ' +
          'oldest are read first, so the last 30 days would be counted short. The list above ' +
          'is still every problem that was read.'));
        card.appendChild(body);
        return card;
      }

      var buckets = 6, days = 5;
      var start = Date.now() - buckets * days * 86400000;
      var labels = [];
      var critical = [];
      var warning = [];

      for (var i = 0; i < buckets; i++) {
        labels.push(dayLabel(new Date(start + i * days * 86400000)));
        critical.push(0);
        warning.push(0);
      }

      var fired = 0;
      data.open.problems.concat(data.closed.problems).forEach(function (p) {
        var t = time(p.firedAt);
        if (t === null || t < start) return;
        var index = Math.min(buckets - 1, Math.floor((t - start) / (days * 86400000)));
        if (p.severity === 'critical') { critical[index]++; fired++; }
        else if (p.severity === 'warning') { warning[index]++; fired++; }
      });

      if (!fired) {
        body.appendChild(h('p', {
          className: 'small muted',
          text: 'No critical or warning problem has fired in the last 30 days. ' +
                'That is the chart being empty, not the chart being broken.'
        }));
      } else {
        body.appendChild(op.lineChart({
          height: 168,
          labels: labels,
          series: [
            { color: 'var(--s5)', values: critical },
            { color: 'var(--s3)', values: warning }
          ],
          label: 'Problem counts by severity over the last 30 days'
        }));
        body.appendChild(h('p', {
          className: 'axis-note mt-sm',
          text: 'Volume is deliberately low. If this climbs without incidents climbing, ' +
                'the rules are wrong rather than the system.'
        }));
      }
      card.appendChild(body);
      return card;
    }

    function legendItem(colour, label) {
      var item = h('span');
      var swatch = h('i');
      swatch.style.background = colour;
      item.appendChild(swatch);
      item.appendChild(document.createTextNode(label));
      return item;
    }

    /* Where a problem actually goes. A problem that only ever appears on this
       page is a log line pretending to be an alert, so the pane states, per
       channel, whether it is set up and what the last delivery did. */
    function routingCard(armed) {
      var card = h('div', { className: 'card' });
      card.appendChild(op.cardHead('Where problems are sent'));
      var body = h('div', { className: 'card-body stack-sm' });

      if (!armed.channels.length) {
        body.appendChild(h('p', {
          className: 'small muted', text: 'No notification channel is set up.'
        }));
      }

      armed.channels.forEach(function (channel) {
        var row = h('div', { className: 'route-row' });
        var text = h('div');
        text.appendChild(h('div', { className: 'small strong', text: channel.label }));
        text.appendChild(h('div', { className: 'tiny muted', text: channelNote(channel) }));
        row.appendChild(text);

        var status = channel.configured
          ? (CHANNEL_STATUS[channel.lastDeliveryStatus] || null)
          : CHANNEL_STATUS.unconfigured;

        if (!status) {
          row.appendChild(op.statusBadge('idle', 'Nothing sent yet'));
        } else {
          row.appendChild(op.statusBadge(status.tone, status.label));
        }
        body.appendChild(row);
      });

      var unconfigured = armed.channels.filter(function (c) { return !c.configured; });
      if (unconfigured.length) {
        body.appendChild(op.notConfigured('Not everything is set up.',
          'A channel with nothing behind it is not failing, it was never connected. ' +
          'Until it is, a problem routed only there reaches nobody.'));
      }

      card.appendChild(body);
      return card;
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

    /* ------------------------------------------------------------ actions */

    /* Every change re-reads the pane, which throws away the control that was
       just used and with it whatever had focus. The content region is the one
       element that survives a re-render, so focus goes there and the change is
       announced, rather than being dropped on the body where a keyboard user
       would have to tab back in from the top of the page.

       It waits for the re-read to land first. Moving focus while the overlays
       are still up and the background is inert does nothing, and moving it to
       a control that the re-render is about to remove drops it on the body a
       moment later, which is the thing this is here to prevent. If the
       operator has already put focus somewhere themselves by then, it is left
       where they put it. */
    function afterChange(message) {
      shell.announce(message);
      return load().then(function () {
        var host = document.getElementById('content');
        var live = document.activeElement;
        if (host && (!live || live === document.body)) host.focus();
      });
    }

    function acknowledge(problem) {
      return session.call(
        '/api/ops/alerts/problems/' + encodeURIComponent(problem.id) + '/acknowledge',
        { method: 'POST' }
      ).then(function () {
        shell.toast('check', 'You are on ' + problem.reference + '. Everyone else can see that.');
        afterChange('You are now on ' + problem.reference + '.');
      }).catch(function (err) {
        /* Somebody else got there first, or the problem moved on while the
           page was open. Neither is an error the operator caused, so the pane
           says what happened and re-reads rather than showing a failure. */
        if (err && err.code === 'ops_problem_moved') {
          shell.toast('info', 'Somebody else changed ' + problem.reference + ' first.');
          afterChange('Somebody else changed ' + problem.reference + ' first. The page has been re-read.');
          return;
        }
        shell.toast('warn', op.failureMessage(err));
        throw err;
      });
    }

    function closeProblem(problem, choice, note) {
      return session.call(
        '/api/ops/alerts/problems/' + encodeURIComponent(problem.id) + '/close',
        { method: 'POST', body: { reason: choice, note: note || undefined } }
      ).then(function () {
        var words = problem.reference + ' closed as ' +
          (CLOSE_REASON_LABEL[choice] || choice).toLowerCase() + '.';
        shell.toast('check', words);
        afterChange(words);
      }).catch(function (err) {
        /* Somebody else closed it while this dialog was open, exactly as they
           can while the take-on button is on screen. The problem is in the
           state the operator wanted it in, so this is not a failure to show
           them: the pane re-reads and the dialog settles as it would have on
           success, rather than leaving them staring at an error over a screen
           that is already stale. */
        if (err && err.code === 'ops_problem_moved') {
          shell.toast('info', 'Somebody else changed ' + problem.reference + ' first.');
          afterChange('Somebody else changed ' + problem.reference +
            ' first. The page has been re-read.');
          return;
        }
        throw err;
      });
    }

    /* ------------------------------------------------------------- drawer */

    function openDrawer(problem, data) {
      var d = op.drawer({});
      drawerHead(d, problem);
      d.setBody([op.skeleton([{ type: 'block', height: 120 }, { type: 'rows', count: 5 }])]);

      session.call('/api/ops/alerts/problems/' + encodeURIComponent(problem.id))
        .then(function (payload) {
          var detail = payload.data;
          drawerHead(d, detail.problem);
          d.setBody(drawerBody(detail, data));
          drawerFoot(d, detail.problem);
        })
        .catch(function (err) {
          d.setBody([op.partFailure('Could not open this problem',
            op.failureMessage(err), function () {
              d.close();
              openDrawer(problem, data);
            })]);
        });
    }

    function drawerHead(d, problem) {
      d.head.textContent = '';
      var tags = h('div', { className: 'row row-wrap' });
      tags.appendChild(op.statusBadge(
        SEVERITY_TONE[problem.severity], SEVERITY_LABEL[problem.severity] || problem.severity
      ));
      tags.appendChild(h('span', { className: 'mono strong', text: problem.reference }));
      tags.appendChild(h('span', { className: 'badge', text: problem.categoryLabel }));
      d.head.appendChild(tags);

      d.head.appendChild(h('h2', {
        className: 'drawer-head-title', id: d.titleId, text: problem.title
      }));
      d.head.appendChild(h('p', { className: 'drawer-head-sub', text: headSentence(problem) }));
    }

    function headSentence(problem) {
      if (problem.status === 'closed') {
        return 'Closed ' + fmt.ago(problem.closedAt) +
          (problem.closeReason
            ? ' as ' + (CLOSE_REASON_LABEL[problem.closeReason] || problem.closeReason).toLowerCase()
            : '') +
          (problem.closedByEmail ? ' by ' + problem.closedByEmail : '');
      }
      if (problem.status === 'acknowledged') {
        return 'Started ' + fmt.stamp(problem.firedAt) + ', taken on by ' +
          (problem.acknowledgedByEmail || 'an administrator') + ' ' + fmt.ago(problem.acknowledgedAt);
      }
      return 'Started ' + fmt.stamp(problem.firedAt) + ', nobody on it for ' +
        fmt.since(problem.firedAt);
    }

    function drawerBody(detail, data) {
      var problem = detail.problem;
      var nodes = [];

      var impact = h('div', { className: 'callout callout-' +
        (problem.severity === 'critical' ? 'crit' : problem.severity === 'warning' ? 'warn' : 'info') });
      impact.appendChild(icon(problem.severity === 'info' ? 'info' : 'warn'));
      impact.appendChild(h('div', { text: problem.summary }));
      nodes.push(impact);

      nodes.push(op.dl([
        { label: 'Rule', value: problem.ruleTitle, plain: true },
        { label: 'What it watches for', value: problem.ruleThreshold, plain: true },
        { label: 'Observed', value: observedText(problem, data) },
        { label: 'Scope', value: problem.scopeLabel, plain: true },
        { label: 'Category', value: problem.categoryLabel, plain: true },
        { label: 'First seen', value: fmt.stamp(problem.firstBreachedAt), plain: true },
        { label: 'Fired', value: problem.firedAt ? fmt.stamp(problem.firedAt) : null, plain: true },
        { label: 'Last seen', value: fmt.stamp(problem.lastObservedAt), plain: true },
        {
          label: 'Condition',
          value: problem.conditionClearedAt
            ? 'Stopped ' + fmt.ago(problem.conditionClearedAt)
            : 'Still happening',
          plain: true
        },
        { label: 'Where the work happens', value: problem.workPaneLabel, plain: true }
      ]));

      if (detail.runbook && detail.runbook.length) {
        var runbookWrap = h('div');
        runbookWrap.appendChild(op.secHead('What to do', null, 3));
        var runbookCard = h('div', { className: 'card runbook-card' });
        var runbookBody = h('div', { className: 'card-body' });
        var steps = h('ol', { className: 'runbook' });
        detail.runbook.forEach(function (step) {
          steps.appendChild(h('li', { text: step }));
        });
        runbookBody.appendChild(steps);

        var file = PANE_FILE[problem.workPane];
        if (file) {
          var row = h('div', { className: 'row row-wrap mt-sm' });
          row.appendChild(op.link(file, 'Open ' + problem.workPaneLabel));
          runbookBody.appendChild(row);
        }
        runbookCard.appendChild(runbookBody);
        runbookWrap.appendChild(runbookCard);
        nodes.push(runbookWrap);
      }

      if (detail.timeline && detail.timeline.length) {
        var timelineWrap = h('div');
        timelineWrap.appendChild(op.secHead('What has happened so far', null, 3));
        timelineWrap.appendChild(op.timeline(detail.timeline.map(function (event) {
          return {
            time: fmt.stamp(event.occurredAt),
            tone: EVENT_TONE[event.eventType] || '',
            text: (EVENT_LABEL[event.eventType] || event.eventType) +
              (event.actorEmail ? ' by ' + event.actorEmail : '')
          };
        })));
        nodes.push(timelineWrap);
      }

      if (detail.ruleHistory && detail.ruleHistory.length) {
        var historyWrap = h('div');
        historyWrap.appendChild(op.secHead('This rule has fired before',
          fmt.plural(detail.ruleHistory.length, 'earlier problem'), 3));
        historyWrap.appendChild(op.timeline(detail.ruleHistory.map(function (entry) {
          var outcome = entry.closedAt
            ? 'closed as ' +
              (CLOSE_REASON_LABEL[entry.closeReason] || entry.closeReason || 'resolved').toLowerCase()
            : 'still open';
          return {
            time: entry.firedAt ? fmt.stamp(entry.firedAt) : fmt.none,
            tone: entry.closedAt ? 'ok' : 'warn',
            text: entry.reference + ', ' + entry.title + ', ' + outcome
          };
        })));
        nodes.push(historyWrap);
      }

      return nodes;
    }

    /* The observed figure only means something with its unit, and the unit
       lives on the rules endpoint rather than on the problem. Where the rule
       is not in hand the row is left out: a bare 5870 next to a threshold of
       "below 95%" would be worse than saying nothing. */
    function observedText(problem, data) {
      if (!fmt.isNum(problem.observedValue)) return null;
      var rule = (data.rules.rules || []).filter(function (r) {
        return r.ruleKey === problem.ruleKey;
      })[0];
      if (!rule || !rule.thresholdUnit) return null;
      if (rule.thresholdUnit === 'basis_points') return fmt.pct(problem.observedValue / 100);
      if (rule.thresholdUnit === 'seconds') return fmt.duration(problem.observedValue);
      return fmt.int(problem.observedValue);
    }

    function drawerFoot(d, problem) {
      d.foot.textContent = '';
      if (problem.status === 'closed') {
        d.foot.appendChild(h('span', {
          className: 'small muted', text: 'This problem is closed. Nothing more to do here.'
        }));
        return;
      }
      if (!canAct) {
        d.foot.appendChild(h('span', {
          className: 'small muted',
          text: 'Taking a problem on and closing it need the operator role.'
        }));
        return;
      }

      if (problem.status === 'open') {
        var take = h('button', {
          className: 'btn btn-primary', type: 'button', text: 'I am on it'
        });
        take.addEventListener('click', function () {
          take.disabled = true;
          acknowledge(problem).then(function () { d.close(); })
            .catch(function () { take.disabled = false; });
        });
        d.foot.appendChild(take);
      }

      var close = h('button', { className: 'btn', type: 'button', text: 'Close this problem' });
      close.addEventListener('click', function () {
        /* The drawer is closed by the action that closed the problem, and the
           overlay stack holds that request until the dialog above it has come
           down, so the two still come down in the order they went up and focus
           is still handed back down the stack rather than across it. Asking
           here rather than from the dialog's own close is what makes the
           drawer's fate depend on the call settling rather than on the dialog
           having been dismissed in a particular way. */
        op.confirmAction({
          title: 'Close ' + problem.reference + '?',
          lines: [
            'Closing records who closed it and why. If the condition comes back, ' +
              'a new problem is raised rather than this one reopening.'
          ],
          choices: {
            label: 'Why is it being closed?',
            value: 'resolved',
            options: [
              { value: 'resolved', label: 'Resolved, somebody fixed it' },
              { value: 'no_action_needed', label: 'Nothing to do, it did not need a person' }
            ]
          },
          reasonLabel: 'Note, kept with the record (optional)',
          confirmLabel: 'Close it',
          cancelLabel: 'Leave it open',
          onConfirm: function (result) {
            return closeProblem(problem, result.choice, result.reason)
              .then(function () { d.close(); });
          }
        });
      });
      d.foot.appendChild(close);

      var file = PANE_FILE[problem.workPane];
      if (file) {
        d.foot.appendChild(h('div', { className: 'spacer' }));
        d.foot.appendChild(op.link(file, 'Open ' + problem.workPaneLabel, 'btn'));
      }
    }

    load();
  });
})(window);
