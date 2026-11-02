/* Today: how many people are using it this week, is it working, is anything
   wrong. The first screen of the operations dashboard.

   Today owns no detail. Every figure on it is a doorway into the page that
   owns the question, and nothing here renders a table, a facet or a control
   that changes a system.

   Drawn on the v2 design system through assets/shell-pane-v2.js. The pane
   holds no session, filter or navigation logic of its own.

   WHAT IT READS, each on its own terms

     GET /api/ops/summary           the people figure and the AI run count
     GET /api/ops/usage             the daily lines, and one earned moment
     GET /api/ops/alerts/problems   the queue
     GET /api/ops/alerts/rules      whether anything is in a position to notice
     GET /api/ops/jobs              what is running, queued and stuck
     GET /api/ops/runs              how the last 24 hours of runs went
     GET /api/ops/costs             the latest billed day and the daily average
     GET /api/ops/growth            the daily paying counts, for one earned
                                    moment and nothing else

   Every read is carried as a value, { data } or { error }, and every section
   draws from the reads it needs. A read that is down takes only its own
   section off the screen and gives it a Try again that re-reads only that
   read. The halves of this page come from different tables, and an operator
   who cannot see spend can still act on a critical problem.

   The growth read is the one exception to that, and is not in CORE: it feeds
   a single tile in "This week", and a backend that does not have the route
   (404), has not yet added `daily`, or fails to answer must leave Today
   exactly as it is without that tile, with no error and no Try again.

   The rules that are rules about NOT drawing something:

     1. **Empty never means zero.** A block whose availability is not `ready`
        is drawn as words and never as a numeral.
     2. **Mobile and Coaches Web are never summed.** The headline is the
        platform's own distinct count; one person using both is one person.
     3. **Nothing absent is filled in.** A day with no reading is a gap in the
        line, an absent comparison is shown as absent, and the change in
        active people is an absolute difference rather than a rate.
     4. **"No critical issues" is a claim.** It is printed only after a
        complete, readable problems result, and only when something was in a
        position to notice. A failed or capped read, or checks that are not
        running, say so instead.
     5. **A moment is earned or it is not drawn.** Each tile in "This week" has
        one rule, below, and renders only when its own reads prove it. A read
        that fails removes its tile and draws nothing in its place. */
