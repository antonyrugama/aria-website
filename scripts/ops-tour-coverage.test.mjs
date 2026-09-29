/* The guided tour covers the dashboard the registry declares, points at things
   the panes really draw, and quotes the metric definitions it says it quotes.

   What is held here, each by booting the real pages rather than by reading
   ops/assets/tour.js as text:

     - every pane the registry declares has tour steps, and the tour names no
       pane the registry does not;
     - every pane page loads the tour after its shell and its own module, and
       the tour's sheet after the shared ones;
     - every step's anchor is on its pane once the pane has drawn its data,
       from the stub the browser checks serve;
     - every section a pane draws is covered by a step, so a band added to a
       pane without a tour entry is red here;
     - steps are complete: unique ids, a title, and for every figure and every
       control the four or five things the tour promises to say;
     - walking every step of every pane sends no request and opens no
       confirmation or other dialog;
     - every definition the tour quotes is in the vendored excerpt of the
       metric definitions, under the heading it names, at the commit it names,
       and every glossary term there is used.

   NOT COVERED, so a green run is not read as more than it is:

     - That the vendored excerpt still matches the metric definitions in the
       Aria monorepo today. This repository cannot read that one; the excerpt
       pins a commit, and moving the pin is a copy made by a person.
     - That tour prose other than the quoted definitions agrees with anything.
       "Where it comes from", "healthy" and "worrying" are the tour's own words.
     - Anchors in any state but the drawn one below. A pane that has not
       loaded, or is empty or unreadable, has no anchors to find; the dialog
       test covers what the tour says then.
     - Look up a user is judged after one lookup and Aria quality before any
       form is submitted, which are the states the stub can put them in. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { bootPage, dialog, pageScripts, pageSheets, registry } from './ops-tour-harness.mjs';

const EXCERPT = readFileSync(
  new URL('./fixtures/ops-metric-definitions.excerpt.md', import.meta.url), 'utf8');

const PANES = registry().PANES;
const PANE_IDS = Object.keys(PANES);

/* One booted page per pane, in its drawn state, shared by the tests below. */
const booted = new Map();
async function page(paneId) {
  if (!booted.has(paneId)) booted.set(paneId, await bootPage(paneId, { lookup: paneId === 'users' }));
  return booted.get(paneId);
}

function isShown(el) {
  for (let n = el; n && n.getAttribute; n = n.parentNode) {
    if (n.getAttribute('data-state') !== null && n.getAttribute('data-shown') === null) return false;
  }
  return true;
}

function sectionName(section) {
  const title = section.querySelector('.band-title, .hero-title, .hunt-title');
  return title ? String(title.textContent).trim() : '(untitled ' + section.getAttribute('class') + ')';
}

test('every pane the registry declares has tour steps, and the tour names no other pane', async () => {
  const { window } = await page('overview');
  const tour = window.OpsTour.TOUR;
  assert.ok(PANE_IDS.length >= 10, 'the registry came back suspiciously short: ' + PANE_IDS.length);

  const missing = PANE_IDS.filter((id) => !Array.isArray(tour[id]) || !tour[id].length);
  assert.deepEqual(missing, [], 'panes in the registry with no tour steps: ' + missing.join(', '));

  const strangers = Object.keys(tour).filter((id) => !PANES[id]);
  assert.deepEqual(strangers, [], 'tour entries for panes the registry does not declare: ' +
    strangers.join(', '));
});

test('every pane page loads the tour after its shell and its own module, and its sheet last', () => {
  for (const id of PANE_IDS) {
    const file = PANES[id].file;
    const scripts = pageScripts(file);
    assert.equal(scripts.filter((s) => s === 'tour.js').length, 1, file + ' does not load tour.js once');
    assert.equal(scripts[scripts.length - 1], 'tour.js',
      file + ' loads tour.js before ' + scripts[scripts.length - 1] + ', so the pane it reads is not there yet');
    assert.ok(scripts.indexOf('shell-pane-v2.js') !== -1 &&
      scripts.indexOf('shell-pane-v2.js') < scripts.indexOf('tour.js'),
    file + ' loads the tour before the shell it needs');

    const sheets = pageSheets(file);
    assert.equal(sheets[sheets.length - 1], 'tour-v2.css',
      file + ' does not load tour-v2.css after the sheets whose dialog layer it adjusts');
  }
});

