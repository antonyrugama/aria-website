/* Cloud costs.

   The pane answers what we are paying for and whether anything is unusual, in
   three views of the same money: a logical grouping for planning, the billing
   grouping for reconciliation, and unit cost for decisions.

   Two properties are load bearing and are checked in code rather than trusted:

     1. **Every figure carries the moment it was true.** Cost data is never
        live: the billing export publishes on a cycle, so a figure without its
        "as of" is a figure pretending to be current. Staleness is shown, and
        an old reading is still shown rather than replaced by nothing, because
        losing the number is worse than knowing it is a few hours behind.
     2. **The parts sum to the invoice.** Each view is a different way of
        cutting one bill, so each has to add up to the same total. The pane
        adds them and says so when they do not, rather than drawing five
        confident rows under a total none of them reaches.

   The All / Mobile / Coaches Web scope filter is deliberately absent here, and
   the filter bar says so rather than leaving a gap: cloud spend is billed per
   piece of infrastructure, so splitting one shared bill by client app would be
   an invented number. */
(function (global) {
  'use strict';

  var shell = global.OpsShell;
  var d = global.OpsPaneData;
  var h = shell.h;

  var PANE_ID = 'spend';

  /* The cost read API is a later slice. The figures are being collected, but
     nothing serves them yet, so there is no path to call and none is guessed. */
  var SOURCE = { paneId: PANE_ID, endpoint: null };

  var NOT_REPORTING = {
    title: 'Cost reporting is not available yet',
    detail: 'Costs are being collected, but nothing serves them to this page ' +
      'yet, so there is no total to show. A blank total would be ' +
      'indistinguishable from a month that cost nothing.'
  };

  /* ------------------------------------------------------- as of and stale */

  /* The "as of" line, which every state that shows a figure carries.

     Two separate facts, kept separate: when the reading was taken, and whether
     the reading is behind where it should be. A pane that folds the second
     into the first ends up either hiding staleness or shouting it on a normal
     day. */
  function asOfLine(data) {
    var wrap = h('div', { className: 'row row-wrap asof' });
    wrap.appendChild(shell.icon('clock'));

    var stamp = d.utcStamp(data.asOf);
    wrap.appendChild(h('span', {
      text: stamp
        ? 'As of ' + stamp + '.'
        : 'The time of this reading was not reported, so it cannot be trusted as current.'
    }));

    if (data.publishLagHours) {
      wrap.appendChild(h('span', {
        text: 'Billing publishes on a ' + data.publishLagHours +
          ' hour cycle, so today is only partly counted.'
      }));
    }

    var stale = isStale(data);
    if (stale) {
      var badge = h('span', { className: 'badge badge-warn' });
      badge.appendChild(shell.icon('warn'));
      badge.appendChild(h('span', { text: 'Stale' }));
      wrap.appendChild(badge);
      wrap.appendChild(h('span', { className: 'ink-warn', text: stale }));
    }
    return wrap;
  }

  /* Returns the sentence explaining why a reading is behind, or null.

     Two independent sources of the answer, because they fail differently: the
     reporting may say outright that its last attempt did not land, and the
     timestamp may simply be older than the publish cycle can explain. Either
     one alone would miss a real case. */
  function isStale(data) {
    if (data.staleness && data.staleness.state && data.staleness.state !== 'ok') {
      return data.staleness.detail || 'The last attempt to read costs did not land.';
    }
    var age = d.hoursSince(data.asOf);
    var lag = data.publishLagHours || 8;
    if (age !== null && age > lag * 2) {
      return 'This reading is ' + age + ' hours old, which is longer than the ' +
        'publishing cycle explains.';
    }
    return null;
  }

  /* ------------------------------------------------------- budget header */

  function budgetCard(data) {
    var currency = data.currency;
    var card = d.card({});
    var body = d.cardBody('stack-sm');

    var total = (data.total && data.total.micros) || 0;
    var forecast = data.forecast && data.forecast.micros;
    var budget = data.budget && data.budget.micros;

    /* The headline pair: what has been billed, and what that is on course to
       become. Kept side by side because either one alone invites the wrong
       reaction halfway through a month. */
    var headline = h('div', { className: 'row row-wrap budget-head' });

    var spent = h('div', {}, [
      h('h2', { className: 'tile-label', text: 'Month to date' }),
      h('div', { className: 'row row-wrap budget-figure' }, [
        h('div', { className: 'tile-value', text: d.money(total, currency) })
      ])
    ]);

    if (data.total && typeof data.total.changeBasisPoints === 'number') {
      var up = data.total.changeBasisPoints > 0;
      var delta = h('span', {
        className: 'delta ' + (up ? 'delta-down' : 'delta-up'),
        text: d.signedPercent(data.total.changeBasisPoints)
      });
      spent.lastChild.appendChild(delta);
      spent.lastChild.appendChild(h('span', {
        className: 'small muted',
        text: data.total.comparisonLabel || 'against the same day last month'
      }));
    }
    headline.appendChild(spent);

    if (typeof forecast === 'number') {
      var right = h('div', { className: 'right budget-forecast' }, [
        h('div', { className: 'small muted', text: 'Forecast to period end' }),
        h('div', { className: 'mono budget-forecast-value', text: d.money(forecast, currency) })
      ]);
      if (typeof budget === 'number' && budget > 0) {
        right.appendChild(h('div', {
          className: 'tiny muted',
          text: d.percent(Math.round((forecast / budget) * 10000), 0) +
            ' of the ' + d.money(budget, currency, { digits: 0 }) + ' budget'
        }));
      }
      headline.appendChild(h('div', { className: 'spacer' }));
      headline.appendChild(right);
    }
    body.appendChild(headline);

    body.appendChild(budgetBar(data));

    var foot = h('div', { className: 'row row-wrap budget-note' });
    if (data.period) {
      foot.appendChild(h('span', {
        className: 'tiny muted',
        text: 'Day ' + data.period.dayOfPeriod + ' of ' + data.period.daysInPeriod +
          (data.period.actualThrough
            ? '. Billed usage through ' + d.utcDay(data.period.actualThrough) + '.'
            : '.')
      }));
    }
    if (data.forecast && data.forecast.basis) {
      foot.appendChild(h('span', { className: 'tiny muted', text: data.forecast.basis }));
    }
    if (foot.childNodes.length) body.appendChild(foot);

    card.appendChild(body);
    card.appendChild(d.cardFoot([asOfLine(data)]));
    return card;
  }

  /* The budget bar. Scaled to whichever is larger, the budget or the forecast,
     so an overrun is drawn as an overrun rather than silently clipped at the
     end of the track.

     Every length here is also stated in words above or below it. The bar is
     hidden from assistive technology on purpose: repeating three figures as an
     unlabelled graphic adds nothing a reader can use. */
  function budgetBar(data) {
    var currency = data.currency;
    var total = (data.total && data.total.micros) || 0;
    var forecast = (data.forecast && data.forecast.micros) || total;
    var budget = data.budget && data.budget.micros;

    var scale = Math.max(budget || 0, forecast, total) || 1;
    var wrap = h('div', { className: 'budget' });

    var spent = h('i', { className: 'spent' });
    spent.style.setProperty('width', ((total / scale) * 100).toFixed(2) + '%');
    wrap.appendChild(spent);

    if (forecast > total) {
      var over = h('i', { className: 'fcast' });
      over.style.setProperty('left', ((total / scale) * 100).toFixed(2) + '%');
      over.style.setProperty('width', (((forecast - total) / scale) * 100).toFixed(2) + '%');
      wrap.appendChild(over);
    }

    if (typeof budget === 'number' && budget > 0) {
      var marker = h('span', { className: 'budget-marker' });
      marker.style.setProperty('left', ((budget / scale) * 100).toFixed(2) + '%');
      wrap.appendChild(marker);
    }

    wrap.setAttribute('aria-hidden', 'true');

    var row = h('div', { className: 'budget-legend' }, [
      h('span', { className: 'mono', text: d.money(total, currency) + ' billed so far' })
    ]);
    if (forecast > total) {
      row.appendChild(h('span', {
        className: 'mono muted',
        text: d.money(forecast - total, currency) + ' more forecast'
      }));
    }
    if (typeof budget === 'number' && budget > 0) {
      var overBudget = forecast > budget;
      row.appendChild(h('span', {
        className: overBudget ? 'mono ink-warn' : 'mono muted',
        text: overBudget
          ? d.money(forecast - budget, currency) + ' over the budget'
          : d.money(budget - forecast, currency) + ' under the budget'
      }));
    }

    return h('div', { className: 'budget-wrap' }, [wrap, row]);
  }

  /* ------------------------------------------------------ unusual spending */

  function anomalies(data) {
    var found = data.anomalies || [];
    if (!found.length) return null;

    var wrap = h('div', { className: 'stack-sm' });
    found.forEach(function (item) {
      var box = d.callout('warn', 'warn', [d.strong(item.title), ' ' + item.detail]);
      if (item.link && item.link.href) {
        box.lastChild.appendChild(h('div', { className: 'row mt-sm' }, [
          h('a', { className: 'btn btn-sm', href: item.link.href, text: item.link.label })
        ]));
      }
      wrap.appendChild(box);
    });
    return wrap;
  }

  /* ---------------------------------------------------- the three views */

  var VIEWS = [
    { key: 'category', label: 'Category' },
    { key: 'resourceGroup', label: 'Resource group' },
    { key: 'service', label: 'Service' }
  ];

  function viewsCard(data) {
    var views = data.views || {};
    var present = VIEWS.filter(function (v) {
      return views[v.key] && (views[v.key].rows || []).length;
    });
    if (!present.length) return null;

    var first = views[present[0].key];
    var card = d.card({ title: first.label, hint: first.hint });
    var body = d.cardBody();

    if (present.length > 1) {
      var built = d.tabbed({
        label: 'How to group the bill',
        idPrefix: 'spendview',
        tabs: present.map(function (v) {
          return { id: v.key, label: v.label, panel: viewPanel(views[v.key], data) };
        })
      });
      var head = card.querySelector('.card-head');
      head.appendChild(h('div', { className: 'spacer' }));
      head.appendChild(built.tablist);
      body.appendChild(built.panels);
    } else {
      body.appendChild(viewPanel(first, data));
    }

    card.appendChild(body);
    if (data.scopeNote) {
      card.appendChild(d.cardFoot([h('span', { text: data.scopeNote })]));
    }
    return card;
  }

  function viewPanel(view, data) {
    var wrap = h('div', {});
    var currency = data.currency;

    (view.rows || []).forEach(function (row) {
      var line = h('div', { className: 'cat' });

      var swatch = h('span', { className: 'cat-swatch', 'aria-hidden': 'true' });
      if (row.color) swatch.style.setProperty('background', row.color);
      line.appendChild(swatch);

      var name = h('div', { className: 'cat-main' }, [
        h('div', { className: 'cat-name', text: row.label })
      ]);
      if (row.description) {
        name.appendChild(h('div', { className: 'cat-sub', text: row.description }));
      }
      /* An unmapped service is a real row with a warning, never folded into
         whichever group looks closest. Guessing would make the grouping
         quietly wrong in exactly the moment somebody is looking at it because
         something changed. */
      if (row.ungrouped) {
        var flag = h('span', { className: 'badge badge-warn cat-flag' });
        flag.appendChild(shell.icon('warn'));
        flag.appendChild(h('span', { text: 'Not grouped yet' }));
        name.appendChild(flag);
      }
      line.appendChild(name);

      line.appendChild(h('div', { className: 'cat-amt mono', text: d.money(row.micros, currency) }));

      var share = h('div', { className: 'cat-pct mono' }, [
        h('span', { text: d.percent(row.shareBasisPoints) })
      ]);
      if (typeof row.changeBasisPoints === 'number') {
        /* Thresholds rather than a gradient, because the reader is asking one
           question of this column: is this line the reason the bill moved.
           A change is also always a word or a signed number, never a colour on
           its own. */
        var tone = row.changeBasisPoints >= 2500 ? 'ink-crit'
          : row.changeBasisPoints >= 1000 ? 'ink-warn' : 'muted';
        share.appendChild(h('span', {
          className: tone,
          text: row.changeBasisPoints === 0 ? 'flat' : d.signedPercent(row.changeBasisPoints, 0)
        }));
      }
      line.appendChild(share);

      wrap.appendChild(line);
    });

    var check = reconciliation(view, data);
    if (check) wrap.appendChild(check);
    return wrap;
  }

  /* Adds the view up and compares it with the billed total.

     This is the pane's central claim, so it is arithmetic rather than a
     promise in a footer. Money is in integer micro-units precisely so this
     comparison is exact: a float sum over a few hundred daily rows does not
     reproduce an invoice total, and a near miss would be indistinguishable
     from a real gap. */
  function reconciliation(view, data) {
    var total = data.total && data.total.micros;
    if (typeof total !== 'number') return null;

    var sum = 0;
    (view.rows || []).forEach(function (row) {
      if (typeof row.micros === 'number') sum += row.micros;
    });

    var box;
    if (sum === total) {
      box = d.callout('info', 'check', [
        d.strong('These rows add up to the bill exactly.'),
        ' ' + d.money(sum, data.currency) + ' across ' + (view.rows || []).length +
          ' rows, which is the billed total for the period. Nothing is left ' +
          'over and nothing is counted twice.'
      ]);
    } else {
      box = d.callout('crit', 'warn', [
        d.strong('These rows do not add up to the bill.'),
        ' They come to ' + d.money(sum, data.currency) + ' against a billed ' +
          d.money(total, data.currency) + ', a difference of ' +
          d.money(Math.abs(sum - total), data.currency) + '. Read the rows as ' +
          'incomplete until that is explained.'
      ]);
    }
    box.classList.add('mt');
    return box;
  }

  /* -------------------------------------------------------- daily trend */

  function dailyCard(data) {
    var daily = data.daily;
    if (!daily || !(daily.series || []).length) return null;

    var legend = h('div', { className: 'legend' });
    daily.series.forEach(function (s) {
      var swatch = h('i', { 'aria-hidden': 'true' });
      if (s.color) swatch.style.setProperty('background', s.color);
      legend.appendChild(h('span', {}, [swatch, h('span', { text: s.label })]));
    });

    var card = d.card({
      title: 'Daily spend',
      hint: daily.hint,
      headExtra: legend
    });
    var body = d.cardBody();
    body.appendChild(d.lineChart({
      height: 190,
      label: daily.label || 'Daily spend for this period against the previous one',
      series: daily.series
    }));
    if ((daily.labels || []).length) {
      var axis = h('div', { className: 'axis-x', 'aria-hidden': 'true' });
      daily.labels.forEach(function (label) {
        axis.appendChild(h('span', { text: label }));
      });
      body.appendChild(axis);
    }
    if (daily.note) {
      body.appendChild(h('p', { className: 'axis-note mt-sm', text: daily.note }));
    }
    card.appendChild(body);
    return card;
  }

  /* ---------------------------------------------------------- unit cost */

  function unitCard(data) {
    var unit = data.unitCosts;
    if (!unit) return null;

    var card = d.card({ title: 'Cost per person', hint: unit.hint });
    var body = d.cardBody('stack-sm');
    var currency = data.currency;

    (unit.rows || []).forEach(function (row) {
      body.appendChild(h('div', { className: 'row unit-row' }, [
        h('span', { className: 'small', text: row.label }),
        h('div', { className: 'spacer' }),
        h('span', {
          className: 'mono strong',
          text: d.money(row.micros, currency, { digits: row.digits === undefined ? 3 : row.digits })
        })
      ]));
    });

    var byType = unit.byRequestType;
    if (byType && (byType.rows || []).length) {
      body.appendChild(h('div', { className: 'rule', 'aria-hidden': 'true' }));
      body.appendChild(h('h4', { className: 'tile-label', text: 'AI cost by request type' }));
      body.appendChild(d.rankList(byType.rows.map(function (row) {
        return {
          label: row.label,
          value: row.micros,
          color: row.color,
          note: typeof row.perRunMicros === 'number'
            ? d.money(row.perRunMicros, currency, { digits: 3 }) + ' each'
            : null
        };
      }), {
        format: function (r) { return d.money(r.value, currency, { digits: 0 }); }
      }));
      if (byType.note) {
        body.appendChild(h('p', { className: 'axis-note mt-sm', text: byType.note }));
      }
    }

    card.appendChild(body);

    /* The unit figures are modelled from recorded token counts, so the footer
       has to say how far the model is from the bill rather than imply it is
       the bill. */
    var rec = data.reconciliation;
    if (rec && typeof rec.driftBasisPoints === 'number') {
      var over = typeof rec.thresholdBasisPoints === 'number' &&
        Math.abs(rec.driftBasisPoints) > rec.thresholdBasisPoints;
      card.appendChild(d.cardFoot([
        h('span', {
          className: over ? 'ink-warn' : '',
          text: 'Modelled from recorded usage and checked nightly against the ' +
            'bill. Currently ' + d.percent(Math.abs(rec.driftBasisPoints)) +
            ' apart' + (over ? ', which is past the point where it is raised as a problem.' : '.')
        })
      ]));
    }
    return card;
  }

  /* --------------------------------------------------------------- ready */

  function renderReady(data) {
    var root = h('div', { className: 'stack' });

    root.appendChild(budgetCard(data));

    var unusual = anomalies(data);
    if (unusual) root.appendChild(unusual);

    root.appendChild(d.bandHead('Where the money goes', 'Three ways of looking at one bill'));

    var grid = h('div', { className: 'grid g-main-b' });
    var left = h('div', { className: 'stack' });
    var right = h('div', { className: 'stack' });

    [viewsCard(data), dailyCard(data)].forEach(function (c) { if (c) left.appendChild(c); });
    [unitCard(data)].forEach(function (c) { if (c) right.appendChild(c); });

    grid.appendChild(left);
    grid.appendChild(right);
    root.appendChild(grid);
    return root;
  }

  /* The period has not published yet. Distinct from a fault and distinct from
     nothing being spent: the export runs on a cycle, and the first hours of a
     new period legitimately have nothing in them. */
  function renderNotPublished(data) {
    var detail = (data.availability && data.availability.detail) ||
      'The billing export has not published for this period yet.';

    var actions = [];
    var ranges = ((shell.panes[PANE_ID] || {}).range) || [];
    if (ranges.indexOf('last-month') !== -1) {
      actions.push(h('a', {
        className: 'btn', href: 'spend.html?range=last-month',
        text: 'Show the last closed period'
      }));
    }

    var node = d.stateCard('spend', 'Costs have not published for this period', [
      detail,
      'This is normal in the first hours of a new period. It means not yet ' +
        'known, not nothing spent.'
    ], actions);

    if (data.asOf) {
      node.appendChild(h('p', { className: 'axis-note' }, [asOfLine(data)]));
    }
    return node;
  }

  /* -------------------------------------------------------------- render */

  function mount(content, ctx) {
    var host = h('div', { className: 'pane' });
    content.appendChild(host);

    var token = 0;

    function paint(node) {
      host.textContent = '';
      host.appendChild(node);
      shell.wireTabs(host);
    }

    function refresh() {
      var mine = ++token;
      paint(d.loading([120, 260]));

      d.load(SOURCE).then(function (result) {
        if (mine !== token) return;
        if (result.kind === 'no-source') { paint(d.noSource(NOT_REPORTING)); return; }

        var data = result.data || {};
        var state = (data.availability && data.availability.state) || 'ready';
        if (state === 'not_published') { paint(renderNotPublished(data)); return; }
        if (state !== 'ready') {
          paint(d.stateCard('spend', 'Cost reporting is not set up', [
            (data.availability && data.availability.detail) ||
              'No cost source is configured for this period.',
            'This is a configuration fact, not a reading. A source that was ' +
              'never set up reports nothing, which is not the same as a period ' +
              'that cost nothing.'
          ]));
          return;
        }
        paint(renderReady(data));
      }).catch(function (err) {
        if (mine !== token) return;
        paint(d.failure(err, {
          title: NOT_REPORTING.title,
          detail: NOT_REPORTING.detail,
          onRetry: refresh
        }));
      });
    }

    paint(d.loading([120, 260]));
    global.addEventListener('ops:filters', refresh);
  }

  global.OpsPanes = global.OpsPanes || {};
  global.OpsPanes[PANE_ID] = mount;
})(window);
