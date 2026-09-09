import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('http://localhost:8080/**', async route => {
    const url = new URL(route.request().url())
    const responses: Record<string, unknown> = {
	  '/v1/site/config': { terms_url: 'https://example.test/terms', privacy_url: 'https://example.test/privacy', support_url: 'https://example.test/support', abuse_email: 'abuse@example.test', security_email: 'security@example.test' },
      '/v1/me': { id: 'issuer|owner', email: 'owner@example.com', email_verified: true },
	  '/v1/invitations': [],
      '/v1/devices': [{ id: 'device-1', name: 'Build laptop', agent: 'Codex', status: 'Ready' }],
      '/v1/packages': [{ name: 'review-skill', version: '1.2.0', sha256: '0123456789abcdef', signature_status: 'verified' }],
      '/v1/workspaces': [{ id: 'workspace-1', name: 'Platform', slug: 'platform' }],
      '/v1/audit-events': [{ action: 'release.publish', device_id: 'device-1', at: '2026-09-05T08:00:00Z' }],
      '/v1/drift': { items: [{ device_name: 'Build laptop', package: 'review-skill', kind: 'changed', expected_sha256: 'expected', observed_sha256: 'observed' }] },
      '/v1/workspaces/workspace-1/devices': [{ id: 'device-1', name: 'Build laptop', agent: 'Codex', status: 'Ready' }],
      '/v1/workspaces/workspace-1/packages': [{ name: 'review-skill', version: '1.2.0', sha256: '0123456789abcdef', signature_status: 'verified' }],
      '/v1/workspaces/workspace-1/audit-events': [{ action: 'release.publish', device_id: 'device-1', at: '2026-09-05T08:00:00Z' }],
      '/v1/workspaces/workspace-1/drift': { items: [{ device_name: 'Build laptop', package: 'review-skill', kind: 'changed', expected_sha256: 'expected', observed_sha256: 'observed' }] },
      '/v1/workspaces/workspace-1/members': [{ workspace_id: 'workspace-1', user_id: 'issuer|owner', role: 'owner' }],
	  '/v1/workspaces/workspace-1/invitations': [],
      '/v1/workspaces/workspace-1/policies': {},
      '/v1/workspaces/workspace-1/manifest': { revision: 0, document: { version: 1, packages: [] } },
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responses[url.pathname] ?? {}) })
  })
})

