import { defineConfig, devices } from '@playwright/test'

const port = process.env.AGENTX_WEB_PORT || '5178'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'on-first-retry', ...devices['Desktop Chrome'] },
  webServer: { command: `NO_PROXY=127.0.0.1,localhost npm run dev -- --host 127.0.0.1 --port ${port}`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false },
})