test('every step anchor is on its pane once the pane has drawn its data', async () => {
  const lost = [];
  let checked = 0;
  for (const id of PANE_IDS) {
    const { window } = await page(id);
    for (const step of window.OpsTour.stepsFor(id)) {
      checked += 1;
      if (!window.OpsTour.findAnchor(step.anchor)) {
        lost.push(id + ': ' + step.id + ' -> ' + JSON.stringify(step.anchor));
      }
    }
  }
  assert.deepEqual(lost, [], 'steps whose anchor the pane does not draw:\n  ' + lost.join('\n  '));
  assert.ok(checked >= 60, 'only ' + checked + ' steps were checked, so this is not reading the tour');
});

test('every section a pane draws is covered by a step', async () => {
  const uncovered = [];
  let sections = 0;
  for (const id of PANE_IDS) {
    const { window, doc } = await page(id);
    const drawn = doc.getElementById('content').querySelectorAll('section').filter(isShown);
    sections += drawn.length;
    const anchors = window.OpsTour.stepsFor(id)
      .map((step) => window.OpsTour.findAnchor(step.anchor)).filter(Boolean);
    /* An anchor that wraps every section on the pane would cover all of them
       and say nothing about any, so it covers none. */
    const narrow = anchors.filter((a) => !drawn.every((s) => a.contains(s)));
    for (const section of drawn) {
      const covered = narrow.some((a) => a === section || section.contains(a) || a.contains(section));
      if (!covered) uncovered.push(id + ': ' + sectionName(section));
    }
  }
  assert.deepEqual(uncovered, [], 'sections no tour step points at:\n  ' + uncovered.join('\n  '));
  assert.ok(sections >= 40, 'only ' + sections + ' sections were drawn, so the panes did not load');
});

