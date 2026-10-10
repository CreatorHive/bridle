import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { shell } from 'electron'
import type { BridleAPI } from '../../shared/api'
import {
  SERVICES,
  type Account,
  type CalendarEvent,
  type Grant,
  type LinkProgress,
  type Mail,
  type Mailbox,
  type Service,
  type Toolkit
} from '../../shared/types'
import { emit } from '../events'
import { composioKey } from './keychain'
import { pref, setPref } from './settings'
import { iso, sleep } from './util'
import { workspaceRoot } from './workspace'

// Connected apps through Composio REST v3.1, with Gmail and Google Calendar on top.
// Identity: defaults composioUserID / composioSession, Keychain key.

const BASE = 'https://backend.composio.dev/api/v3.1/'
const TOOLKITS: Toolkit[] = ['gmail', 'googlecalendar', 'googledrive', 'googledocs', 'googlesheets', 'googleslides', 'googlemeet', 'googletasks', 'github', 'linear']

export class ComposioError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message)
  }
}

/** Composio's connected account, the parts we use. */
export interface Remote {
  id: string
  status: string
  toolkit: { slug: string }
  alias?: string | null
  state?: { val?: { displayName?: string | null } | null } | null
  is_disabled?: boolean | null
}

/** The address or username a grant signs in as, when known. */
export const login = (r: Remote): string | null => r.state?.val?.displayName || r.alias || null

