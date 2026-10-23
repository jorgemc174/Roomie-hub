import { defineConfig, devices } from '@playwright/test';

// Used by test:auth:local against a production build with a local protocol fixture.
export default defineConfig({
  testDir: './tests/oauth',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3200', trace: 'off' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
});
