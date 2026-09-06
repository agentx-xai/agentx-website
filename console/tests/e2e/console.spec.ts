import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('http://localhost:8080/**', async route => {
    const url = new URL(route.request().url())
    const responses: Record<string, unknown> = {
      '/v1/devices': [{ id: 'device-1', name: 'Build laptop', agent: 'Codex', status: 'Ready' }],
      '/v1/packages': [{ name: 'review-skill', version: '1.2.0', sha256: '0123456789abcdef', signature_status: 'verified' }],
      '/v1/workspaces': [{ id: 'workspace-1', name: 'Platform', slug: 'platform' }],
      '/v1/audit-events': [{ action: 'release.publish', device_id: 'device-1', at: '2026-09-05T08:00:00Z' }],
      '/v1/drift': { items: [{ device_name: 'Build laptop', package: 'review-skill', kind: 'changed', expected_sha256: 'expected', observed_sha256: 'observed' }] },
      '/v1/workspaces/workspace-1/devices': [{ id: 'device-1', name: 'Build laptop', agent: 'Codex', status: 'Ready' }],
      '/v1/workspaces/workspace-1/packages': [{ name: 'review-skill', version: '1.2.0', sha256: '0123456789abcdef', signature_status: 'verified' }],
      '/v1/workspaces/workspace-1/audit-events': [{ action: 'release.publish', device_id: 'device-1', at: '2026-09-05T08:00:00Z' }],
      '/v1/workspaces/workspace-1/drift': { items: [{ device_name: 'Build laptop', package: 'review-skill', kind: 'changed', expected_sha256: 'expected', observed_sha256: 'observed' }] },
      '/v1/workspaces/workspace-1/members': [],
      '/v1/workspaces/workspace-1/policies': {},
      '/v1/workspaces/workspace-1/manifest': { revision: 0, document: {} },
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responses[url.pathname] ?? {}) })
  })
})

test('navigates the workspace console views', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Agent environments' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Build laptop' }).first()).toBeVisible()
  await expect(page.getByText('Drift items').locator('..').getByText('1')).toBeVisible()
  await expect(page.getByRole('cell', { name: 'changed' })).toBeVisible()

  await page.getByRole('button', { name: 'Registry' }).click()
  await expect(page.getByRole('heading', { name: 'Registry releases' })).toBeVisible()
  await expect(page.getByText('review-skill')).toBeVisible()
  await expect(page.getByText('verified')).toBeVisible()

  await page.getByRole('button', { name: 'Workspace', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible()
  await expect(page.getByText('Platform', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Audit' }).click()
  await expect(page.getByRole('heading', { name: 'Audit events' })).toBeVisible()
  await expect(page.getByText('release.publish')).toBeVisible()
})

test('completes workspace operations', async ({ page }) => {
  await page.unroute('http://localhost:8080/**')
  let workspaces = [{ id: 'workspace-1', name: 'Platform', slug: 'platform' }]
  const release = { name: 'new-skill', version: '1.0.0', sha256: 'abc123', signature_status: 'verified' }
  await page.route('http://localhost:8080/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (request.method() === 'GET' && path === '/v1/workspaces') return json(workspaces)
    if (request.method() === 'POST' && path === '/v1/workspaces') {
      const created = { id: 'workspace-2', name: 'Growth', slug: 'growth' }
      workspaces = [...workspaces, created]
      return json(created, 201)
    }
    if (request.method() === 'GET' && path.endsWith('/members')) return json([{ workspace_id: path.split('/')[3], user_id: 'issuer|member', role: 'viewer' }])
    if (request.method() === 'POST' && path.endsWith('/members')) return json({}, 201)
    if (request.method() === 'PATCH' && path.includes('/members/')) return route.fulfill({ status: 204 })
    if (request.method() === 'PUT' && path.endsWith('/policies')) return json({ revision: 1, document: { require_signature: true } })
    if (request.method() === 'GET' && path.endsWith('/manifest')) return json({ revision: 0, document: {} })
    if (request.method() === 'PUT' && path.endsWith('/manifest')) return json({ revision: 1, document: { packages: [] } })
    if (request.method() === 'GET' && path.endsWith('/devices')) return json([])
    if (request.method() === 'POST' && path.endsWith('/devices')) return json({ id: 'device-new', name: 'New laptop', agent: 'Codex', status: 'Ready' }, 201)
    if (request.method() === 'GET' && path.endsWith('/packages')) return json([])
    if (request.method() === 'POST' && path.endsWith('/approve')) return json({ ...release, status: 'approved' })
    if (request.method() === 'POST' && path.includes('/packages/')) return json(release, 201)
    if (request.method() === 'GET' && path.endsWith('/audit-events')) return json([])
    if (request.method() === 'GET' && path.endsWith('/drift')) return json({ items: [] })
    if (request.method() === 'GET' && path.endsWith('/artifacts/abc123')) return route.fulfill({ status: 200, body: 'artifact' })
    return json({})
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Workspace', exact: true }).click()
  await page.getByPlaceholder('Workspace name').fill('Growth')
  await page.getByPlaceholder('workspace-slug').fill('growth')
  await page.getByRole('button', { name: 'Create workspace', exact: true }).last().click()
  await expect(page.getByRole('status')).toContainText('Workspace Growth created')

  await page.getByPlaceholder('User ID or issuer|subject').fill('issuer|member')
  await page.getByRole('button', { name: 'Invite member' }).click()
  await expect(page.getByRole('status')).toContainText('Member added')
  await page.getByLabel('Member role').selectOption('developer')
  await expect(page.getByRole('status')).toContainText('Member role updated')

  await page.getByRole('button', { name: 'Policy' }).click()
  await page.getByLabel('Policy JSON').fill('{"require_signature":true}')
  await page.getByRole('button', { name: 'Save policy' }).click()
  await expect(page.getByRole('status')).toContainText('Policy revision 1 saved')

  await page.getByRole('button', { name: 'Manifest' }).click()
  await page.getByLabel('Team manifest JSON').fill('{"packages":[]}')
  await page.getByRole('button', { name: 'Save manifest' }).click()
  await expect(page.getByRole('status')).toContainText('Manifest revision 1 saved')

  await page.getByRole('button', { name: 'Overview' }).click()
  await page.getByPlaceholder('Device name').fill('New laptop')
  await page.getByRole('button', { name: 'Register device' }).click()
  await expect(page.getByRole('status')).toContainText('Device registered')

  await page.getByRole('button', { name: 'Registry' }).click()
  await page.getByPlaceholder('Package name').fill('new-skill')
  await page.getByPlaceholder('Version, e.g. 1.2.3').fill('1.0.0')
  await page.locator('input[type="file"]').setInputFiles({ name: 'skill.tar', mimeType: 'application/octet-stream', buffer: Buffer.from('artifact') })
  await page.getByRole('button', { name: 'Publish release' }).click()
  await expect(page.getByRole('status')).toContainText('new-skill 1.0.0 published')
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByRole('status')).toContainText('new-skill 1.0.0 approved')
  await page.getByRole('button', { name: 'Download' }).click()
  await expect(page.getByRole('status')).toContainText('new-skill 1.0.0 downloaded')
})
