/* What the guided tour does for the person using it: opening, moving, closing,
   reading the page, remembering where it was, and knowing who is signed in.

   Every test boots a real pane page through scripts/ops-tour-harness.mjs,
   which runs the page's own script tags against the stub the browser checks
   serve, and drives the tour the way a person does: by pressing its buttons
   and keys. Nothing here calls into ops/assets/tour.js except to read the
   tables it publishes.

   NOT COVERED: layout, paint and contrast (the browser checks own those, and
   none of them opens the tour yet); what a real screen reader says, beyond the
   live region's text and the dialog's name and description; the menu opening
   and closing around the entries (ops-aria-shell.test.mjs holds the menu, and
   the browser check holds where it paints), so the entries are pressed here
   with the menu already out of the way. */
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
  assert.ok(guide, 'the avatar menu carries no "About this page" entry');
  const opener = view.doc.getElementById('acctBtn');
  assert.ok(opener, 'the top bar draws no avatar button for the menu to hang from');
  /* The stub has no `inert`, so `'inert' in el` is false on it and only the
     aria-hidden half of the backdrop would be exercised. Seeding the property
     is what a browser presents, and it puts the other half on test, as
     ops-shell-pane-v2.test.mjs does for the re-authentication prompt. */
  view.doc.body.children.forEach((el) => { el.inert = false; });
  opener.focus();
  guide.dispatch('click');
  const box = dialog(view.doc);
  assert.ok(box, 'pressing the guide entry opened nothing');
  return { ...view, guide, opener, box, ...buttons(box) };
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
  assert.equal(allText(named), 'Today', 'the first step is not the pane it is about');
  const described = doc.getElementById(box.getAttribute('aria-describedby'));
  assert.ok(described && box.contains(described), 'the dialog carries no description');
  assert.match(allText(described), /Is anything urgent, and are people using it\?/,
    "the first step does not state the pane's question from the registry");

  assert.ok(box.contains(doc.activeElement), 'focus stayed outside the dialog');
  assert.ok(doc.activeElement === view.next, 'focus did not land on the way forward');

  const app = doc.body.children.find((el) => el.classList.contains('gate-app'));
  assert.equal(app.getAttribute('aria-hidden'), 'true', 'the page behind the dialog is still exposed');
  assert.equal(app.inert, true, 'the page behind the dialog can still be pressed and focused');
});

test('the first step outlines the pane title together with its question', async () => {
  /* Outlining the heading alone drew the dashed line through the question
     printed under it (Stadiora/Aria#12913). */
  const { doc } = await openGuide('overview');
  const outlined = doc.querySelector('[data-tour-anchor]');
  assert.ok(outlined, 'the first step outlined nothing');
  assert.ok(outlined.querySelector('.page-title'), 'the outline does not take in the pane title');
  assert.ok(outlined.querySelector('.page-sub'), 'the outline leaves out the question under the title');
});

test('Escape closes the dialog and gives focus back to the avatar button the menu hangs from', async () => {
  /* The entry that opened the dialog sits in a menu that closes the moment it
     is pressed, so it is hidden by the time the dialog ends and cannot take
     focus. The avatar button is what is still there. */
  const view = await openGuide('overview');
  const { doc, opener, box } = view;
  const app = doc.body.children.find((el) => el.classList.contains('gate-app'));
  assert.ok(doc.activeElement !== opener, 'the dialog never took focus, so returning it proves nothing');

  doc.dispatch('keydown', { key: 'Escape' });

  assert.ok(dialog(doc) === null, 'Escape left the dialog open');
  assert.ok(box.parentNode === null, 'the dialog is still in the document');
  assert.ok(doc.activeElement === opener, 'focus was not returned to the avatar button');
  assert.equal(app.getAttribute('aria-hidden'), null, 'the page stayed hidden after the dialog closed');
  assert.equal(app.inert, false, 'the page stayed inert after the dialog closed');
  assert.equal(doc.listenerCount('keydown'), 0, 'the dialog left its key handler on the document');
});

