/* Wearable sync: is wearable data arriving, and which provider is failing?

   One read, GET /api/ops/wearable-sync?days=30, which Stadiora/Aria#12694
   serves from the wearable sync-run ledger and the daily freshness snapshots.
   The route sends counts only: no user id and no connection id leaves it, so
   nothing on this pane names a person. A run key is a server uuid or the
   phone's own X-Sync-Run-Id, which lets an engineer find a trace without the
   pane naming whose it was. error_summary is written by the sync code, never a
   provider body; it is masked anyway, because the shape of today's payload is
   not a promise about tomorrow's.

   The route states what it is looking at in `feedState`, and every one of its
   five answers draws differently here:

     live                   the ledger, per provider and per app
     degraded               the same, with the figures that over-count while
                            the ledger is behind hidden and saying so
     empty_no_runs          no runs with connections active: a stalled
                            pipeline, drawn as a problem
     empty_no_connections   no runs and nobody connected: zero is true, drawn
                            as a quiet fact
     unavailable            HTTP 503, drawn as the shell's failure card, so a
                            failed read cannot pass for a quiet day

   The App and Window controls are the pane's own, not the registry's. The
   registry's App control is Mobile / Coaches Web, which a sync run does not
   carry; a run carries the app that sent it (`appVariant`), or none when the
   server started it. Both controls act on the answer already read: the route
   sends both windows and every app in one response. Neither reaches the
   freshness chart, which is kept per provider only. */

