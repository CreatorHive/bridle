import { app, safeStorage } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BridleAPI } from '../../shared/api'
import { setPref } from './settings'
import { isMac, run, userDataFile } from './util'

// Generic passwords in the login Keychain, service "Bridle".
// `security` with argv only; values are never logged.
// Elsewhere: secrets.json in userData, each value encrypted with Electron's safeStorage (DPAPI on Windows,
// the desktop keyring on Linux).

const SERVICE = 'Bridle'
const secrets = userDataFile('secrets.json')

const vault = {
  get(account: string): string | null {
    const sealed = secrets.read()[account]
    if (typeof sealed !== 'string' || !safeStorage.isEncryptionAvailable()) return null
    try {
      return safeStorage.decryptString(Buffer.from(sealed, 'base64')) || null
    } catch {
      return null
    }
  },
  set(account: string, value: string): void {
    const all = secrets.read()
    if (!value) delete all[account]
    else if (!safeStorage.isEncryptionAvailable()) throw new Error("This computer has no secure storage for keys (on Linux, install a keyring)")
    else all[account] = safeStorage.encryptString(value).toString('base64')
    secrets.write(all)
  }
}

export const keychain: BridleAPI['keychain'] = {
  async get(account) {
    if (!isMac) return vault.get(account)
    const r = await run('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w'])
    if (r.code !== 0) return null
    const value = r.stdout.replace(/\n$/, '')
    return value || null
  },
  async set(account, value) {
    // ponytail: on macOS `-w <value>` puts the secret in argv for a moment (visible to `ps`); the Security
    // framework through a native module if that ever matters.
    if (!isMac) vault.set(account, value ?? '')
    else await run('security', ['delete-generic-password', '-s', SERVICE, '-a', account])
    if (isMac && value) {
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
