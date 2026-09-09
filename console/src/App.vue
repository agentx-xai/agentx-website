<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts'

type Device = { id?: string; name: string; agent?: string; status?: string; updated_at?: string; installed_packages?: Record<string, string> }
type Release = { name: string; version: string; sha256: string; size?: number; signature_status?: string; signature?: string; status?: string }
type Workspace = { id: string; name: string; slug: string; created_at?: string }
type Member = { workspace_id: string; user_id: string; role: string; created_at?: string }
type Invitation = { id: string; workspace_id: string; workspace_name?: string; workspace_slug?: string; email: string; role: string; created_at: string; expires_at: string; status: 'pending' | 'accepted' | 'revoked' | 'expired' }
type Audit = { action: string; device_id?: string; resource_type?: string; resource_id?: string; at?: string }
type Drift = { device_id?: string; device_name: string; package: string; kind: string; expected_sha256: string; observed_sha256?: string }
type Policy = { revision: number; document: Record<string, unknown> }
type TeamManifest = { revision: number; document: Record<string, unknown> }
type Principal = { id: string; issuer?: string; subject?: string; email?: string; email_verified?: boolean }
type SiteConfig = { terms_url: string; privacy_url: string; support_url: string; abuse_email: string; security_email: string }
type Tab = 'overview' | 'registry' | 'workspace' | 'manifest' | 'policy' | 'audit' | 'account'

const api = import.meta.env.VITE_API_URL ?? ''
const deploymentMode = import.meta.env.VITE_DEPLOYMENT_MODE || (import.meta.env.PROD ? 'hosted' : 'local')
const hostedMode = deploymentMode === 'hosted'
const oidcIssuer = import.meta.env.VITE_OIDC_ISSUER || ''
const oidcClientID = import.meta.env.VITE_OIDC_CLIENT_ID || ''
const oidcRedirectURI = import.meta.env.VITE_OIDC_REDIRECT_URI || window.location.origin
const oidcScope = import.meta.env.VITE_OIDC_SCOPE || 'openid profile email offline_access'
const oidcAudience = import.meta.env.VITE_OIDC_AUDIENCE || ''
const configurationError = !['hosted', 'local'].includes(deploymentMode)
  ? 'Invalid Web deployment mode.'
  : hostedMode && (!oidcIssuer || !oidcClientID)
    ? 'Hosted authentication is not configured.'
    : ''
const oidcManager = !configurationError && oidcIssuer && oidcClientID ? new UserManager({
  authority: oidcIssuer.replace(/\/$/, ''),
  client_id: oidcClientID,
  redirect_uri: oidcRedirectURI,
  post_logout_redirect_uri: oidcRedirectURI,
  response_type: 'code',
  scope: oidcScope,
  ...(oidcAudience ? { extraQueryParams: { audience: oidcAudience } } : {}),
  stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  automaticSilentRenew: true,
  accessTokenExpiringNotificationTimeInSeconds: 30,
}) : null
const tab = ref<Tab>('overview')
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const authBusy = ref(false)
const token = ref(hostedMode ? '' : (sessionStorage.getItem('agentx_api_token') || ''))
const devices = ref<Device[]>([])
const releases = ref<Release[]>([])
const workspaces = ref<Workspace[]>([])
const members = ref<Member[]>([])
const myInvitations = ref<Invitation[]>([])
const workspaceInvitations = ref<Invitation[]>([])
const audit = ref<Audit[]>([])
const drift = ref<Drift[]>([])
const principal = ref<Principal>({ id: '' })
const siteConfig = ref<SiteConfig | null>(null)
const policy = ref<Policy>({ revision: 0, document: {} })
const policyText = ref('{}')
const emptyManifest = { version: 1, packages: [] }
const manifest = ref<TeamManifest>({ revision: 0, document: emptyManifest })
const manifestText = ref(JSON.stringify(emptyManifest, null, 2))
const currentWorkspaceId = ref(localStorage.getItem('agentx_workspace_id') || '')

const workspace = computed(() => workspaces.value.find(item => item.id === currentWorkspaceId.value) || workspaces.value[0])
const currentRole = computed(() => members.value.find(item => item.user_id === principal.value.id)?.role || '')
const roleRank: Record<string, number> = { viewer: 1, developer: 2, admin: 3, owner: 4 }
const canDevelop = computed(() => (roleRank[currentRole.value] || 0) >= roleRank.developer)
const canAdmin = computed(() => (roleRank[currentRole.value] || 0) >= roleRank.admin)
const isOwner = computed(() => currentRole.value === 'owner')
const latestPackages = computed(() => {
  const map = new Map<string, Release>()
  releases.value.forEach(release => { if (!map.has(release.name)) map.set(release.name, release) })
  return [...map.values()]
})

