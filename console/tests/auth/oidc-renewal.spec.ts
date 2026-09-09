import { expect, test, type Page } from '@playwright/test'

const clientID = 'agentx'
const appOrigin = `http://127.0.0.1:${process.env.AGENTX_AUTH_WEB_PORT || '5181'}`

function userStorageKey(origin: string): string {
  return `oidc.user:${origin}/oidc:${clientID}`
}

async function seedOIDCSession(page: Page, expiresInSeconds: number) {
  await page.addInitScript(({ key, expiresAt }) => {
    const user = {
      id_token: 'header.payload.signature',
      access_token: 'old-access-token',
      refresh_token: 'old-refresh-token',
      token_type: 'Bearer',
      scope: 'openid profile email offline_access',
      profile: { sub: 'user-1', iss: `${location.origin}/oidc`, email: 'user@example.com' },
      expires_at: expiresAt,
    }
    sessionStorage.setItem(key, JSON.stringify(user))
    sessionStorage.setItem('agentx_api_token', user.access_token)
  }, { key: userStorageKey(appOrigin), expiresAt: Math.floor(Date.now() / 1000) + expiresInSeconds })
}

async function mockAPI(page: Page, status = 200) {
  await page.route('**/v1/**', async route => {
    if (status !== 200) {
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: { message: 'session rejected' } }) })
      return
    }
    const path = new URL(route.request().url()).pathname
	const body = path === '/v1/site/config'
	  ? { terms_url: 'https://example.test/terms', privacy_url: 'https://example.test/privacy', support_url: 'https://example.test/support', abuse_email: 'abuse@example.test', security_email: 'security@example.test' }
	  : path === '/v1/me' ? { id: 'issuer|owner' } : path.endsWith('/drift') ? { items: [] } : []
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function mockProvider(page: Page, tokenHandler: Parameters<Page['route']>[1]) {
  await page.route('**/oidc/.well-known/openid-configuration', route => {
    const origin = new URL(route.request().url()).origin
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        issuer: `${origin}/oidc`,
        authorization_endpoint: `${origin}/oidc/auth`,
        token_endpoint: `${origin}/oidc/token`,
        userinfo_endpoint: `${origin}/oidc/userinfo`,
        jwks_uri: `${origin}/oidc/keys`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
      }),
    })
  })
  await page.route('**/oidc/token', tokenHandler)
  await page.route('**/oidc/userinfo', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ sub: 'user-1', email: 'user@example.com' }),
  }))
}

test('automatically renews a token before timed expiry', async ({ page }) => {
  await seedOIDCSession(page, 31)
  await mockAPI(page)
  let refreshRequests = 0
  await mockProvider(page, async route => {
    refreshRequests += 1
    expect(route.request().postData() || '').toContain('grant_type=refresh_token')
    expect(route.request().postData() || '').toContain('refresh_token=old-refresh-token')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'renewed-access-token',
        refresh_token: 'renewed-refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid profile email offline_access',
      }),
    })
  })

  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await expect.poll(() => refreshRequests, { timeout: 10_000 }).toBe(1)
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('agentx_api_token')), { timeout: 10_000 }).toBe('renewed-access-token')
  const stored = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key) || '{}'), userStorageKey(new URL(page.url()).origin))
  expect(stored.access_token).toBe('renewed-access-token')
  expect(stored.refresh_token).toBe('renewed-refresh-token')
})

test('clears the session when timed renewal cannot reach the identity provider', async ({ page }) => {
  await seedOIDCSession(page, 2)
  await mockAPI(page)
  await mockProvider(page, route => route.abort('connectionrefused'))

  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText(/Unable to renew your session|session expired/i, { timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'Sign in with SSO' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('agentx_api_token'))).toBeNull()
  await expect.poll(() => page.evaluate(key => sessionStorage.getItem(key), userStorageKey(new URL(page.url()).origin))).toBeNull()
})

test('creates the first workspace without calling hosted-disabled legacy routes', async ({ page }) => {
  await seedOIDCSession(page, 3600)
  const requests: string[] = []
  let workspaces: Array<{ id: string; name: string; slug: string }> = []
  await page.route('**/v1/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    requests.push(`${request.method()} ${path}`)
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
	if (request.method() === 'GET' && path === '/v1/site/config') return json({ terms_url: 'https://example.test/terms', privacy_url: 'https://example.test/privacy', support_url: 'https://example.test/support', abuse_email: 'abuse@example.test', security_email: 'security@example.test' })
    if (request.method() === 'GET' && path === '/v1/me') return json({ id: 'issuer|owner' })
    if (request.method() === 'GET' && path === '/v1/workspaces') return json({ items: workspaces, count: workspaces.length })
    if (request.method() === 'POST' && path === '/v1/workspaces') {
      const created = { id: 'workspace-first', name: 'First team', slug: 'first-team' }
      workspaces = [created]
      return json(created, 201)
    }
    if (request.method() === 'GET' && path.endsWith('/policies')) return json({ revision: 0, document: {} })
    if (request.method() === 'GET' && path.endsWith('/manifest')) return json({ revision: 0, document: { version: 1, packages: [] } })
    if (request.method() === 'GET' && path.endsWith('/members')) return json({ items: [{ workspace_id: 'workspace-first', user_id: 'issuer|owner', role: 'owner' }], count: 1 })
    if (request.method() === 'GET' && path.includes('/workspaces/workspace-first/')) return json({ items: [], count: 0 })
    return json({ error: { message: `unexpected route ${request.method()} ${path}` } }, 404)
  })

  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
	expect(requests.sort()).toEqual(['GET /v1/site/config', 'GET /v1/me', 'GET /v1/workspaces'].sort())

  await page.getByRole('button', { name: 'Workspace', exact: true }).click()
  await page.getByPlaceholder('Workspace name').fill('First team')
  await page.getByPlaceholder('workspace-slug').fill('first-team')
  await page.getByRole('button', { name: 'Create workspace', exact: true }).last().click()

  await expect(page.getByRole('status')).toContainText('Workspace First team created')
  await expect(page.getByText('First team', { exact: true }).first()).toBeVisible()
  expect(requests).not.toContain('GET /v1/devices')
  expect(requests).not.toContain('GET /v1/packages')
  expect(requests).not.toContain('GET /v1/audit-events')
  expect(requests).not.toContain('GET /v1/drift')
  expect(requests).toContain('GET /v1/workspaces/workspace-first/devices')
  expect(requests).toContain('GET /v1/workspaces/workspace-first/packages')
  expect(requests).toContain('GET /v1/workspaces/workspace-first/audit-events')
  expect(requests).toContain('GET /v1/workspaces/workspace-first/drift')
})