async function send(method: string, path: string, options: { query?: Record<string, string>; body?: unknown } = {}): Promise<unknown> {
  const key = await composioKey()
  if (!key) throw new ComposioError('Add your Composio project key below.')
  const url = new URL(path, BASE)
  for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, v)
  const headers: Record<string, string> = { 'x-api-key': key }
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(url, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) })
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // not JSON
  }
  if (!res.ok) {
    const message = (json as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`
    throw new ComposioError(`Composio: ${message}`, res.status)
  }
  return json
}

/** One Composio user per install. */
async function userID(): Promise<string> {
  const id = await pref('composioUserID')
  if (typeof id === 'string' && id) return id
  const fresh = randomUUID().toLowerCase()
  await setPref('composioUserID', fresh)
  return fresh
}

/** The tool-router session: toolkit allowlist and multi-account rules. */
async function session(): Promise<string> {
  const id = await pref('composioSession')
  if (typeof id === 'string' && id) return id
  const s = (await send('POST', 'tool_router/session', {
    body: {
      user_id: await userID(),
      toolkits: { enable: TOOLKITS },
      manage_connections: { enable: true },
      multi_account: { enable: true, max_accounts_per_toolkit: 5, require_explicit_selection: true },
      workbench: { enable: false }
    }
  })) as { session_id: string }
  await setPref('composioSession', s.session_id)
  return s.session_id
}

/** Runs `call` with the session; a 404 means the stored session is gone: make a new one and try once more. */
async function withSession<T>(call: (id: string) => Promise<T>): Promise<T> {
  try {
    return await call(await session())
  } catch (e) {
    if (!(e instanceof ComposioError) || e.status !== 404) throw e
    await setPref('composioSession', null)
    return call(await session())
  }
}

export async function remoteAccounts(): Promise<Remote[]> {
  const page = (await send('GET', 'connected_accounts', { query: { user_ids: await userID(), limit: '100' } })) as { items: Remote[] }
  return page.items
}

/** Runs a tool as one connected account; returns its `data`. */
export async function execute(tool: string, args: Record<string, unknown>, grant: string): Promise<unknown> {
  const json = (await withSession((id) =>
    send('POST', `tool_router/session/${id}/execute`, { body: { tool_slug: tool, arguments: args, account: grant } }))) as
    { data?: unknown; error?: string | null; log_id?: string } | null
  if (json?.error) throw new ComposioError(`${tool}: ${json.error} (log ${json.log_id ?? '?'})`)
  return json?.data ?? {}
}

/** Tools that report which address a grant belongs to, and where the address sits in their data. */
const WHO_AM_I: Partial<Record<Toolkit, { tool: string; args: Record<string, unknown>; path: string[] }>> = {
  googlecalendar: { tool: 'GOOGLECALENDAR_GET_CURRENT_USER', args: {}, path: ['email'] },
  googledrive: { tool: 'GOOGLEDRIVE_GET_ABOUT', args: { fields: 'user' }, path: ['user', 'emailAddress'] }
}

async function whoAmI(r: Remote): Promise<string | null> {
  const w = WHO_AM_I[r.toolkit.slug as Toolkit]
  if (!w) return null
  try {
    let node = await execute(w.tool, w.args, r.id)
    for (const key of w.path) node = (node as Record<string, unknown> | null)?.[key]
    return typeof node === 'string' ? node : null
  } catch {
    return null
  }
}

const setAlias = (id: string, alias: string): Promise<unknown> => send('PATCH', `connected_accounts/${id}`, { body: { alias } })
const deleteGrant = (id: string): Promise<unknown> => send('DELETE', `connected_accounts/${id}`)

function serviceOf(t: Toolkit): Service | undefined {
  return (Object.keys(SERVICES) as Service[]).find((s) => SERVICES[s].all.includes(t))
}

/** Grants grouped into accounts by service and login. */
export function group(remote: Remote[]): Account[] {
  const out: Account[] = []
  for (const r of remote) {
    if (r.status === 'INITIALIZING' || r.status === 'INITIATED') continue
    const t = r.toolkit.slug as Toolkit
    const service = TOOLKITS.includes(t) ? serviceOf(t) : undefined
    if (!service) continue
    const name = login(r) ?? r.id
    const grant: Grant = { id: r.id, toolkit: t, ok: r.status === 'ACTIVE' && r.is_disabled !== true }
    const a = out.find((x) => x.service === service && x.login === name)
    if (a) a.grants.push(grant)
    else out.push({ id: `${service}:${name}`, service, login: name, grants: [grant] })
  }
  return out
}

/** Google profile photo links by address, persisted in defaults "googlePhotos". */
async function addPhotos(accounts: Account[]): Promise<void> {
  const stored = await pref('googlePhotos')
  const links: Record<string, string> = stored && typeof stored === 'object' ? { ...(stored as Record<string, string>) } : {}
  let changed = false
  for (const a of accounts.filter((x) => x.service === 'google')) {
    const drive = a.grants.find((g) => g.toolkit === 'googledrive' && g.ok)
    if (!links[a.login] && drive) {
      try {
        const about = (await execute('GOOGLEDRIVE_GET_ABOUT', { fields: 'user' }, drive.id)) as { user?: { photoLink?: string } }
        if (about.user?.photoLink) {
          links[a.login] = about.user.photoLink.replace('=s64', '=s128')
          changed = true
        }
      } catch {
        // no photo
      }
    }
    a.photo = links[a.login] ? await photoData(links[a.login]) : null
  }
  if (changed) await setPref('googlePhotos', links)
}

/** The photo as a data: URL, downloaded once into .bridle/photos/,
 *  so the page never fetches from Google: no network hiccup, rate limit or offline start leaves a broken image. */
async function photoData(url: string): Promise<string | null> {
  const file = join(await workspaceRoot(), '.bridle', 'photos', createHash('sha256').update(url).digest('hex').slice(0, 16) + '.png')
  let bytes = await readFile(file).catch(() => null)
  if (!bytes) {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      bytes = Buffer.from(await res.arrayBuffer())
      await mkdir(join(file, '..'), { recursive: true })
      await writeFile(file, bytes)
    } catch {
      return null
    }
  }
  return `data:image/png;base64,${bytes.toString('base64')}`
}

let cache: { at: number; accounts: Account[] } | null = null

/** Refreshes accounts: names unnamed grants (whoAmI → alias), groups them, adds photos. */
async function refresh(): Promise<Account[]> {
  const remote = await remoteAccounts()
  for (const r of remote) {
    if (login(r) || r.status !== 'ACTIVE') continue
    const email = await whoAmI(r)
    if (email) {
      await setAlias(r.id, email).catch(() => {})
      r.alias = email
    }
  }
  const accounts = group(remote)
  await addPhotos(accounts)
  cache = { at: Date.now(), accounts }
  return accounts
}

let refreshing: Promise<Account[]> | null = null

/** Accounts for Gmail/Calendar/Linear: the last refresh. Older than 5 minutes, it's still answered at once
 *  while a refresh runs behind it, so a mail load never waits on it; only an empty cache waits.
 *  [] without a key or on failure. */
export async function connectedAccounts(): Promise<Account[]> {
  if (cache && cache.accounts.length && Date.now() - cache.at < 5 * 60_000) return cache.accounts
  refreshing ??= refresh().finally(() => { refreshing = null })
  if (cache?.accounts.length) {
    refreshing.catch(() => {})
    return cache.accounts
  }
  try {
    return await refreshing
  } catch {
    return cache?.accounts ?? []
  }
}

/** Every account's first working grant for a toolkit: (login, grant). */
export async function grants(toolkit: Toolkit): Promise<{ login: string; grant: string }[]> {
  return (await connectedAccounts()).flatMap((a) => {
    const g = a.grants.find((x) => x.toolkit === toolkit && x.ok)
    return g ? [{ login: a.login, grant: g.id }] : []
  })
}

// MARK: Link flow (one at a time)

let running: { progress: LinkProgress; linking: string | null; cancelled: boolean } | null = null

/** Polls every 2 s for up to 5 minutes while you finish signing in. */
async function waitUntilActive(id: string, cancelled: () => boolean): Promise<void> {
  for (let i = 0; i < 150; i++) {
    await sleep(2000)
    if (cancelled()) return
    const r = (await send('GET', `connected_accounts/${id}`)) as Remote
    if (r.status === 'ACTIVE') return
    if (['FAILED', 'EXPIRED', 'INACTIVE'].includes(r.status)) throw new ComposioError(`Sign-in didn't complete (${r.status.toLowerCase()}).`)
  }
  throw new ComposioError('Timed out waiting for you to finish signing in.')
}

