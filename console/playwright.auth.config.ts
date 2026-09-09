import { defineConfig, devices } from '@playwright/test'

const port = process.env.AGENTX_AUTH_WEB_PORT || '5181'
const origin = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests/auth',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: { baseURL: origin, trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: {
    command: `VITE_DEPLOYMENT_MODE=hosted VITE_API_URL= VITE_OIDC_ISSUER=${origin}/oidc VITE_OIDC_CLIENT_ID=agentx VITE_OIDC_REDIRECT_URI=${origin}/ npm run dev -- --host 127.0.0.1 --port ${port}`,
    url: origin,
    reuseExistingServer: false,
  },
})
