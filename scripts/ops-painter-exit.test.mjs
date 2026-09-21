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

     A  no browser to launch      -- throws while evaluating the argument to
                                     spawn(). The profile directory is made two
                                     statements earlier, so the server AND the
                                     directory are open at the throw.
     B  browser dies on startup   -- throws after the profile directory is made
                                     and the process is spawned: the server, a
                                     child process, and a directory on disk.
                                     The child is already dead by then.
     C  browser never answers     -- a stub that starts, stays alive and never
                                     publishes a DevTools port. The port wait
                                     runs to its end and throws with a LIVE
                                     child to release. This is the path that
                                     leaks most, and the one the filed issue
                                     did not name.

   Each case asserts three separate things, because two of them can be true
   while the thing this file is named for is false:

     1. the child TERMINATED     -- the property under test
     2. it terminated NON-ZERO   -- it did not "fix" the hang by passing
     3. it failed FOR THE REASON THE CASE INDUCED -- a child that dies because
        the file no longer parses satisfies 1 and 2 and proves nothing, and so
        does a name filter that matches no test at all, which node --test
        reports as a clean run

   Cases B and C assert a fourth: the profile directory left on disk is gone.
   That one is watched for while the child runs rather than only looked for
   afterwards, because an empty directory at the end is what BOTH "cleaned up"
   and "never created there" look like.

   Case C asserts a fifth, which is the whole reason it exists: the browser
   process itself is gone. Same two-sided shape -- it is watched ALIVE while
   the child runs and then asserted dead, because a stub that never started is
   also "not running afterwards".

   Case B asserts a sixth: that it ended QUICKLY. The port wait is 300 turns of
   100ms, and it is cut short when the browser is already known to have exited.
   Without that cut the case still passes, 313ms becomes 30.7s, and no
   assertion in this file notices -- the fail-fast is behaviour, so it needs an
   assertion of its own.

   NOT COVERED
   -----------
   - The success path's release. It is not re-proved here because the whole
     suite already is that proof: scripts/ops-analytics-v2.test.mjs opens a
     painter on every run and `node --test scripts/*.test.mjs` terminates, which
     it could not do if close() leaked. Mutation proof in the PR (M6): stubbing
     close to a no-op hangs that file.
   - The profile directory on case A's path, as a MEASUREMENT. It is created
     and leaked there -- mkdtempSync runs two statements before the throw --
     but the window between the two is a pair of adjacent synchronous
     statements, so no poll from another process can ever catch the directory
     existing. Asserting only that it is absent afterwards is the vacuous shape
     this file's own header warns about, so case A does not assert it at all.
     Cases B and C do, and the release is one unwind shared by all three.
   - Failure points after the port is published -- a /json/list that answers
     nothing, a socket that refuses to open. They take the same unwind by
     construction, but no case here drives them; inducing them needs a fake
     DevTools endpoint that speaks enough HTTP to get past the port wait and
     then stops, which is more harness than the remaining risk is worth.
   - The ORDER the unwind drains in. It pops, so it releases newest-first, and
     nothing here binds that: mutation N6 in the PR swaps pop() for shift() and
     all three cases stay green. They should. Each release is independent and
     runs inside its own try/catch, so no case in this file can tell the two
     orders apart -- the row is published green rather than dropped because an
     unbound property is a fact about the suite, not an omission from the table.
   - Anything about what the paint sweep MEASURES. That is its own file's job.
     This file only asks whether a failing run ends. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SUBJECT = 'scripts/ops-analytics-v2.test.mjs';
const PAINT_TEST = 'every class this pane draws is one a loaded sheet moves a value with';

/* Generous: the point is "does it end", not "how fast". Cases A and B land in
   well under a second each once the file has loaded, so a watchdog this wide
   cannot fire on a slow machine -- only on a hang. Case C asks for its own,
   because waiting out the port loop is the thing it is testing. */
const WATCHDOG_MS = 60_000;

/* The port wait is 300 turns of 100ms. A case that sits through all of it has
   not hung -- it has done exactly what it was asked -- so case C is allowed
   twice that and then some, for the child's own startup on a loaded machine. */
const PORT_WAIT_MS = 30_000;
const SLOW_WATCHDOG_MS = 90_000;

/* What "fast" means for case B, set against the thing it is not doing: the
   full port wait above. Measured, both themes of load: 245ms and 329ms for the
   two cases as they stand, so this is thirty times the observed cost and a
   third of the loop it must not have entered. Dropping `&& !gone` from that
   loop's condition puts case B at 30.7s, which is what this catches. */
const FAIL_FAST_MS = 10_000;

/* Run the paint sweep, and only the paint sweep, in a child that cannot find a
   usable browser. Returns how it ended rather than asserting, so each case can
   say what it wanted in its own words. */
