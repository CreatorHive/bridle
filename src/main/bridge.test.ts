import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import type { BridleEvents } from '../shared/api'

vi.mock('electron', () => ({ app: {}, shell: {}, dialog: {}, BrowserWindow: { getAllWindows: () => [] }, Notification: {} }))

const { bridgeServer } = await import('./bridge')

describe('phone bridge', () => {
  it('needs the token, serves only PHONE_METHODS, and streams only PHONE_EVENTS', async () => {
    let tap: ((event: keyof BridleEvents, payload: unknown) => void) | null = null
    const server = bridgeServer({
      token: () => 'K7QD-2M9X-0PW4-RT1Z-HB3N',
      services: {
        gmail: { load: async (box: unknown, account: unknown) => [{ box, account }] },
        keychain: { get: async () => 'leaked' }
      },
      subscribe: (t) => {
        tap = t
        return () => (tap = null)
      }
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    const call = (path: string, auth = 'Bearer K7QD-2M9X-0PW4-RT1Z-HB3N', body = '[]') =>
      fetch(base + path, { method: 'POST', headers: { authorization: auth }, body })

    try {
      expect((await call('/gmail/load', 'Bearer wrong')).status).toBe(401)
      expect((await call('/gmail/load', '')).status).toBe(401)
      expect((await call('/gmail/load', 'Bearer ----')).status).toBe(401)
      expect((await call('/keychain/get')).status).toBe(404)
      expect((await call('/gmail/load', undefined, '{"not":"an array"}')).status).toBe(400)
      // Typed from a screen: lowercase, no dashes, O for 0 and l for 1 all still match.
      const ok = await call('/gmail/load', 'Bearer k7qd 2m9x opw4 rtlz hb3n', '["Inbox", null]')
      expect(await ok.json()).toEqual({ result: [{ box: 'Inbox', account: null }] })

      const events = await fetch(base + '/events', { headers: { authorization: 'Bearer K7QD2M9X0PW4RT1ZHB3N' } })
      const reader = events.body!.getReader()
      await reader.read() // ": bridle"
      tap!('code:term', { termId: 't', data: 'rm -rf' })
      tap!('watcher:home', { chatId: 'c1' })
      const { value } = await reader.read()
      expect(new TextDecoder().decode(value)).toBe('event: watcher:home\ndata: {"chatId":"c1"}\n\n')
      await reader.cancel()
    } finally {
      server.closeAllConnections()
      server.close()
    }
  })
})