test('every step is complete: a unique id, a title, and everything a figure or a control needs', async () => {
  const { window } = await page('overview');
  const { TOUR, DEFINITIONS } = window.OpsTour;
  const ids = new Set();
  const problems = [];
  const text = (v) => typeof v === 'string' && v.trim().length > 0;
  const ROLES = ['owner', 'operator', 'viewer'];

  for (const [paneId, steps] of Object.entries(TOUR)) {
    for (const step of steps) {
      const where = paneId + ': ' + step.id;
      if (ids.has(step.id)) problems.push(where + ' repeats an id');
      ids.add(step.id);
      if (!text(step.title)) problems.push(where + ' has no title');
      if (!step.anchor || !text(step.anchor.selector)) problems.push(where + ' has no anchor');
      if (!['section', 'metric', 'action'].includes(step.kind)) {
        problems.push(where + ' is of kind ' + step.kind);
      }
      if (step.roles && !(step.roles.length && step.roles.every((r) => ROLES.includes(r)))) {
        problems.push(where + ' names roles that do not exist: ' + step.roles.join(', '));
      }
      if (step.kind === 'metric') {
        const m = step.metric || {};
        const defined = m.definition !== undefined;
        if (defined && !DEFINITIONS[m.definition]) {
          problems.push(where + ' quotes a definition that does not exist: ' + m.definition);
        }
        if (defined === text(m.counts)) {
          problems.push(where + ' must either quote a definition or say what it counts, not both');
        }
        for (const field of ['grain', 'source', 'healthy', 'worrying']) {
          if (!text(m[field])) problems.push(where + ' does not say ' + field);
        }
      } else if (step.metric) {
        problems.push(where + ' carries a metric but is not a metric step');
      }
      if (step.kind === 'action') {
        for (const field of ['does', 'who', 'audited', 'undo']) {
          if (!text((step.action || {})[field])) problems.push(where + ' does not say ' + field);
        }
      } else if (step.action) {
        problems.push(where + ' carries an action but is not an action step');
      }
      if (step.kind === 'section' && !text(step.body)) problems.push(where + ' says nothing');
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
  assert.ok(ids.size >= 60, 'only ' + ids.size + ' steps, so this is not reading the tour');
});

test('walking every step of every pane sends no request and opens no other dialog', async () => {
  for (const id of PANE_IDS) {
    const view = await bootPage(id, { lookup: id === 'users' });
    const before = view.calls.length;
    const guide = view.doc.querySelector('.tour-entry');
    guide.focus();
    guide.dispatch('click');
    const box = dialog(view.doc);
    assert.ok(box, id + ': the guide did not open');
    const next = box.querySelectorAll('button').find((b) => b.textContent === 'Next');
    const total = view.window.OpsTour.stepsFor(id).length;
    for (let i = 1; i < total; i += 1) next.dispatch('click');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(next.textContent, 'Done', id + ': the walk did not reach the last step');
    assert.deepEqual(view.calls.slice(before), [],
      id + ': walking the tour made a request: ' + JSON.stringify(view.calls.slice(before)));
    /* A confirmation opened by a pressed control makes no request until it is
       confirmed, so the request log alone would not see one. */
    const others = view.body.children.filter((el) =>
      (el.classList.contains('modal') && el !== box) || el.classList.contains('scrim'));
    assert.deepEqual(others.map((el) => el.className), [],
      id + ': walking the tour opened something else on the page');
  }
});

/* --------------------------------------------------- definitions of record */

function excerptHeader(name) {
  const m = new RegExp('^source ' + name + ': (.+)$', 'm').exec(EXCERPT);
  return m ? m[1].trim() : null;
}

/* Heading -> the text under it, whitespace folded, up to the next heading. */
function excerptSections() {
  const body = EXCERPT.replace(/<!--[\s\S]*?-->/, '');
  const out = new Map();
  let current = null;
  for (const line of body.split('\n')) {
    const heading = /^#{2,3} (.+)$/.exec(line);
    if (heading) {
      current = heading[1].trim();
      out.set(current, { level: line.startsWith('###') ? 3 : 2, text: '' });
      continue;
    }
    if (current) out.get(current).text += ' ' + line;
  }
  for (const entry of out.values()) entry.text = entry.text.replace(/\s+/g, ' ').trim();
  return out;
}

test('the tour names the same source and commit as the vendored excerpt', async () => {
  const { window } = await page('overview');
  const source = window.OpsTour.DEFINITION_SOURCE;
  assert.equal(source.repository, excerptHeader('repository'), 'repository differs');
  assert.equal(source.path, excerptHeader('path'), 'source path differs');
  assert.match(source.commit, /^[0-9a-f]{40}$/, 'the pin is not a full commit id');
  assert.equal(source.commit, excerptHeader('commit'),
    'the tour quotes one commit of the metric definitions and the excerpt holds another');
});

test('every definition the tour quotes is in the excerpt, word for word, under its heading', async () => {
  const { window } = await page('overview');
  const sections = excerptSections();
  const wrong = [];
  for (const [key, def] of Object.entries(window.OpsTour.DEFINITIONS)) {
    const section = sections.get(def.section);
    if (!section) { wrong.push(key + ': no heading "' + def.section + '" in the excerpt'); continue; }
    if (!section.text.includes(def.quote.replace(/\s+/g, ' '))) {
      wrong.push(key + ': "' + def.quote + '" is not under "' + def.section + '"');
    }
  }
  assert.deepEqual(wrong, [], wrong.join('\n'));
});

test('every glossary term in the excerpt is quoted, and every quote is used by a step', async () => {
  const { window } = await page('overview');
  const { TOUR, DEFINITIONS } = window.OpsTour;
  const used = new Set();
  for (const steps of Object.values(TOUR)) {
    for (const step of steps) if (step.metric && step.metric.definition) used.add(step.metric.definition);
  }
  const unused = Object.keys(DEFINITIONS).filter((key) => !used.has(key));
  assert.deepEqual(unused, [], 'definitions no step shows: ' + unused.join(', '));

  const quotedSections = new Set([...used].map((key) => DEFINITIONS[key].section));
  const glossary = [...excerptSections()].filter(([, s]) => s.level === 3).map(([name]) => name);
  assert.ok(glossary.length >= 5, 'the excerpt carries ' + glossary.length + ' glossary terms');
  const unexplained = glossary.filter((name) => !quotedSections.has(name));
  assert.deepEqual(unexplained, [], 'glossary terms no step explains: ' + unexplained.join(', '));
});
