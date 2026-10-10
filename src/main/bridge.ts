import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { PHONE_EVENTS, PHONE_METHODS, type BridleAPI, type BridleEvents, type InvokeAPI } from '../shared/api'
import type { PhoneStatus } from '../shared/types'
import { onEmit } from './events'
import { keychain } from './services/keychain'
import { pref, setPref } from './services/settings'
import { workspaceRoot } from './services/workspace'

// The phone bridge: PHONE_METHODS over HTTP for the iPhone and Android apps.
//   POST /v1/<group>/<method>, body = the arguments as a JSON array → 200 { result } | 4xx/500 { error }
//   GET  /v1/events → Server-Sent Events, `event: <name>` + `data: <json>` for each of PHONE_EVENTS
// Every request carries `Authorization: Bearer <token>` (Settings → General → Phone).
// It listens only on this Mac's Tailscale address: WireGuard encrypts the hop, so plain HTTP is fine there.

export const PORT = 47811
const MAX_BODY = 8 << 20 // a long chat's saveChat

type Services = Record<string, Record<string, (...args: unknown[]) => unknown>>

export interface BridgeOptions {
  /** The current token; null = unpaired, everything is refused. */
  token(): string | null
  services: Services
  subscribe(tap: (event: keyof BridleEvents, payload: unknown) => void): () => void
}

const digest = (s: string): Buffer => createHash('sha256').update(s).digest()

/** Crockford base32: no I, L, O or U to misread. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** What a token means, typed from a screen: case, dashes and spaces don't matter, O reads as 0, I and L as 1. */
export function canonicalToken(s: string): string {
  return s.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
}

function authorized(header: string | undefined, token: string): boolean {
  const given = canonicalToken(header?.match(/^Bearer (.+)$/)?.[1] ?? '')
  return given.length >= 16 && timingSafeEqual(digest(given), digest(canonicalToken(token)))
}

function allowed(group: string, method: string): boolean {
  return (PHONE_METHODS[group as keyof typeof PHONE_METHODS] as readonly string[] | undefined)?.includes(method) ?? false
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY) throw Object.assign(new Error('Request too large.'), { status: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** The HTTP server, without Electron: tests run it on 127.0.0.1. */
export function bridgeServer({ token, services, subscribe }: BridgeOptions): Server {
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const expected = token()
    if (!expected || !authorized(req.headers.authorization, expected)) return reply(res, 401, { error: 'Pair this phone in Bridle → Settings → General.' })
    const { pathname } = new URL(req.url ?? '/', 'http://bridle')

    if (req.method === 'GET' && pathname === '/v1/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
      res.write(': bridle\n\n')
      const off = subscribe((event, payload) => {
        if (PHONE_EVENTS.includes(event)) res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
      })
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000) // keeps NATs and proxies from idling it out
      req.on('close', () => {
        off()
        clearInterval(ping)
      })
      return
    }

    const [, version, group, method] = pathname.split('/')
    if (req.method !== 'POST' || version !== 'v1' || !allowed(group, method)) return reply(res, 404, { error: 'No such method.' })
    let args: unknown
    try {
      args = JSON.parse((await readBody(req)) || '[]')
    } catch (e) {
      return reply(res, (e as { status?: number }).status ?? 400, { error: message(e) })
    }
    if (!Array.isArray(args)) return reply(res, 400, { error: 'Send the arguments as a JSON array.' })
    try {
      reply(res, 200, { result: (await services[group][method](...args)) ?? null })
    } catch (e) {
      reply(res, 500, { error: message(e) })
    }
  }
  return createServer((req, res) => void handle(req, res).catch((e) => reply(res, 500, { error: message(e) })))
}

/** This Mac's Tailscale IPv4 (100.64.0.0/10), or null when Tailscale isn't up. */
export function tailscaleAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const a of addresses ?? []) {
      const [first, second] = a.address.split('.').map(Number)
      if (a.family === 'IPv4' && first === 100 && second >= 64 && second < 128) return a.address
    }
  }
  return null
}

/** workspace.readFile opens any path on the Mac; a phone gets the workspace only. */
async function insideWorkspace(path: string): Promise<string> {
  const root = await realpath(await workspaceRoot())
  const real = await realpath(path)
  if (!real.startsWith(root + '/')) throw new Error('Only files in the Bridle workspace.')
  return real
}

// MARK: The `phone` group (one bridge per app)

let services: InvokeAPI | null = null
let server: Server | null = null
let url: string | null = null
let error: string | null = null
let token: string | null | undefined // undefined = not read from the Keychain yet

async function start(): Promise<void> {
  if (server || !services) return
  token ??= await keychain.get('phone')
  // ponytail: the address is read once; a new Tailscale IP needs the toggle flipped (or a relaunch).
  const host = tailscaleAddress()
  if (!host) {
    error = "Tailscale isn't connected on this Mac."
    return
  }
  const workspace = services.workspace
  const s = bridgeServer({
    token: () => token ?? null,
    services: {
      ...services,
      workspace: { ...workspace, readFile: async (path: string, encoding?: 'utf8' | 'base64') => workspace.readFile(await insideWorkspace(path), encoding) }
    } as unknown as Services,
    subscribe: onEmit
  })
  await new Promise<void>((resolve) => {
    s.once('error', (e: NodeJS.ErrnoException) => {
      error = e.code === 'EADDRINUSE' ? `Port ${PORT} is taken by another app.` : message(e)
      resolve()
    })
    s.listen(PORT, host, () => {
      server = s
      url = `http://${host}:${PORT}`
      error = null
      resolve()
    })
  })
}

function stop(): void {
  server?.closeAllConnections()
  server?.close()
  server = null
  url = null
  error = null
}

async function status(): Promise<PhoneStatus> {
  token ??= await keychain.get('phone')
  const on = await pref('phoneBridge')
  return { enabled: on === true || on === 1 || on === '1', url, paired: !!token, error }
}

/** Starts the bridge if it was left on. Called once from registerIpc with every service. */
export async function startBridge(all: InvokeAPI): Promise<void> {
  services = all
  if ((await status()).enabled) await start()
}

export const phone: BridleAPI['phone'] = {
  status,
  async setEnabled(on) {
    await setPref('phoneBridge', on)
    if (on) await start()
    else stop()
    return status()
  },
  async newToken() {
    // 20 symbols × 5 bits = 100 bits, shown as XXXX-XXXX-XXXX-XXXX-XXXX (256 is a multiple of 32: no bias).
    const fresh = [...randomBytes(20)].map((b) => ALPHABET[b & 31]).join('').match(/.{4}/g)!.join('-')
    await keychain.set('phone', fresh)
    token = fresh
    server?.closeAllConnections() // event streams opened with the old token
    return fresh
  }
}
