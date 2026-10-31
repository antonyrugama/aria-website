(function (global) {
  'use strict';
  var shell = global.OpsPaneShell;
  var session = global.OpsSession;
  var h = shell.h;
  var COPY = {
    es: {
      title: 'Seguridad de la comunidad', note: 'Reportes privados, del más antiguo al más reciente. Actúa en 24 horas. Los filtros de Problemas no cambian esta cola.',
      loading: 'Cargando reportes', empty: 'No hay reportes pendientes', retry: 'Reintentar', refresh: 'Actualizar', next: 'Cargar siguientes',
      due: 'Responder antes de', overdue: 'Plazo vencido', noDeadline: 'Sin plazo: revisa el reporte ahora',
      delivery: 'Avisos al desarrollador', missing: 'Sin registro de entrega', evidence: 'Descargar evidencia privada',
      remove: 'Retirar contenido', eject: 'Retirar acceso', dismiss: 'Descartar reporte', reason: 'Motivo de la decisión (3 a 500 caracteres)',
      cancel: 'Cancelar', confirm: 'Confirmar decisión', success: 'Decisión registrada en la auditoría',
      removeBody: 'El contenido dejará de mostrarse para todos.',
      ejectBody: 'Se retirarán las publicaciones, comentarios y mensajes de esta cuenta y su acceso a la comunidad y al chat. Su entrenamiento privado y su inicio de sesión seguirán disponibles.',
      dismissBody: 'Se cerrará el reporte. El contenido seguirá oculto para quien lo reportó.',
      invalid: 'Escribe un motivo de 3 a 500 caracteres.', failed: 'No se pudo completar la acción. Reintenta.',
      deliveryStates: { pending: 'Pendiente', processing: 'En curso', delivered: 'Entregado', failed: 'Falló', unconfigured: 'Sin configurar' },
      targetTypes: { post: 'Publicación', comment: 'Comentario', profile: 'Perfil', chat_message: 'Mensaje' },
      reportStates: { open: 'Pendiente', reviewing: 'En revisión' }, channels: { teams: 'Teams', email: 'Correo' },
      categories: { inappropriate: 'Contenido inapropiado', harassment: 'Acoso o insultos', safety: 'Riesgo para alguien', spam: 'Spam o publicidad' }
    },
    en: {
      title: 'Community safety', note: 'Private reports, oldest first. Act within 24 hours. Problems filters do not change this queue.',
      loading: 'Loading reports', empty: 'No pending reports', retry: 'Retry', refresh: 'Refresh', next: 'Load next reports',
      due: 'Act before', overdue: 'Overdue', noDeadline: 'No deadline: review this report now',
      delivery: 'Developer notifications', missing: 'No delivery record', evidence: 'Download private evidence',
      remove: 'Remove content', eject: 'Remove access', dismiss: 'Dismiss report', reason: 'Decision reason (3 to 500 characters)',
      cancel: 'Cancel', confirm: 'Confirm decision', success: 'Decision recorded in the audit',
      removeBody: 'This content will no longer appear for anyone.',
      ejectBody: 'This account’s posts, comments and messages will be removed, along with access to the community and human chat. Private training and sign-in will remain available.',
      dismissBody: 'The report will be closed. Content will remain hidden for the person who reported it.',
      invalid: 'Enter a reason between 3 and 500 characters.', failed: 'Could not complete the action. Try again.',
      deliveryStates: { pending: 'Pending', processing: 'In progress', delivered: 'Delivered', failed: 'Failed', unconfigured: 'Not configured' },
      targetTypes: { post: 'Post', comment: 'Comment', profile: 'Profile', chat_message: 'Message' },
      reportStates: { open: 'Pending', reviewing: 'In review' }, channels: { teams: 'Teams', email: 'Email' },
      categories: { inappropriate: 'Inappropriate content', harassment: 'Bullying or insults', safety: 'Someone may be at risk', spam: 'Spam or advertising' }
    },
    pt: {
      title: 'Segurança da comunidade', note: 'Denúncias privadas, da mais antiga à mais recente. Aja em até 24 horas. Os filtros de Problemas não alteram esta fila.',
      loading: 'Carregando denúncias', empty: 'Nenhuma denúncia pendente', retry: 'Tentar novamente', refresh: 'Atualizar', next: 'Carregar próximas',
      due: 'Responder antes de', overdue: 'Prazo vencido', noDeadline: 'Sem prazo: analise esta denúncia agora',
      delivery: 'Avisos ao desenvolvedor', missing: 'Sem registro de entrega', evidence: 'Baixar evidência privada',
      remove: 'Remover conteúdo', eject: 'Remover acesso', dismiss: 'Descartar denúncia', reason: 'Motivo da decisão (3 a 500 caracteres)',
      cancel: 'Cancelar', confirm: 'Confirmar decisão', success: 'Decisão registrada na auditoria',
      removeBody: 'O conteúdo deixará de aparecer para todos.',
      ejectBody: 'As publicações, comentários e mensagens desta conta serão removidos, junto com seu acesso à comunidade e ao chat. O treino privado e o login continuarão disponíveis.',
      dismissBody: 'A denúncia será encerrada. O conteúdo continuará oculto para quem denunciou.',
      invalid: 'Escreva um motivo de 3 a 500 caracteres.', failed: 'Não foi possível concluir. Tente novamente.',
      deliveryStates: { pending: 'Pendente', processing: 'Em curso', delivered: 'Entregue', failed: 'Falhou', unconfigured: 'Não configurado' },
      targetTypes: { post: 'Publicação', comment: 'Comentário', profile: 'Perfil', chat_message: 'Mensagem' },
      reportStates: { open: 'Pendente', reviewing: 'Em análise' }, channels: { teams: 'Teams', email: 'E-mail' },
      categories: { inappropriate: 'Conteúdo inadequado', harassment: 'Assédio ou insultos', safety: 'Alguém pode estar em risco', spam: 'Spam ou publicidade' }
    }
  };

  function render(content) {
    if (!session.hasRole(['owner', 'operator'])) return;
    var language = (global.document.documentElement.lang || 'en').slice(0, 2);
    if (!COPY[language]) language = 'en';
    var copy = COPY[language];
    var section = h('section', { className: 'band ugc-queue', 'aria-label': copy.title });
    content.appendChild(section);
    content.insertBefore(section, content.firstChild);
    var cursor = 0;
    var loadId = 0;
    var currentItems = [];
    var urls = [];
    var mutating = false;
    var title = h('h2', { text: copy.title });
    var languageSelect = h('select', { 'aria-label': 'Language / Idioma' }, [
      h('option', { value: 'es', text: 'Español' }), h('option', { value: 'en', text: 'English' }), h('option', { value: 'pt', text: 'Português' })
    ]);
    languageSelect.value = language;
    section.appendChild(title);
    section.appendChild(languageSelect);
    var note = h('p', { className: 'card-note', text: copy.note });
    section.appendChild(note);
    var refresh = h('button', { type: 'button', className: 'btn btn-sm', text: copy.refresh });
    section.appendChild(refresh);
    var body = h('div', { className: 'ugc-items', 'aria-live': 'polite' });
    section.appendChild(body);
    var next = h('button', { type: 'button', className: 'btn btn-sm', text: copy.next });
    next.hidden = true;
    section.appendChild(next);

    function button(label, handler) {
      var node = h('button', { type: 'button', className: 'btn btn-sm', text: label });
      node.addEventListener('click', handler);
      return node;
    }
    function errorText(error) { return shell.failureMessage(error); }
    function actionForm(item, action, card, trigger) {
      if (mutating) return;
      var existing = card.querySelector('.ugc-action');
      if (existing) existing.remove();
      var form = h('form', { className: 'ugc-action card-body' });
      var warning = h('p', { text: copy[action + 'Body'] });
      var id = 'ugc-reason-' + item.id;
      var reason = h('textarea', { id: id, required: true, minlength: '3', maxlength: '500', className: 'ugc-input' });
      var error = h('p', { role: 'alert', className: 'field-error' });
      var confirm = h('button', { type: 'submit', className: 'btn', text: copy.confirm });
      var cancel = button(copy.cancel, function () { form.remove(); trigger.focus(); });
      form.appendChild(warning);
      form.appendChild(h('label', { for: id, text: copy.reason }));
      form.appendChild(reason);
      form.appendChild(error);
      form.appendChild(h('div', { className: 'ugc-actions' }, [confirm, cancel]));
      card.appendChild(form);
      reason.focus();
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (confirm.disabled || mutating) return;
        var value = reason.value.trim();
        if (value.length < 3 || value.length > 500) { error.textContent = copy.invalid; reason.focus(); return; }
        confirm.disabled = true; cancel.disabled = true; reason.disabled = true;
        mutating = true;
        refresh.disabled = true; next.disabled = true; languageSelect.disabled = true;
        error.textContent = '';
        var decided = false;
        session.call('/api/ops/moderation/reports/' + item.id + '/actions', { method: 'POST', body: { action: action, reason: value } })
          .then(function (payload) {
            var result = payload.data;
            if (!result || result.reportId !== item.id || result.action !== action
              || result.status !== (action === 'dismiss' ? 'dismissed' : 'resolved')
              || result.authorEjected !== (action === 'eject')) throw new Error(copy.failed);
            currentItems = currentItems.filter(function (row) { return row.id !== item.id; });
            card.remove();
            shell.toast('check', copy.success);
            decided = true;
            if (!currentItems.length) body.appendChild(shell.stateBlock('check', copy.empty, []));
          }).catch(function (failure) {
            error.textContent = errorText(failure);
            confirm.disabled = false; cancel.disabled = false; reason.disabled = false;
          }).finally(function () {
            mutating = false;
            refresh.disabled = false; next.disabled = false; languageSelect.disabled = false;
            var live = global.document.activeElement;
            if (decided && (!live || live === global.document.body)) refresh.focus();
          });
      });
    }
    function cardFor(item) {
      var card = shell.card('ugc-report');
      var due = item.actionDueAt ? new Date(item.actionDueAt) : null;
      if (due && !Number.isFinite(due.getTime())) due = null;
      var overdue = due && due.getTime() <= Date.now();
      card.appendChild(shell.cardHead('#' + item.id + ' · ' + (copy.categories[item.category] || item.category),
        (copy.targetTypes[item.targetType] || item.targetType) + ' · ' + (copy.reportStates[item.status] || item.status)));
      var deadline = h('p', {
        className: overdue || !due ? 'ugc-overdue' : 'card-note',
        text: due ? (overdue ? copy.overdue + ' · ' : '') + copy.due + ' ' + due.toLocaleString(language) : copy.noDeadline
      });
      card.appendChild(deadline);
      card.appendChild(h('p', { text: item.note || '' }));
      if (item.target) {
        var evidence = item.target.evidence;
        var preview = item.target.body || item.target.caption || item.target.displayName || item.target.handle;
        card.appendChild(h('p', { className: 'ugc-preview', text: preview || '' }));
        if (evidence) {
          var snapshot = evidence.snapshot || evidence.contextSnapshot;
          if (snapshot) card.appendChild(h('pre', { className: 'ugc-preview', text: JSON.stringify(snapshot, null, 2) }));
          (evidence.media || []).forEach(function (media) {
            var downloadError = h('p', { role: 'alert', className: 'field-error' });
            var download = button(copy.evidence, function () {
              if (!/^\/api\/ops\/moderation\/(?:community-evidence|evidence)\/[a-f0-9-]+\/media\/[a-f0-9-]+$/.test(media.contentPath)) {
                downloadError.textContent = copy.failed; return;
              }
              download.disabled = true;
              session.call(media.contentPath, { responseType: 'blob' }).then(function (blob) {
                var url = global.URL.createObjectURL(blob);
                urls.push(url);
                var link = h('a', { href: url, download: 'report-' + item.id + '-evidence' });
                section.appendChild(link); link.click(); link.remove();
                global.URL.revokeObjectURL(url);
                urls = urls.filter(function (entry) { return entry !== url; });
              }).catch(function (failure) { downloadError.textContent = errorText(failure); })
                .finally(function () { download.disabled = false; });
            });
            card.appendChild(download); card.appendChild(downloadError);
          });
        }
      }
      var statuses = h('div', { className: 'ugc-delivery' }, [h('strong', { text: copy.delivery })]);
      ['teams', 'email'].forEach(function (channel) {
        var found = (item.notifications || []).find(function (row) { return row.channel === channel; });
        var failed = !found || found.status === 'failed' || found.status === 'unconfigured' || found.failureReason === 'unconfigured';
        statuses.appendChild(h('p', {
          className: failed ? 'ugc-overdue' : 'card-note',
          text: copy.channels[channel] + ': ' + (found ? (copy.deliveryStates[found.failureReason === 'unconfigured' ? 'unconfigured' : found.status === 'sending' ? 'processing' : found.status] || found.status) : copy.missing)
        }));
      });
      card.appendChild(statuses);
      var actions = h('div', { className: 'ugc-actions card-foot' });
      (item.targetType === 'profile' ? ['eject', 'dismiss'] : ['remove', 'eject', 'dismiss']).forEach(function (action) {
        var trigger = button(copy[action], function () { actionForm(item, action, card, trigger); });
        actions.appendChild(trigger);
      });
      card.appendChild(actions);
      return card;
    }
    function paint() {
      body.textContent = '';
      if (!currentItems.length) body.appendChild(shell.stateBlock('check', copy.empty, []));
      currentItems.forEach(function (item) { body.appendChild(cardFor(item)); });
    }
    function load(afterId) {
      if (mutating) return Promise.resolve();
      var token = ++loadId;
      refresh.disabled = true; next.disabled = true;
      languageSelect.disabled = true;
      body.textContent = '';
      next.hidden = true;
      body.appendChild(shell.stateBlock('clock', copy.loading, []));
      return session.call('/api/ops/moderation/reports', { query: { limit: 25, afterId: afterId } })
        .then(function (payload) {
          if (token !== loadId) return;
          if (!payload.data || !Array.isArray(payload.data.items)) throw new Error(copy.failed);
          currentItems = payload.data.items;
          cursor = payload.data.nextCursor;
          next.hidden = cursor == null;
          paint();
        }).catch(function (failure) {
          if (token !== loadId) return;
          body.textContent = '';
          body.appendChild(shell.stateBlock('warn', copy.failed, [errorText(failure)]));
          body.appendChild(button(copy.retry, function () { void load(afterId); }));
        }).finally(function () {
          if (token === loadId) { refresh.disabled = false; next.disabled = false; languageSelect.disabled = false; }
        });
    }
    refresh.addEventListener('click', function () { void load(0); });
    next.addEventListener('click', function () { if (cursor != null) void load(cursor); });
    languageSelect.addEventListener('change', function () {
      if (mutating || languageSelect.disabled) return;
      language = languageSelect.value; copy = COPY[language];
      title.textContent = copy.title; note.textContent = copy.note; refresh.textContent = copy.refresh; next.textContent = copy.next;
      section.setAttribute('lang', language); paint();
    });
    global.addEventListener('pagehide', function () {
      loadId++; urls.forEach(function (url) { global.URL.revokeObjectURL(url); });
    });
    void load(0);
  }
  global.OpsUgc = { render: render };
  global.addEventListener('ops:ready', function (event) {
    if (event.detail.pane !== 'alerts') return;
    var content = global.document.getElementById('content');
    if (!content) throw new Error('Operations content is missing');
    render(content);
  });
})(window);
