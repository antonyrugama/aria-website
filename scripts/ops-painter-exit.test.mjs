/* A failing run has to END.
   ---------------------------------------------------------------------------
   scripts/ops-analytics-v2.test.mjs launches Chrome to read a real cascade. To
   do that it first starts an HTTP server on a loopback port, and a listening
   server keeps the process alive. So any way out of the launch that is not the
   success path has to hand that server back, or the runner prints the failure
   and then sits there forever -- which is how Stadiora/Aria#10800 was found:
   the reviewer had to SIGKILL after 15 seconds.

   A run that hangs is worse than a run that fails. A failure gets read; a hang
   gets Ctrl-C'd, and the next person stops running the thing locally at all.

   THE SUBJECT
   -----------
   openPainter() in scripts/ops-analytics-v2.test.mjs, driven through its own
   entry point by a real `node --test` child process, at each of the two points
   it can fail before it returns:

     A  no browser to launch      -- throws in chromePath(), before the server
                                     has company: the server alone is leaked.
     B  browser dies on startup   -- throws after the profile directory is made
                                     and the process is spawned: the server, a
                                     child process, and a directory on disk.

   Each case asserts three separate things, because two of them can be true
   while the thing this file is named for is false:

     1. the child TERMINATED     -- the property under test
     2. it terminated NON-ZERO   -- it did not "fix" the hang by passing
     3. it failed FOR THE REASON THE CASE INDUCED -- a child that dies because
        the file no longer parses satisfies 1 and 2 and proves nothing, and so
        does a name filter that matches no test at all, which node --test
        reports as a clean run

   Case B asserts a fourth: the profile directory it leaves on disk is gone.
   That one is watched for while the child runs rather than only looked for
   afterwards, because an empty directory at the end is what BOTH "cleaned up"
   and "never created there" look like.

   NOT COVERED
   -----------
   - The success path's release. It is not re-proved here because the whole
     suite already is that proof: scripts/ops-analytics-v2.test.mjs opens a
     painter on every run and `node --test scripts/*.test.mjs` terminates, which
     it could not do if close() leaked. Mutation proof in the PR (M6): stubbing
     close to a no-op hangs that file.
   - Failure points between B and the return -- a socket that never opens, a
     /json/list that answers nothing. They take the same release path as A and
     B by construction (one unwind, run from one catch) but no case here drives
     them; inducing them needs a fake DevTools endpoint, which is more harness
     than the risk is worth.
   - Anything about what the paint sweep MEASURES. That is its own file's job.
     This file only asks whether a failing run ends. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SUBJECT = 'scripts/ops-analytics-v2.test.mjs';
const PAINT_TEST = 'every class this pane draws is one a loaded sheet moves a value with';

/* Generous: the point is "does it end", not "how fast". The two induced
   failures land in well under a second each once the file has loaded, so a
   watchdog this wide cannot fire on a slow machine -- only on a hang. */
const WATCHDOG_MS = 60_000;

/* Run the paint sweep, and only the paint sweep, in a child that cannot find a
   usable browser. Returns how it ended rather than asserting, so each case can
   say what it wanted in its own words. */
