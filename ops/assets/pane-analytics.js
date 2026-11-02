/* Growth: is anyone using Aria, is that growing, do they come back, what is in
   the stores. The page the Growth destination opens on.

   Growth owns the one week. Everything that takes a window, an app or an
   environment is Usage detail (assets/pane-usage.js), one link away in the
   sub-navigation, and the old address with a query on it is sent there.

   Drawn on the v2 design system through assets/shell-pane-v2.js, with the
   chart, the change, the tip and the per-section retry the shell shares with
   Today. The pane holds no session, filter or navigation logic of its own.

   WHAT IT READS, each on its own terms

     GET /api/ops/summary                         the platform's distinct count
     GET /api/ops/usage?range=7d&scope=all&...    the daily lines, the per-app
                                                  rows and the feature counts
     GET /api/ops/usage?range=30d&scope=all&...   the signup weeks and who came
                                                  back to them
     GET /api/ops/releases                        what each store has live

   The two usage reads are separate and each is named where it is drawn,
   because they are different windows: the weekly figures say which seven days
   they are, and the signup weeks say which thirty. Neither is the other's
   answer. A read that is down takes only its own sections off the screen and
   gives them a Try again that re-reads only that read.

   New accounts and paying subscribers are not here. They need
   GET /api/ops/growth, which is not in the backend yet, so this page does not
   call it and holds no place for it.

   The rules, most of them about NOT drawing something:

     1. **Mobile and Coaches Web are never summed.** The headline is the
        platform's own distinct count, so somebody who used both is one person;
        the lines and the rows are one per app.
     2. **A missing day is a gap.** The line breaks and the day is named under
        the chart. A series that is not on the same seven days is not drawn on
        the shared axis.
     3. **A moment is earned or it is not drawn.** "Week high" is printed only
        when every day of the lead line has a reading and one day is strictly
        highest.
     4. **Counts, never shares of people.** A share over a small group moves
        several points on one person, and the reporting floor withholds exactly
        that, so features and the signup weeks show the people themselves.
     5. **A week that has not happened yet is a dash, not a zero.** A signup
        week that has not aged into a return week is shown as not aged.
     6. **How old the answer is travels with it** when it is old: the recount is
        nightly, and a window whose last recount is past STALE_AFTER_HOURS says
        when it last ran. */
