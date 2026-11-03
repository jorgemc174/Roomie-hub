import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

test(
  'profile and registration interactions in both locales, themes and all required widths',
  { timeout: 180_000 },
  () => {
    execFileSync(process.execPath, ['tests/profile-browser.mjs'], {
      stdio: 'pipe',
      timeout: 170_000,
    });
  },
);

test('real Server Actions reject mismatched passwords and unsafe avatar uploads', () => {
  execFileSync(process.execPath, ['tests/profile-server.mjs'], { stdio: 'pipe', timeout: 30_000 });
});
