import type { BridleAPI } from '../../shared/api'
import { DEFAULT_SETTINGS, PROVIDERS, type SettingKey, type Settings } from '../../shared/types'
import { run } from './util'

// Preferences live in the macOS defaults domain "Bridle".
// Read once (`defaults export Bridle -` → plutil → JSON), cached in memory, written through
// with `defaults write`. Unset keys fall back to DEFAULT_SETTINGS.

const DOMAIN = 'Bridle'
/** Numbers stored as integers; every other number is a float. */
const INT_KEYS = new Set<string>(['briefingHour'])
const POLICIES = ['Always ask', 'Allow app actions', 'Allow everything']

let raw: Promise<Record<string, unknown>> | null = null

/** The whole domain as JSON. Falls back to {} when it doesn't exist yet. */
async function readDomain(): Promise<Record<string, unknown>> {
  const exported = await run('defaults', ['export', DOMAIN, '-'])
  if (exported.code !== 0) return {}
  const json = await run('plutil', ['-convert', 'json', '-o', '-', '-'], { input: exported.stdout })
  if (json.code === 0) return JSON.parse(json.stdout) as Record<string, unknown>
  // A Date or Data value somewhere makes JSON conversion fail: read the keys we know one by one.
  const out: Record<string, unknown> = {}
  for (const key of [...Object.keys(DEFAULT_SETTINGS), 'composioUserID', 'composioSession']) {
    const r = await run('defaults', ['read', DOMAIN, key])
    if (r.code === 0) out[key] = r.stdout.replace(/\n$/, '')
  }
  return out
}

function domain(): Promise<Record<string, unknown>> {
  raw ??= readDomain()
  return raw
}

/** A stored value coerced to the type of its default. */
export function coerce<K extends SettingKey>(key: K, value: unknown): Settings[K] {
  const fallback = DEFAULT_SETTINGS[key]
  if (value === undefined || value === null) return fallback
  if (typeof fallback === 'boolean') {
    return (value === true || value === 1 || value === '1' || /^(true|yes)$/i.test(String(value))) as Settings[K]
  }
  if (typeof fallback === 'number') {
    const n = Number(value)
    return (Number.isFinite(n) ? n : fallback) as Settings[K]
  }
  const s = String(value)
  if (key === 'provider' && !(s in PROVIDERS)) return fallback
  if (key === 'approvalPolicy' && !POLICIES.includes(s)) return fallback
  return s as Settings[K]
}

/** Any key in the domain, untyped (composioUserID, composioSession, googlePhotos…). */
export async function pref(key: string): Promise<unknown> {
  return (await domain())[key]
}

/** Writes any key: strings, booleans, numbers, or a flat string dictionary. null deletes it. */
export async function setPref(key: string, value: string | boolean | number | Record<string, string> | null): Promise<void> {
  const values = await domain()
  let args: string[]
  if (value === null) args = ['delete', DOMAIN, key]
  else if (typeof value === 'boolean') args = ['write', DOMAIN, key, '-bool', value ? 'true' : 'false']
  else if (typeof value === 'number') args = ['write', DOMAIN, key, INT_KEYS.has(key) ? '-int' : '-float', String(INT_KEYS.has(key) ? Math.round(value) : value)]
  else if (typeof value === 'string') args = ['write', DOMAIN, key, '-string', value]
  else args = ['write', DOMAIN, key, '-dict', ...Object.entries(value).flat()]
  if (value === null) delete values[key]
  else values[key] = value
  const r = await run('defaults', args)
  if (r.code !== 0 && value !== null) throw new Error(`defaults write ${key} failed: ${r.stderr.trim()}`)
}

/** Re-reads the domain on the next call (something else may have changed it). */
export function reloadSettings(): void {
  raw = null
}

export const settings: BridleAPI['settings'] = {
  async all() {
    reloadSettings()
    const values = await domain()
    const out = {} as Record<SettingKey, unknown>
    for (const key of Object.keys(DEFAULT_SETTINGS) as SettingKey[]) out[key] = coerce(key, values[key])
    return out as unknown as Settings
  },
  async get(key) {
    return coerce(key, (await domain())[key])
  },
  async set(key, value) {
    await setPref(key, value as string | boolean | number)
  }
}