test('navigates the workspace console views', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Agent environments' })).toBeVisible()
	await expect(page.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', 'https://example.test/terms')
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

test('exports and deletes account data with explicit confirmation', async ({ page }) => {
	await page.unroute('http://localhost:8080/**')
	let deletionBody: unknown
	await page.route('http://localhost:8080/**', async route => {
		const request = route.request()
		const path = new URL(request.url()).pathname
		const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
		if (path === '/v1/site/config') return json({ terms_url: 'https://example.test/terms', privacy_url: 'https://example.test/privacy', support_url: 'https://example.test/support', abuse_email: 'abuse@example.test', security_email: 'security@example.test' })
		if (request.method() === 'GET' && path === '/v1/me') return json({ id: 'issuer|member', email: 'member@example.com', email_verified: true })
		if (request.method() === 'GET' && path === '/v1/me/export') return json({ schema_version: 1, exported_at: '2026-09-09T00:00:00Z', user: { id: 'issuer|member', issuer: 'issuer', subject: 'member', email: 'member@example.com', email_verified: true, created_at: '2026-09-01T00:00:00Z' }, memberships: [], invitations: [], audit_events: [] }, 200, { 'Content-Disposition': 'attachment; filename="agentx-account-export.json"', 'Cache-Control': 'no-store' })
		if (request.method() === 'DELETE' && path === '/v1/me') { deletionBody = request.postDataJSON(); return route.fulfill({ status: 204 }) }
		if (path === '/v1/invitations' || path === '/v1/workspaces') return json([])
		return json([])
	})

	await page.goto('/')
	await page.getByRole('button', { name: 'Account' }).click()
	await expect(page.getByRole('heading', { name: 'Account data' })).toBeVisible()
	const download = page.waitForEvent('download')
	await page.getByRole('button', { name: 'Download JSON' }).click()
	expect((await download).suggestedFilename()).toBe('agentx-account-export.json')
	await expect(page.getByRole('status')).toContainText('Account data exported')
	await expect(page.getByRole('button', { name: 'Delete account' })).toBeDisabled()
	await page.getByLabel('Deletion confirmation').fill('DELETE')
	await page.getByRole('button', { name: 'Delete account' }).click()
	await expect(page.getByRole('status')).toContainText('Account deleted')
	expect(deletionBody).toEqual({ confirmation: 'DELETE' })
})

test('completes workspace operations', async ({ page }) => {
  await page.unroute('http://localhost:8080/**')
  let workspaces = [{ id: 'workspace-1', name: 'Platform', slug: 'platform' }]
	let invitations: unknown[] = []
  let deviceIdempotencyKey = ''
  const release = { name: 'new-skill', version: '1.0.0', sha256: 'abc123', signature_status: 'verified', status: 'pending_approval' }
  await page.route('http://localhost:8080/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
	if (path === '/v1/site/config') return json({ terms_url: 'https://example.test/terms', privacy_url: 'https://example.test/privacy', support_url: 'https://example.test/support', abuse_email: 'abuse@example.test', security_email: 'security@example.test' })
    if (request.method() === 'GET' && path === '/v1/me') return json({ id: 'issuer|owner', email: 'owner@example.com', email_verified: true })
	if (request.method() === 'GET' && path === '/v1/invitations') return json([])
    if (request.method() === 'GET' && path === '/v1/workspaces') return json(workspaces)
    if (request.method() === 'POST' && path === '/v1/workspaces') {
      const created = { id: 'workspace-2', name: 'Growth', slug: 'growth' }
      workspaces = [...workspaces, created]
      return json(created, 201)
    }
    if (request.method() === 'GET' && path.endsWith('/members')) return json([
      { workspace_id: path.split('/')[3], user_id: 'issuer|owner', role: 'owner' },
      { workspace_id: path.split('/')[3], user_id: 'issuer|member', role: 'viewer' },
    ])
	if (request.method() === 'GET' && path.endsWith('/invitations')) return json(invitations)
	if (request.method() === 'POST' && path.endsWith('/invitations')) {
	  const body = request.postDataJSON()
	  const created = { id: 'invitation-1', workspace_id: 'workspace-2', email: body.email, role: body.role, status: 'pending', created_at: '2026-09-09T00:00:00Z', expires_at: '2026-09-16T00:00:00Z' }
	  invitations = [created]
	  return json(created, 201)
	}
    if (request.method() === 'PATCH' && path.includes('/members/')) return route.fulfill({ status: 204 })
    if (request.method() === 'PUT' && path.endsWith('/policies')) return json({ revision: 1, document: { require_signature: true } })
    if (request.method() === 'GET' && path.endsWith('/manifest')) return json({ revision: 0, document: { version: 1, packages: [] } })
    if (request.method() === 'PUT' && path.endsWith('/manifest')) return json({ revision: 1, document: { version: 1, packages: [] } })
    if (request.method() === 'GET' && path.endsWith('/devices')) return json([])
    if (request.method() === 'POST' && path.endsWith('/devices')) {
      deviceIdempotencyKey = request.headers()['idempotency-key'] || ''
      return json({ id: 'device-new', name: 'New laptop', agent: 'Codex', status: 'Ready' }, 201)
    }
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

	await page.getByPlaceholder('Verified email address').fill('member@example.com')
	await page.getByRole('button', { name: 'Create invitation' }).click()
	await expect(page.getByRole('status')).toContainText('Invitation created')
	await expect(page.getByRole('row').filter({ hasText: 'member@example.com' })).toContainText('pending')
  await page.getByRole('row').filter({ hasText: 'issuer|member' }).getByLabel('Member role').selectOption('developer')
  await expect(page.getByRole('status')).toContainText('Member role updated')

  await page.getByRole('button', { name: 'Policy' }).click()
  await page.getByLabel('Policy JSON').fill('{"require_signature":true}')
  await page.getByRole('button', { name: 'Save policy' }).click()
  await expect(page.getByRole('status')).toContainText('Policy revision 1 saved')

  await page.getByRole('button', { name: 'Manifest' }).click()
  await page.getByLabel('Team manifest JSON').fill('{"version":1,"packages":[]}')
  await page.getByRole('button', { name: 'Save manifest' }).click()
  await expect(page.getByRole('status')).toContainText('Manifest revision 1 saved')

  await page.getByRole('button', { name: 'Overview' }).click()
  await page.getByPlaceholder('Device name').fill('New laptop')
  await page.getByRole('button', { name: 'Register device' }).click()
  await expect(page.getByRole('status')).toContainText('Device registered')
  expect(deviceIdempotencyKey).not.toBe('')

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

test('claims a verified email invitation before workspace membership', async ({ page }) => {
	await page.unroute('http://localhost:8080/**')
	let joined = false
	const invitation = { id: 'invitation-claim', workspace_id: 'workspace-claim', workspace_name: 'Claims', workspace_slug: 'claims', email: 'invitee@example.com', role: 'developer', status: 'pending', created_at: '2026-09-09T00:00:00Z', expires_at: '2026-09-16T00:00:00Z' }
	await page.route('http://localhost:8080/**', async route => {
		const request = route.request()
		const path = new URL(request.url()).pathname
		const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
		if (path === '/v1/site/config') return json({ terms_url: 'https://example.test/terms', privacy_url: 'https://example.test/privacy', support_url: 'https://example.test/support', abuse_email: 'abuse@example.test', security_email: 'security@example.test' })
		if (path === '/v1/me') return json({ id: 'issuer|invitee', email: 'invitee@example.com', email_verified: true })
		if (path === '/v1/invitations' && request.method() === 'GET') return json(joined ? [] : [invitation])
		if (path === '/v1/invitations/invitation-claim/claim' && request.method() === 'POST') { joined = true; return json({ ...invitation, status: 'accepted' }) }
		if (path === '/v1/workspaces') return json(joined ? [{ id: 'workspace-claim', name: 'Claims', slug: 'claims' }] : [])
		if (path.endsWith('/members')) return json([{ workspace_id: 'workspace-claim', user_id: 'issuer|invitee', role: 'developer' }])
		if (path.endsWith('/policies')) return json({ revision: 0, document: {} })
		if (path.endsWith('/manifest')) return json({ revision: 0, document: { version: 1, packages: [] } })
		if (path.endsWith('/drift')) return json({ items: [] })
		return json([])
	})

	await page.goto('/')
	await page.getByRole('button', { name: 'Workspace', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Invitations for you' })).toBeVisible()
	await expect(page.getByRole('row').filter({ hasText: 'Claims' })).toContainText('developer')
	await page.getByRole('button', { name: 'Join' }).click()
	await expect(page.getByRole('status')).toContainText('Joined Claims')
	await expect(page.getByText('Claims', { exact: true }).first()).toBeVisible()
	await expect(page.getByRole('heading', { name: 'Invitations for you' })).toHaveCount(0)
})

test('walks collection cursors and hides actions from viewers', async ({ page }) => {
  await page.unroute('http://localhost:8080/**')
  const workspaces = Array.from({ length: 201 }, (_, index) => ({ id: `workspace-${index}`, name: `Workspace ${index}`, slug: `workspace-${index}` }))
  const releases = Array.from({ length: 201 }, (_, index) => ({
    name: `release-${index}`,
    version: '1.0.0',
    sha256: String(index).padStart(64, '0'),
    status: index === 200 ? 'pending_approval' : 'published',
  }))
  await page.route('http://localhost:8080/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const cursor = url.searchParams.get('cursor')
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
	if (path === '/v1/site/config') return json({ terms_url: 'https://example.test/terms', privacy_url: 'https://example.test/privacy', support_url: 'https://example.test/support', abuse_email: 'abuse@example.test', security_email: 'security@example.test' })
	if (path === '/v1/me') return json({ id: 'issuer|viewer', email: 'viewer@example.com', email_verified: false })
    if (path === '/v1/workspaces') {
      return cursor ? json({ items: workspaces.slice(200), count: 201 }) : json({ items: workspaces.slice(0, 200), count: 201, next_cursor: 'MjAw' })
    }
    if (path.endsWith('/members')) return json({ items: [{ workspace_id: 'workspace-0', user_id: 'issuer|viewer', role: 'viewer' }], count: 1 })
    if (path.endsWith('/packages')) {
      return cursor ? json({ items: releases.slice(200), count: 201 }) : json({ items: releases.slice(0, 200), count: 201, next_cursor: 'MjAw' })
    }
    if (path.endsWith('/policies')) return json({ revision: 0, document: {} })
    if (path.endsWith('/manifest')) return json({ revision: 0, document: { version: 1, packages: [] } })
    return json({ items: [], count: 0 })
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Registry' }).click()
  await expect(page.getByText('201 immutable releases')).toBeVisible()
  await expect(page.getByText('release-200')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Publish release' })).toHaveCount(0)
  const pendingRow = page.getByRole('row').filter({ hasText: 'release-200' })
  await expect(pendingRow.getByRole('button', { name: 'Approve' })).toHaveCount(0)
  await expect(pendingRow.getByRole('button', { name: 'Download' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Workspace', exact: true }).click()
  await expect(page.getByText('Workspace 200', { exact: true })).toBeVisible()
	await expect(page.getByPlaceholder('Verified email address')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Delete workspace' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Policy' }).click()
  await expect(page.getByRole('button', { name: 'Save policy' })).toHaveCount(0)
  await expect(page.getByLabel('Policy JSON')).toHaveAttribute('readonly', '')
})
