/* The status parts Today and Health share: the "is anything wrong" line, the
   live pulse, the compact problem rows, the reads behind them, and the retry
   engine that keeps a failed read from taking the page with it.

   Two pages draw these and neither may keep a copy. A second retry engine, a
   second reading of "No critical issues" or a second problem row is how two
   panes an operator moves between during one incident come to disagree about
   whether anything is wrong, so there is one of each, here.

   Loaded after assets/alerts-model.js and before the pane that uses it, on
   ops/index.html and ops/alerts.html. It draws nothing on its own: a pane calls
   OpsStatus.create() from inside its own definePane callback and gets back
   the functions that draw into the nodes the pane hosts.

   WHAT IT READS (the four reads both panes share)

     GET /api/ops/alerts/problems   the queue
     GET /api/ops/alerts/rules      whether anything is in a position to notice
     GET /api/ops/jobs              what is running, queued and stuck
     GET /api/ops/runs ?range=24h   how the last 24 hours of runs went

   Every read is carried as a value, { data } or { error }. A read that is down
   takes only its own section off the screen and gives it a Try again that
   re-reads only that read.

   The rules that are rules about NOT drawing something:

     1. **"No critical issues" is a claim.** It is printed only after a
        complete, readable problems result, and only when something was in a
        position to notice. A failed or capped read, or checks that are not
        running, say so instead.
     2. **A reply with no readable list is a failed read.** An absent list
        passed on as an empty one would let the calm line be printed over a
        queue nobody has seen.
     3. **A stuck count is as wide as the read behind it.** A bounded read
        that saw none has seen none, which is not the same as there being none.
     4. **Worked over attempted leaves cancellations out.** The person who
        pressed cancel did not experience a failure. */
