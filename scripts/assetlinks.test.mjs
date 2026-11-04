import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Android App Links statements are valid JSON', () => {
  const contents = readFileSync(new URL('../.well-known/assetlinks.json', import.meta.url), 'utf8');
  assert.doesNotThrow(() => JSON.parse(contents));
});
