/* Mutation battery for `scripts/ops-meter-severity.test.mjs`.
 *
 * The table below is GENERATED FROM THE EXECUTED RUN, never written from
 * memory. Each row records the file, the anchor derived from the first
 * differing byte with its original gating, the payload, the exit status and
 * the failing assertion's own words. A published row therefore cannot
 * disagree with its experiment, because it IS its experiment.
 *
 * Three things this shape has already caught in this repository:
 *
 *  - A mutation that SILENTLY FAILED TO APPLY. A payload that does not land
 *    and a payload that lands and is killed look identical from outside:
 *    both end with a green tree and a red-then-green suite. Application is
 *    proved by CONTENT here, because another agent found one with a byte
 *    delta of +0B.
 *  - A CRASH scored as a kill, which certifies nothing. CONTROL-0 came back
 *    red on an unmutated tree once because a bad RUNNER_TEMP killed the test
 *    in mkdtempSync before it asserted anything; every mutation would then
 *    have scored RED for that reason. `runSuite` reads the runner's own fail
 *    count and refuses to call a crash a kill.
 *  - A guard that reds at everything is not bounded. CONTROL-1 edits this
 *    file's own stylesheet somewhere the sweep has no business noticing.
 *
 * CONTROL-2 is the row worth reading twice. It gives `.meter.vio` the SAME
 * hue as `.meter.bad` -- a total collision in the channel #10825 is about --
 * and the suite must stay GREEN, because severity no longer depends on hue.
 * A control that proves the claim rather than the instrument.
 *
 * Restores come from byte-compared sidecar copies beside the file rather than
 * `git checkout`, so an uncommitted tree is never reverted over. TERM and INT
 * are trapped. Commit before running a battery: SIGKILL cannot be trapped and
 * has left this stylesheet mutated once already.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fs.realpathSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const TARGET = 'scripts/ops-meter-severity.test.mjs';
const CSS = 'ops/assets/aria.css';
const PANE = 'ops/assets/pane-evaluations.js';

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

const OUTDIR = path.join(ROOT, '.probe');
fs.mkdirSync(OUTDIR, { recursive: true });

/* ------------------------------------------------------------ the battery */

/* Each mutation returns the bytes it wants written. `expect` is what the row
   is FOR: KILL means the suite must go red, GREEN means it must not. */
