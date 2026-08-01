/* The problems API, in the words the dashboard says it in.

   Every machine value the operations API can send has exactly one plain
   English rendering, and this is where it lives. Two panes read this API,
   Problems and Overview, and a second copy of these strings is how the same
   state ends up described two different ways on two screens an operator moves
   between in one incident.

   Nothing here touches the DOM or the network. It is the vocabulary, the small
   derivations that both panes need, and nothing else.

   Every lookup falls back to the raw value rather than to a blank. An
   unrecognised state is a fact worth showing; what this file will not do is
   pretend to have translated one it has never seen. */
(function (global) {
  'use strict';

  var SEVERITY_LABEL = { critical: 'Critical', warning: 'Warning', info: 'Info' };
  var SEVERITY_TONE = { critical: 'crit', warning: 'warn', info: 'info' };

  var STATUS_LABEL = {
    open: 'Nobody on it',
    acknowledged: 'Someone is on it',
    closed: 'Closed',
    pending: 'Not fired yet'
  };
  var STATUS_TONE = { open: 'crit', acknowledged: 'info', closed: '', pending: '' };

  var CLOSE_REASON_LABEL = {
    resolved: 'Resolved',
    no_action_needed: 'Nothing to do',
    self_resolved: 'Fixed itself'
  };

  var EVENT_LABEL = {
    detected: 'First seen',
    fired: 'Fired',
    acknowledged: 'Taken on',
    condition_cleared: 'The condition stopped',
    condition_returned: 'The condition came back',
    notification_failed: 'A notification did not go out',
    closed: 'Closed'
  };
  var EVENT_TONE = {
    detected: '', fired: 'crit', acknowledged: 'ok',
    condition_cleared: 'ok', condition_returned: 'warn',
    notification_failed: 'warn', closed: 'ok'
  };

  var EVALUATION_LABEL = {
    ok: 'Checking normally',
    firing: 'Firing now',
    insufficient_data: 'Not enough data to judge',
    disabled: 'Turned off',
    error: 'The check itself failed'
  };
  var EVALUATION_TONE = {
    ok: 'ok', firing: 'crit', insufficient_data: 'warn', disabled: 'idle', error: 'crit'
  };

  /* Why a rule cannot reach a verdict, each reading as the end of the sentence
     "it cannot judge yet because ...". */
  var INSUFFICIENT_REASON = {
    no_source_configured: 'nothing is feeding it yet',
    no_samples: 'nothing has come in to measure',
    below_minimum_samples: 'too few measurements so far',
    no_baseline: 'there is no history to compare against'
  };

  var CHANNEL_STATUS = {
    ok: { tone: 'ok', label: 'Connected' },
    failed: { tone: 'crit', label: 'Not getting through' },
    unconfigured: { tone: 'warn', label: 'Not configured' }
  };

  /* Why a channel is not getting through, as the end of "because ...". */
  var CHANNEL_FAILURE = {
    auth: 'it was refused',
    timeout: 'it timed out',
    transport: 'it could not connect',
    http_error: 'the other end returned an error',
    malformed: 'the message was rejected',
    config: 'the setup is wrong'
  };

  /* The pane each problem's work happens in, as the shell files them. The API
     sends the pane key and its label; turning the key into a URL is the only
     thing the client adds, and this is the one place it happens. */
  var PANE_FILE = {
    overview: 'index.html',
    'jobs-live': 'jobs-live.html',
    'run-history': 'run-history.html',
    spend: 'spend.html',
    releases: 'releases.html'
  };

  var CATEGORIES = [
    { value: 'all', label: 'All categories' },
    { value: 'ai_reliability', label: 'AI reliability' },
    { value: 'cost', label: 'Cost' },
    { value: 'release', label: 'Release' },
    { value: 'infrastructure', label: 'Infrastructure' }
  ];

  var SEVERITIES = [
    { value: 'all', label: 'All' },
    { value: 'critical', label: 'Critical' },
    { value: 'warning', label: 'Warning' },
    { value: 'info', label: 'Info' }
  ];

  /* A read answers with at most 100 problems and offers no second page. That is
     a generous ceiling for a pane whose whole argument is that alert volume
     should stay low, but a page that silently showed the first hundred of two
     hundred would be lying.

     Which hundred matters more than the number does. They come back worst
     first and then oldest, so a full page keeps the oldest problem in each
     severity and drops the most recent ones. Anything worked out over a window
     that ends today, a rate over the last thirty days or a chart of the last
     thirty days, is therefore reading a sample that is missing exactly the
     part it needs. A full page makes those figures unavailable rather than
     approximate, and makes every count a floor. */
  var PAGE = 100;

  /* Whether a read came back full, which is the only signal there is that more
     exist. It cannot say how many more. */
  function capped(problems) {
    return (problems || []).length >= PAGE;
  }

  /* A count that came out of a full page is a floor rather than a total, and
     it has to read as one wherever it is printed. */
  function atLeast(text, isCapped) {
    return isCapped ? 'At least ' + text : text;
  }

  /* Worst first, then oldest. Newest is not the same as most important, and a
     queue sorted by arrival buries the thing that has been burning longest. */
  function severityRank(severity) {
    return severity === 'critical' ? 0 : severity === 'warning' ? 1 : 2;
  }

  function time(iso) {
    var t = iso ? new Date(iso) : null;
    return t && isFinite(t.getTime()) ? t.getTime() : null;
  }

  function byWorstThenOldest(a, b) {
    var bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity) return bySeverity;
    return (time(a.firedAt) || 0) - (time(b.firedAt) || 0);
  }

  /* The verdicts that mean a rule looked at the data and reached a conclusion.
     Everything else, including a check that itself failed, is a rule that is
     not currently judging anything. */
  var JUDGING = { ok: true, firing: true };

  /* The most recent of a list of timestamps, compared as numbers. Sorting
     these as strings happens to agree with numeric order for every 13-digit
     millisecond value, which makes it a trap rather than a bug, so it is done
     properly in the one place both panes call. */
  function latest(list) {
    return list.map(time).filter(function (t) { return t !== null; })
      .reduce(function (a, b) { return b > a ? b : a; }, -Infinity);
  }

  function oldest(list) {
    return list.map(time).filter(function (t) { return t !== null; })
      .reduce(function (a, b) { return b < a ? b : a; }, Infinity);
  }

  /* Takes the millisecond number latest() and oldest() return, including the
     infinities they use for "there was nothing to compare". The type is
     checked rather than assumed, because isFinite() coerces: isFinite(null) is
     true and would turn a missing value into 1970 rather than into nothing,
     and isFinite('') is true for a string Date cannot use at all. This is
     exported beside latest and oldest, so it has to reject a missing value the
     way it reads as though it does. */
  function iso(ms) {
    return typeof ms === 'number' && isFinite(ms) ? new Date(ms).toISOString() : null;
  }

  /* Whether the alerting can be believed, which is a different question from
     whether anything is wrong.

     This is worked out rule by rule rather than from the summary counts,
     because those counts answer different questions from each other: the
     enabled count is over the enabled rules, the insufficient-data count is
     over every rule including the disabled ones, and the last-evaluated stamp
     is the newest across all of them. Subtracting one from another produces a
     number that is not a quantity of anything, and it is wrong in both
     directions: a disabled rule short of data can make an enabled healthy rule
     look unmonitored, and an enabled rule whose own check failed counts as
     checking because a failure is not insufficient data.

     What is actually being asked is whether any enabled rule reached a verdict
     the last time it ran. Both panes lean on the answer, because "nothing is
     wrong" is only worth printing when something was in a position to
     notice. */
  function armedState(rules) {
    var list = rules.rules || [];
    var enabled = list.filter(function (r) { return r.enabled; });
    var checking = enabled.filter(function (r) {
      return time(r.lastEvaluatedAt) !== null && JUDGING[r.lastEvaluationStatus] === true;
    });
    var lastEvaluated = latest(enabled.map(function (r) { return r.lastEvaluatedAt; }));

    return {
      rules: list,
      channels: rules.channels || [],
      total: list.length,
      enabled: enabled.length,
      /* Enabled, ran, and reached a verdict. This is the only count either
         pane is allowed to call "checking". */
      checking: checking.length,
      insufficientData: enabled.filter(function (r) {
        return r.lastEvaluationStatus === 'insufficient_data';
      }).length,
      /* An enabled rule whose own check failed. Different from short of data,
         and a different thing to go and fix. */
      errored: enabled.filter(function (r) {
        return r.lastEvaluationStatus === 'error';
      }).length,
      neverRun: enabled.filter(function (r) {
        return time(r.lastEvaluatedAt) === null;
      }).length,
      /* Over the enabled rules only. A disabled rule's last run says nothing
         about whether anything is being checked now. */
      lastEvaluatedAt: iso(lastEvaluated),
      lastFiredAt: iso(latest(list.map(function (r) { return r.lastFiredAt; }))),
      trustworthy: checking.length > 0
    };
  }

  /* The problems an operator is being asked to do something about, as opposed
     to the ones somebody already has. */
  function needingAction(problems) {
    return problems.filter(function (p) { return p.status === 'open'; });
  }

  function takenOn(problems) {
    return problems.filter(function (p) { return p.status === 'acknowledged'; });
  }

  /* Everything still wrong, whether or not somebody has taken it on. Who owns
     an incident and whether the system is healthy are different questions, and
     a health claim that reads the first one says "everything is working" over
     an unresolved critical problem the moment somebody puts their name to
     it. */
  function active(problems) {
    return problems.filter(function (p) {
      return p.status === 'open' || p.status === 'acknowledged';
    });
  }

  function worstSeverity(problems) {
    return problems.reduce(function (worst, p) {
      if (!worst) return p.severity;
      return severityRank(p.severity) < severityRank(worst) ? p.severity : worst;
    }, null);
  }

  global.OpsAlertsModel = {
    SEVERITY_LABEL: SEVERITY_LABEL,
    SEVERITY_TONE: SEVERITY_TONE,
    STATUS_LABEL: STATUS_LABEL,
    STATUS_TONE: STATUS_TONE,
    CLOSE_REASON_LABEL: CLOSE_REASON_LABEL,
    EVENT_LABEL: EVENT_LABEL,
    EVENT_TONE: EVENT_TONE,
    EVALUATION_LABEL: EVALUATION_LABEL,
    EVALUATION_TONE: EVALUATION_TONE,
    INSUFFICIENT_REASON: INSUFFICIENT_REASON,
    CHANNEL_STATUS: CHANNEL_STATUS,
    CHANNEL_FAILURE: CHANNEL_FAILURE,
    PANE_FILE: PANE_FILE,
    CATEGORIES: CATEGORIES,
    SEVERITIES: SEVERITIES,
    PAGE: PAGE,
    capped: capped,
    atLeast: atLeast,
    severityRank: severityRank,
    time: time,
    latest: latest,
    oldest: oldest,
    iso: iso,
    byWorstThenOldest: byWorstThenOldest,
    armedState: armedState,
    needingAction: needingAction,
    takenOn: takenOn,
    active: active,
    worstSeverity: worstSeverity
  };
})(window);
