import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  use: {
    baseURL: process.env.CAMPUS_URL ?? 'http://localhost:8080',
    channel: process.env.CAMPUS_BROWSER_CHANNEL || undefined,
    trace: 'retain-on-failure',
  },
});
