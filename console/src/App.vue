<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

type Device = { id?: string; name: string; agent?: string; status?: string; updated_at?: string; installed_packages?: Record<string, string> }
type Release = { name: string; version: string; sha256: string; size?: number; signature_status?: string; signature?: string; status?: string }
type Workspace = { id: string; name: string; slug: string; created_at?: string }
type Member = { workspace_id: string; user_id: string; role: string; created_at?: string }
type Audit = { action: string; device_id?: string; resource_type?: string; resource_id?: string; at?: string }
type Drift = { device_id?: string; device_name: string; package: string; kind: string; expected_sha256: string; observed_sha256?: string }
type Policy = { revision: number; document: Record<string, unknown> }
type TeamManifest = { revision: number; document: Record<string, unknown> }
type Tab = 'overview' | 'registry' | 'workspace' | 'manifest' | 'policy' | 'audit'

const api = import.meta.env.VITE_API_URL || 'http://localhost:8080'
const oidcIssuer = import.meta.env.VITE_OIDC_ISSUER || ''
const oidcClientID = import.meta.env.VITE_OIDC_CLIENT_ID || ''
const oidcRedirectURI = import.meta.env.VITE_OIDC_REDIRECT_URI || window.location.origin
const tab = ref<Tab>('overview')
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const authBusy = ref(false)
const token = ref(localStorage.getItem('agentx_api_token') || import.meta.env.VITE_API_TOKEN || '')
const devices = ref<Device[]>([])
const releases = ref<Release[]>([])
const workspaces = ref<Workspace[]>([])
const members = ref<Member[]>([])
const audit = ref<Audit[]>([])
const drift = ref<Drift[]>([])
const policy = ref<Policy>({ revision: 0, document: {} })
const policyText = ref('{}')
const manifest = ref<TeamManifest>({ revision: 0, document: {} })
const manifestText = ref('{}')
const currentWorkspaceId = ref(localStorage.getItem('agentx_workspace_id') || '')

const workspace = computed(() => workspaces.value.find(item => item.id === currentWorkspaceId.value) || workspaces.value[0])
const latestPackages = computed(() => {
  const map = new Map<string, Release>()
  releases.value.forEach(release => { if (!map.has(release.name)) map.set(release.name, release) })
  return [...map.values()]
})

const forms = ref({
  workspaceName: '', workspaceSlug: '', memberUserID: '', memberRole: 'developer',
  deviceID: '', deviceName: '', deviceAgent: 'AgentX', deviceStatus: 'Ready',
  packageName: '', packageVersion: '', packageSignature: '', artifact: null as File | null,
})

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter(item => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true })
}

function collectionItems<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)) return (value as { items: T[] }).items
  throw new Error('Invalid collection response')
}

function requestHeaders(json = false): HeadersInit {
  const headers: Record<string, string> = {}
  if (json) headers['Content-Type'] = 'application/json'
  if (token.value.trim()) headers.Authorization = `Bearer ${token.value.trim()}`
  return headers
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${api}${path}`, { ...init, headers: { ...requestHeaders(false), ...(init.headers || {}) } })
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try { const body = await response.json(); message = body?.error?.message || body?.error || message } catch { /* response may not be JSON */ }
    throw new Error(message)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

async function scoped<T>(path: string, fallback: string): Promise<T[]> {
  if (workspace.value) {
    return collectionItems<T>(await request<unknown>(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}${path}?limit=200`))
  }
  return collectionItems<T>(await request<unknown>(`${fallback}?limit=200`))
}

