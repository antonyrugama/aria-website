/* Mutation battery for scripts/ops-keyboard-walk.mjs.
 *
 * WHAT A KILL MEANS HERE IS NOT AN EXIT CODE. This tool is an instrument, not
 * a test suite: it does not go red, it prints numbers, and the numbers are
 * what the audit publishes. So every experiment names a SIGNAL -- one value
 * read out of the walk's own JSON -- and a mutation is killed when that
 * signal moves off the baseline C0 measured. A finding whose signal cannot
 * be made to move is a finding the instrument did not actually observe.
 *
 * USAGE: node scripts/ops-keyboard-walk.battery.mjs [tree]
 *
 * With no argument it operates on this repository. The published run was made
 * against an rsync'd copy so the worktree was never edited, which is what the
 * optional argument is for; the tree it is pointed at must be a checkout, not
 * a bare directory, because the walk serves it over HTTP.
 *
 * Runs in whatever tree it is given, and never edits the worktree when given
 * a copy. Every payload is
 * applied by exact string replacement and then BYTE-COMPARED against the
 * pre-image: a successful regex is not evidence that a mutation landed, and a
 * mutation that did not land is indistinguishable from one that was killed
 * unless the bytes are compared. Restores from copies taken before the
 * battery, never from git, and byte-compares the restoration too.
 *
 * Controls are labelled by KIND because the two kinds expect opposite
 * outcomes: an IDENTITY control changes nothing and must leave the signal on
 * its baseline with a zero-byte delta; a TOLERANCE control makes a real edit
 * the instrument is supposed to be indifferent to, and must leave the signal
 * on its baseline with a non-zero one.
 *
 * The table is printed FROM the executed run, and every published anchor is
 * re-resolved against the RESTORED tree before printing, so a row cannot
 * name a line nobody mutated.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/* ABSOLUTE, BECAUSE THE TOOL RUNS WITH cwd SET TO THIS DIRECTORY. Invoked as
   `battery3.mjs bt3/wt` the record path was relative, the tool resolved it
   against its OWN cwd, and every walk ran perfectly and wrote its record to a
   directory that does not exist. The walk output looked completely healthy;
   only "the record is missing" caught it. */
const ROOT = fs.realpathSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const WT = path.resolve(process.argv[2] || ROOT);
const OUTDIR = path.join(WT, '.probe');
fs.mkdirSync(OUTDIR, { recursive: true });
const TOOL = 'scripts/ops-keyboard-walk.mjs';
const OUTJSON = path.join(WT, 'battery-walk.json');

const TOUCHED = [
  TOOL,
  'ops/assets/operate.js',
  'ops/assets/pane-run-history-v2.js',
  'ops/assets/pane-evaluations.js',
  'ops/assets/pane-evaluations-v2.css',
  'ops/assets/settings.js',
  'ops/assets/shell-pane-v2.js',
  'ops/assets/aria.css'
];
const PRE = new Map(TOUCHED.map((f) => [f, fs.readFileSync(path.join(WT, f))]));

function restoreAll() {
  for (const [f, buf] of PRE) {
    fs.writeFileSync(path.join(WT, f), buf);
    if (!fs.readFileSync(path.join(WT, f)).equals(buf)) {
      throw new Error(`restore of ${f} did not byte-compare equal`);
    }
  }
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { restoreAll(); process.exit(130); });
}

/* Each signal reads ONE number or boolean out of the walk record. The name is
   what the row publishes, so a row cannot claim to have moved a different
   quantity than the one it measured. */
/* EVERY PREDICATE ASSERTS ITS SAMPLE IS NON-EMPTY. "every sampled row
   passed" is free when nothing was sampled, and an empty `every()` returns
   true, so a walk that produced no rows at all would score identically to a
   walk that passed. A signal over an empty population is VACUOUS, not true. */
const over = (j, pane, fn) => {
  const rows = j.walks.filter((w) => w.pane === pane);
  return rows.length ? fn(rows) : 'VACUOUS';
};
/* THE DOCUMENT IS THE DELIVERABLE, SO IT IS ALSO A SIGNAL. Every other
   signal reads the walk RECORD, which is upstream of the generator: a defect
   that lives in how the document counts what the walk found -- the headline
   reading a different population than the list under it, sibling elements
   collapsing into one -- moves nothing in the record at all. These read the
   published markdown, which is the thing a reader would be misled by. This
   is not "regex over source text instead of value resolution": the text IS
   the published value here. */