test('Close does what Escape does', async () => {
  const view = await openGuide('releases');
  view.close.dispatch('click');
  assert.ok(dialog(view.doc) === null, 'Close left the dialog open');
  assert.ok(view.doc.activeElement === view.opener, 'Close did not return focus to the avatar button');
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
  assert.ok(doc.activeElement === view.close, 'Tab from the last control left the dialog');
  doc.dispatch('keydown', { key: 'Tab', shiftKey: true });
  assert.ok(doc.activeElement === view.next, 'Shift+Tab from the first control left the dialog');
});

test('Next and Back move between steps, outline the anchor, and announce each step', async () => {
  const view = await openGuide('overview');
  const { doc, box } = view;
  const steps = view.window.OpsTour.stepsFor('overview');
  const status = doc.querySelector('.status-line');

  assert.equal(view.back.disabled, true, 'Back is offered on the first step');
  view.next.dispatch('click');
  assert.equal(title(box), steps[1].title);
  assert.equal(status.getAttribute('data-tour-anchor'), '', 'the step did not outline what it is about');
  assert.ok(liveRegion(doc), 'nothing was announced: the page has no polite live region');
  assert.equal(liveRegion(doc).textContent, 'Step 2 of ' + steps.length + ', Today: ' + steps[1].title + '.',
    'the step change was not announced');
  assert.equal(liveRegion(doc).getAttribute('role'), 'status');

  view.next.dispatch('click');
  assert.equal(title(box), steps[2].title);
  assert.equal(status.getAttribute('data-tour-anchor'), null, 'the old outline stayed when the step moved on');

  view.back.focus();
  view.back.dispatch('click');
  view.back.dispatch('click');
  assert.equal(title(box), steps[0].title);
  assert.equal(view.back.disabled, true);
  assert.ok(doc.activeElement === view.next, 'focus was left on a control that just became disabled');
  assert.equal(liveRegion(doc).textContent, 'Step 1 of ' + steps.length + ', Today: Today.');

  doc.dispatch('keydown', { key: 'Escape' });
  assert.equal(doc.querySelectorAll('[data-tour-anchor]').length, 0, 'closing left an outline on the page');
});

test('a figure step reads the value on screen and quotes the definition of record', async () => {
  const view = await bootPage('overview');
  const people = view.doc.getElementById('today-people');
  /* The page's own value, changed after it was drawn: a step that quoted a
     constant, or the fixture, would not see it. */
  people.querySelector('.big.num').textContent = '7,777';
  const guide = view.doc.querySelector('.tour-entry');
  guide.dispatch('click');
  const box = dialog(view.doc);
  const v = { ...view, box, ...buttons(box) };
  stepTo(v, 'overview-active-people');

  assert.match(allText(box.querySelector('.tour-live')), /^This figure reads 7,777 /,
    'the step did not describe the figure on screen');
  assert.equal(facts(box)['What it counts'], view.window.OpsTour.DEFINITIONS.activeUser.quote,
    'the step does not show the definition of record');
  for (const term of ['Grain and window', 'Where it comes from', 'Looks healthy when', 'Worth a closer look when']) {
    assert.ok(facts(box)[term], 'the figure step does not say ' + term);
  }
});

test('the activity step reads the last value of each chart, and the charts are what it outlines', async () => {
  const view = await openGuide('overview');
  const charts = view.doc.getElementById('today-charts');
  /* Each chart's closing value, changed after it was drawn. */
  const ends = charts.querySelectorAll('.tc-val.is-end');
  assert.ok(ends.length >= 2, 'the page drew fewer than two charts, so there is nothing to read from');
  ends[0].textContent = '4,321';
  stepTo(view, 'overview-activity');

  assert.ok(charts.getAttribute('data-tour-anchor') === '', 'the step outlined something other than the charts');
  const live = allText(view.box.querySelector('.tour-live'));
  assert.match(live, /Mobile daily 4,321/, 'the step did not read the value on screen for the first chart');
  assert.match(live, /Coaches Web daily \d/, 'the step left out the second chart');
  assert.match(facts(view.box)['Grain and window'], /UTC day/, 'the step does not say the charts are daily');
});

