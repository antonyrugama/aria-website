/* Cloud costs, on the v2 pane bootstrap.

   The pane answers what we are paying for, from one read of
   GET /api/ops/costs, and what that is measured against, from a second read
   of GET /api/ops/summary. Neither route was changed to make this pane: the
   bill is the billing export and the target is Azure's own budget record,
   and they arrive on different routes because they are answers to different
   questions. The second read fails soft -- see the budget card.

   Three properties are load bearing here. Each is checked by a test in
   scripts/ops-spend-v2.test.mjs rather than only claimed in this comment:

     1. **The rows add up to the bill, and the page says so.** Every grouping
        the route publishes is a re-sum of the same integer micros over the
        same rows, with no top-N and no dropped tail, so the comparison is
        exact rather than nearly exact. The pane does that arithmetic on
        screen -- sums the rows it drew and prints the result beside the
        billed total -- because a claim nobody can check is not the claim
        this pane is making.
     2. **A figure with no source is words, never a zero.** On a pane about
        money a zero is a claim. The route is explicit that an absent field is
        absent rather than zero, and the pane keeps that distinction.
     3. **Every figure carries how old it is.** Cost data is never live: the
        billing export publishes on a lag, so a figure without its collection
        time is a figure pretending to be current. An old reading is still
        shown rather than replaced by nothing, with its age beside it.

   The App scope control is absent, and the filter bar says so rather than
   leaving a gap: cloud spend is billed per piece of infrastructure, so
   splitting one shared bill by client app would be an invented number. The
   registry owns that decision (`scope: false` with `scopeNote`), and the
   Custom range is absent for a reason the registry also states: this route
   refuses an unbounded range outright, so the option's only outcome would be
   a failure card with a retry that cannot succeed.

   Nothing here uses innerHTML and no style attribute is written into markup.
   Four lengths are computed from the answer -- a share bar's width, a
   gridline label's offset, a date's position and a budget segment's width --
   and all go through CSSOM, which the page's Content-Security-Policy does
   not gate. */
