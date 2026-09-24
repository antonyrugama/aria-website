/* Shared job action controls for v2 operations panes.

   Happening now and What happened both read action capabilities from the API,
   and both commit writes through /api/ops/jobs. Keeping the confirmation,
   fixed error copy and focus trap here prevents two panes from drifting on the
   only controls that can change job state. */
(function (global) {
  'use strict';

  var S = global.OpsPaneShell;
  var session = global.OpsSession;
  if (!S || !session) throw new Error('job-actions-v2.js needs OpsPaneShell and OpsSession');

  var h = S.h;
  var icon = S.icon;
  var stack = [];

  function actionPath(row, action) {
    return '/api/ops/jobs/' + encodeURIComponent(String(row.id || row.jobId || '')) + '/' + action;
  }

  function referenceFromId(id) {
    if (typeof id !== 'string') return null;
    var compact = id.toLowerCase().replace(/-/g, '');
    return /^[0-9a-f]{6}/.test(compact) ? 'job_' + compact.slice(0, 6) : null;
  }

  function actionRef(row) {
    return typeof row.reference === 'string' && row.reference ? row.reference : null;
  }

  function actionCaps(row) {
    return row && row.actions && typeof row.actions === 'object' ? row.actions : {};
  }

  function actionSummary(action, row) {
    if (action === 'retry') {
      return 'Retry: creates a new job linked to this one; the failed run stays in history.';
    }
    return row && row.state === 'running'
      ? 'Stop this running job; the worker stops at its next checkpoint.'
      : 'Cancel this queued job.';
  }

  function successMessage(action, row, data) {
    if (action === 'retry') {
      var ref = referenceFromId(data && data.jobId);
      return ref ? 'Retry created: ' + ref + '.' : 'Retry created.';
    }
    if (data && data.status === 'canceling') return 'Stopping ' + (actionRef(row) || 'that job') + '.';
    return 'Cancelled ' + (actionRef(row) || 'that job') + '.';
  }

  function fixedError(err, action) {
    var code = err && err.code;
    if (code === 'ops_jobs_confirmation_mismatch' || code === 'ops_jobs_reference_invalid') {
      return 'Type the job reference exactly as shown. Nothing changed.';
    }
    if (code === 'ops_jobs_cancel_stale' || code === 'ops_jobs_retry_stale') {
      return 'That job changed state elsewhere. The list was refreshed; nothing was claimed.';
    }
    if (code === 'ops_jobs_cancel_unavailable' || code === 'ops_jobs_retry_unavailable' ||
        code === 'ops_jobs_retry_job_mismatch' || code === 'ops_jobs_retry_job_not_retryable') {
      return action === 'retry'
        ? 'Retry is no longer available for that job. The list was refreshed; nothing was claimed.'
        : 'Cancellation is no longer available for that job. The list was refreshed; nothing was claimed.';
    }
    if (code === 'ops_jobs_retry_enqueue_failed') {
      return 'Retry did not happen because the new job could not be queued. Nothing changed.';
    }
    if (code === 'ops_jobs_job_not_found') {
      return 'That job is no longer in the operations record. The list was refreshed; nothing was claimed.';
    }
    if (err && err.status === 403) return 'Your role can view jobs but cannot change them. Nothing changed.';
    if (err && err.status === 503) return action === 'retry'
      ? 'Retry did not happen because the operations API could not commit it. Try again shortly.'
      : 'Cancellation did not happen because the operations API could not commit it. Try again shortly.';
    if (code === 'ops_unreachable' || (err && err.status === 0)) {
      return 'The operations API could not be reached. Nothing changed.';
    }
    return 'That did not go through. Nothing changed.';
  }

  function isRefreshError(err) {
    var code = err && err.code;
    return err && (err.status === 409 || code === 'ops_jobs_job_not_found');
  }

  function focusable(root) {
    return Array.prototype.slice.call(root.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]'
    )).filter(function (el) {
      return !el.disabled && el.getAttribute('tabindex') !== '-1';
    });
  }

  function isLiveRegion(el) {
    return el.hasAttribute('aria-live') || el.classList.contains('toast-host');
  }

  function isTop(api) { return stack[stack.length - 1] === api; }

  function openModal(node, initialFocus, canDismiss) {
    var opener = document.activeElement;
    var inerted = [];
    var closed = false;
    var api = { close: close, wantsClose: false };
    var scrim = h('div', { className: 'scrim' });

    document.body.appendChild(scrim);
    document.body.appendChild(node);

    Array.prototype.forEach.call(document.body.children, function (el) {
      if (el === node || el === scrim || isLiveRegion(el)) return;
      inerted.push({ el: el, inert: 'inert' in el ? el.inert : false, hidden: el.getAttribute('aria-hidden') });
      if ('inert' in el) el.inert = true;
      el.setAttribute('aria-hidden', 'true');
    });

    function close() {
      if (closed) return;
      var at = stack.indexOf(api);
      if (at !== -1 && at !== stack.length - 1) { api.wantsClose = true; return; }
      closed = true;
      if (at !== -1) stack.splice(at, 1);
      document.removeEventListener('keydown', onKey, true);
      inerted.forEach(function (was) {
        if ('inert' in was.el) was.el.inert = was.inert;
        if (was.hidden === null) was.el.removeAttribute('aria-hidden');
        else was.el.setAttribute('aria-hidden', was.hidden);
      });
      node.remove();
      scrim.remove();
      if (opener && opener.parentNode && opener.focus) opener.focus();
      drain();
    }

    function drain() {
      var top = stack[stack.length - 1];
      if (top && top.wantsClose) top.close();
    }

    function dismiss() {
      if (canDismiss && !canDismiss()) return;
      close();
    }

    function onKey(e) {
      if (!isTop(api)) return;
      if (e.key === 'Escape') { e.preventDefault(); dismiss(); return; }
      if (e.key !== 'Tab') return;
      var items = focusable(node);
      if (!items.length) { e.preventDefault(); return; }
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    scrim.addEventListener('click', function () { if (isTop(api)) dismiss(); });
    document.addEventListener('keydown', onKey, true);
    stack.push(api);
    (initialFocus() || focusable(node)[0] || node).focus();
    return api;
  }

  function confirm(action, row, opts) {
    opts = opts || {};
    var ref = actionRef(row);
    if (!ref) return;

    var settling = false;
    var titleId = 'jobActionTitle' + Math.random().toString(36).slice(2, 8);
    var inputId = titleId + 'Ref';
    var card = h('div', { className: 'modal-card job-confirm-card' });
    card.appendChild(h('div', { className: 'card-head' }, [
      h('h2', { className: 'card-title', id: titleId, text: action === 'retry' ? 'Retry this job?' : 'Cancel this job?' })
    ]));
    var body = h('div', { className: 'card-body col' });
    body.appendChild(h('p', { className: 'small muted', text: actionSummary(action, row) }));
    body.appendChild(h('p', { className: 'small muted', text: 'An audit entry will be written if the action commits.' }));
    body.appendChild(h('p', { className: 'job-action-ref', text: 'Reference: ' + ref }));
    body.appendChild(h('label', { className: 'field-label', for: inputId, text: 'Type the reference exactly' }));
    var typed = h('input', {
      className: 'field-input', id: inputId, type: 'text', autocomplete: 'off', spellcheck: 'false'
    });
    body.appendChild(typed);
    var error = h('p', { className: 'form-alert', role: 'alert' });
    body.appendChild(error);
    card.appendChild(body);

    var cancel = h('button', { className: 'btn', type: 'button', text: action === 'retry' ? 'Do not retry' : 'Keep it running' });
    var go = h('button', {
      className: 'btn ' + (action === 'cancel' ? 'btn-danger' : 'btn-primary'),
      type: 'button', text: action === 'retry' ? 'Retry job' : 'Cancel job'
    });
    go.disabled = true;
    card.appendChild(h('div', { className: 'row mt' }, [cancel, h('div', { className: 'spacer' }), go]));

    var node = h('div', {
      className: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1'
    }, [card]);

    function sync() { go.disabled = settling || typed.value !== ref; }
    function fail(message) {
      error.textContent = '';
      error.appendChild(icon('warn'));
      error.appendChild(h('span', { text: message }));
      typed.setAttribute('aria-invalid', 'true');
      settling = false;
      cancel.disabled = false;
      go.textContent = action === 'retry' ? 'Retry job' : 'Cancel job';
      sync();
      typed.focus();
    }

    typed.addEventListener('input', sync);
    var modal = openModal(node, function () { return typed; }, function () { return !settling; });
    cancel.addEventListener('click', function () { if (!settling) modal.close(); });
    go.addEventListener('click', function () {
      if (settling || typed.value !== ref) return;
      settling = true;
      typed.removeAttribute('aria-invalid');
      error.textContent = '';
      cancel.disabled = true;
      go.disabled = true;
      go.textContent = 'Sending';
      session.call(actionPath(row, action), {
        method: 'POST',
        body: { confirmation: typed.value }
      }).then(function (payload) {
        var data = payload && payload.data;
        var message = successMessage(action, row, data || {});
        settling = false;
        modal.close();
        S.toast('check', message);
        S.announce(message);
        if (opts.onSuccess) opts.onSuccess({ action: action, row: row, data: data || {}, message: message });
      }).catch(function (err) {
        var message = fixedError(err, action);
        if (isRefreshError(err)) {
          settling = false;
          modal.close();
          S.toast('warn', message);
          S.announce(message);
          if (opts.onStale) opts.onStale({ action: action, row: row, error: err, message: message });
          return;
        }
        fail(message);
      });
    });
  }

  function button(action, row, opts) {
    var b = h('button', {
      className: 'btn btn-sm ' + (action === 'cancel' ? 'btn-danger' : 'btn-primary'),
      type: 'button',
      text: action === 'cancel' ? 'Cancel' : 'Retry'
    });
    var id = row.id || row.jobId || 'unknown';
    b.setAttribute('aria-label', (action === 'cancel' ? 'Cancel ' : 'Retry ') + (actionRef(row) || id));
    if (opts && opts.focusAttr) b.setAttribute(opts.focusAttr, opts.focusPrefix + '-' + action + '-' + id);
    b.addEventListener('click', function () { confirm(action, row, opts); });
    return b;
  }

  function reasonLine(prefix, text) {
    return h('div', { className: 'job-action-reason', text: prefix + ': ' + text });
  }

  function controls(row, opts) {
    opts = opts || {};
    var caps = actionCaps(row);
    var ref = actionRef(row);
    var wrap = h('div', { className: 'job-action-stack' });
    var rowButtons = h('div', { className: 'row row-wrap gap-sm' });
    var any = false;

    if (caps.canCancel && ref) { rowButtons.appendChild(button('cancel', row, opts)); any = true; }
    if (caps.canRetry && ref) { rowButtons.appendChild(button('retry', row, opts)); any = true; }
    if (any) wrap.appendChild(rowButtons);

    var reasons = [];
    if (!caps.canCancel && caps.cancelReason) reasons.push(['Cancel', caps.cancelReason]);
    if (!caps.canRetry && caps.retryReason && caps.retryReason !== caps.cancelReason) reasons.push(['Retry', caps.retryReason]);
    if ((caps.canCancel || caps.canRetry) && !ref) reasons.push(['Actions', 'The server did not send a typed-confirmation reference.']);
    reasons.forEach(function (r) { wrap.appendChild(reasonLine(r[0], r[1])); });

    return wrap;
  }

  global.OpsJobActions = {
    controls: controls,
    referenceFromId: referenceFromId,
    fixedError: fixedError
  };
})(window);