const docNum = (j, re) => {
  const m = re.exec(j.__doc || '');
  return m ? Number(m[1]) : 'VACUOUS';
};
const S = {
  docDeclaredScrollers: (j) => docNum(j, /the walk found\s+(\d+) scroll containers/),
  docUndeclaredHeadline: (j) => docNum(j, /\*\*Scroll containers never declared focusable\*\* \| \*\*(\d+)\*\*/),
  docHiddenHeadline: (j) => docNum(j, /still paints\*\* \| \*\*(\d+)\*\*/),
  docFindings: (j) => (j.__doc ? (j.__doc.match(/^### F\d+\./gm) || []).length : 'VACUOUS'),
  docRetraceOk: (j) => docNum(j, /exactly retraces Tab \| (\d+)\//),
  docRetraceStops: (j) => docNum(j, /exactly retraces Tab \| \d+\/\d+, \*\*(\d+) stops retraced/),
  historyScrollers: (j) => j.walks.filter((w) => w.pane === 'history')
    .reduce((a, w) => a + w.undeclaredScrollers.length, 0),
  evalsHidden: (j) => j.walks.filter((w) => w.pane === 'evals')
    .reduce((a, w) => a + w.hiddenPainted.length, 0),
  settingsHidden: (j) => j.walks.filter((w) => w.pane === 'settings')
    .reduce((a, w) => a + w.hiddenPainted.length, 0),
  settingsLabels: (j) => j.walks.filter((w) => w.pane === 'settings')
    .reduce((a, w) => a + w.mismatched.length, 0),
  settingsUnreachable: (j) => over(j, 'settings', (r) => r.reduce((a, w) => a + w.unreachable.length, 0)),
  evalsUnreachable: (j) => over(j, 'evals', (r) => r.reduce((a, w) => a + w.unreachable.length, 0)),
  jobsReverse: (j) => over(j, 'jobs', (r) => r.every((w) => w.reverseMatches === true)),
  /* The DETERMINISTIC observable of the terminal-sentinel exclusion: how
     many Shift+Tab presses the reverse walk makes. reverseMatches is NOT
     deterministic enough to score this mutation, because whether the
     off-by-one surfaces depends on the terminal shape and the terminal
     shape is timing-dependent -- see M9b. The press count is not: six
     unmutated observations across both terminal shapes all read 3. */
  jobsRevPresses: (j) => over(j, 'jobs', (r) => r.reduce((a, w) => a + (w.reverseGot || []).length, 0)),
  settingsSkipFirst: (j) => over(j, 'settings', (r) => r.every((w) => w.skip.firstIsSkip)),
  settingsSkipLands: (j) => over(j, 'settings', (r) => r.every((w) => w.skip.afterSkip && w.skip.afterSkip.path === 'main#content')),
  settingsRerender: (j) => over(j, 'settings', (r) => r.every((w) => w.rerender.kept)),
  settingsReverse: (j) => over(j, 'settings', (r) => r.every((w) => w.reverseMatches === true)),
  evalsReverse: (j) => over(j, 'evals', (r) => r.every((w) => w.reverseMatches === true)),
  /* B1: a scroller declared tabindex="-1" is NOT declared focusable -- that
     is the #10822 shape, focusable by script and not by Tab. */
  settingsUndeclared: (j) => over(j, 'settings', (r) => r.reduce((a, w) => a + w.undeclaredScrollers.length, 0)),
  /* B2: the headline count and the list under it, read as one pair. A key
     that collapses siblings shrinks BOTH numbers, so the pair is what the
     row scores. */
  settingsScrollerPaths: (j) => over(j, 'settings', (r) => JSON.stringify(
    [...new Set(r.flatMap((w) => w.scrollers.map((x) => x.path)))].length + '/' +
    r.reduce((a, w) => a + w.scrollers.length, 0))),
  settingsLabelledby: (j) => over(j, 'settings', (r) => r.reduce((a, w) => a + w.labelledby.length, 0)),
  historyScrollersReached: (j) => over(j, 'history', (r) => r.every((w) => w.undeclaredScrollers.every((x) => x.reachedByWalk))),
  /* Asserts the mutated file is one the page under test actually loads.
     Without this, a payload in an unloaded file is indistinguishable from a
     payload that was survived. */
  dlgOpens: (j) => over(j, 'settings', (r) => r.every((w) => w.loaded.some((n) => n.endsWith('/operate.js')))),
  dlgEnter: (j) => (j.dialogs.length ? j.dialogs.every((d) => d.focusEntered === true) : 'VACUOUS'),
  dlgForward: (j) => (j.dialogs.length ? j.dialogs.every((d) => d.heldForward === true) : 'VACUOUS'),
  dlgBackward: (j) => (j.dialogs.length ? j.dialogs.every((d) => d.heldBackward === true && d.wrapCorrect === true) : 'VACUOUS'),
  dlgEscape: (j) => (j.dialogs.length ? j.dialogs.every((d) => d.closedByEscape === true) : 'VACUOUS'),
  dlgRestore: (j) => (j.dialogs.length ? j.dialogs.every((d) => d.focusRestored === true) : 'VACUOUS')
};

/* kind: 'mutation' | 'identity-control' | 'tolerance-control'
   expect: 'kill' (signal must move) | 'survive' (signal must not move)
   scope: which panes to walk, so one payload costs 35s and not 5 minutes. */
const EXPERIMENTS = [
  { id: 'C0', kind: 'identity-control', expect: 'survive', file: TOOL, anchor: null, payload: null,
    scope: 'settings,history,evals', signal: 'settingsSkipFirst',
    what: 'No edit, before the battery. Establishes every baseline.' },

  /* --- the three findings the audit publishes ------------------------- */
  { id: 'M1', kind: 'mutation', expect: 'kill', scope: 'history', vp: '375px', signal: 'historyScrollers',
    file: 'ops/assets/pane-run-history-v2.js',
    anchor: "      var wrap = h('div', { className: 'tbl-wrap' });",
    payload: "      var wrap = h('div', { className: 'tbl-wrap', tabindex: '0', role: 'region' });",
    what: 'Run history\'s sideways-scrolling table is given the declaration every other pane\'s already has. The finding must stop being reported, or it was never about the declaration.' },

  { id: 'M2', kind: 'mutation', expect: 'kill', scope: 'evals', signal: 'evalsHidden',
    file: 'ops/assets/pane-evaluations-v2.css',
    anchor: '.evidence-authority {\n  border: 1px dashed var(--line-2);',
    payload: '.evidence-authority[hidden] { display: none; }\n.evidence-authority {\n  border: 1px dashed var(--line-2);',
    what: 'The stylesheet stops defeating the hidden attribute. The fieldset disappears and the finding with it.' },

  { id: 'M3', kind: 'mutation', expect: 'kill', scope: 'evals', signal: 'evalsHidden',
    file: 'ops/assets/pane-evaluations.js',
    anchor: "      productionFields.hidden = !production;",
    payload: "      productionFields.hidden = false;",
    what: 'The other end of the same defect: the code stops asking for it to be hidden. Painted and not claimed hidden is not a finding.' },

  { id: 'M4', kind: 'mutation', expect: 'kill', scope: 'settings', signal: 'settingsHidden',
    file: 'ops/assets/settings.js',
    anchor: '        more.hidden = !record.more;', payload: '        more.hidden = false;',
    what: 'Settings stops marking its Load more button hidden. A button nobody claims is hidden is just a button, so the finding must disappear.' },

  { id: 'M4b', kind: 'mutation', expect: 'kill', scope: 'settings', signal: 'settingsHidden',
    file: 'ops/assets/aria.css',
    anchor: '.btn {\n  display: inline-flex; align-items: center; gap: 6px;',
    payload: '.btn[hidden] { display: none; }\n.btn {\n  display: inline-flex; align-items: center; gap: 6px;',
    what: 'The other end of the same defect: the stylesheet stops defeating the hidden attribute. .btn[hidden] outweighs .btn, the button is no longer painted, and the finding goes.' },

  /* --- the instrument's own rules -------------------------------------- */
  { id: 'M5', kind: 'mutation', expect: 'kill', scope: 'settings', signal: 'settingsLabels', file: TOOL,
    anchor: "      .filter((d) => d.text && !d.ariaLabel.toLowerCase().includes(d.text.toLowerCase())),",
    payload: "      .filter((d) => d.text && d.ariaLabel.toLowerCase() !== d.text.toLowerCase()),",
    what: 'Label in Name reverts from containment to equality, the rule the first version used. Settings\' three correct Revoke buttons are condemned again.' },

  { id: 'M6', kind: 'mutation', expect: 'kill', scope: 'settings', signal: 'settingsLabels', file: TOOL,
    anchor: "      .filter((el) => visible(el) && el.matches(CONTROLS))\n      .map((el) => ({ ...describe(el),\n        ariaLabel: el.getAttribute('aria-label').trim(),\n        text: Array.from(el.childNodes).filter((n) => n.nodeType === 3)\n          .map((n) => n.textContent).join(' ').replace(/\\\\s+/g, ' ').trim() }))",
    payload: "      .filter(visible)\n      .map((el) => ({ ...describe(el),\n        ariaLabel: el.getAttribute('aria-label').trim(),\n        text: (el.textContent || '').replace(/\\\\s+/g, ' ').trim() }))",
    what: 'The visible label reverts to textContent over every labelled element, so a labelled region is charged with its own CONTENTS. nav#rail is accused of being mislabelled against the entire rail.' },

  { id: 'M6a', kind: 'redundancy-probe', expect: 'survive', scope: 'settings', signal: 'settingsLabels', file: TOOL,
    anchor: "    mismatchedLabels: () => Array.from(document.querySelectorAll('[aria-label]'))\n      .filter((el) => visible(el) && el.matches(CONTROLS))",
    payload: "    mismatchedLabels: () => Array.from(document.querySelectorAll('[aria-label]'))\n      .filter(visible)",
    what: 'HALF of M6: regions are admitted again but the label is still read from own text nodes. Published BECAUSE it survives -- a region has no direct text of its own, so this half alone changes nothing on today\'s pages. Neither half of M6 is individually load-bearing; together they are. An instrument whose two guards are each redundant is one page away from having neither.' },

  { id: 'M6b', kind: 'redundancy-probe', expect: 'survive', scope: 'settings', signal: 'settingsLabels', file: TOOL,
    anchor: "        text: Array.from(el.childNodes).filter((n) => n.nodeType === 3)\n          .map((n) => n.textContent).join(' ').replace(/\\\\s+/g, ' ').trim() }))",
    payload: "        text: (el.textContent || '').replace(/\\\\s+/g, ' ').trim() }))",
    what: 'The OTHER half of M6: textContent is read again but only from controls. Also survives, because the three Revoke buttons have no element children and their textContent equals their own text nodes. Pairs with M6a to show the redundancy runs both ways.' },

  { id: 'M7', kind: 'mutation', expect: 'kill', scope: 'evals', signal: 'evalsUnreachable', file: TOOL,
    anchor: "      .filter((el) => visible(el) && !window.__kbd.disabled(el)).map(describe),",
    payload: "      .filter((el) => visible(el)).map(describe),",
    what: 'Disabled controls are counted as reachability candidates again. The browser is right to skip them and the page gets the blame.' },

  { id: 'M8', kind: 'mutation', expect: 'kill', scope: 'settings', signal: 'settingsSkipFirst', file: TOOL,
    anchor: "async function resetFocus(url, viewport) {\n  await load(url, viewport);\n  await helpers();\n}",
    payload: "async function resetFocus(url, viewport) {\n  if (resetFocus.at !== url + viewport.name) {\n    resetFocus.at = url + viewport.name;\n    await load(url, viewport);\n    await helpers();\n    return;\n  }\n  await evalJson('JSON.stringify(!!(document.activeElement && (document.activeElement.blur() || 1)))');\n}",
    what: 'Focus reset reverts to what the first version did: load the page once, then blur() between phases. blur() moves activeElement to body but leaves the sequential-navigation starting point mid-page, so the second phase starts somewhere other than the top and the skip link stops being stop 0. The load is KEPT, because a payload that also removed it would walk a blank page and score VACUOUS rather than wrong.' },

  { id: 'M9', kind: 'mutation', expect: 'kill', scope: 'jobs', vp: '375px', signal: 'jobsRevPresses', file: TOOL,
    anchor: "    const core = stops.filter((s, i) => !(i === stops.length - 1 &&\n      (s.key === 'DOCUMENT' || (stops.length > 2 && s.key === stops[0].key))));\n    const fwd = Math.min(core.length, 12);",
    payload: "    const core = stops;\n    const fwd = Math.min(core.length, 12);",
    what: 'The terminal sentinel is counted as a stop again, so the forward walk presses Tab one more time than there are stops and the reverse walk makes one press too many. Scored on the press count, which moved 3 -> 4: on any pane with more than 12 stops the min(n,12) window caps both sides and the off-by-one is invisible, which is why the first attempt at this row scored settings/desktop and survived.' },

  { id: 'M9b', kind: 'asymmetry-probe', expect: 'survive', scope: 'jobs', vp: '375px', signal: 'jobsReverse', file: TOOL,
    anchor: "    const core = stops.filter((s, i) => !(i === stops.length - 1 &&\n      (s.key === 'DOCUMENT' || (stops.length > 2 && s.key === stops[0].key))));\n    const fwd = Math.min(core.length, 12);",
    payload: "    const core = stops;\n    const fwd = Math.min(core.length, 12);",
    what: 'The SAME payload as M9, scored on reverseMatches instead of the press count, PUBLISHED BECAUSE IT SURVIVES. When the forward walk ends by wrapping, the extra Tab lands on stop 0 and the first Shift+Tab wraps back to the last control, so the off-by-one is common-mode and cancels; reverseMatches stays true. It only surfaces as a mismatch when focus LEAVES the document. Which of those two shapes a walk ends in is timing-dependent -- the same pane and viewport was measured as wrapped in four runs and left-document in two -- so reverseMatches cannot score this payload deterministically, and a row that scored it would be a coin flip with a decimal point. This is why M9 scores the press count.' },

  { id: 'M10', kind: 'mutation', expect: 'kill', scope: 'settings', signal: 'settingsSkipLands',
    file: 'ops/assets/shell-pane-v2.js',
    anchor: "id: 'content'", payload: "id: 'kontent'",
    what: 'The skip link\'s target loses the id it points at. Pressing Enter on Skip to content must stop landing on main#content.' },

  /* --- the dialog, four properties, four ways to break it -------------- */
  { id: 'M11', kind: 'mutation', expect: 'kill', scope: 'settings', signal: 'dlgForward',
    file: 'ops/assets/settings.js',
    anchor: "      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }\n      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }",
    payload: "      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }",
    what: 'The forward half of the trap is removed. Tab off the last control must escape the dialog.' },

  { id: 'M12', kind: 'mutation', expect: 'kill', scope: 'settings', signal: 'dlgBackward',
    file: 'ops/assets/settings.js',
    anchor: "      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }\n      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }",
    payload: "      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }",
    what: 'The backward half is removed instead. Shift+Tab off the first control must escape. Pairs with M11 and proves the two halves are measured separately rather than one standing in for both.' },

  { id: 'M13', kind: 'mutation', expect: 'kill', scope: 'settings', signal: 'dlgRestore',
    file: 'ops/assets/settings.js',
    anchor: "      if (previous && previous.isConnected && previous.focus) {\n        previous.focus();",
    payload: "      if (false && previous && previous.isConnected && previous.focus) {\n        previous.focus();",
    what: 'Focus is no longer returned to the control that opened the dialog. This is the common shape: focus held in, then dropped on the floor at close.' },

  { id: 'M14', kind: 'mutation', expect: 'kill', scope: 'settings', signal: 'dlgEscape',
    file: 'ops/assets/settings.js',
    anchor: "      if (e.key === 'Escape') { e.preventDefault(); close(); return; }",
    payload: "      if (e.key === 'NoSuchKey') { e.preventDefault(); close(); return; }",
    what: 'Escape stops closing the dialog. An operator who opened it by accident is stuck in it.' },

  { id: 'M15', kind: 'mutation', expect: 'kill', scope: 'settings', signal: 'dlgEnter',
    file: 'ops/assets/settings.js',
    anchor: "    reason.focus();\n  }", payload: "    void reason;\n  }",
    what: 'Focus never enters the dialog when it opens, so the operator is reading a modal their keyboard is not in.' },

  { id: 'M16', kind: 'precondition-probe', expect: 'survive', scope: 'settings', signal: 'dlgOpens',
    file: 'ops/assets/operate.js',
    anchor: "    target.focus();", payload: "    void target;",
    what: 'THE ROW THAT FAILED TO FAIL AND WAS WORTH MORE THAN THE FOUR THAT PASSED. Five payloads went into operate.js first, every one landed by byte comparison, and every one scored survive: ops/settings.html has never loaded operate.js, because ops/assets/settings.js carries its own confirmAction. A byte comparison proves the edit LANDED, not that the edited code RUNS. Kept, pointed at the same line, and now scored on a signal that asserts settings loaded the file -- so it fails for the true reason instead of looking like a working trap.' },

  /* --- tolerance controls: real edits the instrument must be blind to -- */
  { id: 'T1', kind: 'tolerance-control', expect: 'survive', scope: 'settings', signal: 'settingsLabels',
    file: TOOL, anchor: ' * WHAT IT MEASURES.', payload: ' * WHAT THIS TOOL MEASURES.',
    what: 'A real edit to prose. The numbers must not move, or the battery is scoring noise.' },

  { id: 'T2', kind: 'tolerance-control', expect: 'survive', scope: 'settings', signal: 'settingsHidden',
    file: 'ops/assets/settings.js',
    anchor: "        'aria-label': 'Revoke access for ' + admin.email",
    payload: "        'aria-label': 'Revoke  access for ' + admin.email",
    what: 'A double space inside an accessible name. Whitespace is collapsed before comparison, so containment still holds and the hidden-button count is untouched.' },

  { id: 'T3', kind: 'tolerance-control', expect: 'survive', scope: 'settings', signal: 'settingsHidden',
    file: 'ops/assets/settings.js',
    anchor: "        more.hidden = !record.more;", payload: "        more.hidden = !record.more ;",
    what: 'A whitespace-only edit to the very line M4 mutates, scored on the very signal M4 moves. Same line, same file, same signal, no behavioural change: proves M4\'s kill came from its semantics and not from touching that region.' },

  /* --- the filed-issue reconciliation, the newest claim in this file ----- */
  { id: 'M17', kind: 'mutation', expect: 'kill', scope: '*', vp: '*', signal: '__exit',
    file: 'ops/assets/pane-run-history-v2.js',
    anchor: "      var wrap = h('div', { className: 'tbl-wrap' });",
    payload: "      var wrap = h('div', { className: 'tbl-wrap', tabindex: '0', role: 'region' });",
    what: 'The REAL scenario the reconciliation exists for: somebody fixes the scroll container, so the full sweep produces no undeclared-scroller finding, and the document would otherwise keep citing Stadiora/Aria#10868 for a defect that is gone. The tool must refuse to write the document rather than publish a stale issue reference. Scored on the tool\'s exit, over a FULL sweep, because that is how the check is gated.' },

  { id: 'M17b', kind: 'tolerance-control', expect: 'survive', scope: 'settings', signal: '__exit',
    file: 'ops/assets/pane-run-history-v2.js',
    anchor: "      var wrap = h('div', { className: 'tbl-wrap' });",
    payload: "      var wrap = h('div', { className: 'tbl-wrap', tabindex: '0', role: 'region' });",
    what: 'The same payload on a SCOPED run, which never walks history at 375px. The reconciliation must NOT fire: on a scoped run "the finding did not reproduce" means "you did not look", and the first version of this check could not tell those apart and refused on every KBD_ONLY run. Proves the narrowing, not just the throw.' },

  /* --- the five blocking findings of round 1, each scored --------------- */
  { id: 'M18', kind: 'mutation', expect: 'kill', scope: 'settings', vp: '375px',
    signal: 'settingsUndeclared', file: 'ops/assets/settings.js',
    anchor: "      className: 'tbl-wrap', tabindex: '0', role: 'region', 'aria-label': label",
    payload: "      className: 'tbl-wrap', tabindex: '-1', role: 'region', 'aria-label': label",
    what: 'B1. The #10822 shape exactly: a scroll container declared tabindex="-1" is focusable by script and NOT by Tab, which is the defect, not the fix. The first version of undeclaredScrollers tested `tabindex === null`, so this payload read as DECLARED and the audit printed 0 undeclared scrollers while three of settings\' tables had left the tab order. Now it reports all three, each carrying the reason.' },

  { id: 'T4', kind: 'tolerance-control', expect: 'survive', scope: 'settings', vp: '375px',
    signal: 'settingsUndeclared', file: 'ops/assets/settings.js',
    anchor: "      className: 'tbl-wrap', tabindex: '0', role: 'region', 'aria-label': label",
    payload: "      className: 'tbl-wrap',  tabindex: '0', role: 'region', 'aria-label': label",
    what: 'The same line M18 mutates, whitespace only, scored on the same signal: proves M18\'s kill came from the tabindex VALUE and not from touching that line.' },

  { id: 'M19', kind: 'mutation', expect: 'kill', scope: 'history,settings', vp: '375px',
    signal: 'docDeclaredScrollers', file: TOOL,
    anchor: "    w, x, key: `${w.pane}|${x.path}#${xs.filter((y, j) => y.path === x.path && j < i).length}`",
    payload: "    w, x, key: `${w.pane}|${x.path}`",
    what: 'B2. `pathOf()` stops at five ancestors and two classes, so settings\' three tbl-wrap boxes -- three tables, three labels -- produce one byte-identical path. Keying on the path alone collapses them, and the DOCUMENT is where that surfaces: the shipped run held 5 declared scroll containers in its record and published 3. The ordinal makes siblings distinct. Scored on the published sentence rather than the record, because the record never moved.' },

  { id: 'M20', kind: 'mutation', expect: 'kill', scope: 'evals', vp: 'desktop',
    signal: 'evalsReverse', file: 'ops/assets/pane-evaluations.js',
    anchor: "  shell.definePane('evals', render);",
    payload: "  document.addEventListener('keydown', function (e) {\n    if (!e.shiftKey || e.key !== 'Tab') return;\n    var f = Array.prototype.slice.call(document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]'));\n    var i = f.indexOf(document.activeElement);\n    if (i === 20 && f[0]) { e.preventDefault(); f[0].focus(); }\n  });\n  shell.definePane('evals', render);",
    what: 'B3a. A reverse-order defect planted at the 21st focusable element, well past the 12-press window the retrace check used to stop at. Under that window this survived and the document still said "Shift+Tab is the exact inverse of Tab on 20 of 20 walks". Evals/desktop has 46 stops; the 11 presses covered the skip link, the ten rail items and the theme toggle, which are identical on all ten panes and none of them pane content.' },

  { id: 'M20b', kind: 'mutation', expect: 'kill', scope: 'evals', vp: 'desktop',
    signal: 'evalsReverse', file: TOOL,
    anchor: "    const fwdLeg = await stepStops(fwd, () => key('Tab'));",
    payload: "    for (let i = 0; i < fwd; i++) await key('Tab');",
    what: 'The retrace\'s forward leg reverts to one press per stop. A composite input eats several presses without moving activeElement -- that is what pressesConsumed counts in the forward walk -- so the leg lands short and the comparison goes out of step. It landed THIRTEEN stops short on evals/desktop. Both legs step through stepStops now, so a mismatch means the ORDER disagreed and not the press accounting.' },

  { id: 'M21', kind: 'mutation', expect: 'kill', scope: '*', vp: '*', signal: '__exit',
    file: 'ops/assets/shell-pane-v2.js',
    anchor: "(function (global) {",
    payload: "throw new Error('boot-failed');\n(function (global) {",
    what: 'B3b. What a failed session gate or a syntax error looks like: the pane never mounts, the walk finds one stop and zero candidates, and EVERY predicate over that empty sample is free. The document read "0 unreachable, 0 traps, exact inverse on 1 of 1". `\'\' === \'\'` is true, so even the retrace passed. The tool must refuse to publish rather than publish a vacuous clean sheet.' },

  { id: 'M22', kind: 'mutation', expect: 'kill', scope: '*', vp: '*', signal: '__exit',
    file: TOOL,
    anchor: "for (const { w, x, key } of list(R, (w) => w.undeclaredScrollers)) {",
    payload: "for (const { w, x, key } of list(d, (w) => w.undeclaredScrollers)) {",
    what: 'B4. The two-population defect, restored: the headline counted findings over all twenty walks and the list enumerated the ten desktop ones. The only undeclared scroller in this dashboard is at 375px, so it was counted, never named, never given an issue number, and the run still exited 0. Both numbers come from one array now, and the filed-issue reconciliation refuses when the kind it cites is not in it.' },

  { id: 'M22b', kind: 'tolerance-control', expect: 'survive', scope: 'settings', vp: 'desktop',
    signal: '__exit', file: TOOL,
    anchor: "for (const { w, x, key } of list(R, (w) => w.undeclaredScrollers)) {",
    payload: "for (const { w, x, key } of list(d, (w) => w.undeclaredScrollers)) {",
    what: 'The same payload on a SCOPED run must NOT refuse: on a scoped run "the finding did not reproduce" means "you did not look". Proves the refusal is gated on a full sweep and not on the payload.' },

  { id: 'C1', kind: 'identity-control', expect: 'survive', file: TOOL, anchor: null, payload: null,
    scope: 'settings,history,evals', signal: 'settingsSkipFirst',
    what: 'No edit, after every mutation. A moved signal here means the tree was left contaminated.' }
];

function lineOf(text, anchor) {
  const at = text.indexOf(anchor);
  return at === -1 ? null : text.slice(0, at).split('\n').length;
}

/* A row that scores the tool's REFUSAL has to run the tool the way the
   refusal is gated: the filed-issue reconciliation only fires on a full
   sweep, so `*` means "no KBD_ONLY / no KBD_VIEWPORT at all" rather than a
   pane named star. Setting them empty is not the same as not setting them. */
function fullEnv(scope, vp) {
  const env = { ...process.env, KBD_JSON: OUTJSON };
  delete env.KBD_ONLY; delete env.KBD_VIEWPORT;
  if (scope !== '*') env.KBD_ONLY = scope;
  if (vp !== '*') env.KBD_VIEWPORT = vp;
  return env;
}

/* The tool's EXIT is itself a signal for rows about refusals. It is measured
   on the baseline run like every other signal, never typed: a baseline that
   asserts "unmutated exits 0" instead of measuring it is an expectation
   derived from the thing under test. */
/* READ THE THROWN MESSAGE, NOT THE SOURCE LINE THE STACK ECHOES. The first
   version of this matched /FILED names .../ anywhere in stderr and caught the
   trace's echo of the template literal instead of its VALUE, so the published
   row read "FILED names ${k} (${FILED[k]})" -- a row that looks like a bug in
   the code it is proving. And the tail must be long enough to contain the
   `Error:` line at all: at 400 characters the stack pushed it out of the
   window and the extraction found nothing. */
const exitSignal = (code, err) => (code === 0
  ? 'exit 0'
  : `refused: ${(/^Error: (.+)$/m.exec(err || '') || [null, `no Error line, code ${code}`])[1]}`);

/* THE DOCUMENT FROM THE LAST RUN IS NOT THIS RUN'S DOCUMENT EITHER. The JSON
   is deleted before every run for exactly this reason and the markdown needs
   the same treatment: a refusal leaves the previous run's file in place, and
   a stale artefact and a fresh one are the same bytes. */
const DOCPATH = path.join(WT, 'ops', 'keyboard-audit.md');
const withDoc = (j) => {
  try { j.__doc = fs.readFileSync(DOCPATH, 'utf8'); } catch { j.__doc = null; }
  return j;
};

function runWalk(scope, vp) {
  /* THE FILE FROM THE LAST RUN IS NOT THIS RUN'S RESULT. A crashed walk left
     the previous experiment's JSON on disk and the catch below read it, so
     M8 was scored against a walk of a different pane at a different width --
     evals rows answering a question about settings. A stale artefact and a
     fresh one are the same bytes until you delete the stale one. */
  try { fs.unlinkSync(OUTJSON); } catch { /* absent is the goal */ }
  try { fs.unlinkSync(DOCPATH); } catch { /* absent is the goal */ }
  try {
    execFileSync('node', [TOOL], {
      cwd: WT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000,
      env: fullEnv(scope, vp)
    });
    return { code: 0, json: withDoc(JSON.parse(fs.readFileSync(OUTJSON, 'utf8'))) };
  } catch (e) {
    let json = null;
    try { json = withDoc(JSON.parse(fs.readFileSync(OUTJSON, 'utf8'))); } catch { /* none */ }
    return { code: e.status === undefined ? -1 : e.status, json, err: String(e.stderr || e.message).slice(-8000) };
  }
}

/* A BASELINE MEASURED UNDER DIFFERENT CONDITIONS IS NOT A BASELINE. M1's
   finding exists only at 375px, and it was being compared against a desktop
   C0 where the table is not clipped and the count is 0 by construction: a
   payload that could never move its signal, scored as if it had failed to.
   One baseline pass per distinct scope-and-viewport the experiments use. */
const baseline = new Map();
const bkey = (sig, e) => `${sig}@${e.scope || 'settings'}@${e.vp || 'desktop'}`;
const conditions = [...new Map(EXPERIMENTS.map((e) =>
  [`${e.scope || 'settings'}@${e.vp || 'desktop'}`, e])).values()];
for (const c of conditions) {
  const { json, code, err } = runWalk(c.scope || 'settings', c.vp || 'desktop');
  if (!json) throw new Error(`baseline run for ${c.scope}@${c.vp} produced no record: ` +
    `code=${code} ${(err || '').slice(-1200)}`);
  for (const [k, fn] of Object.entries(S)) {
    let v; try { v = fn(json); } catch { v = 'n/a'; }
    baseline.set(`${k}@${c.scope || 'settings'}@${c.vp || 'desktop'}`, v);
  }
  baseline.set(`__exit@${c.scope || 'settings'}@${c.vp || 'desktop'}`, exitSignal(code, err));
  process.stderr.write(`baseline ${c.scope || 'settings'}@${c.vp || 'desktop'} recorded\n`);
}

const rows = [];

/* ONE PAYLOAD IS THE COMMON CASE, NOT THE ONLY ONE. Some defects are two
   edits -- B2's key collision needs the dedupe key reverted AND the thing
   that made the siblings distinguishable removed -- and a row that applied
   only half of a defect would publish a kill for a mutation that was never
   fully injected. `edits` is the general form; `file`/`anchor`/`payload`
   stays as sugar for a single edit and normalises into it here. */
const editsOf = (e) => (e.edits ? e.edits
  : (e.anchor === null ? [] : [{ file: e.file, anchor: e.anchor, payload: e.payload }]));

for (const e of EXPERIMENTS) {
  const edits = editsOf(e);
  const files = [...new Set(edits.map((x) => x.file))];
  const lines = [];
  let delta = 0;
  let invalid = null;

  if (!edits.length) {
    /* An identity control edits nothing, and "nothing" has to be checked
       rather than assumed: the whole tree is compared, not just one file. */
    for (const [fl, buf] of PRE) {
      if (!fs.readFileSync(path.join(WT, fl)).equals(buf)) {
        throw new Error(`${e.id}: identity control found ${fl} already changed`);
      }
    }
  }

  for (const ed of edits) {
    const before = fs.readFileSync(path.join(WT, ed.file));
    const text = before.toString('utf8');
    const at = text.indexOf(ed.anchor);
    if (at === -1) throw new Error(`${e.id}: anchor not present in ${ed.file}`);
    if (text.indexOf(ed.anchor, at + 1) !== -1) throw new Error(`${e.id}: anchor is not unique in ${ed.file}`);
    lines.push(lineOf(text, ed.anchor));
    fs.writeFileSync(path.join(WT, ed.file), text.slice(0, at) + ed.payload + text.slice(at + ed.anchor.length));
    const after = fs.readFileSync(path.join(WT, ed.file));
    delta += after.length - before.length;
    /* THE THING THAT CATCHES A MUTATION WHICH DID NOT LAND IS A BYTE
       COMPARISON, NOT A SUCCESSFUL REGEX. A pure deletion has a non-zero
       delta; a same-length substitution has a zero one and still changed the
       bytes, so both are checked rather than one standing in for the other.
       `includes('')` is trivially true, which is why the empty payload is
       excluded from the second check rather than silently passing it. */
    if (after.equals(before)) throw new Error(`${e.id}: payload did not change ${ed.file}'s bytes`);
    if (ed.payload !== '' && !after.toString('utf8').includes(ed.payload)) {
      throw new Error(`${e.id}: payload text is not present in ${ed.file} after the write`);
    }
    if (ed.file.endsWith('.mjs') || ed.file.endsWith('.js')) {
      try { execFileSync('node', ['--check', ed.file], { cwd: WT, stdio: 'ignore' }); } catch {
        invalid = `${ed.file} did not parse`;
      }
    }
  }

  if (invalid) {
    rows.push({ ...e, edits, files, lines, delta, verdict: 'INVALID', got: invalid, base: null });
    restoreAll();
    continue;
  }

  /* Every signal is read on every run so the identity controls check ALL of
     them, not just the one their row names. */
  const { code, json, err } = runWalk(e.scope || 'settings', e.vp || 'desktop');
  const read = {};
  if (json) for (const [k, fn] of Object.entries(S)) { try { read[k] = fn(json); } catch { read[k] = 'n/a'; } }

  read.__exit = exitSignal(code, err);
  const got = e.signal === '__exit' ? read.__exit
    : (json ? read[e.signal] : `crashed(${code}) ${(err || '').slice(-300)}`);
  const base = baseline.get(bkey(e.signal, e));
  const moved = JSON.stringify(got) !== JSON.stringify(base);
  let verdict = (e.expect === 'kill') === moved ? 'as expected' : 'UNEXPECTED';

  /* A SIGNAL WITH NO SAMPLE IS NOT A KILL. "VACUOUS" differs from `true`, so
     a walk that crashed and reported nothing would otherwise score exactly
     like a mutation that broke the behaviour -- an empty subject printing as
     a passing verdict. Neither is a result. */
  if (got === 'VACUOUS' || base === 'VACUOUS' || (!json && e.signal !== '__exit')) verdict = 'INVALID';

  /* An identity control must hold EVERY signal, not the one it names. */
  let drift = [];
  if (e.kind === 'identity-control' && json) {
    drift = Object.keys(read).filter((k) =>
      JSON.stringify(read[k]) !== JSON.stringify(baseline.get(bkey(k, e))));
    if (drift.length) verdict = 'UNEXPECTED';
  }

  rows.push({ ...e, edits, files, lines, delta, verdict, got, base, moved, drift, allSignals: read });
  process.stderr.write(`${e.id} ${e.kind} delta=${delta} ${e.signal}: ${JSON.stringify(base)} -> ` +
    `${JSON.stringify(got)} moved=${moved} ${verdict}${drift.length ? ' drift=' + drift.join(',') : ''}\n`);

  restoreAll();
  for (const fl of files) {
    const back = fs.readFileSync(path.join(WT, fl));
    if (!back.equals(PRE.get(fl))) throw new Error(`${e.id}: restore of ${fl} failed byte comparison`);
  }
}

/* Re-resolve every published anchor against the RESTORED tree. A row that
   names a line the restored file does not carry is a row written about a
   different experiment than the one that ran. */
const out = [];
const cell = (s) => '`' + s.split('\n')[0].trim().slice(0, 60).replace(/\|/g, '\\|') + '`' +
  (s.includes('\n') ? ` +${s.split('\n').length - 1}L` : '');
out.push('| # | kind | file | anchor (line, restored tree) | payload | signal | baseline -> got | verdict |');
out.push('|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const anchors = [];
  const pays = [];
  r.edits.forEach((ed, i) => {
    const text = fs.readFileSync(path.join(WT, ed.file), 'utf8');
    const at = text.indexOf(ed.anchor);
    if (at === -1) throw new Error(`${r.id}: anchor ${i} absent from restored tree; the table would be lying`);
    const nowLine = text.slice(0, at).split('\n').length;
    if (nowLine !== r.lines[i]) {
      throw new Error(`${r.id}: anchor ${i} moved ${r.lines[i]} -> ${nowLine}; table would be lying`);
    }
    anchors.push(cell(ed.anchor) + ` — L${r.lines[i]}`);
    pays.push(ed.payload === '' ? '_(deleted)_' : cell(ed.payload));
  });
  out.push(`| ${r.id} | ${r.kind} | ${r.files.map((x) => '`' + x + '`').join('<br>') || '—'} | ` +
    `${anchors.join('<br>') || 'no edit'} | ${pays.join('<br>') || '—'} | \`${r.signal}\` | ` +
    `${JSON.stringify(r.base)} → ${JSON.stringify(r.got)} | ${r.verdict} |`);
}
out.push('');
out.push('**What each experiment did**');
out.push('');
for (const r of rows) out.push(`- **${r.id}** (Δ${r.delta} bytes) — ${r.what}`);

const unexpected = rows.filter((r) => r.verdict !== 'as expected');
out.push('');
out.push(`**${rows.length} experiments, ${rows.length - unexpected.length} as expected, ${unexpected.length} not.**`);
fs.writeFileSync(path.join(OUTDIR, 'keyboard-battery.md'), out.join('\n') + '\n');
fs.writeFileSync(path.join(OUTDIR, 'keyboard-battery.json'), JSON.stringify(rows, null, 2));
process.stderr.write(`\n${rows.length} experiments, ${unexpected.length} unexpected\n`);
