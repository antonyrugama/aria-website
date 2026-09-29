/* What the guided tour does for the person using it: opening, moving, closing,
   reading the page, remembering where it was, and knowing who is signed in.

   Every test boots a real pane page through scripts/ops-tour-harness.mjs,
   which runs the page's own script tags against the stub the browser checks
   serve, and drives the tour the way a person does: by pressing its buttons
   and keys. Nothing here calls into ops/assets/tour.js except to read the
   tables it publishes.

   NOT COVERED: layout, paint and contrast (the browser checks own those, and
   none of them opens the tour yet); what a real screen reader says, beyond the
   live region's text and the dialog's name and description; the rail entry
   opened from inside the phone drawer, which the fake DOM has no toggle click
   for. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { allText } from './ops-dom-harness.mjs';
import { bootPage, dialog, liveRegion } from './ops-tour-harness.mjs';

function buttons(box) {
  const all = box.querySelectorAll('button');
  const byText = (t) => all.find((b) => b.textContent === t);
  return {
    close: byText('Close'),
    back: byText('Back'),
    next: all.find((b) => b.classList.contains('btn-primary')),
    all,
  };
}

async function openGuide(paneId, options = {}) {
  const view = await bootPage(paneId, options);
  const guide = view.doc.querySelector('.tour-entry');
  assert.ok(guide, 'the top bar carries no "What am I looking at?" button');
  guide.focus();
  guide.dispatch('click');
  const box = dialog(view.doc);
  assert.ok(box, 'pressing the guide button opened nothing');
  return { ...view, guide, box, ...buttons(box) };
}

function title(box) { return allText(box.querySelector('.tour-title')); }

function stepTo(view, stepId) {
  const steps = view.window.OpsTour.stepsFor(view.paneId);
  const at = steps.findIndex((s) => s.id === stepId);
  assert.ok(at > 0, 'no step ' + stepId);
  for (let i = 0; i < at; i += 1) view.next.dispatch('click');
  assert.equal(title(view.box), steps[at].title, 'did not arrive at ' + stepId);
  return steps[at];
}

/* The dt/dd pairs a step drew, as { term: text }. */
function facts(box) {
  const out = {};
  let term = null;
  for (const el of (box.querySelector('.tour-facts') || { childNodes: [] }).childNodes) {
    if (el.tagName === 'DT') term = allText(el);
    else if (el.tagName === 'DD' && term) out[term] = allText(el);
  }
  return out;
}

function stored(view) {
  const raw = view.window.localStorage.getItem(view.window.OpsTour.STORE_KEY);
  assert.ok(raw, 'nothing was stored under ' + view.window.OpsTour.STORE_KEY);
  return JSON.parse(raw);
}

/* ------------------------------------------------------------- the dialog */

test('the guide opens a named modal dialog and moves focus into it', async () => {
  const view = await openGuide('overview');
  const { box, doc } = view;

  assert.equal(box.getAttribute('role'), 'dialog');
  assert.equal(box.getAttribute('aria-modal'), 'true');
  const named = doc.getElementById(box.getAttribute('aria-labelledby'));
  assert.ok(named && box.contains(named), 'the dialog is not named by a heading inside it');
  assert.equal(allText(named), 'Overview', 'the first step is not the pane it is about');
  const described = doc.getElementById(box.getAttribute('aria-describedby'));
  assert.ok(described && box.contains(described), 'the dialog carries no description');
  assert.match(allText(described), /Are people using it, is it working, is anything urgent\?/,
    "the first step does not state the pane's question from the registry");

  assert.ok(box.contains(doc.activeElement), 'focus stayed outside the dialog');
  assert.equal(doc.activeElement, view.next, 'focus did not land on the way forward');

  const app = doc.body.children.find((el) => el.classList.contains('gate-app'));
  assert.equal(app.getAttribute('aria-hidden'), 'true', 'the page behind the dialog is still exposed');
});

