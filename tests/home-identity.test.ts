import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

test(
  'home identity, profile avatar, section links and housemates render across viewport sizes',
  { timeout: 120_000 },
  () => {
    execFileSync(process.execPath, ['tests/home-identity-render.mjs'], {
      stdio: 'pipe',
      timeout: 110_000,
    });
  },
);
