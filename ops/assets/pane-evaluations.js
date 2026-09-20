/* Aria quality: two working tools, and a drawing of the pane this one is named for.

   Dataset validation checks supplied declarations without reading referenced
   files or storing a dataset. Evidence import places bytes behind the server's
   private, immutable quarantine boundary. Neither successful operation is
   admission, evaluation consent, training consent, export permission,
   provider-transfer permission, or proof of de-identification.

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
       screen reader substitutes for the element's text). No stamp chip in
       those two states carries a digit.

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

  /* The only way a band is built outside the preview. */
  function workingBand(title, note) {
    return shell.band(title, note, [stamp('u-tag works', 'check', 'Works now')]);
  }

  /* The only way a band gets into the preview, so every band in it is stamped
     by construction rather than by remembering to. Stamped per band rather
     than once at the top, because a screenshot is usually of one card. */
  function previewBand(title, note) {
    return shell.band(title, note, [stamp('u-tag', 'warn', 'Invented figures')]);
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
          ? caught.message
          : 'Dataset declarations could not be validated.';
        if (caught && Array.isArray(caught.details) && caught.details.length) {
          error.appendChild(h('ul', { className: 'dataset-issues' }, caught.details.map(function (entry) {
            return h('li', { text: entry.path + ': ' + entry.reason });
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

    var section = workingBand('Check a dataset declaration', 'Any signed-in role, and no dataset is stored');
    section.appendChild(form);
    section.appendChild(result);
    return section;
  }

  function evidenceQuarantineSection() {
    var section = workingBand('Put evidence into quarantine', 'Operator and owner, 5 MiB and 90 days at most');

    section.appendChild(h('div', { className: 'callout' }, [
      icon('warn'),
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
      section.appendChild(denied);
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
          ? caught.message
          : 'Evidence could not be quarantined. Check the documented fields and try again.';
        shell.announce('Evidence quarantine failed.');
      }).finally(function () {
        submit.disabled = false;
        submit.textContent = 'Quarantine evidence';
      });
    });

    section.appendChild(form);
    section.appendChild(status);
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

     `u-move` carries no style. It marks which pills are a change, because
     `.pill.down` is also the red tone and the release-held pill wears it
     without being a fall — without the hook the test below has no way to ask
     the question of the right set. */
  function movePill(entry) {
    if (!entry.down && !entry.up) return h('span', { className: 'pill u-move', text: entry.move });
    return h('span', { className: 'pill u-move ' + (entry.down ? 'down' : 'up') }, [
      icon(entry.down ? 'down' : 'up'),
      h('span', { text: (entry.down ? '-' : '+') + entry.move })
    ]);
  }

  function scoresBand() {
    var section = previewBand('How good are the answers', 'Scored after every release candidate');

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

    section.appendChild(h('div', { className: 'grid g-side' }, [headline, dimensions]));
    return section;
  }

  function regressionsBand() {
    var section = previewBand('What regressed',
      'Dropped more than ' + INVENTED.regressionThreshold + ' since 1.1.2');
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
    section.appendChild(card);
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
    var section = previewBand('Can 1.2.0 ship');

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

    section.appendChild(h('div', { className: 'grid g-main' }, [compare, suite]));
    return section;
  }

  /* A keyboard runs past this in one stop, the scrolling table, rather than
     tabbing through a row of dead controls. */
  function scoringPreview() {
    return h('div', { className: 'preview' }, [scoresBand(), regressionsBand(), shipBand()]);
  }

  function render(root) {
    root.appendChild(h('div', { className: 'stack' }, [
      datasetValidationSection(),
      evidenceQuarantineSection(),
      soonBanner(),
      scoringPreview()
    ]));
  }

  shell.definePane('evals', render);
})(window);
