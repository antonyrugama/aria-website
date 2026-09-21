/* App releases: which app version is where, and is the newest one healthy?

   Remodelled onto the v2 design system through assets/shell-pane-v2.js. The
   surface changed; the read did not. GET /api/ops/releases is untouched, and
   every field drawn here is a field the v1 pane already drew.

   THE ONE CLAIM THIS PANE MAKES

   A version sitting at 20% of the field because the Play rollout is
   deliberately staged at 20% is a completely different fact from a version
   sitting at 20% because nobody is updating, and this pane has to say which.
   The two numbers that answer it come from different places and are never
   merged into one:

     store truth   track.rolloutBasisPoints, the share of people the store is
                   releasing to, and rolloutObservedSince, the day that share
                   last moved. Per platform.
     field truth   adoption.buckets, the share of sessions that reported each
                   version. One figure across the whole field, because that is
                   the shape the contract defines: the reading is dimensioned
                   by app version, not by version and platform.

   So the pipeline's fourth stage carries the store's number, the version
   share band carries the field's, and shareReading() is the one sentence that
   reads the two together. A single blended "adoption" figure would answer
   neither question, and a field share drawn without its store ceiling invites
   the wrong one: a build the store is holding at 20% CANNOT be on more than
   20% of the field, and reading that as "nobody is updating" sends somebody
   to chase a problem that does not exist.

   WHAT THIS PANE READS

     GET /api/ops/releases

   answering { data: { ... } }, every field optional, and null meaning "not
   reported" rather than zero. Each is marked with whether anything stores it
   today, because this block is the only specification a backend author has
   and a list that reads as uniformly available is a list that gets
   half-filled.

     generatedAt   stored. ISO time the response was assembled
     platforms[]   stored. { platform: 'ios'|'android', label, appIdentifier,
                     sourceKey, tracks[], unknownTracks[] }
       unknownTracks[] stored. Track names the store reported that are not
                     rungs of the ladder this pane knows. Named rather than
                     dropped, and counted as builds in flight, so a store
                     reporting only an unknown track is not read as a store
                     with nothing on it.
       tracks[]    { track, versionName, versionCode, state,
                     rolloutBasisPoints, rolloutObservedSince, testerCount,
                     releasedAt, fetchedAt }               all stored
                   { installCount, activeCount }           no source yet
     sources[]     stored. { key, label, description, status, lastSuccessAt,
                     lastAttemptAt, failureReason, pollSeconds, mode }
     production    stored, derived from each platform's production track.
                   { versionName, builds[{ platform, versionCode }] }
     adoption      derivable, not yet assembled by any route.
                   { latestVersion, sampleSessions,
                     buckets[{ key, label, basisPoints }] }
     crashFree     no source yet. { basisPoints, floorBasisPoints,
                     windowHours }
     health        no source yet. { platform, current, previous, signals[] }
       signals[]   { key, label, unit, previous, current, verdict }
     candidate     no source yet. { versionName, status, reason, checkLabel,
                     checkValue, href }

   track.state is one of the normalised store states the backend defines
   (processing, in_review, rejected, ready_for_release, rolling_out, halted,
   live, unknown), because the two stores describe one ladder in different
   words. source.status is one of ok, failed, disabled, unconfigured, and the
   difference between the last two matters more here than anywhere else: App
   Store Connect is unconfigured until somebody issues an API key for it,
   which is not the same fact as a poll that ran and was refused.

   NO RANGE, AND NO CHART. The release snapshot table is upserted per track,
   so it holds what is on that track now and no history to window. The
   registry therefore gives this pane no range control and says so where one
   would have been, and the mock's adoption curve is not drawn: a curve needs
   a series and there is no stored series to draw one from. Every departure
   from the mock is listed in ops/README.md under "App releases on v2".

   Nothing here uses innerHTML and no style attribute is written into markup.
   One value on the page comes from data and lands in CSS — a segment width —
   so it is written through the CSSOM as a custom property and the stylesheet
   turns it into a width. That is not a workaround: style-src 'self' governs
   styles arriving as markup, and a CSSOM property write is not one. The same
   value passed through h() as a style key would be dropped, and written with
   setAttribute('style', ...) would be blocked. Colours never take that route
   at all: a tone is a class aria.css already declares. */