const BATTERY = [
  {
    id: 'CONTROL-0', file: null, expect: 'GREEN',
    why: 'Unmutated tree. If this is not green, nothing below this line means anything.',
    apply: null
  },
  {
    id: 'CONTROL-1', file: CSS, expect: 'GREEN',
    why: 'Halves the hovered table-row tint, two rules above the meter block. This sweep measures notches on a progress bar and has no business noticing; a guard that reds at any edit to the sheet it reads is not bounded to its claim.',
    apply: (s) => replaceOnce(s,
      '.tbl tbody tr:hover { background: color-mix(in srgb, var(--ink) 4%, transparent); }',
      '.tbl tbody tr:hover { background: color-mix(in srgb, var(--ink) 2%, transparent); }')
  },
  {
    id: 'CONTROL-2', file: CSS, expect: 'GREEN',
    why: 'Gives `.meter.vio` the same GLOW hue as `.meter.bad`. Must stay GREEN: `--c` drives the decorative `box-shadow` and nothing that carries meaning, so colliding it is not a severity collision. This row used to collide the whole colour channel, which was the same thing until Stadiora/Aria#10848 split the fill onto `--c-ink`; the anchor it matched no longer exists, and the row ERRORED rather than passing when the split landed -- a control failing loudly at the one moment its premise changed, which is what a control is for. The stronger half of its old statement now lives in T10, where every light tone is flattened to one grey and the three notch claims stay green.',
    apply: (s) => replaceOnce(s, '.meter.vio  { --c: var(--violet);  --c-ink: var(--violet-ink); }',
      '.meter.vio  { --c: var(--rose);  --c-ink: var(--violet-ink); }')
  },
  {
    id: 'T1', file: CSS, expect: 'KILL',
    why: 'Deletes every notch rule -- 49 of the 62 lines this PR adds -- so the four tones differ in `--c` and nothing else, which is the defect Stadiora/Aria#10825 records. It is NOT the pre-PR file: the `@media (forced-colors: active)` block survives this payload, and the tell is in the killed-by column, where `under forced-colors the bar still paints its value` is correctly absent. That half is T5. No single row restores both.',
    apply: (s) => {
      const from = s.indexOf('/* Stadiora/Aria#10825: severity was carried by');
      const to = s.indexOf('.meter.vio  i::before  { right: 12px; border-right-width: 2px; }');
      if (from === -1 || to === -1) throw new Error('notch rule block not found');
      const end = s.indexOf('\n', to) + 1;
      return s.slice(0, from) + s.slice(end);
    }
  },
  {
    id: 'T2', file: CSS, expect: 'KILL',
    why: 'Removes `box-sizing: border-box` from the pseudo-elements, restoring the content-box geometry this fix shipped with for an hour. Every offset moves 4px, landing `vio`s third groove exactly on top of its second so `vio` renders as `bad`. No pane draws a `vio` meter, so only the synthetic-tone arm can see this.',
    apply: (s) => replaceOnce(s, '  box-sizing: border-box;\n', '')
  },
  {
    id: 'T3', file: CSS, expect: 'KILL',
    why: 'Tints the groove with the fill\'s own ink grade until it nearly disappears into it. RE-AIMED: this row used to restore the historical groove colour, `color-mix(var(--c) 30%, var(--bg))`, which measured 2.67:1 against a light-theme `bad` fill -- and that payload now SURVIVES, measuring 4.21:1, because the groove reads `--c` while the fill reads the darker `--c-ink` after Stadiora/Aria#10848 and the two separated. The old payload is kept as T18 and published green on purpose. At 58% the grooves stay above the 1.8:1 detect threshold and land at 2.47:1 to 2.62:1, under SC 1.4.11. The row also reds the two count claims, because 28 of 36 grooves fall under the detector at that mix; the claim it exists for is the contrast one, which names its own numbers in the failure.',
    apply: (s) => replaceOnce(s, '  border: 0 solid var(--bg);',
      '  border: 0 solid color-mix(in srgb, var(--c-ink, var(--cyan-ink)) 58%, var(--bg));')
  },
  {
    id: 'T4', file: CSS, expect: 'KILL',
    why: 'Moves the first groove flush with the fills trailing edge, the placement tried first and discarded after looking at it: at the edge a groove is not a groove, it only makes the bar 2px shorter, and `warn` reads as `ok`.',
    apply: (s) => replaceOnce(s, '.meter.vio  i::after   { right: 4px; border-right-width: 2px; }',
      '.meter.vio  i::after   { right: 0px; border-right-width: 2px; }')
  },
  {
    id: 'T5', file: CSS, expect: 'KILL',
    why: 'Deletes the forced-colors background-color, restoring what was measured before this fix: `background-image` resolves to `none`, `box-shadow` to `none`, and the fills background-color was already transparent, so the bar painted NOTHING and lost its value as well as its band.',
    apply: (s) => replaceOnce(s, '  .meter i { background-color: CanvasText; }\n', '')
  },
  {
    id: 'T6', file: CSS, expect: 'KILL',
    why: 'Leaves the forced-colors fill in place but drops the grooves back to the forced default, so they take the same system colour as the fill and vanish. The value survives; the severity does not.',
    apply: (s) => replaceOnce(s, '  .meter i::after { border-color: Canvas; }', '  .meter i::after { border-color: CanvasText; }')
  },
  {
    id: 'T7', file: CSS, expect: 'KILL',
    why: 'Caps every fill at 10px, below the 14px three grooves occupy. Binds the width floor: a fill too short to hold its own notches under-reports its severity, and an under-count is still a misreport even though it is the safe direction.',
    apply: (s) => replaceOnce(s, '.meter i::before,\n.meter i::after {',
      '.meter i { max-width: 10px; }\n.meter i::before,\n.meter i::after {')
  },
  {
    id: 'T8', file: CSS, expect: 'KILL',
    why: 'Moves the first groove 6px PAST the fills trailing edge for all three toned meters -- warn, bad and vio share this declaration block -- so every tone loses a notch and vio reads as bad. Written to bind a claim about marks on bare track; that claim was withdrawn when this payload measured 1.27:1 there, under the 1.8:1 the scan can resolve. The payload stayed because the geometry fault it injects is caught anyway, by count rather than by position.',
    apply: (s) => replaceOnce(s, '.meter.vio  i::after   { right: 4px; border-right-width: 2px; }',
      '.meter.vio  i::after   { right: -6px; border-right-width: 2px; }')
  },
  {
    id: 'T9', file: PANE, expect: 'KILL',
    why: 'Draws the boards only `.meter.bad` at 4% instead of 74%, which is 6.7px of fill against the 14px two notches occupy -- a severity meter that cannot carry its severity. Raised in independent review as a demonstrated false green: a `visibleFill < 8` skip in the sweep dropped this reading before the width floor judged it, so the guard caught the same defect at 10.1px and was blind to a worse version at 6.7px. The skip is now 1px. This row is that finding, kept as an experiment.',
    apply: (s) => replaceOnce(s, "score: '0.74', pct: 74, tone: 'bad'", "score: '0.74', pct: 4, tone: 'bad'")
  },
  {
    id: 'T10', file: CSS, expect: 'KILL',
    why: 'Flattens every light-theme fill to one flat mid grey. It clears 3:1 against the track (3.81:1) and against the card (4.67:1), so both contrast claims pass -- and all four tones become the same colour. Written when this row REPAIRED Stadiora/Aria#10848 and was killed by the inverted ratchet detecting its own discharge; the ratchet is gone with the issue and the payload now binds claim 9 instead, which is the honest job for it. A repair that satisfies a contrast claim by deleting the hue is exactly the shortcut #10848 invites.',
    apply: (s) => replaceOnce(s, '.meter i {\n  position: absolute;',
      '[data-theme="light"] .meter i { background-image: linear-gradient(90deg, #737373, #737373); box-shadow: none; }\n.meter i {\n  position: absolute;')
  },
  {
    id: 'T11', file: TARGET, expect: 'KILL',
    why: 'Deletes the `scrollIntoView` that puts a meter on screen before it is captured, which is the whole of the fix for Stadiora/Aria#10871. The capture then comes from 3,300-4,400px below a 1000px viewport, exactly as it did before. The defect this restores is not a wrong number, it is a number that is only SOMETIMES wrong -- one uniform capture in fourteen runs -- so the row binds the dependency rather than the symptom. Killed by the `covered` probe reporting `off screen`, which is also why the separate precondition first written into `shoot` was deleted: the probe reaches it first in every case, so no row could ever kill it.',
    apply: (s) => replaceOnce(s, "  el.scrollIntoView({ block: 'center', inline: 'nearest' });\n", '')
  },
  {
    id: 'T12', file: TARGET, expect: 'KILL',
    why: 'Keeps the scroll and drops the document-coordinate conversion, so the clip is built from viewport coordinates. The clip is in DOCUMENT coordinates in both capture modes -- the measurement this whole change rests on -- so this aims every capture at whatever sits ~2,800px higher up the page. It is the half of the fix that is invisible in a reading of the diff, and it would have been a silent miscapture rather than a loud one.',
    apply: (s) => replaceOnce(s,
      'box: { x: t.left + window.scrollX, y: t.top + window.scrollY, width: t.width, height: t.height },',
      'box: { x: t.left, y: t.top, width: t.width, height: t.height },')
  },
  {
    id: 'T13', file: TARGET, expect: 'GREEN',
    why: 'Puts `captureBeyondViewport: true` back while LEAVING the scroll in place, and must stay green. Published as a green on purpose: the flag is not what fixes #10871, being on screen is, and a kill here would mean the guard had keyed itself to the spelling of the fix rather than to its invariant. It is also the honest reading of the probe -- with the scroll in, both modes returned identical pixels.',
    apply: (s) => replaceOnce(s, 'captureBeyondViewport: false, clip }', 'captureBeyondViewport: true, clip }')
  },
  {
    id: 'T14', file: TARGET, expect: 'KILL',
    why: 'Scrolls each meter to the TOP of the viewport rather than its centre, which is where the sticky headers at aria.css:239 and :382 sit. Binds the occlusion check: centring is not decoration, it is what holds the capture clear of the page chrome, and with nothing asserting it the sweep could measure a sticky header and report it as a bar.',
    apply: (s) => replaceOnce(s, "el.scrollIntoView({ block: 'center', inline: 'nearest' });",
      "el.scrollIntoView({ block: 'start', inline: 'nearest' });")
  },
  {
    id: 'T15', file: CSS, expect: 'KILL',
    why: 'THE row for Stadiora/Aria#10848: puts the defect back exactly as it shipped, by routing the fill through `--c` instead of `--c-ink`. This is the mutation the fix exists for, and it is a one-token revert rather than a synthetic payload, so a kill here is the claim binding the real defect and not a caricature of it. Expected to red claim 7 with light-theme readings at 2.27:1 and to leave dark untouched, because the dark block defines each `-ink` as an alias of its base token.',
    apply: (s) => replaceOnce(s,
      'background: linear-gradient(90deg, color-mix(in srgb, var(--c-ink, var(--cyan-ink)) 65%, transparent), var(--c-ink, var(--cyan-ink)));',
      'background: linear-gradient(90deg, color-mix(in srgb, var(--c, var(--cyan)) 65%, transparent), var(--c, var(--cyan)));')
  },
  {
    id: 'T16', file: CSS, expect: 'KILL',
    why: 'Drops `--c-ink` from `.meter.warn` alone, leaving `--c` in place. The tone still reaches the glow and no longer reaches the fill, so a warn bar paints the `var(--cyan-ink)` fallback -- the wrong colour at full contrast, which every ratio-measuring claim in this file is blind to by construction. Binds claim 10, the hazard this change introduces rather than one it inherits.',
    apply: (s) => replaceOnce(s, '.meter.warn { --c: var(--amber);   --c-ink: var(--amber-ink); }',
      '.meter.warn { --c: var(--amber); }')
  },
  {
    id: 'T17', file: CSS, expect: 'KILL',
    why: 'Aimed at claim 8, and the only payload that reaches it. Makes the light-theme track OPAQUE and dark and lightens the fills to sit between it and the card: the fill then clears 3:1 against the track it is measured against and fails against the card it sits on. It takes a change this contrived because the track is a translucent wash OF the card, so the two normally move together -- which is the honest limit on claim 8 and is recorded as such in the guard header.',
    apply: (s) => replaceOnce(s, '.meter i {\n  position: absolute;',
      '[data-theme="light"] .meter { background: #1a1a1a; }\n' +
      '[data-theme="light"] .meter i { background-image: linear-gradient(90deg, ' +
      'color-mix(in srgb, var(--c-ink, var(--cyan-ink)) 30%, white), ' +
      'color-mix(in srgb, var(--c-ink, var(--cyan-ink)) 30%, white)); }\n.meter i {\n  position: absolute;')
  },
  {
    id: 'T18', file: CSS, expect: 'GREEN',
    why: 'T3 as it was written for Stadiora/Aria#10825: the historical groove colour, `color-mix(var(--c) 30%, var(--bg))`, which measured 2.67:1 against a light-theme `bad` fill and was a real SC 1.4.11 failure at the time. Published as a GREEN on purpose rather than deleted, because the reason it stopped killing is a finding: #10848 moved the fill to `--c-ink` and left the groove on `--c`, so groove and fill separated and the same payload now measures 4.21:1 worst across 36 grooves. A fix for the value channel incidentally repaired a defect in the severity channel. Without this row that would read as a row quietly dropped when it became inconvenient.',
    apply: (s) => replaceOnce(s, '  border: 0 solid var(--bg);',
      '  border: 0 solid color-mix(in srgb, var(--c, var(--cyan)) 30%, var(--bg));')
  }
];

