import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', workers: 1, fullyParallel: false, timeout: 90_000,
  use: { baseURL: 'http://127.0.0.1:3199', browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/e2e-server.mjs', url: 'http://127.0.0.1:3199/setup', timeout: 120_000, reuseExistingServer: false },
});
