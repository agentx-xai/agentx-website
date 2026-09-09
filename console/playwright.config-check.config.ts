import { defineConfig, devices } from '@playwright/test'

const port = process.env.AGENTX_CONFIG_WEB_PORT || '5182'

export default defineConfig({
  testDir: './tests/config',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, ...devices['Desktop Chrome'] },
  webServer: {
    command: `VITE_DEPLOYMENT_MODE=hosted VITE_API_URL= VITE_OIDC_ISSUER= VITE_OIDC_CLIENT_ID= npm run dev -- --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
})