(function (global) {
  'use strict';

  var S = global.OpsPaneShell;
  var session = global.OpsSession;
  var h = S.h;
  var icon = S.icon;
  var fmt = S.fmt;
  var maskContactDetails = global.OpsPaneRegistry.maskContactDetails;

  var PANE_ID = 'analytics';

  var ENDPOINT = {
    summary: '/api/ops/summary',
    usage: '/api/ops/usage',
    releases: '/api/ops/releases'
  };

  var WEEK = 7;
  var STALE_AFTER_HOURS = 36;
  var STORE_STALE_AFTER_HOURS = 6;
  var MAX_NAMED_GAPS = 3;

  /* The controls Growth does not have. A link or a bookmark that still carries
     them is for Usage detail, which has them. */
  var MOVED_KEYS = ['scope', 'range', 'env'];

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var UNAVAILABLE_WORDS = {
    not_reporting: 'No reading',
    insufficient: 'Too few to report',
    not_collected: 'Not collected',
    not_reported: 'Not reported'
  };

  /* The store states the Releases page words, as short as they go. Anything
     else is not guessed at. */
  var STORE_STATES = {
    live: { label: 'Live', tone: 'ok' },
    rolling_out: { label: 'Rolling out', tone: 'info' },
    ready_for_release: { label: 'Ready', tone: 'ok' },
    in_review: { label: 'In review', tone: 'info' },
    processing: { label: 'Processing', tone: 'info' },
    rejected: { label: 'Rejected', tone: 'bad' },
    halted: { label: 'Stopped', tone: 'bad' }
  };

  /* ------------------------------------------------------------ readings */

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

  function detailOf(block) {
    var detail = textOf(block && block.availability && block.availability.detail);
    return detail ? maskContactDetails(detail) : null;
  }

  function labelOf(app) {
    return textOf(app && app.label) || textOf(app && app.app) || 'App';
  }

  function metric(app, label) {
    var found = list(app && app.metrics).filter(function (m) { return m && m.label === label; })[0];
    return found ? num(found.value) : null;
  }

  var parseDay = S.dates.parse;
  var monthDay = S.dates.monthDay;

  /* ----------------------------------------------------------------- reads */

  function get(endpoint, query) {
    return session.call(endpoint, { query: query }).then(function (payload) {
      return payload.data;
    });
  }

  var READ = {
    summary: function () {
      return S.read({ paneId: PANE_ID, endpoint: ENDPOINT.summary })
        .then(function (result) { return result.data; });
    },
    week: function () {
      return get(ENDPOINT.usage, { scope: 'all', range: '7d', env: 'production' });
    },
    month: function () {
      return get(ENDPOINT.usage, { scope: 'all', range: '30d', env: 'production' });
    },
    releases: function () { return get(ENDPOINT.releases); }
  };

  var CORE = Object.keys(READ);

  /* ------------------------------------------------------------- the moves */

  /* The query a page of this name used to take, or null when there is none. */
  function movedQuery() {
    var query = new URLSearchParams(global.location.search);
    var carries = MOVED_KEYS.some(function (key) { return query.has(key); });
    return carries ? global.location.search : null;
  }

  /* ----------------------------------------------------------------- pane */

  S.definePane(PANE_ID, function (content) {
    var region = S.region(content);
    var loadToken = 0;
    var wrap = null;
    var hosts = {};

    var moved = movedQuery();
    if (moved !== null) {
      region.loading([{ type: 'block', height: 260 }]);
      global.location.replace(((S.panes.usage || {}).file || 'usage.html') + moved);
      return;
    }

    var kit = S.sections({
      prefix: 'growth',
      reads: READ,
      content: content,
      marker: 'people',
      whole: 'Growth',
      names: {
        people: 'Active people', chart: 'Daily lines', features: 'Feature use',
        back: 'Coming back', releases: 'App releases'
      },
      drawn: function (keys) {
        redraw(keys);
        syncState();
      }
    });
    var results = kit.results;
    var data = kit.data;
    var ask = kit.ask;
    var landOn = kit.landOn;
    var failure = kit.failure;
    var failedLine = kit.failedLine;

    /* --------------------------------------------------------- the load */

    function load() {
      var mine = ++loadToken;
      region.loading([
        { type: 'block', height: 380 },
        { type: 'block', height: 280 }
      ]);
      return ask(CORE).then(function (answers) {
        if (mine !== loadToken) return false;
        answers.forEach(function (a) { results[a.key] = a.one; });
        render();
        return true;
      }).catch(function (err) {
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
      { id: 'people', reads: ['summary'], draw: drawPeople },
      { id: 'chart', reads: ['week'], draw: drawChart },
      { id: 'apps', reads: ['week'], draw: drawApps },
      { id: 'features', reads: ['week'], draw: drawFeatures },
      { id: 'back', reads: ['month'], draw: drawBack },
      { id: 'releases', reads: ['releases'], draw: drawReleases }
    ];

    function host(id, tag, className) {
      var node = h(tag || 'div', { className: 'sec ' + (className || ''), id: 'growth-' + id });
      hosts[id] = node;
      return node;
    }

    function render() {
      hosts = {};
      wrap = h('div', { className: 'stack growth' });

      var hero = S.card('g-hero');
      hero.appendChild(h('div', { className: 'g-hero-grid' }, [
        host('people', 'div', 'g-main'),
        host('chart', 'div', 'g-chart')
      ]));
      hero.appendChild(host('apps', 'div', 'g-apps'));

      wrap.appendChild(hero);
      wrap.appendChild(h('div', { className: 'g-row' }, [
        host('features', 'section', 'card g-card'),
        host('back', 'section', 'card g-card'),
        host('releases', 'section', 'card g-card')
      ]));

      redraw(CORE);

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
      drawHead();
    }

    /* The date, and which seven days the page is about, in the slot the shell
       leaves under the title. */
    function drawHead() {
      var slot = document.getElementById('pageSub');
      if (!slot) return;
      while (slot.firstChild) slot.removeChild(slot.firstChild);
      var summary = data('summary');
      var date = S.dates.headDate(summary && summary.generatedAt);
      var win = (summary && summary.people && summary.people.window) ||
        (data('week') && data('week').window) || {};
      var range = S.dates.dayRange(win.start, win.endExclusive);
      if (date) slot.appendChild(h('span', { className: 'sub-date', text: date }));
      if (range) slot.appendChild(h('span', { className: 'sub-updated', text: range + ' \u00b7 UTC' }));
    }

    /* ------------------------------------------------------- the hero */

    function drawPeople(node) {
      if (results.summary.error) {
        node.appendChild(failure('Active people could not be read', results.summary.error, ['summary'], 'people'));
        return;
      }
      var people = (data('summary') || {}).people;
      var active = num(people && people.platform && people.platform.active);

      node.appendChild(h('div', { className: 'g-head' }, [
        h('h2', { className: 'sec-title', text: 'Active people' }),
        S.tip('growth-people-scope',
          'Only people who turned on usage analytics are counted. Someone who uses both apps counts once.'),
        h('span', { className: 'g-caption', text: 'Opt-in activity' })
      ]));

      if (stateOf(people) !== 'ready' || active === null) {
        node.appendChild(h('p', { className: 'big words', text: wordsFor(people) }));
        var why = detailOf(people);
        if (why) node.appendChild(h('p', { className: 'hp-note', text: why }));
        return;
      }
      node.appendChild(h('p', { className: 'big num', text: fmt.int(active) }));
      node.appendChild(S.delta(active, num(people.platform.previousActive), people.comparison));
    }

    /* The apps that have a seven day line, in the order the answer sends them.
       The first is the lead; the rest share its scale. */
    function trended() {
      var usage = data('week');
      if (!usage || stateOf(usage) !== 'ready') return [];
      return list(usage.apps).filter(function (app) {
        return app && app.trend && Array.isArray(app.trend.values);
      });
    }

    function lastWeek(app) {
      return app.trend.values.map(num).slice(-WEEK);
    }

    /* The days any line has no reading for, named from the days the chart
       itself draws, so the words and the picture cannot disagree. */
    function gapNote(series, end) {
      if (!end) return null;
      var count = series[0].length;
      var gaps = [];
      for (var i = 0; i < count; i++) {
        if (series.some(function (s) { return s[i] === null; })) {
          gaps.push(monthDay(new Date(end.getTime() - (count - i) * S.dates.DAY)));
        }
      }
      if (!gaps.length) return null;
      return gaps.length > MAX_NAMED_GAPS
        ? 'No reading on ' + fmt.plural(gaps.length, 'day')
        : 'No reading ' + gaps.join(', ');
    }

    function staleNote(usage) {
      var computed = usage.window && usage.window.rollupsComputedAt;
      var age = fmt.hoursSince(computed);
      if (age === null || age < STALE_AFTER_HOURS) return null;
      return 'Last counted ' + monthDay(parseDay(computed));
    }

    function drawChart(node) {
      if (results.week.error) {
        node.appendChild(failure('The daily lines could not be read', results.week.error, ['week'], 'chart'));
        return;
      }
      var usage = data('week');
      var apps = trended();
      if (!apps.length) {
        node.appendChild(h('p', { className: 'big words', text: wordsFor(usage) }));
        var why = detailOf(usage);
        if (why) node.appendChild(h('p', { className: 'hp-note', text: why }));
        return;
      }

      var end = parseDay(usage.window && usage.window.endExclusive);
      var lead = apps[0];
      /* A line on other days than the lead's is not on its axis, and the chart
         does not draw it, so the legend does not name it either. */
      var rest = apps.slice(1).filter(function (app) {
        return lastWeek(app).length === lastWeek(lead).length;
      });

      var legend = h('span', { className: 'tc-legend' }, [
        h('span', { className: 'tc-key' }, [
          h('i', { className: 'tc-key-dot', 'aria-hidden': 'true' }),
          h('span', { text: labelOf(lead) + ' daily' })
        ])
      ]);
      rest.forEach(function (app) {
        legend.appendChild(h('span', { className: 'tc-key' }, [
          h('i', { className: 'tc-key-dot is-also', 'aria-hidden': 'true' }),
          h('span', { text: labelOf(app) + ' daily' })
        ]));
      });
      node.appendChild(h('div', { className: 'chart-head' }, [legend]));

      node.appendChild(S.trendChart({
        values: lastWeek(lead),
        also: rest.map(function (app) { return { values: lastWeek(app), label: labelOf(app) }; }),
        area: true, fill: false, axes: true, high: true, end: end,
        label: 'Daily active people', who: labelOf(lead)
      }));

      var notes = [
        gapNote([lastWeek(lead)].concat(rest.map(lastWeek)), end),
        staleNote(usage)
      ].filter(Boolean);
      notes.forEach(function (note) {
        node.appendChild(h('p', { className: 'g-note', text: note }));
      });
    }

    function plain(n, one, many) {
      return n === null ? null : (n === 1 ? '1 ' + one : fmt.int(n) + ' ' + many);
    }

    function appRow(app) {
      var people = plain(metric(app, 'Active people'), 'person', 'people');
      var sessions = plain(metric(app, 'Sessions'), 'session', 'sessions');
      var coverage = num(app.coverageBasisPoints);
      return h('div', { className: 'g-app' }, [
        h('span', { className: 'g-tile', 'aria-hidden': 'true', text: labelOf(app).charAt(0).toUpperCase() }),
        h('span', { className: 'g-app-name', text: labelOf(app) }),
        h('span', { className: 'g-figs' }, [
          h('span', { className: 'g-fig num', text: people || 'People not reported' }),
          h('span', { className: 'g-fig num', text: sessions || 'Sessions not reported' }),
          h('span', { className: 'g-fig num', text: coverage === null
            ? 'Coverage not reported' : Math.round(coverage / 100) + '% coverage' })
        ])
      ]);
    }

    function drawApps(node) {
      var usage = data('week');
      if (!usage || stateOf(usage) !== 'ready') return;
      list(usage.apps).filter(Boolean).forEach(function (app) {
        node.appendChild(appRow(app));
      });
      /* An app that reported nothing in the window is named, never drawn as a
         row of zeroes. */
      list(usage.notReporting).filter(Boolean).forEach(function (app) {
        node.appendChild(h('div', { className: 'g-app is-quiet' }, [
          h('span', { className: 'g-tile', 'aria-hidden': 'true', text: labelOf(app).charAt(0).toUpperCase() }),
          h('span', { className: 'g-app-name', text: labelOf(app) }),
          h('span', { className: 'g-figs' }, [h('span', { className: 'g-fig', text: 'No reading' })])
        ]));
      });
    }

    /* ------------------------------------------------------ feature use */

    function title(text) {
      return h('h2', { className: 'sec-title g-title', text: text });
    }

    function drawFeatures(node) {
      node.appendChild(title('Feature use'));
      if (results.week.error) {
        node.appendChild(failedLine('Feature use could not be read', results.week.error, ['week'], 'features'));
        return;
      }
      var usage = data('week');
      var rows = stateOf(usage) === 'ready'
        ? list(usage.features && usage.features.rows).filter(function (r) { return r && textOf(r.label); })
        : [];
      if (!rows.length) {
        node.appendChild(h('p', { className: 'g-empty', text: stateOf(usage) === 'ready' ? 'No feature use reported' : wordsFor(usage) }));
        return;
      }

      /* One group per app, in the order the answer first names them: each
         count is of that app's own people. */
      var groups = [];
      rows.forEach(function (row) {
        var name = textOf(row.app) || 'App';
        var group = groups.filter(function (g) { return g.name === name; })[0];
        if (!group) {
          group = { name: name, rows: [] };
          groups.push(group);
        }
        group.rows.push(row);
      });
      groups.forEach(function (group) {
        var items = h('ul');
        group.rows.forEach(function (row) {
          var users = num(row.users);
          items.appendChild(h('li', { className: 'g-item' }, [
            h('span', { className: 'g-item-name', text: textOf(row.label) }),
            h('span', { className: 'g-item-value num', text: users === null ? fmt.none : fmt.int(users) })
          ]));
        });
        node.appendChild(h('div', { className: 'g-group' }, [
          h('h3', { className: 'g-sub', text: group.name + ' \u00b7 people' }),
          items
        ]));
      });
    }

    /* ------------------------------------------------------- coming back */

    /* The route labels a week "5 Oct"; the page reads dates "Oct 5". */
    function weekLabel(label) {
      var parts = /^(\d{1,2}) ([A-Z][a-z]{2})$/.exec(String(label));
      return parts && MONTHS.indexOf(parts[2]) !== -1 ? parts[2] + ' ' + parts[1] : String(label);
    }

    function offsetLabel(offset) {
      var week = /^W(\d+)$/i.exec(String(offset));
      return week ? 'Week ' + week[1] : String(offset);
    }

    function cohortTable(cohort) {
      var offsets = list(cohort.offsets);
      var head = h('tr', {}, [
        h('th', { scope: 'col', text: 'Cohort' }),
        h('th', { scope: 'col', className: 'r', text: 'Joined' })
      ]);
      offsets.forEach(function (offset) {
        head.appendChild(h('th', { scope: 'col', className: 'r', text: offsetLabel(offset) }));
      });
      var body = h('tbody');
      var unaged = false;
      list(cohort.rows).filter(Boolean).forEach(function (row) {
        var size = num(row.size);
        var tr = h('tr', {}, [
          h('th', { scope: 'row', text: weekLabel(row.label) }),
          h('td', { className: 'r num', text: size === null ? fmt.none : fmt.int(size) })
        ]);
        offsets.forEach(function (_, i) {
          var cell = list(row.cells)[i];
          var returned = num(cell && cell.returned);
          if (cell && cell.state === 'not_aged') unaged = true;
          if (returned === null) {
            tr.appendChild(h('td', { className: 'r g-dash' }, [
              h('span', { 'aria-hidden': 'true', text: '\u2014' }),
              h('span', { className: 'sr', text: cell && cell.state === 'not_aged' ? 'Not aged yet' : 'Not reported' })
            ]));
            return;
          }
          tr.appendChild(h('td', { className: 'r num', text: fmt.int(returned) }));
        });
        body.appendChild(tr);
      });
      return { table: h('table', { className: 'g-table' }, [h('thead', {}, [head]), body]), unaged: unaged };
    }

    function drawBack(node) {
      node.appendChild(title('Coming back'));
      if (results.month.error) {
        node.appendChild(failedLine('Signup weeks could not be read', results.month.error, ['month'], 'back'));
        return;
      }
      var usage = data('month');
      var cohorts = stateOf(usage) === 'ready'
        ? list(usage.cohorts).filter(function (c) { return c && list(c.rows).length > 0; })
        : [];
      if (!cohorts.length) {
        node.appendChild(h('p', { className: 'g-empty', text: stateOf(usage) === 'ready' ? 'No full signup weeks yet' : wordsFor(usage) }));
        return;
      }
      var span = S.dates.dayRange(usage.window && usage.window.start, usage.window && usage.window.endExclusive);
      var anyUnaged = false;
      cohorts.forEach(function (cohort, i) {
        var built = cohortTable(cohort);
        anyUnaged = anyUnaged || built.unaged;
        var note = textOf(cohort.note);
        var sub = h('h3', { className: 'g-sub' }, [
          h('span', { text: labelOf(cohort) + (span ? ' \u00b7 ' + span : '') })
        ]);
        if (note) sub.appendChild(S.tip('growth-back-note-' + i, maskContactDetails(note)));
        node.appendChild(h('div', { className: 'g-group' }, [sub, built.table]));
      });
      node.appendChild(h('p', { className: 'g-foot', text: 'People' + (anyUnaged ? ' \u00b7 \u2014 not yet aged' : '') }));
    }

    /* --------------------------------------------------------- releases */

    function productionOf(platform) {
      return list(platform && platform.tracks).filter(function (t) { return t && t.track === 'production'; })[0] || null;
    }

    function releasedLine(rows) {
      var days = [];
      rows.forEach(function (row) {
        var at = parseDay(row.track && row.track.releasedAt);
        if (at) days.push({ label: row.label, day: monthDay(at) });
      });
      if (!days.length) return null;
      var same = days.every(function (d) { return d.day === days[0].day; });
      return same
        ? 'Released ' + days[0].day
        : days.map(function (d) { return d.label + ' ' + d.day; }).join(' \u00b7 ');
    }

    function drawReleases(node) {
      node.appendChild(title('App releases'));
      if (results.releases.error) {
        node.appendChild(failedLine('Releases could not be read', results.releases.error, ['releases'], 'releases'));
        return;
      }
      var rows = list((data('releases') || {}).platforms).filter(Boolean).map(function (platform) {
        return { label: labelOf(platform), track: productionOf(platform) };
      });
      if (!rows.length) {
        node.appendChild(h('p', { className: 'g-empty', text: 'No releases reported' }));
        return;
      }

      var stale = false;
      var list_ = h('div', { className: 'g-rels' });
      rows.forEach(function (row) {
        var track = row.track;
        var known = track && STORE_STATES[track.state];
        var state = !track ? { label: 'No production build', tone: '' } : (known || { label: 'Not reported', tone: '' });
        var age = track ? fmt.hoursSince(track.fetchedAt) : null;
        if (age !== null && age >= STORE_STALE_AFTER_HOURS) stale = true;
        list_.appendChild(h('div', { className: 'g-rel' }, [
          h('span', { className: 'g-rel-name', text: row.label }),
          h('span', { className: 'g-rel-ver num', text: (track && textOf(track.versionName)) || fmt.none }),
          h('span', { className: 'g-rel-state' }, [
            h('i', { className: 'g-dot' + (state.tone ? ' is-' + state.tone : ''), 'aria-hidden': 'true' }),
            h('span', { text: state.label })
          ])
        ]));
      });
      node.appendChild(list_);

      var foot = h('div', { className: 'g-rel-foot' });
      var words = [releasedLine(rows)];
      if (stale) words.push('Stores last checked over ' + fmt.hours(STORE_STALE_AFTER_HOURS) + ' ago');
      foot.appendChild(h('span', { className: 'g-released', text: words.filter(Boolean).join(' \u00b7 ') }));
      foot.appendChild(h('a', { className: 'g-link', href: S.paneHref('releases') || 'releases.html' }, [
        h('span', { text: 'View tracks' }), icon('arrow')
      ]));
      node.appendChild(foot);
    }

    load();
  });
})(window);
