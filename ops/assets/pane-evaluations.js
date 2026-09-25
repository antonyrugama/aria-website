/* Aria quality: working tools, plus a drawing of the pane this one is named for.

   Dataset validation checks supplied declarations without reading referenced
   files or storing a dataset. Evidence import places bytes behind the server's
   private, immutable quarantine boundary when the backend accepts the request.
   Neither successful quarantine or approval operation is admission, evaluation
   consent, training consent, export permission, provider-transfer permission,
   or proof of de-identification. Admission changes only the artifact state and
   receipt metadata; it does not read, reveal, export or grant evaluator access.
   Approval handoffs expose metadata only and leave qualification checks and
   operation availability to the server.

   The selected file exists only in this page's memory until the operator
   submits it. The page displays file metadata before submission and the
   operation's metadata-only resource afterwards; it never renders the raw
   evidence or a storage URL.

   The scoring harness — the thing that would answer "is Aria giving better or
   worse answers than before" — does not exist and is not being built here.
   What is on screen below the violet banner is the agreed layout for it,
   filled with numbers somebody made up. That is a deliberate choice over an
   empty "coming soon" card: a placeholder tells a reviewer nothing they can
   disagree with, so it gets approved by default and the argument arrives later
   in code, whereas the real shape can be argued with now.

   It carries an obvious risk in the other direction — invented figures get
   screenshotted and quoted — and the whole of the honesty apparatus here is
   paying for it:

     - INVENTED below holds the made-up data in one place, so that "is this
       figure stamped" is a question about a list rather than about a reader's
       memory. The test file keeps its OWN hand-written inventory and holds
       every entry inside the preview; it does not read this object, because
       an expectation derived from the thing under test moves with it.

       What the tests prove about that, exactly: every listed figure and
       phrase is printed inside the preview, and in TWO render states — the
       booted page, and the page after both working tools have been submitted
       — no two-decimal score and no listed phrase appears under <body>
       outside the preview, in an element's text, in the shell's live region,
       or on an attribute a person receives (the test file's SPOKEN_ATTRS is
       the list; it covers both an attribute painted on screen and one a
       screen reader substitutes for the element's text), or in the live
       `value` a control is holding, which this pane assigns as a property
       and which carries no attribute at all. No stamp chip in those two
       states carries a digit.

       THREE gaps the test file names and measures rather than implies. The
       inventories are hand-written, so a made-up string in neither of them
       that is also not a two-decimal score can be added outside the preview
       and go unseen. The error branches are a third render state that nothing
       reads: a score printed into a validation or quarantine failure message
       is not found. And a figure split MID-TOKEN across two elements joins
       with a space in the sweep and without one in a browser, so "0.8" and
       "2" side by side read as 0.82 on screen and are not found.
     - previewBand() is the only way a band gets into the preview, and it
       stamps the band. workingBand() is the only way a band is built outside
       it, and it stamps that. Neither stamp is a colour: each carries a word.
     - The preview holds no control of any kind. A disabled or faded button is
       still in the tab order, and a control that changes nothing is worse than
       no control. It holds exactly one focus stop, the table that scrolls
       sideways on a phone, because a scroll region a keyboard cannot reach
       fails WCAG 2.1.1; it moves the view and changes nothing.

   The preview is marked as a drawing by a dashed hairline and a hatch rather
   than by fading it: see assets/pane-evaluations-v2.css for why 55% opacity is
   an AA failure on a palette that is contrast-correct at full strength.

   Drawn on the v2 design system through assets/shell-pane-v2.js. The pane
   holds no session, filter or navigation logic of its own, and makes no read
   on boot — both tools act on what the administrator supplies, and the scoring
   half has no API behind it — so the shell's four preview states describe
   nothing here and the pane renders straight into its content region. */
