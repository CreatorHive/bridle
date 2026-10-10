import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BridleAPI } from '../../shared/api'
import { setPref } from './settings'
import { run } from './util'

// Generic passwords in the login Keychain, service "Bridle".
// `security` with argv only; values are never logged.

const SERVICE = 'Bridle'

export const keychain: BridleAPI['keychain'] = {
  async get(account) {
    const r = await run('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w'])
    if (r.code !== 0) return null
    const value = r.stdout.replace(/\n$/, '')
    return value || null
  },
  async set(account, value) {
    // ponytail: `-w <value>` puts the secret in argv for a moment (visible to `ps`); the Security
    // framework through a native module if that ever matters.
    await run('security', ['delete-generic-password', '-s', SERVICE, '-a', account])
    if (value) {
      const r = await run('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', account, '-w', value])
      if (r.code !== 0) throw new Error(`Couldn't save to the Keychain (${r.code})`)
    }
    // Settings → Connections: a new project key means a new tool-router session.
    if (account === 'composio') await setPref('composioSession', null)
  }
}

/** The KEY=value line of a .env file, or null. */
export function dotenv(text: string, key: string): string | null {
  const line = text.split('\n').find((l) => l.startsWith(`${key}=`))
  const value = line?.slice(key.length + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
  return value || null
}

const DEV_ENV_FILES = [join(process.cwd(), '.env')] // the repo root under `npm run dev`

/** Keychain "composio", then env COMPOSIO_API_KEY, then a .env file (development only). */
export async function composioKey(): Promise<string | null> {
  const k = await keychain.get('composio')
  if (k) return k
  if (process.env.COMPOSIO_API_KEY) return process.env.COMPOSIO_API_KEY
  if (app?.isPackaged) return null
  for (const file of DEV_ENV_FILES) {
    try {
      const v = dotenv(readFileSync(file, 'utf8'), 'COMPOSIO_API_KEY')
      if (v) return v
    } catch {
      // no file
    }
  }
  return null
}