const forms = ref({
	workspaceName: '', workspaceSlug: '', invitationEmail: '', memberRole: 'developer', invitationDays: '7',
	deviceID: '', deviceName: '', deviceAgent: 'AgentX', deviceStatus: 'Ready',
	packageName: '', packageVersion: '', packageSignature: '', artifact: null as File | null,
	accountConfirmation: '',
})

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter(item => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true })
}

function collectionPage<T>(value: unknown): { items: T[]; nextCursor: string } {
  if (Array.isArray(value)) return { items: value as T[], nextCursor: '' }
  if (value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)) {
    const page = value as { items: T[]; next_cursor?: unknown }
    return { items: page.items, nextCursor: typeof page.next_cursor === 'string' ? page.next_cursor : '' }
  }
  throw new Error('Invalid collection response')
}

function requestHeaders(json = false): HeadersInit {
  const headers: Record<string, string> = {}
  if (json) headers['Content-Type'] = 'application/json'
  if (token.value.trim()) headers.Authorization = `Bearer ${token.value.trim()}`
  return headers
}

function setUserToken(user: User | null) {
  token.value = user?.access_token || ''
  if (token.value) sessionStorage.setItem('agentx_api_token', token.value)
  else sessionStorage.removeItem('agentx_api_token')
}

async function renewOIDCToken(): Promise<boolean> {
  if (!oidcManager) return false
  try {
    setUserToken(await oidcManager.signinSilent())
    return Boolean(token.value)
  } catch {
    await oidcManager.removeUser()
    setUserToken(null)
    return false
  }
}

async function apiFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const headers = new Headers(init.headers)
  if (token.value.trim() && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token.value.trim()}`)
  let response = await fetch(`${api}${path}`, { ...init, headers })
  if (response.status === 401 && retry && await renewOIDCToken()) {
    const renewedHeaders = new Headers(init.headers)
    renewedHeaders.set('Authorization', `Bearer ${token.value.trim()}`)
    response = await fetch(`${api}${path}`, { ...init, headers: renewedHeaders })
  }
  return response
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, { ...init, headers: { ...requestHeaders(false), ...(init.headers || {}) } })
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try { const body = await response.json(); message = body?.error?.message || body?.error || message } catch { /* response may not be JSON */ }
    throw new Error(message)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

async function fetchCollection<T>(path: string): Promise<T[]> {
  const items: T[] = []
  const cursors = new Set<string>()
  let cursor = ''
  for (let pageNumber = 0; pageNumber < 1000; pageNumber += 1) {
    const separator = path.includes('?') ? '&' : '?'
    const value = await request<unknown>(`${path}${separator}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    const page = collectionPage<T>(value)
    items.push(...page.items)
    if (!page.nextCursor) return items
    if (cursors.has(page.nextCursor)) throw new Error('Collection pagination returned a repeated cursor')
    cursors.add(page.nextCursor)
    cursor = page.nextCursor
  }
  throw new Error('Collection pagination exceeded 1000 pages')
}

async function loadSiteConfig() {
  const response = await fetch(`${api}/v1/site/config`)
  if (response.status === 404 && !hostedMode) return
  if (!response.ok) throw new Error('Unable to load site information')
  siteConfig.value = await response.json() as SiteConfig
}