function replaceOnce(s, from, to) {
  const i = s.indexOf(from);
  if (i === -1) throw new Error(`payload anchor not found: ${JSON.stringify(from.slice(0, 60))}`);
  if (s.indexOf(from, i + 1) !== -1) throw new Error(`payload anchor is not unique: ${JSON.stringify(from.slice(0, 60))}`);
  return s.slice(0, i) + to + s.slice(i + from.length);
}

/* ------------------------------------------------------- anchor derivation */

/* A mutation is a LOCATION as well as an edit, and the location has to be
   derived from what actually changed rather than remembered. First differing
   byte -> line number -> the innermost enclosing CSS selector, found by
   walking brace depth backwards. Published anchors have been wrong twice in
   this effort by being written from memory; this cannot be, because it reads
   the two buffers. */
function deriveAnchor(before, after, file) {
  let i = 0;
  while (i < before.length && i < after.length && before[i] === after[i]) i++;
  const line = before.slice(0, i).split('\n').length;
  const head = before.slice(0, i);
  const lineStart = head.lastIndexOf('\n') + 1;
  const lineEnd = before.indexOf('\n', i) === -1 ? before.length : before.indexOf('\n', i);
  const lineText = clip(before.slice(lineStart, lineEnd).trim());

  /* The scope walk below reads CSS. Run over a JS file it produces something
     worse than nothing: sibling array elements end in commas too, so the
     selector-list walk-back swallowed six entries and published a row naming
     `Coaching tone` for a payload that changed `Language quality, Portuguese`.
     That is the exact defect this derivation exists to prevent, so outside a
     stylesheet the anchor is the line itself, which is what a reader can
     check. */
  if (!file.endsWith('.css')) return { line, selector: null, lineText, file };
  let depth = 0;
  let selector = '(file scope)';
  for (let j = head.length - 1; j >= 0; j--) {
    const c = head[j];
    if (c === '}') depth++;
    else if (c === '{') {
      if (depth === 0) {
        /* A selector LIST spans several lines, each but the last ending in a
           comma, and a payload landing in the block touches every one of them.
           Walking back over those lines is the difference between an anchor
           that names the rule that changed and one that names a third of it. */
        let start = head.lastIndexOf('\n', j - 1) + 1;
        while (start > 0) {
          const prevEnd = start - 1;
          const prevStart = head.lastIndexOf('\n', prevEnd - 1) + 1;
          if (!head.slice(prevStart, prevEnd).trim().endsWith(',')) break;
          start = prevStart;
        }
        selector = clip(head.slice(start, j).trim().replace(/\s+/g, ' '));
        break;
      }
      depth--;
    }
  }
  return { line, selector, lineText, file };
}

