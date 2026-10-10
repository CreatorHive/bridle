import { app, BrowserWindow, Notification } from 'electron'
import type { BridleEvents } from '../shared/api'

const taps = new Set<(event: keyof BridleEvents, payload: unknown) => void>()

/** Pushes an event to every window (renderer listens with window.bridle.on) and every tap. */
export function emit<E extends keyof BridleEvents>(event: E, payload: BridleEvents[E]): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(event, payload)
  for (const tap of taps) tap(event, payload)
}

/** Hears every emit (the phone bridge's event streams); returns the unsubscribe. */
export function onEmit(tap: (event: keyof BridleEvents, payload: unknown) => void): () => void {
  taps.add(tap)
  return () => taps.delete(tap)
}

const live = new Set<Notification>() // a Notification nobody references is collected, and its click is lost

/** A silent banner (Bridle's own cue already played) unless a window is focused.
 *  Clicking it brings Bridle forward and, with a chat, opens it (`notify:opened`). */
export function banner(title: string, body: string, chatId?: string): void {
  if (BrowserWindow.getFocusedWindow() || !Notification.isSupported()) return
  const n = new Notification({ title, body, silent: true })
  live.add(n)
  n.on('close', () => live.delete(n))
  n.on('click', () => {
    live.delete(n)
    app.focus({ steal: true })
    BrowserWindow.getAllWindows()[0]?.show()
    if (chatId) emit('notify:opened', { chatId })
  })
  n.show()
}

/** Stub body for a contract method nobody has implemented yet. */
export function notImplemented(name: string): (...args: unknown[]) => Promise<never> {
  return () => Promise.reject(new Error(`not implemented: ${name}`))
}
