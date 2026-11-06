import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('preferences hide the email channel until a mail provider is configured', () => {
  const page = readFileSync('src/app/(account)/notifications/preferences/page.tsx', 'utf8');
  assert.match(page, /\{emailReady&&<label className="checkbox"><input type="checkbox" name="email"/);
  assert.doesNotMatch(page, /disabled=\{!emailReady\}/);
  assert.doesNotMatch(page, /!emailReady&&<small>/);
});
