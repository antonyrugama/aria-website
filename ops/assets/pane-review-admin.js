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
      ['Redactions', (item.redactions || []).join(', ') || 'none']
    ]));
    var actions = h('div', { className: 'card-foot review-actions' });
    var button = h('button', { className: 'btn btn-sm', type: 'button', text: 'Review blinded output' });
    button.addEventListener('click', function () { onInspect(item.reviewItemId); });
    actions.appendChild(button);
    card.appendChild(actions);
    return card;
  }

  function labelForm(item, state, onSubmit) {
    var form = h('form', { className: 'card-body review-form' });
    var alert = h('p', { className: 'field-error', role: 'alert', text: '' });
    function field(label, child, wide) {
      return h('div', { className: 'review-field' + (wide ? ' review-field-wide' : '') }, [
        h('label', { text: label }), child
      ]);
    }
    var label = h('select', { className: 'review-input', name: 'label' }, [
      h('option', { value: 'pass', text: 'Pass' }), h('option', { value: 'fail', text: 'Fail' }), h('option', { value: 'unknown', text: 'Unknown' })
    ]);
    var uncertainty = h('select', { className: 'review-input', name: 'uncertainty' }, [
      h('option', { value: 'low', text: 'Low uncertainty' }), h('option', { value: 'medium', text: 'Medium uncertainty' }), h('option', { value: 'high', text: 'High uncertainty' })
    ]);
    var rationale = h('textarea', { className: 'review-input', name: 'rationale', required: 'required' });
    var comments = h('textarea', { className: 'review-input', name: 'comments', required: 'required' });
    var submit = h('button', { className: 'btn', type: 'submit', text: state && state.submittedOwnLabel ? 'Append correction' : 'Submit independent label' });
    form.appendChild(field('Label', label, false));
    form.appendChild(field('Uncertainty', uncertainty, false));
    form.appendChild(field('Rationale', rationale, true));
    form.appendChild(field('Comments', comments, true));
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
        authority: 'expert_reviewed',
        domain: item.rubric.authority.domain,
        rationale: rationale.value,
        comments: comments.value
      }).catch(function (error) {
        alert.textContent = shell.failureMessage ? shell.failureMessage(error) : String(error && error.message || error);
      }).finally(function () { submit.disabled = false; });
    });
    return form;
  }

  function adjudicationForm(item, labels, onAdjudicate) {
    var form = h('form', { className: 'card-body review-form review-adjudication' });
    var alert = h('p', { className: 'field-error', role: 'alert', text: '' });
    function field(label, child, wide) {
      return h('div', { className: 'review-field' + (wide ? ' review-field-wide' : '') }, [
        h('label', { text: label }), child
      ]);
    }
    var decision = h('select', { className: 'review-input', name: 'decision' }, [
      h('option', { value: 'pass', text: 'Pass' }), h('option', { value: 'fail', text: 'Fail' }), h('option', { value: 'unknown', text: 'Unknown' })
    ]);
    var rationale = h('textarea', { className: 'review-input', name: 'rationale', required: 'required' });
    var submit = h('button', { className: 'btn', type: 'submit', text: 'Record adjudication' });
    form.appendChild(shell.cardHead('Adjudicate disputed labels', [String(labels.length) + ' labels bound to this blinded output']));
    form.appendChild(meta(labels.map(function (label) {
      return [label.reviewId || 'review', (label.label || 'unknown') + ' / ' + (label.reviewerRef || 'human reviewer'), 'review-digest'];
    })));
    form.appendChild(field('Decision', decision, false));
    form.appendChild(field('Rationale', rationale, true));
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
    var labels = visible ? (detail.labels || []) : [];
    card.appendChild(shell.cardHead('Blinded output', [detail.reviewItemId, visible ? 'labels visible' : 'independent label required']));
    card.appendChild(meta([
      ['Output', detail.evidence ? detail.evidence.outcomePreview : 'No evidence available'],
      ['Criterion', detail.rubric ? detail.rubric.statement : 'No rubric'],
      ['Outcome digest', detail.outcomeDigest, 'review-digest'],
      ['Criterion digest', detail.criterionDigest, 'review-digest'],
      ['Other labels', visible ? String(labels.length) : 'Hidden until you submit your own label']
    ]));
    card.appendChild(labelForm(detail, detail.reviewerState, onSubmit));
    if (visible && labels.length >= 2) {
      card.appendChild(adjudicationForm(detail, labels, onAdjudicate));
    }
    return card;
  }

  function render(content) {
    content.appendChild(redactionBanner());
    var body = h('div', { className: 'review-layout' });
    content.appendChild(body);
    body.appendChild(shell.stateBlock('spark', 'Loading review queue', ['Only blinded evidence will be shown.']));
    session.call('/api/ops/ciel/admin/reviews/queue').then(function (payload) {
      var items = payload.data && payload.data.items || [];
      body.textContent = '';
      if (!items.length) {
        body.appendChild(shell.stateBlock('layers', 'No blinded review items', ['There is nothing ready for human review right now.']));
        return;
      }
      var list = h('div', { className: 'review-list' });
      var detail = h('div', { className: 'review-detail' });
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
      items.forEach(function (item) { list.appendChild(itemCard(item, inspect)); });
      body.appendChild(list);
      body.appendChild(detail);
    }, function (error) {
      body.textContent = '';
      body.appendChild(shell.stateBlock('alerts', 'Could not load review queue', [shell.failureMessage(error)]));
    });
  }

  shell.definePane('review', render);
})(window);