function runPaintSweep(env, watchDir, options = {}) {
  const watchdogMs = options.watchdogMs || WATCHDOG_MS;
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
    }, watchdogMs);

    /* Watching for the profile directory to APPEAR is what stops the "it was
       cleaned up" assertion from being vacuous. An empty directory afterwards
       reads identically whether the profile was removed or was never put there
       -- and it would never be put there if mkdtemp stopped consulting TMPDIR.
       The directory lives for at least one 100ms turn of the port-wait loop,
       so polling every 2ms sees it tens of times. */
    let profileSeen = false;
    /* The same two-sidedness for the stub browser: its pid is read off the file
       it writes, and it is confirmed RUNNING at least once while the child is
       alive. Without that, "the stub is not running afterwards" is satisfied by
       a stub that never started. */
    let stubPid = null;
    let stubSeenAlive = false;
    const poll = (watchDir || options.pidFile) ? setInterval(() => {
      try {
        if (watchDir
          && readdirSync(watchDir).some((name) => name.startsWith('ops-analytics-paint-'))) {
          profileSeen = true;
        }
      } catch (e) { /* the directory is the test's own; a read that fails is not a verdict */ }
      if (!options.pidFile) return;
      try {
        if (stubPid === null) stubPid = Number(readFileSync(options.pidFile, 'utf8').trim()) || null;
        if (stubPid !== null && alive(stubPid)) stubSeenAlive = true;
      } catch (e) { /* not written yet, or already reaped */ }
    }, 2) : null;

    child.on('close', (code, signal) => {
      clearTimeout(watchdog);
      if (poll) clearInterval(poll);
      resolve({ code, signal, timedOut, out, profileSeen, stubPid, stubSeenAlive,
        ms: Date.now() - started });
    });
  });
}

/* Signal 0 asks the kernel whether a pid can be signalled without sending
   anything. ESRCH is "no such process"; EPERM would be "alive but not yours",
   which cannot happen for a process this test's own child spawned. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
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

    /* The fail-fast, which is behaviour and not cleanup. A browser that has
       already exited will never publish a port, so the wait is cut short --
       and if it is not, this case still ends, still fails, still cleans up,
       and takes a hundred times longer doing it. */
    assert.ok(run.ms < FAIL_FAST_MS,
      'the child took ' + run.ms + 'ms to report a browser that died on startup. That is the ' +
      'port wait running to its full ' + PORT_WAIT_MS + 'ms for an answer that was already ' +
      'decided: the loop is no longer stopping when the browser is known to be gone.');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

/* The path the filed issue did not name, and the one that leaks most: a
   browser that starts, stays alive, and never publishes a DevTools port. Cases
   A and B never leave a live process behind -- A spawns nothing, and B's
   "browser" is gone before the wait begins -- so until this case, nothing here
   could tell a release that kills the browser from one that does not.

   The stub is a shell that records its own pid and then EXECS sleep, so the
   pid this test watches is the pid the launch spawned and holds: no
   intermediate shell to absorb the signal and leave the sleep orphaned.

   It costs the full 30s port wait, on purpose. That wait is what puts a live
   child under a throw. */
test('a run whose browser never answers fails, ends, and kills the browser', async () => {
  const scratch = mkdtempSync(join(REPO, '.ops-painter-exit-'));
  const stub = join(scratch, 'silent-browser.sh');
  const pidFile = join(scratch, 'stub.pid');
  let run = null;
  try {
    writeFileSync(stub, '#!/bin/sh\necho $$ > ' + JSON.stringify(pidFile) + '\nexec sleep 120\n');
    chmodSync(stub, 0o755);

    run = await runPaintSweep({ OPS_PAINT_BROWSERS: stub, TMPDIR: scratch }, scratch,
      { watchdogMs: SLOW_WATCHDOG_MS, pidFile });

    assertEndedInFailure(run,
      'Here: the server, the profile directory, and a browser process that is STILL RUNNING.');
    assert.match(run.out, /Chrome never published a DevTools port/,
      'this case only means something if it failed at the END of the port wait with the ' +
      'browser still alive. "exited before it published a DevTools port" is case B, and a ' +
      'live child is exactly what case B does not have:\n' + run.out.slice(0, 1200));

    assert.notEqual(run.stubPid, null,
      'the stub browser never wrote its pid to ' + pidFile + ', so it never ran and this ' +
      'case measured a launch that had nothing to kill.');
    assert.equal(run.stubSeenAlive, true,
      'the stub browser (pid ' + run.stubPid + ') was never observed running while the child ' +
      'was alive, so "it is not running now" holds whatever the release does.');

    /* kill() is a signal, not a join, and the pid is reaped by init once the
       run that spawned it is gone. Give it a moment before calling it a leak. */
    for (let i = 0; i < 150 && alive(run.stubPid); i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(alive(run.stubPid), false,
      'the failing run left its browser process (pid ' + run.stubPid + ') running after the ' +
      'runner exited. That is the Stadiora/Aria#10800 hang in its worst form: a live child, ' +
      'its profile directory, and the loopback server, all orphaned by one throw.');

    const left = readdirSync(scratch).filter((name) => name.startsWith('ops-analytics-paint-'));
    assert.deepEqual(left, [],
      'the failing run left its browser profile on disk: ' + JSON.stringify(left));
    assert.equal(run.profileSeen, true,
      'no browser profile was ever created under ' + scratch + ' while the child ran, so the ' +
      'assertion above holds no matter what the code did.');
  } finally {
    /* If the release is broken, the stub is still out there holding a sleep. */
    if (run && run.stubPid && alive(run.stubPid)) {
      try { process.kill(run.stubPid, 'SIGKILL'); } catch (e) { /* raced with the reaper */ }
    }
    rmSync(scratch, { recursive: true, force: true });
  }
});
