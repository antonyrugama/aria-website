/* Aria Operations — Health (v2), the page at ops/alerts.html.

   One screen for "is anything wrong, and is Aria keeping up?". It is a summary
   with a way down, not a console: every card links to the page that owns the
   depth (Happening now, What happened, Problems), and nothing here changes
   anything. Acknowledging, closing, rules and routing live on the Problems
   page (ops/problems.html), and so does the Community safety queue, drawn by
   assets/pane-ugc.js. Health has one compact row about that queue, for the
   roles that can see it, and nothing when no report is waiting.

   WHAT IT READS

     GET /api/ops/alerts/problems   the queue           } through
     GET /api/ops/alerts/rules      the checks          } assets/pane-status.js,
     GET /api/ops/jobs              the queue of work   } which Today uses too
     GET /api/ops/runs ?range=24h   the last 24 hours   }
     GET /api/ops/costs ?range=month   only the time the billing feed last
                                    reported, for one row of the Checks card
     GET /api/ops/moderation/reports   the Community safety queue, for owner
                                    and operator only, for one compact row

   The status line, the problem rows, the retry engine and the live pulse are
   assets/pane-status.js's, so Health and Today cannot disagree about whether
   anything is wrong. What this file adds is the four cards under them.

   The rules that are rules about NOT drawing something:

     1. **A queued job has no progress.** It is drawn as plain "Queued", never
        as an empty bar or 0%. A running job is drawn with a bar only when the
        worker reported progress above zero; one that has reported nothing is
        "Running" with no bar, because an empty bar reads as "just started".
     2. **A count is as wide as the read behind it.** Stuck and abandoned say
        "none seen" or "N+" when the read covered only part of the queue.
     3. **Typical time needs a measured base.** It is printed with how many runs
        it was measured over, and not at all when none were measured.
     4. **Worked over attempted leaves cancellations out.** They are counted
        beside it, not inside it.
     5. **Checks never say healthy.** "7 of 9 checks reporting" is the count of
        checks that reached a verdict, and the count is left to say how many
        did not. A verdict that has gone stale is named.
     6. **A read that is down takes only its own card off the screen** and gives
        it a Try again. A freshness stamp that could not be read says so rather
        than going missing.
     7. **A safety queue that could not be read is never silence.** The row
        says so and offers Try again. No row at all means no report is waiting
        or the role is not one that sees the queue, and a role that cannot see
        it is never sent the read. */