(function (global) {
  'use strict';

  var S = global.OpsPaneShell;
  var h = S.h;
  var icon = S.icon;
  var fmt = S.fmt;
  var St = global.OpsStatus;
  var tileHead = St.tileHead;

  var ENDPOINT = {
    summary: '/api/ops/summary',
    usage: '/api/ops/usage',
    costs: '/api/ops/costs',
    growth: '/api/ops/growth'
  };

  /* Reads whose failure leaves the pane degraded. `growth` is not one: its
     only tile is optional by design. */
  var CORE = ['summary', 'usage', 'problems', 'rules', 'jobs', 'runs', 'costs'];

  var WEEK = 7;
  /* "Most paying in 8 weeks" compares today with the 56 days before it: the
     57 daily snapshots the growth route returns, today's included. */
  var PAYING_DAYS = 57;
  /* The days a usage window must cover before "best day in N days" says
     anything. A fortnight is two of the weeks the chart compares. */
  var BEST_DAY_MIN_DAYS = 14;

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

  var num = St.num;
  var list = St.list;
  var textOf = St.textOf;
  var stateOf = St.stateOf;

  function detailOf(block) {
    return textOf(block && block.availability && block.availability.detail);
  }

  function wordsFor(block) {
    return UNAVAILABLE_WORDS[stateOf(block)] || 'Not reported';
  }

  /* ----------------------------------------------------------------- dates */

  var parseDay = S.dates.parse;
  var monthDay = S.dates.monthDay;
  var dayRange = S.dates.dayRange;
  var headDate = S.dates.headDate;
  var updatedAt = S.dates.updatedAt;

  /* ----------------------------------------------------------------- reads */

  var get = St.get;

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
      return S.read({ paneId: 'overview', endpoint: ENDPOINT.summary })
        .then(function (result) { return result.data; });
    },
    usage: function () {
      return get(ENDPOINT.usage, { scope: 'all', range: '30d', env: 'production' });
    },
    problems: St.READS.problems,
    rules: St.READS.rules,
    jobs: St.READS.jobs,
    runs: St.READS.runs,
    costs: costs,
    growth: function () { return get(ENDPOINT.growth); }
  };

  /* ----------------------------------------------------------------- pane */

  S.definePane('overview', function (content) {
    var region = S.region(content);
    var loadToken = 0;
    var wrap = null;
    var hosts = {};

    /* What each section is called when its read is said to have come back. */
    var NAMES = {
      health: 'Health', live: 'Happening now', people: 'Active people', charts: 'Daily lines',
      moments: 'This week', problems: 'Problems', jobs: 'Happening now', ai: 'Aria AI',
      spend: 'Cloud spend'
    };

    /* The reads, the newest-ask-wins counters and the Try again are the
       shell's S.sections, reached through assets/pane-status.js, which also
       gives Today the status line and the problem rows it shares with Health,
       so there is one of each. */
    var st = St.create({
      prefix: 'today', title: 'Today', anchor: 'health', names: NAMES,
      content: content, reads: READ,
      redraw: function (keys) { redraw(keys); },
      syncState: function () { syncState(); }
    });
    var results = st.results;
    var data = st.data;
    var failure = st.failure;
    var failedLine = st.failedLine;
    var ask = st.ask;
    var landOn = st.landOn;
    var badgeProblems = st.badgeProblems;
    var jobFigures = st.jobFigures;
    var stuckWords = st.stuckWords;
    var dayOfRuns = st.dayOfRuns;

    /* --------------------------------------------------------- the load */

    function load() {
      var mine = ++loadToken;
      region.loading([
        { type: 'block', height: 40 },
        { type: 'block', height: 260 },
        { type: 'tiles', count: 3 },
        { type: 'block', height: 140 }
      ]);
      /* Asking advances every read, so a retry still out when the page is
         read again can no longer draw over the new page. */
      return ask(Object.keys(READ)).then(function (answers) {
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
      { id: 'health', reads: ['problems', 'rules'], draw: st.drawHealth },
      { id: 'live', reads: ['jobs'], draw: st.drawLive },
      { id: 'people', reads: ['summary'], draw: drawPeople },
      { id: 'charts', reads: ['usage'], draw: drawCharts },
      { id: 'moments', reads: ['usage', 'summary', 'growth'], draw: drawMoments },
      { id: 'problems', reads: ['problems'], draw: st.drawProblems },
      { id: 'jobs', reads: ['jobs'], draw: drawJobs },
      { id: 'ai', reads: ['summary', 'runs'], draw: drawAi },
      { id: 'spend', reads: ['costs'], draw: drawSpend }
    ];

    function host(id, tag, className) {
      var node = h(tag || 'div', { className: 'sec ' + (className || ''), id: 'today-' + id });
      hosts[id] = node;
      return node;
    }

    function render() {
      hosts = {};
      wrap = h('div', { className: 'stack today status-pane' });

      var status = h('div', { className: 'status-line' }, [
        host('health', 'div', 'status-health'),
        host('live', 'div', 'status-live')
      ]);
      var hero = S.card('hero-card');
      hero.appendChild(h('div', { className: 'hero-grid' }, [
        host('people', 'div', 'hero-people'),
        host('charts', 'div', 'hero-charts')
      ]));
      var tiles = h('div', { className: 'tiles' }, [
        host('jobs', 'article', 'tile tile-jobs'),
        host('ai', 'article', 'tile tile-ai'),
        host('spend', 'article', 'tile tile-spend')
      ]);

      wrap.appendChild(status);
      wrap.appendChild(hero);
      wrap.appendChild(host('moments', 'section', 'moments'));
      wrap.appendChild(host('problems', 'section', 'problem-rows'));
      wrap.appendChild(tiles);

      redraw(Object.keys(READ));

      if (CORE.every(function (key) { return results[key].error; })) {
        region.failed(results.summary.error, wholeRetry);
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
       title. It reads the summary's own stamp, so it is the time of the
       figures and not of the page. */
    function drawHead() {
      var slot = document.getElementById('pageSub');
      if (!slot) return;
      while (slot.firstChild) slot.removeChild(slot.firstChild);
      var stamp = (data('summary') && data('summary').generatedAt) ||
        (data('jobs') && data('jobs').generatedAt);
      var date = headDate(stamp);
      var updated = updatedAt(stamp);
      if (date) slot.appendChild(h('span', { className: 'sub-date', text: date }));
      if (updated) slot.appendChild(h('span', { className: 'sub-updated', text: updated }));
    }

    /* ------------------------------------------------------- the hero */

    function drawPeople(node) {
      if (results.summary.error) {
        node.appendChild(h('div', { className: 'hp-fail' }, [
          failure('Active people could not be read', results.summary.error, ['summary'], 'people')
        ]));
        return;
      }
      var summary = data('summary') || {};
      var people = summary.people;
      var active = num(people && people.platform && people.platform.active);

      var main = h('div', { className: 'hp-main' });
      main.appendChild(h('div', { className: 'hp-head' }, [
        h('h2', { className: 'sec-title', text: 'Active people' }),
        S.tip('today-people-scope',
          'Only people who turned on usage analytics are counted. Someone who uses both apps counts once.')
      ]));

      if (stateOf(people) !== 'ready' || active === null) {
        main.appendChild(h('p', { className: 'big words', text: wordsFor(people) }));
        var why = detailOf(people);
        if (why) main.appendChild(h('p', { className: 'hp-note', text: why }));
        node.appendChild(main);
        return;
      }

      main.appendChild(h('p', { className: 'big num', text: fmt.int(active) }));
      main.appendChild(S.delta(active, num(people.platform && people.platform.previousActive), people.comparison));
      var span = dayRange(people.window && people.window.start, people.window && people.window.endExclusive);
      var days = num(people.window && people.window.days);
      var range = span || (days === null ? null : 'Last ' + fmt.plural(days, 'day'));
      if (range) main.appendChild(h('p', { className: 'hp-range', text: range }));
      node.appendChild(main);

      /* Side by side and never added. The headline is the platform's own
         distinct count, so a reader who adds the two by eye and gets a larger
         number is looking at the one person who used both. */
      var apps = list(people.apps).filter(function (app) { return app && num(app.active) !== null; });
      if (apps.length) {
        var split = h('div', { className: 'hp-split' });
        apps.forEach(function (app) {
          split.appendChild(h('div', { className: 'split-item' }, [
            h('span', { className: 'split-label', text: textOf(app.label) || textOf(app.app) || 'App' }),
            h('span', { className: 'split-value num', text: fmt.int(app.active) })
          ]));
        });
        node.appendChild(split);
      }
    }

    function usageApps() {
      var usage = data('usage');
      if (!usage || stateOf(usage) !== 'ready') return [];
      return list(usage.apps).filter(function (app) {
        return app && app.trend && Array.isArray(app.trend.values);
      });
    }

    function drawCharts(node) {
      if (results.usage.error) {
        node.appendChild(failure('The daily lines could not be read', results.usage.error, ['usage'], 'charts'));
        return;
      }
      var usage = data('usage');
      var apps = usageApps();
      if (!apps.length) {
        node.appendChild(h('p', { className: 'big words', text: wordsFor(usage) }));
        var why = detailOf(usage);
        if (why) node.appendChild(h('p', { className: 'hp-note', text: why }));
        return;
      }

      var end = parseDay(usage.window && usage.window.endExclusive);
      var lead = true;
      apps.forEach(function (app) {
        var values = app.trend.values.map(num);
        var thisWeek = values.slice(-WEEK);
        var before = values.slice(-2 * WEEK, -WEEK);
        /* The ghost is drawn only when most of last week reported. A line
           through a week that is mostly gaps would compare against nothing. */
        var reported = before.filter(function (v) { return v !== null; }).length;
        var ghost = lead && before.length === thisWeek.length && reported * 2 >= before.length
          ? before : null;
        var label = textOf(app.label) || textOf(app.app) || 'App';
        var block = h('div', { className: 'chart-block' + (lead ? ' is-lead' : '') });
        var head = h('div', { className: 'chart-head' }, [
          h('h3', { className: 'sec-title chart-title', text: label + ' daily' })
        ]);
        if (lead) {
          var legend = h('span', { className: 'tc-legend' }, [
            h('span', { className: 'tc-key' }, [
              h('i', { className: 'tc-key-dot', 'aria-hidden': 'true' }),
              h('span', { text: 'This week' })
            ])
          ]);
          if (ghost) {
            legend.appendChild(h('span', { className: 'tc-key' }, [
              h('i', { className: 'tc-key-dash', 'aria-hidden': 'true' }),
              h('span', { text: 'Last week' })
            ]));
          }
          head.appendChild(legend);
        }
        block.appendChild(head);
        block.appendChild(S.trendChart({
          values: thisWeek, ghost: ghost, area: lead, axes: true, end: end,
          label: label + ' daily active people'
        }));
        node.appendChild(block);
        lead = false;
      });
    }

    /* ------------------------------------------------------ the moments */

    /* Each moment has one rule and renders only when its own reads prove it.
       None is ever faked, and the strip, label included, is gone when none is
       earned.

         best day    the latest finished UTC day is the strict maximum of
                     every reading the mobile line has, over at least a
                     fortnight with no missing rollup. N is the days covered.
         paying      the latest daily paying count is strictly above each of
                     the 56 daily counts before it, and every one of the 56
                     was captured. A tie, a single day with no snapshot, a
                     route with no `daily` and a failed read all draw nothing:
                     a day nobody counted could have been higher.
         AI runs     more runs than the week before, both weeks fully
                     reconciled. The number is the difference. */
    function bestMobileDay() {
      var usage = data('usage');
      if (!usage || stateOf(usage) !== 'ready') return null;
      var win = usage.window || {};
      var covered = num(win.daysCovered);
      if (covered === null || covered < BEST_DAY_MIN_DAYS) return null;
      if (!Array.isArray(win.daysMissingRollups) || win.daysMissingRollups.length) return null;
      var mobile = list(usage.apps).filter(function (app) { return app && app.app === 'mobile'; })[0];
      if (!mobile || !mobile.trend || !Array.isArray(mobile.trend.values)) return null;
      var values = mobile.trend.values.map(num);
      var latest = values[values.length - 1];
      if (latest === null || values.length < BEST_DAY_MIN_DAYS) return null;
      var others = values.slice(0, -1).filter(function (v) { return v !== null; });
      if (others.some(function (v) { return v >= latest; })) return null;
      return {
        tone: 'cyan', icon: 'trend', value: fmt.int(latest),
        label: 'Best ' + (textOf(mobile.label) || 'Mobile') + ' day',
        sub: 'in ' + fmt.plural(covered, 'day')
      };
    }

    function mostPaying() {
      var growth = data('growth');
      var daily = growth && growth.payingSubscribers && growth.payingSubscribers.daily;
      if (!Array.isArray(daily) || daily.length < PAYING_DAYS) return null;
      var counts = daily.slice(-PAYING_DAYS).map(function (day) {
        return day ? num(day.count) : null;
      });
      var latest = counts[counts.length - 1];
      if (counts.indexOf(null) !== -1) return null;
      if (counts.slice(0, -1).some(function (count) { return count >= latest; })) return null;
      return { tone: 'cyan', icon: 'trophy', value: fmt.int(latest), label: 'Most paying in 8 weeks' };
    }

    function moreAiRuns() {
      var ai = data('summary') && data('summary').aiRuns;
      if (!ai || stateOf(ai) !== 'ready') return null;
      var days = num(ai.window && ai.window.days);
      var runs = num(ai.runs);
      var before = ai.previous && num(ai.previous.runs);
      if (days === null || runs === null || before === null || before === undefined) return null;
      if (num(ai.daysReported) !== days || !Array.isArray(ai.daysMissing) || ai.daysMissing.length) return null;
      if (num(ai.previous.daysReported) !== days) return null;
      if (runs <= before) return null;
      return {
        tone: 'violet', icon: 'spark', value: '+' + fmt.int(runs - before),
        label: 'More AI runs', sub: 'vs last week'
      };
    }

    function drawMoments(node) {
      var earned = [bestMobileDay(), mostPaying(), moreAiRuns()].filter(Boolean);
      if (!earned.length) return;
      node.appendChild(h('h2', { className: 'sec-label', text: 'This week' }));
      var row = h('div', { className: 'moment-row' });
      earned.forEach(function (m) {
        row.appendChild(h('div', { className: 'moment is-' + m.tone }, [
          h('span', { className: 'moment-ico' }, [icon(m.icon)]),
          h('span', { className: 'moment-value num', text: m.value }),
          h('span', { className: 'moment-words' }, [
            h('span', { className: 'moment-label', text: m.label })
          ].concat(m.sub ? [h('span', { className: 'moment-sub', text: m.sub })] : []))
        ]));
      });
      node.appendChild(row);
    }

    /* -------------------------------------------------------- the tiles */

    function drawJobs(node) {
      var href = S.paneHref('jobs') || 'jobs-live.html';
      node.appendChild(tileHead('pulse', 'Happening now', href));
      if (results.jobs.error) {
        node.appendChild(failedLine('Jobs could not be read', results.jobs.error, ['jobs'], 'jobs'));
        return;
      }
      var figures = jobFigures() || {};
      var total = figures.open !== null && figures.open !== undefined
        ? h('p', { className: 'big' }, [
          h('span', { className: 'num', text: fmt.int(figures.open) }),
          h('span', { className: 'big-unit', text: figures.open === 1 ? 'job' : 'jobs' })
        ])
        : h('p', { className: 'big words', text: 'Not reported' });
      node.appendChild(total);

      var rows = h('div', { className: 'job-rows' });
      var row = function (kind, value, label, ticks) {
        /* Queued is the base: its ticks are the default grey, so it carries no
           marker of its own. A marker with no paint behind it is a class that
           draws nothing. */
        var item = h('div', { className: 'job-row' + (kind === 'queued' ? '' : ' is-' + kind) }, [
          h('span', { className: 'job-n num', text: value }),
          h('span', { className: 'job-l', text: label })
        ]);
        var tally = h('span', { className: 'tally', 'aria-hidden': 'true' });
        for (var i = 0; i < Math.min(ticks, 4); i++) tally.appendChild(h('i', { className: 'tick' }));
        item.appendChild(tally);
        rows.appendChild(item);
      };
      var show = function (n) { return n === null || n === undefined ? fmt.none : fmt.int(n); };
      row('running', show(figures.running), 'running', figures.running || 0);
      row('queued', show(figures.queued), 'queued', figures.queued || 0);
      if (figures.canceling) row('canceling', show(figures.canceling), 'canceling', figures.canceling);
      var stuck = stuckWords(figures);
      row('stuck', stuck.value, stuck.label, figures.stuck || 0);
      node.appendChild(rows);
    }

    function drawAi(node) {
      node.appendChild(tileHead('spark', 'Aria AI', S.paneHref('history') || 'run-history.html', 'violet'));

      if (results.summary.error) {
        node.appendChild(failedLine('AI runs could not be read', results.summary.error, ['summary'], 'ai'));
      } else {
        var ai = (data('summary') || {}).aiRuns;
        var runs = num(ai && ai.runs);
        if (stateOf(ai) !== 'ready' || runs === null) {
          node.appendChild(h('p', { className: 'big words', text: wordsFor(ai) }));
        } else {
          var days = num(ai.window && ai.window.days);
          node.appendChild(h('p', { className: 'big' }, [
            h('span', { className: 'num', text: fmt.int(runs) }),
            h('span', { className: 'big-unit', text: runs === 1 ? 'run' : 'runs' }),
            days === null ? null : h('span', { className: 'big-unit is-days', text: '\u00b7 ' + fmt.plural(days, 'day') })
          ]));
        }
      }

      if (results.runs.error) {
        node.appendChild(failedLine('Last 24h could not be read', results.runs.error, ['runs'], 'ai'));
        return;
      }
      var day = dayOfRuns() || { words: 'Last 24h not reported' };
      if (day.words) {
        node.appendChild(h('p', { className: 'ai-worked is-words', text: day.words }));
        return;
      }
      node.appendChild(h('p', { className: 'ai-worked' }, [
        h('span', { className: 'num', text: fmt.int(day.worked) + ' / ' + fmt.int(day.attempted) }),
        h('span', { text: 'worked' })
      ]));
      node.appendChild(h('p', { className: 'ai-window', text: 'Last 24h' }));
      node.appendChild(St.workedBar(day));
    }

    function drawSpend(node) {
      node.appendChild(tileHead('coin', 'Cloud spend', S.paneHref('spend') || 'spend.html'));
      if (results.costs.error) {
        node.appendChild(failedLine('Cloud spend could not be read', results.costs.error, ['costs'], 'spend'));
        return;
      }
      var bill = data('costs') || {};
      var period = bill.period || {};
      var billed = num(period.billedDays);
      var series = list(bill.daily && bill.daily.series)[0];
      var values = series ? list(series.values) : [];
      var latest = billed === null || billed < 1 ? null : num(values[billed - 1]);
      var total = num(bill.total && bill.total.micros);

      if (stateOf(bill) !== 'ready' || latest === null || total === null) {
        node.appendChild(h('p', { className: 'big words', text: wordsFor(bill) }));
        var why = detailOf(bill);
        if (why) node.appendChild(h('p', { className: 'hp-note', text: why }));
        return;
      }

      var through = parseDay(period.actualThrough);
      var start = parseDay(period.start);
      node.appendChild(h('p', { className: 'big' }, [
        h('span', { className: 'num', text: fmt.money(latest, bill.currency) })
      ]));
      node.appendChild(h('p', { className: 'spend-day', text: through ? monthDay(through) : '' }));

      var line = values.slice(0, billed).map(num);
      node.appendChild(S.trendChart({
        values: line, ghost: null, area: true, axes: false,
        label: 'Daily cloud spend over ' + fmt.plural(billed, 'billed day')
      }));

      node.appendChild(h('p', { className: 'spend-avg' }, [
        h('span', { className: 'num', text: fmt.money(total / billed, bill.currency) }),
        h('span', { text: ' daily avg' + (start ? ' \u00b7 ' + MONTHS[start.getUTCMonth()] : '') })
      ]));
      node.appendChild(h('a', {
        className: 'spend-link', href: S.paneHref('spend') || 'spend.html'
      }, [h('span', { text: 'View money' }), icon('arrow')]));
    }

    load();
  });
})(window);