function discardLinking(): void {
  const id = running?.linking
  if (!id || !running) return
  running.linking = null
  void deleteGrant(id).catch(() => {})
}

export const composio: BridleAPI['composio'] = {
  accounts: refresh,

  async link(service, toolkits, account) {
    if (running) throw new Error('Another sign-in is still running.')
    if (toolkits.length === 0) return
    const existing = account ? (cache?.accounts ?? (await connectedAccounts())).find((a) => a.id === account) : undefined
    const flow = { progress: { service, account, steps: toolkits, done: 0 } as LinkProgress, linking: null as string | null, cancelled: false }
    running = flow
    emit('composio:link', { ...flow.progress })
    try {
      for (const [i, t] of toolkits.entries()) {
        const link = (await withSession((id) => send('POST', `tool_router/session/${id}/link`, { body: { toolkit: t } }))) as
          { connected_account_id: string; redirect_url: string }
        if (flow.cancelled) {
          void deleteGrant(link.connected_account_id).catch(() => {})
          return
        }
        flow.linking = link.connected_account_id
        if (/^https?:/i.test(link.redirect_url)) await shell.openExternal(link.redirect_url)
        await waitUntilActive(link.connected_account_id, () => flow.cancelled)
        if (flow.cancelled) return
        flow.linking = null
        if (existing && !WHO_AM_I[t] && t !== 'gmail') await setAlias(link.connected_account_id, existing.login).catch(() => {})
        flow.progress.done = i + 1
        emit('composio:link', { ...flow.progress })
      }
      // Reconnect: retire the dead grants the new ones replace.
      for (const g of existing?.grants ?? []) {
        if (!g.ok && toolkits.includes(g.toolkit)) await deleteGrant(g.id).catch(() => {})
      }
      cache = null
      refreshing = null
      emit('composio:link', { ...flow.progress, finished: 'done' })
    } catch (e) {
      if (flow.cancelled) return
      discardLinking()
      const message = e instanceof Error ? e.message : String(e)
      emit('composio:link', { ...flow.progress, finished: { error: message } })
      throw e
    } finally {
      if (running === flow) running = null
    }
  },

  async cancelLink() {
    if (!running) return
    running.cancelled = true
    discardLinking()
    emit('composio:link', { ...running.progress, finished: 'cancelled' })
    running = null
  },

  async disconnect(account) {
    cache = null
    refreshing = null
    for (const g of account.grants) await deleteGrant(g.id)
  },

  execute,

  /** Composio's hosted MCP server for the session, or null without a key or an active connection. */
  async mcpServer() {
    const key = await composioKey()
    if (!key || !(await remoteAccounts()).some((r) => r.status === 'ACTIVE')) return null
    const s = (await withSession((id) => send('GET', `tool_router/session/${id}`))) as { mcp?: { url: string } | null }
    return s.mcp ? { url: s.mcp.url, headers: { 'x-api-key': key } } : null
  }
}

// MARK: Gmail

