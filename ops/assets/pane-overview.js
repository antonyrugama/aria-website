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

   Every read is carried as a value, { data } or { error }, and every section
   draws from the reads it needs. A read that is down takes only its own
   section off the screen and gives it a Try again that re-reads only that
   read. The halves of this page come from different tables, and an operator
   who cannot see spend can still act on a critical problem.

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
    costs: '/api/ops/costs'
  };

  /* Reads whose failure leaves the pane degraded. */
  var CORE = ['summary', 'usage', 'problems', 'rules', 'jobs', 'runs', 'costs'];

  var WEEK = 7;
  /* The days a usage window must cover before "best day in N days" says
     anything. A fortnight is two of the weeks the chart compares. */
  var BEST_DAY_MIN_DAYS = 14;

  var MONTHS = St.MONTHS;
  var DAY_MS = 86400000;

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

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(name, attrs) {
    var el = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, String(attrs[k])); });
    return el;
  }

  /* ------------------------------------------------------------ readings */

  var num = St.num;
  var list = St.list;
  var textOf = St.textOf;
  var stateOf = St.stateOf;
  var parseDay = St.parseDay;
  var monthDay = St.monthDay;
  var headDate = St.headDate;
  var updatedAt = St.updatedAt;

  function detailOf(block) {
    return textOf(block && block.availability && block.availability.detail);
  }

  function wordsFor(block) {
    return UNAVAILABLE_WORDS[stateOf(block)] || 'Not reported';
  }

  /* ----------------------------------------------------------------- dates */

  /* "Oct 25–31", or "Oct 28–Nov 3" across a month. The end is exclusive in the
     answer, and the label names the last whole day. */
  function dayRange(startIso, endExclusiveIso) {
    var start = parseDay(startIso);
    var end = parseDay(endExclusiveIso);
    if (!start || !end || end.getTime() <= start.getTime()) return null;
    var last = new Date(end.getTime() - DAY_MS);
    if (last.getUTCMonth() === start.getUTCMonth()) {
      return monthDay(start) + '\u2013' + last.getUTCDate();
    }
    return monthDay(start) + '\u2013' + monthDay(last);
  }

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
    costs: costs
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

    /* The retry engine, the status line and the problem rows are shared with
       Health (assets/pane-status.js), so there is one of each. */
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
      { id: 'moments', reads: ['usage', 'summary'], draw: drawMoments },
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
        scopeTip()
      ]));

      if (stateOf(people) !== 'ready' || active === null) {
        main.appendChild(h('p', { className: 'big words', text: wordsFor(people) }));
        var why = detailOf(people);
        if (why) main.appendChild(h('p', { className: 'hp-note', text: why }));
        node.appendChild(main);
        return;
      }

      main.appendChild(h('p', { className: 'big num', text: fmt.int(active) }));
      main.appendChild(delta(people, active));
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

    /* The change against the window before, as a difference in people. Never a
       rate: a share over a group this small moves several points on one
       person, and the reporting floor withholds exactly that. An absent
       comparison is shown as absent, never as no change. */
    function delta(people, active) {
      var before = num(people.platform && people.platform.previousActive);
      var span = num(people.comparison && people.comparison.days);
      if (before === null || !people.comparison) {
        return h('p', { className: 'delta is-none', text: 'No comparison yet' });
      }
      var diff = active - before;
      var against = span === null || span === WEEK ? 'last week' : 'the ' + fmt.plural(span, 'day') + ' before';
      if (diff === 0) return h('p', { className: 'delta is-flat', text: 'No change vs ' + against });
      var word = (diff > 0 ? '+' : '\u2212') + fmt.int(Math.abs(diff)) + ' vs ' + against;
      return h('p', { className: 'delta ' + (diff > 0 ? 'is-up' : 'is-down') }, [
        icon('arrow'),
        h('span', { text: word })
      ]);
    }

    /* The scope of the figure, carried by an info icon rather than a label.
       Hover and keyboard focus show it; Escape puts it away again. */
    function scopeTip() {
      var bubble = h('span', {
        className: 'tip-bubble', role: 'tooltip', id: 'today-people-scope',
        text: 'Only people who turned on usage analytics are counted. Someone who uses both apps counts once.'
      });
      var button = h('button', {
        className: 'tip-btn', type: 'button',
        'aria-label': 'What this counts', 'aria-describedby': 'today-people-scope'
      }, [icon('info')]);
      var tip = h('span', { className: 'tip' }, [button, bubble]);
      button.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') bubble.setAttribute('data-dismissed', '');
      });
      ['mouseleave', 'blur'].forEach(function (name) {
        button.addEventListener(name, function () { bubble.removeAttribute('data-dismissed'); });
      });
      return tip;
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
        block.appendChild(trendChart({
          values: thisWeek, ghost: ghost, area: lead, axes: true, end: end,
          label: label + ' daily active people'
        }));
        node.appendChild(block);
        lead = false;
      });
    }

    /* --------------------------------------------------- the charts */

    /* A line over the days it has a reading for, drawn as an SVG whose shape
       is the data and HTML marks for everything with text in it, so the type
       keeps its size when the chart narrows. The path breaks at a day with no
       reading and never drops to the floor through one. */
    function trendChart(opts) {
      var values = opts.values;
      var ghost = opts.ghost;
      var all = values.concat(ghost || []).filter(function (v) { return v !== null; });
      var floor = 0;
      var ceiling;
      if (opts.axes) {
        /* Data driven: an even ceiling just over the highest reading, so the
           peak never touches the top of the plot. */
        var top = all.length ? Math.max.apply(null, all) : 0;
        ceiling = Math.max(4, top + 1 + ((top + 1) % 2));
      } else {
        /* A sparkline has no axis to mislead, so it uses its own range. */
        floor = all.length ? Math.min.apply(null, all) : 0;
        ceiling = all.length ? Math.max.apply(null, all) : 1;
        if (ceiling === floor) ceiling = floor + 1;
      }
      var span = ceiling - floor;
      var count = values.length;
      var px = function (i) { return count > 1 ? (i / (count - 1)) * 100 : 50; };
      var py = function (v) { return 100 - ((v - floor) / span) * 100; };

      var chart = h('div', {
        className: 'tchart' + (opts.axes ? '' : ' is-spark') + (opts.area ? ' is-area' : ''),
        role: 'img',
        'aria-label': chartName(opts)
      });
      var plot = h('div', { className: 'tc-plot' });
      var inner = h('div', { className: 'tc-inner' });

      if (opts.axes) {
        [0, 50, 100].forEach(function (at) {
          var line = h('i', { className: 'tc-grid' + (at === 100 ? ' is-base' : '') });
          line.style.setProperty('top', at + '%');
          plot.appendChild(line);
          var tick = h('span', {
            className: 'tc-y',
            text: fmt.int(ceiling - (at / 100) * ceiling)
          });
          tick.style.setProperty('top', at + '%');
          plot.appendChild(tick);
        });
      }

      var svg = svgEl('svg', { 'class': 'tc-svg', viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
      var gradient = 'tc-fill-' + (++gradientN);
      if (opts.area) {
        var defs = svgEl('defs');
        var stops = svgEl('linearGradient', { id: gradient, x1: 0, y1: 0, x2: 0, y2: 1 });
        stops.appendChild(svgEl('stop', { offset: '0', 'class': 'tc-stop-top' }));
        stops.appendChild(svgEl('stop', { offset: '1', 'class': 'tc-stop-base' }));
        defs.appendChild(stops);
        svg.appendChild(defs);
      }

      var runsOf = function (series) {
        var runs = [];
        var run = [];
        series.forEach(function (v, i) {
          if (v === null) {
            if (run.length) runs.push(run);
            run = [];
            return;
          }
          run.push([px(i), py(v)]);
        });
        if (run.length) runs.push(run);
        return runs;
      };
      var trace = function (run) {
        return run.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2); }).join(' ');
      };

      if (ghost) {
        runsOf(ghost).forEach(function (run) {
          if (run.length > 1) svg.appendChild(svgEl('path', { 'class': 'tc-ghost', d: trace(run) }));
        });
      }
      runsOf(values).forEach(function (run) {
        if (run.length < 2) return;
        if (opts.area) {
          var last = run[run.length - 1];
          svg.appendChild(svgEl('path', {
            'class': 'tc-area', fill: 'url(#' + gradient + ')',
            d: trace(run) + ' L' + last[0].toFixed(2) + ' 100 L' + run[0][0].toFixed(2) + ' 100 Z'
          }));
        }
        svg.appendChild(svgEl('path', { 'class': 'tc-line', d: trace(run) }));
      });
      inner.appendChild(svg);

      var lastIndex = -1;
      values.forEach(function (v, i) { if (v !== null) lastIndex = i; });
      values.forEach(function (v, i) {
        if (v === null) return;
        if (!opts.axes && i !== lastIndex) return;
        var dot = h('i', { className: 'tc-dot' + (i === lastIndex ? ' is-end' : '') });
        dot.style.setProperty('left', px(i).toFixed(2) + '%');
        dot.style.setProperty('top', py(v).toFixed(2) + '%');
        inner.appendChild(dot);
        if (opts.axes) {
          var tag = h('span', { className: 'tc-val' + (i === lastIndex ? ' is-end' : ''), text: fmt.int(v) });
          tag.style.setProperty('left', px(i).toFixed(2) + '%');
          tag.style.setProperty('top', py(v).toFixed(2) + '%');
          inner.appendChild(tag);
        }
      });

      if (opts.axes && opts.end) {
        [0, Math.floor((count - 1) / 2), count - 1].forEach(function (i, slot) {
          if (slot === 1 && (count - 1) % 2 !== 0) return;
          if (slot === 1 && count < 3) return;
          var day = new Date(opts.end.getTime() - (count - i) * DAY_MS);
          var tick = h('span', { className: 'tc-x' + (slot === 1 ? ' is-mid' : ''), text: monthDay(day) });
          tick.style.setProperty('left', px(i).toFixed(2) + '%');
          inner.appendChild(tick);
        });
      }

      plot.appendChild(inner);
      chart.appendChild(plot);
      return chart;
    }

    var gradientN = 0;

    /* The chart's accessible name, and the only place its data is spoken: a
       role="img" subtree is presentational. */
    function chartName(opts) {
      /* `back` is how many days earlier than the plotted week the series
         ends, so the dashed week names its own last day and not this week's. */
      var sentence = function (series, who, back) {
        var seen = series.filter(function (v) { return v !== null; });
        if (!seen.length) return who + ': no reading on any of ' + fmt.plural(series.length, 'day') + '.';
        var lo = Math.min.apply(null, seen);
        var high = Math.max.apply(null, seen);
        var lastAt = -1;
        series.forEach(function (v, i) { if (v !== null) lastAt = i; });
        var day = opts.end
          ? ' on ' + monthDay(new Date(opts.end.getTime() - (series.length - lastAt + back) * DAY_MS))
          : '';
        return who + ': ' + fmt.int(seen.length) + ' of ' + fmt.plural(series.length, 'day') +
          ' with a reading, ' + (lo === high ? 'flat at ' + fmt.int(lo) : 'low ' + fmt.int(lo) + ', high ' + fmt.int(high)) +
          ', ending ' + fmt.int(series[lastAt]) + day + '.';
      };
      var name = opts.label + ', ' + sentence(opts.values, 'this week', 0);
      if (opts.ghost) name += ' ' + sentence(opts.ghost, 'the week before, dashed', opts.values.length);
      return name;
    }

    /* ------------------------------------------------------ the moments */

    /* Each moment has one rule and renders only when its own reads prove it.
       None is ever faked, and the strip, label included, is gone when none is
       earned.

         best day    the latest finished UTC day is the strict maximum of
                     every reading the mobile line has, over at least a
                     fortnight with no missing rollup. N is the days covered.
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
      var earned = [bestMobileDay(), moreAiRuns()].filter(Boolean);
      if (!earned.length) return;
      node.appendChild(h('h2', { className: 'sec-label', text: 'This week' }));
      var row = h('div', { className: 'moment-row' });
      earned.forEach(function (m) {
        row.appendChild(h('div', { className: 'moment is-' + m.tone }, [
          h('span', { className: 'moment-ico' }, [icon(m.icon)]),
          h('span', { className: 'moment-value num', text: m.value }),
          h('span', { className: 'moment-words' }, [
            h('span', { className: 'moment-label', text: m.label }),
            h('span', { className: 'moment-sub', text: m.sub })
          ])
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
      node.appendChild(trendChart({
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