(function (global) {
  'use strict';

  var S = global.OpsPaneShell;
  var h = S.h;
  var fmt = S.fmt;

  var PANE_ID = 'spend';
  var ENDPOINT = '/api/ops/costs';

  /* Where the target comes from, which is NOT this pane's own answer.
     /api/ops/costs is a reading of the billing export and knows nothing about
     what anybody meant to spend. See the budget card below. */
  var SUMMARY_ENDPOINT = '/api/ops/summary';

  /* The fixture key the second read takes, kept apart from the pane's own so
     a local preview can drive the target and the bill independently.
     shell-pane-v2.js reads `ops-pane-fixture-<paneId>` and uses paneId for
     nothing else, so this is a fixture name rather than a second pane. */
  var SUMMARY_FIXTURE_ID = 'spend-budget';

  /* Beyond this the answer is old enough to say so beside the figures rather
     than only in a timestamp. Twice the route's own publish lag, so a normal
     cycle never trips it and a missed one always does. */
  var STALE_MULTIPLE = 2;

  /* Used only when the answer did not carry a usable `publishLagHours`. The
     route sends it on every response, including the ones with no figures, so
     this is a value for an unreadable field rather than a second opinion
     about Azure's publishing cycle. */
  var FALLBACK_LAG_HOURS = 8;

  var NOT_REPORTED = 'Not reported';

  /* Where the figures come from, built at the moment of the call.

     The range has to travel. The cost route defaults an absent range to this
     month, so a pane that sent no querystring would draw this month's bill
     under whatever the bar above it said, with nothing on screen admitting
     the selection had been ignored. */
  function source() {
    return {
      paneId: PANE_ID,
      endpoint: ENDPOINT,
      query: { range: S.filters().range }
    };
  }

  function list(value) { return Array.isArray(value) ? value : []; }

  function num(value) {
    return (typeof value === 'number' && isFinite(value)) ? value : null;
  }

  function text(value) {
    return (typeof value === 'string' && value) ? value : null;
  }

  /* The six series tokens the route cycles through, as the classes this
     pane's stylesheet defines. An unrecognised token is drawn muted rather
     than as a guess at which colour was meant. */
  function toneClass(token) {
    return /^s[1-6]$/.test(token) ? 'sp-' + token : 'sp-muted';
  }

  /* Every figure on this pane is integer micros in the answer's own currency.
     One helper, so the currency cannot be dropped at one call site and kept
     at another. */
  function money(micros, data, digits) {
    return fmt.money(micros, text(data.currency) || 'USD', digits);
  }

  /* A YYYY-MM-DD from the route, as the day it names. The formatters take an
     instant, and a bare date parsed as one is already UTC midnight, so the
     suffix is what stops a browser west of Greenwich printing the day
     before. */
  function day(date) {
    var value = text(date);
    return value ? fmt.utcDay(value + 'T00:00:00.000Z') : null;
  }

  /* --------------------------------------------------------- how old it is

     Two separate facts, and the pane never merges them. `asOf` is when the
     figures were collected. `staleness` is the cost poller's own account of
     whether collection is working at all. An answer collected an hour ago by
     a poller that has failed every run since is fresh and broken at the same
     time, and an operator needs both. */

  function lagHours(data) {
    var lag = num(data.publishLagHours);
    return lag !== null && lag > 0 ? lag : FALLBACK_LAG_HOURS;
  }

  /* The age of the answer, beside the figures rather than under them.

     This is the stale path: when the poller is behind, the number on screen
     is old, and the page says how old next to it instead of serving it as
     current. The threshold is the route's own publish lag doubled, so one
     missed cycle shows and a normal one does not. */
  function freshness(data) {
    var asOf = text(data.asOf);
    var hours = asOf ? fmt.hoursSince(asOf) : null;
    var stamp = asOf ? fmt.utcStamp(asOf) : null;
    if (hours === null || stamp === null) {
      return h('span', { className: 'pill warn' }, [
        S.icon('warn'), h('span', { text: 'Collected at an unreported time' })
      ]);
    }
    if (hours >= lagHours(data) * STALE_MULTIPLE) {
      return h('span', { className: 'pill warn' }, [
        S.icon('warn'),
        h('span', { text: fmt.hours(hours) + ' behind, collected ' + stamp })
      ]);
    }
    return h('span', { className: 'pill' }, [
      S.icon('clock'), h('span', { text: 'Collected ' + stamp })
    ]);
  }

  /* What the poller says about itself, as a word and a glyph rather than a
     colour.

     Only when it is not `ok`: a poller doing its job is already stated by the
     collection time beside it, and a pill repeating it would be that fact
     twice. The route's own `detail` is the sentence, because it is the only
     thing that knows which of the four reasons applies; `ok` is the one state
     that carries no detail, and it is also the one state not drawn here. */
  function pollerNote(data) {
    var staleness = data.staleness || {};
    var state = text(staleness.state);
    if (!state || state === 'ok') return null;
    var detail = text(staleness.detail);
    return h('span', { className: 'pill warn' }, [
      S.icon('warn'),
      h('span', { text: detail || 'Cost collection is ' + state })
    ]);
  }

  /* The part of the period that has a bill behind it.

     Azure publishes on a lag and restates recent days, so a period is almost
     never billed to its own end. Only when the two differ: a period billed in
     full is already stated by the range name, and a pill repeating it would
     be that fact twice. Neutral, not a warning -- a lag is how billing works,
     not a fault. */
  function billedNote(data) {
    var period = data.period || {};
    var billed = num(period.billedDays);
    var inPeriod = num(period.daysInPeriod);
    if (billed === null || inPeriod === null) return null;
    if (billed <= 0 || billed >= inPeriod) return null;
    var through = day(period.actualThrough);
    var words = fmt.int(billed) + ' of ' + fmt.plural(inPeriod, 'day') + ' billed';
    return h('span', { className: 'pill' }, [
      S.icon('history'),
      h('span', { text: through ? words + ', through ' + through : words })
    ]);
  }

  function answerNotes(data) {
    return [freshness(data), pollerNote(data), billedNote(data)]
      .filter(function (node) { return !!node; });
  }

  /* --------------------------------------------------------- the headline */

  /* The window these figures are of, from the answer's own range rather than
     from the filter bar: the two can disagree for one paint while a read is
     in flight, and the figures belong to the answer. */
  var RANGE_LABELS = {
    'month': 'This month to date',
    'last-month': 'Last month',
    '7d': 'Last 7 days',
    '3m': 'Last 3 months',
    '12m': 'Last 12 months'
  };

  function periodLabel(data) {
    var range = text(data.range);
    if (range && Object.prototype.hasOwnProperty.call(RANGE_LABELS, range)) {
      return RANGE_LABELS[range];
    }
    var period = data.period || {};
    var from = day(period.start);
    var to = day(period.endExclusive);
    if (from && to) return from + ' to ' + to;
    return 'This period';
  }

  /* What the period cost, and what it is on course to become.

     The two sit side by side because either alone invites the wrong reaction
     a third of the way into a month: a total that looks small, or a forecast
     with nothing behind it. */
  function headline(data) {
    var card = S.card();
    var body = h('div', { className: 'card-body' });

    var total = num((data.total || {}).micros);
    var head = h('div', { className: 'sp-head' });
    var main = h('div', { className: 'sp-head-main' }, [
      h('h3', { className: 'kpi-label', text: periodLabel(data) })
    ]);

    main.appendChild(total === null
      ? h('div', { className: 'sp-total sp-absent', text: NOT_REPORTED })
      : h('div', { className: 'sp-total', text: money(total, data) }));

    /* The route sends the change and its caption together or not at all, so
       the pane never prints "against the same period last month" with no
       figure beside it to be against. */
    var meta = h('div', { className: 'sp-total-meta' });
    var change = changePill(data.total);
    if (change) meta.appendChild(change);
    var label = text((data.total || {}).comparisonLabel);
    if (label) meta.appendChild(h('span', { text: label }));
    if (meta.childNodes.length) main.appendChild(meta);
    head.appendChild(main);

    var forecast = forecastBlock(data);
    if (forecast) head.appendChild(forecast);
    body.appendChild(head);
    card.appendChild(body);

    /* The forecast's own basis is the route's sentence and appears nowhere
       else on the page, so it survives the trim. A closed period carries no
       forecast, and then there is no foot either. */
    var basis = text((data.forecast || {}).basis);
    if (basis) {
      card.appendChild(h('div', { className: 'kpi-foot' }, [h('span', { text: basis })]));
    }
    return card;
  }

  /* Up is the bad direction on a bill, which is why the tone classes read
     backwards here: `.pill.down` is this design system's rose and `.pill.up`
     its emerald, so a rise takes the rose one. The chevron and the sign both
     carry the direction, so tone is never the only thing saying it. */
  function changePill(carrier) {
    var change = num((carrier || {}).changeBasisPoints);
    if (change === null) return null;
    if (change === 0) {
      return h('span', { className: 'pill' }, [h('span', { text: 'No change' })]);
    }
    var up = change > 0;
    return h('span', { className: 'pill ' + (up ? 'down' : 'up') }, [
      S.icon(up ? 'up' : 'down'),
      h('span', { text: fmt.signedPercent(change) })
    ]);
  }

  function forecastBlock(data) {
    var forecast = num((data.forecast || {}).micros);
    if (forecast === null) return null;
    return h('div', { className: 'sp-fore' }, [
      h('div', { className: 'sp-fore-label', text: 'Forecast to period end' }),
      h('div', { className: 'sp-fore-value', text: money(forecast, data) })
    ]);
  }

  /* ------------------------------------------------- spend against a target

     The one figure on this pane that is not a reading of the bill. A budget
     is what somebody meant to spend, and Azure keeps it as its own
     Microsoft.Consumption record; /api/ops/costs is the billing export and
     knows nothing about it. It reaches a client on /api/ops/summary instead
     (Stadiora/Aria#7370 publishes it, #10779 is this drawing of it), so this
     card is a SECOND read, made beside the first rather than after it: the
     pane is about the bill, and a target nobody could read must never delay
     or replace the figures it would be measured against.

     Three states, and the difference between the last two is the whole point:

       a target was read       the card draws it, at its real size
       the route refused one   the card says WHICH refusal, in the route's
                               own words, and draws no track at all
       the read itself failed  no card, because a failed request is not a
                               statement about whether a budget exists

     An empty track reads as a budget with nothing spent against it and a full
     one as a budget already gone, so an absent target draws neither. Same
     absent-versus-zero rule the rest of this pane keeps. */

  /* What the summary says it could not answer, by key. The route sends a
     reason per omission and the sentence is its own, because it is the only
     thing that knows which of the seven refusals applies. */
  function omissionDetail(summary, key) {
    var found = null;
    list(summary.omissions).forEach(function (entry) {
      if (found === null && entry && text(entry.key) === key) found = entry;
    });
    if (!found) return null;
    return text(found.detail) || text(found.title) || null;
  }

  /* The published ratio is read, never recomputed. The route divides spend by
     target itself and says so unclamped -- 31524 basis points, not 10000 --
     and a second division here would be a second opinion about the same pair
     that drifts from it by a rounding. A target of zero or less never reaches
     this: the route filters to strictly positive amounts before dividing. */
  function budgetState(summary) {
    if (!summary) return null;
    var cost = summary.cost || {};
    var budget = cost.budget;
    var spend = num(cost.micros);
    var target = budget ? num(budget.micros) : null;
    var ratio = budget ? num(budget.ratioBasisPoints) : null;
    /* The target's OWN stated denomination, and nothing else. Azure states no
       currency on a budget amount -- the only denomination in its response
       rides on the accrued spend -- so a budget that has never accrued any
       arrives with an amount and nothing saying what the amount is in. The
       route refuses that budget rather than drawing it (`unknown_currency`),
       and borrowing this window's billing currency here would put the
       refusal back: a target read as the currency the bill happens to be in
       is an invented denomination, drawn as confidently as a real one and
       wrong by whatever the exchange rate is. A made-up denomination is
       worse than a made-up number, because it looks authoritative. */
    var denomination = budget ? text(budget.currency) : null;

    if (budget && spend !== null && target !== null && target > 0 && ratio !== null
      && denomination) {
      return {
        drawn: true,
        spend: spend,
        target: target,
        ratio: ratio,
        money: { currency: denomination },
        window: cost.window || {}
      };
    }

    /* A payload that names a budget it cannot describe is contradicting
       itself, and the reason it gives is the more trustworthy half. */
    var refusal = omissionDetail(summary, 'budget');
    return refusal ? { drawn: false, detail: refusal } : null;
  }

  var AT_TARGET = 10000;

  /* The track's scale, stated once and used by every part of the drawing:

       domain = max(AT_TARGET, ratio)
       used   = min(ratio, AT_TARGET) / domain   of the track
       over   = (ratio - AT_TARGET) / domain     of the track, when positive

     so the target sits at AT_TARGET/domain of the width -- the track's own
     end while spend is under it, travelling left as spend runs past it. That
     is what the track does past 100%: it keeps the target as a position
     inside itself rather than pinning the fill at the end, because a bar
     pinned at full cannot be told apart from one exactly on target, which is
     the failure this card exists to avoid. Under target the same arithmetic
     is the approved mock's drawing exactly: domain AT_TARGET, one fill, the
     target at the track's end.

     The BAR is clamped by this scale; the number never is. The ratio is
     printed at its real size whatever the track does with it. */
  function trackShare(part, ratio) {
    var domain = Math.max(AT_TARGET, ratio);
    return (Math.max(0, part) / domain * 100).toFixed(2) + '%';
  }

  function budgetTrack(state) {
    var over = state.ratio > AT_TARGET;
    var track = h('div', {
      className: 'sp-budget' + (over ? ' sp-budget-over' : ''),
      'aria-hidden': 'true'
    });

    /* Decorative BY DECISION, like the gauge in aria.js: every fact this
       track encodes -- the ratio, the target, the overrun, the window -- is
       real text in this same card, so naming the bar as well would announce
       each of them twice. It also carries no text of its own, which is what
       keeps the over-target segment free to be a hatch: text on a hatch is
       measured against the WORST stripe, and that pair is already one
       contrast failure on this design system (Stadiora/Aria#10366). */
    track.appendChild(segment('sp-bud-used', trackShare(Math.min(state.ratio, AT_TARGET), state.ratio)));
    if (over) {
      track.appendChild(segment('sp-bud-over', trackShare(state.ratio - AT_TARGET, state.ratio)));
    }
    return track;
  }

  function segment(className, width) {
    var fill = h('i', { className: className });
    fill.style.setProperty('width', width);
    return fill;
  }

  /* Over target is a word here, never only a tone: check-ops-contrast.mjs
     judges both themes and this repo's answer where colour IS the data is a
     label chip with words in it. */
  function budgetPill(ratio) {
    if (ratio > AT_TARGET) {
      return h('span', { className: 'pill down' }, [
        S.icon('warn'), h('span', { text: 'Over target' })
      ]);
    }
    return h('span', { className: 'pill' }, [
      h('span', { text: ratio === AT_TARGET ? 'At target' : 'Within target' })
    ]);
  }

  /* Past twice the target a percentage stops reading as a proportion -- 315%
     is a multiple written the long way -- so the figure changes unit at the
     line the card is about. The caption below it carries the word either way,
     so the glyph is punctuation for a word a reader also hears rather than
     the only thing saying it. */
  function budgetFigure(ratio) {
    if (ratio > AT_TARGET) return (ratio / AT_TARGET).toFixed(2) + '\u00D7';
    return fmt.percent(ratio);
  }

  function budgetWindow(state) {
    var from = day(state.window.start);
    var to = day(state.window.actualThrough) || day(state.window.endExclusive);
    if (from && to) return from + ' to ' + to;
    return from ? 'from ' + from : null;
  }

  function budgetCard(summary) {
    var state = budgetState(summary);
    if (!state) return null;

    var card = S.card();
    card.appendChild(S.cardHead('Against the monthly target'));
    var body = h('div', { className: 'card-body' });

    /* The refusal, in the route's own words and with no track under it. */
    if (!state.drawn) {
      body.appendChild(h('div', { className: 'sp-bud-none sp-absent', text: 'No target to draw against' }));
      body.appendChild(h('div', { className: 'sp-bud-why', text: state.detail }));
      card.appendChild(body);
      return card;
    }

    var over = state.ratio > AT_TARGET;
    var head = h('div', { className: 'sp-bud-head' }, [
      h('div', { className: 'sp-bud-main' }, [
        h('div', { className: 'sp-bud-figure sp-num', text: budgetFigure(state.ratio) }),
        h('div', {
          className: 'sp-bud-of',
          text: (over ? 'times the ' : 'of the ') + money(state.target, state.money)
            + ' monthly target'
        })
      ]),
      budgetPill(state.ratio)
    ]);
    body.appendChild(head);
    body.appendChild(budgetTrack(state));

    /* The two ends of the same subtraction, each printed once: what has been
       spent, and what that leaves. Money rather than a second percentage,
       because the figure above is already the proportion. */
    var when = budgetWindow(state);
    var spent = money(state.spend, state.money) + ' spent';
    body.appendChild(h('div', { className: 'sp-bud-foot' }, [
      h('span', { className: 'sp-num', text: when ? spent + ', ' + when : spent }),
      h('span', {
        className: 'sp-num sp-bud-rest' + (over ? ' sp-bud-past' : ''),
        text: over
          ? money(state.spend - state.target, state.money) + ' over'
          : money(state.target - state.spend, state.money) + ' left'
      })
    ]));

    card.appendChild(body);
    return card;
  }

  /* -------------------------------------------------- the allocation views

     One bill, cut two ways by allocation: what the money was for, and which
     Azure group it was billed to. The switch says which cut is on screen and
     the reconciliation line under the rows says it still adds up to the same
     bill.

     `service` is deliberately NOT here. The route sends it as a third view of
     the same rows, and the per-service table below draws exactly those rows:
     offering it in the switch as well drew two cards with the same title, the
     same rows and the same reconciliation line, which is the one thing this
     remodel exists to remove. The table is the better drawing of it -- Azure
     names a service, so the column wants a row header and a scroll, not a
     share bar -- so the table keeps it and the switch does not. */

  var VIEW_ORDER = ['category', 'resourceGroup'];

  /* The grouping the pane opens on. Category first because it answers what
     the money was for, which is the question the pane's own name asks. */
  var DEFAULT_VIEW = 'category';

  /* Short words for the switch. A button carrying the route's own `label`
     -- "What the money was spent on" -- wraps onto three lines at 320px. */
  var VIEW_BUTTON = {
    category: 'Category',
    resourceGroup: 'Resource group'
  };

  /* What a row of each grouping IS, so its reconciliation line names the
     things it is adding up. Two cards on one page both ending in "5 rows
     adding up to the bill" is one sentence printed twice; "5 categories" and
     "12 services" are two facts. */
  var VIEW_NOUN = {
    category: ['category', 'categories'],
    resourceGroup: ['resource group'],
    service: ['service']
  };
  var ROW_NOUN = ['row'];

  function availableViews(data) {
    var views = data.views || {};
    return VIEW_ORDER.filter(function (key) {
      return views[key] && list(views[key].rows).length > 0;
    });
  }

  /* aria-pressed rather than two links: the switch changes what the card
     below it says without navigating, and which one is on has to reach a
     screen reader as state, not as a colour. */
  function viewSwitch(keys, current, onPick) {
    var row = h('div', {
      className: 'sp-views', role: 'group', 'aria-label': 'Group the bill by'
    });
    keys.forEach(function (key) {
      var on = key === current;
      var button = h('button', {
        className: 'btn btn-sm' + (on ? ' btn-primary' : ''),
        type: 'button',
        'aria-pressed': on ? 'true' : 'false',
        text: VIEW_BUTTON[key] || key
      });
      button.setAttribute('data-view', key);
      button.addEventListener('click', function () { onPick(key); });
      row.appendChild(button);
    });
    return row;
  }

  /* One grouping of the bill, as rows with a share bar each.

     The bar carries no label and is hidden from assistive technology: the
     share it draws is printed as a figure in the same row, and a meter that
     repeats a number printed beside it is the same fact twice. */
  function viewCard(data, key, keys, onPick) {
    var view = (data.views || {})[key] || {};
    var rows = list(view.rows);
    var card = S.card();
    card.appendChild(S.cardHead(
      text(view.label) || 'The bill',
      text(view.hint),
      keys.length > 1 ? [viewSwitch(keys, key, onPick)] : null
    ));

    var wrap = h('div', { className: 'sp-rows' });
    rows.forEach(function (row) { wrap.appendChild(billRow(row, data)); });
    card.appendChild(h('div', { className: 'card-body' }, [
      wrap, reconciliation(rows, data, VIEW_NOUN[key] || ROW_NOUN)
    ]));
    return card;
  }

  function billRow(row, data) {
    var micros = num(row.micros);
    var share = num(row.shareBasisPoints);
    var ungrouped = row.ungrouped === true;

    var words = h('div', {}, [
      h('div', { className: 'sp-name', text: text(row.label) || 'Not named' })
    ]);
    /* A row the category mapping has never seen. Its own line with its own
       words on it: the route sends it as an explicit category precisely so
       the bill still adds up, and folding it into a neighbour would hide the
       one row somebody has to go and map. */
    if (ungrouped) {
      words.appendChild(h('div', {
        className: 'sp-desc',
        text: 'Unmapped: no category covers these services yet'
      }));
    } else {
      var desc = text(row.description);
      if (desc) words.appendChild(h('div', { className: 'sp-desc', text: desc }));
    }
    if (share !== null) {
      var meter = h('div', { className: 'meter sp-bar', 'aria-hidden': 'true' }, [h('i')]);
      meter.firstChild.style.setProperty('width', barWidth(share));
      words.appendChild(meter);
    }

    var moneyCell = h('div', { className: 'sp-money' }, [
      micros === null
        ? h('div', { className: 'sp-amt sp-absent', text: NOT_REPORTED })
        : h('div', { className: 'sp-amt sp-num', text: money(micros, data) })
    ]);
    if (share !== null) {
      moneyCell.appendChild(h('div', {
        className: 'sp-share sp-num', text: fmt.percent(share)
      }));
    }

    var change = h('div', { className: 'sp-chg' });
    var pill = changePill(row);
    if (pill) change.appendChild(pill);

    return h('div', {
      className: 'sp-row ' + toneClass(text(row.color)) +
        (ungrouped ? ' sp-row-ungrouped' : '')
    }, [
      h('span', { className: 'sp-mark', 'aria-hidden': 'true' }),
      words,
      moneyCell,
      change
    ]);
  }

  /* A share as a CSS length, clamped to the track. A negative or over-100
     share is a shape the route cannot send, and drawing one would take the
     bar out of its own card. */
  function barWidth(basisPoints) {
    return Math.max(0, Math.min(100, basisPoints / 100)).toFixed(2) + '%';
  }

  /* The pane's central claim, done as arithmetic on screen.

     The route counts every row in the window exactly once with no top-N and
     no dropped tail, so a grouping's rows sum to the billed total exactly.
     That is what makes it safe to switch grouping mid-conversation, and it is
     the one thing on this pane worth checking rather than asserting. The sum
     is taken from the rows this card actually drew, so a row the pane itself
     dropped shows up here as a gap instead of passing quietly.

     A gap is stated as a figure, with a glyph and words beside it: never a
     colour alone. */
  function reconciliation(rows, data, noun) {
    var one = (noun || ROW_NOUN)[0];
    var many = (noun || ROW_NOUN)[1];
    var total = num((data.total || {}).micros);
    var summed = 0;
    var unreadable = false;
    rows.forEach(function (row) {
      var micros = num(row.micros);
      if (micros === null) unreadable = true;
      else summed += micros;
    });

    if (total === null || unreadable) {
      return h('div', { className: 'sp-recon sp-recon-off' }, [
        S.icon('warn'),
        h('span', {
          className: 'sp-recon-gap',
          text: unreadable
            ? 'One of these rows carries no figure, so they cannot be added up'
            : 'This answer carried no billed total to check these rows against'
        })
      ]);
    }

    var gap = summed - total;
    if (gap === 0) {
      return h('div', { className: 'sp-recon sp-recon-ok' }, [
        S.icon('check'),
        h('span', {
          className: 'sp-recon-gap',
          text: fmt.plural(rows.length, one, many) + ' adding up to the bill'
        }),
        h('span', { className: 'sp-recon-total sp-num', text: money(total, data) })
      ]);
    }

    return h('div', { className: 'sp-recon sp-recon-off' }, [
      S.icon('warn'),
      h('span', {
        className: 'sp-recon-gap',
        text: fmt.plural(rows.length, one, many) + ' adding up to ' + money(summed, data) +
          ', ' + money(Math.abs(gap), data) +
          (gap > 0 ? ' more than' : ' short of') + ' the bill'
      }),
      h('span', { className: 'sp-recon-total sp-num', text: money(total, data) })
    ]);
  }

  /* --------------------------------------------------------- the day line */

  var CHART_W = 640;
  var CHART_H = 220;
  var PAD_L = 6;
  var PAD_R = 6;
  var PAD_T = 10;
  var PAD_B = 10;

  function svgEl(tag, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  function dailyCard(data) {
    var daily = data.daily || {};
    var series = list(daily.series).filter(function (one) {
      return list(one.values).length > 0;
    });
    if (!series.length) return null;

    var card = S.card();
    card.appendChild(S.cardHead(
      text(daily.label) || 'Daily spend',
      text(daily.hint),
      [legend(series)]
    ));

    var plot = chart(series, daily, data);
    var body = h('div', { className: 'card-body' }, [plot.node]);
    var axis = xAxis(daily, data, plot);
    if (axis) body.appendChild(axis);
    card.appendChild(body);

    /* The route's own note, and only when it sent one. It says either that
       there is no comparison line and why, or that the two stretches are
       different lengths -- both facts that appear nowhere else on the page
       and that change how the picture should be read. */
    var note = text(daily.note);
    if (note) {
      card.appendChild(h('div', { className: 'kpi-foot' }, [h('span', { text: note })]));
    }
    return card;
  }

  function legend(series) {
    var row = h('div', { className: 'legend' });
    series.forEach(function (one) {
      row.appendChild(h('span', { className: toneClass(text(one.color)) }, [
        h('i', { 'aria-hidden': 'true' }),
        h('span', { text: text(one.label) || 'Series' })
      ]));
    });
    return row;
  }

  function chart(series, daily, data) {
    var iw = CHART_W - PAD_L - PAD_R;
    var ih = CHART_H - PAD_T - PAD_B;

    var hi = 0;
    var span = 0;
    series.forEach(function (one) {
      var values = list(one.values);
      if (values.length > span) span = values.length;
      values.forEach(function (v) {
        var n = num(v);
        if (n !== null && n > hi) hi = n;
      });
    });
    hi = hi * 1.14 || 1;

    /* The one x scale on this card. Both lines are drawn through it and the
       date strip under the drawing is positioned through it, because two
       derivations of the same scale is how a label ends up over the wrong day
       (Stadiora/Aria#10507). */
    var xAt = function (index) {
      return PAD_L + (span > 1 ? (index / (span - 1)) * iw : iw / 2);
    };

    /* Stretched to the box rather than scaled to its own aspect, so the
       drawing is as tall on a phone as it is on a laptop and the gridlines
       keep the spacing the labels beside them are set in. Every stroke in
       here carries non-scaling-stroke in CSS, which is what keeps a line 2px
       wide and a dash pattern square under a scale that differs by axis. */
    var svg = svgEl('svg', {
      'class': 'chart',
      viewBox: '0 0 ' + CHART_W + ' ' + CHART_H,
      preserveAspectRatio: 'none',
      role: 'img',
      'aria-label': chartName(series, daily, data)
    });

    /* The scale is HTML beside the picture rather than <text> inside it, for
       two reasons that both matter. The svg is stretched to the width of the
       card, so text inside it is stretched with it; and role="img" is
       children-presentational, so text inside one is announced to nobody
       however large it is. Out here it is real text at a real size,
       positioned against the same gridlines. */
    var axis = h('div', { className: 'sp-axis', 'aria-hidden': 'true' });
    var ticks = 4;
    for (var i = 0; i <= ticks; i++) {
      var y = PAD_T + ih - (i / ticks) * ih;
      var gridline = svgEl('line', {
        'class': 'sp-gridline', x1: PAD_L, y1: y.toFixed(1), x2: CHART_W - PAD_R, y2: y.toFixed(1)
      });
      if (i !== 0) gridline.setAttribute('stroke-dasharray', '2 4');
      svg.appendChild(gridline);

      /* Whole currency units on the scale. Cents on a gridline are four more
         characters for a precision the drawing does not have. */
      var label = h('span', {
        className: 'sp-tick sp-num',
        text: money(Math.round(hi * i / ticks), data, 0)
      });
      /* The gridline's own height in the viewBox, as a percentage. The scale
         column is the height of the drawing beside it, so the two stay
         registered at every width without measuring anything. */
      label.style.setProperty('top', ((y / CHART_H) * 100).toFixed(2) + '%');
      axis.appendChild(label);
    }

    series.forEach(function (one) {
      /* The stretch keys the group, so which line is this period and which is
         the one before it is a fact in the document rather than only a dash
         pattern. */
      var group = svgEl('g', {
        'class': toneClass(text(one.color)),
        'data-series': text(one.label) || ''
      });
      var values = list(one.values);
      var dashed = one.dashed === true;
      var y2 = function (v) { return PAD_T + ih - (v / hi) * ih; };

      var run = [];
      var flush = function () {
        if (run.length > 1) {
          group.appendChild(svgEl('path', {
            'class': 'sp-ln' + (dashed ? ' sp-ln-prev' : ''),
            d: run.map(function (point, index) {
              return (index ? 'L' : 'M') + point[0].toFixed(2) + ' ' + point[1].toFixed(2);
            }).join(' ')
          }));
        } else if (run.length === 1) {
          /* A single billed day between two gaps has no line to belong to,
             and drawing nothing for it would hide a day that was billed. A
             zero-length path with a round cap rather than a circle: the
             drawing is stretched to its box, and a circle would be drawn as
             an ellipse while a stroke cap stays round. */
          group.appendChild(svgEl('path', {
            'class': 'sp-ln-pt' + (dashed ? ' sp-ln-prev' : ''),
            d: 'M' + run[0][0].toFixed(2) + ' ' + run[0][1].toFixed(2) +
              'L' + run[0][0].toFixed(2) + ' ' + run[0][1].toFixed(2)
          }));
        }
        run = [];
      };

      values.forEach(function (v, index) {
        var n = num(v);
        if (n === null) { flush(); return; }
        run.push([xAt(index), y2(n)]);
      });
      flush();
      svg.appendChild(group);
    });

    return {
      node: h('div', { className: 'sp-chart-wrap' }, [axis, svg]),
      span: span,
      /* Where a day sits across the drawing, as a percentage of the drawing's
         own width. The svg is stretched to its box by
         preserveAspectRatio="none", so a viewBox x is exactly that fraction
         of the rendered width however wide the card is. */
      left: function (index) {
        return ((xAt(index) / CHART_W) * 100).toFixed(3) + '%';
      }
    };
  }

  /* --------------------------------------------------------- the date strip

     The dates under the drawing, each over the day it names.

     The route strides them -- every Nth day, never every day -- and sends
     them as bare formatted dates with no index (opsPanesRouter.ts,
     buildDailySeries). So a label's position is NOT its place in the list:
     over three months the six labels name days 0, 15, 30, 45, 60 and 75 of
     89, and the last one belongs three quarters of the way across rather than
     at the right-hand end. This strip was a `justify-content: space-between`
     row until Stadiora/Aria#10507, which put every label after the first over
     a day it does not name, by up to 14.3% of the plot.

     Recovering the stride arithmetically would mean re-deriving the route's
     own MAX_DAILY_LABELS here, which this file cannot see and which would go
     wrong SILENTLY the day the route changes it. So each label is matched
     back to the day it names instead: the window start is in the answer, and
     formatting every day in the window the way the route formats them says
     which day each label is. That is a duplication of the route's FORMAT
     rather than of its striding, and the two fail differently -- a wrong
     stride draws a label over the wrong day, a wrong format matches nothing
     and the strip falls back to a plain list of dates that claims no
     position at all. */

  var DAY_MS = 86400000;

  function dayNamer() {
    try {
      return new Intl.DateTimeFormat('en-US', {
        day: 'numeric', month: 'short', timeZone: 'UTC'
      });
    } catch (e) {
      return null;
    }
  }

  function squash(value) { return String(value).replace(/\s+/g, ' ').trim(); }

  /* The day index each label names, or null when any one of them cannot be
     placed. All or nothing on purpose: a strip where some dates are over
     their day and some are wherever they landed is harder to read than one
     that never claims a position. */
  function labelDays(labels, data, span) {
    var start = text((data.period || {}).start);
    var namer = start ? dayNamer() : null;
    if (!namer) return null;
    var base = Date.parse(start + 'T00:00:00.000Z');
    if (!isFinite(base) || !(span > 0)) return null;

    /* Prefixed so a date can never collide with a property already on a plain
       object, and -1 for a spelling two days in the window share -- a window
       longer than a year has two "Sep 6" in it and neither is knowable. */
    var days = {};
    var i;
    var key;
    for (i = 0; i < span; i++) {
      key = 'd:' + squash(namer.format(new Date(base + i * DAY_MS)));
      days[key] = Object.prototype.hasOwnProperty.call(days, key) ? -1 : i;
    }

    var placed = [];
    for (i = 0; i < labels.length; i++) {
      key = 'd:' + squash(labels[i]);
      var index = Object.prototype.hasOwnProperty.call(days, key) ? days[key] : -1;
      if (index < 0) return null;
      placed.push(index);
    }
    return placed;
  }

  function xAxis(daily, data, plot) {
    var labels = list(daily.labels).filter(function (one) { return text(one); });
    if (!labels.length) return null;

    var placed = labelDays(labels, data, plot.span);
    var strip = h('div', {
      className: placed ? 'sp-xaxis' : 'sp-xaxis sp-xaxis-loose'
    });
    labels.forEach(function (one, index) {
      var cell = h('span', { text: one });
      /* CSSOM rather than a style attribute: the page's Content-Security-
         Policy has no 'unsafe-inline', and this is the same route the
         gridline labels take. */
      if (placed) cell.style.setProperty('left', plot.left(placed[index]));
      strip.appendChild(cell);
    });

    /* The strip is the second cell of a flex row whose first cell is the
       width of the drawing's own y-axis gutter, so it is exactly as wide as
       the drawing above it and a percentage inside it is that percentage of
       the plot -- without measuring either box. */
    return h('div', { className: 'sp-xaxis-row', 'aria-hidden': 'true' }, [
      h('div', { className: 'sp-xaxis-gutter' }),
      strip
    ]);
  }

  /* The chart's accessible name, and the only place its data is announced.

     role="img" is children-presentational, so <text> inside the drawing is
     announced to nobody and the name is the whole of what a screen reader
     gets. Each line therefore says how many of its days carry a figure, its
     low and high and what it ended at. A line with no billed day at all says
     that rather than being left out of the name. */
  function chartName(series, daily, data) {
    return (text(daily.label) || 'Daily spend') + '. ' +
      series.map(function (one) { return seriesSentence(one, data); }).join(' ');
  }

  function seriesSentence(one, data) {
    var name = text(one.label) || 'This period';
    var values = list(one.values);
    var billed = [];
    var lastIndex = -1;
    values.forEach(function (v, index) {
      var n = num(v);
      if (n === null) return;
      billed.push(n);
      lastIndex = index;
    });

    if (!billed.length) {
      return name + ': no billed day in ' + fmt.plural(values.length, 'day') + '.';
    }
    var lo = Math.min.apply(null, billed);
    var high = Math.max.apply(null, billed);
    return name + ': ' + fmt.int(billed.length) + ' of ' +
      fmt.plural(values.length, 'day') + ' billed, ' +
      (lo === high
        ? 'flat at ' + money(lo, data)
        : 'low ' + money(lo, data) + ', high ' + money(high, data)) +
      ', ending ' + money(values[lastIndex], data) + '.';
  }

  /* ---------------------------------------------------- the service table */

  /* Every service Azure billed, biggest first, in the route's own order.

     A table rather than more rows with bars: at this length the share is not
     the question, the name and the figure are, and forty bars is a picture of
     a long tail nobody reads. The reconciliation line is here too, because
     this grouping adds up to the same bill and that is the claim. */
  function serviceCard(data) {
    var view = (data.views || {}).service || {};
    var rows = list(view.rows);
    if (!rows.length) return null;

    var card = S.card();
    card.appendChild(S.cardHead(
      text(view.label) || 'By service',
      text(view.hint)
    ));

    var table = h('table', { className: 'sp-tbl' });
    table.appendChild(h('thead', {}, [h('tr', {}, [
      h('th', { scope: 'col', text: 'Service' }),
      h('th', { scope: 'col', className: 'sp-r', text: 'Cost' }),
      h('th', { scope: 'col', className: 'sp-r', text: 'Share' }),
      h('th', { scope: 'col', className: 'sp-r', text: 'Change' })
    ])]));

    var body = h('tbody');
    rows.forEach(function (row) {
      var micros = num(row.micros);
      var share = num(row.shareBasisPoints);
      var change = h('td', { className: 'sp-r' });
      var pill = changePill(row);
      /* No change figure is not a flat month: the route withholds it when
         the previous stretch billed nothing to compare against. */
      change.appendChild(pill || h('span', { className: 'sp-absent', text: NOT_REPORTED }));

      body.appendChild(h('tr', {}, [
        h('th', { scope: 'row', text: text(row.label) || 'Not named' }),
        h('td', {
          className: 'sp-r ' + (micros === null ? 'sp-absent' : 'sp-num'),
          text: micros === null ? NOT_REPORTED : money(micros, data)
        }),
        h('td', {
          className: 'sp-r ' + (share === null ? 'sp-absent' : 'sp-num'),
          text: share === null ? NOT_REPORTED : fmt.percent(share)
        }),
        change
      ]));
    });
    table.appendChild(body);

    /* The box scrolls sideways on a phone and what it hides is a column, not
       a margin: measured at 320px it is 314 wide inside 256, with the whole
       Change column past the visible edge. So it is reachable from a keyboard
       and it says which table it is -- a scroll region a keyboard cannot get
       to fails WCAG 2.1.1, and Chrome's own tab-ordering of overflowing
       scrollers is both engine-specific and nameless. Same treatment as the
       Analytics, Evaluations, Releases and Settings panes give their wide
       tables. */
    card.appendChild(h('div', { className: 'card-body' }, [
      h('div', {
        className: 'sp-scroll',
        tabindex: '0',
        role: 'region',
        'aria-label': text(view.label) || 'By service'
      }, [table]),
      reconciliation(rows, data, VIEW_NOUN.service)
    ]));
    return card;
  }

  /* ---------------------------------------------------------- the states */

  function emptyCard(block) {
    var card = S.card();
    card.appendChild(block);
    return card;
  }

  /* Nothing billed, and which of the four reasons it is decides what the pane
     says. The route's own `detail` is the sentence in every case, because it
     is the only thing that knows; the title is the pane's, because these are
     four different states and a title is how a state is named. */
  var EMPTY_STATES = {
    not_published: {
      icon: 'clock',
      title: 'Nothing published for this period yet',
      fallback: 'The billing export has not published anything for this period.'
    },
    unconfigured: {
      icon: 'plug',
      title: 'Cost collection is not set up',
      fallback: 'No subscription is configured for cost collection.'
    },
    disabled: {
      icon: 'x',
      title: 'Cost collection is switched off',
      fallback: 'Cost collection is switched off for every subscription.'
    },
    mixed_currency: {
      icon: 'warn',
      title: 'Billed in more than one currency',
      fallback: 'There is no single total to show, and the groupings cannot be added together.'
    }
  };

  function notReady(data, region) {
    var availability = data.availability || {};
    var state = text(availability.state);
    var known = state && Object.prototype.hasOwnProperty.call(EMPTY_STATES, state)
      ? EMPTY_STATES[state]
      : null;
    var detail = text(availability.detail);

    if (!known) {
      /* A state outside the route's vocabulary is not read as one of the
         four. Picking the nearest would draw a guess with the same confidence
         as a fact. */
      region.empty(emptyCard(S.stateBlock('warn', 'This answer is not one this pane can read', [
        detail || 'The cost route answered with a state this pane does not recognise, ' +
          'so nothing here can be read as this period\u2019s bill.'
      ])));
      return;
    }

    var block = S.stateBlock(known.icon, known.title, [detail || known.fallback]);
    /* A closed month is the one window that is always fully published, so it
       answers "is anything arriving at all" when this period's is not. Only
       offered from a range that is not already it. */
    if (state === 'not_published' && S.filters().range !== 'last-month') {
      block.appendChild(h('div', { className: 'row mt-sm' }, [
        S.link(hrefWith('range', 'last-month'), 'Try last month')
      ]));
    }
    region.empty(emptyCard(block));
  }

  /* A link to this pane under one changed filter, built from the shell's own
     href so the rest of the selection travels with it. */
  function hrefWith(key, value) {
    var href = S.paneHref(PANE_ID);
    var url;
    try {
      url = new global.URL(href, global.location.href);
    } catch (e) {
      return href;
    }
    url.searchParams.set(key, value);
    return url.pathname + url.search;
  }

  /* ---------------------------------------------------------- the render */

  function cannotAnswerBand() {
    var section = S.band('What this pane cannot answer yet',
      'Named rather than drawn as an empty figure');
    var box = S.card();
    var body = h('div', { className: 'card-body omit' });
    var item = h('div', { className: 'omit-item' });
    item.appendChild(S.icon('empty'));
    var words = h('div');
    words.appendChild(h('div', { className: 'omit-title', text: 'Anything unusual' }));
    words.appendChild(h('div', { className: 'omit-desc' }, [
      h('span', { text: 'Problems watches unusual service spend with the service_cost_anomaly rule and links those problems here. This pane draws the cost breakdown, but it does not draw the anomaly list yet. Open ' }),
      h('a', { href: S.paneHref('alerts') || 'alerts.html', text: 'Problems' }),
      h('span', { text: ' for the live cost-anomaly rule.' })
    ]));
    item.appendChild(words);
    body.appendChild(item);
    box.appendChild(body);
    section.appendChild(box);
    return section;
  }

  function render(data, summary, viewKey, onPick) {
    var wrap = h('div', { className: 'stack' });

    var first = S.band('What this period cost', null, answerNotes(data));
    first.appendChild(headline(data));
    var budget = budgetCard(summary);
    if (budget) first.appendChild(budget);
    wrap.appendChild(first);

    var keys = availableViews(data);
    if (keys.length) {
      var key = keys.indexOf(viewKey) === -1 ? keys[0] : viewKey;
      var second = S.band('Where the money goes');
      second.appendChild(viewCard(data, key, keys, onPick));
      wrap.appendChild(second);
    }

    var line = dailyCard(data);
    var services = serviceCard(data);
    if (line || services) {
      var third = S.band('Day by day, and what Azure calls it');
      if (line) third.appendChild(line);
      if (services) third.appendChild(services);
      wrap.appendChild(third);
    }
    wrap.appendChild(cannotAnswerBand());
    return wrap;
  }

  S.definePane(PANE_ID, function (content) {
    var region = S.region(content);
    var inFlight = 0;
    var latest = null;
    var latestSummary = null;
    var viewKey = DEFAULT_VIEW;

    function skeleton() {
      region.loading([
        { type: 'block', height: 120 },
        { type: 'rows', count: 5 },
        { type: 'block', height: 240 }
      ]);
    }

    /* Switching grouping redraws from the answer already in hand rather than
       re-reading: it is two cuts of one bill, so a second request would
       fetch the same bytes and put a skeleton over a question the page has
       already answered. */
    function pick(key) {
      viewKey = key;
      if (!latest) return;

      /* The button that was just pressed is destroyed by the redraw below, so
         a keyboard operator would be dropped to the top of the document on
         every switch -- past the skip link, the rail and the filter bar --
         for the pane's only interactive control. Only when focus WAS on the
         switch: a pointer user has focus nowhere in particular and moving it
         there would be a jump they did not ask for. */
      var host = document.getElementById('content');
      var live = document.activeElement;
      var wasOnSwitch = !!(live && live.getAttribute
        && live.getAttribute('data-view') !== null);

      region.show(render(latest, latestSummary, viewKey, pick));

      if (wasOnSwitch && host) {
        var again = host.querySelectorAll('[data-view="' + key + '"]')[0];
        if (again && again.focus) again.focus();
      }
      S.announce('The bill is now grouped by ' + (VIEW_BUTTON[key] || key) + '.');
    }

    /* The target, read beside the bill rather than after it.

       Beside, so the card below the headline does not cost the pane a second
       round trip's worth of skeleton. And its failure is swallowed here
       rather than raised: this read is the answer to a different question,
       and a summary the API refused must not turn a perfectly good bill into
       a failure card. `null` is what the budget card treats as "no statement
       either way", which draws nothing. */
    function target() {
      return S.read({ paneId: SUMMARY_FIXTURE_ID, endpoint: SUMMARY_ENDPOINT })
        .then(function (answer) {
          return (answer && answer.data) || null;
        }, function () { return null; });
    }

    function load() {
      var token = ++inFlight;
      skeleton();

      Promise.all([S.read(source()), target()]).then(function (both) {
        if (token !== inFlight) return;
        var data = (both[0] && both[0].data) || {};
        var availability = data.availability || {};

        if (availability.state !== 'ready') {
          latest = null;
          latestSummary = null;
          notReady(data, region);
          return;
        }
        latest = data;
        latestSummary = both[1];
        region.show(render(data, latestSummary, viewKey, pick));
        S.announce('Cost figures updated for ' + periodLabel(data) + '.');
      }).catch(function (error) {
        if (token !== inFlight) return;
        latest = null;
        latestSummary = null;
        region.failed(error, load);
      });
    }

    /* The bootstrap fires ops:filters with the starting selection once the
       shell is in the document, so the first read is that event rather than a
       call from here: reading twice on boot would double every request and
       leave the two answers racing. The skeleton goes up now because the
       listener is added before the event and the region would otherwise be
       blank until the answer lands. */
    skeleton();
    global.addEventListener('ops:filters', load);
  });
}(window));
