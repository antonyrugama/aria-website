/* People and usage.

   The pane owns one question: who is using the app, and is that growing. It
   carries no system health and no AI job state; those belong to Overview and
   the job panes, and a pane that answers two questions answers neither.

   Three rules from the approved design are load bearing here rather than
   decorative, so they are enforced in code rather than left to whoever writes
   the next card:

     1. Mobile and Coaches Web are never summed. They are two columns, and
        there is no code path that adds them, because a coach session and an
        athlete session measure different work.
     2. A rate whose denominator is under the reporting floor is not drawn. The
        pane says why and offers the raw counts, which are always safe.
     3. Coverage is the honest denominator. Where a figure is limited by app
        versions that do not report the event it needs, the limit is shown next
        to the figure rather than in a footnote nobody reads.

   Accounts that have not opted in to usage analytics are absent from every
   figure here, because the consent gate is enforced where the events are
   accepted rather than where they are drawn. There is no client-side filter to
   get wrong: an event from a non-consenting account was never stored. */
(function (global) {
  'use strict';

  var shell = global.OpsShell;
  var d = global.OpsPaneData;
  var h = shell.h;

  var PANE_ID = 'analytics';

  /* The read API for the usage pipeline is a later slice, so there is nothing
     to call yet. Null rather than a guessed path: a pane that calls a route
     nobody has written reports a 404 as though the platform were broken. */
  var SOURCE = { paneId: PANE_ID, endpoint: null };

  var NOT_REPORTING = {
    title: 'Usage reporting has not started yet',
    detail: 'Nobody is being counted yet, so there is no share, no rate, and ' +
      'no trend to draw. The apps have to be reporting before this pane has ' +
      'anything to say.'
  };

  /* -------------------------------------------------------------- header */

  /* The coverage warning. Only drawn where coverage is genuinely short, and it
     names the share it is short by, because "some data is missing" is a
     sentence that tells a reader nothing they can act on. */
  function coverageWarning(coverage, onJump) {
    if (!coverage || !coverage.shortfall) return null;

    var box = d.callout('warn', 'warn', [
      d.strong('Some app versions are not reporting in this window.'),
      ' ' + coverage.shortfall.detail + ' The usage figures below count only ' +
        'people whose app reports it, and anything affected is labelled.'
    ]);

    /* Offered only when there is a per-version card to jump to. A shortfall
       can be reported without the breakdown behind it, and a button that
       silently does nothing is worse than no button. */
    if (onJump) {
      var row = h('div', { className: 'row mt-sm' });
      var jump = h('button', {
        className: 'btn btn-sm', type: 'button', text: 'Show coverage by version'
      });
      jump.addEventListener('click', onJump);
      row.appendChild(jump);
      box.lastChild.appendChild(row);
    }
    return box;
  }

  /* ------------------------------------------------------- app comparison */

  /* One column per app. Never a blend, never a total: the wrapper is a grid of
     independent columns and there is no row that adds them. */
  function appColumns(data) {
    var section = h('section', { className: 'vs', 'aria-labelledby': 'vsHeading' });
    section.appendChild(h('h2', { className: 'sr-only', id: 'vsHeading', text: 'Usage by app' }));

    (data.apps || []).forEach(function (app) {
      var col = h('div', { className: 'vs-col' });

      var head = h('div', { className: 'vs-head' }, [
        h('h3', {}, [
          h('span', { className: 'tag tag-' + (app.tone || 'mobile'), text: app.label })
        ]),
        h('span', { className: 'small muted', text: app.subtitle || '' }),
        h('div', { className: 'spacer' })
      ]);

      /* Coverage is a share of sessions on a reporting app version, not a rate
         over people, so the reporting floor does not apply to it. What does
         apply is that an unreported coverage is not a shortfall: it says so
         rather than rendering as a figure. */
      var known = typeof app.coverageBasisPoints === 'number' &&
        isFinite(app.coverageBasisPoints);
      var full = app.coverageBasisPoints === 10000;
      var badge = h('span', { className: 'badge ' + (full ? 'badge-ok' : 'badge-warn') });
      badge.appendChild(shell.icon(full ? 'check' : 'warn'));
      badge.appendChild(h('span', {
        text: full ? 'Full coverage'
          : known ? d.percent(app.coverageBasisPoints) + ' coverage'
          : 'Coverage not reported'
      }));
      head.appendChild(badge);
      col.appendChild(head);

      (app.metrics || []).forEach(function (metric) {
        col.appendChild(metricRow(metric));
      });

      if (app.trend && app.trend.values && app.trend.values.length > 1) {
        var trend = h('div', { className: 'vs-trend' }, [
          d.sparkline(app.trend.values, { label: app.trend.label, color: app.trend.color })
        ]);
        col.appendChild(trend);
      }

      section.appendChild(col);
    });

    return section;
  }

  /* One figure in a column.

     Anything measured over a group goes through the floor first, and what
     makes it one is the denominator travelling with it rather than the label
     the pipeline happened to give it: a ratio delivered as a decimal is still
     a ratio, and used to walk straight past the guard. Everything left is a
     count, and a count is always reportable. */
  function metricRow(metric) {
    var row = h('div', { className: 'vs-metric' }, [
      h('span', { text: metric.label })
    ]);

    var overGroup = metric.kind === 'rate' || typeof metric.denominator === 'number';
    if (overGroup && !d.reportable(metric.denominator)) {
      row.classList.add('is-suppressed');
      /* An absent denominator is an unknown group, not an empty one. Printing
         it as "0 in group" asserted a size nobody had reported, next to a
         column that was busy stating real ones. */
      var known = typeof metric.denominator === 'number' && isFinite(metric.denominator);
      var said = h('div', { className: 'small suppressed right' }, [
        h('span', {
          text: known
            ? 'Not reported, ' + d.count(metric.denominator) + ' in group, ' +
              'under the ' + d.REPORTING_FLOOR + ' we report rates from'
            : 'Not reported, the size of this group was not given'
        })
      ]);
      /* Raw counts are always safe, so they are offered here as they are in
         the cohort and feature cards, whenever the payload carries one. Under
         the sentence rather than beside it, so a narrow column keeps two
         columns rather than growing a third. */
      if (known && typeof metric.numerator === 'number') {
        said.appendChild(h('div', {
          className: 'mono',
          text: d.count(metric.numerator) + ' of ' + d.count(metric.denominator)
        }));
      }
      row.appendChild(said);
      return row;
    }

    var value = h('b', { className: 'mono', text: d.metricValue(metric) });
    if (metric.tone) value.classList.add('ink-' + metric.tone);
    row.appendChild(value);
    return row;
  }

  /* ---------------------------------------------------- retention cohorts */

  /* The cohort grid, one per app, behind a real tablist.

     Every row is checked against the floor before a single cell is drawn.
     Suppression is per signup group rather than per cell because the group
     size is the denominator of all of them: if the week is too small, no
     offset in it is reportable. */
  function cohortCard(data) {
    var cohorts = data.cohorts || [];
    if (!cohorts.length) return null;

    var card = d.card({
      title: 'How many keep coming back',
      hint: 'Weekly signup groups, share returning',
      id: 'cohortCard'
    });

    /* One app is not a choice, so it does not get a switcher. */
    var body = d.cardBody();
    if (cohorts.length > 1) {
      var built = d.tabbed({
        label: 'Signup group app',
        idPrefix: 'cohort',
        tabs: cohorts.map(function (c) {
          return { id: c.app, label: c.label, panel: cohortTable(c) };
        })
      });
      var head = card.querySelector('.card-head');
      head.appendChild(h('div', { className: 'spacer' }));
      head.appendChild(built.tablist);
      body.appendChild(built.panels);
    } else {
      body.appendChild(cohortTable(cohorts[0]));
    }
    card.appendChild(body);
    return card;
  }

  function cohortTable(cohort) {
    var wrap = h('div', { className: 'table-wrap' });
    var table = h('table', { className: 'cohort' });

    var head = h('thead');
    var headRow = h('tr', {}, [
      h('th', { scope: 'col', className: 'cohort-lbl', text: 'Signed up' }),
      h('th', { scope: 'col', text: 'Size' })
    ]);
    (cohort.offsets || []).forEach(function (o) {
      headRow.appendChild(h('th', { scope: 'col', text: o }));
    });
    head.appendChild(headRow);
    table.appendChild(head);

    var body = h('tbody');
    (cohort.rows || []).forEach(function (row) {
      body.appendChild(cohortRow(row, cohort));
    });
    table.appendChild(body);
    wrap.appendChild(table);

    if (cohort.note) {
      wrap.appendChild(h('p', { className: 'axis-note mt-sm', text: cohort.note }));
    }
    return wrap;
  }

  function cohortRow(row, cohort) {
    var tr = h('tr');
    tr.appendChild(h('th', { scope: 'row', className: 'cohort-lbl', text: row.label }));
    tr.appendChild(h('td', { className: 'na mono', text: d.count(row.size) }));

    if (!d.reportable(row.size)) {
      /* The whole group collapses into one cell carrying the reason and the
         raw counts, which are what is left that can be shown honestly. */
      var cell = h('td', {
        className: 'na cohort-suppressed',
        colspan: String((cohort.offsets || []).length)
      });
      cell.appendChild(h('div', { text: d.suppressionReason(row.size, 'people signed up') }));

      var raw = rawCounts(row, cohort);
      if (raw) {
        var toggle = h('button', {
          className: 'btn btn-sm mt-xs', type: 'button',
          'aria-expanded': 'false', text: 'Show raw counts instead'
        });
        raw.hidden = true;
        toggle.addEventListener('click', function () {
          var open = toggle.getAttribute('aria-expanded') === 'true';
          toggle.setAttribute('aria-expanded', String(!open));
          toggle.textContent = open ? 'Show raw counts instead' : 'Hide raw counts';
          raw.hidden = open;
        });
        cell.appendChild(toggle);
        cell.appendChild(raw);
      }
      tr.appendChild(cell);
      return tr;
    }

    (cohort.offsets || []).forEach(function (_, i) {
      var cellData = (row.cells || [])[i];
      if (!cellData || cellData.state === 'not_aged') {
        var na = h('td', { className: 'na' });
        na.appendChild(h('span', { 'aria-hidden': 'true', text: 'n/a' }));
        na.appendChild(h('span', { className: 'sr-only', text: 'Not aged into this week yet' }));
        tr.appendChild(na);
        return;
      }
      var td = h('td', { className: 'mono is-tinted', text: d.percent(cellData.basisPoints, 0) });
      /* The wash behind a cell repeats the number it sits behind, so it is
         never the only thing carrying the value. Capped well short of opaque
         so the ink on top stays readable at the strongest tint. */
      var tint = Math.max(0, Math.min(42, Math.round((cellData.basisPoints || 0) / 240)));
      td.style.setProperty('--cell-tint', tint + '%');
      tr.appendChild(td);
    });

    return tr;
  }

  /* Raw counts for a suppressed group. A count is not a rate, so nothing here
     is at risk of being read as a trend one person moved. */
  function rawCounts(row, cohort) {
    var cells = (row.cells || []).filter(function (c) {
      return c && typeof c.returned === 'number';
    });
    if (!cells.length) return null;

    var list = h('dl', { className: 'raw-counts' });
    (cohort.offsets || []).forEach(function (offset, i) {
      var cell = (row.cells || [])[i];
      if (!cell || typeof cell.returned !== 'number') return;
      list.appendChild(h('dt', { text: offset }));
      list.appendChild(h('dd', { className: 'mono', text: d.count(cell.returned) }));
    });
    return list;
  }

  /* ----------------------------------------------------------- the funnel */

  function funnelCard(data) {
    var funnel = data.funnel;
    if (!funnel || !(funnel.steps || []).length) return null;

    var card = d.card({ title: 'Getting to a first program', hint: funnel.hint });
    var body = d.cardBody();

    var top = funnel.steps[0].count || 1;
    var list = h('ol', { className: 'funnel', role: 'list' });

    funnel.steps.forEach(function (step) {
      var bar = h('i', { 'aria-hidden': 'true' });
      bar.style.setProperty('width', Math.max(1, (step.count / top) * 100).toFixed(2) + '%');

      var track = h('div', {
        className: 'funnel-bar' + (step.tone === 'crit' ? ' is-crit' : ''),
        'aria-hidden': 'true'
      }, [bar]);

      var label = h('span', { className: 'small', text: step.label });
      if (step.tone === 'crit') label.classList.add('ink-crit');

      list.appendChild(h('li', { className: 'funnel-step' }, [
        label, track, h('span', { className: 'mono right', text: d.count(step.count) })
      ]));
    });
    body.appendChild(list);

    if (funnel.note) {
      var note = d.callout('warn', 'warn', [
        d.strong(funnel.note.title), ' ' + funnel.note.detail
      ]);
      note.classList.add('mt');
      var link = d.payloadLink(funnel.note.link);
      if (link) note.lastChild.appendChild(h('div', { className: 'row mt-sm' }, [link]));
      body.appendChild(note);
    }

    card.appendChild(body);
    return card;
  }

  /* ------------------------------------------------------- feature usage */

  function featureCard(data) {
    var features = data.features;
    if (!features || !(features.rows || []).length) return null;

    var card = d.card({ title: 'Which features get used', hint: features.hint });
    var body = d.cardBody();

    var reportable = [];
    var suppressed = [];
    features.rows.forEach(function (row) {
      if (d.reportable(row.denominator)) reportable.push(row);
      else suppressed.push(row);
    });

    if (reportable.length) {
      body.appendChild(d.rankList(reportable.map(function (row) {
        return {
          label: row.label,
          value: row.basisPoints,
          note: row.app,
          color: row.color
        };
      }), {
        format: function (r) { return d.percent(r.value, 0); }
      }));
    }

    if (suppressed.length) {
      var box = d.callout(null, 'info', [
        d.strong(suppressed.length === 1
          ? 'One feature is not reported here.'
          : suppressed.length + ' features are not reported here.'),
        ' Their app had fewer than ' + d.REPORTING_FLOOR + ' active users in ' +
          'this window, so a share would move by several points on one person. ' +
          'The raw counts are below.'
      ]);
      box.classList.add('mt-sm');
      var list = h('dl', { className: 'raw-counts' });
      suppressed.forEach(function (row) {
        list.appendChild(h('dt', { text: row.label }));
        list.appendChild(h('dd', {
          className: 'mono',
          text: d.count(row.users) + ' of ' + d.count(row.denominator)
        }));
      });
      box.lastChild.appendChild(list);
      body.appendChild(box);
    }

    if (features.note) {
      body.appendChild(h('p', { className: 'axis-note mt-sm', text: features.note }));
    }
    card.appendChild(body);

    if (features.coverageNote) {
      card.appendChild(d.cardFoot([h('span', { text: features.coverageNote })]));
    }
    return card;
  }

  /* -------------------------------------------------- metric definitions */

  /* The glossary, and the one thing on this pane that is not a figure.

     It is static because it is a definition rather than a measurement, and
     because a number without a definition is a rumour. The wording follows the
     operations metric definitions, which are the contract this surface is held
     to; the design mock's glossary is not. */
  var DEFINITIONS = [
    ['Active user', 'One authenticated account with at least one foreground session in the window, counted once per app no matter how many devices it used.'],
    ['Session', 'Foreground activity with gaps under 30 minutes. A background sync is not a session, and a session that crosses midnight is counted on the day it started.'],
    ['Coming back', 'Of the people who signed up in one week, how many were active again in a later week.'],
    ['Feature use', "Share of that app's own active users who opened the feature at least once. A shared denominator would understate a feature only one app has."],
    ['Coverage', 'Share of sessions on an app version that reports the event a figure needs. Shown next to any figure it limits.']
  ];

  function definitionsCard() {
    var card = d.card({ title: 'What these numbers mean' });
    var body = d.cardBody();

    var dl = h('dl', { className: 'dl dl-narrow' });
    DEFINITIONS.forEach(function (pair) {
      dl.appendChild(h('dt', { text: pair[0] }));
      dl.appendChild(h('dd', { className: 'plain', text: pair[1] }));
    });
    body.appendChild(dl);
    card.appendChild(body);

    card.appendChild(d.cardFoot([
      h('span', {
        text: 'Every period is counted in UTC. People who have not turned on ' +
          'usage analytics are in none of these figures: their activity is ' +
          'never recorded, so there is nothing to leave out later.'
      })
    ]));
    return card;
  }

  /* ------------------------------------------------------ coverage panel */

  function coverageCard(data) {
    var coverage = data.coverage;
    if (!coverage || !(coverage.versions || []).length) return null;

    var card = d.card({ title: 'Which app versions report data', id: 'coverageCard' });
    card.setAttribute('tabindex', '-1');

    var body = d.cardBody('stack-sm');
    coverage.versions.forEach(function (version) {
      /* The meter draws coverage, so the text beside it has to be coverage.
         It used to read the session share, a different quantity, which left
         the number this card exists to show carried by the length and the
         colour of a bar that is hidden from assistive technology: nowhere in
         text, and invisible to anybody who cannot compare bar lengths. The
         session share is still here, as the sentence underneath. */
      var known = typeof version.coverageBasisPoints === 'number' &&
        isFinite(version.coverageBasisPoints);
      var short = known && version.coverageBasisPoints < 10000;

      var notes = [];
      if (typeof version.sessionShareBasisPoints === 'number') {
        notes.push(d.percent(version.sessionShareBasisPoints, 0) +
          ' of sessions in this window ran on it.');
      }
      if (version.note) notes.push(version.note);

      body.appendChild(d.meterRow({
        label: version.label,
        value: known
          ? d.percent(version.coverageBasisPoints, 0) + ' of its sessions report'
          : 'Reporting not measured',
        fillPercent: known ? version.coverageBasisPoints / 100 : 0,
        tone: short || !known ? 'warn' : 'ok',
        note: notes.join(' ')
      }));
    });
    card.appendChild(body);

    card.appendChild(d.cardFoot([
      h('span', {
        text: 'Coverage is the honest denominator. A version that does not ' +
          'report an event is not evidence that its users do nothing.'
      })
    ]));
    return card;
  }

  /* --------------------------------------------------------------- ready */

  function renderReady(data) {
    var root = h('div', { className: 'stack' });

    var coverage = coverageCard(data);
    var warning = coverageWarning(data.coverage, coverage ? function () {
      var target = document.getElementById('coverageCard');
      if (!target) return;
      target.scrollIntoView({ block: 'nearest' });
      target.focus();
    } : null);
    if (warning) root.appendChild(warning);

    root.appendChild(appColumns(data));

    root.appendChild(d.callout('info', 'info', [
      d.strong('These columns are never added together.'),
      ' A coach session and an athlete session measure different work. ' +
        'Coaches Web shows longer visits and more regular use because it is a ' +
        'work tool, not because it is a better product. Combined totals appear ' +
        'only for counts that share a unit.'
    ]));

    /* The cards below are peers of the app comparison, not parts of it. Their
       titles are h3, so without a heading of their own they read to anybody
       navigating by headings as subsections of "Usage by app", which is a
       section they have nothing to do with. Silent, because the band it names
       is already obvious on screen from the layout. */
    root.appendChild(h('h2', {
      className: 'sr-only', text: 'Behaviour, features and coverage'
    }));

    var grid = h('div', { className: 'grid g-main' });
    var left = h('div', { className: 'stack' });
    var right = h('div', { className: 'stack' });

    [cohortCard(data), funnelCard(data)].forEach(function (c) {
      if (c) left.appendChild(c);
    });
    [featureCard(data), definitionsCard(), coverage].forEach(function (c) {
      if (c) right.appendChild(c);
    });

    grid.appendChild(left);
    grid.appendChild(right);
    root.appendChild(grid);

    /* No guard in front of the call: utcStamp answers null for a time it was
       not given, `null` and `0` included, so one test covers absent, empty and
       unreadable rather than three spellings of the same fact. */
    var stamp = d.utcStamp(data.asOf);
    root.appendChild(h('p', {
      className: 'axis-note',
      text: stamp
        ? 'Counted up to ' + stamp + '.'
        : 'The window these figures were counted up to was not reported, so ' +
          'they cannot be trusted as current.'
    }));
    return root;
  }

  /* The pane-level too-small state. Distinct from a suppressed row: this is
     the whole window being under the floor, which usually means the window is
     too narrow rather than that nothing happened. */
  function renderInsufficient(data) {
    var actions = [];
    var ranges = ((shell.panes[PANE_ID] || {}).range) || [];
    var widest = ranges.filter(function (r) { return r !== 'custom'; }).pop();
    /* Through the shell's filter state, so widening the window does not also
       silently move the operator off the app and environment they were
       looking at. */
    var href = widest && d.paneUrl(PANE_ID, { range: widest });
    if (href) {
      actions.push(h('a', {
        className: 'btn btn-primary',
        href: href,
        text: 'Try the widest window'
      }));
    }

    var detail = (data.availability && data.availability.detail) ||
      'Fewer than ' + d.REPORTING_FLOOR + ' people were active in this window.';

    return d.stateCard('analytics', 'Not enough data to report', [
      detail,
      'We do not report rates below ' + d.REPORTING_FLOOR + '. With a group ' +
        'this small one person moves the figure by several points, which would ' +
        'read as a change rather than as noise. Raw counts are always safe and ' +
        'are shown wherever they exist.'
    ], actions);
  }

  /* -------------------------------------------------------------- render */

  function mount(content, ctx) {
    var host = h('div', { className: 'pane' });
    content.appendChild(host);

    var token = 0;

    /* Every state the pane lands in is announced, not only the skeleton. The
       pane replaces its whole subtree on each filter change, so without this a
       screen reader hears "Loading figures" and then silence, including when
       what replaced it was the failure card.

       Focus is carried across the replacement when it was inside the pane, so
       a reader who activated "Try again" from the keyboard lands on what
       answered them rather than at the top of the document. */
    function paint(node, announcement) {
      var held = host.contains(document.activeElement);
      host.textContent = '';
      host.appendChild(node);
      shell.wireTabs(host);
      if (held) d.refocus(host);
      if (announcement) shell.announce(announcement);
    }

    function refresh() {
      var mine = ++token;
      paint(d.loading([132, 220]));

      d.load(SOURCE).then(function (result) {
        if (mine !== token) return;
        if (result.kind === 'no-source') {
          paint(d.noSource(NOT_REPORTING), NOT_REPORTING.title);
          return;
        }

        var data = (result.data && typeof result.data === 'object') ? result.data : null;
        if (!data) { paint(d.noSource(NOT_REPORTING), NOT_REPORTING.title); return; }

        var state = data.availability && data.availability.state;
        if (state === 'insufficient') {
          paint(renderInsufficient(data), 'Not enough data to report');
          return;
        }
        if (state && state !== 'ready') {
          paint(d.noSource(NOT_REPORTING), NOT_REPORTING.title);
          return;
        }

        /* An answer carrying no app columns is not a ready pane. Defaulting
           the state to ready meant a payload with nothing in it drew the
           "these columns are never added together" callout and the glossary
           over no figures at all, which reads as a measured result rather than
           as an empty answer. The columns are the pane; without them there is
           nothing to be ready about. */
        if (!(data.apps || []).length) {
          paint(d.noSource(NOT_REPORTING), NOT_REPORTING.title);
          return;
        }

        paint(renderReady(data), 'Usage figures updated');
      }).catch(function (err) {
        if (mine !== token) return;
        paint(d.failure(err, {
          title: NOT_REPORTING.title,
          detail: NOT_REPORTING.detail,
          onRetry: refresh
        }), 'Could not load these figures');
      });
    }

    /* The shell fires the starting selection as an ordinary change, once the
       shell is in the document and before anything else can happen, so there
       is one path into a load rather than one for the first selection and one
       for every later one. The skeleton goes up now so the pane is never blank
       between being mounted and that event arriving. */
    paint(d.loading([132, 220]));
    global.addEventListener('ops:filters', refresh);
  }

  global.OpsPanes = global.OpsPanes || {};
  global.OpsPanes[PANE_ID] = mount;
})(window);
