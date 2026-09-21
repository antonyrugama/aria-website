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
    why: 'Gives `.meter.vio` the same hue as `.meter.bad`, collapsing two severities in the colour channel entirely. Must stay GREEN: after this fix the tones are told apart by notch count, so a hue collision is no longer a severity collision. This is the claim of #10825, run as an experiment.',
    apply: (s) => replaceOnce(s, '.meter.vio  { --c: var(--violet); }', '.meter.vio  { --c: var(--rose); }')
  },
  {
    id: 'T1', file: CSS, expect: 'KILL',
    why: 'Deletes every notch rule, restoring the state of the file before this PR: the four tones differ in `--c` and nothing else. This is the defect Stadiora/Aria#10825 records, put back verbatim.',
    apply: (s) => {
      const from = s.indexOf('.meter i { overflow: hidden; }');
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
    why: 'Restores the first groove colour, `color-mix(var(--c) 30%, var(--bg))`. It is plainly visible and it measured 2.67:1 against a light-theme `bad` fill -- under SC 1.4.11, and invisible to any assertion that reads the stylesheet rather than the screen.',
    apply: (s) => replaceOnce(s, '  border: 0 solid var(--bg);',
      '  border: 0 solid color-mix(in srgb, var(--c, var(--cyan)) 30%, var(--bg));')
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
    why: 'Removes `overflow: hidden` from the fill. Published whatever it scores: the width floor exists for fills too short to hold their notches, and no pane renders one today, so this may well SURVIVE -- which is a fact about the board, not about the guard.',
    apply: (s) => replaceOnce(s, '.meter i { overflow: hidden; }', '.meter i { overflow: visible; }')
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
  let depth = 0;
  let selector = '(file scope)';
  for (let j = head.length - 1; j >= 0; j--) {
    const c = head[j];
    if (c === '}') depth++;
    else if (c === '{') {
      if (depth === 0) {
        const start = head.lastIndexOf('\n', j - 1) + 1;
        selector = head.slice(start, j).trim().replace(/\s+/g, ' ');
        break;
      }
      depth--;
    }
  }
  return { line, selector, file };
}

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
lines.push(`Generated by \`scripts/ops-webfont.battery.mjs\` from the executed run. Head \`${head}\`.`);
lines.push(dirty ? `Tree at generation time was **dirty**:\n\n\`\`\`\n${dirty}\n\`\`\`\n` : 'Tree was clean at generation time.');
lines.push('');
lines.push('| # | File | Anchor (original gating) | Payload | Expect | Result | Killed by |');
lines.push('|---|---|---|---|---|---|---|');
for (const r of rows) {
  const anchor = r.anchor ? (r.anchor.line ? `\`${r.anchor.file}:${r.anchor.line}\` in \`${r.anchor.selector}\`` : `\`${r.anchor.file}\` ${r.anchor.selector}`) : '—';
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
