/* What happened: why did this fail, and is it happening to other people?

   WHAT THIS PANE CAN ACTUALLY ANSWER TODAY, AND WHAT IT CANNOT

   There is no per-run record behind this page. Nothing serves one: app-backend
   mounts no route that lists runs, their durations, their stages or their
   memory, so every figure of that kind is absent rather than zero. What does
   exist is the alerting record — the problems the watchers raised and the
   rules that raised them — and that is a real, if narrower, answer to "what
   happened": it is every failure anybody was watching for.

   So this pane draws the alerting record and NAMES the rest as missing, in a
   band of its own, rather than drawing an empty chart where a figure would go.
   An operator who cannot tell "nothing failed" from "nothing was recorded" has
   been told nothing, and the more confident of the two readings is the wrong
   one.

   THE SIX GUARANTEES THIS PANE MAKES TO THE ATHLETE, and where each is on
   screen. They are the same six the Look up a user pane makes, because a
   guarantee that means one thing on one pane and something else on the next is
   not a guarantee. Each is a sentence somebody can read as well as a property
   of the code, and scripts/ops-run-history-v2.test.mjs asserts the sentence
   and the mechanism separately: a sentence that outlives the thing it
   describes is the worse of the two failures.

     1. coded references by default
        -> coded(), which masks address-shaped text before it reaches the DOM,
           whatever the API sent, on every payload string this pane draws
     2. what was asked, what Aria answered, and personal details are hidden for
        every role, the owner included, until a reveal is recorded
        -> disclosure(), which refuses run content at every role, plus the
           three locked rows in the privacy band
     3. a reveal is owner only and needs a written reason
        -> no reveal control exists here at any role. The band says where one
           is recorded and links to it
     4. a reveal is recorded by field name, never by content
        -> the locked rows carry field NAMES and no value node at all
     5. the athlete can see that it happened and who did it
        -> the band's note, and the link to the pane that holds the record
     6. records outlive the reveal and cannot be erased by one
        -> the band foot: kept for the life of the account

   Guarantees 3 and 5 are mechanisms on the Look up a user pane rather than
   here, and the wording says so rather than implying this page performs them.
   A control that cannot succeed is worse than no control, so this pane draws
   none: PR #58 settled that. PR #32 settled that reveal 'never' dominates
   masked false; this pane has no branch that prints a value at all, so that
   contest cannot arise here, and nothing below weakens it where it does.

   WHAT THIS PANE READS

     GET /api/ops/alerts/problems ?status=all&limit=100
       -> { data: { problems[], summary } }

       problems[]  the shape assets/alerts-model.js is written against:
                   { reference, ruleKey, ruleTitle, ruleThreshold, severity,
                     category, categoryLabel, status, title, summary,
                     scopeKey, scopeLabel, observedValue, thresholdValue,
                     firstBreachedAt, firedAt, lastObservedAt,
                     conditionClearedAt, acknowledgedAt, closedAt, closeReason }

       The route takes no window. It orders worst first and then oldest and
       stops at a page, so a full page is not "the most recent hundred" — it is
       the hundred worst. Every count taken from a full page is therefore a
       floor, and the window this pane applies on top of it can be missing
       entries that fall inside it. Both facts are printed rather than assumed
       away.

     GET /api/ops/alerts/rules
       -> { data: { rules[], channels[] } }

       Read only to answer "was anything watching". A window with no failures
       in it is good news only if something was in a position to notice one,
       and this read is the difference between the two. Its failure degrades
       the pane rather than emptying it.

   THE FILTER BAR

   The registry gives this pane a window control and nothing else. The window
   is real: it is applied here, to the problems that came back, and every
   figure on the page is labelled with it.

   The app and environment controls used to be declared too, and neither could
   act on the read:

     app scope     the record is kept per request type, not per app, so no
                   selection narrowed it, and the pane printed a note saying so
     environment   there is no staging alerting record, so a staging selection
                   was refused rather than answered

   Both are gone from the registry rather than explained underneath, and so is
   the custom window, which had no start and no end to be given and could only
   ever reach a refusal card. A pane that answers a selection it cannot act on
   has the operator's own choice sitting above figures that ignore it; a pane
   that draws a control it can only refuse has said the narrowing is within
   reach. Not drawing either is the answer to both. */

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

  var HOUR_MS = 3600000;
  var DAY_MS = 24 * HOUR_MS;

  /* The registry's window values, in milliseconds. Every value the registry
     offers has an entry here, and the guard in
     scripts/ops-registry-filters.test.mjs turns red on one that does not:
     a window this table cannot answer is a control that refuses rather than
     narrows, which is why 'custom' is no longer offered. */
  var WINDOW_MS = { '24h': DAY_MS, '7d': 7 * DAY_MS, '30d': 30 * DAY_MS };
  var WINDOW_LABEL = { '24h': 'the last 24 hours', '7d': 'the last 7 days', '30d': 'the last 30 days' };

  /* The pane that holds the account record, and the one that holds the live
     queue. Both are doorways: this pane owns neither question. */
  var USERS_FILE = 'users.html';
  var JOBS_FILE = 'jobs-live.html';

  /* ------------------------------------------------------------- privacy */

  /* The three things a run carries that are not this pane's to show, at any
     role. They are named because naming them is the point: a reveal is
     recorded by field name, so the names have to exist somewhere a person can
     read them, and they have to be the same names the record would use.

     Each carries a key and a label and nothing else. No masked flag, no reveal
     flag, no value: the floor below is what makes them hidden, so an API that
     later sends one of these keys with a value attached cannot unmask it by
     saying it is not personal. */
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
     DOM. This pane prints service facts — a rule title, a request type, a
     summary the alerting wrote — and none of them is a person. That is a
     property of today's payload rather than a promise the payload makes, so
     the pane enforces it instead of trusting it: a coded reference like
     ath_2277 passes through, an address does not.

     The replacement names the kind of thing it hid rather than deleting it
     silently, because an operator reading a sentence with a hole in it needs
     to know a hole is what they are looking at. */
  var EMAIL = /[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/g;

  function coded(text) {
    if (typeof text !== 'string' || !text) return '';
    return text.replace(EMAIL, '[hidden contact detail]');
  }

  /* --------------------------------------------------------- the figures */

  /* A figure is a number only when it is one. Everything else renders words.

     'ready' is the only availability that prints a numeral. A figure nobody
     recorded prints what it is instead, because a zero and an absence look
     identical once they are both set in the same type, and the confident
     reading is the wrong one. */
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
      body.appendChild(h('div', { className: 'kpi-meta' }, [
        h('span', { text: figure.note })
      ]));
    }
    box.appendChild(body);
    return box;
  }

  /* ------------------------------------------------------------ grouping */

  /* One row per reason a thing failed, which is the rule that caught it and
     the request type it caught it in. Two nutrition-plan failures four days
     apart are the same reason and one row; the same rule firing on chat is a
     different row, because the question this pane answers is "is it happening
     to other people", and the answer is the group. */
  function groupFailures(problems) {
    var index = {};
    var groups = [];

    problems.forEach(function (problem) {
      var key = problem.ruleKey + '\u0000' + (problem.scopeKey || '');
      var group = index[key];
      if (!group) {
        group = {
          key: key,
          ruleKey: problem.ruleKey,
          title: coded(problem.ruleTitle || problem.ruleKey || 'Unnamed rule'),
          where: coded(problem.scopeLabel || 'Every request type'),
          categoryLabel: coded(problem.categoryLabel || problem.category || ''),
          threshold: coded(problem.ruleThreshold || ''),
          severity: problem.severity,
          times: 0,
          active: 0,
          firstSeen: null,
          lastSeen: null,
          reference: problem.reference
        };
        index[key] = group;
        groups.push(group);
      }

      group.times += 1;
      if (problem.status === 'open' || problem.status === 'acknowledged') group.active += 1;
      if (model.severityRank(problem.severity) < model.severityRank(group.severity)) {
        group.severity = problem.severity;
      }

      var began = model.oldest([problem.firstBreachedAt, problem.firedAt]);
      var ended = model.latest([problem.lastObservedAt, problem.firedAt, problem.closedAt]);
      if (began !== Infinity && (group.firstSeen === null || began < group.firstSeen)) {
        group.firstSeen = began;
      }
      if (ended !== -Infinity && (group.lastSeen === null || ended > group.lastSeen)) {
        group.lastSeen = ended;
      }
    });

    /* Worst first, then the one that happened most. A list sorted by arrival
       buries the reason that has been costing people all week under the one
       that fired this morning. */
    groups.sort(function (a, b) {
      var bySeverity = model.severityRank(a.severity) - model.severityRank(b.severity);
      if (bySeverity) return bySeverity;
      if (b.times !== a.times) return b.times - a.times;
      return (b.lastSeen || 0) - (a.lastSeen || 0);
    });

    return groups;
  }

  /* Whether a problem was alive at any point inside the window. A problem that
     fired last week and is still open belongs in today's window: it is still
     happening. Comparing only the moment it fired would drop exactly the
     failures somebody is still living with. */
  function inWindow(problem, startMs) {
    if (startMs === null) return true;
    var ended = model.latest([problem.lastObservedAt, problem.closedAt, problem.firedAt,
      problem.firstBreachedAt]);
    return ended === -Infinity ? false : ended >= startMs;
  }

  /* ------------------------------------------------------------- the pane */

  S.definePane('history', function (content) {
    var region = S.region(content);
    var loadToken = 0;
    var current = S.filters();

    global.addEventListener('ops:filters', function (event) {
      var next = event.detail;
      var changed = next.range !== current.range;
      current = next;
      if (changed) load();
    });

    function load() {
      var token = ++loadToken;
      var selection = current;

      region.loading([
        { type: 'tiles', count: 4 },
        { type: 'rows', count: 6 },
        { type: 'block', height: 190 }
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

    /* The record read. Through the shell's loader so the same-origin fixture
       hook covers the states a live API will not produce on demand: a window
       nothing was raised in, a read that came back full, a system with nothing
       watching it.

       status 'all' because this pane is the past tense: a problem somebody
       closed on Tuesday is exactly what "what happened" means. */
    function problems() {
      return S.read({
        paneId: 'history',
        endpoint: PROBLEMS_ENDPOINT,
        query: { status: 'all', limit: model.PAGE }
      }).then(function (result) { return result.data; });
    }

    function render(record, rules, selection) {
      var all = (record && record.problems) || [];
      var capped = model.capped(all);
      var startMs = selection.range && WINDOW_MS[selection.range]
        ? Date.now() - WINDOW_MS[selection.range]
        : null;
      var inside = all.filter(function (problem) { return inWindow(problem, startMs); });
      var groups = groupFailures(inside);
      var armed = rules.error ? null : model.armedState(rules.data || {});

      if (!inside.length) {
        region.empty(nothingRaised(armed, selection, all.length));
        return;
      }

      var wrap = h('div', { className: 'stack' });
      selectionNotes(capped).forEach(function (note) { wrap.appendChild(note); });
      wrap.appendChild(summaryBand(inside, groups, armed, selection, capped));
      wrap.appendChild(failureBand(groups, capped));
      wrap.appendChild(privacyBand());
      wrap.appendChild(missingBand());

      if (rules.error) region.degraded(wrap);
      else region.show(wrap);
    }

    /* ------------------------------------------------------ the empties */

    /* The window came back readable and empty. Which of the two empties it is
       depends entirely on whether anything was watching, so that is what the
       state says. */
    function nothingRaised(armed, selection, held) {
      var box = S.card();
      var windowWords = WINDOW_LABEL[selection.range] || 'this window';

      if (armed && armed.trustworthy) {
        var lastRun = fmt.utcStamp(armed.lastEvaluatedAt);
        box.appendChild(S.stateBlock('check', 'Nothing was raised in ' + windowWords, [
          armed.checking + ' of ' + armed.total + ' rules were checking, and none of them ' +
            'reached a verdict worth raising' + (lastRun ? ', last at ' + lastRun : '') + '.',
          held
            ? 'The record does hold older entries. Widen the window to read them.'
            : 'The record holds nothing at all, which is a system nothing has gone wrong on yet.'
        ]));
      } else if (armed) {
        box.appendChild(S.stateBlock('warn', 'Nothing was raised, and nothing was watching', [
          'None of the ' + armed.total + ' rules reached a verdict the last time they ran, so ' +
            'an empty window here is not the same as a quiet one.',
          'This is a silence to go and fix rather than one to take comfort from.'
        ]));
      } else {
        box.appendChild(S.stateBlock('warn', 'Nothing was raised in ' + windowWords, [
          'The rules could not be read, so whether anything was watching is unknown. An ' +
            'empty window cannot be read as a quiet one until that answers.',
          'Everything else on this page came back.'
        ]));
      }

      var row = h('div', { className: 'row mt-sm' });
      row.appendChild(S.link(S.paneHref('jobs') || JOBS_FILE, 'What is running now'));
      box.appendChild(row);
      return box;
    }

    /* ------------------------------------------- what the record leaves out */

    function selectionNotes(capped) {
      var notes = [];

      if (capped) {
        notes.push(noteLine('warn',
          'The record came back full, worst first. Older or less severe entries inside ' +
          'this window can be missing from it, so every count below is a floor rather ' +
          'than a total.'));
      }

      return notes;
    }

    function noteLine(iconName, text) {
      var note = h('div', { className: 'note' });
      note.appendChild(icon(iconName));
      note.appendChild(h('div', { text: text }));
      return note;
    }

    /* ---------------------------------------------------- what happened */

    function summaryBand(inside, groups, armed, selection, capped) {
      var section = S.band('What the record shows',
        WINDOW_LABEL[selection.range] || 'the window you picked');

      var active = model.active(inside).length;
      var grid = h('div', { className: 'grid g4' });

      grid.appendChild(figureCard({
        label: 'Failures raised',
        availability: 'ready',
        text: model.atLeast(fmt.int(inside.length), capped),
        note: 'caught by a rule that was watching'
      }));

      grid.appendChild(figureCard({
        label: 'Still not fixed',
        availability: 'ready',
        text: model.atLeast(fmt.int(active), capped),
        note: active ? 'open or somebody is on it' : 'every one of them closed'
      }));

      grid.appendChild(figureCard({
        label: 'Distinct reasons',
        availability: 'ready',
        text: model.atLeast(fmt.int(groups.length), capped),
        note: 'a rule and the request type it caught'
      }));

      /* The two figures the mock asks for that nothing serves. They stay on
         the page as words rather than being quietly dropped, because an
         operator who does not know a figure is missing assumes it was fine. */
      grid.appendChild(figureCard({
        label: 'Runs in this window',
        availability: 'unrecorded',
        words: 'Not recorded',
        note: 'no route serves a run count yet'
      }));

      section.appendChild(grid);
      section.appendChild(watchingCard(armed));
      return section;
    }

    /* Whether the figures above were counted by anything. A failure count is
       only as good as the rules that produced it, and a count of nought from
       nothing watching reads exactly like a count of nought from a quiet
       night. */
    function watchingCard(armed) {
      if (!armed) {
        return noteLine('warn',
          'The rules could not be read, so how much of this window was actually watched ' +
          'is unknown. The failures below are the ones that were caught, not necessarily ' +
          'the ones that happened.');
      }

      if (!armed.trustworthy) {
        return noteLine('warn',
          'None of the ' + armed.total + ' rules reached a verdict the last time they ran, so ' +
          'this window was not being watched. What is below is what was caught before that.');
      }

      var lastRun = fmt.utcStamp(armed.lastEvaluatedAt);
      return noteLine('info',
        armed.checking + ' of ' + armed.total + ' rules were checking' +
        (lastRun ? ', last at ' + lastRun : '') +
        (armed.insufficientData
          ? '. ' + armed.insufficientData + ' had too little data to judge.'
          : '.'));
    }

    /* ------------------------------------------------- why things failed */

    function failureBand(groups, capped) {
      var section = S.band('Why things failed', 'Worst first, then how often');
      var box = S.card();
      var wrap = h('div', { className: 'tbl-wrap' });
      var table = h('table', { className: 'tbl' });

      var head = h('thead');
      var headRow = h('tr');
      ['Reason', 'Where', 'Times', 'First seen', 'Last seen', 'Still open', ''].forEach(function (label, at) {
        headRow.appendChild(h('th', {
          className: at === 2 || at === 5 ? 'r' : '',
          text: label,
          scope: 'col'
        }));
      });
      head.appendChild(headRow);
      table.appendChild(head);

      var body = h('tbody');
      groups.forEach(function (group) { body.appendChild(failureRow(group)); });
      table.appendChild(body);

      wrap.appendChild(table);
      box.appendChild(wrap);

      var foot = h('div', { className: 'card-foot' });
      foot.appendChild(h('span', {
        text: capped
          ? 'A full page came back, so these are at least this many.'
          : 'Everything the record held for this window is here.'
      }));
      foot.appendChild(S.link(S.paneHref('alerts') || 'alerts.html', 'Open Problems', 'btn btn-sm sp'));
      box.appendChild(foot);

      section.appendChild(box);
      return section;
    }

    function failureRow(group) {
      var row = h('tr');

      var reason = h('td');
      reason.appendChild(h('div', { className: 't-main', text: group.title }));
      if (group.threshold) {
        reason.appendChild(h('div', { className: 't-sub', text: group.threshold }));
      }
      row.appendChild(reason);

      var where = h('td');
      where.appendChild(h('div', { className: 't-main', text: group.where }));
      if (group.categoryLabel) {
        where.appendChild(h('div', { className: 't-sub', text: group.categoryLabel }));
      }
      row.appendChild(where);

      row.appendChild(h('td', { className: 'r num', text: fmt.int(group.times) }));
      row.appendChild(h('td', { text: fmt.utcStamp(model.iso(group.firstSeen)) || fmt.none }));
      row.appendChild(h('td', { text: fmt.utcStamp(model.iso(group.lastSeen)) || fmt.none }));

      var still = h('td', { className: 'r' });
      /* The tone is never the whole message: the pill carries the words as
         well, so a screen that is read rather than looked at says the same
         thing. */
      still.appendChild(h('span', {
        className: 'pill ' + (group.active ? 'down' : 'up'),
        text: group.active ? fmt.int(group.active) + ' still open' : 'all closed'
      }));
      row.appendChild(still);

      var end = h('td', { className: 'r' });
      end.appendChild(h('span', {
        className: 'pill ' + (model.SEVERITY_TONE[group.severity] === 'crit' ? 'down' : 'warn'),
        text: model.SEVERITY_LABEL[group.severity] || 'Unrated'
      }));
      row.appendChild(end);

      return row;
    }

    /* -------------------------------------------------------- privacy */

    function privacyBand() {
      var section = S.band('What was asked, and what Aria answered');
      var box = S.card('accent acc-vio');

      box.appendChild(S.cardHead(
        'Hidden here, at every role',
        'Including the owner, and including the person reading this'
      ));

      var body = h('div', { className: 'card-body col' });

      RUN_CONTENT.forEach(function (field) { body.appendChild(lockedRow(field)); });

      var promises = h('ul', { className: 'list-tick' });
      [
        'Nothing here names a person. What this page prints is a rule, a request type ' +
          'and a count, and anything arriving that looks like a contact detail is masked ' +
          'before it is drawn.',
        'What was asked, what Aria answered and the athlete details a run read are ' +
          'hidden for every role, the owner included, until a reveal is recorded.',
        'A reveal is an owner action and needs a written reason. There is no reveal ' +
          'control here, because this pane records none.',
        'A reveal is recorded by field name and never by content, so the record of an ' +
          'access never becomes a second copy of the thing accessed.',
        'The athlete can see that a reveal happened and who did it.',
        'Those records outlive the reveal. A reveal can never erase them.'
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
        text: 'Kept for the life of the account. A reveal is recorded where the account is: '
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
          title: 'The runs themselves',
          desc: 'No route lists runs, so there is no per-run table, no stage timeline ' +
            'and no retry history. What is above is every failure a rule caught, which ' +
            'is a narrower thing.'
        },
        {
          title: 'How long a run took',
          desc: 'Durations and memory are not served anywhere, so a median run time ' +
            'would be a number with nothing behind it.'
        },
        {
          title: 'What a single run did',
          desc: 'Opening one run needs a record of one run. Until that exists, a ' +
            'failure is readable as a group and not as an individual.'
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

    load();
  });
}(window));