(function (global) {
  'use strict';

  var S = global.OpsPaneShell;
  var St = global.OpsStatus;
  var model = global.OpsAlertsModel;
  var h = S.h;
  var icon = S.icon;
  var fmt = S.fmt;
  var maskContactDetails = global.OpsPaneRegistry.maskContactDetails;

  var num = St.num;
  var list = St.list;
  var textOf = St.textOf;
  var parseDay = St.parseDay;
  var monthDay = St.monthDay;
  var clock = St.clock;

  var ENDPOINT = { costs: '/api/ops/costs', safety: '/api/ops/moderation/reports' };

  /* Who may see the Community safety queue, and the page the queue asks for:
     the same first page ops/assets/pane-ugc.js asks for, so the count here and
     the list there are of the same reports. */
  var SAFETY_ROLES = ['owner', 'operator'];
  var SAFETY_PAGE = 25;

  var READ = {
    problems: St.READS.problems,
    rules: St.READS.rules,
    jobs: St.READS.jobs,
    runs: St.READS.runs,
    costs: function () { return St.get(ENDPOINT.costs, { range: 'month' }); },
    /* A role that cannot see the queue is not asked: null is "nothing to show",
       and only a read that was made can fail. */
    safety: function () {
      if (!global.OpsSession.hasRole(SAFETY_ROLES)) return Promise.resolve(null);
      return St.get(ENDPOINT.safety, { limit: SAFETY_PAGE, afterId: 0 }).then(function (queue) {
        var rows = queue && queue.items;
        if (!Array.isArray(rows) || rows.some(function (r) { return !r || typeof r !== 'object'; })) {
          throw new Error('The safety reports came back in a form this page cannot read.');
        }
        return queue;
      });
    }
  };

  /* Reads whose failure leaves the page degraded. The billing feed's stamp is
     one row of one card, and the safety queue's one row; each says its own
     failure where it is drawn. */
  var CORE = ['problems', 'rules', 'jobs', 'runs'];

  /* What each section is called when its read is said to have come back. */
  var NAMES = {
    status: 'Health', live: 'Happening now', safety: 'The safety queue', problems: 'Problems', now: 'Happening now',
    day: 'Last 24h', runs: 'Recent runs', checks: 'Checks'
  };

  var JOBS_SHOWN = 5;
  var RUNS_SHOWN = 5;

  /* How many publish-lags old the billing figures may be before the feed is
     called behind. The same doubling pane-spend.js uses, so the two agree. */
  var BILLING_STALE_MULTIPLE = 2;
  var BILLING_FALLBACK_LAG_HOURS = 8;

  var JOB_STATE = { running: 'Running', queued: 'Queued', canceling: 'Canceling' };
  var OUTCOME = { completed: 'Worked', failed: 'Failed', canceled: 'Cancelled' };
  var OUTCOME_TONE = { completed: 'ok', failed: 'crit', canceled: 'idle' };

  /* ------------------------------------------------------------ formatting */

  /* An elapsed time at a glance. Absence stays absence: a job nobody can time
     prints the none marker rather than 0s, which would read as "just started". */
  function dur(ms) {
    if (!fmt.isNum(ms) || ms < 0) return fmt.none;
    var s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ' + (s % 60 < 10 ? '0' : '') + (s % 60) + 's';
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }

  function sentenceCase(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function jobTypeLabel(jobType) {
    var text = textOf(jobType);
    return text ? maskContactDetails(sentenceCase(text.replace(/_/g, ' '))) : fmt.none;
  }

  function runTypeLabel(run) {
    var type = run && run.type;
    var label = type && textOf(type.label);
    if (label) return maskContactDetails(label);
    return jobTypeLabel(type && type.value);
  }

  /* The time of day, with the day in front of it only when it is not the day
     the page was read. Everything here is UTC and says so once, in the head. */
  function whenOf(date, now) {
    var sameDay = date.getUTCFullYear() === now.getUTCFullYear() &&
      date.getUTCMonth() === now.getUTCMonth() && date.getUTCDate() === now.getUTCDate();
    return (sameDay ? '' : monthDay(date) + ', ') + clock(date);
  }

  function stamped(date, now) { return whenOf(date, now) + ' UTC'; }

  /* ------------------------------------------------------------------ pane */

  S.definePane('alerts', function (content) {
    var region = S.region(content);
    var loadToken = 0;
    var wrap = null;
    var hosts = {};

    var st = St.create({
      prefix: 'health', title: 'Health', anchor: 'status', names: NAMES,
      content: content, reads: READ,
      redraw: function (keys) { redraw(keys); },
      syncState: function () { syncState(); }
    });
    var results = st.results;
    var data = st.data;
    var failedLine = st.failedLine;
    var badgeProblems = st.badgeProblems;

    /* The moment the page treats as "now" when it decides whether a stamp is
       from today: the read's own clock, never the browser's when the read sent
       one. */
    function nowOf() {
      var jobs = data('jobs');
      var runs = data('runs');
      return parseDay(jobs && jobs.generatedAt) ||
        parseDay(runs && runs.window && runs.window.endExclusiveAt) || new Date();
    }

    /* ------------------------------------------------------------ the load */

    function load() {
      var mine = ++loadToken;
      region.loading([
        { type: 'block', height: 40 },
        { type: 'block', height: 62 },
        { type: 'block', height: 260 },
        { type: 'block', height: 220 }
      ]);
      /* Asking advances every read, so a retry still out when the page is read
         again can no longer draw over the new page. */
      return st.ask(Object.keys(READ)).then(function (answers) {
        if (mine !== loadToken) return false;
        answers.forEach(function (a) { results[a.key] = a.one; });
        render();
        return true;
      }).catch(function (err) {
        /* The reads cannot reject; this is render() throwing, the one failure
           that leaves nothing on screen. */
        if (mine !== loadToken) return false;
        region.failed(err, wholeRetry);
        return true;
      });
    }

    function wholeRetry() {
      return load().then(function (landed) {
        if (landed) st.landOn(null);
      });
    }

    var SECTIONS = [
      { id: 'status', reads: ['problems', 'rules'], draw: st.drawHealth },
      { id: 'live', reads: ['jobs'], draw: st.drawLive },
      { id: 'safety', reads: ['safety'], draw: drawSafety },
      { id: 'problems', reads: ['problems'], draw: function (node) { st.drawProblems(node, { time: true }); } },
      { id: 'now', reads: ['jobs'], draw: drawNow },
      { id: 'day', reads: ['runs'], draw: drawDay },
      { id: 'runs', reads: ['runs'], draw: drawRuns },
      { id: 'checks', reads: ['rules', 'jobs', 'costs'], draw: drawChecks }
    ];

    function host(id, tag, className) {
      var node = h(tag || 'div', { className: 'sec ' + (className || ''), id: 'health-' + id });
      hosts[id] = node;
      return node;
    }

    function render() {
      hosts = {};
      wrap = h('div', { className: 'stack health status-pane' });

      wrap.appendChild(h('div', { className: 'status-line' }, [
        host('status', 'div', 'status-health'),
        host('live', 'div', 'status-live')
      ]));
      wrap.appendChild(host('safety', 'section', 'problem-rows'));
      wrap.appendChild(host('problems', 'section', 'problem-rows'));
      wrap.appendChild(h('div', { className: 'health-grid' }, [
        host('now', 'article', 'tile tile-now'),
        host('day', 'article', 'tile tile-day'),
        host('runs', 'article', 'tile tile-runs'),
        host('checks', 'article', 'tile tile-checks')
      ]));

      redraw(Object.keys(READ));

      if (CORE.every(function (key) { return results[key].error; })) {
        region.failed(results.problems.error, wholeRetry);
        return;
      }
      syncState();
    }

    function syncState() {
      var down = CORE.some(function (key) { return results[key].error; });
      if (down) region.degraded(wrap); else region.show(wrap);
    }

    function redraw(keys) {
      SECTIONS.forEach(function (section) {
        var touched = section.reads.some(function (key) { return keys.indexOf(key) !== -1; });
        if (!touched || !hosts[section.id]) return;
        var node = hosts[section.id];
        while (node.firstChild) node.removeChild(node.firstChild);
        section.draw(node);
      });
      if (keys.indexOf('problems') !== -1) badgeProblems();
      drawHead();
    }

    /* The date and when it was read, in the slot the shell leaves under the
       title. It reads the jobs read's own stamp, so it is the time of the
       figures and not of the page. */
    function drawHead() {
      var slot = document.getElementById('pageSub');
      if (!slot) return;
      while (slot.firstChild) slot.removeChild(slot.firstChild);
      var jobs = data('jobs');
      var runs = data('runs');
      var stamp = (jobs && jobs.generatedAt) ||
        (runs && runs.window && runs.window.endExclusiveAt);
      var date = St.headDate(stamp);
      var updated = St.updatedAt(stamp);
      if (date) slot.appendChild(h('span', { className: 'sub-date', text: date }));
      if (updated) slot.appendChild(h('span', { className: 'sub-updated', text: updated }));
    }

    /* --------------------------------------------------- safety reports */

    /* One row, in the shape of a problem row, when reports wait in the
       Community safety queue; the queue itself is on Problems. Amber while
       every deadline is ahead. Red once one has passed or a report has no
       deadline at all, the same two cases the queue paints red, and the words
       say so too, so the colour is never the only signal. A first page that
       has more behind it says "N+". */
    function drawSafety(node) {
      if (results.safety.error) {
        var failed = h('span', { className: 'sec-title prob-title', text: "Couldn't load safety reports" });
        node.appendChild(h('div', { className: 'prob-row is-warn' }, [
          h('i', { className: 'dot is-warn', 'aria-hidden': 'true' }),
          failed,
          h('span', { className: 'prob-retry' }, [st.retryButton(failed, ['safety'], 'safety')])
        ]));
        return;
      }
      var queue = data('safety');
      if (!queue) return;
      var items = list(queue.items);
      if (!items.length) return;

      var now = nowOf();
      var dues = [];
      items.forEach(function (item) {
        var due = parseDay(item.actionDueAt);
        if (due) dues.push(due);
      });
      dues.sort(function (a, b) { return a.getTime() - b.getTime(); });
      var undated = items.length - dues.length;
      var late = dues.length > 0 && dues[0].getTime() <= Date.now();
      var tone = late || undated > 0 ? 'crit' : 'warn';

      var count = fmt.int(items.length) + (queue.nextCursor != null ? '+' : '');
      var title = count + ' safety ' + (items.length === 1 ? 'report' : 'reports') + ' to review';

      var meta = h('span', { className: 'prob-meta' });
      if (dues.length) {
        meta.appendChild(h('span', {
          className: 'prob-since' + (late ? ' is-late' : ''),
          text: (late ? 'Overdue since ' : 'Oldest due ') + stamped(dues[0], now)
        }));
      }
      if (undated > 0) {
        meta.appendChild(h('span', {
          className: dues.length ? '' : 'prob-since is-late',
          text: undated === items.length ? 'No deadline set' : fmt.int(undated) + ' without a deadline'
        }));
      }

      node.appendChild(h('div', { className: 'prob-row is-' + tone }, [
        h('i', { className: 'dot is-' + tone, 'aria-hidden': 'true' }),
        h('span', { className: 'sr', text: (tone === 'crit' ? 'Critical' : 'Warning') + ': ' }),
        h('span', { className: 'sec-title prob-title', text: title }),
        meta,
        h('a', {
          className: 'prob-view', href: S.paneHref('problems') || 'problems.html',
          'aria-label': 'Review: ' + title
        }, [h('span', { text: 'Review' }), icon('arrow')])
      ]));
    }

    /* ------------------------------------------------------- happening now */

    /* What is open, the running ones first and the longest-running first
       among them, then the queued ones, oldest waiting first. */
    function openJobs(jobs) {
      var rank = { running: 0, canceling: 1, queued: 2 };
      var rows = list(jobs.workingSet && jobs.workingSet.jobs).filter(function (job) {
        return job && typeof job === 'object' && rank[job.state] !== undefined;
      });
      var age = function (job) { return num(job.state === 'queued' ? job.queuedMs : job.runningMs) || num(job.ageMs) || 0; };
      return rows.sort(function (a, b) {
        return rank[a.state] - rank[b.state] || age(b) - age(a);
      });
    }

    /* The word for what a job is doing. A job the attention lists name is
       Stuck or Abandoned, from the same lists the counters above it count. */
    function jobWords(job, attention) {
      var id = job.id;
      if (job.state === 'running' && id !== undefined) {
        if (list(attention.abandoned).indexOf(id) !== -1) return { words: 'Abandoned', tone: 'crit' };
        if (list(attention.stuck).indexOf(id) !== -1) return { words: 'Stuck', tone: 'warn' };
      }
      return { words: JOB_STATE[job.state], tone: job.state };
    }

    /* `hot` is a count that is not zero: the figure a glance should catch.
       Only the two attention counters carry their kind: they are the two the
       stylesheet paints differently, and a class no rule reaches is dead. */
    function counter(kind, words, label, hot) {
      var attention = kind === 'stuck' || kind === 'abandoned';
      return h('div', { className: 'count' + (attention ? ' is-' + kind : '') + (hot ? ' is-hot' : '') }, [
        h('span', { className: 'num count-n', text: words }),
        h('span', { className: 'count-l', text: label })
      ]);
    }

    function jobLine(job, attention) {
      var state = jobWords(job, attention);
      var progress = num(job.progress);
      /* Rule 1: only a running job that has reported progress has a bar. */
      var shown = job.state === 'running' && progress !== null && progress > 0;
      var percent = shown ? Math.min(100, Math.round(progress)) : null;

      /* Only Stuck and Abandoned are painted; the other states are words. */
      var marked = state.tone === 'warn' || state.tone === 'crit';

      var meter = h('span', { className: 'job-prog', role: 'cell' });
      if (shown) {
        var bar = h('span', { className: 'job-bar', 'aria-hidden': 'true' });
        var fill = h('i', { className: 'job-fill' + (marked ? ' is-' + state.tone : '') });
        fill.style.setProperty('width', percent + '%');
        bar.appendChild(fill);
        meter.appendChild(bar);
        meter.appendChild(h('span', { className: 'num job-pct', text: percent + '%' }));
      }

      var elapsed = job.state === 'queued' ? (num(job.queuedMs) !== null ? job.queuedMs : job.ageMs) : job.runningMs;
      return h('div', { className: 'job-line' + (marked ? ' is-' + state.tone : ''), role: 'row' }, [
        h('span', { className: 'job-name', role: 'cell' }, [
          h('span', { className: 'job-ico', 'aria-hidden': 'true' }, [icon('spark')]),
          h('span', { className: 'job-words' }, [
            h('span', { className: 'job-type', text: jobTypeLabel(job.jobType) }),
            state.words === JOB_STATE.running ? null : h('span', { className: 'job-sub', text: state.words })
          ])
        ]),
        meter,
        h('span', { className: 'num job-time', role: 'cell', text: dur(elapsed) }),
        h('span', { className: 'job-state', role: 'cell', text: state.words })
      ]);
    }

    function drawNow(node) {
      node.appendChild(St.tileHead('pulse', 'Happening now', S.paneHref('jobs') || 'jobs-live.html'));
      if (results.jobs.error) {
        node.appendChild(failedLine('Jobs could not be read', results.jobs.error, ['jobs'], 'now'));
        return;
      }
      /* A reply with nothing in it reads as nothing known, never as zeros. */
      var figures = st.jobFigures() || {
        open: null, running: null, queued: null, canceling: null,
        stuck: null, abandoned: null, scope: 'unread'
      };
      var jobs = data('jobs') || {};
      var attention = jobs.attention || {};
      var show = function (n) { return n === null || n === undefined ? fmt.none : fmt.int(n); };
      var stuck = st.stuckWords(figures);
      var abandoned = st.wideWords(figures.abandoned, figures.scope, 'abandoned');

      var counts = h('div', { className: 'counts' }, [
        counter('running', show(figures.running), 'running'),
        counter('queued', show(figures.queued), 'queued')
      ]);
      if (figures.canceling) counts.appendChild(counter('canceling', show(figures.canceling), 'canceling'));
      counts.appendChild(counter('stuck', stuck.value, stuck.label, figures.stuck > 0));
      counts.appendChild(counter('abandoned', abandoned.value, abandoned.label, figures.abandoned > 0));
      node.appendChild(counts);

      var open = openJobs(jobs);
      if (!open.length) return;

      var table = h('div', { className: 'job-table', role: 'table', 'aria-label': 'Jobs in progress' });
      table.appendChild(h('div', { className: 'job-head', role: 'row' }, [
        h('span', { role: 'columnheader', text: 'Job' }),
        h('span', { role: 'columnheader', text: 'Progress' }),
        h('span', { role: 'columnheader', text: 'Elapsed' }),
        h('span', { role: 'columnheader', text: 'State' })
      ]));
      open.slice(0, JOBS_SHOWN).forEach(function (job) { table.appendChild(jobLine(job, attention)); });
      node.appendChild(table);

      /* The rows are the working set, which is a slice of the queue; what the
         queue holds beyond them is said as a count and a way to the rest. */
      var more = figures.open === null ? 0 : figures.open - Math.min(open.length, JOBS_SHOWN);
      if (more > 0) {
        node.appendChild(h('a', {
          className: 'tile-more', href: S.paneHref('jobs') || 'jobs-live.html',
          text: '+' + fmt.int(more) + ' more'
        }));
      }
    }

    /* ------------------------------------------------------------ last 24h */

    function measuredWords(duration) {
      var measured = num(duration.measured);
      var total = num(duration.total);
      if (measured === null || measured < 1) return null;
      return total !== null && total > measured
        ? fmt.int(measured) + ' of ' + fmt.int(total) + ' measured'
        : fmt.int(measured) + ' measured';
    }

    /* `hot` marks a figure that is a count of something gone wrong and is not
       zero: the failed count is the one number on this tile that wants a
       person, and a zero is not news. */
    function figure(kind, value, label, sub, hot) {
      return h('div', { className: 'day-fig is-' + kind + (hot ? ' is-hot' : '') }, [
        h('span', { className: 'num day-n', text: value }),
        h('span', { className: 'day-l', text: label }),
        sub ? h('span', { className: 'day-sub', text: sub }) : null
      ]);
    }

    function drawDay(node) {
      node.appendChild(St.tileHead(null, 'Last 24h'));
      if (results.runs.error) {
        node.appendChild(failedLine('Last 24h could not be read', results.runs.error, ['runs'], 'day'));
        return;
      }
      var day = st.dayOfRuns() || { words: 'Last 24h not reported' };
      if (day.words) {
        node.appendChild(h('p', { className: 'day-words', text: day.words }));
        /* A day of nothing but cancellations has no rate, but the cancellations
           are the day. A zero or an unsent count says nothing more than the
           words above. */
        if (day.canceled > 0) {
          node.appendChild(h('p', { className: 'day-words', text: fmt.int(day.canceled) + ' cancelled' }));
        }
        return;
      }

      node.appendChild(h('div', { className: 'day-main' }, [
        h('span', { className: 'num day-big', text: fmt.int(day.worked) + ' / ' + fmt.int(day.attempted) }),
        h('span', { className: 'day-l', text: 'worked' }),
        h('span', { className: 'day-window', text: '\u00b7 24h' })
      ]));
      node.appendChild(St.workedBar(day));

      var tally = h('div', { className: 'day-tally' }, [
        figure('failed', fmt.int(day.failed), 'failed', null, day.failed > 0)
      ]);
      if (day.canceled !== null) {
        tally.appendChild(h('p', { className: 'day-foot', text: fmt.int(day.canceled) + ' cancelled' }));
      }
      var split = h('div', { className: 'day-split' }, [tally]);
      var duration = day.duration;
      var base = duration && num(duration.p50Ms) !== null ? measuredWords(duration) : null;
      if (base) split.appendChild(figure('typical', dur(duration.p50Ms), 'typical', base));
      node.appendChild(split);
    }

    /* --------------------------------------------------------- recent runs */

    function runLine(run, now) {
      var finished = parseDay(run.finishedAt);
      var outcome = textOf(run.outcome);
      var tone = OUTCOME_TONE[outcome] || '';
      var words = textOf(run.outcomeLabel) || OUTCOME[outcome] || fmt.none;
      return h('div', { className: 'run-line', role: 'row' }, [
        h('span', { className: 'num run-when', role: 'cell', text: finished ? whenOf(finished, now) : fmt.none }),
        h('span', { className: 'run-job', role: 'cell' }, [
          h('span', { className: 'job-ico', 'aria-hidden': 'true' }, [icon('spark')]),
          h('span', { className: 'job-type', text: runTypeLabel(run) })
        ]),
        h('span', { className: 'run-out' + (tone ? ' is-' + tone : ''), role: 'cell' }, [
          h('i', { className: 'dot' + (tone ? ' is-' + tone : ' is-idle'), 'aria-hidden': 'true' }),
          h('span', { text: maskContactDetails(words) })
        ]),
        h('span', { className: 'num run-took', role: 'cell', text: dur(run.durationMs) })
      ]);
    }

    function drawRuns(node) {
      var head = h('div', { className: 'tile-bar' }, [St.tileHead(null, 'Recent runs')]);
      head.appendChild(h('a', {
        className: 'tile-go', href: S.paneHref('history') || 'run-history.html'
      }, [
        h('span', { className: 'go-long', text: 'View history' }),
        h('span', { className: 'go-short', text: 'History' }),
        icon('arrow')
      ]));
      node.appendChild(head);

      if (results.runs.error) {
        node.appendChild(failedLine('Recent runs could not be read', results.runs.error, ['runs'], 'runs'));
        return;
      }
      var runs = data('runs') || {};
      var now = nowOf();
      var rows = list(runs.runs).filter(function (run) {
        return run && typeof run === 'object' && parseDay(run.finishedAt);
      }).sort(function (a, b) {
        return parseDay(b.finishedAt).getTime() - parseDay(a.finishedAt).getTime();
      });

      if (!rows.length) {
        var day = st.dayOfRuns();
        node.appendChild(h('p', {
          className: 'day-words',
          text: day && day.words ? day.words : 'No runs listed'
        }));
        return;
      }

      var table = h('div', { className: 'run-table', role: 'table', 'aria-label': 'Recent runs' });
      table.appendChild(h('div', { className: 'run-head', role: 'row' }, [
        h('span', { role: 'columnheader', text: 'Finished' }),
        h('span', { role: 'columnheader', text: 'Job' }),
        h('span', { role: 'columnheader', text: 'Outcome' }),
        h('span', { role: 'columnheader', text: 'Time' })
      ]));
      rows.slice(0, RUNS_SHOWN).forEach(function (run) { table.appendChild(runLine(run, now)); });
      node.appendChild(table);
    }

    /* -------------------------------------------------------------- checks */

    /* One source and when it last reported. On a phone only a source that is
       behind, or could not be read, keeps its row. */
    function freshRow(label, value, tone, always) {
      var quiet = !always && tone !== 'warn' && value !== 'Not read';
      return h('div', { className: 'chk-row' + (quiet ? ' is-quiet' : '') }, [
        h('dt', { className: 'chk-l', text: label }),
        h('dd', { className: 'chk-v' }, [
          tone ? h('i', { className: 'dot is-' + tone, 'aria-hidden': 'true' }) : null,
          h('span', { className: 'num', text: value })
        ])
      ]);
    }

    /* How old the billing figures are, judged the way the Money page judges
       them: behind when older than twice the route's own publish lag. */
    function billingTone(bill, asOf) {
      var hours = fmt.hoursSince(asOf.toISOString());
      var lag = num(bill.publishLagHours);
      var limit = (lag !== null && lag > 0 ? lag : BILLING_FALLBACK_LAG_HOURS) * BILLING_STALE_MULTIPLE;
      return hours !== null && hours >= limit ? 'warn' : 'ok';
    }

    function drawChecks(node) {
      var now = nowOf();
      var go = h('a', {
        className: 'tile-go', href: S.paneHref('problems') || 'problems.html'
      }, [h('span', { text: 'View checks' }), icon('arrow')]);
      node.appendChild(h('div', { className: 'tile-bar' }, [St.tileHead('chart', 'Checks'), go]));

      var summary = h('div', { className: 'chk-sum' });
      var notes = h('div', { className: 'chk-notes' });
      var last = null;
      var lastTone = null;

      if (results.rules.error) {
        node.appendChild(failedLine('Checks could not be read', results.rules.error, ['rules'], 'checks'));
      } else {
        var rules = data('rules') || {};
        if (!Array.isArray(rules.rules)) {
          node.appendChild(h('p', { className: 'day-words', text: 'Checks not reported' }));
        } else {
          var armed = model.armedState(rules);
          if (armed.enabled === 0) {
            node.appendChild(h('p', { className: 'day-words', text: 'No checks turned on' }));
          } else {
            summary.appendChild(h('span', { className: 'num chk-big', text: fmt.int(armed.checking) + ' of ' + fmt.int(armed.enabled) }));
            summary.appendChild(h('span', { className: 'chk-words', text: armed.enabled === 1 ? 'check reporting' : 'checks reporting' }));
            node.appendChild(summary);

            /* "7 of 9 checks reporting" already says how many are not, and the
               status line names them, so the card does not say it a third
               time under another name. Only a stale verdict is added here. */
            if (armed.stale > 0) {
              notes.appendChild(h('p', { className: 'chk-note' }, [
                h('i', { className: 'dot is-warn', 'aria-hidden': 'true' }),
                h('span', { text: fmt.int(armed.stale) + ' stale' })
              ]));
              node.appendChild(notes);
            }

            var seen = parseDay(armed.lastEvaluatedAt);
            last = seen ? stamped(seen, now) : fmt.none;
            /* Only a bad reading gets a dot: the stamp says when, and a green
               dot beside it would say "healthy", which a stamp cannot. */
            lastTone = seen && (armed.stale > 0 || armed.checking === 0) ? 'warn' : null;
          }
        }
      }

      var rows = h('dl', { className: 'chk-rows' });
      if (last !== null) rows.appendChild(freshRow('Last checked', last, lastTone, true));
      rows.appendChild(recorderRow(now));
      rows.appendChild(billingRow(now));
      node.appendChild(rows);
    }

    function recorderRow(now) {
      if (results.jobs.error) return freshRow('Job recorder', 'Not read', null);
      var recording = (data('jobs') || {}).recording || {};
      if (recording.state === 'never_recorded') return freshRow('Job recorder', 'Never recorded', 'warn');
      var at = parseDay(recording.lastRecordedAt);
      if (recording.state === 'recording' && at) return freshRow('Job recorder', stamped(at, now), 'ok');
      return freshRow('Job recorder', fmt.none, null);
    }

    function billingRow(now) {
      if (results.costs.error) return freshRow('Billing feed', 'Not read', null);
      var bill = data('costs') || {};
      var asOf = parseDay(bill.asOf);
      if (!asOf) return freshRow('Billing feed', fmt.none, null);
      return freshRow('Billing feed', stamped(asOf, now), billingTone(bill, asOf));
    }

    load();
  });
})(window);
