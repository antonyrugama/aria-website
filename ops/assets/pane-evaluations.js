/* Aria quality: dataset declarations and imported evidence quarantine.

   Dataset validation checks supplied declarations without reading referenced
   files or storing a dataset. Evidence import places bytes behind the server's
   private, immutable quarantine boundary. Neither successful operation is
   admission, evaluation consent, training consent, export permission,
   provider-transfer permission, or proof of de-identification.

   The selected file exists only in this page's memory until the operator
   submits it. The page displays file metadata before submission and the
   operation's metadata-only resource afterwards; it never renders the raw
   evidence or a storage URL. */
(function (global) {
  'use strict';

  var shell = global.OpsShell;
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

  function field(id, label, control, hint) {
    control.setAttribute('id', id);
    var children = [
      h('label', { className: 'field-label', for: id, text: label }),
      control
    ];
    if (hint) children.push(h('p', { className: 'field-hint', text: hint }));
    return h('div', { className: 'field' }, children);
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
      className: 'btn btn-primary btn-lg',
      type: 'submit',
      text: 'Validate declarations'
    });
    var generation = 0;
    var pending = false;
    var form = h('form', { className: 'card dataset-form' }, [
      h('div', { className: 'card-head' }, [
        h('div', {}, [
          h('h2', { className: 'card-title', text: 'Validate dataset declarations' }),
          h('p', {
            className: 'card-hint',
            text: 'Viewer, operator and owner access. No dataset is stored.'
          })
        ])
      ]),
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
          h('div', { className: 'card-head' }, [
            h('h3', { className: 'card-title', text: 'Dataset declarations valid' })
          ]),
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

    return h('div', { className: 'stack' }, [form, result]);
  }

  function render(root) {
    if (!session.hasRole(['owner', 'operator'])) {
      root.appendChild(h('div', { className: 'stack' }, [
        datasetValidationSection(),
        h('p', { className: 'field-hint', text: 'Evidence import requires operator or owner access.' })
      ]));
      return;
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
      className: 'btn btn-primary btn-lg',
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
      h('div', { className: 'card-head' }, [
        h('div', {}, [
          h('h2', { className: 'card-title', text: 'Import into private quarantine' }),
          h('p', {
            className: 'card-hint',
            text: 'Operator and owner only · 5 MiB maximum · 90 days maximum'
          })
        ])
      ]),
      h('div', { className: 'card-body' }, [
        field('evidence-file', 'Evidence file', fileInput,
          'Bytes are sent only when submitted. Text and JSON are inspected and redacted server-side; media requires manual review.'),
        selected,
        h('div', { className: 'grid g2 evidence-form-grid' }, [
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
        h('div', { className: 'grid g2 evidence-form-grid' }, [
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
          h('div', { className: 'card-head' }, [
            h('span', { className: 'badge badge-warn', text: 'Quarantined · review required' })
          ]),
          h('dl', { className: 'card-body evidence-meta' }, [
            metadataRow('Artifact', String(resource.artifactId || response.resource.id)),
            metadataRow('State', String(resource.state || 'quarantined')),
            metadataRow('Revision', String(resource.revision || response.resource.revision)),
            metadataRow('Access', 'No content read or export grant')
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
    approvalExpiry.value = expiry.value;
    var approvalRequestKey = input('text');
    var approvalRequestError = h('div', { className: 'field-error', role: 'alert' });
    var approvalRequestSubmit = h('button', {
      className: 'btn btn-primary',
      type: 'submit',
      text: 'Create pending request'
    });
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
      approvalRequestError,
      h('div', { className: 'row evidence-actions' }, [approvalRequestSubmit])
    ]);
    approvalRequestForm.setAttribute('id', 'approval-request-form');
    approvalRequestForm.setAttribute('novalidate', '');

    var approvalGetId = input('text');
    var approvalGetError = h('div', { className: 'field-error', role: 'alert' });
    var approvalGetSubmit = h('button', {
      className: 'btn btn-secondary',
      type: 'submit',
      text: 'Load request'
    });
    var approvalGetForm = h('form', { className: 'stack' }, [
      field('approval-get-id', 'Approval request ID', approvalGetId),
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
    approvalResult.hidden = true;
    var approvalTrustNote = h('div', {
      className: 'callout callout-warn'
    }, [
      icon('warn'),
      h('div', {}, [
        h('strong', { text: 'Qualification comes from an external trust record.' }),
        h('p', {
          text: 'This dashboard cannot provision qualification. Owner role and fresh authentication remain necessary but do not make a reviewer qualified.'
        })
      ])
    ]);
    approvalTrustNote.setAttribute('id', 'approval-trust-note');

    function approvalCard(title, hint, approvalForm) {
      return h('div', { className: 'card approval-card' }, [
        h('div', { className: 'card-head' }, [
          h('div', {}, [
            h('h3', { className: 'card-title', text: title }),
            h('p', { className: 'card-hint', text: hint })
          ])
        ]),
        h('div', { className: 'card-body' }, [approvalForm])
      ]);
    }

    function showApprovalResult(response) {
      var resource = response && response.resource;
      var value = resource && resource.value;
      if (!value) throw new Error('The approval operation did not return a resource.');
      approvalResult.hidden = false;
      approvalResult.textContent = 'Approval request ' +
        String(value.approvalRequestId || resource.id) + ' is ' +
        String(value.state) + ' at revision ' +
        String(value.revision || resource.revision) + '.';
      if (resource.id) {
        approvalGetId.value = resource.id;
        approvalDecisionId.value = resource.id;
      }
      if (resource.revision) approvalExpectedRevision.value = String(resource.revision);
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
          ? caught.message
          : 'The approval request is invalid.';
        approvalRequestSubmit.disabled = false;
        approvalRequestSubmit.textContent = 'Create pending request';
        return;
      }
      session.call('/api/ops/ciel/operations', {
        method: 'POST',
        body: request
      }).then(function (response) {
        showApprovalResult(response);
        shell.announce('Approval request created.');
      }).catch(function (caught) {
        approvalRequestError.textContent = caught && caught.message
          ? caught.message
          : 'The approval request failed.';
      }).finally(function () {
        approvalRequestSubmit.disabled = false;
        approvalRequestSubmit.textContent = 'Create pending request';
      });
    });

    approvalGetForm.addEventListener('submit', function (event) {
      event.preventDefault();
      approvalGetError.textContent = '';
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
          ? caught.message
          : 'The approval request could not be loaded.';
      }).finally(function () {
        approvalGetSubmit.disabled = false;
        approvalGetSubmit.textContent = 'Load request';
      });
    });

    approvalDecisionForm.addEventListener('submit', function (event) {
      event.preventDefault();
      approvalDecisionError.textContent = '';
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
          ? caught.message
          : 'The approval decision failed.';
      }).finally(function () {
        approvalDecisionSubmit.disabled = false;
        approvalDecisionSubmit.textContent = 'Record decision';
      });
    });

    root.appendChild(h('div', { className: 'stack' }, [
      datasetValidationSection(),
      h('div', { className: 'callout callout-warn' }, [
        icon('warn'),
        h('div', {}, [
          h('strong', { text: 'Quarantine is not permission to use evidence.' }),
          h('p', {
            text: 'Every import remains blocked pending qualified review. Export grants, dashboard roles, redaction, and storage do not create evaluation or training consent.'
          })
        ])
      ]),
      form,
      status,
      h('div', { className: 'section-head approval-section-head' }, [
        h('div', {}, [
          h('h2', { text: 'Qualified approval handoff' }),
          h('p', {
            className: 'muted small',
            text: 'Bind exact quarantined bytes to an admission request. This workflow does not admit, reveal or export evidence.'
          })
        ])
      ]),
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
    ]));
  }

  shell.definePane('evals', render);
})(window);
