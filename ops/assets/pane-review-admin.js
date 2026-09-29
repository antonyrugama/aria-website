(function (global) {
  'use strict';

  var shell = global.OpsPaneShell;
  var session = global.OpsSession;
  var h = shell.h;

  function text(value) { return value == null || value === '' ? 'n/a' : String(value); }
  function shortDigest(value) { return text(value).slice(0, 12); }

  function meta(rows) {
    return h('dl', { className: 'card-body review-meta' }, rows.map(function (row) {
      return h('div', { className: 'evidence-meta-row' }, [
        h('dt', { text: row[0] }),
        h('dd', { className: row[2] || '', text: row[1] })
      ]);
    }));
  }

  function retryButton(label, onRetry) {
    var button = h('button', { className: 'btn btn-sm', type: 'button', text: label || 'Retry' });
    button.addEventListener('click', onRetry);
    return h('div', { className: 'review-actions' }, [button]);
  }

  function redactionBanner() {
    return shell.band('Blinded review queue', 'Candidate, baseline and model-family identity are omitted until a reviewer records their own label.');
  }

  function itemCard(item, onInspect) {
    var card = shell.card('review-card');
    card.appendChild(shell.cardHead(item.reviewItemId || 'Review item', [
      item.rubric && item.rubric.authority ? item.rubric.authority.domain : 'unknown domain',
      item.status || 'open'
    ], [h('span', { className: 'pill', text: (item.labelCounts && item.labelCounts.submitted || 0) + ' labels' })]));
    card.appendChild(meta([
      ['Outcome digest', shortDigest(item.outcomeDigest), 'review-digest'],
      ['Criterion digest', shortDigest(item.criterionDigest), 'review-digest'],
      ['Rubric', item.rubric ? item.rubric.statement : 'No rubric'],
      ['Evidence refs', item.evidence && item.evidence.evidenceRefs ? item.evidence.evidenceRefs.join(', ') : 'none'],
      ['Redactions', (item.redactions || []).join(', ') || 'none']
    ]));
    var actions = h('div', { className: 'card-foot review-actions' });
    var button = h('button', { className: 'btn btn-sm', type: 'button', text: 'Review blinded output' });
    button.addEventListener('click', function () { onInspect(item.reviewItemId); });
    actions.appendChild(button);
    card.appendChild(actions);
    return card;
  }

  function field(label, child, wide, id) {
    child.setAttribute('id', id);
    return h('div', { className: 'review-field' + (wide ? ' review-field-wide' : '') }, [
      h('label', { for: id, text: label }), child
    ]);
  }

  function labelForm(item, state, correction, onSubmit) {
    var form = h('form', { className: 'card-body review-form' });
    var alert = h('p', { className: 'field-error', id: 'review-label-error', role: 'alert', text: '' });
    var label = h('select', { className: 'review-input', name: 'label' }, [
      h('option', { value: 'pass', text: 'Pass' }), h('option', { value: 'fail', text: 'Fail' }), h('option', { value: 'unknown', text: 'Unknown' })
    ]);
    var uncertainty = h('select', { className: 'review-input', name: 'uncertainty' }, [
      h('option', { value: 'low', text: 'Low uncertainty' }), h('option', { value: 'medium', text: 'Medium uncertainty' }), h('option', { value: 'high', text: 'High uncertainty' })
    ]);
    var rationale = h('textarea', { className: 'review-input', name: 'rationale', required: 'required' });
    var comments = h('textarea', { className: 'review-input', name: 'comments', required: 'required' });
    [label, uncertainty, rationale, comments].forEach(function (control) { control.setAttribute('aria-describedby', 'review-label-error'); });
    var submit = h('button', { className: 'btn', type: 'submit', text: state && state.submittedOwnLabel ? 'Append correction' : 'Submit independent label' });
    form.appendChild(field('Label', label, false, 'review-label-value'));
    form.appendChild(field('Uncertainty', uncertainty, false, 'review-label-uncertainty'));
    form.appendChild(field('Rationale', rationale, true, 'review-label-rationale'));
    form.appendChild(field('Comments', comments, true, 'review-label-comments'));
    form.appendChild(alert);
    form.appendChild(h('div', { className: 'review-actions review-field-wide' }, [submit]));
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      alert.textContent = '';
      submit.disabled = true;
      onSubmit({
        reviewItemId: item.reviewItemId,
        outcomeDigest: item.outcomeDigest,
        criterionDigest: item.criterionDigest,
        label: label.value || 'pass',
        uncertainty: uncertainty.value || 'low',
        domain: item.rubric.authority.domain,
        rationale: rationale.value,
        comments: comments.value,
        supersedesReviewId: state && state.submittedOwnLabel && correction ? correction.activeReviewId : null
      }).catch(function (error) {
        alert.textContent = shell.failureMessage ? shell.failureMessage(error) : String(error && error.message || error);
      }).finally(function () { submit.disabled = false; });
    });
    return form;
  }

  function adjudicationForm(item, labels, onAdjudicate) {
    var form = h('form', { className: 'card-body review-form review-adjudication' });
    var alert = h('p', { className: 'field-error', id: 'review-adjudication-error', role: 'alert', text: '' });
    var decision = h('select', { className: 'review-input', name: 'decision' }, [
      h('option', { value: 'pass', text: 'Pass' }), h('option', { value: 'fail', text: 'Fail' }), h('option', { value: 'unknown', text: 'Unknown' })
    ]);
    var rationale = h('textarea', { className: 'review-input', name: 'rationale', required: 'required' });
    [decision, rationale].forEach(function (control) { control.setAttribute('aria-describedby', 'review-adjudication-error'); });
    var submit = h('button', { className: 'btn', type: 'submit', text: 'Record adjudication' });
    form.appendChild(shell.cardHead('Adjudicate disputed labels', [String(labels.length) + ' labels bound to this blinded output']));
    labels.forEach(function (label) {
      form.appendChild(meta([
        [label.reviewId || 'review', (label.label || 'unknown') + ' / ' + (label.reviewerRef || 'human reviewer'), 'review-digest'],
        ['Uncertainty', label.uncertainty || 'n/a'],
        ['Rationale', label.rationale || 'No rationale supplied'],
        ['Comments', label.comments || 'No comments supplied']
      ]));
    });
    form.appendChild(field('Decision', decision, false, 'review-adjudication-decision'));
    form.appendChild(field('Rationale', rationale, true, 'review-adjudication-rationale'));
    form.appendChild(alert);
    form.appendChild(h('div', { className: 'review-actions review-field-wide' }, [submit]));
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      alert.textContent = '';
      submit.disabled = true;
      onAdjudicate({
        reviewItemId: item.reviewItemId,
        outcomeDigest: item.outcomeDigest,
        criterionDigest: item.criterionDigest,
        reviewIds: labels.map(function (label) { return label.reviewId; }),
        decision: decision.value || 'unknown',
        domain: item.rubric.authority.domain,
        rationale: rationale.value
      }).catch(function (error) {
        alert.textContent = shell.failureMessage ? shell.failureMessage(error) : String(error && error.message || error);
      }).finally(function () { submit.disabled = false; });
    });
    return form;
  }

  function detailCard(detail, onSubmit, onAdjudicate) {
    var card = shell.card('review-card');
    var visible = detail.reviewerState && detail.reviewerState.otherLabelsVisible;
    var submittedOwnLabel = detail.reviewerState && detail.reviewerState.submittedOwnLabel;
    var adjudicationMode = detail.adjudication && detail.adjudication.visible && visible && !submittedOwnLabel;
    var labels = visible ? (detail.labels || []) : [];
    card.appendChild(shell.cardHead('Blinded output', [detail.reviewItemId, visible ? 'labels visible' : 'independent label required']));
    card.appendChild(meta([
      ['Output', detail.evidence ? detail.evidence.outcomePreview : 'No evidence available'],
      ['Evidence refs', detail.evidence && detail.evidence.evidenceRefs ? detail.evidence.evidenceRefs.join(', ') : 'No evidence references'],
      ['Evidence comments', detail.evidence && detail.evidence.comments ? detail.evidence.comments.join(' ') : 'No evidence comments'],
      ['Criterion', detail.rubric ? detail.rubric.statement : 'No rubric'],
      ['Grading', detail.rubric && detail.rubric.grading ? JSON.stringify(detail.rubric.grading) : 'No grading metadata'],
      ['Outcome digest', detail.outcomeDigest, 'review-digest'],
      ['Criterion digest', detail.criterionDigest, 'review-digest'],
      ['Other labels', visible ? String(labels.length) : 'Hidden until you submit your own label']
    ]));
    if (adjudicationMode) {
      card.appendChild(shell.stateBlock('scale', 'Adjudication mode', ['Other reviewers\' labels are visible, so independent labelling is closed for this item.']));
    } else {
      card.appendChild(labelForm(detail, detail.reviewerState, detail.correction, onSubmit));
    }
    if (detail.adjudication && detail.adjudication.visible && labels.length >= 2) {
      card.appendChild(adjudicationForm(detail, labels, onAdjudicate));
    }
    return card;
  }

  function render(content) {
    content.appendChild(redactionBanner());
    var body = h('div', { className: 'review-layout' });
    content.appendChild(body);
    function loadQueue() {
      body.textContent = '';
      body.appendChild(shell.stateBlock('spark', 'Loading review queue', ['Only blinded evidence will be shown.']));
      session.call('/api/ops/ciel/admin/reviews/queue').then(function (payload) {
      var data = payload.data || {};
      var items = data.items || [];
      body.textContent = '';
      var partialBand = null;
      function syncPartialBand(nextData) {
        var omissions = nextData.omissions || [];
        if (nextData.partial || omissions.length) {
          if (!partialBand) {
            partialBand = shell.band('Review queue partially unavailable', omissions.length ? omissions.join(' ') : 'Some review sources could not be read.');
            body.appendChild(partialBand);
          } else {
            partialBand.textContent = 'Review queue partially unavailable ' + (omissions.length ? omissions.join(' ') : 'Some review sources could not be read.');
          }
        } else if (partialBand) {
          partialBand.textContent = '';
        }
      }
      if (data.partial || (data.omissions && data.omissions.length)) {
        syncPartialBand(data);
      }
      if (!items.length) {
        body.appendChild(shell.stateBlock('layers', data.partial ? 'Review queue incomplete' : 'No blinded review items', [
          data.partial ? 'Some review sources could not be read. Try again before concluding the queue is empty.' : 'There is nothing ready for human review right now.'
        ]));
        body.appendChild(retryButton('Reload review queue', loadQueue));
        return;
      }
      var list = h('div', { className: 'review-list' });
      var detail = h('div', { className: 'review-detail' });
      function populateList(nextItems) {
        list.textContent = '';
        nextItems.forEach(function (item) { list.appendChild(itemCard(item, inspect)); });
      }
      function retryPartialQueue() {
        return session.call('/api/ops/ciel/admin/reviews/queue').then(function (retryPayload) {
          var retryData = retryPayload.data || {};
          syncPartialBand(retryData);
          populateList(retryData.items || []);
        }, function (error) {
          shell.toast('alerts', shell.failureMessage(error));
        });
      }
      function inspect(reviewItemId) {
        detail.textContent = '';
        detail.appendChild(shell.stateBlock('spark', 'Loading blinded output', ['Labels from other reviewers stay hidden until your own label is recorded.']));
        return session.call('/api/ops/ciel/admin/reviews/items/' + encodeURIComponent(reviewItemId)).then(function (itemPayload) {
          detail.textContent = '';
          detail.appendChild(detailCard(itemPayload.data, function (request) {
            return session.call('/api/ops/ciel/admin/reviews/labels', { method: 'POST', body: request }).then(function () {
              shell.toast('spark', 'Review label recorded');
              return inspect(reviewItemId);
            });
          }, function (request) {
            return session.call('/api/ops/ciel/admin/reviews/adjudications', { method: 'POST', body: request }).then(function () {
              shell.toast('spark', 'Adjudication recorded');
              return inspect(reviewItemId);
            });
          }));
        }, function (error) {
          detail.textContent = '';
          detail.appendChild(shell.stateBlock('alerts', 'Could not load review item', [shell.failureMessage(error)]));
        });
      }
      populateList(items);
      if (data.partial || (data.omissions && data.omissions.length)) {
        body.appendChild(retryButton('Reload review queue', retryPartialQueue));
      }
      body.appendChild(list);
      body.appendChild(detail);
    }, function (error) {
      body.textContent = '';
      body.appendChild(shell.stateBlock('alerts', 'Could not load review queue', [shell.failureMessage(error)]));
      body.appendChild(retryButton('Retry review queue', loadQueue));
    });
    }
    loadQueue();
  }

  shell.definePane('review', render);
})(window);