(function (global) {
  'use strict';

  var S = global.OpsPaneShell;
  var h = S.h;
  var icon = S.icon;
  var fmt = S.fmt;

  var ENDPOINT = '/api/ops/releases';

  /* ------------------------------------------------------- vocabulary */

  var PLATFORMS = {
    ios: { label: 'iOS', store: 'the App Store', sourceKey: 'app_store_connect' },
    android: { label: 'Android', store: 'the Play Store', sourceKey: 'google_play' }
  };

  /* The promotion path each store ships through, in order, production last.
     Non-production tracks hold real builds with real testers on them, so they
     are named under the pipeline rather than dropped. */
  var TRACKS = {
    ios: [
      { key: 'internal', label: 'Internal' },
      { key: 'external', label: 'External' },
      { key: 'production', label: 'Production' }
    ],
    android: [
      { key: 'internal', label: 'Internal' },
      { key: 'alpha', label: 'Closed' },
      { key: 'beta', label: 'Open' },
      { key: 'production', label: 'Production' }
    ]
  };

  var PRODUCTION = 'production';

  /* Where each normalised store state sits on the four-stage pipeline, and
     what to call it there. `stage` is the stage the build has reached.

     Tone is never the whole message. Every state carries a glyph and a word
     as well, so the pane reads the same with no colour at all. */
  var STATES = {
    processing: { stage: 0, label: 'Processing', verdict: 'Processing', tone: 'info', glyph: 'clock' },
    in_review: { stage: 1, label: 'In review', verdict: 'In review', tone: 'info', glyph: 'clock' },
    rejected: { stage: 1, label: 'Rejected', verdict: 'Rejected', tone: 'bad', glyph: 'x' },
    ready_for_release: { stage: 2, label: 'Ready', verdict: 'Ready to release', tone: 'ok', glyph: 'check' },
    rolling_out: { stage: 3, label: 'Rolling out', verdict: 'Rolling out', tone: 'info', glyph: 'clock' },
    halted: { stage: 2, label: 'Stopped', verdict: 'Release stopped', tone: 'bad', glyph: 'warn' },
    live: { stage: 3, label: 'Live', verdict: 'Live', tone: 'ok', glyph: 'check' },
    unknown: { stage: 0, label: 'Not reported', verdict: 'Not reported', tone: '', glyph: 'info' }
  };

  var STAGES = ['Built', 'In review', 'Released', 'Rolled out'];
  var ROLLED_OUT = 3;

  /* Pill and pipeline-node classes per tone, as a table so an unrecognised
     tone draws a plain pill rather than no pill at all. */
  var PILL = { ok: 'pill up', warn: 'pill warn', bad: 'pill down', info: 'pill info', '': 'pill' };
  var NODE = { ok: 'n-ok', warn: 'n-warn', bad: 'n-bad', info: 'n-info', '': '' };

  var VERDICTS = {
    better: { label: 'Better', tone: 'ok', cls: 'v-better' },
    worse: { label: 'Worse', tone: 'bad', cls: 'v-worse' },
    slightly_worse: { label: 'Slightly worse', tone: 'warn', cls: 'v-worse' },
    no_change: { label: 'No change', tone: '', cls: '' },
    unknown: { label: 'Not comparable', tone: '', cls: '' }
  };

  /* A staged rollout that has not moved in this many days is called stalled.
     One number rather than a sentence and an arithmetic that can drift apart.
     When the alert engine grows a rule for a stalled rollout this moves to
     the API, so the pane and the alert cannot disagree about what stalled
     means. */
  var STALL_DAYS = 6;
  var FULL_ROLLOUT_BP = 10000;

  /* The share buckets in the order the bar draws them, each taking a tone
     class aria.css declares. `older` is the residue rather than a version, so
     it takes an ink tone, which is the one tone with no .tone-* class of its
     own and is declared in this pane's stylesheet. */
  var BUCKET_TONE = { latest: 'tone-cyan', previous: 'tone-violet', older: 'tone-older' };
  var BUCKET_ORDER = ['latest', 'previous', 'older'];

  /* The chip carries the share and nothing else, so the widest it can ever
     be is the four glyphs of "100%" plus its padding. That is 42.4px in
     either theme, and the narrowest bar that carries chips at all is 497px
     at 561px of viewport, which puts the fit at 9.7% of the bar. A segment
     is given a chip at more than twice that, so the chip cannot be clipped
     by any bucket split or any viewport this pane is reachable at.

     An earlier build put the version label in the chip too. That made the
     width unbounded, the threshold a guess, and at 16/70/14 it clipped the
     tail — which was the percentage — and lost the number entirely between
     561px and 650px. The label lives on the key, the share lives on the
     bar; neither is in two places at once.

     The same predicate decides the chip in the bar and the `has-chip`
     marker on the key beside it, so the two can never disagree about which
     buckets already carry their share. */
  var LABEL_MIN_BP = 2000;

  function segmentBp(bucket) {
    return Math.max(0, Math.min(FULL_ROLLOUT_BP, num(bucket.basisPoints) || 0));
  }

  function hasChip(bucket) {
    return segmentBp(bucket) >= LABEL_MIN_BP;
  }

  /* --------------------------------------------------------- formatting */

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  function pct(basisPoints, decimals) {
    var bp = num(basisPoints);
    if (bp === null) return null;
    var value = bp / 100;
    return (decimals ? value.toFixed(decimals) : String(Math.round(value))) + '%';
  }

  function daysSince(iso) {
    var hoursAgo = fmt.hoursSince(iso);
    return hoursAgo === null ? null : Math.floor(hoursAgo / 24);
  }

  function days(n) { return n + (n === 1 ? ' day' : ' days'); }

  function state(track) {
    var key = track && track.state;
    return (typeof key === 'string' &&
      Object.prototype.hasOwnProperty.call(STATES, key)) ? STATES[key] : STATES.unknown;
  }

  function hasBuild(track) {
    return !!(track && (track.versionName || track.versionCode));
  }

  function pill(tone, glyph, text) {
    var node = h('span', { className: PILL[tone] || PILL[''] });
    if (glyph) node.appendChild(icon(glyph));
    node.appendChild(h('span', { text: text }));
    return node;
  }

  function words(list) {
    if (!list.length) return '';
    if (list.length === 1) return list[0];
    return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }

  /* ------------------------------------------------- reading the payload */

  /* Both known platforms always, then anything else the payload named. A
     platform the response omits entirely is still drawn, because "iOS is
     missing from the answer" is a fact about the pane's own coverage and an
     absent row states it by saying nothing at all. */
  function platformsOf(data) {
    var order = ['ios', 'android'];
    ((data && data.platforms) || []).forEach(function (p) {
      if (p && typeof p.platform === 'string' && p.platform && order.indexOf(p.platform) === -1) {
        order.push(p.platform);
      }
    });
    return order;
  }

  function payloadFor(data, platform) {
    var found = null;
    ((data && data.platforms) || []).forEach(function (p) {
      if (p && p.platform === platform) found = p;
    });
    return found;
  }

  function trackOf(payload, key) {
    var found = null;
    ((payload && payload.tracks) || []).forEach(function (t) {
      if (t && t.track === key) found = t;
    });
    return found;
  }

  function sourceFor(data, key) {
    var found = null;
    ((data && data.sources) || []).forEach(function (s) { if (s && s.key === key) found = s; });
    return found;
  }

  function sourceOfPlatform(data, platform) {
    var payload = payloadFor(data, platform);
    var key = (payload && payload.sourceKey) ||
      (PLATFORMS[platform] && PLATFORMS[platform].sourceKey) || platform;
    return sourceFor(data, key);
  }

  function platformName(platform) {
    return (PLATFORMS[platform] && PLATFORMS[platform].label) || platform;
  }

  function storeName(platform) {
    return (PLATFORMS[platform] && PLATFORMS[platform].store) || platformName(platform);
  }

  function unknownTracksOf(payload) {
    var list = payload && payload.unknownTracks;
    if (!Array.isArray(list)) return [];
    return list.filter(function (t) { return typeof t === 'string' && t !== ''; });
  }

  /* Whether either store reports a build anywhere, which is what decides
     between the pane and the empty state.

     Unknown tracks count. They are not rungs, so they are not in tracks[],
     and walking only the rungs meant a store whose single build sat on a
     track outside the ladder produced the empty state — whose whole sentence
     is that both stores answered and both are empty. That is precisely the
     payload the unknownTracks field exists to describe. */
  function hasAnyBuild(data) {
    var found = false;
    ((data && data.platforms) || []).forEach(function (p) {
      ((p && p.tracks) || []).forEach(function (t) { if (hasBuild(t)) found = true; });
      if (unknownTracksOf(p).length) found = true;
    });
    return found;
  }

  /* ------------------------------------------------- the rollout reading

     Everything the pane says about one platform's production rollout, derived
     once so the pipeline stage, the end pill, the hero line and the share
     sentence cannot disagree with each other.

       kind    'none'    the store reports no staged rollout on this track,
                         which is not the same fact as 0%
               'full'    the whole field is being served this build
               'staged'  the store is holding it at a share of the field
               'stalled' staged, and that share has not moved in STALL_DAYS */
  function rolloutReading(track) {
    var bp = num(track && track.rolloutBasisPoints);
    if (bp === null) return { kind: 'none', bp: null, sinceDays: null };
    var sinceDays = daysSince(track && track.rolloutObservedSince);
    if (bp >= FULL_ROLLOUT_BP) return { kind: 'full', bp: bp, sinceDays: sinceDays };
    return {
      kind: (sinceDays !== null && sinceDays >= STALL_DAYS) ? 'stalled' : 'staged',
      bp: bp,
      sinceDays: sinceDays
    };
  }

  /* ---------------------------------------------------------- the hero */

  function heroTone(rows) {
    var tone = 'st-ok';
    rows.forEach(function (row) {
      if (row.state.tone === 'bad') tone = 'st-bad';
      else if (tone !== 'st-bad' && (row.state.tone === 'warn' || row.rollout.kind === 'stalled')) {
        tone = 'st-warn';
      }
    });
    return tone;
  }

  function heroTitle(data, rows) {
    var version = data.production && data.production.versionName;
    if (!version) return 'No production build is reported';

    /* "Live on the Play Store" is a claim about the whole field, so a store
       still holding the build back at a share of it does not qualify however
       the store labels the track. Android sitting at 20% is the case this
       pane exists to show, and a headline reading "live on both stores" over
       it is the flattening the remodel is meant to prevent. */
    var out = rows.filter(function (row) {
      return hasBuild(row.track) && row.state.stage >= ROLLED_OUT &&
        (row.rollout.kind === 'full' || row.rollout.kind === 'none');
    });
    if (out.length && out.length === rows.length) {
      return version + ' is live on ' + words(out.map(function (row) {
        return storeName(row.platform);
      }));
    }
    return version + ' is the production build';
  }

  /* The one line under the title. Only facts that were reported reach it, and
     it is absent rather than padded when none were. */
  function heroSub(data, rows) {
    var parts = [];

    var latest = latestBucket(data);
    if (latest) parts.push(pct(latest.basisPoints) + ' of sessions');

    var cf = data.crashFree;
    if (cf && num(cf.basisPoints) !== null) parts.push('crash free ' + pct(cf.basisPoints, 1));

    rows.forEach(function (row) {
      if (row.rollout.kind === 'stalled') {
        parts.push(platformName(row.platform) + ' held at ' + pct(row.rollout.bp) +
          ' for ' + days(row.rollout.sinceDays));
      } else if (row.rollout.kind === 'staged') {
        parts.push(platformName(row.platform) + ' staged at ' + pct(row.rollout.bp));
      }
    });

    return parts.join(' · ');
  }

  function hero(data, rows) {
    var section = h('section', { className: 'hero ' + heroTone(rows) });
    section.appendChild(h('div', { className: 'hero-orb', 'aria-hidden': 'true' }, [
      h('i'), h('i'), h('b')
    ]));

    var middle = h('div');
    middle.appendChild(h('div', { className: 'hero-title', text: heroTitle(data, rows) }));
    var sub = heroSub(data, rows);
    if (sub) middle.appendChild(h('div', { className: 'hero-sub', text: sub }));
    section.appendChild(middle);

    var chips = h('div', { className: 'hero-chips' });
    rows.forEach(function (row) {
      chips.appendChild(pill(row.state.tone, row.state.glyph,
        platformName(row.platform) + ' · ' + row.state.verdict));
    });
    section.appendChild(chips);
    return section;
  }

  /* ------------------------------------------------------- the pipeline */

  /* One row per platform, describing that platform's production track: where
     the build is, how far it has got, and the verdict. */
  function pipeRow(data, row) {
    var payload = payloadFor(data, row.platform);
    var source = sourceOfPlatform(data, row.platform);

    var el = h('div', { className: 'pipe-row' });

    var who = h('div', { className: 'pipe-app' });
    who.appendChild(h('div', { className: 't-main', text: platformName(row.platform) }));
    who.appendChild(h('div', { className: 't-sub', text: subtitleFor(payload, row.track, source) }));
    var stale = staleMark(row, source);
    if (stale) who.appendChild(stale);
    el.appendChild(who);

    el.appendChild(pipeTrack(row));

    var end = h('div', { className: 'pipe-end' });
    end.appendChild(verdictPill(row, source));
    el.appendChild(end);
    return el;
  }

  /* The age of the numbers, attached to the numbers.
     Every figure on this row was read from one store poller, so when that
     poller is failing the row is a photograph of the past and has to say so
     where it is read rather than in a card further down the page. "6 days
     unchanged" from a reading taken two days ago is a claim about last
     Thursday, and an operator who takes it for today will wait on a rollout
     that may already have moved. */
  function staleMark(row, source) {
    if (!source || source.status !== 'failed') return null;
    if (!hasBuild(row.track)) return null;
    var since = source.lastSuccessAt ? fmt.since(source.lastSuccessAt) : null;
    return h('div', { className: 'mt-xs' }, [
      pill('warn', 'warn', (since && since !== fmt.none)
        ? 'Read ' + since + ' ago'
        : 'Never read')
    ]);
  }

  function subtitleFor(payload, track, source) {
    if (track && track.versionName) {
      return track.versionName + (track.versionCode ? ' · build ' + track.versionCode : '');
    }
    if (track && track.versionCode) return 'build ' + track.versionCode;
    if (source && source.status === 'unconfigured') return 'Store not connected';
    if (!payload) return 'Not in the answer';
    return 'No production build reported';
  }

  /* The four stages. `reached` is the last stage this build has got to, so
     everything before it is done, the stage itself is current, and everything
     after it is still to come. A stage carries a figure only where one is
     stored: an empty line is the absence, not a sentence about it. */
  function pipeTrack(row) {
    var ol = h('ol', { className: 'pipe-track' });
    var reached = hasBuild(row.track) ? row.state.stage : -1;

    STAGES.forEach(function (label, i) {
      var isNow = i === reached;
      var done = i < reached;
      var tone = done ? 'ok' : isNow ? row.state.tone : '';
      if (isNow && i === ROLLED_OUT && row.rollout.kind === 'stalled') tone = 'warn';

      var step = h('li', {
        className: 'pipe-step ' + (done ? 'done' : isNow ? 'now' : 'todo') +
          (NODE[tone] ? ' ' + NODE[tone] : '')
      });

      /* Which of the three states this stage is in, to a reader that cannot
         see the rail behind it or the glyph inside the node. aria-current is
         the standard for the one stage a process is at; the other two states
         have no attribute of their own, so they take a word, first in the
         step so it prefixes the stage name rather than trailing it.

         The current stage needs no word beside aria-current: a screen reader
         announces the attribute, and a redundant "Now" would be read twice.
         Stadiora/Aria#10646. */
      if (isNow) step.setAttribute('aria-current', 'step');
      else step.appendChild(h('span', { className: 'sr', text: done ? 'Done. ' : 'Not reached. ' }));

      var glyph = null;
      if (done) glyph = 'check';
      else if (isNow) {
        glyph = i === ROLLED_OUT
          ? (row.rollout.kind === 'stalled' ? 'warn' : 'person')
          : row.state.glyph;
      }
      step.appendChild(h('div', { className: 'pipe-node' }, [glyph ? icon(glyph) : null]));

      /* The stage name is what the node means. The current stage names the
         store's own word for it instead where the two differ, because "In
         review" and "Rejected" are the same stage and opposite facts. */
      step.appendChild(h('div', {
        className: 'pipe-label',
        text: (isNow && row.state.label !== label) ? row.state.label : label
      }));

      var figure = stageFigure(i, row, done || isNow);
      if (figure) step.appendChild(h('div', { className: 'pipe-date', text: figure }));
      ol.appendChild(step);
    });
    return ol;
  }

  /* The store's number, on the stage it belongs to. Stage 4 carries the share
     the store is serving and the day it last moved; the pill beside the row
     carries the verdict word. Neither repeats the other, and the build number
     is not among them: the row subtitle above already states it. */
  function stageFigure(i, row, active) {
    if (!active) return null;
    var track = row.track;
    if (i === 2) return (track && fmt.utcDay(track.releasedAt)) || null;
    if (i === ROLLED_OUT) {
      if (row.rollout.kind === 'none') return 'share not reported';
      if (row.rollout.kind === 'full') return '100% of devices';
      return pct(row.rollout.bp) + ' of devices' + (row.rollout.sinceDays === null
        ? ''
        : row.rollout.sinceDays === 0
          ? ' · moved today'
          : ' · ' + days(row.rollout.sinceDays) + ' unchanged');
    }
    return null;
  }

  /* The verdict, in a word or three. It never restates the figure the stage
     beside it already carries.

     Staged and stalled are two words for one number because they are the two
     readings this pane exists to tell apart, and "Stalled" alone reads as
     "nobody is updating" — which is the wrong one. A rollout the store has
     parked says so first, and says it has not moved second. */
  function verdictPill(row, source) {
    if (!hasBuild(row.track)) {
      if (source && source.status === 'unconfigured') return pill('', 'lock', 'Not connected');
      if (source && source.status === 'failed') return pill('warn', 'warn', 'Cannot be read');
      if (source && source.status === 'disabled') return pill('', 'info', 'Not polled');
      return pill('', 'info', 'Nothing reported');
    }
    if (row.state.tone === 'bad') return pill('bad', row.state.glyph, row.state.verdict);
    if (row.rollout.kind === 'stalled') return pill('warn', 'warn', 'Staged, not moving');
    if (row.rollout.kind === 'staged') return pill('info', 'clock', 'Staged by the store');
    if (row.state.stage >= ROLLED_OUT) return pill('ok', 'check', 'Rolled out');
    return pill(row.state.tone, row.state.glyph, row.state.verdict);
  }

  /* Tracks below production that hold a build: real builds with real testers,
     so they are named. Compact, because the question this pane owns is where
     production is. */
  function testTracks(data, platform) {
    var payload = payloadFor(data, platform);
    var rows = [];
    (TRACKS[platform] || []).forEach(function (def) {
      if (def.key === PRODUCTION) return;
      var track = trackOf(payload, def.key);
      if (!hasBuild(track)) return;
      rows.push({ platform: platform, label: def.label, track: track });
    });
    return rows;
  }

  function testTracksBlock(data, platforms) {
    var rows = [];
    platforms.forEach(function (platform) {
      testTracks(data, platform).forEach(function (row) { rows.push(row); });
    });
    if (!rows.length) return null;

    var wrap = h('div', { className: 'pipe-also' });
    wrap.appendChild(h('h4', { className: 'inset-title', text: 'Also on test tracks' }));
    var kv = h('div', { className: 'kv mt-sm' });
    rows.forEach(function (row) {
      var st = state(row.track);
      var value = h('span', { className: 'v' });
      value.appendChild(h('span', { className: 'code', text: versionWords(row.track) }));
      value.appendChild(pill(st.tone, st.glyph, st.verdict));
      if (num(row.track.testerCount) !== null) {
        value.appendChild(h('span', {
          className: 'tiny muted',
          text: fmt.plural(row.track.testerCount, 'tester')
        }));
      }
      kv.appendChild(kvRow(platformName(row.platform) + ' · ' + row.label, value));
    });
    wrap.appendChild(kv);
    return wrap;
  }

  function versionWords(track) {
    if (track && track.versionName) {
      return track.versionName + (track.versionCode ? ' · ' + track.versionCode : '');
    }
    if (track && track.versionCode) return 'build ' + track.versionCode;
    return 'version not reported';
  }

  /* A store is free to report a track outside the ladder, and one does. There
     are exactly two honest things to do with it: leave it off the ladder,
     where it has no rung, and say that it exists. */
  function unknownTracksBlock(data, platforms) {
    var named = [];
    platforms.forEach(function (platform) {
      unknownTracksOf(payloadFor(data, platform)).forEach(function (track) {
        named.push(platformName(platform) + ' ' + track);
      });
    });
    if (!named.length) return null;

    var box = h('div', { className: 'callout mt' });
    box.appendChild(icon('warn'));
    box.appendChild(h('div', {}, [
      h('b', {
        text: named.length === 1
          ? 'One track has no rung on this ladder: '
          : named.length + ' tracks have no rung on this ladder: '
      }),
      h('span', { text: words(named) + '. Open the store console to see what is on them.' })
    ]));
    return box;
  }

  /* ---------------------------------------------------- the version share */

  function adoptionOf(data) {
    var adoption = data && data.adoption;
    if (!adoption || !Array.isArray(adoption.buckets)) return null;
    var usable = adoption.buckets.filter(function (b) {
      return b && num(b.basisPoints) !== null;
    });
    return usable.length ? adoption : null;
  }

  function latestBucket(data) {
    var adoption = adoptionOf(data);
    if (!adoption) return null;
    var latest = null;
    adoption.buckets.forEach(function (b) {
      if (b && b.key === 'latest' && num(b.basisPoints) !== null) latest = b;
    });
    return latest;
  }

  /* Known buckets in drawing order, then anything else the payload named. */
  function bucketOrder(adoption) {
    var known = [];
    var extra = [];
    BUCKET_ORDER.forEach(function (key) {
      adoption.buckets.forEach(function (b) { if (b && b.key === key) known.push(b); });
    });
    adoption.buckets.forEach(function (b) {
      if (b && BUCKET_ORDER.indexOf(b.key) === -1) extra.push(b);
    });
    return known.concat(extra);
  }

  function bucketLabel(bucket) {
    return bucket.label || bucket.key || 'unnamed';
  }

  function shareCard(data, rows) {
    var card = S.card();
    var adoption = adoptionOf(data);

    card.appendChild(S.cardHead('Version share',
      adoption && adoption.latestVersion ? 'Newest is ' + adoption.latestVersion : null));

    var body = h('div', { className: 'card-body' });

    if (!adoption) {
      body.appendChild(S.stateBlock('empty', 'Version share is not reported', [
        'Version usage is reported by the apps themselves and no usage figures ' +
          'have arrived, so nothing here is a zero.'
      ], 4));
      card.appendChild(body);
      return card;
    }

    var buckets = bucketOrder(adoption);
    var stack = h('div', { className: 'share-stack' });
    stack.appendChild(shareBar(buckets));
    stack.appendChild(shareLegend(buckets));

    var reading = shareReading(data, rows);
    if (reading) stack.appendChild(h('p', { className: 'share-line', text: reading }));

    body.appendChild(stack);
    card.appendChild(body);

    if (num(adoption.sampleSessions) !== null) {
      card.appendChild(h('div', { className: 'card-foot' }, [
        icon('info'),
        h('span', {
          text: 'From ' + fmt.plural(adoption.sampleSessions, 'session') +
            ' that reported a version.'
        })
      ]));
    }
    return card;
  }

  /* role="img" is children-presentational, so anything inside this bar is
     announced to nobody and the accessible NAME has to carry the reading.
     It is built from the same buckets the segments are, so a bucket cannot
     appear in one and not the other. */
  function shareBar(buckets) {
    var bar = h('div', {
      className: 'stackbar',
      role: 'img',
      'aria-label': 'Version share: ' + words(buckets.map(function (bucket) {
        return bucketLabel(bucket) + ' ' + (pct(bucket.basisPoints) || 'not reported');
      }))
    });

    buckets.forEach(function (bucket) {
      var bp = segmentBp(bucket);
      var seg = h('i', {
        className: BUCKET_TONE[bucket.key] || 'tone-older',
        'aria-hidden': 'true'
      });
      /* Through the CSSOM, because the page's CSP refuses a style attribute.
         The stylesheet reads --w and turns it into the width; the colour is
         the class above and is never written from here. */
      seg.style.setProperty('--w', (bp / 100) + '%');
      /* The chip is a reading surface with its own --surface fill: a segment
         fill is data and cannot also carry ink (monorepo #10293). Only where
         the segment is wide enough to hold one; a narrower bucket reads its
         share off the key instead, which is what `has-chip` below arranges.
         The bucket name is NOT repeated here: the key states it, tied to
         this segment by the same tone. */
      if (hasChip(bucket)) {
        seg.appendChild(h('b', { text: pct(bp) }));
      }
      bar.appendChild(seg);
    });
    return bar;
  }

  /* The share is ONE fact and takes ONE slot at a given width.

     A bucket wide enough for a chip has already said its share inside the bar,
     so its key says the bucket name and stops. A bucket too narrow for a chip
     has no other carrier, so its key keeps the number. The marker is a class
     rather than a missing element because below 560px no segment carries a
     chip at all, and the same key has to put the number back; that half is the
     stylesheet's, keyed on this exact class name. */
  function shareLegend(buckets) {
    var legend = h('div', { className: 'legend' });
    buckets.forEach(function (bucket) {
      legend.appendChild(h('span', {
        className: hasChip(bucket) ? 'share-key has-chip' : 'share-key'
      }, [
        h('i', { className: BUCKET_TONE[bucket.key] || 'tone-older', 'aria-hidden': 'true' }),
        h('span', { text: bucketLabel(bucket) }),
        h('span', {
          className: 'share-key-pct',
          text: pct(bucket.basisPoints) || 'not reported'
        })
      ]));
    });
    return legend;
  }

  /* THE SENTENCE: store truth and field truth, read together, once.

     A share the store is capping and a share nobody is taking up are the same
     number and opposite problems, and this is the only place on the pane that
     says which one is on screen. It is derived from the two figures rather
     than written, so it cannot claim a ceiling that is not there — and it
     names the ceiling on the platform that has it rather than on this bar,
     because the bar is every platform at once and one store capping its own
     devices does not cap the whole field. */
  function shareReading(data, rows) {
    if (!latestBucket(data)) return null;

    var capped = rows.filter(function (row) {
      return row.rollout.kind === 'staged' || row.rollout.kind === 'stalled';
    });
    if (capped.length) {
      return words(capped.map(function (row) {
        return platformName(row.platform) + ' at ' + pct(row.rollout.bp);
      })) + ': a ceiling the store set, so that part of the share is not take-up.';
    }

    var full = rows.filter(function (row) { return row.rollout.kind === 'full'; });
    if (full.length) {
      return words(full.map(function (row) { return platformName(row.platform); })) +
        ' at 100%: no store is capping the rollout, so this share is take-up.';
    }
    return null;
  }

  /* -------------------------------------------------------- the stores */

  function storesCard(data) {
    var card = S.card();
    var note = pollNote(data);
    card.appendChild(S.cardHead('What the stores say', null, note ? [note] : null));

    var body = h('div', { className: 'card-body col' });
    var sources = (data && data.sources) || [];

    if (!sources.length) {
      body.appendChild(S.stateBlock('plug', 'No store connection is reported', [
        'The operations API named no data source for this pane, so nothing on ' +
          'it is dated and nothing here is a zero.'
      ], 4));
      card.appendChild(body);
      return card;
    }

    sources.forEach(function (source) { body.appendChild(storeBlock(data, source)); });
    card.appendChild(body);
    return card;
  }

  function pollNote(data) {
    var seconds = null;
    ((data && data.sources) || []).forEach(function (s) {
      if (seconds === null && num(s && s.pollSeconds) !== null) seconds = s.pollSeconds;
    });
    if (seconds === null) return null;
    return pill('', 'clock', 'Polled every ' + Math.round(seconds / 60) + ' min');
  }

  /* Status words first, then freshness. "Nothing is configured", "we chose not
     to poll it" and "we polled it and were refused" are three different facts
     and only the last is a problem, so each is answered before the generic
     freshness wording is reached.

     A failing source states only that it is failing. How old its numbers are
     is carried once, as a stamp on the block below, and the relative age rides
     with the figures themselves on the pipeline; the pill saying it too would
     be the third telling of one fact. */
  function freshness(source) {
    if (!source) return { dot: '', pill: pill('', 'info', 'Freshness not reported') };
    if (source.status === 'unconfigured') return { dot: '', pill: pill('', 'lock', 'Not connected') };
    if (source.status === 'disabled') return { dot: '', pill: pill('', 'info', 'Not polled') };
    if (source.status === 'failed') {
      return {
        dot: 'warn',
        pill: pill('warn', 'warn', source.lastSuccessAt ? 'Failing' : 'Failing · never read')
      };
    }
    if (source.mode === 'stream') return { dot: 'ok', pill: pill('ok', 'check', 'Streaming') };
    var when = source.lastSuccessAt ? fmt.ago(source.lastSuccessAt) : null;
    return {
      dot: 'ok',
      pill: pill('ok', 'check', (when && when !== fmt.none)
        ? 'Read ' + when
        : 'Read, time not reported')
    };
  }

  function storeBlock(data, source) {
    var box = h('div', { className: 'inset' });
    var fresh = freshness(source);

    var head = h('div', { className: 'row' });
    head.appendChild(h('span', {
      className: 'dot' + (fresh.dot ? ' ' + fresh.dot : ''),
      'aria-hidden': 'true'
    }));
    head.appendChild(h('h4', { className: 'inset-title', text: source.label || source.key }));
    head.appendChild(h('span', { className: 'sp' }, [fresh.pill]));
    box.appendChild(head);

    var kv = h('div', { className: 'kv mt-sm' });
    var platform = platformOfSource(data, source);
    var track = platform ? trackOf(payloadFor(data, platform), PRODUCTION) : null;

    if (source.status === 'unconfigured') {
      kv.appendChild(kvRow('Production', h('span', {
        className: 'v dim',
        text: 'No credential has been issued, so this store has never been read'
      })));
    } else if (hasBuild(track)) {
      var st = state(track);
      var version = h('span', { className: 'v' });
      version.appendChild(h('span', { className: 'code', text: versionWords(track) }));
      version.appendChild(pill(st.tone, st.glyph, st.verdict));
      kv.appendChild(kvRow('Production', version));
      kv.appendChild(kvRow('Staged rollout', h('span', {
        className: 'v dim', text: rolloutWords(rolloutReading(track), track)
      })));
    } else {
      kv.appendChild(kvRow('Production', h('span', {
        className: 'v dim', text: 'No build reported on this track'
      })));
    }

    /* Only where the pill above does not already carry the age. A source
       reading normally says "Read a minute ago" up there, and the same instant
       spelled out to the minute below it is the same fact twice. */
    if (source.status !== 'ok' && source.lastSuccessAt && fmt.utcStamp(source.lastSuccessAt)) {
      kv.appendChild(kvRow('Last good read', h('span', {
        className: 'v num dim', text: fmt.utcStamp(source.lastSuccessAt)
      })));
    }
    if (source.status === 'failed' && source.failureReason) {
      kv.appendChild(kvRow('Since then', h('span', {
        className: 'v is-warn', text: source.failureReason
      })));
    }
    box.appendChild(kv);
    return box;
  }

  function kvRow(key, value) {
    return h('div', {}, [h('span', { className: 'k', text: key }), value]);
  }

  function rolloutWords(rollout, track) {
    if (rollout.kind === 'none') return 'Not reported on this track';
    if (rollout.kind === 'full') {
      var since = fmt.utcDay(track && track.rolloutObservedSince);
      return '100%' + (since ? ', since ' + since : '');
    }
    return pct(rollout.bp) + (rollout.sinceDays === null
      ? ''
      : rollout.sinceDays === 0 ? ', moved today' : ', unchanged for ' + days(rollout.sinceDays));
  }

  function platformOfSource(data, source) {
    var found = null;
    ((data && data.platforms) || []).forEach(function (p) {
      if (!found && p && p.sourceKey && p.sourceKey === source.key) found = p.platform;
    });
    if (found) return found;
    Object.keys(PLATFORMS).forEach(function (key) {
      if (!found && PLATFORMS[key].sourceKey === source.key) found = key;
    });
    return found;
  }

  /* ------------------------------------------------------ is it healthy */

  function healthCard(data) {
    var card = S.card();
    var cf = data && data.crashFree;

    /* No card head: the band above carries the question and its window, and
       a card that repeats its own section's title is the double captioning
       this remodel exists to remove. */
    var body = h('div', { className: 'card-body col' });
    body.appendChild(crashFreeRow(cf));

    var health = data && data.health;
    var comparable = health && Array.isArray(health.signals) && health.signals.length;
    if (!comparable) {
      body.appendChild(S.stateBlock('empty', 'No comparison yet', [
        'A comparison needs two builds with usage figures on one platform. One ' +
          'or both is missing, so there is nothing to compare rather than ' +
          'nothing to worry about.'
      ], 3));
    }
    card.appendChild(body);

    if (comparable) card.appendChild(healthTable(health));
    appendCandidate(card, data);
    return card;
  }
  function healthWindow(data) {
    var cf = data && data.crashFree;
    return (cf && num(cf.windowHours) !== null) ? 'Last ' + fmt.hours(cf.windowHours) : null;
  }

  function crashFreeRow(cf) {
    if (!cf || num(cf.basisPoints) === null) {
      return h('p', {
        className: 'figure-note',
        text: 'Crash reporting has sent no figure, so no crash-free rate is drawn.'
      });
    }

    var floor = num(cf.floorBasisPoints);
    var below = floor !== null && cf.basisPoints < floor;
    var row = h('div', { className: 'figure-row' });

    /* A verdict colour is the outcome of a comparison, so with no floor to
       compare against, the figure carries none. Painting it green beside "no
       floor is set" told the operator something had passed when nothing had
       been checked. */
    row.appendChild(h('div', {
      className: 'figure-val' + (floor === null ? '' : below ? ' v-worse' : ' v-better'),
      text: pct(cf.basisPoints, 2)
    }));
    row.appendChild(h('span', { className: 'muted tiny', text: 'sessions with no crash' }));

    var note = h('div', {
      className: 'figure-note' + (floor === null ? '' : below ? ' is-warn' : ' is-ok')
    });
    if (floor === null) {
      note.appendChild(h('span', { text: 'No floor is set for this figure' }));
    } else {
      note.appendChild(icon(below ? 'warn' : 'check'));
      note.appendChild(h('span', {
        text: (below ? 'Below' : 'Above') + ' the ' + pct(floor, 1) + ' floor'
      }));
    }
    row.appendChild(note);
    return row;
  }

  var HEALTH_CAPTION_ID = 'releasesHealthCaption';

  /* Four columns of which three are numbers and a pill, and none of them
     wraps. Under about 360px the table's own minimum is wider than the
     viewport, and a table that will not shrink takes the whole document
     sideways with it. So it scrolls inside its own box instead.

     A box that scrolls has to be reachable from a keyboard, or the columns
     past the edge belong to pointer users only. tabindex makes it focusable
     and role="region" gives the focus stop a name, which is the table's own
     caption rather than a second sentence that could drift from it. */
  function healthTable(health) {
    var table = h('table', { className: 'tbl' });
    /* The same fallbacks the visible headers use. Interpolating the raw values
       read "undefined compared with undefined" to a screen reader on exactly
       the payloads the headers below handle. */
    table.appendChild(h('caption', {
      className: 'sr',
      id: HEALTH_CAPTION_ID,
      text: 'Release health: ' + (health.previous || 'the previous build') +
        ' compared with ' + (health.current || 'the current build') + ' on ' +
        (health.platform ? platformName(health.platform) : 'the reported platform')
    }));

    table.appendChild(h('thead', {}, [
      h('tr', {}, [
        h('th', { scope: 'col', text: 'Signal' }),
        h('th', { scope: 'col', className: 'r', text: health.previous || 'Previous' }),
        h('th', { scope: 'col', className: 'r', text: health.current || 'Current' }),
        h('th', { scope: 'col', text: 'Verdict' })
      ])
    ]));

    var tbody = h('tbody');
    health.signals.forEach(function (signal) {
      var verdict = VERDICTS[signal.verdict] || VERDICTS.unknown;
      var tr = h('tr');
      /* A row header, not a cell: a row of two bare numbers is unreadable
         without one. */
      tr.appendChild(h('th', {
        scope: 'row', className: 't-main', text: signal.label || signal.key || 'Unnamed signal'
      }));
      tr.appendChild(h('td', {
        className: 'r num', text: signalValue(signal.unit, signal.previous) || 'not reported'
      }));
      tr.appendChild(h('td', {
        className: 'r num' + (verdict.cls ? ' ' + verdict.cls : ''),
        text: signalValue(signal.unit, signal.current) || 'not reported'
      }));
      tr.appendChild(h('td', {}, [pill(verdict.tone, null, verdict.label)]));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    return h('div', {
      className: 'tbl-scroll',
      tabindex: '0',
      role: 'region',
      'aria-labelledby': HEALTH_CAPTION_ID
    }, [table]);
  }

  /* 'seconds' meant milliseconds once, which is a figure a thousand times too
     small for a backend author who read the contract and sent what it asked
     for. The unit means what it says, and 'millis' exists for the other. */
  function signalValue(unit, value) {
    var n = num(value);
    if (n === null) return null;
    if (unit === 'percent_bp' || unit === 'rate_bp') return pct(n, 2);
    if (unit === 'seconds') return n.toFixed(1) + 's';
    if (unit === 'millis') return (n / 1000).toFixed(1) + 's';
    if (unit === 'per_1k') return (Math.round(n * 10) / 10).toFixed(1);
    return fmt.int(n);
  }

  /* Drawn only when the answer carries one. Nothing feeds this field today,
     and a permanent "not checked" tile is a caption for a fact nobody asked
     about; if a candidate ever arrives it is real, and it is drawn. */
  function appendCandidate(card, data) {
    var candidate = data && data.candidate;
    if (!candidate) return;

    var blocked = candidate.status === 'blocked';
    var foot = h('div', { className: 'card-foot' });
    foot.appendChild(icon(blocked ? 'warn' : 'info'));
    foot.appendChild(h('span', {
      text: (candidate.versionName ? candidate.versionName + ': ' : 'Next build: ') +
        (blocked ? 'blocked' : candidate.status === 'clear' ? 'clear to ship' : 'not checked') +
        (candidate.reason ? ' · ' + candidate.reason : '')
    }));

    if (candidate.checkLabel) {
      var label = candidate.checkLabel + (candidate.checkValue ? ' ' + candidate.checkValue : '');
      /* A link only where the API gave one that stays on this origin. */
      var href = S.safeHref(candidate.href);
      foot.appendChild(h('span', { className: 'sp' }, [
        href ? S.link(href, label) : h('span', { className: 'pill', text: label })
      ]));
    }
    card.appendChild(foot);
  }

  /* -------------------------------------------------------- empty state */

  /* Which stores actually answered. An empty ladder means "there are no
     builds" only when both sources were asked and both said nothing; when one
     is not connected, or polled and was refused, the empty ladder is a store
     that cannot be seen and says nothing about what is on it. */
  function sourceStanding(data, platforms) {
    var answered = [];
    var silent = [];

    platforms.forEach(function (platform) {
      var source = sourceOfPlatform(data, platform);
      var name = (source && source.label) || platformName(platform);

      if (!source) { silent.push(name + ' is not reporting a status at all'); return; }
      if (source.status === 'unconfigured') {
        silent.push(name + ' is not connected yet, so it has never been read');
        return;
      }
      if (source.status === 'disabled') { silent.push(name + ' is not being polled'); return; }
      if (source.status === 'failed') {
        var when = source.lastSuccessAt ? fmt.ago(source.lastSuccessAt) : null;
        silent.push(name + ((when && when !== fmt.none)
          ? ' was last read successfully ' + when
          : ' has never been read successfully'));
        return;
      }
      answered.push(name);
    });

    return { answered: answered, silent: silent };
  }

  function sentence(parts) { return parts.join('. ') + '.'; }

  /* Empty never means zero. The headline is derived from the statuses, so it
     can only claim what the evidence underneath it says: a page with App Store
     Connect not connected and Google Play failing once rendered "both sources
     answered, and both are empty" directly above two cards saying otherwise. */
  function emptyState(data, platforms) {
    var standing = sourceStanding(data, platforms);
    var block;

    if (!standing.silent.length) {
      block = S.stateBlock('ship', 'No builds in flight', [
        'Neither store reports a build on any track. That is a real answer ' +
          'rather than a missing one: both sources answered, and both are empty.'
      ]);
    } else if (!standing.answered.length) {
      block = S.stateBlock('warn', 'Neither store can be read', [
        'There is nothing here because no store answered, not because there are ' +
          'no builds. ' + sentence(standing.silent),
        'Whatever is on those tracks right now, this page cannot tell you.'
      ]);
    } else {
      block = S.stateBlock('warn', 'One store answered, one could not be read', [
        words(standing.answered) + ' answered and reports no build on any track. ' +
          sentence(standing.silent),
        'So this is not "there are no builds". It is one empty store and one ' +
          'that cannot be read.'
      ]);
    }

    var box = S.card();
    box.appendChild(block);

    var wrap = h('div', { className: 'stack' });
    wrap.appendChild(box);
    wrap.appendChild(storesCard(data));
    return wrap;
  }

  function failedSources(data) {
    return ((data && data.sources) || []).filter(function (s) {
      return s && s.status === 'failed';
    });
  }

  /* ------------------------------------------------------------- the pane */

  S.definePane('releases', function (content) {
    var region = S.region(content);
    var loadToken = 0;

    /* This pane listens for no filter change, because the registry gives it
       none: a store track carries the state it is in now, and there is no
       window to choose over a table that holds no history. The filter bar
       states that absence where the control would have been. */

    function load() {
      var token = ++loadToken;
      region.loading([
        { type: 'block', height: 78 },
        { type: 'rows', count: 4 },
        { type: 'block', height: 190 }
      ]);

      /* No querystring: the registry gives this pane no filter and the route
         takes no parameter. Through the shell's reader, so the same-origin
         fixture hook covers the states a live API will not produce on demand,
         which here is most of them — a store that has never been connected, a
         poll that was refused, a rollout stalled for a week. */
      S.read({ paneId: 'releases', endpoint: ENDPOINT })
        .then(function (result) {
          if (token !== loadToken) return;
          render(result.data || {});
        })
        .catch(function (err) {
          if (token !== loadToken) return;
          region.failed(err, load);
        });
    }

    function render(data) {
      var platforms = platformsOf(data);

      /* Empty is a real state with a real trigger and a narrow one: no store
         reports a build on any track, including the tracks this pane has no
         rung for. */
      if (!hasAnyBuild(data)) {
        region.empty(emptyState(data, platforms));
        return;
      }

      /* Read once, so the hero, the pipeline, the end pill and the share
         sentence cannot disagree about one platform's rollout. */
      var rows = platforms.map(function (platform) {
        var track = trackOf(payloadFor(data, platform), PRODUCTION);
        return {
          platform: platform,
          track: track,
          state: state(track),
          rollout: rolloutReading(track)
        };
      });

      var wrap = h('div', { className: 'stack' });
      wrap.appendChild(hero(data, rows));

      var where = S.band('Where each app is');
      var pipeCard = S.card();
      var pipeBody = h('div', { className: 'card-body' });
      var pipe = h('div', { className: 'pipe' });
      rows.forEach(function (row) { pipe.appendChild(pipeRow(data, row)); });
      pipeBody.appendChild(pipe);

      var also = testTracksBlock(data, platforms);
      if (also) pipeBody.appendChild(also);
      var unknown = unknownTracksBlock(data, platforms);
      if (unknown) pipeBody.appendChild(unknown);

      pipeCard.appendChild(pipeBody);
      where.appendChild(pipeCard);
      wrap.appendChild(where);

      var field = S.band('Who is on which version');
      var grid = h('div', { className: 'grid g-main share-grid' });
      grid.appendChild(shareCard(data, rows));
      grid.appendChild(storesCard(data));
      field.appendChild(grid);
      wrap.appendChild(field);

      var healthy = S.band('Is the newest one healthy', healthWindow(data));
      healthy.appendChild(healthCard(data));
      wrap.appendChild(healthy);

      if (data.generatedAt && fmt.ago(data.generatedAt) !== fmt.none) {
        wrap.appendChild(h('p', {
          className: 'tiny muted',
          text: 'Read from the operations API ' + fmt.ago(data.generatedAt) + '.'
        }));
      }

      /* Degraded is the pane on screen with part of it unreadable, which here
         is a store that was polled and refused. Not connected and not polled
         are known absences the pane states in words, not reads that failed. */
      if (failedSources(data).length) region.degraded(wrap);
      else region.show(wrap);
    }

    load();
  });
})(window);
