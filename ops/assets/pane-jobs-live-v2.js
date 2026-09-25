/* Happening now: what is Aria working on, and is any of it not clearing?

   WHAT CHANGED, AND WHY THE OLD HEADER IS GONE

   This pane used to open by saying there was no queue behind it. That was
   true and it is no longer: `GET /api/ops/jobs` (Stadiora/Aria#5562) serves
   the open queue and, from the lifecycle record #5561 started writing, the
   throughput and the durations that make "slow" mean anything. The pane now
   draws the work itself. What it still cannot answer is named at the bottom,
   as before, because that list got shorter rather than empty.

   TWO TENSES, AND THE PANE KEEPS THEM APART

   The route answers in two tenses and they are not interchangeable:

     the queue      counted right now, from the table the workers mutate in
                    place. NOT a window over anything - it is the queue, so
                    no window is printed against it and none should be.

     throughput     counted over a stated window, from the append-only
                    lifecycle record. Every figure of this kind is drawn with
                    the window it covers, because a count with no window is
                    not a measurement.

   ABSENCE, ZERO, AND THE DIFFERENCE BETWEEN THEM

   The rule this pane is built around: a state whose pipeline is not connected
   must not look like a genuine zero. During an incident a confident zero is
   worse than a blank, because a blank sends someone to look and a zero sends
   them away. Concretely, here:

     an empty queue         IS zero and is drawn as zero. The counts come from
                            an unbounded read over every open state, so
                            "nothing queued" is a measurement.

     both lanes, always     the route publishes every lane the platform routes
                            to, holding work or not, so an idle lane and a
                            disconnected one are never the same row.

     throughput: null       the recorder has never written. NOT zeros. The
                            card says so and names when it last wrote, so a
                            recorder that has gone quiet reads as staleness
                            rather than as a calm hour.

     oldestQueued unknown   the lane has a real queue and every job in it fell
                            past the read's bound. Drawn as an unknown age,
                            never as "nothing waiting". "Nothing waiting" is
                            the answer to `none` alone -- a lane carrying no
                            answer, or one this pane has no sentence for, says
                            the read did not say, because a confident empty
                            lane over an unread field is the reading that
                            sends an operator away.

     attention scoped       `completeness` says whether the stuck and given-up
                            lists were read over the whole queue or only the
                            bounded working set. An empty list from a
                            truncated read is a narrower claim than it looks,
                            and it says so on screen.

     grade unknown          a run with no usable baseline, or one whose worker
                            has never reported in, is graded `unknown` rather
                            than healthy. "We cannot tell" is a third answer.

   HOW IT UPDATES, AND HOW IT STOPS

   The acceptance says it must update without the operator reloading. The
   issue also warns that polling a pane forgets to stop is how #5543 happened,
   so the stopping is the part designed first.

   #5543 was not caused by polling being the wrong tool - its declared polling
   floor was sane. It was caused by a STREAM whose reconnect reset its backoff
   on connect rather than on survival, so a connection that died immediately
   reconnected forever. The lesson is about lifecycle, not mechanism: whatever
   refreshes has to have a condition under which it stops, and that condition
   has to be the default rather than an afterthought.

   So: a chained setTimeout, not setInterval, and not a stream.

     why not a stream       there is no streaming route, and adding one would
                            mean a held-open connection per operator to carry
                            a figure that changes at human speed. That is the
                            #5543 machinery for none of the benefit.

     why chained, not an    setInterval queues ticks behind a slow read and
     interval               they all arrive at once when it lands. A chain
                            cannot overlap itself: the next tick is scheduled
                            only once the previous one has settled.

     it stops when hidden   `visibilitychange` cancels the pending tick. A
                            backgrounded tab costs nothing, and resuming reads
                            immediately so the first thing seen is current.

     it stops on unload     `pagehide` cancels too. Each pane is its own page,
                            so navigation already ends the timer - this is
                            belt and braces for bfcache.

     it stops giving up     consecutive failures back off, doubling to a cap,
                            and after enough of them the chain stops entirely
                            and says so with a manual retry. A route that is
                            down is not helped by being asked every 15s
                            forever.

     the operator can stop  a Pause control, because an operator reading a row
     it                     should not have it repaint under them.

   A refresh repaints in place. The skeleton belongs to the first read only:
   flashing the whole pane back to bars every 15 seconds would make a working
   pane look like a broken one.

   ROLES

   Every role that can open the pane can see the queue, but job writes come
   only from the action capabilities the API sends on each row. A button drawn
   from anything else would be a guess. A denied action is a quiet reason, not
   a disabled control, because a control that cannot succeed says the thing is
   within reach.

   EVENTS, NEVER CONTENT

   The route's projection is written column by column and carries no payload,
   no result and no error text. Nothing on this page is a person's data; the
   identifiers are job ids and numeric user ids. The mask below is kept anyway,
   for the same reason it was kept before: the shape of today's payload is not
   a promise about tomorrow's. */