test('Escape closes the dialog and gives focus back to the button that opened it', async () => {
  const view = await openGuide('overview');
  const { doc, guide, box } = view;
  const app = doc.body.children.find((el) => el.classList.contains('gate-app'));
  assert.notEqual(doc.activeElement, guide, 'the dialog never took focus, so returning it proves nothing');

  doc.dispatch('keydown', { key: 'Escape' });

  assert.equal(dialog(doc), null, 'Escape left the dialog open');
  assert.equal(box.parentNode, null, 'the dialog is still in the document');
  assert.equal(doc.activeElement, guide, 'focus was not returned to the guide button');
  assert.equal(app.getAttribute('aria-hidden'), null, 'the page stayed hidden after the dialog closed');
  assert.equal(doc.listenerCount('keydown'), 0, 'the dialog left its key handler on the document');
});

test('Close does what Escape does', async () => {
  const view = await openGuide('releases');
  view.close.dispatch('click');
  assert.equal(dialog(view.doc), null, 'Close left the dialog open');
  assert.equal(view.doc.activeElement, view.guide, 'Close did not return focus to the guide button');
});

test('Close, Back and Next are buttons in that order, and Tab stays among them', async () => {
  const view = await openGuide('overview');
  const { doc, box } = view;
  view.next.dispatch('click');
  const order = box.querySelectorAll('button').map((b) => b.textContent);
  assert.deepEqual(order, ['Close', 'Back', 'Next'], 'the controls are not in reading order');
  view.all.forEach((b) => assert.equal(b.getAttribute('type'), 'button'));

  view.next.focus();
  doc.dispatch('keydown', { key: 'Tab', shiftKey: false });
  assert.equal(doc.activeElement, view.close, 'Tab from the last control left the dialog');
  doc.dispatch('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(doc.activeElement, view.next, 'Shift+Tab from the first control left the dialog');
});

test('Next and Back move between steps, outline the anchor, and announce each step', async () => {
  const view = await openGuide('overview');
  const { doc, box } = view;
  const steps = view.window.OpsTour.stepsFor('overview');
  const hero = doc.querySelector('.hero');

  assert.equal(view.back.disabled, true, 'Back is offered on the first step');
  view.next.dispatch('click');
  assert.equal(title(box), steps[1].title);
  assert.equal(hero.getAttribute('data-tour-anchor'), '', 'the step did not outline what it is about');
  assert.equal(liveRegion(doc).textContent, 'Step 2 of ' + steps.length + ', Overview: ' + steps[1].title + '.',
    'the step change was not announced');
  assert.equal(liveRegion(doc).getAttribute('role'), 'status');

  view.next.dispatch('click');
  assert.equal(title(box), steps[2].title);
  assert.equal(hero.getAttribute('data-tour-anchor'), null, 'the old outline stayed when the step moved on');

  view.back.focus();
  view.back.dispatch('click');
  view.back.dispatch('click');
  assert.equal(title(box), steps[0].title);
  assert.equal(view.back.disabled, true);
  assert.equal(doc.activeElement, view.next, 'focus was left on a control that just became disabled');
  assert.equal(liveRegion(doc).textContent, 'Step 1 of ' + steps.length + ', Overview: Overview.');

  doc.dispatch('keydown', { key: 'Escape' });
  assert.equal(doc.querySelectorAll('[data-tour-anchor]').length, 0, 'closing left an outline on the page');
});

test('a figure step reads the value on screen and quotes the definition of record', async () => {
  const view = await bootPage('overview');
  const tile = view.doc.querySelectorAll('.kpi').find((el) =>
    allText(el.querySelector('.kpi-label')) === 'Active people');
  /* The page's own value, changed after it was drawn: a step that quoted a
     constant, or the fixture, would not see it. */
  tile.querySelector('.kpi-val').textContent = '7,777';
  const guide = view.doc.querySelector('.tour-entry');
  guide.dispatch('click');
  const box = dialog(view.doc);
  const v = { ...view, box, ...buttons(box) };
  stepTo(v, 'overview-active-people');

  assert.match(allText(box.querySelector('.tour-live')), /^This tile reads 7,777 /,
    'the step did not describe the figure on screen');
  assert.equal(facts(box)['What it counts'], view.window.OpsTour.DEFINITIONS.activeUser.quote,
    'the step does not show the definition of record');
  for (const term of ['Grain and window', 'Where it comes from', 'Looks healthy when', 'Worth a closer look when']) {
    assert.ok(facts(box)[term], 'the figure step does not say ' + term);
  }
});

test('an action step says what it does, who may, what is recorded and what cannot be undone', async () => {
  const view = await openGuide('settings');
  stepTo(view, 'settings-retention');
  const f = facts(view.box);
  assert.deepEqual(Object.keys(f), ['What it does', 'Who may do it', 'What gets recorded', 'What cannot be undone']);
  assert.match(f['What cannot be undone'], /deleted rows cannot be brought back/);
  assert.equal(view.box.querySelector('.tour-note'), null, 'an owner was told the control is not theirs');
});

/* ----------------------------------------------------------------- roles */

test('an operator is told an owner-only control is not theirs, and still told what it does', async () => {
  const operator = await openGuide('alerts', { role: 'operator' });
  stepTo(operator, 'alerts-rules');
  const note = allText(operator.box.querySelector('.tour-note'));
  assert.match(note, /limited to the owner role/, 'the operator was not told who may use it');
  assert.match(note, /signed in as operator/, 'the operator was not told which role they have');
  assert.ok(facts(operator.box)['What it does'], 'the operator was not told what the control does');

  /* And the other direction: an owner at the same step is not refused. */
  const owner = await openGuide('alerts', { role: 'owner' });
  stepTo(owner, 'alerts-rules');
  assert.equal(owner.box.querySelector('.tour-note'), null, 'the owner was told the control is not theirs');
});

test('an operator on an owner-only pane gets the refusal explained instead of its steps', async () => {
  const view = await openGuide('settings', { role: 'operator' });
  const steps = view.window.OpsTour.stepsFor('settings');
  /* Array.from, because the steps were built in the page's realm. */
  assert.deepEqual(Array.from(steps, (s) => s.id), ['settings-intro', 'settings-denied'],
    'an operator was walked through controls the page does not draw for them');
  view.next.dispatch('click');
  const body = allText(view.box.querySelector('.tour-body'));
  assert.match(body, /Settings is limited to the owner role\. You are signed in as operator/);
  assert.match(body, /Data retention/, 'the refusal step does not say what is behind the pane');
  const refusal = view.doc.querySelector('.state-block');
  assert.equal(refusal.getAttribute('data-tour-anchor'), '', 'the refusal card the shell drew is not pointed at');
  assert.equal(view.next.textContent, 'Done');
});

/* ------------------------------------------------------- missing anchors */

test('a step whose anchor is missing because the read failed says so, and nothing throws', async () => {
  const view = await openGuide('releases', {
    answer: (path) => (path === '/api/ops/releases'
      ? Promise.reject(Object.assign(new Error('The operations API did not answer.'), { status: 503 }))
      : undefined),
  });
  view.next.dispatch('click');
  assert.equal(title(view.box), 'The production build');
  assert.match(allText(view.box.querySelector('.tour-note')),
    /could not be read\. Nothing is a zero: the figures are unread, not absent\./,
    'a missing anchor on an unreadable pane was not explained as such');
  assert.equal(view.box.querySelector('.tour-live'), null, 'a step quoted a figure that is not on screen');
});

test('a step whose anchor is missing because the pane is still reading says so', async () => {
  const view = await openGuide('releases', {
    answer: (path) => (path === '/api/ops/releases' ? new Promise(() => {}) : undefined),
  });
  view.next.dispatch('click');
  assert.match(allText(view.box.querySelector('.tour-note')), /the pane is still reading/,
    'a missing anchor on a loading pane was not explained as such');
});

/* ------------------------------------------------------------- progress */

test('an open guide comes back at the same step after a reload', async () => {
  const first = await openGuide('overview');
  first.next.dispatch('click');
  first.next.dispatch('click');
  const saved = stored(first);
  assert.deepEqual(saved.guide, { pane: 'overview', step: 2, open: true }, 'the step was not kept');

  const key = first.window.OpsTour.STORE_KEY;
  const again = await bootPage('overview', { storage: { [key]: JSON.stringify(saved) } });
  const box = dialog(again.doc);
  assert.ok(box, 'the reload did not bring the guide back');
  assert.equal(title(box), again.window.OpsTour.stepsFor('overview')[2].title,
    'the guide came back at a different step');
});

test('a dismissed tour stays closed on reload and resumes where it stopped', async () => {
  const first = await bootPage('overview');
  const start = first.doc.querySelector('.tour-start');
  assert.ok(start, 'the rail carries no tour entry');
  assert.equal(start.textContent, 'Take the tour');
  start.focus();
  start.dispatch('click');
  let box = dialog(first.doc);
  assert.ok(box, 'Take the tour opened nothing on the first pane');
  let b = buttons(box);
  b.next.dispatch('click');
  b.next.dispatch('click');
  b.close.dispatch('click');
  assert.equal(first.doc.activeElement, start, 'closing the tour did not return focus to where it began');

  const saved = stored(first);
  assert.deepEqual(saved.tour,
    { pane: 'overview', step: 2, open: false, dismissed: true, finished: false });

  const key = first.window.OpsTour.STORE_KEY;
  const again = await bootPage('overview', { storage: { [key]: JSON.stringify(saved) } });
  assert.equal(dialog(again.doc), null, 'a dismissed tour opened itself on reload');
  const resume = again.doc.querySelector('.tour-start');
  assert.ok(resume, 'the rail entry was not drawn after the reload');
  assert.equal(resume.textContent, 'Resume the tour', 'the rail does not offer to resume');
  assert.match(allText(again.doc.querySelector('.tour-rail-note')), /Stopped at Overview, step 3\./);
  resume.dispatch('click');
  box = dialog(again.doc);
  assert.ok(box, 'Resume the tour opened nothing');
  assert.equal(title(box), again.window.OpsTour.stepsFor('overview')[2].title, 'the tour resumed elsewhere');
  assert.match(allText(box.querySelector('.tour-kicker')), /^Tour: Overview, step 3 of /);
});

test('the last step of a pane carries the tour on to the next pane the registry declares', async () => {
  const first = await bootPage('overview');
  first.doc.querySelector('.tour-start').dispatch('click');
  const box = dialog(first.doc);
  const b = buttons(box);
  const total = first.window.OpsTour.stepsFor('overview').length;
  for (let i = 1; i < total; i += 1) b.next.dispatch('click');
  const nextId = Object.keys(first.registry.PANES)[1];
  const nextPane = first.registry.PANES[nextId];
  assert.equal(b.next.textContent, 'Next: ' + nextPane.label);

  b.next.dispatch('click');
  /* The fake location stores what it was handed; a browser resolves the same
     relative href against this page. */
  assert.match(first.window.location.href, new RegExp('(^|/)' + nextPane.file.replace('.', '\\.') + '$'),
    'the tour did not move on to the next pane');
  const saved = stored(first);
  assert.deepEqual(saved.tour, { pane: nextId, step: 0, open: true, dismissed: false, finished: false });

  const key = first.window.OpsTour.STORE_KEY;
  const arrived = await bootPage(nextId, { storage: { [key]: JSON.stringify(saved) } });
  const opened = dialog(arrived.doc);
  assert.ok(opened, 'the tour did not carry on when the next pane loaded');
  assert.equal(title(opened), nextPane.label);
  assert.match(allText(opened.querySelector('.tour-kicker')), /^Tour: /);
});

test('progress holds nothing but where the tour is, and a damaged record is ignored', async () => {
  const view = await openGuide('users', { lookup: true });
  view.next.dispatch('click');
  const raw = view.window.localStorage.getItem(view.window.OpsTour.STORE_KEY);
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['guide', 'tour', 'version']);
  assert.doesNotMatch(raw, /ath_|@|support request/, 'something read from the page was stored');

  const key = view.window.OpsTour.STORE_KEY;
  const damaged = await bootPage('overview', { storage: { [key]: '{"tour":{"pane":"nowhere","open":true}' } });
  assert.equal(dialog(damaged.doc), null, 'a damaged record opened the tour');
  const entry = damaged.doc.querySelector('.tour-start');
  assert.ok(entry, 'a damaged record stopped the rail entry being drawn');
  assert.equal(entry.textContent, 'Take the tour', 'a damaged record was read as a tour in progress');
});
