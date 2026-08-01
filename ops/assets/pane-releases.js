/* App releases: which app version is where, and is the newest one healthy?

   The ladder is the pane. Each platform's tracks stack in promotion order, so
   "what is where" is answered by the shape of the thing rather than by reading
   a number out of a table. Everything else exists to answer the follow up: is
   this build behaving worse than the one before it.

   Two rules from the approved mock are load bearing and are the reason several
   things here are more awkward than they would otherwise be:

     - Store truth and field truth are never merged. The store reports intent
       (this track is set to 20% of people); usage data reports reality (73% of
       sessions are on the newest build). Both are shown as their own number.
       A single blended figure would be neither.
     - A source that is stale shows its last successful poll time rather than
       hiding its rows. A failed poll leaves the previous rows exactly where
       they are, so "as of 4 hours ago" is the honest label for them, and a
       blank card is not.

   WHAT THIS PANE READS

     GET /api/ops/releases?range=7d|30d|90d

   answering { data: { ... } } with, all fields optional except platforms and
   sources, and null meaning "not reported" rather than zero.

   Each field is marked with whether anything stores it today, because this
   block is the only specification a backend author has and a shape that reads
   as uniformly available is a shape that gets half-filled. "stored" means
   ops_release_snapshots or a shipped poller in Stadiora/Aria main holds it;
   "no source yet" means the pane renders it if it ever arrives and says "not
   reported" until then. Nothing here is speculative in the client: every
   marked-future field already degrades honestly.

     generatedAt   stored. ISO time the response was assembled
     platforms[]   { platform: 'ios'|'android', label, appIdentifier,
                     sourceKey, tracks[] }
       tracks[]    { track, versionName, versionCode, state,
                     rolloutBasisPoints, rolloutObservedSince, testerCount,
                     releasedAt, fetchedAt }               all stored
                   { installCount, activeCount }           no source yet:
                     ops_release_snapshots stores testerCount and nothing
                     beside it. The rollout line draws them when they arrive
                     and omits them otherwise.
     sources[]     stored. { key, label, description, status, lastSuccessAt,
                     lastAttemptAt, failureReason, pollSeconds, mode }
     production    stored, derived from the production track of each platform.
                   { versionName, builds[{ platform, versionCode }] }
     adoption      derivable. coverage_sessions is dimensioned by app version,
                   so the split exists even though no endpoint assembles it
                   yet. { latestVersion, sampleSessions,
                   buckets[{ key, label, basisPoints }] }
     crashFree     no source yet. There is no crash poller in opsPollerKeys
                   and no crash metric in telemetryMetricKeys, so this stays
                   "Not reported" until one ships.
                   { basisPoints, floorBasisPoints, windowHours }
     health        no source yet, for the same reason: signals[] has nothing
                   feeding it. { platform, current, previous, signals[] }
       signals[]   { key, label, unit, previous, current, verdict }
                   unit is one of percent_bp, rate_bp, seconds, millis,
                   per_1k. verdict is one of better, worse, slightly_worse,
                   no_change, unknown.
     candidate     no source yet. Aria quality is a separate project.
                   { versionName, status, reason, checkLabel, checkValue,
                     href }. href is followed only when it stays on this
                     origin.

   track.state is one of the normalized store states the backend already
   defines (processing, in_review, rejected, ready_for_release, rolling_out,
   halted, live, unknown), because the two stores describe the same ladder in
   different words and the dashboard shows one ladder. source.status is one of
   ok, failed, disabled, unconfigured, and the difference between the last two
   matters on this pane more than anywhere else: App Store Connect is
   unconfigured until somebody issues an API key for it, which is not the same
   fact as a poll that ran and was refused.

   Nothing here uses innerHTML. Widths that have to be computed are written as
   a custom property through the CSSOM, style.setProperty, and the stylesheet
   turns that into a width. Be exact about why that works, because the obvious
   "simplification" breaks it: the write does serialize into a style attribute
   in the DOM, but CSP style-src governs styles that arrive as markup, not
   programmatic CSSOM writes, so this path is not policed. Rewriting it as
   setAttribute('style', ...) would be, and would be blocked. */
