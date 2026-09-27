import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const checker = join(repoRoot, 'scripts', 'check-third-party-embeds.sh');
function usableScratch(path) {
  return path && !path.startsWith('/tmp') && !path.startsWith('/var/tmp');
}

const scratchParent = [process.env.TMPDIR, process.env.RUNNER_TEMP, '/data/ianrowe/tmp'].find(usableScratch);

function makeFixtureRepo(files) {
  mkdirSync(scratchParent, { recursive: true });
  const root = mkdtempSync(join(scratchParent, 'third-party-embeds-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  for (const [name, content] of Object.entries(files)) {
    const target = join(root, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  execFileSync('git', ['add', '--', '.'], { cwd: root });
  return root;
}

function runChecker(root) {
  return spawnSync('bash', [checker, root], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function withFixture(files, fn) {
  const root = makeFixtureRepo(files);
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertPasses(files) {
  withFixture(files, (root) => {
    const result = runChecker(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Third-party embed check passed/);
  });
}

function assertFails(files, pattern) {
  withFixture(files, (root) => {
    const result = runChecker(root);
    assert.notEqual(result.status, 0, 'checker unexpectedly passed');
    assert.match(result.stderr, pattern);
  });
}

test('clean committed HTML passes, including stylesheets and the inline API host allowlist', () => {
  assertPasses({
    'clean.html': `<!doctype html>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
      <script src="assets/app.js"></script>
      <script>
        fetch('https://api.runwitharia.com/api/auth/reset-password');
        const handoff = 'ariaxii://reset-password?token=abc';
      </script>`,
  });
});

test('absolute third-party script src is rejected across multiline, uppercase and single-quoted spelling', () => {
  assertFails({
    'bad.html': `<!doctype html>
      <SCRIPT
        SRC='https://cdn.example.com/tracker.js'
      ></SCRIPT>`,
  }, /bad\.html:2: script src must be a relative first-party path/);
});

test('protocol-relative script src is rejected', () => {
  assertFails({
    'bad.html': `<script src=//cdn.example.com/tracker.js></script>`,
  }, /bad\.html:1: script src must be a relative first-party path/);
});

test('data URL script src is rejected', () => {
  assertFails({
    'bad.html': `<script src=data:text/javascript,alert(1)></script>`,
  }, /bad\.html:1: script src must be a relative first-party path/);
});

test('inline script host outside the allowlist is rejected', () => {
  assertFails({
    'bad.html': `<script>
      const loader = "https://tag.example.net/bootstrap.js";
    </script>`,
  }, /bad\.html:2: inline script names disallowed host tag\.example\.net/);
});

test('base element is rejected', () => {
  assertFails({
    'bad.html': `<BaSe href='https://cdn.example.com/'>`,
  }, /bad\.html:1: <base> is forbidden/);
});

test('framing and embedding constructs are rejected', async (t) => {
  const cases = {
    iframe: `<iframe src="/safe.html"></iframe>`,
    srcdoc: `<section srcdoc="<p>inline frame</p>"></section>`,
    object: `<object data="/movie.swf"></object>`,
    embed: `<embed src="/movie.swf">`,
  };

  for (const [name, html] of Object.entries(cases)) {
    await t.test(name, () => {
      assertFails({ [`${name}.html`]: html }, new RegExp(`${name}\\.html:1:`));
    });
  }
});

test('only committed HTML is scanned', () => {
  withFixture({ 'clean.html': '<script src="assets/app.js"></script>' }, (root) => {
    writeFileSync(join(root, 'untracked.html'), '<script src="https://cdn.example.com/tracker.js"></script>');
    const result = runChecker(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
});

test('real repository is clean today', () => {
  const result = runChecker(repoRoot);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
