(function (global) {
  'use strict';

  var shell = global.OpsPaneShell;
  var session = global.OpsSession;
  var h = shell.h;

  function meta(rows) {
    return h('dl', { className: 'card-body review-meta' }, rows.map(function (row) {
      return h('div', { className: 'evidence-meta-row' }, [
        h('dt', { text: row[0] }),
        h('dd', { className: row[2] || '', text: row[1] })
      ]);
    }));
  }

  function retryButton(label, onRetry) {
    var button = h('button', { className: 'btn btn-sm', type: 'button', text: label || 'Try again' });
    button.addEventListener('click', onRetry);
    return h('div', { className: 'review-actions' }, [button]);
  }

  function cap(word) { return word ? word.charAt(0).toUpperCase() + word.slice(1) : ''; }

  /* One flat row per answer: what to judge it on, who it is for, how many
     people have rated it. The digests and evidence references the card used to
     print are in the detail, and in the request that binds a rating to them. */
  function itemRow(item, onInspect) {
    var statement = item.rubric && item.rubric.statement ? item.rubric.statement : 'Answer to review';
    var domain = item.rubric && item.rubric.authority ? item.rubric.authority.domain : '';
    var count = item.labelCounts && item.labelCounts.submitted || 0;
    var notes = [
      cap(domain),
      item.status === 'disputed' ? 'Reviewers disagree' : 'Open',
      count === 1 ? '1 rating' : count + ' ratings'
    ].filter(Boolean);
    var button = h('button', { className: 'btn btn-sm', type: 'button', text: 'Review' });
    button.setAttribute('aria-label', 'Review: ' + statement);
    button.addEventListener('click', function () { onInspect(item.reviewItemId); });
    return h('div', { className: 'review-row' }, [
      h('div', { className: 'review-row-words' }, [
        h('span', { className: 'review-row-name', text: statement }),
        h('span', { className: 'review-row-meta', text: notes.join(' \u00b7 ') })
      ]),
      button
    ]);
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
    var submit = h('button', { className: 'btn', type: 'submit', text: state && state.submittedOwnLabel ? 'Append correction' : 'Submit rating' });
    form.appendChild(field('Rating', label, false, 'review-label-value'));
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
    var submit = h('button', { className: 'btn', type: 'submit', text: 'Record decision' });
    form.appendChild(shell.cardHead('Settle the disagreement', [String(labels.length) + ' ratings on this answer']));
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
    card.appendChild(shell.cardHead('Answer to rate', visible ? 'Other ratings visible' : 'Other ratings hidden until you submit yours'));
    card.appendChild(meta([
      ['Answer', detail.evidence ? detail.evidence.outcomePreview : 'No answer available'],
      ['Sources', detail.evidence && detail.evidence.evidenceRefs ? detail.evidence.evidenceRefs.join(', ') : 'No sources'],
      ['Notes', detail.evidence && detail.evidence.comments ? detail.evidence.comments.join(' ') : 'No notes'],
      ['Judge it on', detail.rubric ? detail.rubric.statement : 'No rule'],
      ['Grading', detail.rubric && detail.rubric.grading ? JSON.stringify(detail.rubric.grading) : 'No grading metadata'],
      /* The exact versions being rated, in full. The rows above the detail do not carry them. */
      ['Outcome digest', detail.outcomeDigest || 'Not reported', 'review-digest'],
      ['Criterion digest', detail.criterionDigest || 'Not reported', 'review-digest'],
      ['Other ratings', visible ? String(labels.length) : 'Hidden until you submit yours']
    ]));
    if (adjudicationMode) {
      card.appendChild(shell.stateBlock('scale', 'Settling a disagreement', ['You have seen the other ratings, so you cannot add your own.']));
    } else {
      card.appendChild(labelForm(detail, detail.reviewerState, detail.correction, onSubmit));
    }
    if (detail.adjudication && detail.adjudication.visible && labels.length >= 2) {
      card.appendChild(adjudicationForm(detail, labels, onAdjudicate));
    }
    return card;
  }

  function render(content) {
    var body = h('div', { className: 'review-layout' });
    content.appendChild(body);
    function loadQueue() {
      body.textContent = '';
      body.appendChild(shell.stateBlock('spark', 'Loading reviews', []));
      session.call('/api/ops/seval/admin/reviews/queue').then(function (payload) {
      var data = payload.data || {};
      var items = data.items || [];
      body.textContent = '';
      var partialBand = null;
      function syncPartialBand(nextData) {
        var omissions = nextData.omissions || [];
        if (nextData.partial || omissions.length) {
          if (!partialBand) {
            partialBand = shell.band('Some reviews could not be read', omissions.length ? omissions.join(' ') : '');
            body.appendChild(partialBand);
          } else {
            partialBand.textContent = 'Some reviews could not be read ' + omissions.join(' ');
          }
        } else if (partialBand) {
          partialBand.textContent = '';
        }
      }
      if (data.partial || (data.omissions && data.omissions.length)) {
        syncPartialBand(data);
      }
      if (!items.length) {
        body.appendChild(shell.stateBlock('layers', data.partial ? 'Review list not fully read' : 'Nothing to review', data.partial ? ['Try again before assuming it is empty.'] : []));
        body.appendChild(retryButton('Reload', loadQueue));
        return;
      }
      var list = shell.card('review-list');
      var detail = h('div', { className: 'review-detail' });
      function populateList(nextItems) {
        list.textContent = '';
        nextItems.forEach(function (item) { list.appendChild(itemRow(item, inspect)); });
      }
      function retryPartialQueue() {
        return session.call('/api/ops/seval/admin/reviews/queue').then(function (retryPayload) {
          var retryData = retryPayload.data || {};
          syncPartialBand(retryData);
          populateList(retryData.items || []);
        }, function (error) {
          shell.toast('alerts', shell.failureMessage(error));
        });
      }
      function inspect(reviewItemId) {
        detail.textContent = '';
        detail.appendChild(shell.stateBlock('spark', 'Loading', []));
        return session.call('/api/ops/seval/admin/reviews/items/' + encodeURIComponent(reviewItemId)).then(function (itemPayload) {
          detail.textContent = '';
          detail.appendChild(detailCard(itemPayload.data, function (request) {
            return session.call('/api/ops/seval/admin/reviews/labels', { method: 'POST', body: request }).then(function () {
              shell.toast('spark', 'Rating recorded');
              return inspect(reviewItemId);
            });
          }, function (request) {
            return session.call('/api/ops/seval/admin/reviews/adjudications', { method: 'POST', body: request }).then(function () {
              shell.toast('spark', 'Decision recorded');
              return inspect(reviewItemId);
            });
          }));
        }, function (error) {
          detail.textContent = '';
          detail.appendChild(shell.stateBlock('alerts', 'This answer could not be read', [shell.failureMessage(error)]));
        });
      }
      populateList(items);
      if (data.partial || (data.omissions && data.omissions.length)) {
        body.appendChild(retryButton('Reload', retryPartialQueue));
      }
      body.appendChild(list);
      body.appendChild(detail);
    }, function (error) {
      body.textContent = '';
      body.appendChild(shell.stateBlock('alerts', 'Reviews could not be read', [shell.failureMessage(error)]));
      body.appendChild(retryButton('Try again', loadQueue));
    });
    }
    loadQueue();
  }

  shell.definePane('review', render);
})(window);
