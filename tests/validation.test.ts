import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeNext, validImage, validName } from '../src/lib/validation';
import { es, en } from '../src/lib/i18n/dictionaries';
test('redirects stay on this origin', () => {
  for (const path of ['https://evil.test', '//evil.test', '/\\evil.test', '/homes\n'])
    assert.equal(safeNext(path), '/homes');
  assert.equal(safeNext('/homes/join?code=abc'), '/homes/join?code=abc');
});
test('names have meaningful bounded length', () => {
  assert.equal(validName('  '), false);
  assert.equal(validName('a'), false);
  assert.equal(validName('a'.repeat(81)), false);
  assert.equal(validName(' Casa del Sol '), true);
});
test('uploads must match an allowed image signature', () => {
  assert.equal(validImage(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png'), true);
  assert.equal(validImage(new TextEncoder().encode('<svg onload="evil()"/>'), 'image/png'), false);
  assert.equal(validImage(new Uint8Array([77, 90]), 'application/x-msdownload'), false);
  assert.equal(validImage(new Uint8Array([255, 216, 255]), 'image/jpeg'), true);
});
test('both locales cover every visible message and weekday', () => {
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  assert.equal(en.days.length, 7);
  for (const value of Object.values(en)) assert.ok(value.length > 0);
});