(function (global) {
  'use strict';

  var shell = global.OpsPaneShell;
  var session = global.OpsSession;
  var maskContactDetails = global.OpsPaneRegistry.maskContactDetails;
  var h = shell.h;
  var icon = shell.icon;
  var MAX_BYTES = 5 * 1024 * 1024;
  var REFERENCE = /^[A-Za-z0-9._:/-]{1,200}$/;
  var CATEGORY = {
    tokens: 1,
    identifiers: 1,
    precise_location: 1,
    private_staff_notes: 1,
    private_journal: 1,
    signed_urls: 1,
    health_details: 1,
    none: 1
  };

  /* Every made-up number on this pane, in one place, so that "is this figure
     stamped" is a question about a list rather than about a reader's memory.
     scripts/ops-pane-evaluations.test.mjs asserts that each of these reaches
     the DOM inside the stamped preview, and that none of them reaches it
     anywhere else. Printing one of these outside the preview fails that test. */
  var INVENTED = {
    overall: '0.82',
    overallDrop: '0.06',
    previous: [
      { version: '1.1.2', when: '14 Jul', score: '0.88', move: 'flat' },
      { version: '1.1.1', when: '30 Jun', score: '0.88', move: '0.02', down: true },
      { version: '1.1.0', when: '12 Jun', score: '0.90', move: '0.03', up: true },
      { version: '1.0.6', when: '28 May', score: '0.87', move: '0.01', down: true },
      { version: '1.0.5', when: '14 May', score: '0.88', move: '0.02', up: true },
      { version: '1.0.4', when: '2 May', score: '0.86', move: 'first scored' }
    ],
    caseCount: '180 cases, weighted by request volume',
    dimensions: [
      { name: 'Coaching tone', score: '0.79', pct: 79, tone: 'warn', move: '0.08', down: true },
      { name: 'Factual accuracy', score: '0.88', pct: 88, tone: 'ok', move: '0.01', down: true },
      { name: 'Safety', sub: 'Declines injury, medical and weight advice', score: '0.96', pct: 96, tone: 'ok', move: 'flat' },
      { name: 'Plan structure', score: '0.84', pct: 84, tone: 'ok', move: '0.01', down: true },
      { name: 'Language quality, Spanish', sub: 'Written first', score: '0.86', pct: 86, tone: 'ok', move: '0.02', down: true },
      { name: 'Language quality, English', sub: 'Translated', score: '0.83', pct: 83, tone: 'ok', move: '0.03', down: true },
      { name: 'Language quality, Portuguese', sub: 'Newest', score: '0.74', pct: 74, tone: 'bad', move: '0.09', down: true }
    ],
    safetyFloor: 'Safety has a hard floor: below 0.95 nothing ships.',
    regressionThreshold: '0.05',
    regressions: [
      { title: '12 week block after a hamstring strain', id: 'tc_0147', kind: 'Training programs', was: '0.91', now: '0.62', move: '0.29' },
      { title: 'Creatine timing', id: 'tc_0312', kind: 'Chat replies', tone: 'acc', was: '0.88', now: '0.71', move: '0.17' },
      { title: '62kg sprinter on a double day', id: 'tc_0208', kind: 'Nutrition plans', was: '0.84', now: '0.70', move: '0.14' },
      { title: 'Session note in Portuguese', id: 'tc_0455', kind: 'Coach note summaries', was: '0.81', now: '0.68', move: '0.13' },
      { title: 'Slow block start, 40m footage', id: 'tc_0091', kind: 'Sprint video analysis', tone: 'vio', was: '0.86', now: '0.78', move: '0.08' }
    ],
    regressionFoot: 'Four of the five ask Aria to tell an athlete no, not yet.',
    shipped: {
      version: '1.1.2', note: 'shipped 14 Jul, 73% of sessions', overall: '0.88',
      figures: [
        ['Coaching tone', '0.87'], ['Factual accuracy', '0.89'],
        ['Safety', '0.96'], ['Plan structure', '0.85'], ['Cases below 0.70', '3']
      ]
    },
    candidate: {
      version: '1.2.0', note: 'candidate, not released', overall: '0.82',
      figures: [
        ['Coaching tone', '0.79', true], ['Factual accuracy', '0.88'],
        ['Safety', '0.96'], ['Plan structure', '0.84'], ['Cases below 0.70', '11', true]
      ]
    },
    heldTitle: '1.2.0 cannot ship until this is sorted',
    heldLine: 'Nothing here is unsafe. Aria has started answering like a manual, and the release is held until coaching tone is back above 0.85.',
    heldSince: 'Held since 29 Jul',
    suite: [
      { name: 'Chat replies', count: '62', pct: 34.4 },
      { name: 'Training programs', count: '48', pct: 26.7 },
      { name: 'Nutrition plans', count: '31', pct: 17.2 },
      { name: 'Coach note summaries', count: '21', pct: 11.7 },
      { name: 'Sprint video analysis', count: '18', pct: 10.0 }
    ],
    suiteSize: '180 cases',
    suiteMeta: [
      ['Graded by', 'Second model, with a rubric'],
      ['Human check', 'One in ten, by a coach'],
      ['Last run', '29 Jul, 02:14 UTC'],
      ['Took', '41 minutes'],
      ['Model cost', '$3.18']
    ],
    suiteFoot: 'Every case is a real request, anonymised.'
  };

  function bytesToBase64(bytes) {
    var result = '';
    var size = 0x8000;
    for (var offset = 0; offset < bytes.length; offset += size) {
      var slice = bytes.subarray(offset, Math.min(offset + size, bytes.length));
      result += String.fromCharCode.apply(null, slice);
    }
    return global.btoa(result);
  }

  async function sha256(bytes) {
    var digest = new Uint8Array(await global.crypto.subtle.digest('SHA-256', bytes));
    return Array.prototype.map.call(digest, function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function requireReference(value, label) {
    var trimmed = String(value || '').trim();
    if (!REFERENCE.test(trimmed)) throw new Error(label + ' must be an exact documented reference.');
    return trimmed;
  }

  function categories(value, label, allowEmpty) {
    var entries = String(value || '').split(',').map(function (entry) {
      return entry.trim();
    }).filter(Boolean);
    if (!entries.length) {
      if (allowEmpty) return [];
      throw new Error(label + ' must name at least one category or "none".');
    }
    var unique = entries.filter(function (entry, index) {
      return entries.indexOf(entry) === index;
    });
    if (unique.length > 8 || unique.some(function (entry) { return !CATEGORY[entry]; })) {
      throw new Error(label + ' contains an unsupported privacy category.');
    }
    if (unique.indexOf('none') !== -1 && unique.length !== 1) {
      throw new Error(label + ' cannot combine "none" with another category.');
    }
    return unique;
  }

  function validateDraft(draft) {
    if (!(draft.bytes instanceof Uint8Array) || !draft.bytes.length || draft.bytes.length > MAX_BYTES) {
      throw new Error('Choose a non-empty evidence file no larger than 5 MiB.');
    }
    if (['trace', 'media'].indexOf(draft.contentProfile) === -1) {
      throw new Error('Choose a supported content profile.');
    }
    var traceType = ['application/json', 'text/plain'].indexOf(draft.mediaType) !== -1;
    var mediaType = [
      'image/jpeg', 'image/png', 'audio/mpeg', 'audio/wav', 'video/mp4', 'video/quicktime'
    ].indexOf(draft.mediaType) !== -1;
    if ((draft.contentProfile === 'trace' && !traceType) || (draft.contentProfile === 'media' && !mediaType)) {
      throw new Error('The media type does not match the selected content profile.');
    }
    if (['regression_evaluation', 'incident_reproduction', 'quality_review'].indexOf(draft.purpose) === -1) {
      throw new Error('Choose a documented quarantine purpose.');
    }
    var expiry = new Date(draft.expiresAt);
    if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()) {
      throw new Error('Retention expiry must be a future date and time.');
    }
    if (expiry.getTime() > Date.now() + 90 * 24 * 60 * 60 * 1000) {
      throw new Error('Retention cannot exceed 90 days.');
    }
    categories(draft.necessaryCategories || 'none', 'Necessary categories');
    categories(
      draft.removedCategories === undefined ? 'none' : draft.removedCategories,
      'Removed categories',
      true
    );
    requireReference(draft.idempotencyKey, 'Idempotency key');
    if (draft.sourceKind === 'production_derived') {
      requireReference(draft.authorityRef, 'Authority reference');
      requireReference(draft.consentRef, 'Consent reference');
      requireReference(draft.providerApprovalRef, 'Provider handling approval reference');
    } else if (draft.sourceKind !== 'synthetic') {
      throw new Error('Choose a supported evidence source.');
    }
  }

  async function buildQuarantineRequest(draft, requestId) {
    var resolvedRequestId = requestId || global.crypto.randomUUID();
    var resolvedDraft = {};
    Object.keys(draft).forEach(function (key) { resolvedDraft[key] = draft[key]; });
    resolvedDraft.idempotencyKey = draft.idempotencyKey ||
      'dashboard-quarantine-' + resolvedRequestId;
    validateDraft(resolvedDraft);
    var digest = await sha256(draft.bytes);
    var production = draft.sourceKind === 'production_derived';
    return {
      schemaVersion: 'ciel.operation.request.v1',
      requestId: resolvedRequestId,
      operationId: 'ciel.artifact.quarantine',
      mode: 'remote',
      client: {
        name: 'aria-operations-dashboard',
        version: '1.0.0',
        contractVersions: ['ciel.operations.v1']
      },
      input: {
        sourceDigest: digest,
        purpose: draft.purpose,
        manifest: {
          schemaVersion: 'ciel.artifact.quarantine-manifest.v1',
          sourceKind: draft.sourceKind,
          contentProfile: draft.contentProfile,
          mediaType: draft.mediaType,
          contentBase64: bytesToBase64(draft.bytes),
          authority: production ? {
            kind: 'documented',
            authorityRef: String(draft.authorityRef).trim(),
            consentRef: String(draft.consentRef).trim()
          } : {
            kind: 'synthetic'
          },
          minimization: {
            necessaryCategories: categories(draft.necessaryCategories || 'none', 'Necessary categories'),
            removedCategories: categories(
              draft.removedCategories === undefined ? 'none' : draft.removedCategories,
              'Removed categories',
              true
            )
          },
          providerHandling: production ? {
            status: 'approved',
            approvalRef: String(draft.providerApprovalRef).trim()
          } : {
            status: 'no_transfer'
          },
          retention: {
            expiresAt: new Date(draft.expiresAt).toISOString()
          }
        }
      },
      idempotencyKey: String(resolvedDraft.idempotencyKey).trim()
    };
  }

  function approvalEnvelope(operationId, requestId, input) {
    return {
      schemaVersion: 'ciel.operation.request.v1',
      requestId: requestId,
      operationId: operationId,
      mode: 'remote',
      client: {
        name: 'aria-operations-dashboard',
        version: '1.0.0',
        contractVersions: ['ciel.operations.v1']
      },
      input: input
    };
  }

  function buildApprovalRequest(draft, requestId) {
    var request = approvalEnvelope('ciel.approval.request', requestId, {
      targetOperationId: 'ciel.artifact.admit',
      targetRequestDigest: draft.targetRequestDigest,
      artifact: {
        artifactId: draft.artifactId,
        revision: draft.artifactRevision,
        sourceDigest: draft.sourceDigest,
        retainedDigest: draft.retainedDigest
      },
      purpose: draft.purpose,
      policyRevision: draft.policyRevision,
      expiresAt: draft.expiresAt
    });
    request.idempotencyKey =
      draft.idempotencyKey || 'dashboard-approval-request-' + requestId;
    return request;
  }

  function buildApprovalGet(draft, requestId) {
    return approvalEnvelope('ciel.approval.get', requestId, {
      approvalRequestId: draft.approvalRequestId
    });
  }

  function buildApprovalDecision(draft, requestId) {
    var request = approvalEnvelope('ciel.approval.decide', requestId, {
      approvalRequestId: draft.approvalRequestId,
      decision: draft.decision,
      reason: draft.reason
    });
    request.expectedRevision = draft.expectedRevision;
    request.idempotencyKey =
      draft.idempotencyKey || 'dashboard-approval-decision-' + requestId;
    return request;
  }

  function requireDigest(value, label) {
    var trimmed = String(value || '').trim();
    if (!/^[a-f0-9]{64}$/.test(trimmed)) {
      throw new Error(label + ' must be a lowercase SHA-256 digest.');
    }
    return trimmed;
  }

  function requireUuid(value, label) {
    var trimmed = String(value || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(trimmed)) {
      throw new Error(label + ' must be a UUID.');
    }
    return trimmed;
  }

  function requirePositiveInteger(value, label) {
    var number = Number(value);
    if (!Number.isInteger(number) || number < 1) {
      throw new Error(label + ' must be a positive integer.');
    }
    return number;
  }

  function admissionErrorText(caught) {
    var message = caught && caught.message
      ? maskContactDetails(caught.message)
      : 'Evidence could not be admitted. Check the documented binding and try again.';
    if (caught && caught.code === 'revision_conflict') return 'Stale binding: ' + message;
    if (caught && (caught.code === 'approval_required' || caught.code === 'permission_denied')) {
      return 'Admission denied: ' + message;
    }
    return message;
  }

  function buildAdmissionRequest(draft, requestId) {
    var resolvedRequestId = requestId || global.crypto.randomUUID();
    var profile = String(draft.contentProfile || '').trim();
    var mediaType = String(draft.mediaType || '').trim();
    if (['trace', 'media'].indexOf(profile) === -1) throw new Error('Choose a supported content profile.');
    var traceType = ['application/json', 'text/plain'].indexOf(mediaType) !== -1;
    var mediaFileType = [
      'image/jpeg', 'image/png', 'audio/mpeg', 'audio/wav', 'video/mp4', 'video/quicktime'
    ].indexOf(mediaType) !== -1;
    if ((profile === 'trace' && !traceType) || (profile === 'media' && !mediaFileType)) {
      throw new Error('The media type does not match the selected content profile.');
    }
    if (['regression_evaluation', 'incident_reproduction', 'quality_review'].indexOf(draft.purpose) === -1) {
      throw new Error('Choose a documented admission purpose.');
    }
    var expiresAt = new Date(draft.expiresAt);
    if (!Number.isFinite(expiresAt.getTime())) {
      throw new Error('Retention expiry must be a valid date and time.');
    }
    var policyRevision = requireReference(draft.policyRevision, 'Policy revision');
    var request = approvalEnvelope('ciel.artifact.admit', resolvedRequestId, {
      artifact: {
        artifactId: requireUuid(draft.artifactId, 'Artifact ID'),
        sourceDigest: requireDigest(draft.sourceDigest, 'Source SHA-256'),
        retainedDigest: requireDigest(draft.retainedDigest, 'Retained SHA-256'),
        sourceKind: 'synthetic',
        contentProfile: profile,
        mediaType: mediaType,
        purpose: draft.purpose,
        authority: { kind: 'synthetic' },
        minimization: {
          necessaryCategories: categories(draft.necessaryCategories || 'none', 'Necessary categories'),
          removedCategories: categories(
            draft.removedCategories === undefined ? 'none' : draft.removedCategories,
            'Removed categories',
            true
          )
        },
        retention: {
          expiresAt: expiresAt.toISOString()
        },
        providerHandling: { status: 'no_transfer' }
      },
      policyRevision: policyRevision
    });
    request.expectedRevision = requirePositiveInteger(draft.expectedRevision, 'Expected artifact revision');
    request.approval = {
      approvalRequestId: requireUuid(draft.approvalRequestId, 'Approval request ID')
    };
    request.idempotencyKey = draft.idempotencyKey
      ? requireReference(draft.idempotencyKey, 'Idempotency key')
      : 'dashboard-admit-' + resolvedRequestId;
    return request;
  }
  /* ------------------------------------------------------------ the stamps */

  /* A chip carrying a word, in the slot a band's status lives in. The colour
     agrees with the word and never replaces it: a reader who cannot tell the
     violet from the green still reads "Invented figures". */
  function stamp(className, iconName, text) {
    return h('span', { className: className }, [
      icon(iconName),
      h('span', { text: text })
    ]);
  }

/* ------------------------------------------------------------ the folds */

  /* At 375px this pane was 7841px tall — 9.7 screens of an 812px phone, 35
     controls and 5 forms in one column, with no index and nothing to orient
     against. The only way to reach a tool was to scroll past the others.
     Stadiora/Aria#10827.

     The approved mock does not answer this. docs/mocks/ops-dashboard-v2's
     evaluations.html carries no media query at all, and the lowest breakpoint
     anywhere in that mock set is 560px, so there is no drawing of this pane on
     a phone to be faithful to. It is a decision, and this is the decision:
     under 900px every band folds and the page opens as an index of what it
     holds.

     900 rather than a new number because it is the width this pane's own
     sheet already collapses .q-grid, .evidence-form-grid, .u-score and .u-vs
     to one column at. That is the point the page stops being a layout and
     becomes a stack, which is the same point an index starts paying for
     itself.

     Every band starts closed, including the two that work. An operator
     opening this on a phone has come to do one of these things, and one tap
     with no scrolling beats 2048px of scrolling to find the third of five.
     Uniformity is also what makes the index readable: a page where some
     sections are open and some are shut reads as a bug.

     The fold adds no visible words. A band already carries its title, a note
     and a stamp chip, which is a summary line as it stands, and the density
     the owner objected to is the reason not to write another. The control is
     an icon button whose accessible name comes from the band's own title
     through aria-labelledby, so the name cannot drift from the heading, and
     aria-expanded is what says which way it is facing. The chevron is the
     visible channel and the hidden body is the second; neither is a colour.

     Above 900 the button is display:none in the sheet and every body is
     shown, so the pane is byte-for-byte the layout it was at desktop. The
     media query is watched rather than read once, so crossing the breakpoint
     re-syncs instead of stranding the page in the other width's state.

     The wrapper and the control are built with the band rather than moved
     into place afterwards. Re-parenting a live head's siblings depends on
     appendChild's removal semantics and on nothing else holding a reference
     to them, which is more subtlety than a layout should owe; and shell.band
     already takes an `end` list that lands inside .band-head, so the control
     gets there through the shell's own interface instead of DOM surgery. */
  var FOLD_AT = '(max-width: 900px)';
  var watching = null;
  var pending = [];
  var foldSeq = 0;

  /* A band whose rows live in one wrapper the narrow layout can fold away.
     Returns the section to put on the page and the body to fill. */
  function foldable(title, note, end) {
    var bodyId = 'fold-body-' + (foldSeq += 1);
    var body = h('div', { className: 'band-body' });
    body.setAttribute('id', bodyId);

    var button = h('button', { className: 'band-fold', type: 'button' }, [icon('chev')]);
    button.setAttribute('aria-controls', bodyId);
    /* Named from the same string the heading is built from, so the control
       cannot announce something its band does not say. An aria-labelledby
       into the heading reads identically and goes silent the day the id
       misses, which is a failure this repo has already shipped once. */
    button.setAttribute('aria-label', title);

    var set = function (open) {
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      body.hidden = !open;
    };
    button.addEventListener('click', function () {
      set(button.getAttribute('aria-expanded') !== 'true');
    });

    /* Above the breakpoint the control is display:none in the sheet and the
       body is never collapsed, so there is no disclosure up there and the
       button carries no aria-expanded. A control that cannot be operated,
       over a target that is always open, announcing that it is expanded is a
       claim about a widget that does not exist at that width. */
    pending.push(function (narrow) {
      if (narrow) { set(false); return; }
      button.removeAttribute('aria-expanded');
      body.hidden = false;
    });

    var section = shell.band(title, note, (end || []).concat([button]));
    section.appendChild(body);
    return { section: section, body: body };
  }

  /* Keeps every band built since the last render in step with the width.
     Returns nothing: the listener owns the state from here. */
  function installFolds() {
    var folds = pending;
    if (!folds.length) return;

    var query = global.matchMedia(FOLD_AT);
    var sync = function () {
      for (var j = 0; j < folds.length; j++) folds[j](query.matches);
    };
    /* A pane can be rendered more than once into the same document, and a
       listener left behind would go on driving bands that are no longer on
       screen. */
    if (watching) watching.query.removeEventListener('change', watching.sync);
    query.addEventListener('change', sync);
    watching = { query: query, sync: sync };
    sync();
  }

  /* The only way a band is built outside the preview. */
  function workingBand(title, note) {
    return foldable(title, note, [stamp('u-tag works', 'check', 'Works now')]);
  }

  /* The only way a band gets into the preview, so every band in it is stamped
     by construction rather than by remembering to. Stamped per band rather
     than once at the top, because a screenshot is usually of one card. */
  function previewBand(title, note) {
    return foldable(title, note, [stamp('u-tag', 'warn', 'Invented figures')]);
  }

  /* ------------------------------------------------------------- the forms */

  function field(id, label, control, hint) {
    control.setAttribute('id', id);
    var children = [
      h('label', { className: 'field-label', 'for': id, text: label }),
      control
    ];
    if (hint) children.push(h('p', { className: 'field-hint', text: hint }));
    return h('div', { className: 'q-field' }, children);
  }

  function option(value, label) {
    return h('option', { value: value, text: label });
  }

  function select(options) {
    return h('select', { className: 'field-input' }, options);
  }

  function input(type, value) {
    var attrs = { className: 'field-input', type: type };
    if (value !== undefined) attrs.value = value;
    return h('input', attrs);
  }

  function metadataRow(label, value) {
    return h('div', { className: 'evidence-meta-row' }, [
      h('dt', { text: label }),
      h('dd', { text: value })
    ]);
  }

  function detailList(rows) {
    return h('dl', { className: 'card-body evidence-meta browse-meta' }, rows.map(function (row) {
      return metadataRow(row[0], row[1]);
    }));
  }

  function clearNode(node) {
    node.textContent = '';
  }

  function appendAll(node, children) {
    children.forEach(function (child) {
      if (child) node.appendChild(child);
    });
  }

  function titleCase(value) {
    return String(value || '')
      .split(/[-_]/)
      .filter(Boolean)
      .map(function (part) { return part.charAt(0).toUpperCase() + part.slice(1); })
      .join(' ') || 'Unknown';
  }

  function countText(metric) {
    return String(metric.numerator) + ' / ' + String(metric.denominator) + ' ' + metric.denominatorKind;
  }

  function unique(values) {
    var seen = {};
    return values.filter(function (value) {
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    }).sort();
  }

  function metricByKey(coverage, key) {
    var metrics = coverage && Array.isArray(coverage.metrics) ? coverage.metrics : [];
    for (var i = 0; i < metrics.length; i++) {
      if (metrics[i] && metrics[i].key === key) return metrics[i];
    }
    return null;
  }

  function filterField(id, label) {
    var control = select([option('', 'All')]);
    return {
      control: control,
      field: field(id, label, control)
    };
  }

  function syncOptions(control, values) {
    var current = control.value;
    clearNode(control);
    control.appendChild(option('', 'All'));
    values.forEach(function (value) {
      control.appendChild(option(value, value));
    });
    control.value = values.indexOf(current) === -1 ? '' : current;
  }

  function scenarioAuthorityLabel(scenario) {
    if (!scenario || !scenario.review) return 'Unknown review state';
    if (scenario.review.source === 'scenario-v2') {
      return scenario.review.status === 'certified' ? 'Certified' : 'Not certified';
    }
    return titleCase(scenario.review.status || 'unknown');
  }


  function criterionAuthorityText(authority) {
    if (!authority) return '';
    var approvals = Array.isArray(authority.approvals) ? authority.approvals : [];
    var parts = [
      authority.schema,
      authority.tier ? 'tier ' + authority.tier : '',
      authority.domain ? 'domain ' + authority.domain : '',
      authority.approvalState ? 'approval ' + authority.approvalState : ''
    ].filter(Boolean);
    if (approvals.length) {
      parts.push('approvals ' + approvals.map(function (approval) {
        return [
          approval.kind,
          approval.reviewerRef,
          approval.qualificationPresent ? 'qualification reference present' : 'qualification reference missing',
          approval.domain,
          approval.scenarioVersion ? 'scenario v' + String(approval.scenarioVersion) : ''
        ].filter(Boolean).join(' · ');
      }).join('; '));
    }
    return parts.join(' · ');
  }

  function scenarioCard(scenario) {
    var counts = scenario.criteriaCounts || {};
    var risk = scenario.risk || {};
    var card = shell.card('browse-scenario');
    var detail = h('div', { className: 'browse-detail' });
    var inspect = h('button', { className: 'btn btn-sm', text: 'Inspect scenario' });
    inspect.setAttribute('type', 'button');
    inspect.addEventListener('click', async function () {
      clearNode(detail);
      detail.appendChild(h('p', { className: 'field-hint', text: 'Loading scenario detail…' }));
      try {
        var payload = await session.call('/api/ops/ciel/admin/scenarios/' + encodeURIComponent(scenario.scenarioId || ''), {
          query: { version: String(scenario.version || 1) }
        });
        var data = payload && payload.data ? payload.data : payload;
        var criteria = data.criteria || {};
        var rows = [];
        ['critical', 'required', 'expected', 'aspirational'].forEach(function (severity) {
          (criteria[severity] || []).forEach(function (criterion) {
            rows.push([
              titleCase(severity) + ' · ' + (criterion.id || 'criterion'),
              [
                criterion.statement,
                (criterion.evidenceRefs || []).length ? 'Evidence: ' + criterion.evidenceRefs.join(', ') : '',
                criterion.graderRef ? 'Grader: ' + criterion.graderRef : '',
                criterionAuthorityText(criterion.authority) ? 'Authority: ' + criterionAuthorityText(criterion.authority) : ''
              ].filter(Boolean).join(' · ')
            ]);
          });
        });
        (data.sourceLinks || []).forEach(function (source) {
          rows.push(['Source evidence', [source.label, source.uri].filter(Boolean).join(' · ')]);
        });
        var oracle = data.oracle || {};
        (oracle.referenceFacts || []).forEach(function (fact) {
          rows.push(['Oracle reference', [fact.id, fact.sourceRef].filter(Boolean).join(' · ')]);
        });
        if (data.redactions && data.redactions.length) rows.push(['Redacted:', data.redactions.join(', ')]);
        clearNode(detail);
        detail.appendChild(shell.cardHead('Scenario inspection', 'Version ' + String(data.version || scenario.version || 1)));
        detail.appendChild(detailList(rows.length ? rows : [['Inspection', 'No criteria metadata is available.']]));
      } catch (caught) {
        clearNode(detail);
        detail.appendChild(h('p', { className: 'field-error', text: caught && caught.message ? caught.message : 'Scenario detail unavailable.' }));
      }
    });
    card.appendChild(shell.cardHead(scenario.scenarioId || 'Unnamed scenario', [
      'v' + String(scenario.version || 1),
      scenario.capabilityRef,
      scenario.locale,
      risk.level
    ].filter(Boolean).join(' · '), [
      h('span', { className: 'pill', text: scenarioAuthorityLabel(scenario) })
    ]));
    card.appendChild(h('dl', { className: 'card-body evidence-meta browse-meta' }, [
      metadataRow('Product', scenario.product || 'Unknown'),
      metadataRow('Client', scenario.client || 'Unknown'),
      metadataRow('Role', scenario.role || 'Unknown'),
      metadataRow('Risk domains', (risk.domains || []).join(', ') || 'None recorded'),
      metadataRow('Criteria', 'critical ' + (counts.critical || 0) +
        ', required ' + (counts.required || 0) +
        ', expected ' + (counts.expected || 0) +
        ', aspirational ' + (counts.aspirational || 0)),
      metadataRow('Run state', scenario.pack && scenario.pack.executed
        ? (scenario.pack.passing ? 'executed, passing' : 'executed, not passing')
        : scenario.pack && scenario.pack.runnable ? 'runnable, not executed' : 'not runnable')
    ]));
    card.appendChild(h('div', { className: 'card-foot evidence-actions' }, [inspect]));
    card.appendChild(detail);
    return card;
  }

  function renderCoverage(coverage) {
    var metrics = ['inventory', 'authored', 'approved', 'runnable', 'executed', 'passing']
      .map(function (key) { return metricByKey(coverage, key); })
      .filter(Boolean);
    var flags = coverage && coverage.flags ? coverage.flags : {};
    var card = shell.card('browse-coverage');
    card.appendChild(shell.cardHead('Honest coverage', 'Each count carries its own denominator'));
    card.appendChild(h('div', { className: 'card-body browse-metrics' }, metrics.map(function (metric) {
      return h('div', { className: 'browse-metric' }, [
        h('span', { className: 'browse-metric-k', text: titleCase(metric.key) }),
        h('span', { className: 'browse-metric-v', text: countText(metric) })
      ]);
    })));
    card.appendChild(h('div', { className: 'card-foot browse-flags' }, [
      h('span', { text: 'Uncovered: ' + ((flags.uncoveredCapabilities || []).join(', ') || 'none') }),
      h('span', { text: 'Not certified: ' + ((flags.notCertifiedCapabilities || []).join(', ') || 'none') }),
      h('span', { text: 'Unowned: ' + ((flags.unownedCapabilities || []).join(', ') || 'none') }),
      h('span', { text: 'Disabled/unsupported: ' + ((flags.disabledOrUnsupportedCapabilities || []).map(function (capability) {
        return [capability.id, capability.status, capability.reason].filter(Boolean).join(' · ');
      }).join('; ') || 'none') }),
      h('span', { text: 'Missing cases: ' + ((flags.missingCases || []).map(function (entry) {
        return [entry.capabilityRef, entry.reason].filter(Boolean).join(' · ');
      }).join('; ') || 'none') }),
      h('span', { text: 'Unknown scenario refs: ' + ((flags.unknownCapabilityRefs || []).join(', ') || 'none') })
    ]));
    return card;
  }

  function renderDatasets(datasets) {
    var entries = datasets && Array.isArray(datasets.datasets) ? datasets.datasets : [];
    var card = shell.card('browse-datasets');
    card.appendChild(shell.cardHead('Datasets', entries.length + ' checked-in declaration' + (entries.length === 1 ? '' : 's')));
    if (datasets && (datasets.partial || (datasets.omissions || []).length)) {
      card.appendChild(h('div', { className: 'callout compact' }, [
        icon('warn'),
        h('div', {}, [
          h('strong', { text: 'Partial dataset view' }),
          h('p', { text: (datasets.omissions || []).join(' ') || 'Some dataset metadata is unavailable on this branch.' })
        ])
      ]));
    }
    if (!entries.length) {
      card.appendChild(shell.stateBlock('layers', 'No dataset declarations found', [
        'The backend did not find checked-in ciel.dataset.v1 declarations for this branch.'
      ]));
      return card;
    }
    card.appendChild(h('div', { className: 'card-body browse-dataset-list' }, entries.map(function (dataset) {
      var provenance = dataset.provenance || {};
      var counts = dataset.counts || {};
      var detail = h('div', { className: 'browse-detail' });
      var inspect = h('button', { className: 'btn btn-sm', text: 'Inspect dataset' });
      inspect.setAttribute('type', 'button');
      inspect.addEventListener('click', async function () {
        clearNode(detail);
        detail.appendChild(h('p', { className: 'field-hint', text: 'Loading dataset detail…' }));
        try {
          var payload = await session.call('/api/ops/ciel/admin/datasets/' + encodeURIComponent(dataset.datasetId || ''), {
            query: { revision: String(dataset.revision || 1) }
          });
          var data = payload && payload.data ? payload.data : payload;
          var rows = [];
          (data.cases || []).forEach(function (entry) {
            var scenario = entry.scenario || {};
            rows.push(['Scenario', [scenario.id, 'v' + String(scenario.version || 1), scenario.path].filter(Boolean).join(' · ')]);
            (entry.rubrics || []).forEach(function (rubric) {
              rows.push(['Rubric', [rubric.id, 'v' + String(rubric.version || 1), rubric.path].filter(Boolean).join(' · ')]);
            });
            if (entry.comparison) rows.push(['Comparison', [entry.comparison.state, entry.comparison.reason].filter(Boolean).join(' · ')]);
          });
          clearNode(detail);
          detail.appendChild(shell.cardHead('Dataset inspection', 'Revision ' + String(data.revision || dataset.revision || 1)));
          detail.appendChild(detailList(rows.length ? rows : [['Inspection', 'No case metadata is available.']]));
        } catch (caught) {
          clearNode(detail);
          detail.appendChild(h('p', { className: 'field-error', text: caught && caught.message ? caught.message : 'Dataset detail unavailable.' }));
        }
      });
      return h('article', { className: 'browse-dataset' }, [
        detailList([
          [dataset.datasetId + ' rev ' + dataset.revision, titleCase(dataset.review && dataset.review.state)],
          ['Provenance', [provenance.origin, provenance.authorRef, provenance.authoredAt].filter(Boolean).join(' · ')],
          ['Counts', (counts.cases || 0) + ' cases, ' + (counts.labels || 0) + ' labels'],
          ['Rubrics', (dataset.cases || []).flatMap(function (entry) {
            return (entry.rubrics || []).map(function (rubric) { return rubric.id + ' v' + String(rubric.version || 1); });
          }).join(', ') || 'none recorded'],
          ['Comparison', (dataset.cases || []).map(function (entry) {
            return entry.comparison ? [entry.comparison.state, entry.comparison.reason].filter(Boolean).join(' · ') : '';
          }).filter(Boolean).join('; ') || 'none recorded']
        ]),
        h('div', { className: 'card-foot evidence-actions' }, [inspect]),
        detail
      ]);
    })));
    return card;
  }

  function renderCatalogue(catalogue) {
    var capabilities = catalogue && Array.isArray(catalogue.capabilities) ? catalogue.capabilities : [];
    var card = shell.card('browse-catalogue');
    card.appendChild(shell.cardHead('Capability catalogue', 'Showing ' + capabilities.length + ' of ' + capabilities.length + ' registered capabilities'));
    card.appendChild(h('div', { className: 'card-body browse-capabilities' }, capabilities.map(function (capability) {
      return h('article', { className: 'browse-capability' }, [
        h('h3', { text: capability.name || capability.id }),
        h('p', { text: [capability.id, capability.status, capability.owner].filter(Boolean).join(' · ') }),
        h('p', { text: 'Applies to ' + ((capability.products || []).join(', ') || 'no product recorded') }),
        h('p', { text: 'Clients: ' + ((capability.clientRefs || []).join(', ') || 'none recorded') })
      ]);
    })));
    return card;
  }

  function renderBrowseResult(target, payload) {
    clearNode(target);
    var data = payload && payload.data ? payload.data : payload;
    var scenarios = data && Array.isArray(data.scenarios) ? data.scenarios : [];
    appendAll(target, [
      renderCoverage(data && data.coverage),
      scenarios.length
        ? h('div', { className: 'browse-scenarios grid g2' }, scenarios.map(scenarioCard))
        : h('div', { className: 'card' }, [
          shell.stateBlock('layers', 'No scenarios match these filters', [
            'Clear a filter or add authored scenarios before treating this capability as covered.'
          ])
        ]),
      renderDatasets(data && data.datasets),
      renderCatalogue(data && data.catalogue)
    ]);
  }

  function browseSection() {
    var built = workingBand('Browse Ciel scenarios and coverage', 'Read-only catalogue, datasets and honest denominators');
    var section = built.section;
    var bandBody = built.body;
    var filterDefs = {
      product: filterField('ciel-filter-product', 'Product'),
      client: filterField('ciel-filter-client', 'Client'),
      role: filterField('ciel-filter-role', 'Role'),
      capability: filterField('ciel-filter-capability', 'Capability'),
      risk: filterField('ciel-filter-risk', 'Risk'),
      locale: filterField('ciel-filter-locale', 'Locale')
    };
    var error = h('div', { className: 'field-error', role: 'alert' });
    var result = h('div', { className: 'browse-result' });
    var stableFacetOptions = {};
    result.setAttribute('id', 'ciel-browse-panel');
    result.setAttribute('aria-live', 'polite');
    var submit = h('button', { className: 'btn btn-primary', type: 'submit', text: 'Load catalogue' });
    var form = h('form', { className: 'card browse-form' }, [
      shell.cardHead('Browse quality evidence', 'No prompt or production content is shown'),
      h('div', { className: 'card-body q-grid browse-filter-grid' }, [
        filterDefs.product.field,
        filterDefs.client.field,
        filterDefs.role.field,
        filterDefs.capability.field,
        filterDefs.risk.field,
        filterDefs.locale.field
      ]),
      h('div', { className: 'card-foot evidence-actions' }, [
        h('p', {
          className: 'field-hint',
          text: 'Filters are pane-local. Coverage denominators are not reused across inventory, authored, approved, runnable, executed and passing counts.'
        }),
        submit
      ]),
      error
    ]);
    form.setAttribute('id', 'ciel-browse-filters');

    function query() {
      var out = {};
      Object.keys(filterDefs).forEach(function (key) {
        var value = filterDefs[key].control.value;
        if (value) out[key] = value;
      });
      return out;
    }

    function updateFilterOptions(data) {
      var scenarios = data && Array.isArray(data.scenarios) ? data.scenarios : [];
      var catalogue = data && data.catalogue ? data.catalogue : {};
      var capabilities = Array.isArray(catalogue.capabilities) ? catalogue.capabilities : [];
      var clients = Array.isArray(catalogue.clients) ? catalogue.clients : [];
      function stable(key, values) {
        stableFacetOptions[key] = unique((stableFacetOptions[key] || []).concat(values));
        return stableFacetOptions[key];
      }
      syncOptions(filterDefs.product.control, stable('product', unique(capabilities.flatMap(function (capability) {
        return capability.products || [];
      }).concat(scenarios.map(function (scenario) { return scenario.product; })))));
      syncOptions(filterDefs.client.control, stable('client', unique(clients.map(function (client) { return client.id; })
        .concat(scenarios.map(function (scenario) { return scenario.client; })))));
      syncOptions(filterDefs.role.control, stable('role', unique(scenarios.map(function (scenario) { return scenario.role; }))));
      syncOptions(filterDefs.capability.control, stable('capability', unique(capabilities.map(function (capability) { return capability.id; })
        .concat(scenarios.map(function (scenario) { return scenario.capabilityRef; })))));
      syncOptions(filterDefs.risk.control, stable('risk', unique(scenarios.flatMap(function (scenario) {
        return [scenario.risk && scenario.risk.level].concat(scenario.risk && scenario.risk.domains || []);
      }))));
      syncOptions(filterDefs.locale.control, stable('locale', unique(scenarios.map(function (scenario) { return scenario.locale; }))));
    }

    async function load() {
      clearNode(error);
      clearNode(result);
      result.appendChild(h('div', { className: 'card' }, [
        shell.stateBlock('layers', 'Loading Ciel catalogue', [
          'Reading checked-in contracts, scenario packs and dataset declarations.'
        ])
      ]));
      submit.disabled = true;
      try {
        var payload = await session.call('/api/ops/ciel/admin/overview', { query: query() });
        var data = payload && payload.data ? payload.data : payload;
        updateFilterOptions(data);
        renderBrowseResult(result, data);
        shell.announce('Ciel catalogue loaded.');
      } catch (caught) {
        clearNode(result);
        result.appendChild(h('div', { className: 'card' }, [
          shell.stateBlock('warn', 'Ciel catalogue unavailable', [
            caught && caught.message ? caught.message : 'Try again shortly.'
          ])
        ]));
        error.textContent = caught && caught.message ? caught.message : 'The Ciel browse endpoint could not be read.';
        shell.announce('Ciel catalogue unavailable.');
      } finally {
        submit.disabled = false;
      }
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      load();
    });

    bandBody.appendChild(form);
    result.appendChild(h('div', { className: 'card' }, [
      h('div', { className: 'card-body' }, [
        h('h3', { className: 'card-title', text: 'Load Ciel catalogue' }),
        h('p', {
          className: 'field-hint',
          text: 'Use the pane-local filters above, then load the read-only catalogue, scenario, dataset and coverage summary.'
        })
      ])
    ]));
    bandBody.appendChild(result);
    return section;
  }

  var RUN_DATASETS = [{
    id: 'dataset.synthetic.demo',
    label: 'Synthetic demo frozen release',
    releaseId: '3d11852d-24b9-46ab-9c7e-bd4db48f9d87',
    releaseDigest: 'be3bd66934844fa2025eedfe916a9ebd26c005faa7870e1702927c1dd893c3ac',
    caseDigests: [
      '2ad0f58eb67e4c5a5279753e92f434057ae0a1d170b46dde6749afbde5bf1a22',
      '6e40883c88da4d5c9486a5e8b6afaf18f0c5148a5937c589ee74a8c898408c9b'
    ]
  }];

  var RUN_CONFIGS = {
    'prompt.synthetic.baseline': {
      label: 'Baseline prompt bundle',
      version: 'v1',
      digest: '40c6f72e9d3a3756c01374c89ea63d6ad69e0d0d8cf9050f4d3d3176c22c1a47'
    },
    'prompt.synthetic.candidate': {
      label: 'Candidate prompt bundle',
      version: 'v1',
      digest: '9e1f7cf69326df1f47828a71f52d0d3ad4dc2aeb3c11e0f79c0668a253ef3eb9'
    }
  };

  function runEnvelope(operationId, input, requestId) {
    return {
      schemaVersion: 'ciel.operation.request.v1',
      requestId: requestId || global.crypto.randomUUID(),
      operationId: operationId,
      mode: 'remote',
      client: {
        name: 'aria-operations-dashboard',
        version: '1.0.0',
        contractVersions: ['ciel.operations.v1']
      },
      input: input
    };
  }

  function runManifest(dataset, promptBundleId, draft) {
    var config = RUN_CONFIGS[promptBundleId];
    var live = draft.providerKind === 'azure_openai';
    return {
      schemaVersion: 'ciel.run.manifest.v1',
      mode: draft.mode,
      code: { gitCommit: '1df3a9a4db943ad9e7ffc1f5a11e7d065426a92a' },
      dataset: {
        datasetId: dataset.id,
        releaseId: dataset.releaseId,
        releaseDigest: dataset.releaseDigest,
        caseDigests: dataset.caseDigests,
        sourceKind: 'synthetic'
      },
      promptBundle: {
        bundleId: promptBundleId,
        version: config.version,
        digest: config.digest
      },
      policy: {
        scenarioVersion: 'scenario.demo.secret-prompt:v2',
        rubricVersion: 'rubric.demo.no-retrieval.criteria:v1',
        gatePolicyVersion: 'ciel-gate-policy:v1',
        toolVersion: 'aria-eval:v1',
        engineVersion: 'ciel-engine:v1'
      },
      provider: {
        kind: draft.providerKind,
        deployment: live ? 'azure-openai-prod' : 'fixture',
        revision: live ? 'd6-owner-approved' : 'fixture-v1'
      },
      sampling: {
        seed: promptBundleId === 'prompt.synthetic.baseline' ? 101 : 202,
        temperature: 0,
        maxOutputTokens: 1024
      },
      locale: 'en-US',
      retrievalSnapshot: {
        kind: 'synthetic_fixture',
        digest: '4ec353ddbe7778ee30f038bbd6aef26d87a1fe3a3ab8ecbdf5b6ec903a7f3eb1'
      },
      graders: [{
        graderId: 'grader.synthetic',
        version: 'v1',
        digest: '75fb07e67b0171df77bd66d8118f985ee533ec8cd67f2e596d5d4150d5c39ba8'
      }],
      runtime: {
        approvedBy: draft.approvedBy,
        approvalRef: draft.approvalRef
      },
      budget: {
        estimatedCostCents: draft.estimatedCostCents,
        maxProviderRequests: live ? 40 : 0,
        maxPromptTokens: 10000,
        maxCompletionTokens: 10000,
        maxWallTimeSeconds: 600,
        requestedProviderConcurrency: live ? draft.providerConcurrency : 0
      },
      repeatDesign: {
        kind: draft.repeatsPerConfig > 1 ? 'paired_repeats' : 'single',
        repeatsPerConfig: draft.repeatsPerConfig,
        statisticsStatus: 'pending'
      }
    };
  }

  function runLaunchRequest(dataset, promptBundleId, draft, idempotencySuffix) {
    var request = runEnvelope('ciel.run.launch', {
      manifest: runManifest(dataset, promptBundleId, draft)
    });
    request.idempotencyKey = 'dashboard-run-launch-' + idempotencySuffix + '-' + request.requestId;
    return request;
  }

  function renderRunResource(resource) {
    var value = resource && resource.value ? resource.value : resource;
    if (!value) return h('p', { className: 'field-hint', text: 'No run resource returned.' });
    var progress = value.progress || {};
    var provider = value.provider || {};
    var cost = value.cost || {};
    var comparison = value.comparison || {};
    var evidence = value.evidence || {};
    var artifacts = value.artifacts || {};
    function compactJson(entry) {
      if (entry === null || entry === undefined) return 'unavailable';
      if (typeof entry === 'string') return entry;
      try {
        return JSON.stringify(entry).slice(0, 500);
      } catch (caught) {
        return 'unavailable';
      }
    }
    function detailsBlock(title, entries, emptyText) {
      var items = Array.isArray(entries) ? entries : [];
      return h('details', { className: 'run-detail-disclosure' }, [
        h('summary', { text: title + ' (' + String(items.length) + ')' }),
        items.length
          ? h('ul', {}, items.slice(0, 10).map(function (entry) {
            return h('li', { text: compactJson(entry) });
          }))
          : h('p', { className: 'field-hint', text: emptyText })
      ]);
    }
    var failures = Array.isArray(progress.attemptFailures) ? progress.attemptFailures : [];
    return h('article', { className: 'run-inspection-card' }, [
      shell.cardHead('Run ' + (value.runId || 'unknown'), [
        value.status,
        'revision ' + String(value.revision || resource.revision || 1),
        provider.provenance || 'provenance not reported'
      ].filter(Boolean).join(' · ')),
      detailList([
        ['Expected / actual cost', String(cost.expectedCents !== undefined ? cost.expectedCents : value.budget && value.budget.estimatedCostCents || 0) +
          'c / ' + String(cost.actualCents !== undefined ? cost.actualCents : value.budget && value.budget.accountedCostCents || 0) + 'c'],
        ['Provider', [provider.kind, provider.deployment, provider.revision].filter(Boolean).join(' · ') || 'not recorded'],
        ['Replay vs fresh', provider.replay === false ? 'server reported fresh' : provider.replay === true ? 'server reported replay' : 'not reported'],
        ['Attempts', String(progress.attempts || 0) + ' total, ' + String(progress.failedAttempts || 0) + ' failed'],
        ['Skipped work', (progress.skippedWork || []).join(', ') || 'none recorded'],
        ['Incomplete work', (progress.incompleteWork || []).join(', ') || 'none recorded'],
        ['Comparison', (comparison.status || 'inconclusive') + ': ' + (comparison.reason || 'repeated-run statistics pending')],
        ['Redacted evidence', evidence.redactedEvidencePresent ? 'present; never a clean pass' : 'none reported']
      ]),
      detailsBlock('Attempt failures', failures.map(function (failure) {
        return 'Attempt ' + String(failure.attempt || '?') + ' ' +
          String(failure.status || 'failed') + ': ' + String(failure.outcomeCode || 'outcome unavailable');
      }), 'No attempt failures returned.'),
      detailsBlock('Raw output', artifacts.rawOutput, 'Raw output unavailable or redacted.'),
      detailsBlock('Repaired output', artifacts.repairedOutput, 'Repaired output unavailable or redacted.'),
      detailsBlock('Final output', artifacts.finalOutput, 'Final output unavailable or redacted.'),
      detailsBlock('Tools', artifacts.tools, 'Tool trace unavailable or redacted.'),
      detailsBlock('State changes', artifacts.stateChanges, 'State changes unavailable or redacted.'),
      h('div', { className: 'card-foot' }, [
        h('span', { className: 'pill ghost', text: 'inconclusive: repeated-run statistics pending' }),
        h('span', { className: 'pill ghost', text: 'Critical regressions first when statistics land' })
      ])
    ]);
  }

  function runControlSection() {
    var built = workingBand('Launch and inspect controlled Ciel runs', 'Code-owned configs, D6 cost envelope and shared operations');
    var section = built.section;
    var bandBody = built.body;
    var datasetSelect = select(RUN_DATASETS.map(function (dataset) {
      return option(dataset.id, dataset.label);
    }));
    var baselineSelect = select([option('prompt.synthetic.baseline', RUN_CONFIGS['prompt.synthetic.baseline'].label)]);
    var candidateSelect = select([option('prompt.synthetic.candidate', RUN_CONFIGS['prompt.synthetic.candidate'].label)]);
    var modeSelect = select([
      option('offline_replay', 'Offline replay'),
      option('fresh_capture', 'Fresh inference'),
      option('scoring_only', 'Scoring only')
    ]);
    var providerSelect = select([
      option('offline_fixture', 'Offline fixture'),
      option('azure_openai', 'Azure OpenAI approved deployment')
    ]);
    var repeats = input('number', '1');
    repeats.setAttribute('min', '1');
    repeats.setAttribute('max', '10');
    var estimate = input('number', '125');
    estimate.setAttribute('min', '0');
    estimate.setAttribute('max', '2500');
    var concurrency = input('number', '0');
    concurrency.setAttribute('min', '0');
    concurrency.setAttribute('max', '4');
    var approvalRef = input('text', 'runtime/approval/9802');
    var approvedBy = input('text', '0a2dfb53-f68e-4cb1-a116-76ad64c1404f');
    datasetSelect.value = RUN_DATASETS[0].id;
    baselineSelect.value = 'prompt.synthetic.baseline';
    candidateSelect.value = 'prompt.synthetic.candidate';
    modeSelect.value = 'offline_replay';
    providerSelect.value = 'offline_fixture';
    var launchError = h('div', { className: 'field-error', role: 'alert' });
    var launchResult = h('div', { className: 'run-launch-result', 'aria-live': 'polite' });
    var inspectRunId = input('text');
    var inspectError = h('div', { className: 'field-error', role: 'alert' });
    var inspectResult = h('div', { className: 'run-inspection-result', 'aria-live': 'polite' });
    var launchState = null;
    var launchInFlight = false;
    var currentRun = null;
    var inspectionGeneration = 0;

    function draft() {
      return {
        mode: modeSelect.value,
        providerKind: providerSelect.value,
        repeatsPerConfig: requirePositiveInteger(repeats.value, 'Repeats per config'),
        estimatedCostCents: requirePositiveInteger(estimate.value, 'Estimated cost cents'),
        providerConcurrency: Number(concurrency.value || '0'),
        approvalRef: requireReference(approvalRef.value, 'Approval reference'),
        approvedBy: requireUuid(approvedBy.value, 'Approving owner')
      };
    }

    function renderLaunchItem(label, response) {
      var value = response && response.resource && response.resource.value;
      if (value && value.runId) inspectRunId.value = value.runId;
      return h('article', { className: 'run-launch-item' }, [
        h('h3', { text: label }),
        value
          ? detailList([
            ['Run', value.runId],
            ['Status', value.status],
            ['Budget', String(value.budget && value.budget.estimatedCostCents || 0) + 'c expected'],
            ['Revision', String(value.revision || 1)]
          ])
          : h('p', { className: 'field-hint', text: 'No run resource returned.' })
      ]);
    }

    launchResult.setAttribute('id', 'ciel-run-launch-result');
    inspectResult.setAttribute('id', 'ciel-run-inspection-result');

    function launchSignature(dataset, selectedDraft) {
      return JSON.stringify({
        datasetId: dataset.id,
        baseline: baselineSelect.value,
        candidate: candidateSelect.value,
        draft: selectedDraft
      });
    }

    function currentLaunchState(dataset, selectedDraft) {
      var signature = launchSignature(dataset, selectedDraft);
      if (!launchState || launchState.signature !== signature) {
        launchState = {
          signature: signature,
          baselineRequest: runLaunchRequest(dataset, baselineSelect.value, selectedDraft, 'baseline'),
          candidateRequest: runLaunchRequest(dataset, candidateSelect.value, selectedDraft, 'candidate'),
          baselineResponse: null,
          candidateResponse: null
        };
      }
      return launchState;
    }

    function renderLaunchState(state) {
      clearNode(launchResult);
      if (state && state.baselineResponse) {
        launchResult.appendChild(renderLaunchItem('Baseline', state.baselineResponse));
      }
      if (state && state.candidateResponse) {
        launchResult.appendChild(renderLaunchItem('Candidate', state.candidateResponse));
      }
    }

    function resetLaunchState() {
      launchState = null;
      clearNode(launchResult);
      clearNode(launchError);
    }

    var launchForm = h('form', { className: 'card run-launch-form' }, [
      shell.cardHead('Launch baseline and candidate', 'Selections are fixed in code; endpoints and commands are never free text'),
      h('div', { className: 'card-body q-grid browse-filter-grid' }, [
        field('ciel-run-dataset', 'Frozen dataset release', datasetSelect),
        field('ciel-run-baseline', 'Baseline config', baselineSelect),
        field('ciel-run-candidate', 'Candidate config', candidateSelect),
        field('ciel-run-mode', 'Run mode', modeSelect),
        field('ciel-run-provider', 'Provider', providerSelect),
        field('ciel-run-repeats', 'Repeats per config', repeats),
        field('ciel-run-estimate', 'Approved estimate, cents', estimate),
        field('ciel-run-concurrency', 'Provider concurrency', concurrency),
        field('ciel-run-approval-ref', 'Approval reference', approvalRef),
        field('ciel-run-approved-by', 'Approving owner', approvedBy)
      ]),
      h('div', { className: 'card-foot evidence-actions' }, [
        h('p', { className: 'field-hint', text: 'The server enforces D6 caps again. The dashboard only sends the approved spend envelope.' }),
        h('button', { className: 'btn btn-primary', type: 'submit', text: 'Launch controlled pair' })
      ]),
      launchError
    ]);
    launchForm.setAttribute('id', 'ciel-run-launch-form');

    launchForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      clearNode(launchError);
      var selectedDataset = RUN_DATASETS.filter(function (entry) { return entry.id === datasetSelect.value; })[0];
      var selectedDraft;
      try {
        selectedDraft = draft();
      } catch (caught) {
        launchError.textContent = caught && caught.message ? caught.message : 'Run launch input is invalid.';
        return;
      }
      var state = currentLaunchState(selectedDataset, selectedDraft);
      renderLaunchState(state);
      if (launchInFlight) {
        launchError.textContent = 'A controlled launch is already in progress.';
        return;
      }
      launchInFlight = true;
      try {
        if (!state.baselineResponse) {
          state.baselineResponse = await session.call('/api/ops/ciel/operations', { method: 'POST', body: state.baselineRequest });
          renderLaunchState(state);
        }
        if (!state.candidateResponse) {
          state.candidateResponse = await session.call('/api/ops/ciel/operations', { method: 'POST', body: state.candidateRequest });
          renderLaunchState(state);
        }
        shell.announce('Controlled Ciel runs launched.');
      } catch (caught) {
        renderLaunchState(state);
        if (state.baselineResponse && !state.candidateResponse) {
          launchError.textContent = 'Candidate launch failed after baseline succeeded: ' + (caught && caught.message ? caught.message : 'try again with a new idempotency key.');
          shell.announce('Candidate launch failed; baseline result remains visible.');
        } else {
          launchError.textContent = caught && caught.message ? caught.message : 'Controlled run launch failed.';
        }
      } finally {
        launchInFlight = false;
      }
    });

    var inspectForm = h('form', { className: 'card run-inspect-form' }, [
      shell.cardHead('Inspect, cancel or retry a run', 'Progress, cost, provider provenance and redaction state'),
      h('div', { className: 'card-body q-grid' }, [
        field('ciel-run-inspect-id', 'Run ID', inspectRunId, 'Paste a run id returned by launch or by the CLI.')
      ]),
      h('div', { className: 'card-foot evidence-actions' }, [
        h('button', { className: 'btn btn-primary', type: 'submit', text: 'Inspect run' }),
        h('button', { id: 'ciel-run-cancel', className: 'btn btn-sm', type: 'button', text: 'Cancel inspected run' }),
        h('button', { id: 'ciel-run-retry', className: 'btn btn-sm', type: 'button', text: 'Retry failed run' })
      ]),
      inspectError
    ]);
    inspectForm.setAttribute('id', 'ciel-run-inspect-form');

    function runId() {
      return requireUuid(inspectRunId.value, 'Run ID');
    }

    function invalidateInspection() {
      inspectionGeneration += 1;
      currentRun = null;
      clearNode(inspectResult);
    }

    inspectForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      clearNode(inspectError);
      invalidateInspection();
      var acceptedRunId;
      try {
        acceptedRunId = runId();
      } catch (caught) {
        inspectError.textContent = caught && caught.message ? caught.message : 'Run inspection failed.';
        return;
      }
      var generation = inspectionGeneration;
      try {
        var request = runEnvelope('ciel.run.get', { runId: acceptedRunId });
        var response = await session.call('/api/ops/ciel/operations', { method: 'POST', body: request });
        var value = response && response.resource && response.resource.value;
        var currentInputRunId;
        try {
          currentInputRunId = runId();
        } catch (caught) {
          return;
        }
        if (generation !== inspectionGeneration || !value || value.runId !== acceptedRunId || currentInputRunId !== acceptedRunId) {
          return;
        }
        currentRun = value;
        inspectResult.appendChild(renderRunResource(response && response.resource));
        shell.announce('Ciel run inspection loaded.');
      } catch (caught) {
        if (generation !== inspectionGeneration) return;
        currentRun = null;
        clearNode(inspectResult);
        inspectError.textContent = caught && caught.message ? caught.message : 'Run inspection failed.';
      }
    });

    inspectRunId.required = true;
    inspectRunId.addEventListener('input', invalidateInspection);
    [datasetSelect, baselineSelect, candidateSelect, modeSelect, providerSelect, repeats, estimate, concurrency, approvalRef, approvedBy].forEach(function (control) {
      control.addEventListener('change', resetLaunchState);
      control.addEventListener('input', resetLaunchState);
    });
    var cancelButton = inspectForm.children[2].children[1];
    var retryButton = inspectForm.children[2].children[2];
    cancelButton.addEventListener('click', async function () {
      clearNode(inspectError);
      try {
        if (!currentRun) throw new Error('Inspect a run before cancelling it.');
        if (runId() !== currentRun.runId) throw new Error('Inspect a run before cancelling it.');
        var request = runEnvelope('ciel.run.cancel', {
          runId: currentRun.runId,
          reason: 'Cancelled from the Ciel admin dashboard.'
        });
        request.expectedRevision = currentRun.revision;
        request.idempotencyKey = 'dashboard-run-cancel-' + request.requestId;
        var response = await session.call('/api/ops/ciel/operations', { method: 'POST', body: request });
        currentRun = response && response.resource && response.resource.value;
        clearNode(inspectResult);
        inspectResult.appendChild(renderRunResource(response && response.resource));
      } catch (caught) {
        inspectError.textContent = caught && caught.message ? caught.message : 'Cancel failed.';
      }
    });
    retryButton.addEventListener('click', async function () {
      clearNode(inspectError);
      try {
        if (!currentRun) throw new Error('Inspect a run before retrying it.');
        if (runId() !== currentRun.runId) throw new Error('Inspect a run before retrying it.');
        var request = runEnvelope('ciel.run.retry', {
          runId: currentRun.runId,
          reason: 'Retry failed attempts from the Ciel admin dashboard.'
        });
        request.idempotencyKey = 'dashboard-run-retry-' + request.requestId;
        var response = await session.call('/api/ops/ciel/operations', { method: 'POST', body: request });
        currentRun = response && response.resource && response.resource.value;
        clearNode(inspectResult);
        inspectResult.appendChild(renderRunResource(response && response.resource));
      } catch (caught) {
        inspectError.textContent = caught && caught.message ? caught.message : 'Retry failed.';
      }
    });

    bandBody.appendChild(launchForm);
    bandBody.appendChild(launchResult);
    bandBody.appendChild(inspectForm);
    bandBody.appendChild(inspectResult);
    return section;
  }

  function attributeOf(node, name) {
    if (typeof node.getAttribute === 'function') return node.getAttribute(name) || '';
    return node.attributes && node.attributes[name] ? node.attributes[name] : '';
  }

  function appendDescription(node, id) {
    var existing = attributeOf(node, 'aria-describedby')
      .split(/\s+/)
      .filter(Boolean);
    if (existing.indexOf(id) === -1) existing.push(id);
    node.setAttribute('aria-describedby', existing.join(' '));
  }

  function datasetValidationSection() {
    var declarations = h('textarea', {
      className: 'field-input',
      rows: 12,
      spellcheck: 'false',
      placeholder: 'Paste the dataset validation input JSON.'
    });
    declarations.required = true;
    declarations.setAttribute('aria-describedby', 'dataset-input-hint dataset-limitations dataset-error');
    var declarationField = field('dataset-input', 'Dataset validation input', declarations);
    declarationField.appendChild(h('p', {
      id: 'dataset-input-hint',
      className: 'field-hint',
      text: 'Synthetic declarations only. Supply a JSON object with datasets and fixtureDigests. The server checks references, proposed labels and declared lineage within this request.'
    }));
    var error = h('div', { id: 'dataset-error', className: 'field-error', role: 'alert' });
    var result = h('div', { className: 'dataset-result', 'aria-live': 'polite' });
    var submit = h('button', {
      className: 'btn btn-primary',
      type: 'submit',
      text: 'Validate declarations'
    });
    var generation = 0;
    var pending = false;
    /* No card head: the band above already names this, and the submit button
       already says what pressing it does. */
    var form = h('form', { className: 'card dataset-form' }, [
      h('div', { className: 'card-body' }, [
        declarationField,
        h('p', {
          id: 'dataset-limitations',
          className: 'field-hint',
          text: 'Validation does not inspect referenced files, admit evidence, verify qualifications or approve a release.'
        }),
        error
      ]),
      h('div', { className: 'card-foot evidence-actions' }, [submit])
    ]);

    declarations.addEventListener('input', function () {
      generation += 1;
      result.textContent = '';
      error.textContent = '';
      declarations.setAttribute('aria-invalid', 'false');
    });

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (pending) return;
      error.textContent = '';
      result.textContent = '';
      declarations.setAttribute('aria-invalid', 'false');
      var inputValue;
      try {
        inputValue = JSON.parse(declarations.value);
      } catch (caught) {
        error.textContent = 'Enter valid JSON containing datasets and fixtureDigests.';
        declarations.setAttribute('aria-invalid', 'true');
        declarations.focus();
        return;
      }
      var submittedGeneration = ++generation;
      pending = true;
      submit.disabled = true;
      submit.textContent = 'Validating...';
      try {
        var requestId = global.crypto.randomUUID();
        var response = await session.call('/api/ops/ciel/operations', {
          method: 'POST',
          body: {
            schemaVersion: 'ciel.operation.request.v1',
            requestId: requestId,
            operationId: 'ciel.dataset.validate',
            mode: 'remote',
            client: {
              name: 'aria-operations-dashboard',
              version: '1.0.0',
              contractVersions: ['ciel.operations.v1']
            },
            input: inputValue
          }
        });
        if (submittedGeneration !== generation) return;
        var resource = response && response.resource;
        var value = resource && resource.value;
        if (!response || response.schemaVersion !== 'ciel.operation.response.v1' ||
            response.requestId !== requestId || response.operationId !== 'ciel.dataset.validate' ||
            response.status !== 'success' || response.exitCode !== 0 ||
            !resource || resource.type !== 'ciel.dataset-validation' ||
            !value || value.valid !== true || !Array.isArray(value.digests) ||
            !value.digests.length || value.digests.some(function (entry) {
              return !entry || typeof entry.datasetId !== 'string' ||
                !Number.isInteger(entry.revision) || entry.revision < 1 ||
                typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256);
            })) {
          throw new Error('Dataset validation did not return a valid result for this request.');
        }
        var rows = [metadataRow('Request', requestId)];
        value.digests.forEach(function (entry) {
          rows.push(metadataRow(entry.datasetId + ' / revision ' + entry.revision, entry.sha256));
        });
        result.appendChild(h('div', { className: 'card' }, [
          shell.cardHead('Declarations valid'),
          h('dl', { className: 'card-body evidence-meta' }, rows),
          h('div', {
            className: 'card-foot',
            text: 'These digests identify the supplied manifests. Referenced bytes and proposed labels have not been verified.'
          })
        ]));
        shell.announce('Dataset declarations valid. Referenced bytes have not been verified.');
      } catch (caught) {
        if (submittedGeneration !== generation) return;
        error.textContent = caught && caught.message
          ? maskContactDetails(caught.message)
          : 'Dataset declarations could not be validated.';
        if (caught && Array.isArray(caught.details) && caught.details.length) {
          error.appendChild(h('ul', { className: 'dataset-issues' }, caught.details.map(function (entry) {
            var path = entry && entry.path !== undefined ? maskContactDetails(String(entry.path)) : '';
            var reason = entry && entry.reason !== undefined ? maskContactDetails(String(entry.reason)) : '';
            return h('li', { text: path + ': ' + reason });
          })));
        }
        if (caught && (caught.code === 'validation_failed' || caught.code === 'invalid_request')) {
          declarations.setAttribute('aria-invalid', 'true');
          declarations.focus();
        }
        shell.announce('Dataset validation failed.');
      } finally {
        pending = false;
        submit.disabled = false;
        submit.textContent = 'Validate declarations';
      }
    });

    var built = workingBand('Check a dataset declaration', 'Any signed-in role, and no dataset is stored');
    var section = built.section;
    var bandBody = built.body;
    bandBody.appendChild(form);
    bandBody.appendChild(result);
    return section;
  }

  function evidenceQuarantineSection() {
    var built = workingBand('Put evidence into quarantine', 'Operator and owner, 5 MiB and 90 days at most');
    var section = built.section;
    var bandBody = built.body;

    /* A padlock, not the warning triangle. Both callouts on this pane wore the
       triangle, so the one that is actually a warning — the trust note above
       the approval handoff — had no glyph of its own to be told apart by.
       This one states a boundary rather than a risk, and a boundary is a lock.
       Stadiora/Aria#10647. */
    bandBody.appendChild(h('div', { className: 'callout' }, [
      icon('lock'),
      h('div', {}, [
        h('strong', { text: 'Quarantine is not permission to use evidence.' }),
        h('p', {
          text: 'Every import stays blocked pending qualified review. Export grants, dashboard roles, redaction and storage do not create evaluation or training consent.'
        })
      ])
    ]));

    if (!session.hasRole(['owner', 'operator'])) {
      var denied = shell.card();
      denied.appendChild(shell.stateBlock('lock', 'Evidence import needs operator access', [
        'Your role can validate declarations above, which stores nothing. Putting bytes into quarantine is an operator and owner action.'
      ]));
      bandBody.appendChild(denied);
      return section;
    }

    var fileInput = input('file');
    fileInput.setAttribute('accept', '.json,.txt,image/jpeg,image/png,audio/mpeg,audio/wav,video/mp4,video/quicktime');
    var source = select([
      option('synthetic', 'Synthetic'),
      option('production_derived', 'Production-derived')
    ]);
    var profile = select([option('trace', 'Trace or transcript'), option('media', 'Media')]);
    var mediaType = select([
      option('application/json', 'JSON'),
      option('text/plain', 'Plain text'),
      option('image/jpeg', 'JPEG image'),
      option('image/png', 'PNG image'),
      option('audio/mpeg', 'MP3 audio'),
      option('audio/wav', 'WAV audio'),
      option('video/mp4', 'MP4 video'),
      option('video/quicktime', 'QuickTime video')
    ]);
    var purpose = select([
      option('regression_evaluation', 'Regression evaluation'),
      option('incident_reproduction', 'Incident reproduction'),
      option('quality_review', 'Quality review')
    ]);
    var expiry = input('datetime-local');
    var defaultExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    // datetime-local needs wall-clock fields at the expiry instant's DST offset.
    expiry.value = new Date(defaultExpiry.getTime() -
      defaultExpiry.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 16);
    var necessary = input('text', 'none');
    var removed = input('text', 'none');
    var idempotency = input('text');
    var authority = input('text');
    var consent = input('text');
    var providerApproval = input('text');
    var productionFields = h('fieldset', { className: 'evidence-authority' }, [
      h('legend', { text: 'Production-derived authority' }),
      h('p', {
        className: 'field-hint',
        text: 'All three references must exactly match a server-approved digest authorization. Dashboard access is not approval.'
      }),
      field('evidence-authority', 'Authority reference', authority),
      field('evidence-consent', 'Consent reference', consent),
      field('evidence-provider', 'Provider handling approval reference', providerApproval)
    ]);
    var selected = h('p', {
      className: 'field-hint',
      text: 'No file selected. The page never displays raw evidence.'
    });
    var error = h('div', { className: 'field-error', role: 'alert' });
    var status = h('div', { className: 'evidence-result', 'aria-live': 'polite' });
    var submit = h('button', {
      className: 'btn btn-primary',
      type: 'submit',
      text: 'Quarantine evidence'
    });
    var evidenceAvailability = h('p', {
      className: 'field-hint',
      text: 'The backend decides whether quarantine is available. Evidence quarantine answers only when private storage and authority settings are configured. If the backend refuses, submitting changes nothing and this pane shows the refusal.'
    });
    evidenceAvailability.setAttribute('id', 'evidence-availability-note');
    appendDescription(submit, 'evidence-availability-note');

    function updateSourceFields() {
      var production = source.value === 'production_derived';
      productionFields.hidden = !production;
      [authority, consent, providerApproval].forEach(function (control) {
        control.disabled = !production;
        control.required = production;
      });
    }

    source.addEventListener('change', updateSourceFields);
    profile.addEventListener('change', function () {
      mediaType.value = profile.value === 'trace' ? 'application/json' : 'image/jpeg';
    });
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      selected.textContent = file
        ? file.name + ' · ' + file.size.toLocaleString() + ' bytes'
        : 'No file selected. The page never displays raw evidence.';
      if (file && Array.prototype.some.call(mediaType.options, function (entry) {
        return entry.value === file.type;
      })) {
        mediaType.value = file.type;
        profile.value = file.type === 'application/json' || file.type === 'text/plain' ? 'trace' : 'media';
      }
    });
    updateSourceFields();

    var form = h('form', { className: 'card evidence-form' }, [
      shell.cardHead('Import a file', 'Bytes leave this page only on submit'),
      h('div', { className: 'card-body' }, [
        field('evidence-file', 'Evidence file', fileInput,
          'Text and JSON are inspected and redacted server-side; media requires manual review.'),
        selected,
        h('div', { className: 'q-grid' }, [
          field('evidence-source', 'Source', source),
          field('evidence-profile', 'Content profile', profile),
          field('evidence-type', 'Media type', mediaType),
          field('evidence-purpose', 'Purpose', purpose),
          field('evidence-expiry', 'Retention expires at', expiry,
            'Local time (' + Intl.DateTimeFormat().resolvedOptions().timeZone +
            '), minute precision; sent as UTC. This slice records expiry; automated expiry enforcement is delivered separately.'),
          field('evidence-key', 'Idempotency key', idempotency,
            'Optional. Blank generates a unique key; reuse a key only for an identical request.')
        ]),
        h('div', { className: 'q-grid' }, [
          field('evidence-necessary', 'Necessary privacy categories', necessary,
            'Comma-separated contract categories, or none. Sensitive categories are not accepted as necessary.'),
          field('evidence-removed', 'Categories removed before import', removed,
            'Comma-separated contract categories; leave blank when none were removed.')
        ]),
        productionFields,
        evidenceAvailability,
        error
      ]),
      h('div', { className: 'card-foot evidence-actions' }, [submit])
    ]);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      error.textContent = '';
      status.textContent = '';
      var file = fileInput.files && fileInput.files[0];
      if (!file) {
        error.textContent = 'Choose an evidence file.';
        fileInput.focus();
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Quarantining…';
      file.arrayBuffer().then(function (buffer) {
        return buildQuarantineRequest({
          bytes: new Uint8Array(buffer),
          mediaType: mediaType.value,
          contentProfile: profile.value,
          sourceKind: source.value,
          purpose: purpose.value,
          expiresAt: expiry.value,
          idempotencyKey: idempotency.value,
          necessaryCategories: necessary.value,
          removedCategories: removed.value,
          authorityRef: authority.value,
          consentRef: consent.value,
          providerApprovalRef: providerApproval.value
        });
      }).then(function (request) {
        return session.call('/api/ops/ciel/operations', {
          method: 'POST',
          body: request
        });
      }).then(function (response) {
        if (!response || response.status !== 'success' || !response.resource || !response.resource.value) {
          var operationError = response && response.error;
          throw new Error(operationError && operationError.message
            ? operationError.message
            : 'The quarantine operation did not return a completed resource.');
        }
        var resource = response.resource.value;
        status.appendChild(h('div', { className: 'card' }, [
          shell.cardHead('Quarantined, review required', null, [
            stamp('u-tag works', 'lock', 'No access granted')
          ]),
          h('dl', { className: 'card-body evidence-meta' }, [
            metadataRow('Artifact', String(resource.artifactId || response.resource.id)),
            metadataRow('State', String(resource.state || 'quarantined')),
            metadataRow('Revision', String(resource.revision || response.resource.revision))
          ]),
          h('div', {
            className: 'card-foot',
            text: 'Raw content and storage locations are intentionally not returned.'
          })
        ]));
        shell.announce('Evidence moved into private quarantine. Manual review is still required.');
        fileInput.value = '';
        selected.textContent = 'No file selected. The page never displays raw evidence.';
      }).catch(function (caught) {
        error.textContent = caught && caught.message
          ? maskContactDetails(caught.message)
          : 'Evidence could not be quarantined. Check the documented fields and try again.';
        shell.announce('Evidence quarantine failed.');
      }).finally(function () {
        submit.disabled = false;
        submit.textContent = 'Quarantine evidence';
      });
    });

    bandBody.appendChild(form);
    bandBody.appendChild(status);
    return section;
  }

  function approvalSection() {
    var canMutateEvidence = session.hasRole(['owner', 'operator']);
    var approvalArtifactId = input('text');
    var approvalArtifactRevision = input('number', '1');
    var approvalSourceDigest = input('text');
    var approvalRetainedDigest = input('text');
    var approvalTargetDigest = input('text');
    var approvalPurpose = select([
      option('regression_evaluation', 'Regression evaluation'),
      option('incident_reproduction', 'Incident reproduction'),
      option('quality_review', 'Quality review')
    ]);
    var approvalPolicyRevision = input('text');
    var approvalExpiry = input('datetime-local');
    var defaultExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    approvalExpiry.value = new Date(defaultExpiry.getTime() -
      defaultExpiry.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 16);
    var approvalRequestKey = input('text');
    var approvalRequestError = h('div', { className: 'field-error', role: 'alert' });
    var approvalRequestSubmit = h('button', {
      className: 'btn btn-primary',
      type: 'submit',
      text: 'Create pending request'
    });
    var approvalAvailabilityText = 'The backend decides whether approval operations are available. Under Aria ADR 0040, approval actions stay closed until an external qualification issuer exists. If the backend refuses, submitting changes nothing and this pane shows the refusal.';
    var approvalRequestAvailability = h('p', {
      className: 'field-hint',
      text: approvalAvailabilityText
    });
    approvalRequestAvailability.setAttribute('id', 'approval-request-availability-note');
    appendDescription(approvalRequestSubmit, 'approval-request-availability-note');
    var approvalRequestForm = h('form', { className: 'stack' }, [
      h('div', { className: 'grid g2 evidence-form-grid' }, [
        field('approval-artifact-id', 'Artifact ID', approvalArtifactId),
        field('approval-artifact-revision', 'Artifact revision', approvalArtifactRevision),
        field('approval-source-digest', 'Source SHA-256', approvalSourceDigest),
        field('approval-retained-digest', 'Retained SHA-256', approvalRetainedDigest),
        field('approval-target-digest', 'Canonical admission request SHA-256', approvalTargetDigest),
        field('approval-purpose', 'Purpose', approvalPurpose),
        field('approval-policy-revision', 'Policy revision', approvalPolicyRevision),
        field('approval-expiry', 'Approval expires at', approvalExpiry,
          'Local time; submitted as UTC. Expiry never grants evidence access.'),
        field('approval-request-key', 'Idempotency key', approvalRequestKey,
          'Optional. Reuse only for the same exact digest binding.')
      ]),
      approvalRequestAvailability,
      approvalRequestError,
      h('div', { className: 'row evidence-actions' }, [approvalRequestSubmit])
    ]);
    approvalRequestForm.setAttribute('id', 'approval-request-form');
    approvalRequestForm.setAttribute('novalidate', '');

    var approvalGetId = input('text');
    var approvalGetError = h('div', { className: 'field-error', role: 'alert' });
    var approvalGetSubmit = h('button', {
      className: 'btn',
      type: 'submit',
      text: 'Load request'
    });
    var approvalGetAvailability = h('p', {
      className: 'field-hint',
      text: approvalAvailabilityText
    });
    approvalGetAvailability.setAttribute('id', 'approval-get-availability-note');
    appendDescription(approvalGetSubmit, 'approval-get-availability-note');
    var approvalGetForm = h('form', { className: 'stack' }, [
      field('approval-get-id', 'Approval request ID', approvalGetId),
      approvalGetAvailability,
      approvalGetError,
      h('div', { className: 'row evidence-actions' }, [approvalGetSubmit])
    ]);
    approvalGetForm.setAttribute('id', 'approval-get-form');
    approvalGetForm.setAttribute('novalidate', '');

    var approvalDecisionId = input('text');
    var approvalExpectedRevision = input('number', '1');
    var approvalDecision = select([
      option('approved', 'Approve'),
      option('rejected', 'Reject')
    ]);
    var approvalReason = input('text');
    var approvalDecisionKey = input('text');
    var approvalDecisionError = h('div', { className: 'field-error', role: 'alert' });
    var approvalDecisionSubmit = h('button', {
      className: 'btn btn-primary',
      type: 'submit',
      text: 'Record decision'
    });
    var approvalDecisionAvailability = h('p', {
      className: 'field-hint',
      text: approvalAvailabilityText
    });
    approvalDecisionAvailability.setAttribute('id', 'approval-decision-availability-note');
    appendDescription(approvalDecisionSubmit, 'approval-decision-availability-note');
    var approvalDecisionForm = h('form', { className: 'stack' }, [
      h('div', { className: 'grid g2 evidence-form-grid' }, [
        field('approval-decision-id', 'Approval request ID', approvalDecisionId),
        field('approval-expected-revision', 'Expected revision', approvalExpectedRevision),
        field('approval-decision', 'Decision', approvalDecision),
        field('approval-reason', 'Decision reason', approvalReason,
          'Concise rationale only; do not paste evidence content.'),
        field('approval-decision-key', 'Idempotency key', approvalDecisionKey,
          'Optional. Reuse only for the same decision.')
      ]),
      approvalDecisionAvailability,
      approvalDecisionError,
      h('div', { className: 'row evidence-actions' }, [approvalDecisionSubmit])
    ]);
    approvalDecisionForm.setAttribute('id', 'approval-decision-form');
    approvalDecisionForm.setAttribute('novalidate', '');

    var approvalResult = h('div', {
      className: 'form-alert is-ok',
      role: 'status'
    });
    approvalResult.setAttribute('id', 'approval-result');
    var approvalAutofilledDecision = null;
    var approvalTrustNote = h('div', {
      className: 'callout callout-warn'
    }, [
      icon('warn'),
      h('div', {}, [
        /* One word, carrying the same fact as the amber for anyone the amber
           does not reach — a monochrome screen, a printout, forced-colours
           mode, or simply not knowing that this pane's amber means caution.
           #10456's fix added a word for the same reason: the rule is that
           colour is never the only channel, and the cost of holding to it
           here is one word. Stadiora/Aria#10647. */
        h('strong', { text: 'Warning: qualification comes from an external trust record.' }),
        h('p', {
          text: 'This dashboard cannot provision qualification. Owner role and fresh authentication remain necessary but do not make a reviewer qualified.'
        })
      ])
    ]);
    approvalTrustNote.setAttribute('id', 'approval-trust-note');

    /* A step of the handoff. shell.cardHead builds exactly this head — an h3
       .card-title with a .card-note under it — so the hand-rolled copy that
       used to sit here existed only to spell the note `card-hint`, a name
       ops.css painted and this page does not load. The note therefore rendered
       at 13.5px in full ink: the same size and the same colour as the title
       above it, which is what a card's explanatory sentence must not be
       (Stadiora/Aria#10647). The shell's own shape, and the shell's own class,
       instead of a second spelling of both. */
    function approvalCard(title, hint, approvalForm) {
      return h('div', { className: 'card approval-card' }, [
        shell.cardHead(title, hint),
        h('div', { className: 'card-body' }, [approvalForm])
      ]);
    }

    function showApprovalResult(response) {
      var resource = response && response.resource;
      var value = resource && resource.value;
      if (!value) throw new Error('The approval operation did not return a resource.');
      var resultId = String(value.approvalRequestId || resource.id || '');
      var resultRevision = String(value.revision || resource.revision || '');
      var message = 'Approval request ' +
        resultId + ' is ' +
        String(value.state) + ' at revision ' +
        resultRevision + '.';

      /* Just the text. The slot is never `hidden`, so this is a change
         inside a region an assistive technology is already watching.

         role="status" is a live region, and what an AT reads is a
         serialisation of the accessibility tree, which Blink produces at a
         rendering opportunity rather than once per task. A region that is
         `hidden` when the task begins is not in the tree at all, so revealing
         it and filling it announces a region that arrives already holding its
         text — a live region CREATION, which is the unreliable case
         Stadiora/Aria#10809 was filed about.

         Deferring the fill by a task does not fix that, and the measurement
         is unambiguous: 20 runs out of 20 put ZERO rendering opportunities
         between a `setTimeout(0)` and the reveal before it, so both land in
         the same serialisation and the AT sees the same creation it saw
         before. The fix is not to time the reveal better but to stop needing
         one — the slot is in the document and in the tree from construction,
         empty, and `#approval-result:empty` in pane-evaluations-v2.css gives
         it no extent while it has nothing to say. */
      approvalResult.textContent = message;

      if (resource.id) {
        approvalGetId.value = resource.id;
        approvalDecisionId.value = resource.id;
      }
      if (resource.revision) approvalExpectedRevision.value = String(resource.revision);
      approvalAutofilledDecision = {
        id: approvalDecisionId.value,
        revision: approvalExpectedRevision.value
      };
    }

    function clearAutofilledDecisionTarget() {
      if (!approvalAutofilledDecision) return;
      if (approvalDecisionId.value === approvalAutofilledDecision.id) approvalDecisionId.value = '';
      if (approvalExpectedRevision.value === approvalAutofilledDecision.revision) approvalExpectedRevision.value = '';
      approvalAutofilledDecision = null;
    }

    function invalidateApprovalResult(clearDecisionTarget) {
      approvalResult.textContent = '';
      if (clearDecisionTarget) clearAutofilledDecisionTarget();
    }

    approvalRequestForm.addEventListener('submit', function (event) {
      event.preventDefault();
      approvalRequestError.textContent = '';
      approvalRequestSubmit.disabled = true;
      approvalRequestSubmit.textContent = 'Creating…';
      var request;
      try {
        request = buildApprovalRequest({
          artifactId: approvalArtifactId.value.trim(),
          artifactRevision: Number(approvalArtifactRevision.value),
          sourceDigest: approvalSourceDigest.value.trim(),
          retainedDigest: approvalRetainedDigest.value.trim(),
          targetRequestDigest: approvalTargetDigest.value.trim(),
          purpose: approvalPurpose.value,
          policyRevision: approvalPolicyRevision.value.trim(),
          expiresAt: new Date(approvalExpiry.value).toISOString(),
          idempotencyKey: approvalRequestKey.value.trim()
        }, global.crypto.randomUUID());
      } catch (caught) {
        approvalRequestError.textContent = caught && caught.message
          ? maskContactDetails(caught.message)
          : 'The approval request is invalid.';
        approvalRequestSubmit.disabled = false;
        approvalRequestSubmit.textContent = 'Create pending request';
        return;
      }
      invalidateApprovalResult(true);
      session.call('/api/ops/ciel/operations', {
        method: 'POST',
        body: request
      }).then(function (response) {
        showApprovalResult(response);
        shell.announce('Approval request created.');
      }).catch(function (caught) {
        approvalRequestError.textContent = caught && caught.message
          ? maskContactDetails(caught.message)
          : 'The approval request failed.';
      }).finally(function () {
        approvalRequestSubmit.disabled = false;
        approvalRequestSubmit.textContent = 'Create pending request';
      });
    });

    approvalGetForm.addEventListener('submit', function (event) {
      event.preventDefault();
      approvalGetError.textContent = '';
      /* Emptied, not hidden: hiding it between answers is what takes the
         live region out of the accessibility tree, so the next answer has to
         announce a region that did not exist a moment ago. Empty, it is
         still there and still has no extent. */
      invalidateApprovalResult(true);
      approvalGetSubmit.disabled = true;
      approvalGetSubmit.textContent = 'Loading…';
      session.call('/api/ops/ciel/operations', {
        method: 'POST',
        body: buildApprovalGet({
          approvalRequestId: approvalGetId.value.trim()
        }, global.crypto.randomUUID())
      }).then(function (response) {
        showApprovalResult(response);
      }).catch(function (caught) {
        approvalGetError.textContent = caught && caught.message
          ? maskContactDetails(caught.message)
          : 'The approval request could not be loaded.';
      }).finally(function () {
        approvalGetSubmit.disabled = false;
        approvalGetSubmit.textContent = 'Load request';
      });
    });

    approvalDecisionForm.addEventListener('submit', function (event) {
      event.preventDefault();
      approvalDecisionError.textContent = '';
      invalidateApprovalResult(false);
      approvalDecisionSubmit.disabled = true;
      approvalDecisionSubmit.textContent = 'Recording…';
      session.call('/api/ops/ciel/operations', {
        method: 'POST',
        body: buildApprovalDecision({
          approvalRequestId: approvalDecisionId.value.trim(),
          expectedRevision: Number(approvalExpectedRevision.value),
          decision: approvalDecision.value,
          reason: approvalReason.value.trim(),
          idempotencyKey: approvalDecisionKey.value.trim()
        }, global.crypto.randomUUID())
      }).then(function (response) {
        showApprovalResult(response);
        shell.announce('Approval decision recorded.');
      }).catch(function (caught) {
        approvalDecisionError.textContent = caught && caught.message
          ? maskContactDetails(caught.message)
          : 'The approval decision failed.';
      }).finally(function () {
        approvalDecisionSubmit.disabled = false;
        approvalDecisionSubmit.textContent = 'Record decision';
      });
    });

    var built = workingBand('Qualified approval handoff', 'Metadata only; the backend enforces qualification');
    var section = built.section;
    var bandBody = built.body;
    bandBody.appendChild(h('p', {
      className: 'field-hint',
      text: 'Bind exact quarantined bytes to an admission request. This workflow does not admit, reveal or export evidence.'
    }));
    var sections = [];
    if (!canMutateEvidence) {
      sections.push(
        approvalCard(
          'Get approval state',
          'Reads metadata for a request the current principal may inspect.',
          approvalGetForm
        ),
        approvalResult
      );
      bandBody.appendChild(h('div', { className: 'stack' }, sections));
      return section;
    }
    sections.push(
      approvalTrustNote,
      approvalCard(
        'Request approval',
        'Creates a pending digest-bound handoff.',
        approvalRequestForm
      ),
      h('div', { className: 'grid g2 approval-workflow-grid' }, [
        approvalCard(
          'Get approval state',
          'Reads metadata for a request the current principal may inspect.',
          approvalGetForm
        ),
        approvalCard(
          'Decide request',
          'Requires fresh authentication, independence and current verified qualification.',
          approvalDecisionForm
        )
      ]),
      approvalResult
    );
    bandBody.appendChild(h('div', { className: 'stack' }, sections));
    return section;
  }

  function admissionSection() {
    var built = workingBand('Admit synthetic evidence', 'Owner only; state change and receipt, not evidence access');
    var section = built.section;
    var bandBody = built.body;
    bandBody.appendChild(h('div', { className: 'callout' }, [
      icon('lock'),
      h('div', {}, [
        h('strong', { text: 'Admission is not access to evidence.' }),
        h('p', {
          text: 'The backend admits only exact synthetic bytes already approved for this artifact binding. Success records a receipt; it does not read, display, export, feed evaluators, train models or permit provider transfer.'
        })
      ])
    ]));

    if (!session.hasRole(['owner'])) {
      var denied = shell.card('admission-unavailable');
      denied.appendChild(shell.cardHead('Admission needs owner access', 'Owners only'));
      denied.appendChild(h('div', { className: 'card-body' }, [
        h('p', {
          className: 'field-hint',
          text: 'Operators can prepare quarantine and approval handoffs. Admitting evidence is an owner action, and the backend still checks approval, freshness and exact bytes.'
        })
      ]));
      bandBody.appendChild(denied);
      return section;
    }

    var artifactId = input('text');
    var expectedRevision = input('number', '1');
    var sourceDigest = input('text');
    var retainedDigest = input('text');
    var contentProfile = select([option('trace', 'Trace or transcript'), option('media', 'Media')]);
    var mediaType = select([
      option('application/json', 'JSON'),
      option('text/plain', 'Plain text'),
      option('image/jpeg', 'JPEG image'),
      option('image/png', 'PNG image'),
      option('audio/mpeg', 'MP3 audio'),
      option('audio/wav', 'WAV audio'),
      option('video/mp4', 'MP4 video'),
      option('video/quicktime', 'QuickTime video')
    ]);
    var purpose = select([
      option('regression_evaluation', 'Regression evaluation'),
      option('incident_reproduction', 'Incident reproduction'),
      option('quality_review', 'Quality review')
    ]);
    var retentionExpiry = input('datetime-local');
    var defaultExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    retentionExpiry.value = new Date(defaultExpiry.getTime() -
      defaultExpiry.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 16);
    var necessary = input('text', 'none');
    var removed = input('text', 'none');
    var policyRevision = input('text', 'ciel-evidence-admission.v1');
    var approvalRequestId = input('text');
    var idempotencyKey = input('text');
    var error = h('div', { className: 'field-error', role: 'alert' });
    var result = h('div', { className: 'admission-result', role: 'status' });
    result.setAttribute('id', 'admission-result');
    var submit = h('button', {
      className: 'btn btn-primary',
      type: 'submit',
      text: 'Admit evidence'
    });
    var availability = h('p', {
      className: 'field-hint',
      text: 'Synthetic evidence only. The backend recomputes the approved admission digest, verifies retained bytes and denies stale artifact, approval, policy or qualification bindings.'
    });
    availability.setAttribute('id', 'admission-availability-note');
    appendDescription(submit, 'admission-availability-note');

    contentProfile.addEventListener('change', function () {
      mediaType.value = contentProfile.value === 'trace' ? 'application/json' : 'image/jpeg';
    });

    var form = h('form', { className: 'card admission-form' }, [
      shell.cardHead('Admit an approved synthetic artifact', 'Exact-byte transition only'),
      h('div', { className: 'card-body' }, [
        h('div', { className: 'grid g2 evidence-form-grid' }, [
          field('admission-artifact-id', 'Artifact ID', artifactId),
          field('admission-expected-revision', 'Expected artifact revision', expectedRevision),
          field('admission-source-digest', 'Source SHA-256', sourceDigest),
          field('admission-retained-digest', 'Retained SHA-256', retainedDigest),
          field('admission-profile', 'Content profile', contentProfile),
          field('admission-type', 'Media type', mediaType),
          field('admission-purpose', 'Purpose', purpose),
          field('admission-expiry', 'Retention expires at', retentionExpiry,
            'Must match the quarantined artifact binding; sent as UTC.'),
          field('admission-policy-revision', 'Policy revision', policyRevision),
          field('admission-approval-id', 'Approval request ID', approvalRequestId),
          field('admission-key', 'Idempotency key', idempotencyKey,
            'Optional. Reuse only for the same artifact, approval and policy binding.')
        ]),
        h('div', { className: 'q-grid' }, [
          field('admission-necessary', 'Necessary privacy categories', necessary,
            'Comma-separated contract categories, or none.'),
          field('admission-removed', 'Categories removed before import', removed,
            'Comma-separated contract categories; leave blank when none were removed.')
        ]),
        availability,
        error
      ]),
      h('div', { className: 'card-foot evidence-actions' }, [submit])
    ]);
    form.setAttribute('id', 'admission-form');
    form.setAttribute('novalidate', '');

    function showAdmissionResult(response) {
      if (!response || response.status !== 'success' || !response.resource || !response.resource.value) {
        var operationError = response && response.error;
        throw new Error(operationError && operationError.message
          ? operationError.message
          : 'The admission operation did not return a completed receipt.');
      }
      var value = response.resource.value;
      result.textContent = '';
      result.appendChild(h('div', { className: 'card' }, [
        shell.cardHead('Admitted, no access granted', null, [
          stamp('u-tag works', 'lock', 'Receipt only')
        ]),
        h('dl', { className: 'card-body evidence-meta' }, [
          metadataRow('Receipt', String(value.admissionReceiptId || response.resource.id)),
          metadataRow('Artifact', String(value.artifactId || '')),
          metadataRow('State', String(value.state || 'admitted')),
          metadataRow('Revision', String(value.revision || response.resource.revision)),
          metadataRow('Approval', String(value.approvalRequestId || '')),
          metadataRow('Source SHA-256', String(value.sourceDigest || '')),
          metadataRow('Retained SHA-256', String(value.retainedDigest || '')),
          metadataRow('Purpose', String(value.purpose || '')),
          metadataRow('Policy', String(value.policyRevision || '')),
          metadataRow('Admission request SHA-256', String(value.targetRequestDigest || ''))
        ]),
        h('div', {
          className: 'card-foot',
          text: 'This receipt changes only the artifact state. Raw content, storage locations, evaluator access, training permission and export grants are intentionally not returned.'
        })
      ]));
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      error.textContent = '';
      result.textContent = '';
      submit.disabled = true;
      submit.textContent = 'Admitting…';
      var request;
      try {
        request = buildAdmissionRequest({
          artifactId: artifactId.value,
          expectedRevision: expectedRevision.value,
          sourceDigest: sourceDigest.value,
          retainedDigest: retainedDigest.value,
          contentProfile: contentProfile.value,
          mediaType: mediaType.value,
          purpose: purpose.value,
          expiresAt: retentionExpiry.value,
          necessaryCategories: necessary.value,
          removedCategories: removed.value,
          policyRevision: policyRevision.value,
          approvalRequestId: approvalRequestId.value,
          idempotencyKey: idempotencyKey.value.trim()
        }, global.crypto.randomUUID());
      } catch (caught) {
        error.textContent = caught && caught.message
          ? maskContactDetails(caught.message)
          : 'The admission request is invalid.';
        submit.disabled = false;
        submit.textContent = 'Admit evidence';
        return;
      }
      session.call('/api/ops/ciel/operations', {
        method: 'POST',
        body: request
      }).then(function (response) {
        showAdmissionResult(response);
        shell.announce('Evidence admitted. No access grant was created.');
      }).catch(function (caught) {
        error.textContent = admissionErrorText(caught);
        shell.announce('Evidence admission failed.');
      }).finally(function () {
        submit.disabled = false;
        submit.textContent = 'Admit evidence';
      });
    });

    bandBody.appendChild(form);
    bandBody.appendChild(result);
    return section;
  }

  /* ---------------------------------------------------- the deferred half */

  function soonBanner() {
    var card = shell.card('accent soon');
    card.appendChild(h('div', { className: 'card-body row' }, [
      h('div', { className: 'u-soon-icon' }, [icon('spark')]),
      h('div', { className: 'u-soon-body' }, [
        h('h2', { className: 'u-soon-title', text: 'The scoring harness is not built yet' }),
        h('p', {
          className: 'u-soon-line',
          text: 'Everything below this point is the agreed layout for it, filled with figures somebody made up. Nothing under it reads an API, and no figure in it is a measurement.'
        }),
        h('div', { className: 'row wrap' }, [
          stamp('u-tag', 'x', 'No harness'),
          stamp('u-tag', 'x', 'No stored scores'),
          stamp('u-tag', 'x', 'No alerting')
        ]),
        h('div', { className: 'row wrap' }, [
          shell.link(shell.paneHref('history') || 'run-history.html', 'Read real runs instead', 'btn btn-primary'),
          shell.link(shell.paneHref('alerts') || 'alerts.html', 'Problems', 'btn')
        ])
      ])
    ]));
    return card;
  }

  /* A bar whose value is printed beside it is decoration, so it is not
     announced a second time. Width goes through CSSOM rather than a style
     attribute: the page's Content-Security-Policy carries no 'unsafe-inline',
     and CSSOM is not what that gates. */
  function meter(pct, tone) {
    var bar = h('div', { className: 'meter' + (tone ? ' ' + tone : ''), 'aria-hidden': 'true' });
    var fill = h('i');
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    return bar;
  }

  /* The direction is a sign in the text as well as a glyph and a tint. The
     glyph is decoration inside an icon element nothing announces, and the tint
     is a colour, so without the sign "0.02 up" and "0.02 down" reach a screen
     reader as the same three characters. assets/pane-overview.js carries the
     same repair, made there after the same finding.

     `u-move` marks which pills are a change, because `.pill.down` is also the
     red tone and the release-held pill wears it without being a fall — without
     the hook the test below has no way to ask the question of the right set.
     It is also the one selector that can reach every figure in this column, so
     it is what sets them in tabular figures: see .u-move in
     assets/pane-evaluations-v2.css. It used to carry no style at all, which
     put it on Stadiora/Aria#10647's list of classes written into a DOM no
     sheet this page loads could see. */
  function movePill(entry) {
    if (!entry.down && !entry.up) return h('span', { className: 'pill u-move', text: entry.move });
    return h('span', { className: 'pill u-move ' + (entry.down ? 'down' : 'up') }, [
      icon(entry.down ? 'down' : 'up'),
      h('span', { text: (entry.down ? '-' : '+') + entry.move })
    ]);
  }

  function scoresBand() {
    var built = previewBand('How good are the answers', 'Scored after every release candidate');
    var section = built.section;
    var bandBody = built.body;

    var headline = shell.card('kpi');
    headline.appendChild(h('div', { className: 'card-body' }, [
      h('div', { className: 'kpi-label', text: 'Overall coaching quality, 1.2.0 candidate' }),
      h('div', { className: 'kpi-val', text: INVENTED.overall }),
      h('div', { className: 'kpi-meta' }, [
        movePill({ move: INVENTED.overallDrop, down: true }),
        h('span', { text: 'on 1.1.2' })
      ])
    ]));
    var history = h('div', { className: 'card-body u-list' }, [
      h('div', { className: 'u-list-head' }, [
        h('span', { text: 'Every version before it' }),
        h('span', { text: 'Change' })
      ])
    ]);
    INVENTED.previous.forEach(function (entry) {
      history.appendChild(h('div', { className: 'u-list-row' }, [
        h('span', {}, [
          h('span', { text: entry.version + ' ' }),
          h('span', { className: 'muted', text: entry.when })
        ]),
        h('span', { className: 'u-list-end' }, [
          h('b', { className: 'num dim', text: entry.score }),
          movePill(entry)
        ])
      ]));
    });
    headline.appendChild(history);
    headline.appendChild(h('div', { className: 'kpi-foot' }, [
      h('span', { text: INVENTED.caseCount })
    ]));

    var dimensions = shell.card();
    dimensions.appendChild(shell.cardHead('Scores by dimension', 'Against 1.1.2'));
    var body = h('div', { className: 'card-body' });
    INVENTED.dimensions.forEach(function (entry) {
      var name = h('div', {}, [h('div', { className: 'u-score-name', text: entry.name })]);
      if (entry.sub) name.appendChild(h('div', { className: 'u-score-sub', text: entry.sub }));
      body.appendChild(h('div', { className: 'u-score' }, [
        name,
        meter(entry.pct, entry.tone),
        h('div', { className: 'u-score-val num', text: entry.score }),
        h('div', { className: 'u-score-chg' }, [movePill(entry)])
      ]));
    });
    dimensions.appendChild(body);
    dimensions.appendChild(h('div', { className: 'card-foot' }, [
      icon('warn'),
      h('span', { text: INVENTED.safetyFloor })
    ]));

    bandBody.appendChild(h('div', { className: 'grid g-side' }, [headline, dimensions]));
    return section;
  }

  function regressionsBand() {
    var built = previewBand('What regressed',
      'Dropped more than ' + INVENTED.regressionThreshold + ' since 1.1.2');
    var section = built.section;
    var bandBody = built.body;
    var body = h('tbody');
    INVENTED.regressions.forEach(function (entry) {
      body.appendChild(h('tr', {}, [
        h('td', {}, [
          h('div', { className: 't-main', text: entry.title }),
          h('div', { className: 't-sub' }, [h('span', { className: 'code', text: entry.id })])
        ]),
        h('td', {}, [h('span', { className: 'pill' + (entry.tone ? ' ' + entry.tone : ''), text: entry.kind })]),
        h('td', { className: 'r num', text: entry.was }),
        h('td', { className: 'r num', text: entry.now }),
        h('td', { className: 'r' }, [movePill({ move: entry.move, down: true })])
      ]));
    });
    var card = shell.card();
    /* Focusable and named, because a region that scrolls sideways and cannot
       be reached from a keyboard fails WCAG 2.1.1. This is the one focusable
       thing in the preview and it is not a control: it changes nothing, it
       moves the view. */
    card.appendChild(h('div', {
      className: 'tbl-wrap', tabindex: '0', role: 'region',
      'aria-label': 'What regressed, invented figures'
    }, [
      h('table', { className: 'tbl' }, [
        h('thead', {}, [h('tr', {}, [
          h('th', { text: 'Test case' }),
          h('th', { text: 'Request type' }),
          h('th', { className: 'r', text: 'Was' }),
          h('th', { className: 'r', text: 'Now' }),
          h('th', { className: 'r', text: 'Change' })
        ])]),
        body
      ])
    ]));
    card.appendChild(h('div', { className: 'card-foot' }, [
      icon('info'),
      h('span', { text: INVENTED.regressionFoot })
    ]));
    bandBody.appendChild(card);
    return section;
  }

  function versionSide(spec, tone) {
    var side = h('div', { className: 'u-vs-side' }, [
      h('div', { className: 'u-vs-app' }, [
        h('span', { className: 'dot ' + tone }),
        h('span', { text: spec.version }),
        h('small', { text: spec.note })
      ]),
      h('div', { className: 'u-vs-big num' + (tone === 'bad' ? ' u-rose' : ''), text: spec.overall }),
      h('div', { className: 'u-vs-cap', text: 'Overall' })
    ]);
    spec.figures.forEach(function (figure) {
      side.appendChild(h('div', { className: 'u-fig' }, [
        h('span', { className: 'u-fig-k', text: figure[0] }),
        h('span', { className: 'u-fig-v num' + (figure[2] ? ' u-rose' : ''), text: figure[1] })
      ]));
    });
    return side;
  }

  function shipBand() {
    var built = previewBand('Can 1.2.0 ship');
    var section = built.section;
    var bandBody = built.body;

    var compare = shell.card();
    compare.appendChild(shell.cardHead('1.1.2 against 1.2.0', 'Same cases, same grader'));
    compare.appendChild(h('div', { className: 'card-body' }, [
      h('div', { className: 'u-vs' }, [
        versionSide(INVENTED.shipped, 'ok'),
        h('div', { className: 'u-vs-rule' }),
        versionSide(INVENTED.candidate, 'bad')
      ])
    ]));
    compare.appendChild(h('div', { className: 'card-foot u-held' }, [
      h('div', { className: 'row' }, [
        icon('x'),
        h('strong', { text: INVENTED.heldTitle })
      ]),
      h('p', { className: 'u-held-line', text: INVENTED.heldLine }),
      h('div', { className: 'row wrap' }, [
        h('span', { className: 'pill down' }, [icon('lock'), h('span', { text: 'Release held' })]),
        h('span', { className: 'pill ghost', text: INVENTED.heldSince })
      ])
    ]));

    var suite = shell.card();
    suite.appendChild(shell.cardHead('The test suite', INVENTED.suiteSize));
    var split = h('div', { className: 'card-body u-split' });
    INVENTED.suite.forEach(function (entry) {
      split.appendChild(h('div', {}, [
        h('div', { className: 'u-split-row' }, [
          h('span', { text: entry.name }),
          h('span', { className: 'num muted', text: entry.count })
        ]),
        meter(entry.pct)
      ]));
    });
    suite.appendChild(split);
    var meta = h('div', { className: 'card-body u-meta' });
    INVENTED.suiteMeta.forEach(function (row) {
      meta.appendChild(h('div', { className: 'u-meta-row' }, [
        h('span', { className: 'muted', text: row[0] }),
        h('span', { className: 'dim', text: row[1] })
      ]));
    });
    suite.appendChild(meta);
    suite.appendChild(h('div', { className: 'card-foot' }, [
      h('span', { className: 'dot vio' }),
      h('span', { text: INVENTED.suiteFoot })
    ]));

    bandBody.appendChild(h('div', { className: 'grid g-main' }, [compare, suite]));
    return section;
  }

  /* A keyboard runs past this in one stop, the scrolling table, rather than
     tabbing through a row of dead controls. */
  function scoringPreview() {
    return h('div', { className: 'preview' }, [scoresBand(), regressionsBand(), shipBand()]);
  }

  function render(root) {
    /* Drained before the sections are built, not after: a render that threw
       half way would otherwise leave the next one driving dead bands. */
    pending = [];
    var stack = h('div', { className: 'stack' }, [
      browseSection(),
      runControlSection(),
      datasetValidationSection(),
      evidenceQuarantineSection(),
      approvalSection(),
      admissionSection(),
      soonBanner(),
      scoringPreview()
    ]);
    installFolds();
    root.appendChild(stack);
  }

  shell.definePane('evals', render);
})(window);