async function loadData() {
  loading.value = true; error.value = ''
  try {
    workspaces.value = collectionItems<Workspace>(await request<unknown>('/v1/workspaces?limit=200'))
    if (!workspaces.value.some(item => item.id === currentWorkspaceId.value)) currentWorkspaceId.value = workspaces.value[0]?.id || ''
    const [deviceData, releaseData, auditData, driftData] = await Promise.all([
      scoped<Device>('/devices', '/v1/devices'),
      scoped<Release>('/packages', '/v1/packages'),
      scoped<Audit>('/audit-events', '/v1/audit-events'),
      request<unknown>(workspace.value ? `/v1/workspaces/${encodeURIComponent(workspace.value.id)}/drift?limit=200` : '/v1/drift?limit=200'),
    ])
    devices.value = uniqueBy(deviceData, item => item.id || item.name)
    releases.value = uniqueBy(releaseData, item => `${item.name}:${item.version}:${item.sha256}`)
    audit.value = uniqueBy(auditData, item => `${item.action}:${item.at}:${item.device_id || ''}`)
    drift.value = uniqueBy(collectionItems<Drift>(driftData), item => `${item.device_id || item.device_name}:${item.package}:${item.kind}`)
    if (workspace.value) {
      const memberData = await request<unknown>(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}/members?limit=200`)
      members.value = collectionItems<Member>(memberData)
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
    } else members.value = []
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Unable to load the console' } finally { loading.value = false }
}

function flash(message: string) { notice.value = message; window.setTimeout(() => { if (notice.value === message) notice.value = '' }, 3500) }
function fail(cause: unknown) { error.value = cause instanceof Error ? cause.message : 'The operation failed' }
function selectWorkspace(id: string) { currentWorkspaceId.value = id; localStorage.setItem('agentx_workspace_id', id); void loadData() }
function saveToken() { const value = token.value.trim(); if (value) localStorage.setItem('agentx_api_token', value); else localStorage.removeItem('agentx_api_token'); flash(value ? 'API token saved' : 'API token cleared'); void loadData() }
function base64url(bytes: ArrayBuffer) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
function randomString(size = 32) { const bytes = new Uint8Array(size); crypto.getRandomValues(bytes); return base64url(bytes) }
async function signInWithOIDC() {
  if (!oidcIssuer || !oidcClientID) return
  authBusy.value = true; error.value = ''
  try {
    const discovery = await fetch(`${oidcIssuer.replace(/\/$/, '')}/.well-known/openid-configuration`).then(response => { if (!response.ok) throw new Error('OIDC discovery failed'); return response.json() }) as { authorization_endpoint: string; token_endpoint: string }
    const verifier = randomString(48)
    const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
    const state = randomString(24)
    localStorage.setItem('agentx_oidc_state', state)
    localStorage.setItem('agentx_oidc_verifier', verifier)
    localStorage.setItem('agentx_oidc_token_endpoint', discovery.token_endpoint)
    const params = new URLSearchParams({ client_id: oidcClientID, redirect_uri: oidcRedirectURI, response_type: 'code', scope: 'openid profile email', state, code_challenge: challenge, code_challenge_method: 'S256' })
    window.location.assign(`${discovery.authorization_endpoint}?${params.toString()}`)
  } catch (cause) { fail(cause); authBusy.value = false }
}
async function completeOIDCLogin() {
  const query = new URLSearchParams(window.location.search)
  const code = query.get('code')
  if (!code) return
  const expectedState = localStorage.getItem('agentx_oidc_state')
  if (!expectedState || query.get('state') !== expectedState) { fail(new Error('OIDC state validation failed')); return }
  const endpoint = localStorage.getItem('agentx_oidc_token_endpoint')
  const verifier = localStorage.getItem('agentx_oidc_verifier')
  if (!endpoint || !verifier) { fail(new Error('OIDC login session expired')); return }
  authBusy.value = true
  try {
    const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: oidcClientID, redirect_uri: oidcRedirectURI, code, code_verifier: verifier })
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
    if (!response.ok) throw new Error('OIDC token exchange failed')
    const result = await response.json() as { id_token?: string; access_token?: string }
    token.value = result.id_token || result.access_token || ''
    if (!token.value) throw new Error('OIDC response did not contain a token')
    localStorage.setItem('agentx_api_token', token.value)
    localStorage.removeItem('agentx_oidc_state'); localStorage.removeItem('agentx_oidc_verifier'); localStorage.removeItem('agentx_oidc_token_endpoint')
    window.history.replaceState({}, document.title, window.location.pathname)
    flash('Signed in'); await loadData()
  } catch (cause) { fail(cause) } finally { authBusy.value = false }
}
function signOut() { token.value = ''; localStorage.removeItem('agentx_api_token'); flash('Signed out'); void loadData() }

async function createWorkspace() {
  saving.value = true; error.value = ''
  try {
    const created = await request<Workspace>('/v1/workspaces', { method: 'POST', headers: requestHeaders(true), body: JSON.stringify({ name: forms.value.workspaceName, slug: forms.value.workspaceSlug }) })
    forms.value.workspaceName = ''; forms.value.workspaceSlug = ''; flash(`Workspace ${created.name} created`); await loadData(); selectWorkspace(created.id)
  } catch (cause) { fail(cause) } finally { saving.value = false }
}
async function inviteMember() {
  if (!workspace.value) return
  saving.value = true; error.value = ''
  try {
    await request(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}/members`, { method: 'POST', headers: requestHeaders(true), body: JSON.stringify({ user_id: forms.value.memberUserID, role: forms.value.memberRole }) })
    forms.value.memberUserID = ''; flash('Member added'); members.value = collectionItems<Member>(await request<unknown>(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}/members?limit=200`))
  } catch (cause) { fail(cause) } finally { saving.value = false }
}
async function updateMemberRole(member: Member, role: string) {
  if (!workspace.value || member.role === role) return
  const previous = member.role
  member.role = role
  try {
    await request(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}/members/${encodeURIComponent(member.user_id)}`, { method: 'PATCH', headers: requestHeaders(true), body: JSON.stringify({ role }) })
    flash('Member role updated')
  } catch (cause) { member.role = previous; fail(cause) }
}
async function removeMember(member: Member) {
  if (!workspace.value || member.role === 'owner' || !window.confirm(`Remove ${member.user_id} from ${workspace.value.name}?`)) return
  saving.value = true; error.value = ''
  try {
    await request(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}/members/${encodeURIComponent(member.user_id)}`, { method: 'DELETE' })
    members.value = members.value.filter(item => item.user_id !== member.user_id); flash('Member removed')
  } catch (cause) { fail(cause) } finally { saving.value = false }
}
async function deleteWorkspace() {
  if (!workspace.value || !window.confirm(`Delete workspace ${workspace.value.name}? This cannot be undone.`)) return
  saving.value = true; error.value = ''
  try {
    await request(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}`, { method: 'DELETE' })
    currentWorkspaceId.value = ''; localStorage.removeItem('agentx_workspace_id'); flash('Workspace deleted'); await loadData()
  } catch (cause) { fail(cause) } finally { saving.value = false }
}
async function registerDevice() {
  if (!workspace.value) return
  saving.value = true; error.value = ''
  try {
    const device = await request<Device>(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}/devices`, { method: 'POST', headers: requestHeaders(true), body: JSON.stringify({ id: forms.value.deviceID || undefined, name: forms.value.deviceName, agent: forms.value.deviceAgent, status: forms.value.deviceStatus }) })
    devices.value = [device, ...devices.value.filter(item => item.id !== device.id)]; forms.value.deviceID = ''; forms.value.deviceName = ''; flash('Device registered')
  } catch (cause) { fail(cause) } finally { saving.value = false }
}
async function publishRelease() {
  if (!workspace.value || !forms.value.artifact) return
  saving.value = true; error.value = ''
  try {
    const body = new FormData(); body.append('version', forms.value.packageVersion); body.append('artifact', forms.value.artifact); if (forms.value.packageSignature) body.append('signature', forms.value.packageSignature)
    const release = await request<Release>(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}/packages/${encodeURIComponent(forms.value.packageName)}/releases`, { method: 'POST', headers: { ...(token.value.trim() ? { Authorization: `Bearer ${token.value.trim()}` } : {}), 'Idempotency-Key': crypto.randomUUID() }, body })
    releases.value = [release, ...releases.value]; forms.value.packageName = ''; forms.value.packageVersion = ''; forms.value.packageSignature = ''; forms.value.artifact = null; flash(`${release.name} ${release.version} published`)
  } catch (cause) { fail(cause) } finally { saving.value = false }
}
async function approveRelease(release: Release) {
  if (!workspace.value) return
  saving.value = true; error.value = ''
  try {
    const approved = await request<Release>(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}/packages/${encodeURIComponent(release.name)}/${encodeURIComponent(release.version)}/approve`, { method: 'POST' })
    const index = releases.value.findIndex(item => item.name === release.name && item.version === release.version)
    if (index >= 0) releases.value[index] = { ...releases.value[index], ...approved }
    flash(`${release.name} ${release.version} approved`)
  } catch (cause) { fail(cause) } finally { saving.value = false }
}
async function savePolicy() {
  if (!workspace.value) return
  saving.value = true; error.value = ''
  try {
    const document = JSON.parse(policyText.value) as Record<string, unknown>
    const saved = await request<Policy>(`/v1/workspaces/${encodeURIComponent(workspace.value.id)}/policies`, { method: 'PUT', headers: requestHeaders(true), body: JSON.stringify({ document }) })
    policy.value = saved; policyText.value = JSON.stringify(saved.document || {}, null, 2); flash(`Policy revision ${saved.revision} saved`)
  } catch (cause) { fail(cause) } finally { saving.value = false }
}
async function saveManifest() {
  if (!workspace.value) return
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
    const response = await fetch(`${api}${prefix}/artifacts/${encodeURIComponent(release.sha256)}`, { headers: requestHeaders(false) })
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

watch(currentWorkspaceId, id => { if (id) localStorage.setItem('agentx_workspace_id', id) })
onMounted(() => { void completeOIDCLogin().then(() => loadData()) })
</script>

<template>
  <main>
    <header><div><p class="eyebrow">AGENTX REGISTRY</p><h1>Agent environments</h1><p class="muted">Reproducible packages, access and device state for your teams.</p></div><div class="header-actions"><button v-if="oidcIssuer && oidcClientID && !token" class="secondary" :disabled="authBusy" @click="signInWithOIDC">{{ authBusy ? 'Signing in...' : 'Sign in with SSO' }}</button><label class="token-field"><span>API token</span><input v-model="token" type="password" placeholder="Optional" @keyup.enter="saveToken"></label><button class="secondary" @click="saveToken">Save token</button><button v-if="token" class="secondary" @click="signOut">Sign out</button><button @click="tab='workspace'">Create workspace</button></div></header>
    <div v-if="workspaces.length" class="workspace-bar"><label for="workspace-select">Workspace</label><select id="workspace-select" :value="workspace?.id" @change="selectWorkspace(($event.target as HTMLSelectElement).value)"><option v-for="item in workspaces" :key="item.id" :value="item.id">{{ item.name }} · {{ item.slug }}</option></select><button class="icon-button" title="Refresh" aria-label="Refresh" @click="loadData">↻</button></div>
    <nav class="tabs" aria-label="Primary"><button :class="{active:tab==='overview'}" @click="tab='overview'">Overview</button><button :class="{active:tab==='registry'}" @click="tab='registry'">Registry</button><button :class="{active:tab==='workspace'}" @click="tab='workspace'">Workspace</button><button :class="{active:tab==='manifest'}" @click="tab='manifest'">Manifest</button><button :class="{active:tab==='policy'}" @click="tab='policy'">Policy</button><button :class="{active:tab==='audit'}" @click="tab='audit'">Audit</button></nav>
    <p v-if="error" class="error" role="alert">{{ error }} <button class="dismiss" @click="error=''">Dismiss</button></p><p v-if="notice" class="notice" role="status">{{ notice }}</p>

    <template v-if="tab==='overview'"><section class="stats"><div><span>Packages</span><strong>{{ latestPackages.length }}</strong></div><div><span>Devices</span><strong>{{ loading ? '...' : devices.length }}</strong></div><div><span>Drift items</span><strong :class="{warn:drift.length}">{{ drift.length }}</strong></div></section><section class="panel"><div class="panel-head"><div><h2>Devices</h2><p class="muted">Registered agents in this workspace</p></div><button class="link" @click="tab='audit'">View audit</button></div><div class="form-grid compact"><input v-model="forms.deviceName" placeholder="Device name"><input v-model="forms.deviceID" placeholder="Device ID (optional)"><input v-model="forms.deviceAgent" placeholder="Agent"><select v-model="forms.deviceStatus"><option>Ready</option><option>online</option><option>offline</option></select><button :disabled="saving || !workspace || !forms.deviceName" @click="registerDevice">Register device</button></div><table><thead><tr><th>Device</th><th>Agent</th><th>Status</th><th>Last seen</th></tr></thead><tbody><tr v-for="device in devices" :key="device.id || device.name"><td>{{ device.name }}</td><td>{{ device.agent || 'AgentX' }}</td><td><span :class="['badge', device.status === 'Ready' || device.status === 'Local mode' || device.status === 'online' ? 'ok' : 'warning']">{{ device.status || 'Unknown' }}</span></td><td>{{ device.updated_at ? new Date(device.updated_at).toLocaleString() : '-' }}</td></tr><tr v-if="!loading && !devices.length"><td colspan="4" class="empty">No devices registered</td></tr></tbody></table></section><section class="panel"><div class="panel-head"><div><h2>Drift</h2><p class="muted">Differences between installed and expected packages</p></div><button class="link" @click="loadData">Refresh</button></div><table><thead><tr><th>Device</th><th>Package</th><th>Kind</th><th>Expected</th><th>Observed</th></tr></thead><tbody><tr v-for="item in drift" :key="`${item.device_id}-${item.package}`"><td>{{ item.device_name }}</td><td>{{ item.package }}</td><td><span class="badge warning">{{ item.kind }}</span></td><td><code>{{ item.expected_sha256.slice(0, 12) }}...</code></td><td><code>{{ item.observed_sha256 ? item.observed_sha256.slice(0, 12) + '...' : '-' }}</code></td></tr><tr v-if="!drift.length"><td colspan="5" class="empty">No drift detected</td></tr></tbody></table></section></template>

    <template v-else-if="tab==='registry'"><section class="panel"><div class="panel-head"><div><h2>Publish release</h2><p class="muted">Upload an immutable package artifact</p></div></div><div class="form-grid"><input v-model="forms.packageName" placeholder="Package name"><input v-model="forms.packageVersion" placeholder="Version, e.g. 1.2.3"><input v-model="forms.packageSignature" class="wide" placeholder="Ed25519 signature (optional when server signing is disabled)"><input class="wide" type="file" @change="forms.artifact=(($event.target as HTMLInputElement).files || [])[0] || null"><button :disabled="saving || !workspace || !forms.packageName || !forms.packageVersion || !forms.artifact" @click="publishRelease">Publish release</button></div></section><section class="panel"><div class="panel-head"><div><h2>Registry releases</h2><p class="muted">{{ releases.length }} immutable releases</p></div><button class="link" @click="loadData">Refresh</button></div><table><thead><tr><th>Package</th><th>Version</th><th>SHA-256</th><th>Signature</th><th>Status</th><th></th></tr></thead><tbody><tr v-for="release in releases" :key="`${release.name}-${release.version}-${release.sha256}`"><td>{{ release.name }}</td><td>{{ release.version }}</td><td><code>{{ release.sha256.slice(0, 12) }}...</code></td><td><span :class="['badge', release.signature_status === 'verified' ? 'ok' : 'warning']">{{ release.signature_status || 'Unsigned' }}</span></td><td><span :class="['badge', release.status === 'approved' ? 'ok' : 'warning']">{{ release.status || 'published' }}</span></td><td><button v-if="release.status !== 'approved'" class="link" @click="approveRelease(release)">Approve</button><button class="link" @click="downloadRelease(release)">Download</button></td></tr><tr v-if="!releases.length"><td colspan="6" class="empty">No releases published</td></tr></tbody></table></section></template>

    <template v-else-if="tab==='workspace'"><section class="panel"><div class="panel-head"><div><h2>Create workspace</h2><p class="muted">Create an isolated team boundary</p></div></div><div class="form-grid"><input v-model="forms.workspaceName" placeholder="Workspace name"><input v-model="forms.workspaceSlug" placeholder="workspace-slug"><button :disabled="saving || !forms.workspaceName || !forms.workspaceSlug" @click="createWorkspace">Create workspace</button></div></section><section class="panel"><div class="panel-head"><div><h2>Workspaces</h2><p class="muted">Role based access</p></div></div><table><thead><tr><th>Name</th><th>Slug</th><th>ID</th><th></th></tr></thead><tbody><tr v-for="item in workspaces" :key="item.id"><td>{{ item.name }}</td><td>{{ item.slug }}</td><td><code>{{ item.id.slice(0, 12) }}...</code></td><td><button class="link" @click="selectWorkspace(item.id)">Open</button></td></tr><tr v-if="!workspaces.length"><td colspan="4" class="empty">No workspaces available</td></tr></tbody></table></section><section class="panel" v-if="workspace"><div class="panel-head"><div><h2>Members</h2><p class="muted">{{ workspace.name }} access</p></div><button class="danger" :disabled="saving" @click="deleteWorkspace">Delete workspace</button></div><div class="form-grid compact"><input v-model="forms.memberUserID" placeholder="User ID or issuer|subject"><select v-model="forms.memberRole"><option value="viewer">Viewer</option><option value="developer">Developer</option><option value="admin">Admin</option></select><button :disabled="saving || !forms.memberUserID" @click="inviteMember">Invite member</button></div><table><thead><tr><th>User</th><th>Role</th><th>Joined</th><th></th></tr></thead><tbody><tr v-for="member in members" :key="member.user_id"><td><code>{{ member.user_id }}</code></td><td><select :value="member.role" :disabled="member.role === 'owner'" aria-label="Member role" @change="updateMemberRole(member, ($event.target as HTMLSelectElement).value)"><option value="owner">Owner</option><option value="viewer">Viewer</option><option value="developer">Developer</option><option value="admin">Admin</option></select></td><td>{{ member.created_at ? new Date(member.created_at).toLocaleString() : '-' }}</td><td><button v-if="member.role !== 'owner'" class="link danger-text" @click="removeMember(member)">Remove</button></td></tr><tr v-if="!members.length"><td colspan="4" class="empty">No members available</td></tr></tbody></table></section></template>

    <template v-else-if="tab==='manifest'"><section class="panel"><div class="panel-head"><div><h2>Team manifest</h2><p class="muted">Revision {{ manifest.revision }} · admin access required to save</p></div><button class="link" @click="loadData">Refresh</button></div><div class="policy-editor"><textarea v-model="manifestText" rows="18" spellcheck="false" aria-label="Team manifest JSON"></textarea><button :disabled="saving || !workspace" @click="saveManifest">Save manifest</button></div></section></template>
    <template v-else-if="tab==='policy'"><section class="panel"><div class="panel-head"><div><h2>Workspace policy</h2><p class="muted">Revision {{ policy.revision }} · admin access required to save</p></div><button class="link" @click="loadData">Refresh</button></div><div class="policy-editor"><textarea v-model="policyText" rows="18" spellcheck="false" aria-label="Policy JSON"></textarea><button :disabled="saving || !workspace" @click="savePolicy">Save policy</button></div></section></template>
    <section v-else class="panel"><div class="panel-head"><div><h2>Audit events</h2><p class="muted">Append-only activity for {{ workspace?.name || 'this installation' }}</p></div><button class="link" @click="loadData">Refresh</button></div><table><thead><tr><th>Action</th><th>Resource</th><th>Time</th></tr></thead><tbody><tr v-for="event in audit" :key="`${event.action}-${event.at}-${event.device_id}-${event.resource_id}`"><td>{{ event.action }}</td><td>{{ event.resource_type ? `${event.resource_type}: ${event.resource_id}` : (event.device_id || '-') }}</td><td>{{ event.at ? new Date(event.at).toLocaleString() : '-' }}</td></tr><tr v-if="!audit.length"><td colspan="3" class="empty">No audit events</td></tr></tbody></table></section>
  </main>
</template>
