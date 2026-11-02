/* Aria AI: did Aria get its work done in the last day, how much of it was
   there this week, and what does it cost. The home of the Aria AI destination.

   Drawn on the v2 design system through assets/shell-pane-v2.js. The pane holds
   no session, filter or navigation logic of its own, and it has no control that
   changes a system: the people who rate Aria's answers work in Human review,
   and the tools that check or quarantine a dataset sit under More.

   WHAT IT READS, each on its own terms

     GET /api/ops/summary                          AI runs this week and last
     GET /api/ops/runs                             the last 24 hours of runs
     GET /api/ops/costs                            what the cloud bill says
                                                   about AI this month
     GET /api/ops/seval/admin/reviews/queue        what waits for a person

   Every read is carried as a value, { data } or { error }, and every section
   draws from the reads it needs. A read that is down takes only its own
   section off the screen and gives it a Try again that re-reads only that
   read.

   The rules that are rules about NOT drawing something:

     1. **Empty never means zero.** A block whose availability is not `ready`
        is drawn as words and never as a numeral.
     2. **Worked is out of what was attempted.** A cancellation is neither a
        success nor a failure, so it is in neither number. The figure is drawn
        only when the recorded window covers the whole last day.
     3. **A chart or a table is drawn from the complete list or not at all.**
        The runs list is newest first and stops at its limit. Every figure that
        counts it (the bars, and the rows under By job) is drawn only when the
        list holds every run the summary counted and every run lands in a bar.
        The headline figures come from the summary and do not need the list.
     4. **A week is compared with a week.** "+25 vs last week" is printed only
        when both weeks reported every day. A week with a gap says how many
        days it has instead of comparing.
     5. **The cost is the bill's.** The AI figure is the AI row of the month's
        bill and is shown next to the bill's own total. A month the export has
        not published yet falls back to the last one, and is named.
     6. **The bill has its own age.** The page's "Updated" time is the
        summary's. The cost block names the days the bill covers ("Oct 1\u20137")
        from its own `actualThrough`, and says so when the collector is failing
        or off, or the figures are old, because a ready bill can be the
        amounts of the last good poll. */
