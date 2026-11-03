import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: fileURLToPath(new URL('./browser/', import.meta.url)),
  fullyParallel: true,
  workers: 2,
  forbidOnly: !!process.env.CI,
  maxFailures: 0,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 10000 },
  outputDir: fileURLToPath(
    new URL('../.local/playwright-results/', import.meta.url),
  ),
  reporter: [
    ['list'],
    [
      'html',
      {
        outputFolder: fileURLToPath(
          new URL('../.local/playwright-report/', import.meta.url),
        ),
        open: 'never',
      },
    ],
  ],
  use: {
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath: process.env.HUMAGENT_BROWSER_PATH || undefined,
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