(function (global) {
  'use strict';

  var S = global.OpsPaneShell;
  var session = global.OpsSession;
  var h = S.h;
  var icon = S.icon;
  var fmt = S.fmt;
  var maskContactDetails = global.OpsPaneRegistry.maskContactDetails;
  var jobActions = global.OpsJobActions || { controls: emptyJobActionControls };

  var JOBS_ENDPOINT = '/api/ops/jobs';
  var HISTORY_FILE = 'run-history.html';
  var ALERTS_FILE = 'alerts.html';

  function emptyJobActionControls() {
    return h('div', { className: 'job-action-stack' });
  }

  /* Fast enough that a queue moving under an operator's eyes looks like it is
     moving, slow enough that a page left open all afternoon is not a load.
     Four reads a minute against a two-table query. */
  var REFRESH_MS = 15000;

  /* Failure backoff: double from the cadence to the cap, then stop. Five
     consecutive failures spans 15s + 30s + 60s + 120s + 120s, so the chain
     stops about five and three quarter minutes after the last successful read.
     The first 15s is the ordinary cadence, so that span is measured from the
     last success, not from the first failure -- which is 5m30s, one term in.
     That is long enough that the next read is not going to be the one that
     works, and a person should be told rather than kept waiting. */
  var BACKOFF_CAP_MS = 120000;
  var GIVE_UP_AFTER = 5;

  var LANE_LABEL = { gpu: 'GPU', background: 'Background' };
  var LANE_NOTE = {
    gpu: 'Work that needs a graphics card. Video analysis runs here.',
    background: 'Everything else Aria generates for an athlete.'
  };

  var STATE_LABEL = { queued: 'Waiting', running: 'Running', canceling: 'Stopping' };

  var GRADE_LABEL = {
    healthy: 'On time',
    stuck: 'Overdue',
    abandoned: 'Given up on',
    unknown: 'Not measurable'
  };
  /* aria.css's pill modifiers, not ops.css's badge ones: this page loads
     aria.css. `unknown` deliberately maps to no modifier, which is the
     neutral pill -- a grade the route could not decide should not be painted
     in a colour that decides it. An unrecognised grade falls to the same
     neutral, for the same reason. */
  var GRADE_TONE = { healthy: 'up', stuck: 'warn', abandoned: 'down', unknown: '' };

  /* Anything that looks like a contact detail, replaced before it reaches the
     DOM. Kept from the previous pane unchanged: the route prints service facts
     today, and this enforces that rather than trusting it. The replacement
     names the kind of thing it hid, because an operator reading a sentence
     with a hole in it needs to know a hole is what they are looking at. */
  function coded(text) {
    return maskContactDetails(text);
  }

  /* ------------------------------------------------------------ formatting */

  /* A duration an operator reads at a glance. Absence stays absence: a job
     nobody can time prints the none marker rather than 0s, which would read
     as "just started". */
  function dur(ms) {
    if (!fmt.isNum(ms) || ms < 0) return fmt.none;
    var s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ' + (s % 60 < 10 ? '0' : '') + (s % 60) + 's';
    var hrs = Math.floor(m / 60);
    return hrs + 'h ' + (m % 60) + 'm';
  }

  function jobTypeLabel(jobType) {
    if (typeof jobType !== 'string' || !jobType) return fmt.none;
    return coded(jobType.replace(/_/g, ' '));
  }

  /* A ratio travels as its two numbers and is turned into a percentage here,
     at the edge, so the denominator stays visible next to it. 1 of 1 and
     847 of 848 are both "100%" and they are not the same evidence. */
  function rate(ratio) {
    if (!ratio || !fmt.isNum(ratio.numerator) || !fmt.isNum(ratio.denominator)) return null;
    if (ratio.denominator <= 0) return null;
    return Math.round((ratio.numerator / ratio.denominator) * 1000) / 10;
  }

  /* Three readings of `attention.completeness`, not two. Absent or
     unrecognised is NOT `whole_queue`: reading it that way publishes a narrow
     claim as a broad one on the strength of a field that never arrived, which
     is the confident-zero shape PR #98 and #106 both found elsewhere on this
     dashboard. An unread scope draws the band (so a finding is never silently
     broadened) and says on the card that the scope is unknown. */
  function scopeOf(attention) {
    if (attention.completeness === 'whole_queue') return 'whole';
    if (attention.completeness === 'working_set_only') return 'bounded';
    return 'unread';
  }

  function stateCount(byState, state) {
    var found = (byState || []).filter(function (entry) { return entry.state === state; })[0];
    return found && fmt.isNum(found.jobs) ? found.jobs : null;
  }

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  /* ------------------------------------------------------------- the pane */

  S.definePane('jobs', function (content) {
    var region = S.region(content);
    var loadToken = 0;
    var timer = null;
    var inFlight = false;
    var failures = 0;
    var paused = false;
    var stopped = false;
    var lastReadAt = null;
    /* Held across renders because a pause must not delete it. Passing the
       error into the footer meant the pause branch, which has no error to
       pass, silently cleared the staleness caveat over figures exactly as
       stale as they were a moment before. */
    var lastError = null;
    var drawnOnce = false;
    var focusAfterAction = null;
    var highlightJobId = null;

    /* No ops:filters listener. This pane declares no filter in the registry,
       so the shell pins every one of them and the event can never carry a
       selection this pane could act on. */

    /* ----------------------------------------------------- the refresh loop */

    function cancelTick() {
      if (timer !== null) {
        global.clearTimeout(timer);
        timer = null;
      }
    }

    /* Every path that schedules goes through here, and every reason not to
       schedule is stated in one place. That is the whole defence against the
       #5543 shape: there is no second scheduler to forget about. */
    function scheduleTick() {
      cancelTick();
      if (paused || stopped || global.document.hidden) return;
      var delay = REFRESH_MS;
      if (failures > 0) {
        delay = Math.min(REFRESH_MS * Math.pow(2, failures), BACKOFF_CAP_MS);
      }
      timer = global.setTimeout(function () {
        timer = null;
        load(false);
      }, delay);
    }

    function onVisibility() {
      if (global.document.hidden) {
        cancelTick();
        return;
      }
      if (paused || stopped) return;
      /* Read immediately rather than waiting out a cadence that elapsed while
         nobody was looking. The first thing a returning operator sees should
         be current, not up to fifteen seconds stale. */
      load(false);
    }

    function onPageHide() {
      cancelTick();
    }

    global.document.addEventListener('visibilitychange', onVisibility);
    global.addEventListener('pagehide', onPageHide);

    function load(firstRead) {
      /* A read already in flight owns the next schedule. Starting a second
         one would be the overlap the chain exists to prevent. */
      if (inFlight) return;
      cancelTick();
      inFlight = true;
      var token = ++loadToken;

      if (firstRead) {
        region.loading([
          { type: 'block', height: 62 },
          { type: 'tiles', count: 4 },
          { type: 'rows', count: 6 }
        ]);
      }

      S.read({ paneId: 'jobs', endpoint: JOBS_ENDPOINT }).then(function (result) {
        inFlight = false;
        if (token !== loadToken) return;
        failures = 0;
        stopped = false;
        lastError = null;
        lastReadAt = new Date();
        drawnOnce = true;
        render(result.data || {});
        scheduleTick();
      }, function (err) {
        inFlight = false;
        if (token !== loadToken) return;
        failures += 1;
        lastError = err || new Error('The read failed.');
        if (failures >= GIVE_UP_AFTER) {
          stopped = true;
          cancelTick();
        }
        /* A refresh that failed over a pane already showing a reading does not
           blank it. The reading is stale, not wrong, and the footer says how
           stale. Only a first read that fails takes the whole pane. */
        if (!drawnOnce) {
          region.failed(err, function () { failures = 0; stopped = false; lastError = null; load(true); });
          return;
        }
        redrawFooter();
        scheduleTick();
      });
    }

    /* ------------------------------------------------------------- footer */

    var footerHost = null;

    function redrawFooter() {
      if (!footerHost) return;
      /* Same swap, smaller scope: the footer holds Pause and Read now, and a
         failure redraw lands here while one of them may be focused. */
      var held = captureRetained();
      while (footerHost.firstChild) footerHost.removeChild(footerHost.firstChild);
      footerHost.appendChild(refreshCard());
      restoreRetained(held, footerHost);
    }

    function refreshCard() {
      var box = S.card();
      var body = h('div', { className: 'card-body' });
      var row = h('div', { className: 'row row-wrap gap-sm' });

      var status;
      if (stopped) {
        status = 'Stopped refreshing after ' + GIVE_UP_AFTER + ' failed reads.';
      } else if (paused) {
        status = lastError
          ? 'Paused, and the last refresh before it had already failed.'
          : 'Paused. Nothing on this page is changing.';
      } else if (lastError) {
        status = 'The last refresh failed. Retrying, more slowly each time.';
      } else {
        status = 'Refreshing every ' + Math.round(REFRESH_MS / 1000) +
          's while this tab is visible.';
      }

      var words = h('div');
      words.appendChild(h('div', { className: 'strong', text: status }));
      words.appendChild(h('div', {
        className: 'tiny muted',
        text: lastReadAt
          ? 'Last read ' + fmt.clock(lastReadAt.toISOString()) + '.' +
            (lastError || stopped ? ' What is above is that reading, not a current one.' : '')
          : 'Not read yet.'
      }));
      row.appendChild(words);

      var actions = h('div', { className: 'row gap-sm' });
      if (stopped) {
        var retry = h('button', {
          className: 'btn btn-sm btn-primary', type: 'button', text: 'Start again'
        });
        retry.addEventListener('click', function () {
          failures = 0;
          stopped = false;
          load(false);
        });
        actions.appendChild(retry);
      } else {
        var toggle = h('button', {
          className: 'btn btn-sm',
          type: 'button',
          text: paused ? 'Resume' : 'Pause',
          'aria-pressed': paused ? 'true' : 'false',
          'data-retain': 'jobs-toggle'
        });
        toggle.addEventListener('click', function () {
          paused = !paused;
          if (paused) {
            cancelTick();
            redrawFooter();
          } else {
            /* Redraw FIRST. `load` resolves over the network, and a toggle that
               keeps saying Resume with aria-pressed=true until the response
               lands is reporting a state the pane left the moment it was
               clicked. */
            redrawFooter();
            load(false);
          }
        });
        actions.appendChild(toggle);
      }

      var now = h('button', {
        className: 'btn btn-sm', type: 'button', text: 'Read now',
        'data-retain': 'jobs-read-now'
      });
      now.addEventListener('click', function () { load(false); });
      actions.appendChild(now);

      row.appendChild(actions);
      body.appendChild(row);
      box.appendChild(body);
      return box;
    }

    /* --------------------------------------------------------- the reading */

    function render(data) {
      var held = captureRetained();
      var queue = data.queue || {};
      var workingSet = data.workingSet || {};
      var attention = data.attention || {};
      var baseline = data.baseline || {};
      var jobs = list(workingSet.jobs);
      var open = fmt.isNum(queue.open) ? queue.open : null;

      var wrap = h('div', { className: 'stack' });
      /* Banded rather than given a card head of its own. cardHead is an h3 and
         the pane's name in the top bar is the h1, so a lone card here jumps
         h1 -> h3; bandHead is the h2 every other section on this page sits
         under. Same heading, one level up, no skip. */
      var now = S.band('Right now', 'Counted from the queue itself, not over a window');
      now.appendChild(hero(queue, data.recording || {}, open));
      wrap.appendChild(now);

      /* Drawn whenever there is a finding OR whenever the read that looked was
         a partial one. An empty stuck/abandoned list over a truncated queue is
         a much narrower claim than an empty list over the whole of it, and
         hiding the band in that case publishes the narrow claim as the broad
         one -- silence that reads as "nothing is wrong". The route sets
         `attention.completeness` for exactly this (opsJobsView.ts:171-177);
         a pane that reads it only on the branch where something was found has
         not read it. */
      var flagged = list(attention.stuck).length + list(attention.abandoned).length;
      if (flagged > 0 || scopeOf(attention) !== 'whole') {
        wrap.appendChild(attentionBand(attention, jobs, baseline));
      }

      wrap.appendChild(laneBand(list(queue.lanes)));
      if (jobs.length) {
        wrap.appendChild(jobsBand(jobs, workingSet, baseline));
      } else if (workingSet.truncated === true) {
        /* Nothing came back and the route still calls the read bounded. That
           is a contradiction worth showing rather than swallowing: dropping
           the band entirely would publish "no work in flight" over a read that
           says it did not reach the end of the queue. */
        wrap.appendChild(emptyWorkingSetBand(workingSet));
      }
      wrap.appendChild(throughputBand(data.throughput, data.recording || {}));
      wrap.appendChild(missingBand(data.capacity || {}));

      footerHost = h('div');
      footerHost.appendChild(refreshCard());
      wrap.appendChild(footerHost);

      region.show(wrap);
      restoreRetained(held, wrap);
      settleActionFocus(wrap);
      shownRoot = wrap;
    }

    /* A refresh every fifteen seconds redraws the pane and `region.show`
       swaps the whole box out, so anything the operator was holding at that
       instant belongs to the read rather than to them: the control they had
       tabbed to loses focus to BODY, and the table they had scrolled right
       snaps back to column one. At 375px the table is 311 wide against 643 of
       content, so that is most of it. Carry both across the swap and put them
       back. Nodes are matched by `data-retain` because the node itself is a
       new object after every render -- the name is the only stable identity
       a rebuilt tree has. */
    var RETAIN_ATTR = 'data-retain';
    var shownRoot = null;

    function captureRetained() {
      var held = { focus: null, scroll: {} };
      var active = global.document && global.document.activeElement;
      if (active && active.getAttribute && (!shownRoot || !shownRoot.contains || shownRoot.contains(active))) {
        held.focus = active.getAttribute(RETAIN_ATTR) || null;
      }
      if (shownRoot && shownRoot.querySelectorAll) {
        var nodes = shownRoot.querySelectorAll('[' + RETAIN_ATTR + ']');
        for (var i = 0; i < nodes.length; i += 1) {
          var name = nodes[i].getAttribute(RETAIN_ATTR);
          if (name) held.scroll[name] = nodes[i].scrollLeft || 0;
        }
      }
      return held;
    }

    function restoreRetained(held, root) {
      if (!held || !root || !root.querySelectorAll) return;
      var nodes = root.querySelectorAll('[' + RETAIN_ATTR + ']');
      for (var i = 0; i < nodes.length; i += 1) {
        var node = nodes[i];
        var name = node.getAttribute(RETAIN_ATTR);
        if (!name) continue;
        if (held.scroll[name]) node.scrollLeft = held.scroll[name];
        if (held.focus && name === held.focus && typeof node.focus === 'function') {
          /* preventScroll matters as much as the focus itself. Calling focus()
             bare makes the browser scroll the node into view, so a refresh
             that correctly KEEPS focus still throws the page's vertical
             position away -- measured at 1709 -> 811 on a long reading. The
             point of this whole mechanism is that a refresh moves nothing the
             operator did not move. */
          node.focus({ preventScroll: true });
        }
      }
    }

    function settleActionFocus(root) {
      if (!focusAfterAction || !root) return;
      var target = null;
      var keys = [
        focusAfterAction.preferred,
        focusAfterAction.sameRow,
        'jobs-read-now'
      ];
      for (var i = 0; i < keys.length && !target; i += 1) {
        if (!keys[i]) continue;
        target = root.querySelector('[' + RETAIN_ATTR + '="' + keys[i] + '"]');
      }
      if (!target) target = content;
      if (target && target.focus) {
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
      focusAfterAction = null;
    }

    function afterAction(result) {
      var next = result.action === 'retry' && result.data && result.data.jobId
        ? result.data.jobId
        : null;
      highlightJobId = next;
      focusAfterAction = {
        preferred: next ? 'jobs-row-' + next : null,
        sameRow: 'jobs-row-' + String(result.row.id || '')
      };
      load(false);
    }

    /* ----------------------------------------------------------- the hero */

    function hero(queue, recording, open) {
      var box = S.card();

      var body = h('div', { className: 'card-body' });

      var quiet = open === 0;
      body.appendChild(h('p', {
        className: 'page-sub',
        text: open === null
          ? 'The queue could not be counted.'
          : quiet
            ? 'Aria has nothing in flight.'
            : 'Aria is working on ' + fmt.plural(open, 'thing') + '.'
      }));

      /* The zero here is a measurement and says so. The counts come from an
         unbounded read over all three open states, so an empty queue is a
         fact about the queue rather than a fact about the read. */
      if (quiet) {
        body.appendChild(h('p', {
          className: 'tiny muted',
          text: 'Counted, not assumed: every lane answered and every state was asked about. ' +
            'This is an idle queue, not an unread one.'
        }));
      }

      var tiles = h('div', { className: 'grid g3 mt' });
      ['queued', 'running', 'canceling'].forEach(function (state) {
        var value = stateCount(queue.byState, state);
        tiles.appendChild(tile(
          STATE_LABEL[state],
          value === null ? fmt.none : fmt.int(value),
          value === null ? 'Not reported' : null
        ));
      });
      body.appendChild(tiles);

      box.appendChild(body);

      var foot = h('div', { className: 'card-foot' });
      foot.appendChild(h('span', {
        text: recording.state === 'never_recorded'
          ? 'The lifecycle record has never been written to, so nothing below it has a history yet.'
          : 'Lifecycle record last written ' +
            (recording.lastRecordedAt ? fmt.ago(recording.lastRecordedAt) : fmt.none) + '.'
      }));
      box.appendChild(foot);
      return box;
    }

    /* The figure card in the v2 vocabulary: a .card.kpi holding a label, a
       value and an optional line of meta. The names are aria.css's, which is
       the sheet this page loads. An earlier draft of this pane used .tile /
       .tile-value / .tile-label, which are ops.css's -- the v1 sheet, which
       jobs-live.html does not load -- so every figure on the page rendered at
       body size in the body face with no tile around it at all. Unpainted
       classes fail silently and look like a design choice. */
    function tile(label, value, meta) {
      var box = S.card('kpi');
      var body = h('div', { className: 'card-body' });
      body.appendChild(h('div', { className: 'kpi-label', text: label }));
      body.appendChild(h('div', { className: 'kpi-val', text: value }));
      if (meta) body.appendChild(h('div', { className: 'kpi-meta' }, [h('span', { text: meta })]));
      box.appendChild(body);
      return box;
    }

    /* ------------------------------------------------------- what is wrong */

    function attentionBand(attention, jobs, baseline) {
      /* The multiple the route actually applied, not a 3 written into this
         sentence. A route that changes the threshold and a pane that keeps
         saying "three times" is how a page starts lying slowly. */
      var multiple = baseline && fmt.isNum(baseline.stuckMedianMultiple)
        ? baseline.stuckMedianMultiple
        : null;
      var stuck = list(attention.stuck);
      var abandoned = list(attention.abandoned);
      var scope = scopeOf(attention);

      var section = S.band('Not clearing',
        'Runs the platform has either lost or is taking far longer over than usual');
      var box = S.card();
      var body = h('div', { className: 'card-body' });

      function finding(iconName, title, words) {
        return h('div', { className: 'omit-item' }, [
          S.icon(iconName),
          h('div', {}, [
            h('div', { className: 'omit-title', text: title }),
            h('div', { className: 'omit-desc', text: words })
          ])
        ]);
      }

      var found = h('div', { className: 'omit' });
      if (!abandoned.length && !stuck.length) {
        found.appendChild(finding('check', 'Nothing flagged in what was read',
          'No run in this read had been given up on or was past the usual duration for its ' +
          'kind. The scope of that statement is below it.'));
      }
      if (abandoned.length) {
        found.appendChild(finding('warn',
          fmt.plural(abandoned.length, 'run') + ' given up on',
          'The worker stopped reporting in long enough ago that the reaper will fail ' +
          'them on its next sweep. They are not waiting for a person.'));
      }
      if (stuck.length) {
        found.appendChild(finding('clock',
          fmt.plural(stuck.length, 'run') + ' overdue',
          'Still reporting in, and past ' +
          (multiple === null ? 'the multiple of' : fmt.int(multiple) + ' times') +
          ' the usual duration for their kind of work. The comparison is drawn against ' +
          'each one in the table below.'));
      }
      body.appendChild(found);

      var ids = abandoned.concat(stuck);
      var named = jobs.filter(function (job) { return ids.indexOf(job.id) !== -1; });
      if (named.length) {
        var types = {};
        named.forEach(function (job) { types[job.jobType] = (types[job.jobType] || 0) + 1; });
        body.appendChild(h('p', {
          className: 'tiny muted mt-sm',
          text: 'Affecting ' + Object.keys(types).sort().map(function (jobType) {
            return jobTypeLabel(jobType) + ' (' + types[jobType] + ')';
          }).join(', ') + '.'
        }));
      }

      box.appendChild(body);

      /* The scope of the list, stated on the list. An empty or short list read
         over a truncated queue is a narrower claim than it looks. */
      var foot = h('div', { className: 'card-foot' });
      var read = list(jobs).length;
      foot.appendChild(h('span', {
        text: scope === 'whole'
          ? 'Read over the whole queue.'
          : scope === 'unread'
            ? 'This read did not say how much of the queue it covered, so the scope of the ' +
              'line above is unread rather than whole.'
            : read === 0
              ? 'This read reached no jobs at all, so the line above covers nothing. It is not a ' +
                'statement that nothing is wrong.'
              : 'Read over the first ' + fmt.int(read) + ' jobs only, not the whole queue. ' +
                'There may be more past that.'
      }));
      box.appendChild(foot);

      section.appendChild(box);
      return section;
    }

    /* ---------------------------------------------------------- the lanes */

    function laneBand(lanes) {
      var section = S.band('Lanes', 'Work is routed by what it needs, not by who asked');

      /* The route publishes every lane the platform routes to, holding work or
         not, so an empty array is the route failing to answer rather than a
         platform with no lanes. Said out loud; a band head over nothing reads
         as a section that loaded and found nothing to show. */
      if (!lanes.length) {
        var none = S.card();
        none.appendChild(h('div', { className: 'card-body' }, [
          h('p', { className: 'tiny muted', text: 'No lane was reported. This read did not say how ' +
            'work is distributed, which is not the same as work not being distributed.' })
        ]));
        section.appendChild(none);
        return section;
      }

      var grid = h('div', { className: 'grid g2' });

      lanes.forEach(function (lane) {
        var box = S.card();
        box.appendChild(S.cardHead(LANE_LABEL[lane.lane] || lane.lane, null));
        var body = h('div', { className: 'card-body' });

        body.appendChild(h('p', { className: 'tiny muted', text: LANE_NOTE[lane.lane] || '' }));

        var counts = h('div', { className: 'row row-wrap gap-sm mt-sm' });
        ['queued', 'running', 'canceling'].forEach(function (state) {
          var value = stateCount(lane.byState, state);
          counts.appendChild(h('span', {
            className: 'pill' + (value ? ' info' : ''),
            text: STATE_LABEL[state] + ' ' + (value === null ? fmt.none : fmt.int(value))
          }));
        });
        body.appendChild(counts);

        var oldest = lane.oldestQueued || {};
        var waitText;
        if (oldest.state === 'known') {
          waitText = 'Longest wait ' + dur(oldest.ageMs) + '.';
        } else if (oldest.state === 'unknown') {
          /* A real queue whose every job fell past the read's bound. Drawn as
             an unknown age rather than as nothing waiting, which is the one
             reading that would send an operator away. */
          waitText = 'Something is waiting and its age is past the end of this read.';
        } else if (oldest.state === 'none') {
          waitText = 'Nothing waiting.';
        } else {
          /* Not one of the three answers the route publishes, or no answer at
             all. "Nothing waiting" here would be a confident absence over a
             field this pane could not read -- the same shape as the truncated
             `completeness` below, and the one reading the comment at the top
             of this file rules out for every lane. */
          waitText = 'This read did not say whether anything is waiting here.';
        }
        body.appendChild(h('p', { className: 'tiny muted mt-sm', text: waitText }));

        /* `jobTypes` is a sorted array of NAMES -- opsJobsView.ts builds it as
           `[...new Set(laneCounts.map(row => row.jobType))].sort()`. It carries
           no counts, so this line says what is in the lane and not how much of
           each; the counts are in the table below.

           Anything that is not a string is dropped rather than labelled,
           because `jobTypeLabel` of an object returns a dash and a row of
           dashes reads as absence rather than as a bug -- the exact failure
           this pane exists to avoid. If the route ever changes this shape the
           line goes empty and says so, which is visible, rather than printing
           dashes, which is not. */
        var declared = list(lane.jobTypes);
        var types = declared.filter(function (name) {
          return typeof name === 'string' && name;
        });
        var typesText;
        if (types.length) {
          typesText = 'In this lane now: ' + types.map(jobTypeLabel).join(', ') + '.';
        } else if (declared.length) {
          /* The route listed something and none of it was readable as a name.
             That is a shape this pane does not understand, and saying
             "nothing of any kind" over it would be a confident claim about a
             lane whose badges above may well say four are waiting. */
          typesText = 'The kinds of work in this lane were reported in a shape this page ' +
            'cannot read, so they are unread rather than absent.';
        } else {
          typesText = 'Nothing of any kind in this lane right now.';
        }
        body.appendChild(h('p', { className: 'tiny muted', text: typesText }));

        box.appendChild(body);
        grid.appendChild(box);
      });

      section.appendChild(grid);
      return section;
    }

    /* A working set that returned nothing while reporting itself bounded. */
    function emptyWorkingSetBand(workingSet) {
      var section = S.band('The work itself', 'Nothing came back');
      var box = S.card();
      var body = h('div', { className: 'card-body' });
      body.appendChild(h('p', {
        className: 'tiny muted',
        text: 'This read returned no jobs and still reports itself as bounded at ' +
          (fmt.isNum(workingSet.limit) ? fmt.int(workingSet.limit) : fmt.none) +
          ', so it cannot be read as an empty queue. The counts above came from a ' +
          'separate unbounded read and are the figure to trust.'
      }));
      box.appendChild(body);
      section.appendChild(box);
      return section;
    }

    /* ----------------------------------------------------------- the work */

    function jobsBand(jobs, workingSet, baseline) {
      var section = S.band('The work itself', 'Oldest first');
      var box = S.card();

      var head = h('thead', {}, [
        h('tr', {}, [
          h('th', { text: 'Kind' }),
          h('th', { text: 'Lane' }),
          h('th', { text: 'State' }),
          h('th', { text: 'Waiting' }),
          h('th', { text: 'Running' }),
          h('th', { text: 'Usually' }),
          h('th', { text: 'Verdict' }),
          h('th', { className: 'r', text: 'Actions' })
        ])
      ]);

      var body = h('tbody');
      jobs.forEach(function (job) {
        var grade = job.progressGrade;
        var row = h('tr', {}, [
          h('td', {}, [
            h('div', { className: 't-main', text: jobTypeLabel(job.jobType) }),
            h('div', { className: 'tiny muted job-id', text: coded(String(job.id || '')) })
          ]),
          h('td', { text: LANE_LABEL[job.lane] || job.lane || fmt.none }),
          h('td', { text: STATE_LABEL[job.state] || job.state || fmt.none }),
          h('td', { text: dur(job.queuedMs) }),
          h('td', { text: dur(job.runningMs) }),
          h('td', { text: dur(job.baselineMedianMs) }),
          h('td', {}, [
            grade
              ? h('span', {
                className: 'pill' + (GRADE_TONE[grade] ? ' ' + GRADE_TONE[grade] : ''),
                text: GRADE_LABEL[grade] || grade
              })
              : h('span', { className: 'muted', text: 'Not started' })
          ]),
          h('td', { className: 'r' }, [
            jobActions.controls(job, {
              onSuccess: afterAction,
              onStale: afterAction,
              focusAttr: RETAIN_ATTR,
              focusPrefix: 'jobs-action'
            })
          ])
        ]);
        row.setAttribute(RETAIN_ATTR, 'jobs-row-' + String(job.id || ''));
        if (highlightJobId && job.id === highlightJobId) {
          row.className = 'job-row-highlight';
        }
        body.appendChild(row);
      });

      /* The table is wider than a phone and the box around it scrolls, so the
         columns past the edge have to be reachable without a pointer. Named
         and focusable for the same reason as the Analytics cohort grid and the
         Settings tables: a scroll region a keyboard cannot get to fails
         WCAG 2.1.1, and an unnamed one announces nothing when it is reached. */
      box.appendChild(h('div', { className: 'card-body' }, [
        h('div', {
          className: 'u-scroll',
          tabindex: '0',
          role: 'region',
          'aria-label': 'Jobs in flight, by kind',
          'data-retain': 'jobs-table'
        }, [
          h('table', { className: 'tbl' }, [head, body])
        ])
      ]));

      var foot = h('div', { className: 'card-foot' });
      foot.appendChild(h('span', {
        text: workingSet.truncated
          ? 'Showing the oldest ' + fmt.int(workingSet.returned) + ' of ' +
            fmt.int(workingSet.limit) + ' this read will carry. The queue is longer.'
          : 'This is the whole queue, not a page of it.'
      }));
      foot.appendChild(h('span', { text: baselineWindowText(baseline) }));
      if (highlightJobId) {
        foot.appendChild(h('span', {
          text: body.querySelector('.job-row-highlight')
            ? 'The newly created retry is highlighted in this table.'
            : 'The retry was created as ' + (jobActions.referenceFromId(highlightJobId) || highlightJobId) +
              ', but it is not in this read.'
        }));
      }
      box.appendChild(foot);

      section.appendChild(box);
      return section;
    }

    /* "Usually" is a median taken over a window of its own, separate from the
       throughput window below. No figure without the window it covers
       (Stadiora/Aria#5562), so the period is read off the response and printed
       beside the table; a response without one says so rather than letting
       the column borrow the throughput window. */
    function baselineWindowText(baseline) {
      var win = (baseline && baseline.window) || {};
      var from = fmt.utcDay(win.from);
      var to = fmt.utcDay(win.to);
      if (!fmt.isNum(win.days) || !from || !to) {
        return '"Usually" is a median over a window this read did not state.';
      }
      return '"Usually" is the median run time for that kind over the ' +
        fmt.plural(win.days, 'day') + ' from ' + from + ' to ' + to + '.';
    }

    /* ----------------------------------------------------- what has flowed */

    function throughputBand(throughput, recording) {
      var section = S.band('What has flowed', 'From the lifecycle record, over a stated window');
      var box = S.card();
      var body = h('div', { className: 'card-body' });

      /* Absence, not zeros. A recorder that has never written cannot report a
         calm hour, and four tiles of 0 would say exactly that. */
      if (!throughput) {
        body.appendChild(S.stateBlock('info', 'Nothing has been recorded yet', [
          recording.state === 'never_recorded'
            ? 'The lifecycle record is empty, so there is no window to count over. ' +
              'These figures are absent rather than zero.'
            : 'The lifecycle record has stopped answering. What flowed is unread, not nothing.',
          'The queue above is unaffected: it is counted from the jobs themselves.'
        ], 3));
        box.appendChild(body);
        section.appendChild(box);
        return section;
      }

      var window_ = throughput.window || {};
      var pct = rate(throughput.successRate);

      var tiles = h('div', { className: 'grid g4' });
      tiles.appendChild(tile('Finished', fmt.int(throughput.finished), null));
      tiles.appendChild(tile('Completed', fmt.int(throughput.completed), null));
      tiles.appendChild(tile('Failed', fmt.int(throughput.failed), null));
      tiles.appendChild(tile(
        'Got through',
        pct === null ? fmt.none : pct + '%',
        /* The ratio's two numbers stay next to the percentage. 1 of 1 and
           847 of 848 are both 100% and they are not the same evidence. */
        pct === null
          ? 'Nothing finished to divide'
          : fmt.int(throughput.successRate.numerator) + ' of ' +
            fmt.int(throughput.successRate.denominator)
      ));
      body.appendChild(tiles);

      var failedByType = list(throughput.failedByType);
      if (failedByType.length) {
        body.appendChild(h('p', {
          className: 'tiny muted mt',
          text: 'Failures were ' + failedByType.map(function (entry) {
            return jobTypeLabel(entry.jobType) + ' (' + fmt.int(entry.jobs) + ')';
          }).join(', ') + '.'
        }));
      }

      if (fmt.isNum(throughput.canceled) && throughput.canceled > 0) {
        body.appendChild(h('p', {
          className: 'tiny muted',
          text: fmt.plural(throughput.canceled, 'run') +
            ' cancelled, which is a decision rather than a failure and is left out of the ' +
            'figure above.'
        }));
      }

      box.appendChild(body);

      /* No figure without the window it covers. */
      var foot = h('div', { className: 'card-foot' });
      foot.appendChild(h('span', {
        text: 'Over the ' + (fmt.isNum(window_.minutes) ? window_.minutes + ' minutes' : 'window')
          + ' ending ' + (window_.to ? fmt.clock(window_.to) : fmt.none) + '.'
      }));
      box.appendChild(foot);

      section.appendChild(box);
      return section;
    }

    /* ------------------------------------------------- what is not here */

    /* Shorter than it was, and still named rather than drawn as an empty
       figure. Each entry says what is missing and why, not what is coming. */
    function missingBand(capacity) {
      var section = S.band('What this pane cannot answer yet',
        'Named rather than drawn as an empty figure');
      var box = S.card();
      var body = h('div', { className: 'card-body omit' });

      var entries = [
        ['How busy the workers are',
          /* Already a sentence when it arrives -- opsJobsView.ts:393 writes
             "Nothing records how many workers exist or how many jobs each may
             hold, so in-flight work has no denominator to be drawn against."
             Printed as sent. Mapping it through a lookup keyed on codes the
             route does not emit is how every live read ends up on the
             fallback branch while a deleted field reads correctly. */
          (capacity && typeof capacity.reason === 'string' && capacity.reason)
            ? coded(capacity.reason)
            : 'Nothing records how many workers exist, so in-flight work has no denominator.'],
        ['Which attempt this is',
          'A retry after a failure creates a new job rather than incrementing a counter, so ' +
            'no row knows it is the second try. "Attempt 2 of 3" is absent from the platform, ' +
            'not just from this page.'],
        ['How far along a run is',
          'Each job carries a progress number with no history behind it, and a job that has ' +
            'reported nothing carries the same zero as one that has genuinely done nothing. ' +
            'Drawn nowhere rather than drawn as a bar that might be lying.'],
        ['Streaming',
          'The approved design draws a third lane for chat replies. Chat streaming creates no ' +
            'job at all, so a Streaming lane built from this read would report zero forever — ' +
            'which is the one reading that would be worse than leaving it out.'],
        ['Export',
          'The approved design offers an export. No route serves an export yet, so the pane ' +
            'does not draw a control that cannot succeed.']
      ];

      entries.forEach(function (entry) {
        var item = h('div', { className: 'omit-item' });
        item.appendChild(icon('layers'));
        var words = h('div');
        words.appendChild(h('div', { className: 'omit-title', text: entry[0] }));
        words.appendChild(h('div', { className: 'omit-desc', text: entry[1] }));
        item.appendChild(words);
        body.appendChild(item);
      });

      box.appendChild(body);

      var foot = h('div', { className: 'card-foot' });
      /* Rebuilt on every refresh like everything else here, so each carries a
         retain name or a keyboard operator parked on it loses focus. */
      var toHistory = S.link(S.paneHref('history') || HISTORY_FILE,
        'What happened', 'btn btn-sm');
      toHistory.setAttribute(RETAIN_ATTR, 'jobs-link-history');
      foot.appendChild(toHistory);
      var toAlerts = S.link(S.paneHref('alerts') || ALERTS_FILE,
        'Open Problems', 'btn btn-sm');
      toAlerts.setAttribute(RETAIN_ATTR, 'jobs-link-alerts');
      foot.appendChild(toAlerts);
      box.appendChild(foot);

      section.appendChild(box);
      return section;
    }

    load(true);
  });
})(window);