(function (global) {
  'use strict';

  var S = global.OpsPaneShell;
  var model = global.OpsAlertsModel;
  var session = global.OpsSession;
  var h = S.h;
  var icon = S.icon;
  var fmt = S.fmt;
  var maskContactDetails = global.OpsPaneRegistry.maskContactDetails;

  var ENDPOINT = {
    problems: '/api/ops/alerts/problems',
    rules: '/api/ops/alerts/rules',
    jobs: '/api/ops/jobs',
    runs: '/api/ops/runs'
  };

  var ROWS_LISTED = 3;

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /* ------------------------------------------------------------ readings */

  /* A number the answer actually sent, or null. Never a substituted zero. */
  function num(value) {
    return (typeof value === 'number' && isFinite(value)) ? value : null;
  }

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function textOf(value) {
    if (typeof value !== 'string') return null;
    var trimmed = value.trim();
    return trimmed || null;
  }

  function stateOf(block) {
    return textOf(block && block.availability && block.availability.state);
  }

  /* ----------------------------------------------------------------- dates */

  function parseDay(iso) {
    if (typeof iso !== 'string' || !iso) return null;
    var t = new Date(iso);
    return isFinite(t.getTime()) ? t : null;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function monthDay(date) {
    return MONTHS[date.getUTCMonth()] + ' ' + date.getUTCDate();
  }

  function clock(date) {
    return pad2(date.getUTCHours()) + ':' + pad2(date.getUTCMinutes());
  }

  function headDate(iso) {
    var t = parseDay(iso);
    if (!t) return null;
    return WEEKDAYS[t.getUTCDay()] + ', ' + monthDay(t) + ', ' + t.getUTCFullYear();
  }

  function updatedAt(iso) {
    var t = parseDay(iso);
    if (!t) return null;
    return 'Updated ' + clock(t) + ' UTC';
  }

  /* ------------------------------------------------------------- figures */

  /* A card's heading: an optional icon and a title, the title a link when the
     card has a page of its own to go deeper on. */
  function tileHead(iconName, text, href, tone) {
    var title = h('h2', { className: 'sec-title tile-title' });
    if (iconName) {
      title.appendChild(h('span', { className: 'tile-ico' + (tone ? ' is-' + tone : '') }, [icon(iconName)]));
    }
    title.appendChild(href ? h('a', { className: 'tile-link', href: href, text: text }) : h('span', { text: text }));
    return title;
  }

  /* Worked over attempted as a bar, with a red end dot when anything failed.
     Decoration only: the figures beside it say the same thing in words. */
  function workedBar(day) {
    var bar = h('div', { className: 'ai-bar', 'aria-hidden': 'true' });
    var fill = h('i', { className: 'ai-fill' });
    fill.style.setProperty('width', ((day.worked / day.attempted) * 100).toFixed(2) + '%');
    bar.appendChild(fill);
    if (day.failed > 0) bar.appendChild(h('i', { className: 'ai-miss' }));
    return bar;
  }

  /* ----------------------------------------------------------------- reads */

  function get(endpoint, query) {
    return session.call(endpoint, { query: query }).then(function (payload) {
      return payload.data;
    });
  }

  var READS = {
    /* A reply with no readable list is a failed read. An absent list passed
       on as an empty one would let "No critical issues" be printed over a
       queue nobody has seen. */
    problems: function () {
      return get(ENDPOINT.problems, { status: 'open', limit: model.PAGE }).then(function (open) {
        var rows = open && open.problems;
        if (!Array.isArray(rows) || rows.some(function (p) { return !p || typeof p !== 'object'; })) {
          throw new Error('The problems list came back in a form this page cannot read.');
        }
        return open;
      });
    },
    rules: function () { return get(ENDPOINT.rules); },
    jobs: function () { return get(ENDPOINT.jobs); },
    runs: function () { return get(ENDPOINT.runs, { range: '24h' }); }
  };

  /* Who has it. The problems route names the acknowledger by address, and
     the session layer withholds every address it was not told to let
     through, so a name is never put together from one here: an
     acknowledged problem says somebody is on it, an open one says nobody
     is. */
  function ownerOf(problem) {
    return problem.status === 'acknowledged'
      ? { words: 'Someone is on it', taken: true }
      : { words: 'Nobody on it', taken: false };
  }

  var WORK_PANE_KEY = { 'jobs-live': 'jobs', 'run-history': 'history' };

  /* Where a problem's own action goes: the page where its work happens, or the
     Problems page, which owns every problem's detail, when the work has no
     page of its own or is the page the reader is already on. */
  function problemHref(problem) {
    var work = typeof problem.workPane === 'string' ? problem.workPane : '';
    var file = textOf(model.PANE_FILE[work]);
    if (file && work !== 'overview') return S.paneHref(WORK_PANE_KEY[work] || work) || file;
    return S.paneHref('problems') || 'problems.html';
  }

  /* The word a screen reader gets before a problem's title, and the tone the
     row is drawn in. Both lookups go through textOf(), so a severity of
     `constructor` or `toString` (words every plain object answers to) cannot
     reach the page as the source of a function. The Problems pane takes the
     same three steps for the same problem, so one incident has one word on
     every pane. */
  function severityWords(severity) {
    return textOf(model.SEVERITY_LABEL[severity]) || textOf(severity) || 'Unknown';
  }

  function severityTone(severity) {
    return textOf(model.SEVERITY_TONE[severity]) || 'info';
  }

  /* The queue, as the pane's own object. `opts`:

       prefix    what this pane's ids start with ('today', 'health')
       title     the page's name in the sentence spoken after a Try again
       names     what each section is called when its read comes back
       anchor    the id of the status line's section; its presence is how a
                 page that drew nothing is told from one that drew sections
       content   the pane's content node
       reads     { key: function () -> Promise } for every read the pane owns
       redraw    function (keys): draw the sections that read these
       syncState function (): settle the page's degraded/shown state */
  function create(opts) {
    var prefix = opts.prefix;
    var anchor = opts.anchor || 'health';
    var content = opts.content;
    var reads = opts.reads;
    var names = opts.names || {};
    /* One counter per read. Asking for a read advances its counter, and an
       answer may be used only while its counter is still the one it was asked
       under, so the newest ask of a read wins whatever order the answers come
       back in, and a read nobody asked again is never disturbed. */
    var generation = {};
    var results = {};
    var retryN = 0;

    function data(key) {
      var one = results[key];
      return one && !one.error ? one.data : null;
    }

    /* A read as a value, never a rejection. A synchronous throw is a failed
       read too. */
    function settled(key) {
      return new Promise(function (resolve) { resolve(reads[key]()); }).then(
        function (value) { return { data: value }; },
        function (err) { return { error: err }; }
      );
    }

    function first(root, selector) {
      var found = root.querySelectorAll(selector);
      return found.length ? found[0] : null;
    }

    function shownPanel() { return first(content, '[data-shown]'); }

    /* ------------------------------------------------- failure and retry */

    /* The name a screen reader gives a Try again is composed from the button
       and the heading beside it, so two of them on one screen are told apart
       in a list of controls. data-retry carries the same heading for the
       sentence spoken once the read comes back. */
    function retryButton(titleNode, keys, sectionId) {
      retryN += 1;
      var headingId = titleNode.getAttribute('id');
      if (!headingId) {
        headingId = prefix + '-failed-' + retryN;
        titleNode.setAttribute('id', headingId);
      }
      var again = h('button', { className: 'btn btn-sm', type: 'button', text: 'Try again' });
      var buttonId = prefix + '-retry-' + retryN;
      again.setAttribute('id', buttonId);
      again.setAttribute('aria-labelledby', buttonId + ' ' + headingId);
      again.setAttribute('data-retry', String(titleNode.textContent || ''));
      again.addEventListener('click', function () {
        retry(keys).then(function (landed) {
          if (landed) landOn(sectionId);
        });
      });
      return again;
    }

    function failure(headline, err, keys, sectionId) {
      var block = S.stateBlock('warn', headline, [S.failureMessage(err)], 3);
      var title = first(block, '.state-title');
      block.appendChild(h('div', { className: 'row mt-sm' }, [retryButton(title, keys, sectionId)]));
      return block;
    }

    /* A read that failed inside a figure that has other things to say. */
    function failedLine(headline, err, keys, sectionId) {
      var line = h('div', { className: 'fail-line' });
      var title = h('span', { className: 'sec-title fail-title', text: headline });
      line.appendChild(title);
      line.appendChild(h('span', { className: 'fail-why', text: S.failureMessage(err) }));
      line.appendChild(retryButton(title, keys, sectionId));
      return line;
    }

    /* Pressing Try again redraws the section, which destroys the button.
       Focus falls to <body> unless it is put somewhere on purpose, and the
       section's own heading is the node that exists whether the retry worked
       or not. What is spoken is the outcome: the section came back, or the
       same failure is still there. */
    function landOn(sectionId) {
      var panel = shownPanel();
      if (!panel) return;
      var host = sectionId ? first(panel, '[id="' + prefix + '-' + sectionId + '"]') : null;
      var head = first(host || panel, '.sec-title, .state-title');
      if (!head) return;
      head.setAttribute('tabindex', '-1');
      head.focus();
      var stuck = (host || panel).querySelectorAll('[data-retry]');
      var message;
      if (!host && !first(panel, '[id="' + prefix + '-' + anchor + '"]')) {
        message = String(head.textContent || '') + ' again.';
      } else if (!stuck.length) {
        message = (host ? names[sectionId] : opts.title) + ' was read again.';
      } else if (host) {
        message = String(stuck[0].getAttribute('data-retry') || '') + ' again.';
      } else {
        message = opts.title + ' was read again. ' + fmt.plural(stuck.length, 'part') + ' could not be read.';
      }
      S.announce(message);
    }

    /* Ask for these reads. Each answer says whether its read has been asked
       for again since, judged when the last of them is in. */
    function ask(keys) {
      var stamp = {};
      keys.forEach(function (key) {
        generation[key] = (generation[key] || 0) + 1;
        stamp[key] = generation[key];
      });
      return Promise.all(keys.map(function (key) {
        return settled(key).then(function (one) { return { key: key, one: one }; });
      })).then(function (answers) {
        answers.forEach(function (a) { a.current = generation[a.key] === stamp[a.key]; });
        return answers;
      });
    }

    /* Re-read these reads and nothing else, then redraw the sections that
       draw from them. Only an answer nobody has since asked for again is
       used: an older answer that arrives late draws nothing and moves nothing,
       and the retry that replaced it is the one that lands. Resolves to
       whether this retry drew, which is the only one that may move focus or
       speak. Every Try again asks for one read, so an answer is either the
       newest of its read or it is not. */
    function retry(keys) {
      return ask(keys).then(function (answers) {
        var used = answers.filter(function (a) { return a.current; });
        if (!used.length) return false;
        used.forEach(function (a) { results[a.key] = a.one; });
        opts.redraw(used.map(function (a) { return a.key; }));
        opts.syncState();
        return true;
      });
    }

    /* The Health count beside the rail item: a real read or nothing. */
    function badgeProblems() {
      var open = data('problems');
      var needing = open ? model.needingAction(list(open.problems)).length : 0;
      if (!needing) {
        S.setBadge('alerts', null);
        return;
      }
      S.setBadge('alerts', {
        label: fmt.int(needing) + (model.capped(list(open.problems)) ? '+' : ''),
        tone: 'hot',
        description: needing === 1
          ? 'one problem with nobody on it'
          : fmt.int(needing) + ' problems with nobody on them'
      });
    }

    /* ------------------------------------------------------- status line */

    function problemList() {
      var open = data('problems');
      return open ? list(open.problems) : null;
    }

    /* "No critical issues" only after a complete, readable problems result and
       only when something was in a position to notice. The problems arrive
       worst first and stop at model.PAGE, so a full page is a floor and can
       say nothing about what lies beyond it. */
    function healthLine() {
      var problems = problemList();
      var active = model.active(problems);
      var critical = active.filter(function (p) { return p.severity === 'critical'; });
      var capped = model.capped(problems);

      if (critical.length) {
        return { tone: 'crit', text: model.atLeast(fmt.plural(critical.length, 'critical issue'), capped) };
      }
      if (capped) return { tone: 'warn', text: 'At least ' + fmt.plural(problems.length, 'open problem') };
      if (results.rules.error) return { tone: 'warn', text: 'Checks unread', retry: ['rules'] };
      var armed = model.armedState(data('rules') || {});
      if (!armed.trustworthy) return { tone: 'warn', text: 'Checks not running' };
      /* A calm line over an incident nothing can be sent about is the one
         thing worse than a red one. `channelsKnown` keeps an answer that said
         nothing about delivery apart from one that said there is none. */
      if (armed.channelsKnown && !armed.channelsConfigured) {
        return { tone: 'warn', text: 'No alert destination set' };
      }
      return { tone: 'ok', text: 'No critical issues' };
    }

    /* What the calm line does not say. "No critical issues" is a claim about
       the problems; whether every check is reporting, and whether the verdicts
       it rests on are recent, is a different fact and is printed beside it
       rather than folded into it. Each is a count of the checks it is true of,
       one note per kind, so a current check cannot vouch for a stale one. A
       rule is in one kind only: not reporting means it reached no verdict,
       stale means its own last verdict is too old (alerts-model.js
       STALE_AFTER_MS). */
    function checkNotes() {
      var armed = model.armedState(data('rules') || {});
      var notes = [];
      var silent = armed.enabled - armed.checking;
      if (silent > 0) notes.push(fmt.plural(silent, 'check') + ' not reporting');
      if (armed.stale > 0) notes.push(fmt.plural(armed.stale, 'check') + ' stale');
      return notes;
    }

    function drawHealth(node) {
      if (results.problems.error) {
        var title = h('span', { className: 'sec-title health-text', text: "Couldn't load problems" });
        node.appendChild(h('span', { className: 'dot is-warn', 'aria-hidden': 'true' }));
        node.appendChild(title);
        node.appendChild(retryButton(title, ['problems'], anchor));
        return;
      }
      var line = healthLine();
      var text = h('span', { className: 'sec-title health-text', text: line.text });
      node.appendChild(h('span', { className: 'dot is-' + line.tone, 'aria-hidden': 'true' }));
      node.appendChild(text);
      if (line.retry) node.appendChild(retryButton(text, line.retry, anchor));
      var notes = line.tone === 'ok' ? checkNotes() : [];
      if (notes.length) {
        node.appendChild(h('span', { className: 'health-notes' }, notes.map(function (note) {
          return h('span', { className: 'health-note', text: note });
        })));
      }
    }

    /* What the queue holds, from the jobs read. Every figure that was not sent
       is null rather than zero. */
    function jobFigures() {
      var jobs = data('jobs');
      if (!jobs) return null;
      var queue = jobs.queue || {};
      var counts = list(queue.byState);
      var count = function (state) {
        var found = counts.filter(function (e) { return e && e.state === state; })[0];
        return found ? num(found.jobs) : null;
      };
      var attention = jobs.attention || {};
      var stuck = Array.isArray(attention.stuck) ? attention.stuck.length : null;
      var abandoned = Array.isArray(attention.abandoned) ? attention.abandoned.length : null;
      var scope = attention.completeness === 'whole_queue' ? 'whole'
        : attention.completeness === 'working_set_only' ? 'bounded' : 'unread';
      return {
        open: num(queue.open),
        running: count('running'),
        queued: count('queued'),
        canceling: count('canceling'),
        stuck: stuck,
        abandoned: abandoned,
        scope: scope
      };
    }

    /* A count is exactly as wide as the read behind it. A bounded read that saw
       none has seen none, which is not the same as there being none. */
    function wideWords(count, scope, label) {
      if (count === null || scope === 'unread') return { value: fmt.none, label: label };
      if (scope === 'whole') return { value: fmt.int(count), label: label };
      return {
        value: count === 0 ? 'none seen' : fmt.int(count) + '+',
        label: label
      };
    }

    function stuckWords(figures) {
      return wideWords(figures.stuck, figures.scope, 'stuck');
    }

    function drawLive(node) {
      var figures = jobFigures();
      if (!figures || figures.running === null) return;
      if (figures.running > 0) {
        node.appendChild(h('span', { className: 'pulse', 'aria-hidden': 'true' }));
        node.appendChild(h('span', { className: 'sec-title live-text', text: fmt.int(figures.running) + ' running now' }));
      } else {
        node.appendChild(h('span', { className: 'dot is-idle', 'aria-hidden': 'true' }));
        node.appendChild(h('span', { className: 'sec-title live-text', text: 'Nothing running' }));
      }
    }

    /* ---------------------------------------------------- the problems */

    /* The worst few open problems, one row each: what, since when, who has it,
       and one action. `options.time` puts the hour beside the day. */
    function drawProblems(node, options) {
      var withTime = Boolean(options && options.time);
      var problems = problemList();
      if (!problems) return;
      var active = model.active(problems).sort(model.byWorstThenOldest);
      if (!active.length) return;

      active.slice(0, ROWS_LISTED).forEach(function (problem) {
        var tone = severityTone(problem.severity);
        var title = textOf(problem.title) ? maskContactDetails(textOf(problem.title)) : 'Untitled problem';
        var since = parseDay(problem.detectedAt || problem.firedAt);
        var owner = ownerOf(problem);

        var who = h('span', { className: 'prob-who' });
        if (owner.taken) who.appendChild(h('span', { className: 'who-av', 'aria-hidden': 'true' }, [icon('person')]));
        who.appendChild(h('span', { text: owner.words }));

        var meta = h('span', { className: 'prob-meta' });
        if (since) {
          meta.appendChild(h('span', {
            className: 'prob-since',
            text: 'Since ' + monthDay(since) + (withTime ? ', ' + clock(since) : '')
          }));
        }
        meta.appendChild(who);

        var view = h('a', {
          className: 'prob-view', href: problemHref(problem),
          'aria-label': 'View: ' + title
        }, [h('span', { text: 'View' }), icon('arrow')]);

        node.appendChild(h('div', { className: 'prob-row is-' + tone }, [
          h('i', { className: 'dot is-' + (tone === 'crit' ? 'crit' : tone === 'warn' ? 'warn' : 'info'), 'aria-hidden': 'true' }),
          h('span', { className: 'sr', text: severityWords(problem.severity) + ': ' }),
          h('span', { className: 'prob-title', text: title }),
          meta,
          view
        ]));
      });

      var more = active.length - ROWS_LISTED;
      if (more > 0) {
        node.appendChild(h('a', {
          className: 'prob-more', href: S.paneHref('problems') || 'problems.html',
          text: '+' + fmt.int(more) + (model.capped(problems) ? ' or more' : ' more')
        }));
      }
    }

    /* ------------------------------------------------------ the last day */

    /* Worked and attempted over the last day. A cancellation is neither: the
       person who pressed cancel did not experience a failure, and counting it
       as one would make the rate a measure of impatience. It is rolling
       24-hour lifecycle delivery, not a verdict on the quality of an answer.
       The record's own gaps are said in words and never as a zero. */
    function dayOfRuns() {
      var runs = data('runs');
      if (!runs) return null;
      if (!runs.window || runs.window.range !== '24h') return { words: 'Last 24h not reported' };
      var coverage = runs.coverage || {};
      if (coverage.state !== 'ready' || coverage.coversWindow !== true) {
        return { words: 'Last 24h not fully recorded' };
      }
      var done = num(runs.summary && runs.summary.completed);
      var failed = num(runs.summary && runs.summary.failed);
      if (done === null || failed === null) return { words: 'Last 24h not reported' };
      if (done + failed === 0) return { words: 'No runs finished' };
      return {
        worked: done,
        attempted: done + failed,
        failed: failed,
        canceled: num(runs.summary.canceled),
        duration: runs.summary.duration || null
      };
    }

    return {
      results: results,
      data: data,
      first: first,
      ask: ask,
      retry: retry,
      retryButton: retryButton,
      failure: failure,
      failedLine: failedLine,
      landOn: landOn,
      badgeProblems: badgeProblems,
      problemList: problemList,
      healthLine: healthLine,
      checkNotes: checkNotes,
      drawHealth: drawHealth,
      jobFigures: jobFigures,
      wideWords: wideWords,
      stuckWords: stuckWords,
      drawLive: drawLive,
      drawProblems: drawProblems,
      dayOfRuns: dayOfRuns
    };
  }

  global.OpsStatus = {
    create: create,
    READS: READS,
    ENDPOINT: ENDPOINT,
    get: get,
    num: num,
    list: list,
    textOf: textOf,
    stateOf: stateOf,
    parseDay: parseDay,
    pad2: pad2,
    monthDay: monthDay,
    clock: clock,
    headDate: headDate,
    updatedAt: updatedAt,
    MONTHS: MONTHS,
    WEEKDAYS: WEEKDAYS,
    problemHref: problemHref,
    tileHead: tileHead,
    workedBar: workedBar
  };
})(window);