/** Sidebar view → Gmail search. */
export const QUERIES: Record<Mailbox, string> = {
  Inbox: 'in:inbox',
  Starred: 'is:starred',
  Snoozed: 'in:snoozed',
  Sent: 'in:sent',
  Drafts: 'in:drafts',
  Trash: 'in:trash',
  Archive: '-in:inbox -in:sent -in:drafts -in:trash -in:spam -in:snoozed'
}

/** `Name <a@b.c>` → { name, email }; a bare address names itself. */
export function parseSender(sender: string): { name: string; email: string } {
  const open = sender.lastIndexOf('<')
  const close = sender.lastIndexOf('>')
  if (open < 0 || close < 0 || open >= close) return { name: sender, email: sender }
  const email = sender.slice(open + 1, close)
  const name = sender.slice(0, open).replace(/^[\s"]+|[\s"]+$/g, '')
  return { name: name || email, email }
}

export function looksLikeHTML(s: string): boolean {
  const head = s.slice(0, 600).toLowerCase()
  return ['<html', '<!doctype', '<body', '<div', '<table'].some((t) => head.includes(t))
}

export function decodeEntities(s: string): string {
  const pairs: [string, string][] = [['&nbsp;', ' '], ['&#39;', "'"], ['&apos;', "'"], ['&quot;', '"'], ['&lt;', '<'], ['&gt;', '>'], ['&zwnj;', ''], ['&#8203;', ''], ['&amp;', '&']]
  return pairs.reduce((acc, [a, b]) => acc.split(a).join(b), s)
}

/** Readable text from an HTML email. ponytail: regex tag stripping. */
export function plainText(html: string): string {
  const s = html
    .replace(/<(head|style|script)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*(\n\s*)+/g, '\n\n')
  return decodeEntities(s).trim()
}

/** Today: "4:50 PM". Earlier: "Oct 4". */
export function formatTime(date: Date, now = new Date()): string {
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface Part {
  mimeType?: string
  body?: { data?: string }
  parts?: Part[]
}

/** The first MIME part of `type`, decoded from base64url. */
export function findPart(part: Part | undefined, type: string): string | null {
  if (!part) return null
  if (part.mimeType === type && part.body?.data) return Buffer.from(part.body.data, 'base64url').toString('utf8')
  for (const p of part.parts ?? []) {
    const found = findPart(p, type)
    if (found !== null) return found
  }
  return null
}

/** Where a starred message lives, from its labels. */
function mailboxOf(labels: Set<string>): Mailbox {
  return labels.has('INBOX') ? 'Inbox' : labels.has('SENT') ? 'Sent' : labels.has('DRAFT') ? 'Drafts' : labels.has('TRASH') ? 'Trash' : 'Archive'
}

interface GmailMessage {
  messageId: string
  sender?: string
  subject?: string
  messageText?: string
  messageTimestamp?: string
  labelIds?: string[]
  attachmentList?: unknown[]
  preview?: { body?: string }
  payload?: Part
}

export function toMail(m: GmailMessage, box: Mailbox, account: string, now = new Date()): Mail {
  const labels = new Set(m.labelIds ?? [])
  const parsed = m.messageTimestamp ? new Date(m.messageTimestamp) : new Date(0)
  const date = isNaN(parsed.getTime()) ? new Date(0) : parsed
  const { name, email } = parseSender(m.sender ?? '')
  // HTML-only mail arrives as HTML in messageText; multipart mail keeps its HTML in the payload.
  const text = m.messageText ?? ''
  const html = findPart(m.payload, 'text/html') ?? (looksLikeHTML(text) ? text : null)
  const plain = findPart(m.payload, 'text/plain') ?? (looksLikeHTML(text) ? null : text) ?? (html !== null ? plainText(html) : '')
  return {
    id: m.messageId,
    from: name,
    email,
    subject: m.subject || '(no subject)',
    body: plain,
    time: formatTime(date, now),
    date: iso(date),
    unread: labels.has('UNREAD'),
    starred: labels.has('STARRED'),
    mention: false,
    attachment: (m.attachmentList ?? []).length > 0,
    mailbox: box === 'Starred' ? mailboxOf(labels) : box,
    account,
    gmailID: m.messageId,
    html,
    snippet: m.preview?.body != null ? decodeEntities(m.preview.body) : null
  }
}

/** One mailbox (25 newest) of one account. */
export async function fetchMail(box: Mailbox, account: string, grant: string): Promise<Mail[]> {
  const data = (await execute('GMAIL_FETCH_EMAILS', { query: QUERIES[box] ?? 'in:inbox', max_results: 25, include_spam_trash: box === 'Trash' }, grant)) as
    { messages?: GmailMessage[] }
  return (data.messages ?? []).map((m) => toMail(m, box, account))
}

async function gmailGrant(account: string): Promise<string> {
  const g = (await grants('gmail')).find((a) => a.login === account)
  if (!g) throw new Error(`${account} isn't connected to Gmail`)
  return g.grant
}

export const gmail: BridleAPI['gmail'] = {
  async load(mailbox, account) {
    const picked = (await grants('gmail')).filter((a) => account === null || a.login === account)
    const fetched = (await Promise.all(picked.map((a) => fetchMail(mailbox, a.login, a.grant)))).flat()
    return fetched.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  },
  async label(account, gmailID, add, remove) {
    await execute('GMAIL_ADD_LABEL_TO_EMAIL', { message_id: gmailID, add_label_ids: add, remove_label_ids: remove }, await gmailGrant(account))
  },
  async trash(account, gmailID) {
    await execute('GMAIL_MOVE_TO_TRASH', { message_id: gmailID }, await gmailGrant(account))
  }
}

// MARK: Google Calendar

interface RawTime {
  dateTime?: string
  date?: string
}

export interface RawEvent {
  id: string
  status?: string
  summary?: string
  start: RawTime
  end: RawTime
  location?: string
  description?: string
  hangoutLink?: string
  htmlLink?: string
  attendees?: { email?: string; displayName?: string; responseStatus?: string; organizer?: boolean; self?: boolean }[]
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string; meetingCode?: string; passcode?: string }[]
    conferenceSolution?: { name?: string }
  }
}