test('a Today step whose section could not be read quotes nothing from it', async () => {
  /* The usage read refuses: the charts and the headline are not drawn, so the
     step has nothing to read and must not make something up. */
  const view = await openGuide('overview', {
    answer: (path) => (path === '/api/ops/usage'
      ? Promise.reject(Object.assign(new Error('The operations API did not answer.'), { status: 503 }))
      : undefined),
  });
  stepTo(view, 'overview-activity');
  assert.ok(view.doc.getElementById('today-charts').getAttribute('data-tour-anchor') === '',
    'the failed section was not pointed at');
  assert.ok(view.box.querySelector('.tour-live') === null,
    'a step quoted a figure for a chart that is not drawn');
});

test('an action step says what it does, who may, what is recorded and what cannot be undone', async () => {
  const view = await openGuide('settings');
  stepTo(view, 'settings-retention');
  const f = facts(view.box);
  assert.deepEqual(Object.keys(f), ['What it does', 'Who may do it', 'What gets recorded', 'What cannot be undone']);
  assert.match(f['What cannot be undone'], /deleted rows cannot be brought back/);
  assert.ok(view.box.querySelector('.tour-note') === null, 'an owner was told the control is not theirs');
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
  assert.ok(owner.box.querySelector('.tour-note') === null, 'the owner was told the control is not theirs');
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
  assert.ok(view.box.querySelector('.tour-live') === null, 'a step quoted a figure that is not on screen');
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
  assert.ok(start, 'the avatar menu carries no tour entry');
  assert.equal(start.textContent, 'Take the tour');
  const opener = first.doc.getElementById('acctBtn');
  opener.focus();
  start.dispatch('click');
  let box = dialog(first.doc);
  assert.ok(box, 'Take the tour opened nothing on the first pane');
  let b = buttons(box);
  b.next.dispatch('click');
  b.next.dispatch('click');
  b.close.dispatch('click');
  assert.ok(first.doc.activeElement === opener, 'closing the tour did not return focus to the avatar button');

  const saved = stored(first);
  assert.deepEqual(saved.tour,
    { pane: 'overview', step: 2, open: false, dismissed: true, finished: false });

  const key = first.window.OpsTour.STORE_KEY;
  const again = await bootPage('overview', { storage: { [key]: JSON.stringify(saved) } });
  assert.ok(dialog(again.doc) === null, 'a dismissed tour opened itself on reload');
  const resume = again.doc.querySelector('.tour-start');
  assert.ok(resume, 'the menu entry was not drawn after the reload');
  assert.equal(resume.textContent, 'Resume the tour', 'the menu does not offer to resume');
  assert.match(allText(again.doc.querySelector('.tour-rail-note')), /Stopped at Today, step 3\./);
  resume.dispatch('click');
  box = dialog(again.doc);
  assert.ok(box, 'Resume the tour opened nothing');
  assert.equal(title(box), again.window.OpsTour.stepsFor('overview')[2].title, 'the tour resumed elsewhere');
  assert.match(allText(box.querySelector('.tour-kicker')), /^Tour: Today, step 3 of /);
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

  /* Two kinds of damage: a record that is not JSON at all, and one that
     parses but names a pane the registry does not declare. */
  const key = view.window.OpsTour.STORE_KEY;
  for (const record of [
    '{"tour":{"pane":"nowhere","open":true}',
    '{"version":1,"tour":{"pane":"nowhere","step":2,"open":true},"guide":{"pane":"nowhere","open":true}}',
  ]) {
    const damaged = await bootPage('overview', { storage: { [key]: record } });
    assert.ok(dialog(damaged.doc) === null, 'a damaged record opened the tour: ' + record);
    const entry = damaged.doc.querySelector('.tour-start');
    assert.ok(entry, 'a damaged record stopped the rail entry being drawn: ' + record);
    assert.equal(entry.textContent, 'Take the tour', 'a damaged record was read as a tour in progress: ' + record);
  }
});