(function (global) {
  'use strict';

  var shell = global.OpsShell;
  var session = global.OpsSession;
  var h = shell.h;
  var icon = shell.icon;

  /* ------------------------------------------------------- vocabulary */

  /* Track names as an operator says them, in promotion order. The order is
     the backend's (opsReleaseTracksByPlatform); the words are the mock's,
     because "Closed" and "Open" are what the Play console calls those tracks
     and "alpha" and "beta" are what the API calls them. */
  var TRACKS = {
    ios: [
      { key: 'internal', label: 'Internal', hint: 'TestFlight, team' },
      { key: 'external', label: 'External', hint: 'TestFlight, beta group' },
      { key: 'production', label: 'Production', hint: 'App Store' }
    ],
    android: [
      { key: 'internal', label: 'Internal', hint: 'internal testing' },
      { key: 'alpha', label: 'Closed', hint: 'alpha track' },
      { key: 'beta', label: 'Open', hint: 'beta track' },
      { key: 'production', label: 'Production', hint: 'Play Store' }
    ]
  };

  var PLATFORMS = {
    ios: { label: 'iOS, App Store Connect', sourceKey: 'app_store_connect' },
    android: { label: 'Android, Google Play', sourceKey: 'google_play' }
  };

  /* tone drives the badge class and, with it, the glyph. Status is never the
     colour on its own: every one of these carries its own words. */
  var STATES = {
    processing: { label: 'Processing', tone: 'info', icon: 'clock', chip: 'is-rolling' },
    in_review: { label: 'In review', tone: 'info', icon: 'clock', chip: 'is-rolling' },
    rejected: { label: 'Rejected', tone: 'crit', icon: 'warn', chip: 'is-blocked' },
    ready_for_release: { label: 'Ready for release', tone: 'ok', icon: 'check', chip: 'is-live' },
    rolling_out: { label: 'Rolling out', tone: 'info', icon: 'clock', chip: 'is-rolling' },
    halted: { label: 'Release stopped', tone: 'crit', icon: 'warn', chip: 'is-blocked' },
    live: { label: 'Live', tone: 'ok', icon: 'check', chip: 'is-live' },
    unknown: { label: 'Not reported', tone: '', icon: 'info', chip: '' }
  };

  var SOURCE_STATUS = {
    ok: { tone: 'ok', icon: 'check' },
    failed: { tone: 'warn', icon: 'warn' },
    disabled: { tone: '', icon: 'info' },
    unconfigured: { tone: '', icon: 'info' }
  };

  var VERDICTS = {
    better: { label: 'Better', tone: 'ok', cls: 'verdict-better' },
    worse: { label: 'Worse', tone: 'crit', cls: 'verdict-worse' },
    slightly_worse: { label: 'Slightly worse', tone: 'warn', cls: 'verdict-slightly-worse' },
    no_change: { label: 'No change', tone: '', cls: '' },
    unknown: { label: 'Not comparable', tone: '', cls: '' }
  };

  /* The mock's rule, kept as its own constant so it is one number rather than
     a sentence and an arithmetic that can drift apart. When the alert engine
     grows a rule for a stalled rollout this moves to the API, so that the pane
     and the alert cannot disagree about what stalled means. */
  var STALL_DAYS = 6;

  var FULL_ROLLOUT_BP = 10000;

  /* --------------------------------------------------------- formatting */

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  function pct(basisPoints, decimals) {
    var bp = num(basisPoints);
    if (bp === null) return null;
    var value = bp / 100;
    return (decimals ? value.toFixed(decimals) : String(Math.round(value))) + '%';
  }

  /* Total by construction: every caller here renders "not reported" from null,
     so a payload that sends a time as an object, an array, or anything else
     the Date constructor would coerce through its own toString has to leave by
     that door rather than by throwing. */
  function parseTime(iso) {
    if (typeof iso !== 'string' && typeof iso !== 'number') return null;
    if (iso === '') return null;
    var t;
    try { t = new Date(iso).getTime(); } catch (e) { return null; }
    return isFinite(t) ? t : null;
  }

  /* "12m ago", "4h ago", "6 days ago". Deliberately coarse: this is used to
     answer "is this fresh", and a to-the-second answer invites reading it as
     more precise than a fifteen minute poll can be. */
  function ago(iso) {
    var t = parseTime(iso);
    if (t === null) return null;
    var mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hours = Math.round(mins / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.round(hours / 24);
    return days === 1 ? '1 day ago' : days + ' days ago';
  }

  function daysSince(iso) {
    var t = parseTime(iso);
    if (t === null) return null;
    return Math.floor((Date.now() - t) / 86400000);
  }

  /* "22 Jul". The year is added once the date is not in the current one, so
     an old build cannot read as a recent one. */
  function shortDate(iso) {
    var t = parseTime(iso);
    if (t === null) return null;
    var d = new Date(t);
    var opts = { day: 'numeric', month: 'short' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    try { return d.toLocaleDateString(undefined, opts); } catch (e) { return d.toISOString().slice(0, 10); }
  }

  function count(v) {
    var n = num(v);
    if (n === null) return null;
    try { return n.toLocaleString(); } catch (e) { return String(n); }
  }

  /* 'seconds' meant milliseconds here, which is a figure a thousand times too
     small for a backend author who read the contract and sent what it asked
     for. The unit now means what it says, and 'millis' exists for the value
     the divisor was written for. */
  function signalValue(unit, value) {
    var n = num(value);
    if (n === null) return null;
    if (unit === 'percent_bp') return pct(n, 2);
    if (unit === 'rate_bp') return pct(n, 2);
    if (unit === 'seconds') return n.toFixed(1) + 's';
    if (unit === 'millis') return (n / 1000).toFixed(1) + 's';
    if (unit === 'per_1k') return (Math.round(n * 10) / 10).toFixed(1);
    return String(n);
  }

  /* An API supplied link is followed only when it stays on this origin. The
     only destination one is ever meant to name is another pane in this
     dashboard, and this is what makes that a constraint rather than a comment.
     Anything else renders as a plain badge instead of a link. */
  function safeHref(href) {
    if (typeof href !== 'string' || !href) return null;
    try {
      var url = new URL(href, global.location.href);
      if (url.origin !== global.location.origin) return null;
      return url.pathname + url.search + url.hash;
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------- small pieces */

  function badge(tone, iconName, text) {
    var b = h('span', { className: 'badge' + (tone ? ' badge-' + tone : '') });
    if (iconName) b.appendChild(icon(iconName));
    b.appendChild(h('span', { text: text }));
    return b;
  }

  /* A meter whose width is data. Set through the CSSOM rather than as a style
     attribute, because the page's CSP forbids the attribute. */
  function meter(basisPoints, tone) {
    var bp = Math.max(0, Math.min(FULL_ROLLOUT_BP, num(basisPoints) || 0));
    var wrap = h('div', { className: 'meter' });
    var fill = h('div', { className: 'meter-fill is-set' + (tone ? ' ' + tone : '') });
    fill.style.setProperty('--fill', String(bp / 100));
    wrap.appendChild(fill);
    return wrap;
  }

  /* The tile grid sits above the first band heading, so a tile label is the
     first heading under the pane title in the top bar and has to be an h2 for
     the levels to run in order. It takes its size from the class, as every
     heading in this stylesheet does. */
  function tile(label) {
    var card = h('div', { className: 'card tile' });
    card.appendChild(h('h2', { className: 'tile-label', text: label }));
    return card;
  }

  function metaLine(text) {
    return h('div', { className: 'tile-meta' }, [h('span', { text: text })]);
  }

  function notReported(reason) {
    var wrap = h('div', {});
    wrap.appendChild(h('div', { className: 'tile-value sm muted', text: 'Not reported' }));
    wrap.appendChild(metaLine(reason));
    return wrap;
  }

  /* --------------------------------------------------------- the ladder */

  function trackLabelsFor(platform) {
    return TRACKS[platform] || [];
  }

  function buildChip(track) {
    var state = STATES[track && track.state] || STATES.unknown;
    var hasBuild = !!(track && (track.versionName || track.versionCode));

    var chip = h('div', {
      className: 'build ' + (hasBuild ? state.chip : 'is-none')
    });

    if (!hasBuild) {
      chip.appendChild(h('span', { className: 'v', text: 'Nothing on this track' }));
      return chip;
    }

    var version = track.versionName || 'Unknown version';
    if (track.versionCode) version += ' (' + track.versionCode + ')';
    chip.appendChild(h('span', { className: 'v', text: version }));
    chip.appendChild(badge(state.tone, state.icon, state.label));

    var when = track.releasedAt ? shortDate(track.releasedAt) : null;
    if (when) chip.appendChild(h('span', { className: 'tiny muted', text: 'since ' + when }));

    return chip;
  }

  /* The line under the build: how much of the audience has it, and for how
     long that has been true. This is where a stalled gradual release becomes
     visible, which is the whole reason rolloutObservedSince is stored. */
  function rolloutLine(track) {
    var row = h('div', { className: 'rollout' });
    var bp = num(track && track.rolloutBasisPoints);

    var testers = count(track && track.testerCount);
    var installs = count(track && track.installCount);
    var active = count(track && track.activeCount);

    if (bp === null) {
      /* No staged rollout concept on this track, which is not the same as 0%.
         Tester counts are what a TestFlight or internal track has instead. */
      if (testers) {
        row.appendChild(h('span', { className: 'mono', text: testers }));
        row.appendChild(h('span', { className: 'muted', text: 'testers' }));
        if (installs) {
          row.appendChild(h('span', { className: 'mono', text: installs }));
          row.appendChild(h('span', { className: 'muted', text: 'installed' }));
        }
        if (active) {
          row.appendChild(h('span', { className: 'mono', text: active }));
          row.appendChild(h('span', { className: 'muted', text: 'active this week' }));
        }
      } else {
        row.appendChild(h('span', { className: 'muted', text: 'No staged rollout on this track. Tester numbers are not reported.' }));
      }
      return row;
    }

    if (bp >= FULL_ROLLOUT_BP) {
      row.appendChild(h('span', { className: 'muted', text: 'Everyone has it.' }));
      row.appendChild(meter(bp, 'ok'));
      row.appendChild(h('span', { className: 'mono', text: '100%' }));
      return row;
    }

    var stalledDays = daysSince(track.rolloutObservedSince);
    var stalled = stalledDays !== null && stalledDays >= STALL_DAYS;

    row.appendChild(meter(bp, stalled ? 'warn' : ''));
    row.appendChild(h('span', { className: 'mono', text: pct(bp) }));
    if (stalledDays !== null) {
      row.appendChild(h('span', {
        className: stalled ? '' : 'muted',
        text: stalledDays === 0
          ? 'moved today'
          : 'no change for ' + stalledDays + (stalledDays === 1 ? ' day' : ' days')
      }));
    }
    if (stalled) row.appendChild(badge('warn', 'warn', 'Rollout stalled'));
    return row;
  }

  function ladderCard(platform, data) {
    var meta = PLATFORMS[platform];
    var payload = null;
    (data.platforms || []).forEach(function (p) { if (p && p.platform === platform) payload = p; });

    var source = sourceFor(data, (payload && payload.sourceKey) || meta.sourceKey);
    var card = h('div', { className: 'card' });

    var head = h('div', { className: 'card-head' });
    head.appendChild(h('h3', { className: 'card-title', text: (payload && payload.label) || meta.label }));
    if (payload && payload.appIdentifier) {
      head.appendChild(h('span', { className: 'card-hint mono', text: payload.appIdentifier }));
    }
    head.appendChild(h('div', { className: 'spacer', 'aria-hidden': 'true' }));
    head.appendChild(freshnessBadge(source));
    card.appendChild(head);

    /* A source nobody has configured has no ladder to draw and no failure to
       report. Saying which of those it is, in the pane, is the difference
       between "we cannot see iOS" and "iOS is broken". */
    if (source && source.status === 'unconfigured') {
      card.appendChild(unconfiguredBlock(source, meta));
      return card;
    }

    var tracks = {};
    ((payload && payload.tracks) || []).forEach(function (t) { if (t && t.track) tracks[t.track] = t; });

    var ladder = h('div', { className: 'ladder' });
    trackLabelsFor(platform).forEach(function (def) {
      var row = h('div', { className: 'ladder-row' });
      row.appendChild(h('div', { className: 'ladder-track' }, [
        h('b', { text: def.label }),
        h('span', { className: 'tiny muted', text: def.hint })
      ]));

      var cell = h('div', { className: 'ladder-cell' });
      cell.appendChild(buildChip(tracks[def.key]));
      if (tracks[def.key]) cell.appendChild(rolloutLine(tracks[def.key]));
      row.appendChild(cell);
      ladder.appendChild(row);
    });
    card.appendChild(ladder);

    var foot = h('div', { className: 'card-foot' });
    foot.appendChild(icon('info'));
    foot.appendChild(h('span', {
      text: 'A rollout that has not moved in ' + STALL_DAYS + ' days is flagged. Gradual releases ' +
        'stall silently in the store, and a stalled rollout is indistinguishable from a ' +
        'forgotten one unless something says so. Starting, pausing, or resuming a rollout is ' +
        'done in the store console: this dashboard holds read-only access to both stores and ' +
        'has no button that would change one.'
    }));
    card.appendChild(foot);
    return card;
  }

  /* --------------------------------------------------------- freshness */

  function sourceFor(data, key) {
    var found = null;
    (data.sources || []).forEach(function (s) { if (s && s.key === key) found = s; });
    return found;
  }

  /* Order matters here. "Nothing is configured", "we chose not to poll" and
     "we polled and it failed" are three different facts and only the last one
     is a problem, so each is answered before the generic freshness wording is
     reached. */
  function freshnessBadge(source) {
    if (!source) return badge('', 'info', 'Freshness not reported');
    if (source.status === 'unconfigured') return badge('', 'info', 'Not connected');
    if (source.status === 'disabled') return badge('', 'info', 'Not polled');

    var when = ago(source.lastSuccessAt);
    if (source.status === 'failed') {
      return badge('warn', 'warn', when ? 'Sync stale, last poll ' + when : 'Sync failing, never polled');
    }
    if (source.mode === 'stream') return badge('ok', 'check', 'Streaming');

    var meta = SOURCE_STATUS[source.status] || SOURCE_STATUS.ok;
    return badge(meta.tone, meta.icon, when ? 'Synced ' + when : 'Synced, time not reported');
  }

  function unconfiguredBlock(source, meta) {
    var block = shell.stateBlock('lock', 'Not connected yet', [
      source.label + ' has no credential to poll with, so there is nothing stored for this ' +
        'platform and nothing is being hidden from you. This is not a failed poll: nothing has ' +
        'been tried and refused.',
      'It starts reporting as soon as an App Store Connect API key is issued and given to the ' +
        'operations API. Until then the ' + meta.label.split(',')[0] + ' ladder is blank rather ' +
        'than wrong.'
    ], 4);
    return block;
  }

  function sourcesCard(data) {
    var card = h('div', { className: 'card' });
    card.appendChild(h('div', { className: 'card-head' }, [
      h('h3', { className: 'card-title', text: 'Data sources and freshness' })
    ]));

    var body = h('div', { className: 'card-body' });
    var sources = data.sources || [];

    if (!sources.length) {
      body.appendChild(h('p', { className: 'state-desc', text: 'The operations API reported no data sources for this pane.' }));
      card.appendChild(body);
      return card;
    }

    sources.forEach(function (s) {
      var row = h('div', { className: 'sync-row' });
      row.appendChild(h('div', {}, [
        h('div', { className: 'strong', text: s.label || s.key }),
        h('div', { className: 'tiny muted', text: s.description || '' })
      ]));

      var meta = h('div', { className: 'sync-meta' });
      meta.appendChild(freshnessBadge(s));
      if (s.mode === 'stream') {
        meta.appendChild(h('span', { className: 'tiny muted mono', text: 'live' }));
      } else if (num(s.pollSeconds)) {
        meta.appendChild(h('span', { className: 'tiny muted mono', text: 'poll ' + Math.round(s.pollSeconds / 60) + 'm' }));
      }
      row.appendChild(meta);
      body.appendChild(row);
    });

    /* Named in the issue and in the mock: the two numbers stay two numbers.
       Only worth saying while there are two numbers to keep apart. */
    if (data.adoption) {
      var callout = h('div', { className: 'callout callout-info mt' });
      callout.appendChild(icon('info'));
      var text = h('div');
      text.appendChild(h('strong', { text: 'Store truth and field truth disagree, and that is useful.' }));
      text.appendChild(document.createTextNode(
        ' The store reports what a track is set to. Usage data reports what people actually have. ' +
        'Both are on this page as their own figure and neither is folded into the other, because a ' +
        'blended number would answer neither question.'
      ));
      callout.appendChild(text);
      body.appendChild(callout);
    }

    /* One callout per stale or failing source, each naming its own last
       successful poll, because "something is stale" is not actionable. */
    sources.forEach(function (s) {
      if (s.status !== 'failed') return;
      var when = ago(s.lastSuccessAt);
      var warn = h('div', { className: 'callout callout-warn mt-sm' });
      warn.appendChild(icon('warn'));
      warn.appendChild(h('div', {
        text: (s.label || s.key) + ' last polled successfully ' + (when || 'at a time it did not report') +
          '. The figures it feeds are from that poll and are labelled with it rather than hidden. ' +
          'Nothing has been lost: the previous rows are exactly where they were.'
      }));
      body.appendChild(warn);
    });

    card.appendChild(body);
    return card;
  }

  /* ------------------------------------------------------------- tiles */

  function productionTile(data) {
    var card = tile('Production version');
    var prod = data.production;

    if (!prod || !prod.versionName) {
      card.appendChild(notReported('No production build was reported by either store.'));
      return card;
    }

    card.appendChild(h('div', { className: 'tile-value sm', text: prod.versionName }));

    /* A build with no versionCode says so rather than printing "build null".
       Every other number on this pane falls back to words, and the empty-array
       fallback below never covered the case where the array is there and the
       number inside it is not. */
    var builds = (prod.builds || []).map(function (b) {
      var name = b.platform === 'ios' ? 'iOS' : b.platform === 'android' ? 'Android' : b.platform;
      var code = b.versionCode;
      var reported = code !== null && code !== undefined && code !== '';
      return reported ? name + ' build ' + code : name + ' build not reported';
    }).join(', ');
    card.appendChild(metaLine(builds || 'Build numbers not reported'));

    var row = h('div', { className: 'row row-wrap mt-sm' });
    ['ios', 'android'].forEach(function (platform) {
      var payload = null;
      (data.platforms || []).forEach(function (p) { if (p && p.platform === platform) payload = p; });
      var source = sourceFor(data, (payload && payload.sourceKey) || PLATFORMS[platform].sourceKey);
      var store = platform === 'ios' ? 'App Store' : 'Play';

      if (source && source.status === 'unconfigured') {
        row.appendChild(badge('', 'info', store + ', not connected'));
        return;
      }

      var track = null;
      ((payload && payload.tracks) || []).forEach(function (t) {
        if (t && t.track === 'production') track = t;
      });
      if (!track) { row.appendChild(badge('', 'info', store + ', not reported')); return; }

      var bp = num(track.rolloutBasisPoints);
      if (bp !== null && bp < FULL_ROLLOUT_BP) {
        row.appendChild(badge('warn', 'warn', store + ', ' + pct(bp)));
      } else {
        row.appendChild(badge('ok', 'check', store));
      }
    });
    card.appendChild(row);
    return card;
  }

  function adoptionTile(data) {
    var card = tile('On the newest version');
    var adoption = data.adoption;

    if (!adoption || !(adoption.buckets || []).length) {
      card.appendChild(notReported(
        'Version usage is reported by the apps themselves. No usage data has arrived for this window.'
      ));
      return card;
    }

    var latest = null;
    adoption.buckets.forEach(function (b) { if (b && b.key === 'latest') latest = b; });
    card.appendChild(h('div', {
      className: 'tile-value sm',
      text: latest ? pct(latest.basisPoints) : 'Not reported'
    }));

    var bar = h('div', { className: 'stackbar mt-sm' });
    var toneFor = { latest: 'seg-ok', previous: 'seg-info', older: 'seg-idle' };
    adoption.buckets.forEach(function (b) {
      var seg = h('span', { className: 'is-set ' + (toneFor[b.key] || 'seg-idle') });
      seg.style.setProperty('--seg', String(Math.max(0, num(b.basisPoints) || 0) / 100));
      bar.appendChild(seg);
    });
    card.appendChild(bar);

    /* The bar is decoration on its own, so the same split is written out. */
    card.appendChild(h('div', { className: 'tile-meta mt-sm' }, [
      h('span', {
        text: adoption.buckets.map(function (b) {
          return b.label + ' ' + (pct(b.basisPoints) || 'not reported');
        }).join(', ')
      })
    ]));

    if (num(adoption.sampleSessions)) {
      card.appendChild(h('p', {
        className: 'tiny muted',
        text: 'From ' + count(adoption.sampleSessions) + ' sessions that reported a version.'
      }));
    }
    return card;
  }

  function crashTile(data) {
    var card = tile('Sessions with no crash');
    var cf = data.crashFree;

    if (!cf || num(cf.basisPoints) === null) {
      card.appendChild(notReported('Crash reporting has not sent a figure for this window.'));
      return card;
    }

    var floor = num(cf.floorBasisPoints);
    /* A verdict colour is the outcome of a comparison, so with no floor to
       compare against the figure carries no colour. Painting it green while
       the line underneath says "No floor is set for this figure" told the
       operator something had passed when nothing had been checked. */
    var below = floor !== null && cf.basisPoints < floor;
    var verdictClass = floor === null ? '' : (below ? ' verdict-worse' : ' verdict-better');
    card.appendChild(h('div', {
      className: 'tile-value sm' + verdictClass,
      text: pct(cf.basisPoints, 2)
    }));

    var line = h('div', { className: 'tile-meta' });
    if (floor === null) {
      line.appendChild(h('span', { text: 'No floor is set for this figure.' }));
    } else {
      /* Above or below, in words, because the colour is not the message. */
      line.appendChild(icon(below ? 'warn' : 'check'));
      line.appendChild(h('span', {
        className: below ? 'verdict-worse' : '',
        text: (below ? 'Below' : 'Above') + ' the ' + pct(floor, 1) + ' floor'
      }));
    }
    card.appendChild(line);

    if (num(cf.windowHours)) {
      card.appendChild(h('p', { className: 'tiny muted', text: 'Last ' + cf.windowHours + ' hours.' }));
    }
    return card;
  }

  function candidateTile(data) {
    var c = data.candidate;
    var card = tile(c && c.versionName ? 'Candidate ' + c.versionName : 'Candidate build');

    if (!c) {
      card.appendChild(h('div', { className: 'tile-value sm muted', text: 'Not checked' }));
      card.appendChild(metaLine('No quality gate is reporting yet'));
      card.appendChild(h('p', {
        className: 'tiny muted',
        text: 'Aria quality, the pane that would answer this, ships after the first dashboard ' +
          'release as its own project.'
      }));
      return card;
    }

    var blocked = c.status === 'blocked';
    card.appendChild(h('div', {
      className: 'tile-value sm ' + (blocked ? 'verdict-worse' : ''),
      text: blocked ? 'Blocked' : c.status === 'clear' ? 'Clear' : 'Not checked'
    }));
    card.appendChild(metaLine(c.reason || (blocked ? 'A quality check has not passed' : 'Every quality check passed')));

    if (c.checkLabel) {
      var row = h('div', { className: 'row mt-sm' });
      var text = c.checkLabel + (c.checkValue ? ' ' + c.checkValue : '');
      /* Only a link when the API gave one. A hard-coded destination here
         would point at a pane that is deferred. */
      var href = safeHref(c.href);
      if (href) row.appendChild(h('a', { className: 'btn btn-sm', href: href, text: text }));
      else row.appendChild(h('span', { className: 'badge', text: text }));
      card.appendChild(row);
    }
    return card;
  }

  /* -------------------------------------------------------- health card */

  function healthCard(data) {
    var card = h('div', { className: 'card' });
    var health = data.health;

    var head = h('div', { className: 'card-head' });
    head.appendChild(h('h3', { className: 'card-title', text: 'Release health' }));
    head.appendChild(h('span', {
      className: 'card-hint',
      text: 'Does this build behave worse than the one before it?'
    }));
    card.appendChild(head);

    var body = h('div', { className: 'card-body' });

    if (!health || !(health.signals || []).length) {
      body.appendChild(shell.stateBlock('empty', 'No comparison yet', [
        'A health comparison needs two builds with usage data on the same platform. ' +
          'One or both of those is missing, so there is nothing to compare rather than ' +
          'nothing to worry about.'
      ], 4));
      card.appendChild(body);
      return card;
    }

    var wrap = h('div', { className: 'table-wrap' });
    var table = h('table', { className: 'data' });
    /* Same fallbacks as the visible column headers below. Interpolating the
       raw values read "undefined compared with undefined" to a screen reader
       on exactly the payloads the headers handle. */
    var platformName = health.platform === 'ios' ? 'iOS'
      : health.platform === 'android' ? 'Android' : 'the reported platform';
    var caption = h('caption', {
      className: 'sr-only',
      text: 'Release health, ' + (health.previous || 'the previous build') + ' compared with ' +
        (health.current || 'the current build') + ' on ' + platformName
    });
    table.appendChild(caption);

    var thead = h('thead');
    thead.appendChild(h('tr', {}, [
      h('th', { scope: 'col', text: 'Signal' }),
      h('th', { scope: 'col', className: 'right', text: health.previous || 'Previous' }),
      h('th', { scope: 'col', className: 'right', text: health.current || 'Current' }),
      h('th', { scope: 'col', text: 'Verdict' })
    ]));
    table.appendChild(thead);

    var tbody = h('tbody');
    health.signals.forEach(function (s) {
      var verdict = VERDICTS[s.verdict] || VERDICTS.unknown;
      var tr = h('tr');
      /* A row header, not a cell. Five rows of two numbers each are unreadable
         without one, and the stylesheet un-styles a tbody th back to a cell so
         the approved look is unchanged. */
      tr.appendChild(h('th', { scope: 'row', className: 'cell-strong', text: s.label || s.key }));
      tr.appendChild(h('td', { className: 'num', text: signalValue(s.unit, s.previous) || 'not reported' }));
      tr.appendChild(h('td', {
        className: 'num ' + verdict.cls,
        text: signalValue(s.unit, s.current) || 'not reported'
      }));
      tr.appendChild(h('td', {}, [badge(verdict.tone, null, verdict.label)]));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    body.appendChild(wrap);
    card.appendChild(body);

    card.appendChild(h('div', { className: 'card-foot' }, [
      h('span', {
        text: 'Health is always a comparison against the previous build on the same platform. ' +
          'An absolute crash rate tells you nothing about whether shipping was a good idea.'
      })
    ]));
    return card;
  }

  /* ------------------------------------------------------------- states */

  function skeleton() {
    var stack = h('div', { className: 'stack' });
    var grid = h('div', { className: 'grid g4' });
    for (var i = 0; i < 4; i++) {
      grid.appendChild(h('div', { className: 'card' }, [
        h('div', { className: 'card-body' }, [h('div', { className: 'skel skel-tile', 'aria-hidden': 'true' })])
      ]));
    }
    stack.appendChild(grid);
    for (var j = 0; j < 2; j++) {
      stack.appendChild(h('div', { className: 'card' }, [
        h('div', { className: 'card-body' }, [
          h('div', { className: 'skel skel-row', 'aria-hidden': 'true' }),
          h('div', { className: 'skel skel-row', 'aria-hidden': 'true' }),
          h('div', { className: 'skel skel-row', 'aria-hidden': 'true' }),
          h('div', { className: 'skel skel-row', 'aria-hidden': 'true' })
        ])
      ]));
    }
    return stack;
  }

  /* Which stores actually answered, in the words this pane uses for them
     elsewhere. An empty ladder means "there are no builds" only when both
     sources were asked and both said nothing; when one is not connected, or
     polled and was refused, the empty ladder is a store that cannot be seen
     and says nothing about what is on it. */
  function sourceStanding(data) {
    var answered = [];
    var silent = [];

    ['ios', 'android'].forEach(function (platform) {
      var payload = null;
      (data.platforms || []).forEach(function (p) { if (p && p.platform === platform) payload = p; });
      var source = sourceFor(data, (payload && payload.sourceKey) || PLATFORMS[platform].sourceKey);
      var name = (source && source.label) || PLATFORMS[platform].label.split(',')[0];

      if (!source) { silent.push(name + ' is not reporting a status at all'); return; }
      if (source.status === 'unconfigured') { silent.push(name + ' is not connected yet, so it has never been polled'); return; }
      if (source.status === 'disabled') { silent.push(name + ' is not being polled'); return; }
      if (source.status === 'failed') {
        var when = ago(source.lastSuccessAt);
        silent.push(name + (when ? ' last polled successfully ' + when : ' has never polled successfully'));
        return;
      }
      answered.push(name);
    });

    return { answered: answered, silent: silent };
  }

  function sentence(parts) {
    if (parts.length === 1) return parts[0] + '.';
    return parts.join('. ') + '.';
  }

  /* "Empty never means zero." The headline used to assert that both sources
     answered without checking whether either had, so a page with App Store
     Connect not connected and Google Play failing rendered "both sources
     answered, and both are empty" directly above two cards saying otherwise.
     The sentence is derived from the statuses now, so it can only say what the
     evidence underneath it says. */
  function emptyState(data) {
    var wrap = h('div', { className: 'stack' });
    var card = h('div', { className: 'card' });
    var standing = sourceStanding(data);

    var block;
    if (!standing.silent.length) {
      block = shell.stateBlock('release', 'No builds in flight', [
        'Neither store reports a build on any track. That is a real answer rather than a missing ' +
          'one: both sources answered, and both are empty.'
      ]);
    } else if (!standing.answered.length) {
      block = shell.stateBlock('warn', 'Neither store can be seen', [
        'There is nothing on the ladders because no store answered, not because there are no ' +
          'builds. ' + sentence(standing.silent),
        'Whatever is on those tracks right now, this page cannot tell you. Fix the sources below ' +
          'and this becomes a real answer.'
      ]);
    } else {
      block = shell.stateBlock('warn', 'One store answered, one could not be seen', [
        standing.answered.join(' and ') + ' answered and reports no build on any track. ' +
          sentence(standing.silent),
        'So this is not "there are no builds". It is one empty store and one that cannot be read, ' +
          'and the half that cannot be read could have anything on it.'
      ]);
    }

    card.appendChild(block);
    wrap.appendChild(card);
    wrap.appendChild(sourcesCard(data));
    return wrap;
  }

  /* Two failures that need different sentences. A 404 means this pane's API is
     not deployed yet, which is a release fact; anything else is a fault. */
  function errorState(err, retry) {
    var wrap = h('div', { className: 'notbuilt' });
    var card = h('div', { className: 'card' });
    var missing = err && err.code === 'ops_route_missing';

    var block = missing
      ? shell.stateBlock('build', 'This pane has no API yet', [
        'The operations API does not answer /api/ops/releases on this deployment. The page is ' +
          'built and is asking for the right thing; the endpoint behind it has not shipped.',
        'Nothing is wrong with your session and nothing is being hidden.'
      ])
      : shell.stateBlock('warn', 'Could not load app releases', [
        (err && err.message) || 'The operations API did not answer.',
        'Nothing has been signed out. The stored store data is untouched.'
      ]);

    var row = h('div', { className: 'row mt' });
    var again = h('button', { className: 'btn btn-primary', type: 'button', text: 'Try again' });
    again.addEventListener('click', retry);
    row.appendChild(again);
    block.appendChild(row);

    card.appendChild(block);
    wrap.appendChild(card);
    return wrap;
  }

  /* ------------------------------------------------------------ the pane */

  function hasAnyBuild(data) {
    var found = false;
    (data.platforms || []).forEach(function (p) {
      ((p && p.tracks) || []).forEach(function (t) {
        if (t && (t.versionName || t.versionCode)) found = true;
      });
    });
    return found;
  }

  function render(data, platformFilter) {
    var stack = h('div', { className: 'stack' });

    if (!hasAnyBuild(data)) return emptyState(data);

    var grid = h('div', { className: 'grid g4' });
    grid.appendChild(productionTile(data));
    grid.appendChild(adoptionTile(data));
    grid.appendChild(crashTile(data));
    grid.appendChild(candidateTile(data));
    stack.appendChild(grid);

    var band = h('div', { className: 'band-head' });
    band.appendChild(h('h2', { className: 'band-title', text: 'Which version is where' }));
    stack.appendChild(band);

    ['ios', 'android'].forEach(function (platform) {
      if (platformFilter !== 'both' && platformFilter !== platform) return;
      stack.appendChild(ladderCard(platform, data));
    });

    var band2 = h('div', { className: 'band-head' });
    band2.appendChild(h('h2', { className: 'band-title', text: 'Is the newest one healthy?' }));
    stack.appendChild(band2);

    var pair = h('div', { className: 'grid g2' });
    pair.appendChild(healthCard(data));
    pair.appendChild(sourcesCard(data));
    stack.appendChild(pair);

    if (data.generatedAt) {
      stack.appendChild(h('p', {
        className: 'tiny muted',
        text: 'Read from the operations API ' + (ago(data.generatedAt) || 'at an unreported time') +
          '. The stores are polled on their own cadence, shown above.'
      }));
    }
    return stack;
  }

  /* ------------------------------------------------------------- wiring */

  var content = null;
  var platformFilter = 'both';
  var lastData = null;
  var requestSeq = 0;
  var currentRange = null;
  /* The range the newest request was issued for, set when the request goes out
     rather than when it comes back. lastData cannot stand in for this: it is
     still null while the first request is in flight, which is exactly the
     window in which the shell announces the filters the pane booted with. */
  var requestedRange;
  var everRequested = false;

  function paint(node) {
    if (!content) return;
    content.textContent = '';
    content.appendChild(node);
  }

  function load(range) {
    var seq = ++requestSeq;
    if (!content) return;
    requestedRange = range;
    everRequested = true;

    content.setAttribute('aria-busy', 'true');
    paint(h('div', {}, [
      h('p', { className: 'sr-only', role: 'status', text: 'Loading app releases' }),
      skeleton()
    ]));

    session.call('/api/ops/releases', { query: { range: range || undefined } })
      .then(function (payload) {
        if (seq !== requestSeq) return;
        content.removeAttribute('aria-busy');
        lastData = (payload && payload.data) || {};
        paint(render(lastData, platformFilter));
      })
      .catch(function (err) {
        if (seq !== requestSeq) return;
        content.removeAttribute('aria-busy');
        lastData = null;
        paint(errorState(err, function () { load(currentRange); }));
      });
  }

  /* This pane's own control goes beside the shell's rather than into a second
     bar underneath the first. The shell builds the filter bar before it asks a
     pane for its contents, but it does not put the shell in the document until
     afterwards, so the bar is not reachable while this runs and the append
     waits for ops:ready.

     That is the same small move OpsOperate.paneFilters makes for the operate
     panes. It is written out here rather than reached for across operate.js,
     because this page loads none of the rest of that file and a shared module
     pulled in for six lines is a dependency it does not need. */
  function paneFilters(nodes) {
    function install() {
      var bar = document.querySelector('.filterbar');
      if (!bar) return;
      nodes.forEach(function (n) { if (n) bar.appendChild(n); });
    }
    if (document.querySelector('.filterbar')) install();
    else global.addEventListener('ops:ready', install, { once: true });
  }

  /* The platform switch is a view of what has already been fetched, so it
     repaints rather than reloading. Both platforms are always requested,
     because the tiles above the ladders are cross-platform. */
  function platformControl() {
    var wrap = h('div', { className: 'filter-item filter-gap' });
    wrap.appendChild(h('span', { className: 'filter-label', text: 'Platform' }));
    var seg = h('div', { className: 'seg', role: 'group', 'aria-label': 'Platform' });
    [
      { v: 'both', l: 'Both' },
      { v: 'ios', l: 'iOS' },
      { v: 'android', l: 'Android' }
    ].forEach(function (o) {
      var b = h('button', { type: 'button', text: o.l, 'aria-pressed': String(o.v === platformFilter) });
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(seg.querySelectorAll('button'), function (x) {
          x.setAttribute('aria-pressed', 'false');
        });
        b.setAttribute('aria-pressed', 'true');
        platformFilter = o.v;
        if (lastData) paint(render(lastData, platformFilter));
        shell.announce('Showing ' + o.l.toLowerCase() + ' releases');
      });
      seg.appendChild(b);
    });
    wrap.appendChild(seg);
    return wrap;
  }

  function refreshControl() {
    var b = h('button', { className: 'btn btn-sm filter-gap', type: 'button' });
    b.appendChild(icon('refresh'));
    b.appendChild(h('span', { text: 'Refresh' }));
    b.addEventListener('click', function () {
      shell.announce('Reloading app releases');
      load(currentRange);
    });
    return b;
  }

  /* The shell calls this once, with the pane's content region, after the
     session is confirmed and the document has finished parsing. A pane with no
     registration renders the not-built state, so there is no flag anywhere
     claiming this pane is built: the fact is this file being on the page. */
  shell.definePane('releases', function (host) {
    content = host;
    paneFilters([
      platformControl(),
      h('div', { className: 'spacer', 'aria-hidden': 'true' }),
      refreshControl()
    ]);

    currentRange = shell.filters().range;
    load(currentRange);
  });

  global.addEventListener('ops:filters', function (e) {
    if (!content) return;
    var range = e.detail && e.detail.range;
    /* Asked already, for this exact range, so nothing to do. The old test was
       "same range and we have data", which could not short circuit the very
       first ops:filters because that one arrives while the first request is
       still out and lastData is still null. On a remote API with a local pane
       script that is the ordering production takes, and it issued the same
       GET twice on every load, discarding the first response. */
    if (everRequested && range === requestedRange) return;
    currentRange = range;
    load(currentRange);
  });
})(window);
