import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/staging',
  timeout: 90_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.AGENTX_STAGING_WEB_URL || 'http://localhost:5178',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
})