function runPaintSweep(env, watchDir) {
  return new Promise((resolve) => {
    const started = Date.now();
    /* node --test sets NODE_TEST_CONTEXT in the process it runs a test file in.
       Inherited, it tells the child it is already reporting to a parent runner,
       and the child then exits 0 in ~100ms having reported its failure upward
       to nobody -- so every assertion below passes for the wrong reason. */
    const clean = Object.assign({}, process.env, env);
    delete clean.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, [
      '--test', '--test-reporter=tap', '--test-name-pattern=' + PAINT_TEST, SUBJECT,
    ], { cwd: REPO, env: clean, stdio: ['ignore', 'pipe', 'pipe'] });

    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });

    let timedOut = false;
    const watchdog = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch (e) { /* already gone */ }
    }, WATCHDOG_MS);

    /* Watching for the profile directory to APPEAR is what stops the "it was
       cleaned up" assertion from being vacuous. An empty directory afterwards
       reads identically whether the profile was removed or was never put there
       -- and it would never be put there if mkdtemp stopped consulting TMPDIR.
       The directory lives for at least one 100ms turn of the port-wait loop,
       so polling every 2ms sees it tens of times. */
    let profileSeen = false;
    const poll = watchDir ? setInterval(() => {
      try {
        if (readdirSync(watchDir).some((name) => name.startsWith('ops-analytics-paint-'))) profileSeen = true;
      } catch (e) { /* the directory is the test's own; a read that fails is not a verdict */ }
    }, 2) : null;

    child.on('close', (code, signal) => {
      clearTimeout(watchdog);
      if (poll) clearInterval(poll);
      resolve({ code, signal, timedOut, out, profileSeen, ms: Date.now() - started });
    });
  });
}

function assertEndedInFailure(run, because) {
  assert.equal(run.timedOut, false,
    'the child never exited -- it was still alive after ' + (WATCHDOG_MS / 1000) + 's and had to ' +
    'be SIGKILLed. That is the #10800 hang: something openPainter() opened before it threw ' +
    'is still holding the event loop open. ' + because);
  assert.notEqual(run.code, 0,
    'the child exited cleanly. A run that cannot reach a browser must FAIL, not pass: the ' +
    'fake DOM has no cascade, so a pass here is a guard reporting something it never read.');
  const failed = run.out.split('\n').find((line) => line.startsWith('not ok ') && line.includes(PAINT_TEST));
  assert.ok(failed,
    'the paint sweep did not report "not ok". TAP said:\n' + run.out.slice(0, 1200));
  assert.ok(!/# SKIP/i.test(failed),
    'the paint sweep SKIPPED rather than failed: ' + failed);
}

test('a run that cannot find a browser fails and then ends', async () => {
  const run = await runPaintSweep({ OPS_PAINT_BROWSERS: '/nonexistent/aria-no-such-browser' });
  assertEndedInFailure(run, 'Here: the loopback server, started before chromePath() is called.');
  assert.match(run.out, /no Chrome or Chromium found/,
    'this case is only worth running if it failed because there was no browser. It failed ' +
    'for some other reason, so it says nothing about the no-browser path:\n' + run.out.slice(0, 1200));
});

test('a run whose browser dies on startup fails, ends, and leaves no profile behind', async () => {
  /* A "browser" that exits immediately: node itself, handed Chrome's flags. It
     is guaranteed present -- it is the thing running this test -- where a
     /bin/echo is a guess about the host. */
  const scratch = mkdtempSync(join(REPO, '.ops-painter-exit-'));
  try {
    const env = { OPS_PAINT_BROWSERS: process.execPath, TMPDIR: scratch };
    const run = await runPaintSweep(env, scratch);

    assertEndedInFailure(run,
      'Here: the server, the spawned process, and the profile directory under ' + scratch + '.');
    assert.match(run.out, /exited before it published a DevTools port/,
      'this case only means something if it got PAST mkdtemp and spawn and failed waiting for ' +
      'a DevTools port -- that is what puts a profile directory on disk. It failed somewhere ' +
      'else:\n' + run.out.slice(0, 1200));

    assert.equal(run.profileSeen, true,
      'no browser profile was ever created under ' + scratch + ' while the child ran, so the ' +
      'cleanup assertion below would hold no matter what the code did. Either the launch stopped ' +
      'putting its profile under os.tmpdir(), or TMPDIR stopped reaching the child.');
    const left = readdirSync(scratch).filter((name) => name.startsWith('ops-analytics-paint-'));
    assert.deepEqual(left, [],
      'the failing run left its browser profile on disk: ' + JSON.stringify(left) + ' under ' +
      scratch + '. Nothing ever comes back to collect these.');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
