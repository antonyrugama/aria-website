#!/usr/bin/env node
/* Mutation battery for scripts/ops-webfont.test.mjs.
 *
 * The table this prints is generated FROM the run, not written from memory
 * afterwards. A published row cannot disagree with its experiment because it
 * is its experiment: the file, the anchor re-derived from the first differing
 * byte, the payload, the runner's own fail count and the failing assertion's
 * own words are all recorded as the battery executes.
 *
 * Three things this shape buys, each of which has caught something real in
 * this repository in the last day:
 *
 *  - A mutation that SILENTLY FAILED TO APPLY is indistinguishable from one
 *    that applied and was killed, from the outside: both end with a green tree
 *    and a red-then-green suite. Application is proved by CONTENT diff here,
 *    because a payload has already been observed to apply with a byte delta of
 *    exactly +0B, so size is not application proof.
 *
 *  - A CRASH scored as a kill certifies nothing. CONTROL-0 came back red on an
 *    unmutated tree once in this effort because a bad RUNNER_TEMP killed the
 *    runner in mkdtempSync before it asserted anything; every mutation would
 *    then have been "confirmed" for that reason. So the runner's own
 *    `# fail N` line is parsed, and a non-zero exit with zero recorded
 *    failures is scored CRASH, never KILL.
 *
 *  - A guard that reds at everything is not bounded. CONTROL-1 mutates the
 *    stylesheet in a way this sweep has no business noticing and must stay
 *    green.
 *
 * Restores come from byte-compared sidecar copies rather than `git checkout`,
 * which would revert the work in progress along with the mutation. TERM and
 * INT are trapped so an interrupted battery still puts the tree back.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fs.realpathSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const TARGET = 'scripts/ops-webfont.test.mjs';
const CSS = 'ops/assets/aria.css';
const SANS = 'ops/assets/fonts/Geist-Variable.woff2';
const MONO = 'ops/assets/fonts/GeistMono-Variable.woff2';

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
    why: 'Recolours a brand token. This sweep measures typefaces and has no business noticing; a guard that reds at any edit to its file is not bounded to its claim.',
    apply: (s) => replaceOnce(s, '--cyan:        #22D3EE;', '--cyan:        #FF00FF;')
  },
  {
    id: 'T1', file: CSS, expect: 'KILL',
    why: 'Deletes both @font-face blocks -- the state of ops/assets/aria.css before this PR, and the exact defect Stadiora/Aria#10806 records. Every text site on every pane must fall back.',
    apply: (s) => {
      const out = s.replace(/@font-face \{\n(?:[^}]*\n)*?\}\n/g, '');
      if (out === s) throw new Error('no @font-face block matched');
      return out;
    }
  },
  {
    id: 'T2', file: CSS, expect: 'KILL',
    why: 'Points the sans face at a file that does not exist. A 404 on a webfont is silent: the stack simply falls through.',
    apply: (s) => replaceOnce(s, "url('fonts/Geist-Variable.woff2')", "url('fonts/Geist-Missing.woff2')")
  },
  {
    id: 'T3', file: CSS, expect: 'KILL',
    why: 'Points the Geist Mono face at the SANS file. Claim 2 cannot see this -- every reading still names a vendored family -- so it is claim 3 or nothing.',
    apply: (s) => replaceOnce(s, "url('fonts/GeistMono-Variable.woff2')", "url('fonts/Geist-Variable.woff2')")
  },
  {
    id: 'T4', file: CSS, expect: 'KILL',
    why: 'Closes the sans axis range to a single weight. The face still loads and still paints, so claims 1-3 stay satisfied on the glyphs; the ten weights that fall between static cuts quietly snap.',
    apply: (s) => replaceOnce(s,
      "  src: url('fonts/Geist-Variable.woff2') format('woff2');\n  font-weight: 100 900;",
      "  src: url('fonts/Geist-Variable.woff2') format('woff2');\n  font-weight: 400;")
  },
  {
    id: 'T5', file: SANS, binary: true, expect: 'KILL',
    why: 'Truncates the sans woff2 to its first 1024 bytes. A face that fails to PARSE degrades exactly as silently as one that 404s.',
    apply: (buf) => buf.subarray(0, 1024)
  },
  {
    id: 'T6', file: CSS, expect: 'KILL',
    why: 'Declares the sans face as covering ASCII only. The file still loads and every ASCII site still paints Geist; the non-ASCII characters ops/ actually renders fall back per CHARACTER, which is what an incomplete subset looks like from the browser\'s side. That is ONE character -- U+00B7 MIDDLE DOT -- not the twelve a source scan finds: rendering all 10 panes x 2 themes x 4 states showed the other eleven live in comments and unreached branches. Hence the 116-site, one-glyph-each signature below, against T1/T2/T5\'s thousands. Self-contained: no fixture, so a reviewer can reproduce it from a clean checkout.',
    apply: (s) => replaceOnce(s,
      "  src: url('fonts/Geist-Variable.woff2') format('woff2');\n  font-weight: 100 900;",
      "  src: url('fonts/Geist-Variable.woff2') format('woff2');\n  unicode-range: U+0020-007E;\n  font-weight: 100 900;")
  },
  {
    id: 'T7', file: SANS, binary: true, expect: 'KILL', needs: '.fontwork/Geist-no-middot.woff2',
    why: 'The real thing T6 simulates: swaps the vendored sans subset for one actually built without U+00B7 MIDDLE DOT. Confirms the coverage claim binds the BYTES that ship, not only the CSS describing them. Aimed at U+2014 EM DASH first, on a source scan that found it in 55 files, and that row SURVIVED -- rendering the panes showed U+00B7 is the only non-ASCII character the stub data ever puts on screen, so the em-dash payload applied to a character no pane draws.',
    apply: () => fs.readFileSync(path.join(ROOT, '.fontwork/Geist-no-middot.woff2'))
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

  const failed = [...new Set([...out.matchAll(/^\s*\u2716\s+(claim [^(]+)\(/gm)].map((m) => m[1].trim()))];

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
