import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('real browser moderation guards hostile text, localized chat targets and keyboard decision focus', async () => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'ops-ugc-browser-'));
  try {
    await promisify(execFile)(process.execPath, ['scripts/ops-keyboard-walk.mjs', '--out', path.join(scratch, 'audit.md')], {
      cwd: root,
      env: { ...process.env, KBD_ONLY: 'problems', KBD_VIEWPORT: 'desktop', KBD_SKIP_DIALOGS: '1' },
      timeout: 60000,
    });
    // The walk only probes the queue on the page that draws it; a scoped run that probed nothing would pass without testing anything.
    const audit = readFileSync(path.join(scratch, 'audit.md'), 'utf8');
    assert.match(audit, /Community safety populated\/decided probes \| [1-9]\d*,/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