(function (global) {
  'use strict';

  var S = global.OpsPaneShell;
  var session = global.OpsSession;
  var h = S.h;
  var icon = S.icon;
  var fmt = S.fmt;

  var ENDPOINT = {
    summary: '/api/ops/summary',
    runs: '/api/ops/runs',
    costs: '/api/ops/costs',
    queue: '/api/ops/seval/admin/reviews/queue'
  };

  /* The most the runs route will send. The list is newest first, so a day with
     more finished jobs than this is cut off, and the route says so. */
  var RUN_LIMIT = 200;
  var BINS = 12;
  var HOUR_MS = 3600000;
  var BIN_MS = 2 * HOUR_MS;
  var DAY_MS = 24 * HOUR_MS;
  var ROWS_LISTED = 3;
  /* The review queue is not paged. A list this long may have been cut. */
  var QUEUE_FLOOR = 200;
  var REVIEW_ROLES = ['owner', 'operator', 'viewer'];

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /* The cost poller's own account of itself, in the words the Money pane
     uses for the same states (pane-spend.js POLLER_WORDS). A bill whose
     collector has failed or been switched off still arrives `ready`, with the
     amounts of the last good poll. */
  var POLLER_WORDS = {
    failed: 'Collection failing, showing the last good figures',
    unknown: 'Collection status unknown',
    disabled: 'Collection switched off',
    unconfigured: 'Collection not set up'
  };
  var FALLBACK_LAG_HOURS = 8;
  var STALE_MULTIPLE = 2;

  var UNAVAILABLE_WORDS = {
    not_reporting: 'No reading',
    not_collected: 'Not collected',
    not_reported: 'Not reported',
    not_published: 'Not published',
    mixed_currency: 'Two currencies',
    insufficient: 'Too few to report',
    unconfigured: 'Not set up',
    disabled: 'Switched off'
  };

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

  function wordsFor(block) {
    return UNAVAILABLE_WORDS[stateOf(block)] || 'Not reported';
  }

  /* ----------------------------------------------------------------- dates */

  function parseTime(iso) {
    if (typeof iso !== 'string' || !iso) return null;
    var t = new Date(iso).getTime();
    return isFinite(t) ? t : null;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function monthDay(ms) {
    var d = new Date(ms);
    return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
  }

  function clockOf(ms) {
    var d = new Date(ms);
    return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  }

  function headDate(iso) {
    var t = parseTime(iso);
    if (t === null) return null;
    var d = new Date(t);
    return WEEKDAYS[d.getUTCDay()] + ', ' + monthDay(t) + ', ' + d.getUTCFullYear();
  }

  function updatedAt(iso) {
    var t = parseTime(iso);
    return t === null ? null : 'Updated ' + clockOf(t) + ' UTC';
  }

  /* "Oct 31\u2013Nov 1", "Nov 1\u20132", or "Nov 1" when the window sits inside
     one day. The end is exclusive, so the label names the last instant in it. */
  function spanLabel(startMs, endExclusiveMs) {
    var first = new Date(startMs);
    var last = new Date(endExclusiveMs - 1);
    if (first.getUTCMonth() === last.getUTCMonth() && first.getUTCDate() === last.getUTCDate()) {
      return monthDay(startMs);
    }
    if (first.getUTCMonth() === last.getUTCMonth()) {
      return monthDay(startMs) + '\u2013' + last.getUTCDate();
    }
    return monthDay(startMs) + '\u2013' + monthDay(last.getTime());
  }

  /* A typical time as a person says it: 18s, 1m 4s. */
  function span(ms) {
    if (num(ms) === null || ms < 0) return null;
    if (ms < 1000) return Math.round(ms) + 'ms';
    if (ms < 10000) return (Math.round(ms / 100) / 10) + 's';
    if (ms < 60000) return Math.round(ms / 1000) + 's';
    var minutes = Math.floor(ms / 60000);
    var seconds = Math.round((ms % 60000) / 1000);
    if (seconds === 60) { minutes += 1; seconds = 0; }
    return minutes + 'm' + (seconds ? ' ' + seconds + 's' : '');
  }

  /* ----------------------------------------------------------------- reads */

  function get(endpoint, query) {
    return session.call(endpoint, { query: query }).then(function (payload) {
      return payload.data;
    });
  }

  /* The month so far, or the month before when the billing export has not yet
     published a day of this one. On the first of a month there is nothing
     billed to show, and the last month's closing day is the honest latest. */
  function costs() {
    return get(ENDPOINT.costs, { range: 'month' }).then(function (month) {
      if (stateOf(month) !== 'not_published') return month;
      return get(ENDPOINT.costs, { range: 'last-month' });
    });
  }

  var READ = {
    summary: function () {
      return S.read({ paneId: 'delivery', endpoint: ENDPOINT.summary })
        .then(function (result) { return result.data; });
    },
    runs: function () { return get(ENDPOINT.runs, { range: '24h', limit: RUN_LIMIT }); },
    costs: costs,
    /* A reply with no readable list is a failed read. An absent list passed on
       as an empty one would let "Nothing waiting" be printed over a queue
       nobody has seen. */
    queue: function () {
      return get(ENDPOINT.queue).then(function (queue) {
        var items = queue && queue.items;
        if (!Array.isArray(items) || items.some(function (i) { return !i || typeof i !== 'object'; })) {
          throw new Error('The review list came back in a form this page cannot read.');
        }
        return queue;
      });
    }
  };

  /* A read as a value, never a rejection. A synchronous throw is a failed read
     too. */
  function settled(key) {
    return new Promise(function (resolve) { resolve(READ[key]()); }).then(
      function (data) { return { data: data }; },
      function (err) { return { error: err }; }
    );
  }

  /* ----------------------------------------------------------------- pane */

  S.definePane('delivery', function (content) {
    var region = S.region(content);
    var loadToken = 0;
    /* One counter per read. Asking for a read advances its counter, and an
       answer may be used only while its counter is still the one it was asked
       under, so the newest ask of a read wins whatever order the answers come
       back in, and a read nobody asked again is never disturbed. */
    var generation = {};
    var results = {};
    var wrap = null;
    var hosts = {};
    var retryN = 0;
    var canReview = session.hasRole(REVIEW_ROLES);
    var KEYS = ['summary', 'runs', 'costs'].concat(canReview ? ['queue'] : []);

    function data(key) {
      var one = results[key];
      return one && !one.error ? one.data : null;
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
        headingId = 'dv-failed-' + retryN;
        titleNode.setAttribute('id', headingId);
      }
      var again = h('button', { className: 'btn btn-sm', type: 'button', text: 'Try again' });
      var buttonId = 'dv-retry-' + retryN;
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

    /* A read that failed inside a card that has other things to say. */
    function failedLine(headline, err, keys, sectionId) {
      var line = h('div', { className: 'fail-line' });
      var title = h('span', { className: 'fail-title', text: headline });
      line.appendChild(title);
      line.appendChild(h('span', { className: 'fail-why', text: S.failureMessage(err) }));
      line.appendChild(retryButton(title, keys, sectionId));
      return line;
    }

    var NAMES = {
      worked: 'Last 24 hours', chart: 'Jobs finished', stats: 'Last 24 hours',
      activity: 'Activity and cost', byjob: 'By job', review: 'Human review'
    };

    /* Pressing Try again redraws the section, which destroys the button.
       Focus falls to <body> unless it is put somewhere on purpose, and the
       section's own heading is the node that exists whether the retry worked
       or not. What is spoken is the outcome: the section came back, or the
       same failure is still there. */
    function landOn(sectionId) {
      var panel = shownPanel();
      if (!panel) return;
      var host = sectionId ? first(panel, '[id="dv-' + sectionId + '"]') : null;
      var head = first(host || panel, '.dv-title, .fail-title, .state-title');
      if (!head) return;
      head.setAttribute('tabindex', '-1');
      head.focus();
      var stuck = (host || panel).querySelectorAll('[data-retry]');
      var message;
      if (!host) {
        message = stuck.length
          ? 'Aria AI was read again. ' + fmt.plural(stuck.length, 'part') + ' could not be read.'
          : 'Aria AI was read again.';
      } else if (!stuck.length) {
        message = NAMES[sectionId] + ' was read again.';
      } else {
        message = String(stuck[0].getAttribute('data-retry') || '') + ' again.';
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

    /* Re-read these reads and nothing else, then redraw the sections that draw
       from them. Only an answer nobody has since asked for again is used: an
       older answer that arrives late draws nothing and moves nothing, and the
       retry that replaced it is the one that lands. Resolves to whether this
       retry drew, which is the only one that may move focus or speak. */
    function retry(keys) {
      return ask(keys).then(function (answers) {
        var used = answers.filter(function (a) { return a.current; });
        if (!used.length) return false;
        used.forEach(function (a) { results[a.key] = a.one; });
        redraw(used.map(function (a) { return a.key; }));
        syncState();
        return true;
      });
    }

    /* --------------------------------------------------------- the load */

    function load() {
      var mine = ++loadToken;
      region.loading([
        { type: 'block', height: 300 },
        { type: 'block', height: 230 }
      ]);
      /* Asking advances every read, so a retry still out when the page is read
         again can no longer draw over the new page. */
      return ask(KEYS).then(function (answers) {
        if (mine !== loadToken) return false;
        answers.forEach(function (a) { results[a.key] = a.one; });
        render();
        return true;
      }).catch(function (err) {
        /* The reads above cannot reject; this is render() throwing, the one
           failure that leaves nothing on screen. */
        if (mine !== loadToken) return false;
        region.failed(err, wholeRetry);
        return true;
      });
    }

    function wholeRetry() {
      return load().then(function (landed) {
        if (landed) landOn(null);
      });
    }

    var SECTIONS = [
      { id: 'worked', reads: ['runs'], draw: drawWorked },
      { id: 'chart', reads: ['runs'], draw: drawChart },
      { id: 'stats', reads: ['runs'], draw: drawStats },
      { id: 'activity', reads: ['summary', 'costs'], draw: drawActivity },
      { id: 'byjob', reads: ['runs'], draw: drawByJob },
      { id: 'review', reads: ['queue'], draw: drawReview }
    ];

    function host(id, tag, className) {
      var node = h(tag || 'div', { className: 'dv-host ' + (className || ''), id: 'dv-' + id });
      hosts[id] = node;
      return node;
    }

    function render() {
      hosts = {};
      wrap = h('div', { className: 'stack delivery' });

      var hero = S.card('dv-hero');
      hero.appendChild(h('div', { className: 'dv-hero-main' }, [
        host('worked', 'section', 'dv-worked'),
        host('chart', 'section', 'dv-chart-box')
      ]));
      hero.appendChild(host('stats', 'div', 'dv-stats'));

      wrap.appendChild(h('div', { className: 'dv-row dv-row-top' }, [
        hero,
        host('activity', 'section', 'card dv-activity')
      ]));
      var bottom = h('div', { className: 'dv-row dv-row-bottom' }, [
        host('byjob', 'section', 'card dv-byjob')
      ]);
      if (canReview) bottom.appendChild(host('review', 'section', 'card dv-review'));
      wrap.appendChild(bottom);

      redraw(KEYS);

      if (KEYS.every(function (key) { return results[key].error; })) {
        region.failed(results.summary.error, wholeRetry);
        return;
      }
      syncState();
    }

    function syncState() {
      var down = KEYS.some(function (key) { return results[key].error; });
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
      drawHead();
    }

    /* The date and when it was read, in the slot the shell leaves under the
       title. It reads the summary's own stamp, so it is the time of the
       figures and not of the page; with no summary it falls back to the moment
       the last day's window closed. */
    function drawHead() {
      var slot = document.getElementById('pageSub');
      if (!slot) return;
      while (slot.firstChild) slot.removeChild(slot.firstChild);
      var runs = data('runs');
      var stamp = (data('summary') && data('summary').generatedAt) ||
        (runs && runs.window && runs.window.endExclusiveAt);
      var date = headDate(stamp);
      var updated = updatedAt(stamp);
      if (date) slot.appendChild(h('span', { className: 'sub-date', text: date }));
      if (updated) slot.appendChild(h('span', { className: 'sub-updated', text: updated }));
    }

    /* ---------------------------------------------------- the last day */

    /* Worked and attempted over the last day. A cancellation is neither: the
       person who pressed cancel did not experience a failure, and counting it
       as one would make the rate a measure of impatience. It is rolling 24-hour
       lifecycle delivery, not a verdict on the quality of an answer. */
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
      return { worked: done, attempted: done + failed, failed: failed };
    }

    /* The last day's jobs sorted into twelve two-hour bars and into job types,
       or words saying why not. Only a list that holds every run the summary
       counted, with every run inside the window, may be counted at all: a list
       cut at its limit is the newest jobs, and bars drawn from it would show
       the early hours of the day as quieter than they were. */
    function listing() {
      var runs = data('runs');
      var rows = list(runs && runs.runs);
      var total = num(runs && runs.summary && runs.summary.runs);
      var unlisted = { words: 'Not every job was listed' };
      if (!runs || runs.truncated !== false || total === null || rows.length !== total) return unlisted;

      var start = parseTime(runs.window && runs.window.startAt);
      var end = parseTime(runs.window && runs.window.endExclusiveAt);
      if (start === null || end === null || end - start !== DAY_MS) return { words: 'Last 24h not reported' };

      var bins = [];
      for (var i = 0; i < BINS; i++) bins.push(0);
      var types = {};
      var order = [];
      for (var r = 0; r < rows.length; r++) {
        var run = rows[r];
        var at = parseTime(run && run.finishedAt);
        if (at === null || at < start || at >= end) return unlisted;
        bins[Math.floor((at - start) / BIN_MS)] += 1;

        var kind = run.type && textOf(run.type.value);
        if (!kind) return unlisted;
        if (!types[kind]) {
          types[kind] = { label: textOf(run.type.label) || kind, worked: 0, failed: 0 };
          order.push(kind);
        }
        if (run.outcome === 'completed') types[kind].worked += 1;
        else if (run.outcome === 'failed') types[kind].failed += 1;
      }

      var byJob = order.map(function (kind) { return types[kind]; })
        .filter(function (t) { return t.worked + t.failed > 0; })
        .sort(function (a, b) {
          return (b.worked + b.failed) - (a.worked + a.failed) || a.label.localeCompare(b.label);
        });
      return { start: start, end: end, bins: bins, byJob: byJob, finished: rows.length };
    }

    function drawWorked(node) {
      node.appendChild(h('h2', { className: 'dv-title', text: 'Worked' }));
      if (results.runs.error) {
        node.appendChild(failedLine('Last 24h could not be read', results.runs.error, ['runs'], 'worked'));
        return;
      }
      var day = dayOfRuns() || { words: 'Last 24h not reported' };
      if (day.words) {
        node.appendChild(h('p', { className: 'dv-words', text: day.words }));
        return;
      }
      node.appendChild(h('p', { className: 'dv-big' }, [
        h('span', { className: 'num', text: fmt.int(day.worked) + ' / ' + fmt.int(day.attempted) })
      ]));
      node.appendChild(h('p', { className: 'dv-sub', text: 'Last 24h' }));
      var bar = h('div', { className: 'dv-bar', 'aria-hidden': 'true' });
      var fill = h('i', { className: 'dv-fill' });
      fill.style.setProperty('width', ((day.worked / day.attempted) * 100).toFixed(2) + '%');
      bar.appendChild(fill);
      if (day.failed > 0) bar.appendChild(h('i', { className: 'dv-miss' }));
      node.appendChild(bar);
    }

    function drawStats(node) {
      var day = dayOfRuns();
      if (!day || day.words) return;
      var summary = data('runs').summary || {};
      var duration = summary.duration || {};
      var typical = span(duration.p50Ms);
      var measured = num(duration.measured);

      node.appendChild(h('p', { className: 'dv-stat' }, [
        h('span', { className: 'dv-stat-num num', text: typical === null ? fmt.none : typical }),
        h('span', {
          className: 'dv-stat-label',
          text: typical === null ? 'Typical time not measured'
            : 'Typical' + (measured === null ? '' : ' \u00b7 ' + fmt.int(measured) + ' measured')
        })
      ]));
      node.appendChild(h('p', { className: 'dv-stat' }, [
        h('span', { className: 'dv-stat-num num', text: fmt.int(day.failed) }),
        h('span', { className: 'dv-stat-label', text: 'Failed' })
      ]));
    }

    /* ------------------------------------------------------ the chart */

    function drawChart(node) {
      if (results.runs.error) return;
      var day = dayOfRuns();
      if (!day || day.words) return;

      node.appendChild(h('h2', { className: 'dv-title', text: 'Jobs finished' }));
      var seen = listing();
      if (seen.words) {
        node.appendChild(h('p', { className: 'dv-words', text: seen.words }));
        return;
      }
      node.appendChild(h('span', {
        className: 'dv-window', text: spanLabel(seen.start, seen.end) + ' \u00b7 UTC'
      }));
      node.appendChild(barChart(seen));
    }

    /* Twelve bars, one per two hours, each labelled with its own count. A bar
       of nothing is a label and no bar, so a quiet stretch reads as quiet and
       not as a missing column. It is HTML with percent heights, so the type
       keeps its size when the chart narrows, and the data is in the accessible
       name because a role="img" subtree is presentational. */
    function barChart(seen) {
      var top = Math.max.apply(null, seen.bins);
      var ceiling = Math.max(4, top + (top % 2));

      var spoken = seen.bins.map(function (n, i) {
        return clockOf(seen.start + i * BIN_MS) + ' ' + n;
      }).join(', ');
      var chart = h('div', {
        className: 'dv-chart', role: 'img',
        'aria-label': 'Jobs finished in each two hours, ' + spanLabel(seen.start, seen.end) +
          ' UTC. ' + fmt.plural(seen.finished, 'job') + ' in all. ' + spoken + '.'
      });
      var plot = h('div', { className: 'dv-plot' });

      [0, 50, 100].forEach(function (at) {
        var line = h('i', { className: 'dv-grid' + (at === 100 ? ' is-base' : '') });
        line.style.setProperty('top', at + '%');
        plot.appendChild(line);
        var tick = h('span', { className: 'dv-y', text: fmt.int(ceiling - (at / 100) * ceiling) });
        tick.style.setProperty('top', at + '%');
        plot.appendChild(tick);
      });

      var bars = h('div', { className: 'dv-bars' });
      seen.bins.forEach(function (n) {
        var col = h('div', { className: 'dv-col' });
        col.appendChild(h('span', { className: 'dv-val', text: fmt.int(n) }));
        if (n > 0) {
          var bar = h('i', { className: 'dv-col-bar' });
          bar.style.setProperty('height', ((n / ceiling) * 100).toFixed(2) + '%');
          col.appendChild(bar);
        }
        bars.appendChild(col);
      });
      plot.appendChild(bars);
      chart.appendChild(plot);

      var axis = h('div', { className: 'dv-axis' });
      [['is-start', seen.start], ['is-mid', seen.start + 6 * BIN_MS], ['is-end', seen.end]]
        .forEach(function (pair) {
          axis.appendChild(h('span', { className: 'dv-x ' + pair[0], text: clockOf(pair[1]) }));
        });
      chart.appendChild(axis);
      return chart;
    }

    /* ---------------------------------------------------------- by job */

    function drawByJob(node) {
      node.appendChild(h('div', { className: 'dv-head' }, [
        h('h2', { className: 'dv-title', text: 'By job' }),
        h('span', { className: 'dv-sub', text: 'Last 24h' })
      ]));
      if (results.runs.error) {
        node.appendChild(failedLine('Jobs could not be read', results.runs.error, ['runs'], 'byjob'));
        return;
      }
      var day = dayOfRuns();
      if (!day || day.words) {
        node.appendChild(h('p', { className: 'dv-words', text: (day && day.words) || 'Last 24h not reported' }));
        return;
      }
      var seen = listing();
      if (seen.words) {
        node.appendChild(h('p', { className: 'dv-words', text: seen.words }));
        return;
      }

      var body = h('tbody');
      seen.byJob.forEach(function (job) {
        var failed = h('td', { className: 'dv-n' }, [
          h('span', { className: 'num', text: fmt.int(job.failed) }),
          job.failed > 0 ? h('i', { className: 'dv-miss is-inline', 'aria-hidden': 'true' }) : null
        ]);
        body.appendChild(h('tr', null, [
          h('th', { scope: 'row', text: job.label }),
          h('td', { className: 'dv-n num', text: fmt.int(job.worked) }),
          failed
        ]));
      });
      node.appendChild(h('table', { className: 'dv-table' }, [
        h('caption', { className: 'sr', text: 'Jobs that worked and failed in the last 24 hours, by job' }),
        h('thead', null, [h('tr', null, [
          h('th', { scope: 'col', text: 'Job' }),
          h('th', { scope: 'col', className: 'dv-n', text: 'Worked' }),
          h('th', { scope: 'col', className: 'dv-n', text: 'Failed' })
        ])]),
        body
      ]));
      node.appendChild(h('a', {
        className: 'dv-link', href: S.paneHref('history') || 'run-history.html'
      }, [h('span', { text: 'Open run history' }), icon('arrow')]));
    }

    /* ------------------------------------------------ activity and cost */

    /* This week's AI runs against last week's. The comparison is drawn only
       when both weeks reported every one of their days, because a week with a
       gap in it compared with a whole one reads as a collapse in use. */
    function weekNote(ai, runs) {
      var days = num(ai.window && ai.window.days);
      var reported = num(ai.daysReported);
      if (days !== null && reported !== null && reported < days) {
        return { text: fmt.int(reported) + ' of ' + fmt.plural(days, 'day') + ' reported' };
      }
      var before = ai.previous;
      var beforeRuns = num(before && before.runs);
      var beforeDays = num(before && before.daysReported);
      var compared = num(ai.comparison && ai.comparison.days);
      if (beforeRuns === null || beforeDays === null || compared === null || beforeDays < compared) {
        return null;
      }
      var change = runs - beforeRuns;
      if (change === 0) return { text: 'Same as last week' };
      if (change > 0) return { text: '+' + fmt.int(change) + ' vs last week', up: true };
      return { text: '\u2212' + fmt.int(-change) + ' vs last week' };
    }

    function drawActivity(node) {
      node.appendChild(h('h2', { className: 'dv-title', text: 'Activity & cost' }));

      var aiHalf = h('div', { className: 'dv-half' });
      node.appendChild(aiHalf);
      if (results.summary.error) {
        aiHalf.appendChild(failedLine('AI runs could not be read', results.summary.error, ['summary'], 'activity'));
      } else {
        var ai = (data('summary') || {}).aiRuns;
        var runs = num(ai && ai.runs);
        if (stateOf(ai) !== 'ready' || runs === null) {
          aiHalf.appendChild(h('p', { className: 'dv-words', text: wordsFor(ai) }));
        } else {
          var days = num(ai.window && ai.window.days);
          aiHalf.appendChild(h('p', { className: 'dv-big' }, [
            h('span', { className: 'num', text: fmt.int(runs) })
          ]));
          aiHalf.appendChild(h('p', { className: 'dv-sub', text:
            (runs === 1 ? 'AI run' : 'AI runs') + (days === null ? '' : ' \u00b7 ' + fmt.plural(days, 'day')) }));
          var note = weekNote(ai, runs);
          if (note) aiHalf.appendChild(h('p', { className: 'dv-delta' + (note.up ? ' is-up' : ''), text: note.text }));
        }
      }

      var costHalf = h('div', { className: 'dv-half is-cost' });
      node.appendChild(costHalf);
      if (results.costs.error) {
        costHalf.appendChild(failedLine('Cloud cost could not be read', results.costs.error, ['costs'], 'activity'));
        return;
      }
      var bill = data('costs') || {};
      var total = num(bill.total && bill.total.micros);
      if (stateOf(bill) !== 'ready' || total === null) {
        costHalf.appendChild(h('p', { className: 'dv-words', text: wordsFor(bill) }));
        /* A collector that is off or not set up is already the words above. */
        var pollerState = textOf(bill.staleness && bill.staleness.state);
        if (pollerState !== stateOf(bill)) appendNotes(costHalf, [pollerNote(bill)]);
        return;
      }
      var rows = list(bill.views && bill.views.category && bill.views.category.rows);
      var aiRow = null;
      rows.forEach(function (row) { if (row && row.key === 'ai_and_models') aiRow = row; });
      var billed = num(aiRow && aiRow.micros);
      if (billed === null) {
        costHalf.appendChild(h('p', { className: 'dv-words', text: 'No AI cost billed' }));
        costHalf.appendChild(h('p', { className: 'dv-sub', text: billWindow(bill) }));
        appendNotes(costHalf, [pollerNote(bill), ageNote(bill)]);
        return;
      }
      costHalf.appendChild(h('p', { className: 'dv-big' }, [
        h('span', { className: 'num', text: fmt.money(billed, bill.currency) })
      ]));
      costHalf.appendChild(h('p', { className: 'dv-sub', text: 'Cloud AI \u00b7 ' + billWindow(bill) }));
      costHalf.appendChild(h('p', { className: 'dv-included', text:
        'Included in ' + fmt.money(total, bill.currency, 0) + ' cloud total' }));
      appendNotes(costHalf, [pollerNote(bill), ageNote(bill)]);
    }

    /* The days the bill covers: the month once it is billed to its last day,
       and otherwise "Oct 1\u20137", from the bill's own `actualThrough`. A bill
       that does not say how far it reaches falls back to its billed-day count. */
    function billWindow(bill) {
      var period = bill.period || {};
      var start = parseTime(period.start);
      if (start === null) return 'this month';
      var first = new Date(start);
      var name = MONTHS_LONG[first.getUTCMonth()];
      var through = parseTime(period.actualThrough);
      if (through !== null && through >= start) {
        var lastDay = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1) - DAY_MS;
        return through >= lastDay ? name : spanLabel(start, through + DAY_MS);
      }
      var billed = num(period.billedDays);
      var length = num(period.daysInPeriod);
      return billed !== null && length !== null && billed < length ? name + ' so far' : name;
    }

    /* Said only when there is something to say: the collector's own state when
       it is not `ok`, in its own sentence when it sends one. */
    function pollerNote(bill) {
      var state = textOf(bill.staleness && bill.staleness.state);
      if (!state || state === 'ok') return null;
      var detail = textOf(bill.staleness.detail);
      if (detail) return global.OpsPaneRegistry.maskContactDetails(detail);
      return Object.prototype.hasOwnProperty.call(POLLER_WORDS, state)
        ? POLLER_WORDS[state] : 'Collection needs attention';
    }

    /* How old the figures are, against the bill's own publishing lag, doubled.
       The page's "Updated" time is the summary's, not the bill's. */
    function ageNote(bill) {
      var asOf = textOf(bill.asOf);
      var hours = asOf ? fmt.hoursSince(asOf) : null;
      if (hours === null) return 'No collection time';
      var lag = num(bill.publishLagHours);
      return hours >= (lag !== null && lag > 0 ? lag : FALLBACK_LAG_HOURS) * STALE_MULTIPLE
        ? fmt.hours(hours) + ' behind' : null;
    }

    function appendNotes(half, notes) {
      notes.forEach(function (note) {
        if (!note) return;
        half.appendChild(h('p', { className: 'dv-note' }, [icon('warn'), h('span', { text: note })]));
      });
    }

    /* --------------------------------------------------- human review */

    function drawReview(node) {
      var head = h('div', { className: 'dv-head' });
      var title = h('h2', { className: 'dv-title' });
      title.appendChild(h('span', { className: 'dv-spark' }, [icon('spark')]));
      title.appendChild(h('span', { text: 'Human review' }));
      head.appendChild(title);
      node.appendChild(head);

      if (results.queue.error) {
        node.appendChild(failedLine('Reviews could not be read', results.queue.error, ['queue'], 'review'));
        return;
      }
      var queue = data('queue');
      var items = list(queue.items);
      var waiting = items.filter(function (item) {
        return item.status === 'open' || item.status === 'disputed';
      });
      /* A queue that was cut, or that a source could not be read for, is a
         floor and not a count. */
      var partial = queue.partial === true || list(queue.omissions).length > 0;
      var capped = items.length >= QUEUE_FLOOR;
      var atLeast = partial || capped;

      if (!waiting.length) {
        node.appendChild(h('p', { className: 'dv-words', text:
          atLeast ? 'Review list not fully read' : 'Nothing waiting for review' }));
        return;
      }
      head.appendChild(h('span', { className: 'dv-count', text:
        fmt.int(waiting.length) + (atLeast ? '+' : '') + ' open' }));

      var rows = h('ul', { className: 'dv-reviews' });
      waiting.slice(0, ROWS_LISTED).forEach(function (item) {
        var statement = textOf(item.rubric && item.rubric.statement) || 'Answer to review';
        var domain = textOf(item.rubric && item.rubric.authority && item.rubric.authority.domain);
        var meta = [];
        if (domain) meta.push(domain.charAt(0).toUpperCase() + domain.slice(1));
        if (item.status === 'disputed') meta.push('Reviewers disagree');
        var words = h('div', { className: 'dv-review-words' }, [
          h('span', { className: 'dv-review-name', text: statement }),
          meta.length ? h('span', { className: 'dv-review-meta', text: meta.join(' \u00b7 ') }) : null
        ]);
        rows.appendChild(h('li', { className: 'dv-item' }, [
          words,
          h('a', {
            className: 'dv-link is-row', href: S.paneHref('review') || 'review.html',
            'aria-label': 'Review: ' + statement
          }, [h('span', { text: 'Review' }), icon('arrow')])
        ]));
      });
      node.appendChild(rows);

      var more = waiting.length - ROWS_LISTED;
      if (more > 0 || atLeast) {
        node.appendChild(h('a', {
          className: 'dv-link', href: S.paneHref('review') || 'review.html'
        }, [h('span', { text: more > 0 ? 'See all ' + fmt.int(waiting.length) + (atLeast ? '+' : '') : 'See the list' }), icon('arrow')]));
      }
    }

    load();
  });
})(window);