(function (global) {
  'use strict';

  var S = global.OpsPaneShell;
  var h = S.h;
  var icon = S.icon;
  var fmt = S.fmt;
  var maskContactDetails = global.OpsPaneRegistry.maskContactDetails;

  var ENDPOINT = '/api/ops/wearable-sync';
  var DAYS = 30;
  var ALL_PROVIDERS = '_all';

  var PROVIDER_LABEL = {
    apple_health: 'Apple Health',
    health_connect: 'Health Connect',
    garmin: 'Garmin',
    polar: 'Polar',
    strava: 'Strava'
  };

  var APPS = [
    { v: 'all', l: 'All apps' },
    { v: 'aria', l: 'Run with Aria' },
    { v: 'fitmg', l: 'FitMG' },
    { v: 'aria-xii', l: 'Aria XII' }
  ];

  var WINDOWS = [
    { v: '24h', l: '24 h', key: 'last24h', words: 'Last 24 hours' },
    { v: '7d', l: '7 d', key: 'last7d', words: 'Last 7 days' }
  ];

  /* A provider's failed share past which it is named in the hero, and the
     partial share past which it is flagged. Failed includes stale: a run that
     never closed wrote nothing, which is the same outcome. */
  var FAILED_WARN = 0.01;
  var FAILED_BAD = 0.05;
  var PARTIAL_WARN = 0.10;

  var TONE = {
    ok: { pill: 'up', glyph: 'check', st: 'st-ok' },
    warn: { pill: 'warn', glyph: 'warn', st: 'st-warn' },
    bad: { pill: 'down', glyph: 'x', st: 'st-bad' },
    quiet: { pill: '', glyph: 'info', st: 'st-acc' }
  };

  function providerLabel(id) {
    return Object.prototype.hasOwnProperty.call(PROVIDER_LABEL, id) ? PROVIDER_LABEL[id] : String(id);
  }

  function appLabel(v) {
    if (v === null || v === undefined) return 'n/a (server run)';
    for (var i = 0; i < APPS.length; i++) if (APPS[i].v === v) return APPS[i].l;
    return String(v);
  }

  function list(value) { return Array.isArray(value) ? value : []; }
  function num(value) { return fmt.isNum(value) ? value : 0; }

  function share(part, whole) {
    if (!fmt.isNum(part) || !fmt.isNum(whole) || whole <= 0) return null;
    return part / whole;
  }

  function pct(ratio) {
    if (ratio === null) return fmt.none;
    var p = ratio * 100;
    return (p > 0 && p < 0.1 ? '<0.1' : p.toFixed(1)) + '%';
  }

  /* A lag an operator reads at a glance: "4h 20m", "35m", "2d 3h". */
  function lag(seconds) {
    if (!fmt.isNum(seconds) || seconds < 0) return fmt.none;
    var m = Math.round(seconds / 60);
    if (m < 60) return m + 'm';
    var hrs = Math.floor(m / 60);
    if (hrs < 48) return hrs + 'h ' + (m % 60 < 10 ? '0' : '') + (m % 60) + 'm';
    return Math.floor(hrs / 24) + 'd ' + (hrs % 24) + 'h';
  }

  function failedOf(group) {
    var by = (group && group.byStatus) || {};
    return num(by.failed) + num(by.stale);
  }

  /* "7c1e2f90…51a4": enough to match against a log line by eye. The whole key
     is in the cell's accessible text, so a screen reader and a copy both get
     all of it. */
  function shortKey(key) {
    var text = String(key || '');
    return text.length > 14 ? text.slice(0, 8) + '\u2026' + text.slice(-4) : text;
  }

  /* "22 Sep 2026" from a snapshot's "2026-09-22". */
  function utcDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return String(date);
    return fmt.utcDay(date + 'T00:00:00.000Z');
  }

  /* ------------------------------------------------------ the arithmetic */

  function emptyTotals() {
    return {
      runs: 0, rateLimited: 0, reported: 0, written: 0, unchanged: 0, skipped: 0,
      byStatus: { in_progress: 0, success: 0, partial: 0, failed: 0, skipped: 0, stale: 0 }
    };
  }

  function addInto(target, group) {
    target.runs += num(group.runs);
    target.rateLimited += num(group.rateLimited);
    target.reported += num(group.reported);
    target.written += num(group.written);
    target.unchanged += num(group.unchanged);
    target.skipped += num(group.skipped);
    var by = group.byStatus || {};
    Object.keys(target.byStatus).forEach(function (status) {
      target.byStatus[status] += num(by[status]);
    });
  }

  /* Picking one app keeps that app's rows and drops the server's, which
     belong to no app. Guessing an owner for a Polar poll would count it
     against an app that never sent it. */
  function appKeeps(app, group) {
    return app === 'all' || group.appVariant === app;
  }

  function view(data, picked) {
    var windowSpec = WINDOWS.filter(function (w) { return w.v === picked.window; })[0] || WINDOWS[0];
    var runs = (data.runs && data.runs[windowSpec.key]) || {};
    var groups = list(runs.groups);
    var kept = groups.filter(function (g) { return appKeeps(picked.app, g); });
    var hiddenServer = groups.filter(function (g) {
      return picked.app !== 'all' && (g.appVariant === null || g.appVariant === undefined);
    });

    var totals = emptyTotals();
    kept.forEach(function (g) { addInto(totals, g); });

    var connections = {};
    list(data.connections && data.connections.byProvider).forEach(function (row) {
      connections[row.provider] = row;
    });

    var providerIds = list(data.providers).slice();
    groups.forEach(function (g) {
      if (providerIds.indexOf(g.provider) === -1) providerIds.push(g.provider);
    });

    var providers = providerIds.map(function (id) {
      var own = kept.filter(function (g) { return g.provider === id; });
      var sum = emptyTotals();
      own.forEach(function (g) { addInto(sum, g); });
      var allOwn = groups.filter(function (g) { return g.provider === id; });
      return {
        id: id,
        groups: own,
        totals: sum,
        connection: connections[id] || null,
        serverOnly: allOwn.length > 0 && allOwn.every(function (g) {
          return g.appVariant === null || g.appVariant === undefined;
        })
      };
    });
    providers.forEach(function (p) { p.status = providerStatus(p, picked.app); });

    return {
      windowSpec: windowSpec,
      totals: totals,
      providers: providers,
      hiddenServerRuns: hiddenServer.reduce(function (n, g) { return n + num(g.runs); }, 0)
    };
  }

  function providerStatus(p, app) {
    var t = p.totals;
    var active = p.connection ? num(p.connection.activeConnections) : 0;
    if (t.runs === 0) {
      if (app !== 'all' && p.serverOnly) return { tone: 'quiet', word: 'Server runs, no app' };
      if (app !== 'all') return { tone: 'quiet', word: 'No runs from ' + appLabel(app) };
      if (active > 0) return { tone: 'bad', word: 'No runs' };
      return { tone: 'quiet', word: 'No connections' };
    }
    var failedShare = share(failedOf(t), t.runs);
    if (t.rateLimited > 0 && failedShare >= FAILED_WARN) return { tone: 'bad', word: 'Rate-limited' };
    if (failedShare >= FAILED_BAD) return { tone: 'bad', word: 'Failing ' + pct(failedShare) };
    if (failedShare >= FAILED_WARN) return { tone: 'warn', word: 'Failures ' + pct(failedShare) };
    var partialShare = share(t.byStatus.partial, t.runs);
    if (partialShare >= PARTIAL_WARN) return { tone: 'warn', word: 'Partial ' + pct(partialShare) };
    return { tone: 'ok', word: 'Healthy' };
  }

  /* --------------------------------------------------------------- pieces */

  function pill(tone, words) {
    var spec = TONE[tone] || TONE.quiet;
    return h('span', { className: 'pill' + (spec.pill ? ' ' + spec.pill : '') }, [
      icon(spec.glyph), h('span', { text: words })
    ]);
  }

  function tile(label, value, small, meta) {
    var box = S.card('kpi');
    var body = h('div', { className: 'card-body' });
    body.appendChild(h('div', { className: 'kpi-label', text: label }));
    var val = h('div', { className: 'kpi-val', text: value });
    if (small) val.appendChild(h('small', { text: ' ' + small }));
    body.appendChild(val);
    if (meta) body.appendChild(h('div', { className: 'kpi-meta' }, [h('span', { text: meta })]));
    box.appendChild(body);
    return box;
  }

  /* A table too wide for a phone scrolls inside its own box rather than
     pushing the page sideways. The box is named and focusable, because a
     scroll region a keyboard cannot reach fails WCAG 2.1.1. */
  function scroller(label, table) {
    return h('div', { className: 'u-scroll', tabindex: '0', role: 'region', 'aria-label': label }, [table]);
  }

  function th(text, right) {
    return h('th', { scope: 'col', className: right ? 'r' : '', text: text });
  }

  function td(text, right, className) {
    return h('td', { className: (right ? 'r num' : '') + (className ? ' ' + className : ''), text: text });
  }

  /* ------------------------------------------------------------- the pane */

  S.definePane('wearables', function (content) {
    var region = S.region(content);
    var picked = { app: 'all', window: '24h' };
    var loadToken = 0;
    var data = null;

    function segment(label, options, key) {
      var seg = h('div', { className: 'seg', role: 'group', 'aria-label': label });
      var nodes = [];
      options.forEach(function (option) {
        var button = h('button', { type: 'button', text: option.l });
        nodes.push({ node: button, value: option.v });
        button.addEventListener('click', function () {
          if (picked[key] === option.v) return;
          picked[key] = option.v;
          mark();
          if (data) draw(data);
        });
        seg.appendChild(button);
      });
      function mark() {
        nodes.forEach(function (option) {
          var on = option.value === picked[key];
          option.node.className = on ? 'on' : '';
          option.node.setAttribute('aria-pressed', String(on));
        });
      }
      mark();
      return seg;
    }

    S.paneFilters([
      h('span', { className: 'filter-label', text: 'App' }),
      segment('App', APPS, 'app'),
      h('span', { className: 'filter-label', text: 'Window' }),
      segment('Window', WINDOWS, 'window')
    ]);

    function load() {
      var token = ++loadToken;
      region.loading([
        { type: 'block', height: 86 },
        { type: 'tiles', count: 4 },
        { type: 'rows', count: 8 }
      ]);
      S.read({ paneId: 'wearables', endpoint: ENDPOINT, query: { days: String(DAYS) } }).then(function (result) {
        if (token !== loadToken) return;
        data = result.data || {};
        draw(data);
      }, function (err) {
        if (token !== loadToken) return;
        data = null;
        region.failed(err, load);
      });
    }

    function draw(body) {
      var state = body.feedState;
      if (state === 'empty_no_connections' || state === 'empty_no_runs') {
        region.empty(emptyState(body));
        return;
      }
      if (state !== 'live' && state !== 'degraded') {
        region.failed({ code: 'ops_bad_response' }, load);
        return;
      }
      var v = view(body, picked);
      var degraded = state === 'degraded';
      var page = h('div', { className: 'stack' });
      page.appendChild(hero(body, v, degraded));
      page.appendChild(tiles(body, v, degraded));
      page.appendChild(ledgerBand(v));
      page.appendChild(freshnessBand(body));
      var lower = h('div', { className: 'grid g2' });
      lower.appendChild(skipBand(body));
      lower.appendChild(causesBand(body));
      page.appendChild(lower);
      page.appendChild(failedBand(body));
      if (degraded) region.degraded(page);
      else region.show(page);
    }

    /* ---------------------------------------------------------- the states */

    function emptyState(body) {
      var box = S.card();
      var active = num(body.connections && body.connections.active);
      if (body.feedState === 'empty_no_connections') {
        box.appendChild(S.stateBlock('empty', 'No wearable connections yet', [
          'No athlete has connected a device or health app, so no runs are expected.'
        ]));
        return box;
      }
      box.className = 'card accent acc-bad';
      box.appendChild(S.stateBlock('warn',
        'No sync runs in 24 hours, with ' + fmt.plural(active, 'active connection'), [
          body.newestRunAt
            ? 'Last run recorded ' + fmt.utcStamp(body.newestRunAt) + '.'
            : 'The ledger has no run on record.'
        ]));
      return box;
    }

    function hero(body, v, degraded) {
      var named = v.providers.filter(function (p) { return p.status.tone === 'bad'; });
      var flagged = v.providers.filter(function (p) { return p.status.tone === 'warn'; });
      var tone = named.length ? 'bad' : flagged.length ? 'warn' : 'ok';
      var title;
      var sub;
      if (degraded) {
        tone = 'warn';
        title = 'The ledger is ' + fmt.since(body.newestRunAt) + ' behind.';
        sub = 'Last row ' + fmt.stamp(body.newestRunAt) + '. Counts after that will climb.';
      } else if (named.length) {
        title = names(named) + (named.length === 1 ? ' is ' : ' are ') +
          (named.every(function (p) { return p.status.word === 'Rate-limited'; }) ? 'rate-limited.' : 'failing.');
        sub = 'Every other provider with runs is syncing.';
      } else if (flagged.length) {
        title = names(flagged) + (flagged.length === 1 ? ' needs' : ' need') + ' a look.';
        sub = 'No provider is failing outright.';
      } else {
        title = 'Every provider with runs is syncing.';
        sub = 'No provider above ' + pct(FAILED_WARN) + ' failed.';
      }
      sub += ' ' + v.windowSpec.words + ' \u00b7 ' + appLabel(picked.app === 'all' ? 'all' : picked.app) +
        (picked.app === 'all' ? '' : ' only') + '.';

      var box = h('section', { className: 'hero ' + TONE[tone].st });
      box.appendChild(h('div', { className: 'hero-orb', 'aria-hidden': 'true' }, [h('i'), h('i'), h('b')]));
      box.appendChild(h('div', {}, [
        h('h2', { className: 'hero-title', text: title }),
        h('p', { className: 'hero-sub', text: sub })
      ]));
      var chips = h('div', { className: 'hero-chips' });
      v.providers.forEach(function (p) {
        chips.appendChild(pill(p.status.tone, providerLabel(p.id) + ': ' + p.status.word.toLowerCase()));
      });
      box.appendChild(chips);
      return box;
    }

    function names(providers) {
      var labels = providers.map(function (p) { return providerLabel(p.id); });
      if (labels.length === 1) return labels[0];
      return labels.slice(0, -1).join(', ') + ' and ' + labels[labels.length - 1];
    }

    function tiles(body, v, degraded) {
      var t = v.totals;
      var failed = failedOf(t);
      var connections = body.connections || {};
      var grid = h('div', { className: 'grid g4' });
      var soFar = degraded ? 'So far, still climbing' : null;
      grid.appendChild(tile('Sync runs', fmt.int(t.runs), null, soFar ||
        (fmt.int(t.byStatus.success) + ' success \u00b7 ' +
          fmt.int(t.byStatus.partial + t.byStatus.skipped) + ' partial or skipped')));
      grid.appendChild(tile('Failed', fmt.int(failed), pct(share(failed, t.runs)),
        degraded
          ? 'Up to ' + fmt.stamp(body.newestRunAt)
          : fmt.int(t.rateLimited) + ' rate-limited'));

      /* Connections are counted per provider, not per app, and a connection
         looks silent while the ledger is behind whether it is or not. */
      if (degraded) {
        grid.appendChild(tile('Silent 2 days or more', 'Hidden', null, 'Would over-count while behind'));
        grid.appendChild(tile('Lag p95', 'Hidden', null, 'Would over-count while behind'));
        return grid;
      }
      var perProvider = picked.app === 'all' ? null : 'All apps: kept per provider';
      grid.appendChild(tile('Silent 2 days or more', fmt.int(num(connections.silent)),
        'of ' + fmt.int(num(connections.active)),
        perProvider || 'Active connections with no success'));
      var worst = null;
      list(connections.byProvider).forEach(function (row) {
        if (fmt.isNum(row.lagP95Seconds) && (!worst || row.lagP95Seconds > worst.lagP95Seconds)) worst = row;
      });
      grid.appendChild(tile('Lag p95', worst ? lag(worst.lagP95Seconds) : 'Not measured', null,
        worst ? 'Slowest: ' + providerLabel(worst.provider) : 'No connection has a success yet'));
      return grid;
    }

    /* ---------------------------------------------------------- the ledger */

    function ledgerBand(v) {
      var section = S.band('Sync-run ledger',
        v.windowSpec.words + '. Failed includes rate-limited and stale runs.');
      var card = S.card();
      var table = h('table', { className: 'tbl ws-ledger' });
      table.appendChild(h('caption', { className: 'sr', text: 'Sync runs per provider and app, ' + v.windowSpec.words }));
      var head = h('tr');
      ['App', 'Runs', 'Success', 'Partial', 'Skipped', 'Failed', 'Rate-limited', 'Status'].forEach(function (label, i) {
        head.appendChild(th(label, i > 0 && i < 7));
      });
      table.appendChild(h('thead', {}, [head]));

      v.providers.forEach(function (p) {
        var tbody = h('tbody', { 'data-provider': p.id });
        var conn = p.connection;
        var facts = conn
          ? fmt.plural(num(conn.activeConnections), 'active connection') +
            ' \u00b7 silent 2d+ ' + fmt.int(num(conn.silent)) +
            ' \u00b7 lag p95 ' + lag(conn.lagP95Seconds)
          : 'No active connections';
        tbody.appendChild(h('tr', { className: 'ws-provider' }, [
          h('th', { scope: 'colgroup', colspan: '8' }, [
            h('span', { className: 't-main', text: providerLabel(p.id) }),
            h('span', { className: 't-sub ws-facts', text: facts })
          ])
        ]));
        if (!p.groups.length) {
          tbody.appendChild(h('tr', {}, [
            h('td', { colspan: '7', className: 'muted', text: noRunsWords(p) }),
            h('td', {}, [pill(p.status.tone, p.status.word)])
          ]));
        }
        p.groups.forEach(function (g) {
          var failed = failedOf(g);
          var groupStatus = providerStatus({ totals: groupTotals(g), connection: conn, serverOnly: false }, 'all');
          tbody.appendChild(h('tr', {}, [
            h('td', { text: appLabel(g.appVariant) }),
            td(fmt.int(g.runs), true),
            td(fmt.int(num(g.byStatus && g.byStatus.success)), true),
            td(fmt.int(num(g.byStatus && g.byStatus.partial)), true),
            td(fmt.int(num(g.byStatus && g.byStatus.skipped)), true),
            td(fmt.int(failed), true),
            td(fmt.int(num(g.rateLimited)), true),
            h('td', {}, [pill(groupStatus.tone, groupStatus.word)])
          ]));
        });
        table.appendChild(tbody);
      });

      var t = v.totals;
      table.appendChild(h('tfoot', {}, [h('tr', { className: 'ws-total' }, [
        h('th', { scope: 'row', text: picked.app === 'all' ? 'All providers' : 'All providers, ' + appLabel(picked.app) }),
        td(fmt.int(t.runs), true),
        td(fmt.int(t.byStatus.success), true),
        td(fmt.int(t.byStatus.partial), true),
        td(fmt.int(t.byStatus.skipped), true),
        td(fmt.int(failedOf(t)), true),
        td(fmt.int(t.rateLimited), true),
        h('td')
      ])]));

      card.appendChild(scroller('Sync-run ledger', table));
      if (v.hiddenServerRuns > 0) {
        card.appendChild(h('div', { className: 'card-foot' }, [h('span', {
          text: fmt.plural(v.hiddenServerRuns, 'server run') + ' hidden: server runs belong to no app.'
        })]));
      }
      section.appendChild(card);
      return section;
    }

    function groupTotals(g) {
      var t = emptyTotals();
      addInto(t, g);
      return t;
    }

    function noRunsWords(p) {
      if (picked.app !== 'all' && p.serverOnly) return 'Server runs only; shown under All apps';
      if (picked.app !== 'all') return 'No runs from ' + appLabel(picked.app);
      return 'No runs in this window';
    }

    /* ------------------------------------------------------- the freshness */

    /* One column per UTC day. A day the 04:40 UTC job left no row is a
       labelled gap, never a zero bar: a missing snapshot says nothing about
       how many connections synced. */
    function freshnessBand(body) {
      var fresh = body.freshness || {};
      var section = S.band('Daily freshness',
        'Active connections synced within 2 days, all providers, from the 04:40 UTC snapshot');
      var card = S.card();
      var cardBody = h('div', { className: 'card-body' });
      cardBody.appendChild(h('p', { className: 'note ws-scope' }, [
        icon('info'),
        h('span', { text: fresh.scopeNote || 'Snapshots are per provider; the app filter does not apply.' })
      ]));

      var byDate = {};
      list(fresh.snapshots).forEach(function (row) {
        if (row.provider === ALL_PROVIDERS) byDate[row.snapshotDate] = row;
      });
      var missing = list(fresh.missingDates);
      var pending = list(fresh.pendingDates);
      var dates = windowDates(body.generatedAt, num(body.days) || DAYS);

      var points = [];
      var chart = h('div', { className: 'ws-days' });
      dates.forEach(function (date) {
        var row = byDate[date];
        var col = h('div', { className: 'ws-day' });
        if (row && num(row.activeDevices) > 0) {
          var ratio = num(row.syncedWithin2d) / row.activeDevices;
          points.push({ date: date, ratio: ratio });
          var bar = h('i', { className: 'ws-bar' });
          bar.style.setProperty('--ws-h', Math.max(2, Math.round(ratio * 100)) + '%');
          col.appendChild(bar);
        } else {
          var kind = pending.indexOf(date) !== -1 ? 'pending' : 'missing';
          col.className = 'ws-day ws-gap' + (kind === 'pending' ? ' ws-pending' : '');
          col.appendChild(h('span', { className: 'ws-gap-mark', text: kind === 'pending' ? '\u2026' : '\u00d7' }));
        }
        chart.appendChild(col);
      });

      var label = freshnessSummary(points, missing, pending);
      var figure = h('div', { className: 'ws-chart', role: 'img', 'aria-label': label }, [chart]);
      var axis = h('div', { className: 'ws-axis', 'aria-hidden': 'true' }, [
        h('span', { text: dates.length ? utcDate(dates[0]) : '' }),
        h('span', { text: dates.length ? utcDate(dates[dates.length - 1]) : '' })
      ]);
      cardBody.appendChild(figure);
      cardBody.appendChild(axis);

      var legend = h('div', { className: 'ws-legend' });
      if (missing.length) {
        legend.appendChild(h('span', { className: 'ws-legend-item' }, [
          h('span', { className: 'ws-key', 'aria-hidden': 'true', text: '\u00d7' }),
          h('span', { text: 'No snapshot: ' + missing.map(utcDate).join(', ') })
        ]));
      }
      if (pending.length) {
        legend.appendChild(h('span', { className: 'ws-legend-item' }, [
          h('span', { className: 'ws-key ws-pending', 'aria-hidden': 'true', text: '\u2026' }),
          h('span', { text: 'Pending until 04:40 UTC: ' + pending.map(utcDate).join(', ') })
        ]));
      }
      if (legend.childNodes.length) cardBody.appendChild(legend);

      card.appendChild(cardBody);
      card.appendChild(latestSnapshot(fresh));
      section.appendChild(card);
      return section;
    }

    function windowDates(generatedAt, days) {
      var end = fmt.isNum(Date.parse(generatedAt)) ? Date.parse(generatedAt) : Date.now();
      var out = [];
      for (var offset = days - 1; offset >= 0; offset--) {
        out.push(new Date(end - offset * 86400000).toISOString().slice(0, 10));
      }
      return out;
    }

    function freshnessSummary(points, missing, pending) {
      if (!points.length) return 'No freshness snapshot in this window.';
      var ratios = points.map(function (p) { return p.ratio; });
      var last = points[points.length - 1];
      var words = 'Share of active connections synced within 2 days: low ' +
        pct(Math.min.apply(null, ratios)) + ', high ' + pct(Math.max.apply(null, ratios)) +
        ', latest ' + pct(last.ratio) + ' on ' + utcDate(last.date) + '.';
      if (missing.length) words += ' ' + fmt.plural(missing.length, 'day') + ' with no snapshot.';
      if (pending.length) words += ' Today is pending until 04:40 UTC.';
      return words;
    }

    function latestSnapshot(fresh) {
      var latest = null;
      list(fresh.snapshots).forEach(function (row) {
        if (!latest || row.snapshotDate > latest) latest = row.snapshotDate;
      });
      var wrap = h('div', { className: 'ws-latest' });
      if (!latest) {
        wrap.appendChild(h('p', { className: 'muted tiny', text: 'No snapshot has been written yet.' }));
        return wrap;
      }
      var table = h('table', { className: 'tbl' });
      table.appendChild(h('caption', { className: 'sr', text: 'Latest freshness snapshot per provider' }));
      table.appendChild(h('thead', {}, [h('tr', {}, [
        th('Provider'), th('Active', true), th('Synced in 2 d', true), th('Synced in 7 d', true)
      ])]));
      var tbody = h('tbody');
      list(fresh.snapshots).filter(function (row) { return row.snapshotDate === latest; })
        .sort(function (a, b) {
          if (a.provider === ALL_PROVIDERS) return 1;
          if (b.provider === ALL_PROVIDERS) return -1;
          return String(a.provider).localeCompare(String(b.provider));
        })
        .forEach(function (row) {
          tbody.appendChild(h('tr', { className: row.provider === ALL_PROVIDERS ? 'ws-total' : '' }, [
            h('td', { text: row.provider === ALL_PROVIDERS ? 'All providers' : providerLabel(row.provider) }),
            td(fmt.int(row.activeDevices), true),
            td(fmt.int(row.syncedWithin2d), true),
            td(fmt.int(row.syncedWithin7d), true)
          ]));
        });
      table.appendChild(tbody);
      wrap.appendChild(h('p', { className: 'tiny muted ws-latest-note', text: 'Latest snapshot, ' + utcDate(latest) }));
      wrap.appendChild(scroller('Latest freshness snapshot', table));
      return wrap;
    }

    /* -------------------------------------------------------- skip reasons */

    function skipBand(body) {
      var section = S.band('Top skip reasons', 'Records dropped inside runs, 24 h, all apps');
      var card = S.card();
      var rows = list(body.skipReasons24h);
      if (!rows.length) {
        card.appendChild(S.stateBlock('check', 'No record was skipped in 24 hours', []));
        section.appendChild(card);
        return section;
      }
      var table = h('table', { className: 'tbl' });
      table.appendChild(h('thead', {}, [h('tr', {}, [th('Reason'), th('Provider'), th('Records', true)])]));
      var tbody = h('tbody');
      rows.forEach(function (row) {
        tbody.appendChild(h('tr', {}, [
          h('td', {}, [h('span', { className: 'code', text: String(row.reason) })]),
          h('td', { text: providerLabel(row.provider) }),
          td(fmt.int(row.records), true)
        ]));
      });
      table.appendChild(tbody);
      card.appendChild(scroller('Top skip reasons', table));
      section.appendChild(card);
      return section;
    }

    /* ---------------------------------------------------------- the failures */

    function keptFailures(body) {
      return list(body.failedRuns).filter(function (run) { return appKeeps(picked.app, run); });
    }

    function causeOf(run) {
      if (run.errorCode) return String(run.errorCode);
      return run.status === 'stale' ? 'stale (never closed)' : 'no code';
    }

    function causesBand(body) {
      var runs = keptFailures(body);
      var section = S.band('Why they failed', 'The newest ' + fmt.int(list(body.failedRuns).length) +
        ' failed runs, by cause');
      var card = S.card();
      if (!runs.length) {
        card.appendChild(S.stateBlock('check', picked.app === 'all'
          ? 'No failed run on record'
          : 'No failed run from ' + appLabel(picked.app) + ' among them', []));
        section.appendChild(card);
        return section;
      }
      var causes = {};
      var order = [];
      runs.forEach(function (run) {
        var cause = causeOf(run);
        if (!causes[cause]) { causes[cause] = { runs: 0, providers: {} }; order.push(cause); }
        causes[cause].runs += 1;
        causes[cause].providers[run.provider] = (causes[cause].providers[run.provider] || 0) + 1;
      });
      order.sort(function (a, b) { return causes[b].runs - causes[a].runs || a.localeCompare(b); });
      var table = h('table', { className: 'tbl' });
      table.appendChild(h('thead', {}, [h('tr', {}, [
        th('Error code'), th('Runs', true), th('Share', true), th('Providers')
      ])]));
      var tbody = h('tbody');
      order.forEach(function (cause) {
        var c = causes[cause];
        tbody.appendChild(h('tr', {}, [
          h('td', {}, [h('span', { className: 'code', text: cause })]),
          td(fmt.int(c.runs), true),
          td(pct(share(c.runs, runs.length)), true),
          h('td', { text: Object.keys(c.providers).sort().map(function (id) {
            return providerLabel(id) + ' ' + c.providers[id];
          }).join(', ') })
        ]));
      });
      table.appendChild(tbody);
      card.appendChild(scroller('Why they failed', table));
      section.appendChild(card);
      return section;
    }

    function failedBand(body) {
      var runs = keptFailures(body);
      var section = S.band('Failed runs', 'Newest first, ' + fmt.int(runs.length) + ' of the newest ' +
        fmt.int(list(body.failedRuns).length) + '. No athlete is named.');
      var card = S.card();
      if (!runs.length) {
        card.appendChild(S.stateBlock('check', 'Nothing to list', [
          picked.app === 'all' ? 'The ledger holds no failed run.' : 'None of them came from ' + appLabel(picked.app) + '.'
        ]));
        section.appendChild(card);
        return section;
      }
      var table = h('table', { className: 'tbl ws-failed' });
      table.appendChild(h('caption', { className: 'sr', text: 'Newest failed sync runs' }));
      table.appendChild(h('thead', {}, [h('tr', {}, [
        th('Run key'), th('Started'), th('Provider and app'), th('Trigger and data'), th('Error')
      ])]));
      var tbody = h('tbody');
      runs.forEach(function (run) {
        var key = String(run.runKey || '');
        var keyCell = h('td', {}, [
          h('span', { className: 'ws-key-text', 'aria-hidden': 'true', text: shortKey(key) }),
          h('span', { className: 'sr', text: key })
        ]);
        keyCell.setAttribute('title', key);
        var summary = run.errorSummary ? maskContactDetails(String(run.errorSummary)) : null;
        var errorCell = h('td', {}, [h('div', {}, [
          h('span', { className: 'code', text: causeOf(run) })
        ])]);
        if (summary) errorCell.appendChild(h('div', { className: 't-sub', text: summary }));
        tbody.appendChild(h('tr', {}, [
          keyCell,
          h('td', { className: 'num', text: fmt.utcStamp(run.startedAt) || fmt.none }),
          h('td', {}, [
            h('div', { className: 't-main', text: providerLabel(run.provider) }),
            h('div', { className: 't-sub', text: appLabel(run.appVariant) +
              (run.appVersion ? ' ' + String(run.appVersion) : '') })
          ]),
          h('td', { text: String(run.trigger || fmt.none) + ' \u00b7 ' + String(run.dataType || fmt.none) }),
          errorCell
        ]));
      });
      table.appendChild(tbody);
      card.appendChild(scroller('Failed runs', table));
      section.appendChild(card);
      return section;
    }

    load();
  });
})(window);