async function scoped<T>(path: string, fallback: string): Promise<T[]> {
  if (workspace.value) {
    return fetchCollection<T>(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}${path}`)
  }
  if (hostedMode) return []
  return fetchCollection<T>(fallback)
}

async function loadData() {
  loading.value = true; error.value = ''
  try {
    const [me, workspaceData] = await Promise.all([
      request<Principal>('/v1/me'),
      fetchCollection<Workspace>('/v1/workspaces'),
    ])
    principal.value = me
    workspaces.value = workspaceData
	myInvitations.value = me.email_verified ? await fetchCollection<Invitation>('/v1/invitations') : []
    if (!workspaces.value.some(item => item.id === currentWorkspaceId.value)) currentWorkspaceId.value = workspaces.value[0]?.id || ''
    const [deviceData, releaseData, auditData, driftData] = await Promise.all([
      scoped<Device>('/devices', '/v1/devices'),
      scoped<Release>('/packages', '/v1/packages'),
      scoped<Audit>('/audit-events', '/v1/audit-events'),
      scoped<Drift>('/drift', '/v1/drift'),
    ])
    devices.value = uniqueBy(deviceData, item => item.id || item.name)
    releases.value = uniqueBy(releaseData, item => `${item.name}:${item.version}:${item.sha256}`)
    audit.value = uniqueBy(auditData, item => `${item.action}:${item.at}:${item.device_id || ''}`)
    drift.value = uniqueBy(driftData, item => `${item.device_id || item.device_name}:${item.package}:${item.kind}`)
    if (workspace.value) {
      members.value = await fetchCollection<Member>(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}/members`)
	  workspaceInvitations.value = canAdmin.value ? await fetchCollection<Invitation>(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}/invitations`) : []
      const policyData = await request<unknown>(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}/policies`)
      if (policyData && typeof policyData === 'object' && 'document' in policyData) {
        policy.value = policyData as Policy
        policyText.value = JSON.stringify(policy.value.document || {}, null, 2)
      }
      const manifestData = await request<unknown>(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}/manifest`)
      if (manifestData && typeof manifestData === 'object' && 'document' in manifestData) {
        manifest.value = manifestData as TeamManifest
        manifestText.value = JSON.stringify(manifest.value.document || {}, null, 2)
      }
    } else {
      members.value = []
	  workspaceInvitations.value = []
      policy.value = { revision: 0, document: {} }
      policyText.value = '{}'
      manifest.value = { revision: 0, document: emptyManifest }
      manifestText.value = JSON.stringify(emptyManifest, null, 2)
    }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Unable to load the console' } finally { loading.value = false }
}

function flash(message: string) { notice.value = message; window.setTimeout(() => { if (notice.value === message) notice.value = '' }, 3500) }
function fail(cause: unknown) { error.value = cause instanceof Error ? cause.message : 'The operation failed' }
function selectWorkspace(id: string) { currentWorkspaceId.value = id; localStorage.setItem('agentx_workspace_id', id); void loadData() }
function saveToken() { if (hostedMode) return; const value = token.value.trim(); if (value) sessionStorage.setItem('agentx_api_token', value); else sessionStorage.removeItem('agentx_api_token'); flash(value ? 'API token saved for this tab' : 'API token cleared'); void loadData() }
async function signInWithOIDC() {
  if (!oidcManager) return
  authBusy.value = true; error.value = ''
  try {
    await oidcManager.signinRedirect()
  } catch (cause) { fail(cause); authBusy.value = false }
}
async function restoreOIDCSession() {
  if (!oidcManager) return
  const query = new URLSearchParams(window.location.search)
  authBusy.value = true
  try {
    const user = query.has('code') && query.has('state')
      ? await oidcManager.signinRedirectCallback()
      : await oidcManager.getUser()
    setUserToken(user)
    if (query.has('code')) {
      window.history.replaceState({}, document.title, window.location.pathname)
      flash('Signed in')
    }
  } catch (cause) { fail(cause) } finally { authBusy.value = false }
}
function clearData() { devices.value = []; releases.value = []; workspaces.value = []; members.value = []; myInvitations.value = []; workspaceInvitations.value = []; audit.value = []; drift.value = []; principal.value = { id: '' } }
async function signOut() { if (oidcManager) await oidcManager.removeUser(); setUserToken(null); clearData(); flash('Signed out'); if (!hostedMode) await loadData() }

async function createWorkspace() {
  saving.value = true; error.value = ''
  try {
    const created = await request<Workspace>('/v1/workspaces', { method: 'POST', headers: requestHeaders(true), body: JSON.stringify({ name: forms.value.workspaceName, slug: forms.value.workspaceSlug }) })
    forms.value.workspaceName = ''; forms.value.workspaceSlug = ''; flash(`Workspace ${created.name} created`); await loadData(); selectWorkspace(created.id)
  } catch (cause) { fail(cause) } finally { saving.value = false }
}
async function createInvitation() {
  if (!workspace.value || !canAdmin.value) return
  saving.value = true; error.value = ''
  try {
	const created = await request<Invitation>(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}/invitations`, { method: 'POST', headers: requestHeaders(true), body: JSON.stringify({ email: forms.value.invitationEmail, role: forms.value.memberRole, expires_in_seconds: Number(forms.value.invitationDays) * 86400 }) })
    forms.value.invitationEmail = ''; workspaceInvitations.value = [created, ...workspaceInvitations.value]; flash('Invitation created')
  } catch (cause) { fail(cause) } finally { saving.value = false }
}
async function claimInvitation(invitation: Invitation) {
  if (!principal.value.email_verified || invitation.status !== 'pending') return
  saving.value = true; error.value = ''
  try {
	await request<Invitation>(`/v1/invitations/${encodeURIComponent(invitation.id)}/claim`, { method: 'POST' })
	flash(`Joined ${invitation.workspace_name || invitation.workspace_slug || 'workspace'}`); await loadData()
  } catch (cause) { fail(cause) } finally { saving.value = false }
}
async function revokeInvitation(invitation: Invitation) {
  if (!workspace.value || !canAdmin.value || invitation.status !== 'pending' || !window.confirm(`Revoke the invitation for ${invitation.email}?`)) return
  saving.value = true; error.value = ''
  try {
	await request(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}/invitations/${encodeURIComponent(invitation.id)}`, { method: 'DELETE' })
	invitation.status = 'revoked'; flash('Invitation revoked')
  } catch (cause) { fail(cause) } finally { saving.value = false }
}
async function updateMemberRole(member: Member, role: string) {
  if (!workspace.value || !canAdmin.value || member.role === role) return
  const previous = member.role
  member.role = role
  try {
    await request(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}/members/${encodeURIComponent(member.user_id)}`, { method: 'PATCH', headers: requestHeaders(true), body: JSON.stringify({ role }) })
    flash('Member role updated')
  } catch (cause) { member.role = previous; fail(cause) }
}
async function removeMember(member: Member) {
  if (!workspace.value || !canAdmin.value || member.role === 'owner' || !window.confirm(`Remove ${member.user_id} from ${workspace.value.name}?`)) return
  saving.value = true; error.value = ''
  try {
    await request(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}/members/${encodeURIComponent(member.user_id)}`, { method: 'DELETE' })
    members.value = members.value.filter(item => item.user_id !== member.user_id); flash('Member removed')
  } catch (cause) { fail(cause) } finally { saving.value = false }
}
async function deleteWorkspace() {
  if (!workspace.value || !isOwner.value || !window.confirm(`Delete workspace ${workspace.value.name}? This cannot be undone.`)) return
  saving.value = true; error.value = ''
  try {
    await request(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}`, { method: 'DELETE' })
    currentWorkspaceId.value = ''; localStorage.removeItem('agentx_workspace_id'); flash('Workspace deleted'); await loadData()
  } catch (cause) { fail(cause) } finally { saving.value = false }
}
async function registerDevice() {
  if (!workspace.value || !canDevelop.value) return
  saving.value = true; error.value = ''
  try {
    const device = await request<Device>(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}/devices`, { method: 'POST', headers: { ...requestHeaders(true), 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ id: forms.value.deviceID || undefined, name: forms.value.deviceName, agent: forms.value.deviceAgent, status: forms.value.deviceStatus }) })
    devices.value = [device, ...devices.value.filter(item => item.id !== device.id)]; forms.value.deviceID = ''; forms.value.deviceName = ''; flash('Device registered')
  } catch (cause) { fail(cause) } finally { saving.value = false }
}
async function publishRelease() {
  if (!workspace.value || !canDevelop.value || !forms.value.artifact) return
  saving.value = true; error.value = ''
  try {
    const body = new FormData(); body.append('version', forms.value.packageVersion); body.append('artifact', forms.value.artifact); if (forms.value.packageSignature) body.append('signature', forms.value.packageSignature)
    const release = await request<Release>(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}/packages/${encodeURIComponent(forms.value.packageName)}/releases`, { method: 'POST', headers: { ...(token.value.trim() ? { Authorization: `Bearer ${token.value.trim()}` } : {}), 'Idempotency-Key': crypto.randomUUID() }, body })
    releases.value = [release, ...releases.value]; forms.value.packageName = ''; forms.value.packageVersion = ''; forms.value.packageSignature = ''; forms.value.artifact = null; flash(`${release.name} ${release.version} published`)
  } catch (cause) { fail(cause) } finally { saving.value = false }
}
async function approveRelease(release: Release) {
  if (!workspace.value || !canAdmin.value || release.status !== 'pending_approval') return
  saving.value = true; error.value = ''
  try {
    const approved = await request<Release>(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}/packages/${encodeURIComponent(release.name)}/${encodeURIComponent(release.version)}/approve`, { method: 'POST' })
    const index = releases.value.findIndex(item => item.name === release.name && item.version === release.version)
    if (index >= 0) releases.value[index] = { ...releases.value[index], ...approved }
    flash(`${release.name} ${release.version} approved`)
  } catch (cause) { fail(cause) } finally { saving.value = false }
}
async function savePolicy() {
  if (!workspace.value || !canAdmin.value) return
  saving.value = true; error.value = ''
  try {
    const document = JSON.parse(policyText.value) as Record<string, unknown>
    const saved = await request<Policy>(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}/policies`, { method: 'PUT', headers: requestHeaders(true), body: JSON.stringify({ document }) })
    policy.value = saved; policyText.value = JSON.stringify(saved.document || {}, null, 2); flash(`Policy revision ${saved.revision} saved`)
  } catch (cause) { fail(cause) } finally { saving.value = false }
}
async function saveManifest() {
  if (!workspace.value || !canAdmin.value) return
  saving.value = true; error.value = ''
  try {
    const document = JSON.parse(manifestText.value) as Record<string, unknown>
    const saved = await request<TeamManifest>(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}/manifest`, { method: 'PUT', headers: requestHeaders(true), body: JSON.stringify({ document }) })
    manifest.value = saved; manifestText.value = JSON.stringify(saved.document || {}, null, 2); flash(`Manifest revision ${saved.revision} saved`)
  } catch (cause) { fail(cause) } finally { saving.value = false }
}
async function downloadRelease(release: Release) {
  const prefix = workspace.value ? `/v1/workspaces/${encodeURIComponent(workspace.value.id)}` : ''
  try {
    const response = await apiFetch(`${prefix}/artifacts/${encodeURIComponent(release.sha256)}`)
    if (!response.ok) throw new Error(`Download failed (${response.status})`)
    const href = URL.createObjectURL(await response.blob())
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `${release.name}-${release.version}.artifact`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(href)
    flash(`${release.name} ${release.version} downloaded`)
  } catch (cause) { fail(cause) }
}

async function downloadAccountExport() {
	saving.value = true; error.value = ''
	try {
		const response = await apiFetch('/v1/me/export')
		if (!response.ok) {
			let message = `Export failed (${response.status})`
			try { const body = await response.json(); message = body?.error?.message || message } catch { /* response may not be JSON */ }
			throw new Error(message)
		}
		const href = URL.createObjectURL(await response.blob())
		const anchor = document.createElement('a')
		anchor.href = href
		anchor.download = 'agentx-account-export.json'
		document.body.appendChild(anchor)
		anchor.click()
		anchor.remove()
		URL.revokeObjectURL(href)
		flash('Account data exported')
	} catch (cause) { fail(cause) } finally { saving.value = false }
}

async function deleteAccount() {
	if (forms.value.accountConfirmation !== 'DELETE') return
	saving.value = true; error.value = ''
	try {
		await request('/v1/me', { method: 'DELETE', headers: requestHeaders(true), body: JSON.stringify({ confirmation: forms.value.accountConfirmation }) })
		forms.value.accountConfirmation = ''
		localStorage.removeItem('agentx_workspace_id')
		currentWorkspaceId.value = ''
		if (oidcManager) await oidcManager.removeUser()
		setUserToken(null)
		clearData()
		flash('Account deleted')
	} catch (cause) { fail(cause) } finally { saving.value = false }
}

if (oidcManager) {
  oidcManager.events.addUserLoaded(setUserToken)
  oidcManager.events.addUserUnloaded(() => { setUserToken(null); clearData() })
  oidcManager.events.addAccessTokenExpired(() => { void renewOIDCToken().then(ok => { if (!ok) fail(new Error('Your session expired. Sign in again.')) }) })
  oidcManager.events.addSilentRenewError(() => fail(new Error('Unable to renew your session. Sign in again.')))
}
watch(currentWorkspaceId, id => { if (id) localStorage.setItem('agentx_workspace_id', id) })
onMounted(() => {
  if (configurationError) { loading.value = false; return }
	void loadSiteConfig().then(() => restoreOIDCSession()).then(() => {
    if (hostedMode && !token.value) { loading.value = false; return }
    return loadData()
	}).catch(cause => { fail(cause); loading.value = false })
})
</script>

<template>
  <main>
    <header><div><p class="eyebrow">AGENTX REGISTRY</p><h1>Agent environments</h1><p class="muted">Reproducible packages, access and device state for your teams.</p></div><div v-if="!configurationError" class="header-actions"><button v-if="oidcManager && !token" class="secondary" :disabled="authBusy" @click="signInWithOIDC">{{ authBusy ? 'Signing in...' : 'Sign in with SSO' }}</button><template v-if="!hostedMode && !oidcManager"><label class="token-field"><span>API token</span><input v-model="token" type="password" placeholder="Optional" @keyup.enter="saveToken"></label><button class="secondary" @click="saveToken">Use token</button></template><button v-if="token" class="secondary" @click="signOut">Sign out</button><button v-if="token" @click="tab='workspace'">Create workspace</button></div></header>
    <p v-if="configurationError" class="error" role="alert">{{ configurationError }}</p>
    <template v-if="!configurationError">
    <div v-if="workspaces.length" class="workspace-bar"><label for="workspace-select">Workspace</label><select id="workspace-select" :value="workspace?.id" @change="selectWorkspace(($event.target as HTMLSelectElement).value)"><option v-for="item in workspaces" :key="item.id" :value="item.id">{{ item.name }} · {{ item.slug }}</option></select><button class="icon-button" title="Refresh" aria-label="Refresh" @click="loadData">↻</button></div>
	    <nav class="tabs" aria-label="Primary"><button :class="{active:tab==='overview'}" @click="tab='overview'">Overview</button><button :class="{active:tab==='registry'}" @click="tab='registry'">Registry</button><button :class="{active:tab==='workspace'}" @click="tab='workspace'">Workspace</button><button :class="{active:tab==='manifest'}" @click="tab='manifest'">Manifest</button><button :class="{active:tab==='policy'}" @click="tab='policy'">Policy</button><button :class="{active:tab==='audit'}" @click="tab='audit'">Audit</button><button :class="{active:tab==='account'}" @click="tab='account'">Account</button></nav>
    <p v-if="error" class="error" role="alert">{{ error }} <button class="dismiss" @click="error=''">Dismiss</button></p><p v-if="notice" class="notice" role="status">{{ notice }}</p>

    <template v-if="tab==='overview'"><section class="stats"><div><span>Packages</span><strong>{{ latestPackages.length }}</strong></div><div><span>Devices</span><strong>{{ loading ? '...' : devices.length }}</strong></div><div><span>Drift items</span><strong :class="{warn:drift.length}">{{ drift.length }}</strong></div></section><section class="panel"><div class="panel-head"><div><h2>Devices</h2><p class="muted">Registered agents in this workspace</p></div><button class="link" @click="tab='audit'">View audit</button></div><div v-if="canDevelop" class="form-grid compact"><input v-model="forms.deviceName" placeholder="Device name"><input v-model="forms.deviceID" placeholder="Device ID (optional)"><input v-model="forms.deviceAgent" placeholder="Agent"><select v-model="forms.deviceStatus"><option>Ready</option><option>online</option><option>offline</option></select><button :disabled="saving || !workspace || !forms.deviceName" @click="registerDevice">Register device</button></div><table><thead><tr><th>Device</th><th>Agent</th><th>Status</th><th>Last seen</th></tr></thead><tbody><tr v-for="device in devices" :key="device.id || device.name"><td>{{ device.name }}</td><td>{{ device.agent || 'AgentX' }}</td><td><span :class="['badge', device.status === 'Ready' || device.status === 'Local mode' || device.status === 'online' ? 'ok' : 'warning']">{{ device.status || 'Unknown' }}</span></td><td>{{ device.updated_at ? new Date(device.updated_at).toLocaleString() : '-' }}</td></tr><tr v-if="!loading && !devices.length"><td colspan="4" class="empty">No devices registered</td></tr></tbody></table></section><section class="panel"><div class="panel-head"><div><h2>Drift</h2><p class="muted">Differences between installed and expected packages</p></div><button class="link" @click="loadData">Refresh</button></div><table><thead><tr><th>Device</th><th>Package</th><th>Kind</th><th>Expected</th><th>Observed</th></tr></thead><tbody><tr v-for="item in drift" :key="`${item.device_id}-${item.package}`"><td>{{ item.device_name }}</td><td>{{ item.package }}</td><td><span class="badge warning">{{ item.kind }}</span></td><td><code>{{ item.expected_sha256 ? item.expected_sha256.slice(0, 12) + '...' : '-' }}</code></td><td><code>{{ item.observed_sha256 ? item.observed_sha256.slice(0, 12) + '...' : '-' }}</code></td></tr><tr v-if="!drift.length"><td colspan="5" class="empty">No drift detected</td></tr></tbody></table></section></template>

    <template v-else-if="tab==='registry'"><section v-if="canDevelop" class="panel"><div class="panel-head"><div><h2>Publish release</h2><p class="muted">Upload an immutable package artifact</p></div></div><div class="form-grid"><input v-model="forms.packageName" placeholder="Package name"><input v-model="forms.packageVersion" placeholder="Version, e.g. 1.2.3"><input v-model="forms.packageSignature" class="wide" placeholder="Ed25519 signature (optional when server signing is disabled)"><input class="wide" type="file" @change="forms.artifact=(($event.target as HTMLInputElement).files || [])[0] || null"><button :disabled="saving || !workspace || !forms.packageName || !forms.packageVersion || !forms.artifact" @click="publishRelease">Publish release</button></div></section><section class="panel"><div class="panel-head"><div><h2>Registry releases</h2><p class="muted">{{ releases.length }} immutable releases</p></div><button class="link" @click="loadData">Refresh</button></div><table><thead><tr><th>Package</th><th>Version</th><th>SHA-256</th><th>Signature</th><th>Status</th><th></th></tr></thead><tbody><tr v-for="release in releases" :key="`${release.name}-${release.version}-${release.sha256}`"><td>{{ release.name }}</td><td>{{ release.version }}</td><td><code>{{ release.sha256.slice(0, 12) }}...</code></td><td><span :class="['badge', release.signature_status === 'verified' ? 'ok' : 'warning']">{{ release.signature_status || 'Unsigned' }}</span></td><td><span :class="['badge', release.status === 'approved' || release.status === 'published' ? 'ok' : 'warning']">{{ release.status || 'published' }}</span></td><td><button v-if="canAdmin && release.status === 'pending_approval'" class="link" @click="approveRelease(release)">Approve</button><button v-if="release.status !== 'pending_approval'" class="link" @click="downloadRelease(release)">Download</button></td></tr><tr v-if="!releases.length"><td colspan="6" class="empty">No releases published</td></tr></tbody></table></section></template>

    <template v-else-if="tab==='workspace'">
      <section v-if="myInvitations.length" class="panel">
        <div class="panel-head"><div><h2>Invitations for you</h2><p class="muted">{{ myInvitations.length }} pending</p></div></div>
        <table><thead><tr><th>Workspace</th><th>Role</th><th>Expires</th><th></th></tr></thead><tbody><tr v-for="invitation in myInvitations" :key="invitation.id"><td>{{ invitation.workspace_name || invitation.workspace_slug || invitation.workspace_id }}</td><td><span class="badge">{{ invitation.role }}</span></td><td>{{ new Date(invitation.expires_at).toLocaleString() }}</td><td><button :disabled="saving" @click="claimInvitation(invitation)">Join</button></td></tr></tbody></table>
      </section>
      <section class="panel"><div class="panel-head"><div><h2>Create workspace</h2><p class="muted">Create an isolated team boundary</p></div></div><div class="form-grid"><input v-model="forms.workspaceName" placeholder="Workspace name"><input v-model="forms.workspaceSlug" placeholder="workspace-slug"><button :disabled="saving || !forms.workspaceName || !forms.workspaceSlug" @click="createWorkspace">Create workspace</button></div></section>
      <section class="panel"><div class="panel-head"><div><h2>Workspaces</h2><p class="muted">Role based access</p></div></div><table><thead><tr><th>Name</th><th>Slug</th><th>ID</th><th></th></tr></thead><tbody><tr v-for="item in workspaces" :key="item.id"><td>{{ item.name }}</td><td>{{ item.slug }}</td><td><code>{{ item.id.slice(0, 12) }}...</code></td><td><button class="link" @click="selectWorkspace(item.id)">Open</button></td></tr><tr v-if="!workspaces.length"><td colspan="4" class="empty">No workspaces available</td></tr></tbody></table></section>
      <section v-if="workspace" class="panel">
        <div class="panel-head"><div><h2>Members</h2><p class="muted">{{ workspace.name }} access</p></div><button v-if="isOwner" class="danger" :disabled="saving" @click="deleteWorkspace">Delete workspace</button></div>
        <div v-if="canAdmin" class="form-grid compact"><input v-model="forms.invitationEmail" type="email" placeholder="Verified email address"><select v-model="forms.memberRole"><option value="viewer">Viewer</option><option value="developer">Developer</option><option value="admin">Admin</option></select><select v-model="forms.invitationDays" aria-label="Invitation expiry"><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option></select><button :disabled="saving || !forms.invitationEmail" @click="createInvitation">Create invitation</button></div>
        <table><thead><tr><th>User</th><th>Role</th><th>Joined</th><th></th></tr></thead><tbody><tr v-for="member in members" :key="member.user_id"><td><code>{{ member.user_id }}</code></td><td><select :value="member.role" :disabled="!canAdmin || member.role === 'owner'" aria-label="Member role" @change="updateMemberRole(member, ($event.target as HTMLSelectElement).value)"><option value="owner">Owner</option><option value="viewer">Viewer</option><option value="developer">Developer</option><option value="admin">Admin</option></select></td><td>{{ member.created_at ? new Date(member.created_at).toLocaleString() : '-' }}</td><td><button v-if="canAdmin && member.role !== 'owner'" class="link danger-text" @click="removeMember(member)">Remove</button></td></tr><tr v-if="!members.length"><td colspan="4" class="empty">No members available</td></tr></tbody></table>
        <template v-if="canAdmin"><div class="panel-head subsection"><div><h3>Invitation history</h3><p class="muted">{{ workspaceInvitations.length }} records</p></div></div><table><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Expires</th><th></th></tr></thead><tbody><tr v-for="invitation in workspaceInvitations" :key="invitation.id"><td>{{ invitation.email }}</td><td>{{ invitation.role }}</td><td><span :class="['badge', invitation.status === 'accepted' ? 'ok' : invitation.status === 'pending' ? 'warning' : '']">{{ invitation.status }}</span></td><td>{{ new Date(invitation.expires_at).toLocaleString() }}</td><td><button v-if="invitation.status === 'pending'" class="link danger-text" @click="revokeInvitation(invitation)">Revoke</button></td></tr><tr v-if="!workspaceInvitations.length"><td colspan="5" class="empty">No invitations</td></tr></tbody></table></template>
      </section>
    </template>

    <template v-else-if="tab==='manifest'"><section class="panel"><div class="panel-head"><div><h2>Team manifest</h2><p class="muted">Revision {{ manifest.revision }} · admin access required to save</p></div><button class="link" @click="loadData">Refresh</button></div><div class="policy-editor"><textarea v-model="manifestText" rows="18" spellcheck="false" aria-label="Team manifest JSON" :readonly="!canAdmin"></textarea><button v-if="canAdmin" :disabled="saving || !workspace" @click="saveManifest">Save manifest</button></div></section></template>
    <template v-else-if="tab==='policy'"><section class="panel"><div class="panel-head"><div><h2>Workspace policy</h2><p class="muted">Revision {{ policy.revision }} · admin access required to save</p></div><button class="link" @click="loadData">Refresh</button></div><div class="policy-editor"><textarea v-model="policyText" rows="18" spellcheck="false" aria-label="Policy JSON" :readonly="!canAdmin"></textarea><button v-if="canAdmin" :disabled="saving || !workspace" @click="savePolicy">Save policy</button></div></section></template>
	    <template v-else-if="tab==='audit'"><section class="panel"><div class="panel-head"><div><h2>Audit events</h2><p class="muted">Append-only activity for {{ workspace?.name || 'this installation' }}</p></div><button class="link" @click="loadData">Refresh</button></div><table><thead><tr><th>Action</th><th>Resource</th><th>Time</th></tr></thead><tbody><tr v-for="event in audit" :key="`${event.action}-${event.at}-${event.device_id}-${event.resource_id}`"><td>{{ event.action }}</td><td>{{ event.resource_type ? `${event.resource_type}: ${event.resource_id}` : (event.device_id || '-') }}</td><td>{{ event.at ? new Date(event.at).toLocaleString() : '-' }}</td></tr><tr v-if="!audit.length"><td colspan="3" class="empty">No audit events</td></tr></tbody></table></section></template>
	    <template v-else><section class="panel"><div class="panel-head"><div><h2>Account data</h2><p class="muted">{{ principal.email || principal.id }}</p></div><button :disabled="saving || !principal.id" @click="downloadAccountExport">Download JSON</button></div><table><tbody><tr><th>User ID</th><td><code>{{ principal.id || '-' }}</code></td></tr><tr><th>Email</th><td>{{ principal.email || '-' }}</td></tr><tr><th>Email verified</th><td><span :class="['badge', principal.email_verified ? 'ok' : 'warning']">{{ principal.email_verified ? 'Verified' : 'Not verified' }}</span></td></tr></tbody></table><div class="account-delete"><label for="account-confirmation">Deletion confirmation</label><input id="account-confirmation" v-model="forms.accountConfirmation" autocomplete="off" placeholder="DELETE"><button class="danger" :disabled="saving || forms.accountConfirmation !== 'DELETE'" @click="deleteAccount">Delete account</button></div></section></template>
	</template>
	<footer v-if="siteConfig"><a :href="siteConfig.terms_url">Terms</a><a :href="siteConfig.privacy_url">Privacy</a><a :href="siteConfig.support_url">Support</a><a :href="`mailto:${siteConfig.abuse_email}`">Abuse</a><a :href="`mailto:${siteConfig.security_email}`">Security</a></footer>
  </main>
</template>