/** Drops divider lines (____, ----) and runs of blank lines that invite templates are full of. */
export function tidy(s: string): string {
  return s
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return t === '' || ![...t].every((c) => '_-=*'.includes(c))
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** All-day "yyyy-MM-dd" is local midnight. */
function eventDate(t: RawTime): Date | null {
  if (t.dateTime) {
    const d = new Date(t.dateTime)
    return isNaN(d.getTime()) ? null : d
  }
  const m = t.date?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

export function toEvent(raw: RawEvent, account: string, grant: string): CalendarEvent | null {
  const s = eventDate(raw.start)
  const e = eventDate(raw.end)
  if (raw.status === 'cancelled' || !s || !e) return null
  const video = raw.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')
  const url = video?.uri ?? raw.hangoutLink
  const code = video?.meetingCode ? (video.passcode ? `ID ${video.meetingCode} · Passcode ${video.passcode}` : video.meetingCode) : null
  const notes = raw.description
    ? tidy(looksLikeHTML(raw.description) || raw.description.includes('<br') || raw.description.includes('<a ') ? plainText(raw.description) : raw.description)
    : ''
  return {
    id: raw.id,
    account,
    grant,
    title: raw.summary ?? '(No title)',
    start: iso(s),
    end: iso(e),
    allDay: raw.start.date != null,
    location: raw.location ?? null,
    notes: notes || null,
    meeting: url ? { url, name: raw.conferenceData?.conferenceSolution?.name ?? 'Google Meet', code } : null,
    link: raw.htmlLink ?? null,
    guests: (raw.attendees ?? []).flatMap((p) =>
      p.email ? [{ email: p.email, name: p.displayName ?? null, status: p.responseStatus ?? 'needsAction', organizer: p.organizer ?? false, me: p.self ?? false }] : [])
  }
}

export const calendar: BridleAPI['calendar'] = {
  async events(from, to) {
    const accounts = await grants('googlecalendar')
    const lists = await Promise.all(accounts.map(async (a) => {
      const data = (await execute('GOOGLECALENDAR_EVENTS_LIST', {
        calendarId: 'primary', timeMin: iso(from), timeMax: iso(to), singleEvents: true, orderBy: 'startTime', maxResults: 250
      }, a.grant)) as { items?: RawEvent[] }
      return (data.items ?? []).flatMap((r) => toEvent(r, a.login, a.grant) ?? [])
    }))
    return lists.flat()
  },

  async rsvp(event, status) {
    await execute('GOOGLECALENDAR_PATCH_EVENT', { calendar_id: 'primary', event_id: event.id, rsvp_response: status }, event.grant)
  }
}