function clip(t) { return t.length > 120 ? `${t.slice(0, 117)}...` : t; }

/* ---------------------------------------------------------------- running */

function runSuite() {
  const res = spawnSync(process.execPath, ['--test', TARGET], {
    cwd: ROOT, encoding: 'utf8', timeout: 400000,
    env: { ...process.env, CHROME_PATH: process.env.CHROME_PATH || '' }
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  const failLine = /^[\s#\u2139]*fail (\d+)\s*$/m.exec(out);
  const passLine = /^[\s#\u2139]*pass (\d+)\s*$/m.exec(out);
  const fails = failLine ? Number(failLine[1]) : null;
  const passes = passLine ? Number(passLine[1]) : null;

  /* The distinction that makes this table worth reading. A runner that died
     before asserting anything exits non-zero with nothing recorded, which is
     not evidence that the mutation was detected. */
  let verdict;
  if (fails === null) verdict = 'CRASH';
  else if (fails > 0) verdict = 'RED';
  else if (res.status === 0) verdict = 'GREEN';
  else verdict = 'CRASH';

  /* The webfont battery captured `claim N ...` because that file named its
     tests that way. These are named as sentences, so the capture runs to the
     duration parenthesis instead. A regex tuned to another file's naming is
     how a table comes to show an empty "killed by" column. */
  const failed = [...new Set([...out.matchAll(/^\s*\u2716\s+(.+?)\s+\(\d/gm)].map((m) => m[1].trim()))];

  /* The assertion's OWN WORDS, which is the column a reviewer actually reads.
     The first draft of this regex captured the line after the AssertionError
     header, which for a deepEqual failure is `+ actual - expected` and for an
     `ok` failure is a stack frame -- four of seven rows published a stack
     frame as though it were evidence. Node puts the message on the header
     line itself and may wrap it, so the capture runs to the diff marker, the
     first stack frame or the object dump, whichever comes first. */
  const messages = [];
  for (const m of out.matchAll(/AssertionError \[[A-Z_]+\]:\s*([\s\S]*?)(?=\n\s*(?:\+ actual|- expected|at [A-Za-z]|\{\s*$|$))/g)) {
    const text = m[1].replace(/\s+/g, ' ').trim();
    if (text && !messages.includes(text)) messages.push(text);
  }
  const swept = (/^# swept ([^\n]+)$/m.exec(out) || [])[1] || '';
  return { verdict, fails, passes, status: res.status, failed, messages, swept, out };
}

/* ------------------------------------------------------------- the driver */

const sidecars = new Map();

function stash(file) {
  const abs = path.join(ROOT, file);
  const keep = `${abs}.battery-orig`;
  fs.copyFileSync(abs, keep);
  sidecars.set(abs, keep);
}

function restoreAll() {
  for (const [abs, keep] of sidecars) {
    try {
      fs.copyFileSync(keep, abs);
      const a = fs.readFileSync(abs);
      const b = fs.readFileSync(keep);
      if (!a.equals(b)) throw new Error(`restore of ${abs} did not byte-compare`);
      fs.unlinkSync(keep);
    } catch (e) { console.error(`RESTORE FAILED for ${abs}: ${e.message}`); }
  }
  sidecars.clear();
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { console.error(`\n${sig} -- restoring tree`); restoreAll(); process.exit(130); });
}

const rows = [];

for (const m of BATTERY) {
  if (only.length && !only.includes(m.id)) continue;
  if (m.needs && !fs.existsSync(path.join(ROOT, m.needs))) {
    /* Named in the table rather than dropped from it: a row that quietly
       vanishes is how a battery comes to prove less than it claims. */
    rows.push({ ...m, anchor: null, applied: null, scored: 'SKIPPED',
      r: { verdict: 'SKIPPED', failed: [], status: null, fails: null, passes: null,
        messages: [`fixture ${m.needs} is absent; rebuild it with the pyftsubset command in ops/assets/fonts/README.md VERBATIM -- including --name-IDs='*' --no-hinting --notdef-outline, or the fixture differs from the shipped font by more than the codepoint under test -- dropping U+00B7 from --unicodes`] } });
    process.stderr.write(`\n=== ${m.id} SKIPPED (no ${m.needs})\n`);
    continue;
  }
  process.stderr.write(`\n=== ${m.id} (${m.expect}) ${m.file || '(no file)'} ...\n`);
  let anchor = null;
  let applied = null;

  try {
    if (m.apply) {
      stash(m.file);
      const abs = path.join(ROOT, m.file);
      const before = fs.readFileSync(abs);
      const after = m.binary ? m.apply(before) : Buffer.from(m.apply(before.toString('utf8')), 'utf8');

      /* Application proved by CONTENT, never by size. */
      if (before.equals(after)) throw new Error('payload produced an identical file: it did not apply');
      fs.writeFileSync(abs, after);
      const readBack = fs.readFileSync(abs);
      if (!readBack.equals(after)) throw new Error('what landed on disk is not what was written');

      applied = m.binary
        ? `${before.length}B -> ${after.length}B, first differing byte at offset ${firstDiff(before, after)}`
        : `${before.length}B -> ${after.length}B`;
      anchor = m.binary
        ? { line: null, selector: `(binary, offset ${firstDiff(before, after)})`, file: m.file }
        : deriveAnchor(before.toString('utf8'), after.toString('utf8'), m.file);
    }

    const r = runSuite();
    fs.writeFileSync(path.join(OUTDIR, `battery-${m.id}.log`), r.out);
    const scored = r.verdict === 'CRASH' ? 'CRASH'
      : (m.expect === 'KILL' ? (r.verdict === 'RED' ? 'KILL' : 'SURVIVED')
        : (r.verdict === 'GREEN' ? 'GREEN' : 'UNEXPECTED RED'));
    rows.push({ ...m, anchor, applied, r, scored });
    process.stderr.write(`    -> ${scored}  (exit ${r.status}, pass ${r.passes}, fail ${r.fails})\n`);
    if (r.verdict === 'CRASH') process.stderr.write(r.out.split('\n').slice(-25).join('\n') + '\n');
  } catch (e) {
    rows.push({ ...m, anchor, applied, r: { verdict: 'ERROR', failed: [], messages: [e.message], status: null, fails: null, passes: null }, scored: 'ERROR' });
    process.stderr.write(`    -> ERROR ${e.message}\n`);
  } finally {
    restoreAll();
  }
}

function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/* ------------------------------------------------------------- the report */

const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();

const lines = [];
lines.push(`### Mutation battery — \`${TARGET}\``);
lines.push('');
/* Named from `import.meta.url`, not typed. The first run of this file
   published a table crediting the battery it had been copied from, which
   is the same defect class as an anchor written from memory. */
const SELF = path.relative(ROOT, fileURLToPath(import.meta.url));
lines.push(`Generated by \`${SELF}\` from the executed run. Head \`${head}\`.`);
lines.push(dirty ? `Tree at generation time was **dirty**:\n\n\`\`\`\n${dirty}\n\`\`\`\n` : 'Tree was clean at generation time.');
lines.push('');
lines.push('| # | File | Anchor (original gating) | Payload | Expect | Result | Killed by |');
lines.push('|---|---|---|---|---|---|---|');
for (const r of rows) {
  const anchor = !r.anchor ? '—'
    : !r.anchor.line ? `\`${r.anchor.file}\` ${r.anchor.selector}`
    : r.anchor.selector ? `\`${r.anchor.file}:${r.anchor.line}\` in \`${r.anchor.selector}\``
    : `\`${r.anchor.file}:${r.anchor.line}\`, on \`${r.anchor.lineText}\``;
  const killed = r.r.failed.length ? r.r.failed.map((f) => `\`${f}\``).join('<br>') : '—';
  lines.push(`| ${r.id} | ${r.file ? `\`${r.file}\`` : '—'} | ${anchor} | ${r.why} | ${r.expect} | **${r.scored}** (exit ${r.r.status}, ${r.r.passes ?? '?'} pass / ${r.r.fails ?? '?'} fail) | ${killed} |`);
}
lines.push('');
lines.push('#### The failing assertion, in its own words');
lines.push('');
for (const r of rows) {
  const msgs = r.r.messages || [];
  if (!msgs.length) continue;
  lines.push(`**${r.id}**`);
  lines.push('');
  for (const msg of msgs.slice(0, 4)) lines.push(`> ${msg.slice(0, 600)}`);
  lines.push('');
}
lines.push('#### Application proof (content, not size)');
lines.push('');
for (const r of rows) {
  if (!r.applied) continue;
  lines.push(`- **${r.id}**: ${r.applied}`);
}
lines.push('');
const bad = rows.filter((r) => !['KILL', 'GREEN', 'SKIPPED'].includes(r.scored));
lines.push(bad.length ? `**${bad.length} row(s) did not score as intended: ${bad.map((b) => `${b.id}=${b.scored}`).join(', ')}**` : 'Every row scored as intended.');

const report = lines.join('\n');
fs.writeFileSync(path.join(OUTDIR, 'battery.md'), `${report}\n`);
console.log(report);
process.exit(bad.length ? 1 : 0);
