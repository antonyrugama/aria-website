/* Aria quality: imported evidence quarantine.

   This pane deliberately implements one operation and no more:
   ciel.artifact.quarantine. It places imported bytes behind the server's
   private, immutable quarantine boundary. A successful response is not
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

  function categories(value, label) {
    var entries = String(value || '').split(',').map(function (entry) {
      return entry.trim();
    }).filter(Boolean);
    if (!entries.length) throw new Error(label + ' must name at least one category or "none".');
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
    categories(draft.removedCategories || 'none', 'Removed categories');
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
            removedCategories: categories(draft.removedCategories || 'none', 'Removed categories')
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

  function render(root) {
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
    expiry.value = defaultExpiry.toISOString().slice(0, 16);
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
            'This slice records expiry; automated expiry enforcement is delivered separately.'),
          field('evidence-key', 'Idempotency key', idempotency,
            'Optional. Blank generates a unique key; reuse a key only for an identical request.')
        ]),
        h('div', { className: 'grid g2 evidence-form-grid' }, [
          field('evidence-necessary', 'Necessary privacy categories', necessary,
            'Comma-separated contract categories, or none. Sensitive categories are not accepted as necessary.'),
          field('evidence-removed', 'Categories removed before import', removed,
            'Comma-separated contract categories, or none.')
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

    root.appendChild(h('div', { className: 'stack' }, [
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
      status
    ]));
  }

  shell.definePane('evals', render);
})(window);
