import { expect, test } from '@playwright/test'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const execFileAsync = promisify(execFile)

async function findCredentials(directory: string): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = await findCredentials(candidate)
      if (nested) return nested
    } else if (entry.isFile() && entry.name === 'credentials.json') {
      return candidate
    }
  }
  return undefined
}

function waitForDeviceInstructions(child: ChildProcessWithoutNullStreams) {
  return new Promise<{ url: string, code: string }>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for CLI Device Flow instructions: ${stdout}\n${stderr}`)), 15_000)
    const inspect = () => {
      const url = stdout.match(/https?:\/\/\S+\/device\?user_code=\S+/)?.[0]
      const code = stdout.match(/Confirm code: ([A-Z0-9-]+)/)?.[1]
      if (url && code) {
        clearTimeout(timeout)
        resolve({ url, code })
      }
    }
    child.stdout.on('data', chunk => { stdout += chunk.toString(); inspect() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('exit', code => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout)
        reject(new Error(`CLI Device Flow exited ${code}: ${stderr}`))
      }
    })
  })
}

function waitForSuccess(child: ChildProcessWithoutNullStreams) {
  return new Promise<void>((resolve, reject) => {
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`CLI exited ${code}: ${stderr}`)))
  })
}

test('signs in through OIDC, claims an invitation, and operates the hosted console', async ({ page, browser }) => {
  test.skip(process.env.AGENTX_STAGING_E2E !== '1', 'requires the full staging compose stack')
  const email = process.env.AGENTX_STAGING_EMAIL || 'admin@example.com'
  const password = process.env.AGENTX_STAGING_PASSWORD || 'agentx-staging-password'
  const suffix = `${Date.now()}`

  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in with SSO' }).click()
  await expect(page).toHaveURL(/localhost:5556\/dex\/auth/)
  await page.locator('input[name="login"]').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.getByRole('button', { name: /login/i }).click()

  await expect(page).toHaveURL(/^http:\/\/localhost:5178\/?$/)
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  const session = await page.evaluate(async () => {
    const token = sessionStorage.getItem('agentx_api_token') || ''
    if (localStorage.getItem('agentx_api_token')) throw new Error('OIDC token persisted in localStorage')
    const userKey = Object.keys(sessionStorage).find(key => key.startsWith('oidc.user:')) || ''
    const user = JSON.parse(sessionStorage.getItem(userKey) || '{}') as { access_token?: string; id_token?: string }
    const response = await fetch('/v1/me', { headers: { Authorization: `Bearer ${token}` } })
    const principal = await response.json() as { id: string; email_verified?: boolean }
    return { token, accessToken: user.access_token || '', idToken: user.id_token || '', principal }
  })
  expect(session.token).toBe(session.accessToken)
  expect(session.token).not.toBe(session.idToken)
  expect(session.principal.id).toContain('http://localhost:5556/dex|')
  expect(session.principal.id).not.toBe('anonymous')
	expect(session.principal.email_verified).toBe(true)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await page.getByRole('button', { name: 'Workspace', exact: true }).click()
  await page.getByPlaceholder('Workspace name').fill(`OIDC acceptance ${suffix}`)
  await page.getByPlaceholder('workspace-slug').fill(`oidc-${suffix}`)
  await page.getByRole('button', { name: 'Create workspace', exact: true }).last().click()
  await expect(page.getByRole('status')).toContainText('created')
	await page.getByPlaceholder('Verified email address').fill('invitee@example.com')
	await page.getByRole('button', { name: 'Create invitation' }).click()
	await expect(page.getByRole('status')).toContainText('Invitation created')

	const inviteeContext = await browser.newContext()
	const inviteePage = await inviteeContext.newPage()
	await inviteePage.goto('/')
	await inviteePage.getByRole('button', { name: 'Sign in with SSO' }).click()
	await inviteePage.locator('input[name="login"]').fill('invitee@example.com')
	await inviteePage.locator('input[name="password"]').fill(password)
	await inviteePage.getByRole('button', { name: /login/i }).click()
	await expect(inviteePage).toHaveURL(/^http:\/\/localhost:5178\/?$/)
	await inviteePage.getByRole('button', { name: 'Workspace', exact: true }).click()
	const pendingRow = inviteePage.getByRole('row').filter({ hasText: `OIDC acceptance ${suffix}` })
	await expect(pendingRow).toContainText('developer')
	await pendingRow.getByRole('button', { name: 'Join' }).click()
	await expect(inviteePage.getByRole('status')).toContainText(`Joined OIDC acceptance ${suffix}`)
	await expect(inviteePage.locator('#workspace-select')).toContainText(`OIDC acceptance ${suffix}`)
	await inviteeContext.close()

  await page.getByRole('button', { name: 'Overview' }).click()
  await page.getByPlaceholder('Device name').fill(`browser-${suffix}`)
  await page.getByRole('button', { name: 'Register device' }).click()
  await expect(page.getByRole('status')).toContainText('Device registered')
  await expect(page.getByRole('cell', { name: `browser-${suffix}` })).toBeVisible()
})

test('exports and deletes a non-owner account without leaving personal identifiers', async ({ page, browser }) => {
	test.skip(process.env.AGENTX_STAGING_E2E !== '1', 'requires the full staging compose stack')
	const password = process.env.AGENTX_STAGING_PASSWORD || 'agentx-staging-password'
	const suffix = `${Date.now()}`

	await page.goto('/')
	await page.getByRole('button', { name: 'Sign in with SSO' }).click()
	await page.locator('input[name="login"]').fill('admin@example.com')
	await page.locator('input[name="password"]').fill(password)
	await page.getByRole('button', { name: /login/i }).click()
	await expect(page).toHaveURL(/^http:\/\/localhost:5178\/?$/)
	const workspace = await page.evaluate(async ({ suffix }) => {
		const token = sessionStorage.getItem('agentx_api_token') || ''
		const createResponse = await fetch('/v1/workspaces', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `Account lifecycle ${suffix}`, slug: `account-${suffix}` }) })
		if (!createResponse.ok) throw new Error(await createResponse.text())
		const created = await createResponse.json() as { id: string }
		const inviteResponse = await fetch(`/v1/workspaces/${created.id}/invitations`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'account@example.com', role: 'developer', expires_in_seconds: 3600 }) })
		if (!inviteResponse.ok) throw new Error(await inviteResponse.text())
		return created
	}, { suffix })

	const accountContext = await browser.newContext({ acceptDownloads: true })
	const accountPage = await accountContext.newPage()
	await accountPage.goto('/')
	await accountPage.getByRole('button', { name: 'Sign in with SSO' }).click()
	await accountPage.locator('input[name="login"]').fill('account@example.com')
	await accountPage.locator('input[name="password"]').fill(password)
	await accountPage.getByRole('button', { name: /login/i }).click()
	await expect(accountPage).toHaveURL(/^http:\/\/localhost:5178\/?$/)
	const accountID = await accountPage.evaluate(async () => {
		const token = sessionStorage.getItem('agentx_api_token') || ''
		const principal = await fetch('/v1/me', { headers: { Authorization: `Bearer ${token}` } }).then(response => response.json()) as { id: string }
		return principal.id
	})
	await accountPage.getByRole('button', { name: 'Workspace', exact: true }).click()
	const pendingRow = accountPage.getByRole('row').filter({ hasText: `Account lifecycle ${suffix}` })
	await pendingRow.getByRole('button', { name: 'Join' }).click()
	await expect(accountPage.getByRole('status')).toContainText(`Joined Account lifecycle ${suffix}`)
	const tenantAdminAttempt = await accountPage.evaluate(async () => {
		const token = sessionStorage.getItem('agentx_api_token') || ''
		const response = await fetch('/v1/admin/legal-holds', { headers: { Authorization: `Bearer ${token}` } })
		return response.status
	})
	expect(tenantAdminAttempt).toBe(403)
	const accountHoldID = await page.evaluate(async ({ accountID }) => {
		const token = sessionStorage.getItem('agentx_api_token') || ''
		const response = await fetch('/v1/admin/legal-holds', {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ target_type: 'account', target_id: accountID, reason: 'staging account lifecycle verification' }),
		})
		if (!response.ok) throw new Error(await response.text())
		return ((await response.json()) as { id: string }).id
	}, { accountID })
	const heldAccountDeletion = await accountPage.evaluate(async () => {
		const token = sessionStorage.getItem('agentx_api_token') || ''
		const response = await fetch('/v1/me', { method: 'DELETE', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: 'DELETE' }) })
		return { status: response.status, body: await response.text() }
	})
	expect(heldAccountDeletion.status).toBe(400)
	expect(heldAccountDeletion.body).toContain('active legal hold')
	await page.evaluate(async ({ accountHoldID }) => {
		const token = sessionStorage.getItem('agentx_api_token') || ''
		const response = await fetch(`/v1/admin/legal-holds/${accountHoldID}/release`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ confirmation: 'RELEASE', reason: 'staging verification complete' }),
		})
		if (!response.ok) throw new Error(await response.text())
	}, { accountHoldID })

	await accountPage.getByRole('button', { name: 'Account' }).click()
	const downloadPromise = accountPage.waitForEvent('download')
	await accountPage.getByRole('button', { name: 'Download JSON' }).click()
	const download = await downloadPromise
	const exportPath = await download.path()
	expect(exportPath).toBeTruthy()
	const exported = JSON.parse(await readFile(exportPath!, 'utf8')) as { schema_version: number; memberships: Array<{ workspace: { id: string } }>; invitations: Array<{ email: string }>; audit_events: Array<{ action: string }> }
	expect(exported.schema_version).toBe(1)
	expect(exported.memberships.some(item => item.workspace.id === workspace.id)).toBe(true)
	expect(exported.invitations.some(item => item.email === 'account@example.com')).toBe(true)
	expect(exported.audit_events.some(item => item.action === 'invitation.claim')).toBe(true)

	await accountPage.getByLabel('Deletion confirmation').fill('DELETE')
	await accountPage.getByRole('button', { name: 'Delete account' }).click()
	await expect(accountPage.getByRole('status')).toContainText('Account deleted')
	await expect(accountPage.getByRole('button', { name: 'Sign in with SSO' })).toBeVisible()

	const deletionState = await page.evaluate(async ({ workspaceID, accountID }) => {
		const token = sessionStorage.getItem('agentx_api_token') || ''
		const headers = { Authorization: `Bearer ${token}` }
		const members = await fetch(`/v1/workspaces/${workspaceID}/members?limit=200`, { headers }).then(response => response.json()) as { items?: Array<{ user_id: string }> } | Array<{ user_id: string }>
		const invitations = await fetch(`/v1/workspaces/${workspaceID}/invitations?limit=200`, { headers }).then(response => response.json()) as { items?: Array<{ email: string }> } | Array<{ email: string }>
			const audit = await fetch(`/v1/workspaces/${workspaceID}/audit-events?limit=200`, { headers }).then(response => response.json()) as { items?: Array<{ action: string; actor_id?: string }> } | Array<{ action: string; actor_id?: string }>
			const legalHolds = await fetch(`/v1/admin/legal-holds?target_type=account&target_id=${encodeURIComponent(accountID)}`, { headers }).then(response => response.json()) as { items?: Array<{ target_id: string }> } | Array<{ target_id: string }>
			const values = <T>(value: { items?: T[] } | T[]) => Array.isArray(value) ? value : (value.items || [])
			return {
				memberPresent: values(members).some(item => item.user_id === accountID),
				invitationPresent: values(invitations).some(item => item.email === 'account@example.com'),
				actorPresent: values(audit).some(item => item.actor_id === accountID),
				legalHoldTargetPresent: values(legalHolds).some(item => item.target_id === accountID),
			}
		}, { workspaceID: workspace.id, accountID })
	expect(deletionState).toEqual({ memberPresent: false, invitationPresent: false, actorPresent: false, legalHoldTargetPresent: false })
	const workspaceHoldID = await page.evaluate(async ({ workspaceID }) => {
		const token = sessionStorage.getItem('agentx_api_token') || ''
		const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
		const holdResponse = await fetch('/v1/admin/legal-holds', { method: 'POST', headers, body: JSON.stringify({ target_type: 'workspace', target_id: workspaceID, reason: 'staging workspace lifecycle verification' }) })
		if (!holdResponse.ok) throw new Error(await holdResponse.text())
		const hold = await holdResponse.json() as { id: string }
		const deleteResponse = await fetch(`/v1/workspaces/${workspaceID}`, { method: 'DELETE', headers })
		if (deleteResponse.status !== 400 || !(await deleteResponse.text()).includes('active legal hold')) throw new Error('workspace deletion was not blocked by legal hold')
		return hold.id
	}, { workspaceID: workspace.id })
	await page.evaluate(async ({ workspaceID, workspaceHoldID }) => {
		const token = sessionStorage.getItem('agentx_api_token') || ''
		const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
		const releaseResponse = await fetch(`/v1/admin/legal-holds/${workspaceHoldID}/release`, { method: 'POST', headers, body: JSON.stringify({ confirmation: 'RELEASE', reason: 'staging verification complete' }) })
		if (!releaseResponse.ok) throw new Error(await releaseResponse.text())
		const deleteResponse = await fetch(`/v1/workspaces/${workspaceID}`, { method: 'DELETE', headers })
		if (!deleteResponse.ok) throw new Error(await deleteResponse.text())
	}, { workspaceID: workspace.id, workspaceHoldID })

	await accountPage.getByRole('button', { name: 'Sign in with SSO' }).click()
	await accountPage.locator('input[name="login"]').fill('account@example.com')
	await accountPage.locator('input[name="password"]').fill(password)
	await accountPage.getByRole('button', { name: /login/i }).click()
	await expect(accountPage.getByRole('button', { name: 'Sign out' })).toBeVisible()
	const afterDeletion = await accountPage.evaluate(async () => {
		const token = sessionStorage.getItem('agentx_api_token') || ''
		const response = await fetch('/v1/me/export', { headers: { Authorization: `Bearer ${token}` } })
		if (!response.ok) throw new Error(await response.text())
		return response.json() as Promise<{ memberships: unknown[]; invitations: unknown[]; audit_events: unknown[] }>
	})
	expect(afterDeletion.memberships).toEqual([])
	expect(afterDeletion.invitations).toEqual([])
	expect(afterDeletion.audit_events).toEqual([])
	await accountContext.close()
})

test('completes CLI Device Flow and session lifecycle against Dex', async ({ page, browser }) => {
  test.skip(process.env.AGENTX_STAGING_E2E !== '1', 'requires the full staging compose stack')
  const email = process.env.AGENTX_STAGING_EMAIL || 'admin@example.com'
  const password = process.env.AGENTX_STAGING_PASSWORD || 'agentx-staging-password'
  const apiURL = process.env.AGENTX_STAGING_API_URL || 'http://localhost:8081'
  const cli = process.env.AGENTX_CLI_BIN || path.resolve(process.cwd(), '../../agentx-cli/target/debug/agentx')
  const home = await mkdtemp(path.join(tmpdir(), 'agentx-device-flow-'))
  const suffix = `${Date.now()}`
  let login: ChildProcessWithoutNullStreams | undefined

  try {
    await page.goto('/')
    await page.getByRole('button', { name: 'Sign in with SSO' }).click()
    await page.locator('input[name="login"]').fill(email)
    await page.locator('input[name="password"]').fill(password)
    await page.getByRole('button', { name: /login/i }).click()
    await expect(page).toHaveURL(/^http:\/\/localhost:5178\/?$/)
    const workspace = await page.evaluate(async ({ suffix }) => {
      const token = sessionStorage.getItem('agentx_api_token') || ''
      const response = await fetch('/v1/workspaces', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `CLI Device Flow ${suffix}`, slug: `cli-device-${suffix}` }),
      })
      if (!response.ok) throw new Error(`workspace creation failed: ${response.status} ${await response.text()}`)
      return await response.json() as { id: string }
    }, { suffix })

    const cliEnv = { ...process.env, HOME: home }
    login = spawn(cli, ['registry', 'login', apiURL, '--oidc'], { cwd: home, env: cliEnv })
    const instructions = await waitForDeviceInstructions(login)
    const loginFinished = waitForSuccess(login)

    const authContext = await browser.newContext()
    const authPage = await authContext.newPage()
    await authPage.goto(instructions.url)
    await authPage.locator('input[name="user_code"]').fill(instructions.code)
    await authPage.getByRole('button', { name: 'Submit' }).click()
    await expect(authPage).toHaveURL(/localhost:5556\/dex\/auth/)
    await authPage.locator('input[name="login"]').fill(email)
    await authPage.locator('input[name="password"]').fill(password)
    await authPage.getByRole('button', { name: /login/i }).click()
    await loginFinished
    await authContext.close()

    const run = async (...args: string[]) => execFileAsync(cli, args, { cwd: home, env: cliEnv })
    const listed = await run('registry', 'workspaces')
    expect(listed.stdout).toContain(workspace.id)
    await run('registry', 'use', workspace.id)
    const manifestPath = path.join(home, 'agentx.team.yaml')
    await run('team', 'pull', '--output', manifestPath)
    expect(await readFile(manifestPath, 'utf8')).toContain('version: 1')

    const credentialsPath = await findCredentials(home)
    expect(credentialsPath).toBeTruthy()
    const credentials = JSON.parse(await readFile(credentialsPath!, 'utf8')) as Record<string, unknown>
    expect(credentials.refresh_token).toBeTruthy()
    expect(credentials.expires_at).toEqual(expect.any(Number))
    expect(credentials.oidc).toEqual(expect.objectContaining({ client_id: 'agentx' }))
    expect((await stat(credentialsPath!)).mode & 0o777).toBe(0o600)

    await run('registry', 'logout')
    await expect(findCredentials(home)).resolves.toBeUndefined()
    await expect(run('registry', 'workspaces')).rejects.toThrow(/not logged in/)
  } finally {
    if (login?.exitCode === null) login.kill()
    await rm(home, { recursive: true, force: true })
  }
})
