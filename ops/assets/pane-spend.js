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

  var ENDPOINT = '/api/ops/costs';

  /* Where the figures come from, built at the moment of the call.

     The range is the only control this pane registers, and it has to travel:
     the cost route defaults an absent range to this month, so a pane that sent
     no querystring would answer "Last 3 months" with this month's bill and put
     the operator's own selection in the bar above it as though it had been
     applied. Every range the shell offers here is one this route serves, which
     is why Custom is no longer among them. */
  function source() {
    return {
      paneId: PANE_ID,
      endpoint: ENDPOINT,
      query: { range: shell.filters().range }
    };
  }

  var NOT_REPORTING = {
    title: 'Cost reporting is not available yet',
    detail: 'This pane asked the operations API for the bill and did not get ' +
      'one back, so there is no total to show. A blank total would be ' +
      'indistinguishable from a month that cost nothing.'
  };

  /* What the pane says when an answer arrives carrying no billed total.
     Separate wording from the one above, because the two are different facts:
     nothing was asked, against something answered and the answer was empty. */
  var NO_TOTAL = {
    title: 'This answer carried no billed total',
    detail: 'The cost reporting answered, but the response held no total for ' +
      'this period, so there is nothing to show it against and nothing for ' +
      'the groupings below to be checked against.',
    closing: 'A missing total and a zero total look identical on a bar, so ' +
      'this pane draws neither. What this period cost is not something this ' +
      'answer says, in either direction.'
  };

  /* A number from the payload, or null. Never a substituted zero: on a pane
     about money, a zero is a claim, and it is the one claim a missing field
     must not be turned into. */
  function numeric(value) {
    return (typeof value === 'number' && isFinite(value)) ? value : null;
  }

  /* A money figure from the payload, or null.

     Shape-strict, and that is the whole point of it existing separately from
     numeric. A money field on this pane is an object carrying micros; reading
     it as `box && box.micros` instead means a scalar `total: 0` short-circuits
     the chain to the number 0, which is finite, which numeric accepts, which
     puts "$0.00" under "Month to date" for a payload that reported no total at
     all. The rule two comments up has to hold for every shape a sender can
     send, not only for the absent one. Anything that is not an object with a
     finite numeric micros, arrays and scalars included, is no figure. */
  function moneyMicros(box) {
    if (!box || typeof box !== 'object') return null;
    return numeric(box.micros);
  }

  function totalMicros(data) {
    return moneyMicros(data && data.total);
  }

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
        text: 'Billing publishes on ' + d.article(data.publishLagHours) + ' ' +
          data.publishLagHours + ' hour cycle, so today is only partly counted.'
      }));
    }

    var stale = isStale(data);
    if (stale) {
      var badge = h('span', { className: 'badge badge-warn' });
      badge.appendChild(shell.icon('warn'));
      badge.appendChild(h('span', { text: stale.badge }));
      wrap.appendChild(badge);
      wrap.appendChild(h('span', { className: 'ink-warn', text: stale.detail }));
      if (stale.also) {
        wrap.appendChild(h('span', {
          className: 'ink-warn',
          text: 'The reporting also reported a failure of its own. ' + stale.also
        }));
      }
    }
    return wrap;
  }

  /* Returns the sentence explaining why a reading cannot be read as current,
     or null.

     Three independent sources of the answer, because they fail differently:
     the reporting may say outright that its last attempt did not land, the
     timestamp may be older than the publish cycle can explain, and the
     timestamp may be ahead of now, which is not a fresh reading at all but two
     clocks disagreeing. The third used to be invisible because the age was
     clamped at zero, which made the one case nobody would guess at look like
     the healthiest reading on the pane.

     A disagreeing clock takes the badge, because it undermines any claim about
     age, including the reporting's own. It does not take the other fact with
     it: a declared export failure is independent of what the stamp says, and
     is carried alongside as `also` rather than dropped, because it is the half
     somebody can go and act on. */
  function isStale(data) {
    var declared = (data.staleness && data.staleness.state && data.staleness.state !== 'ok')
      ? (data.staleness.detail || 'The last attempt to read costs did not land.')
      : null;

    var age = d.hoursSince(data.asOf);
    if (age !== null && age < 0) {
      return {
        badge: 'Clocks disagree',
        detail: 'This reading is stamped ' + d.hours(-age) + ' ahead of now, ' +
          'so the reporting and this page do not agree on the time. Treat the ' +
          'figures as unverified until that is explained.',
        also: declared
      };
    }
    if (declared) {
      return { badge: 'Stale', detail: declared };
    }
    var lag = data.publishLagHours || 8;
    if (age !== null && age > lag * 2) {
      return {
        badge: 'Stale',
        detail: 'This reading is ' + d.hours(age) + ' old, which is longer ' +
          'than the publishing cycle explains.'
      };
    }
    return null;
  }

  /* ------------------------------------------------------- budget header */

  /* What the headline figure is the total of.

     It said "Month to date" whatever the range was, which was invisible while
     this pane had no endpoint and became wrong the moment it had one: the same
     words sat over a twelve month bill. The range travels in the response, so
     the label is read from the answer rather than from the control, and an
     unrecognised one falls back to words that are true of any window rather
     than to the name of a window this might not be. */
  var RANGE_LABELS = {
    'month': 'Month to date',
    'last-month': 'Last month',
    '7d': 'Last 7 days',
    '3m': 'Last 3 months',
    '12m': 'Last 12 months'
  };

  function totalLabel(data) {
    var range = data && data.range;
    return (typeof range === 'string' &&
      Object.prototype.hasOwnProperty.call(RANGE_LABELS, range))
      ? RANGE_LABELS[range] : 'Billed in this period';
  }

  function budgetCard(data) {
    var currency = data.currency;
    var card = d.card({});
    var body = d.cardBody('stack-sm');

    var total = totalMicros(data);
    var forecast = moneyMicros(data.forecast);
    var budget = moneyMicros(data.budget);

    /* The headline pair: what has been billed, and what that is on course to
       become. Kept side by side because either one alone invites the wrong
       reaction halfway through a month. */
    var headline = h('div', { className: 'row row-wrap budget-head' });

    var spent = h('div', {}, [
      h('h2', { className: 'tile-label', text: totalLabel(data) }),
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

    if (forecast !== null) {
      var right = h('div', { className: 'right budget-forecast' }, [
        h('div', { className: 'small muted', text: 'Forecast to period end' }),
        h('div', { className: 'mono budget-forecast-value', text: d.money(forecast, currency) })
      ]);
      if (budget !== null && budget > 0) {
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

    var bar = budgetBar(data);
    if (bar) body.appendChild(bar);

    var foot = h('div', { className: 'row row-wrap budget-note' });
    if (data.period) {
      /* utcDay answers null for a stamp it cannot read, and null is not a
         date an operator should ever be shown. The sentence exists only when
         the day does. */
      var billedThrough = data.period.actualThrough
        ? d.utcDay(data.period.actualThrough) : null;
      foot.appendChild(h('span', {
        className: 'tiny muted',
        text: 'Day ' + data.period.dayOfPeriod + ' of ' + data.period.daysInPeriod +
          (billedThrough ? '. Billed usage through ' + billedThrough + '.' : '.')
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
     unlabelled graphic adds nothing a reader can use.

     Returns null with no billed total, rather than drawing an empty track: a
     bar starting at zero is a statement that nothing has been spent, and that
     is exactly the statement a missing figure is not allowed to make. */
  function budgetBar(data) {
    var currency = data.currency;
    var total = totalMicros(data);
    if (total === null) return null;
    var forecast = moneyMicros(data.forecast);
    if (forecast === null) forecast = total;
    var budget = moneyMicros(data.budget);

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

    if (budget !== null && budget > 0) {
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
    if (budget !== null && budget > 0) {
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
      var link = d.payloadLink(item.link);
      if (link) box.lastChild.appendChild(h('div', { className: 'row mt-sm' }, [link]));
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

  /* What the card is called while a given view is selected. The payload names
     each view; the registry above is the fallback so the heading is never
     blank and never borrowed from a different grouping. */
  function viewTitle(view, meta) {
    return view.label || ('By ' + meta.label.toLowerCase());
  }

  function viewsCard(data) {
    var views = data.views || {};
    var present = VIEWS.filter(function (v) {
      return views[v.key] && (views[v.key].rows || []).length;
    });
    if (!present.length) return null;

    var first = views[present[0].key];
    var card = d.card({ title: viewTitle(first, present[0]) });
    var head = card.querySelector('.card-head');
    var title = card.querySelector('.card-title');

    /* Built here rather than through the card's own hint option so the element
       exists whether or not the first view carries one, which is what lets the
       heading and its hint both follow the selected tab. */
    var hint = h('span', { className: 'card-hint', text: first.hint || '' });
    hint.hidden = !first.hint;
    head.appendChild(hint);

    var body = d.cardBody();

    if (present.length > 1) {
      /* The heading names the grouping on screen, so it has to change with the
         grouping. It is also the heading a screen reader lands on above these
         rows, and leaving it on the first view meant the rows under "By
         category" were resource groups on a pane whose whole claim is that
         these are three different ways of cutting one bill. */
      var built = d.tabbed({
        label: 'How to group the bill',
        idPrefix: 'spendview',
        tabs: present.map(function (v) {
          return { id: v.key, label: v.label, panel: viewPanel(views[v.key], data) };
        }),
        onSelect: function (key) {
          var view = views[key];
          if (!view) return;
          var chosen = VIEWS.filter(function (v) { return v.key === key; })[0];
          title.textContent = viewTitle(view, chosen);
          hint.textContent = view.hint || '';
          hint.hidden = !view.hint;
        }
      });
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

      /* Through seriesStroke, the same helper the daily legend and the lines
         use, rather than the allowlist raw with a stylesheet default behind
         it. Two fallbacks that are different colours is how a key stopped
         matching its own chart in the first place. */
      var swatch = h('span', { className: 'cat-swatch', 'aria-hidden': 'true' });
      swatch.style.setProperty('background', d.seriesStroke(row.color));
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
     from a real gap.

     Which means a row that cannot be read makes the check unavailable, and is
     neither zero nor automatically a mismatch. Every row goes through the same
     shape-strict moneyMicros the total goes through. Counting an unreadable
     row as zero mints the exact zero this pane refuses everywhere else, and
     does it under the sentence "nothing is left over and nothing is counted
     twice", which is a false green on the pane's central claim; a row of NaN
     or Infinity satisfying `typeof === 'number'` failed the other way and
     reported a permanent gap that was really a parse problem. Three outcomes,
     not two: it adds up, it does not add up, or it cannot be checked. */
  function reconciliation(view, data) {
    var total = totalMicros(data);
    if (total === null) return null;

    var rows = view.rows || [];
    /* No rows means there is nothing to add up, and "0 rows add up to the
       bill exactly" is a vacuous green on the pane's central claim. Say
       nothing rather than verify nothing. */
    if (!rows.length) return null;
    var sum = 0;
    var unreadable = 0;
    rows.forEach(function (row) {
      var amount = moneyMicros(row);
      if (amount === null) unreadable += 1;
      else sum += amount;
    });

    var box;
    if (unreadable) {
      box = d.callout('warn', 'warn', [
        d.strong('These rows cannot be checked against the bill.'),
        ' ' + (unreadable === 1
          ? 'One row here carries no readable amount'
          : unreadable + ' rows here carry no readable amount') +
          ', so the parts cannot be added up and compared with the billed ' +
          d.money(total, data.currency) + '. Neither a match nor a gap is ' +
          'something this answer supports, so the pane claims neither. Read ' +
          'the grouping as incomplete until every row reports its own figure.'
      ]);
      box.classList.add('mt');
      return box;
    }
    if (sum === total) {
      box = d.callout('info', 'check', [
        d.strong('These rows add up to the bill exactly.'),
        ' ' + d.money(sum, data.currency) + ' across ' + rows.length +
          (rows.length === 1 ? ' row' : ' rows') +
          ', which is the billed total for the period. Nothing is left ' +
          'over and nothing is counted twice.'
      ]);
    } else {
      /* Money renders to a fixed number of decimals, so a gap smaller than the
         last place shown would print three figures that all agree while the
         callout calls them a mismatch. Name the size of the gap in words
         instead of printing a rendered zero.

         The test is the gap against the rendering unit, not the rendered gap
         against a rendered zero. Rendering rounds to nearest, so the string
         test only caught the bottom half of the window: a gap of 6000 micros
         renders as 0.01, so it was named as a printable difference even though
         the two totals it sits between can still round to the same string. Any
         gap below one whole rendering unit is a gap the reader cannot see,
         whichever way the three figures happen to round. */
      var gap = Math.abs(sum - total);
      var gapText = d.money(gap, data.currency);
      if (gap < d.RENDER_UNIT_MICROS) {
        gapText = 'less than the smallest amount these totals can show';
      }
      box = d.callout('crit', 'warn', [
        d.strong('These rows do not add up to the bill.'),
        ' They come to ' + d.money(sum, data.currency) + ' against a billed ' +
          d.money(total, data.currency) + ', a difference of ' + gapText +
          '. Read the rows as incomplete until that is explained.'
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
      /* Through the same fallback the line takes, not through the allowlist
         raw. A key that goes unpainted when a colour is unrecognised, beside a
         line that falls back and is drawn anyway, is a legend that disagrees
         with its own chart. */
      var swatch = h('i', { 'aria-hidden': 'true' });
      swatch.style.setProperty('background', d.seriesStroke(s.color));
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
  /* A link to the last closed period, or null when this pane does not offer
     that window.

     Built through the shell's filter state rather than by hand, so an operator
     on Staging is not silently returned to Production by a link offering them
     a different window. */
  function lastClosedPeriodLink() {
    var ranges = ((shell.panes[PANE_ID] || {}).range) || [];
    if (ranges.indexOf('last-month') === -1) return null;
    var href = d.paneUrl(PANE_ID, { range: 'last-month' });
    if (!href) return null;
    return h('a', { className: 'btn', href: href, text: 'Show the last closed period' });
  }

  function renderNotPublished(data, onRetry) {
    var detail = (data.availability && data.availability.detail) ||
      'The billing export has not published for this period yet.';

    var actions = [];
    var earlier = lastClosedPeriodLink();
    if (earlier) actions.push(earlier);

    /* The export publishes on a cycle, so asking again is a real answer to
       this state rather than the reload it used to need. */
    if (onRetry) {
      var again = h('button', { className: 'btn', type: 'button', text: 'Check again' });
      again.addEventListener('click', onRetry);
      actions.push(again);
    }

    var node = d.stateCard('spend', 'Costs have not published for this period', [
      detail,
      'This is normal in the first hours of a new period. It means not yet ' +
        'known, not nothing spent.'
    ], actions);

    /* Unconditional, because a state that shows no total still has to say when
       it last looked. That rests on asOfLine printing its own fallback
       sentence for a time it was not given, which in turn rests on parseUtc
       treating every non-string, `null` and `0` included, as absent rather
       than as the epoch. A div rather than a p, because the line it returns is
       a flex row.

       Appended INSIDE the card (stateCard returns the outer stack; its first
       child is the card), because the line can carry the Stale badge and a
       badge on the bare page background is the exact contrast pairing this
       page's stylesheet has not fixed. Badges live inside cards here, and
       this is the one state that was violating that. */
    node.firstChild.appendChild(h('div', { className: 'axis-note' }, [asOfLine(data)]));
    return node;
  }

  /* The period was billed in more than one currency, so the route withheld the
     total rather than adding amounts that cannot be added.

     Its own state because neither of the two it used to fall into is true of
     it. "Costs have not published for this period" says this is normal in the
     first hours of a period, and this is not a timing question at all: the
     figures were collected, in full, in two currencies. "Cost reporting is not
     set up" says nothing has been collected, which is the opposite of what
     happened. Both would have sent an operator looking for a fault that is not
     there, and neither says the one thing that is actionable, which is that
     the answer exists and is unaddable.

     The currencies are named in the route's own detail sentence, which is why
     it is rendered rather than summarised: this pane has no currency list of
     its own here, because the response deliberately carries no `currency` when
     there is more than one, and inventing the words "more than one currency"
     without the codes would leave the reader unable to tell which bills these
     were. */
  function renderMixedCurrency(data) {
    var detail = (data.availability && data.availability.detail) ||
      'This period was billed in more than one currency, and the response did ' +
      'not say which. The parts of a bill in different currencies cannot be ' +
      'added together.';

    var actions = [];
    var earlier = lastClosedPeriodLink();
    if (earlier) actions.push(earlier);

    var node = d.stateCard('spend', 'This period was billed in more than one currency', [
      detail,
      'So there is no single total here, and the groupings are not shown ' +
        'either: every one of them is a different way of cutting the same ' +
        'bill, and each would have to add up to a total that does not exist. ' +
        'Adding the parts anyway would produce the one number on this pane ' +
        'that must never be wrong.',
      'Nothing is missing and nothing is a zero. The spending was collected in ' +
        'full. A period billed in a single currency, such as an earlier closed ' +
        'one, shows its total normally.'
    ], actions);

    /* Inside the card, for the same reason the not-published state does it:
       the line can carry the Stale badge, and a badge on the bare page
       background is a contrast pairing this stylesheet has not fixed. */
    node.firstChild.appendChild(h('div', { className: 'axis-note' }, [asOfLine(data)]));
    return node;
  }

  /* -------------------------------------------------------------- render */

  function mount(content) {
    var host = h('div', { className: 'pane' });
    content.appendChild(host);

    var token = 0;

    /* Every state the pane lands in is announced, not only the skeleton. The
       pane replaces its whole subtree on each filter change, so without this a
       screen reader hears "Loading figures" and then silence, including when
       what replaced it was the failure card.

       Focus is carried across the replacement when it was inside the pane.
       "Check again" and "Try again" both repaint, which removes the button
       under the reader's own cursor, and a keyboard reader is then standing at
       the top of the document with no idea the pane answered them. Reading it
       before the subtree goes means the skeleton keeps the claim too, so it
       survives the loading paint and lands on whatever the load resolved to. */
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
      paint(d.loading([120, 260]));

      d.load(source()).then(function (result) {
        if (mine !== token) return;

        var data = (result.data && typeof result.data === 'object') ? result.data : null;
        if (!data) { paint(d.noSource(NOT_REPORTING), NOT_REPORTING.title); return; }

        var state = data.availability && data.availability.state;
        if (state === 'not_published') {
          paint(renderNotPublished(data, refresh), 'Costs have not published for this period');
          return;
        }
        if (state === 'mixed_currency') {
          paint(renderMixedCurrency(data), 'This period was billed in more than one currency');
          return;
        }
        if (state && state !== 'ready') {
          paint(d.stateCard('spend', 'Cost reporting is not set up', [
            (data.availability && data.availability.detail) ||
              'No cost source is configured for this period.',
            'This is a configuration fact, not a reading. A source that was ' +
              'never set up reports nothing, which is not the same as a period ' +
              'that cost nothing.'
          ]), 'Cost reporting is not set up');
          return;
        }

        /* A response with no availability and no billed total is not a ready
           pane. Defaulting the state to ready was how a payload carrying
           nothing became a confident "month to date, $0.00": the most
           confident branch is the wrong default for an answer this pane cannot
           read. The total is what the whole pane hangs off, so its absence is
           the test rather than the presence of any one section. */
        if (totalMicros(data) === null) { paint(d.noSource(NO_TOTAL), NO_TOTAL.title); return; }

        paint(renderReady(data), 'Cost figures updated');
      }).catch(function (err) {
        if (mine !== token) return;
        paint(d.failure(err, {
          title: NOT_REPORTING.title,
          detail: NOT_REPORTING.detail,
          onRetry: refresh
        }), 'Could not load these figures');
      });
    }

    paint(d.loading([120, 260]));
    global.addEventListener('ops:filters', refresh);
  }

  shell.definePane(PANE_ID, mount);
})(window);
