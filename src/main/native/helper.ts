import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { app } from 'electron'

// The client for native/BridleHelper (bridle-helper): JSON lines over stdin/stdout, one request per id,
// events (no id) for live dictation. Spawned on first use and again after it exits; a missing binary
// rejects every call with NOT_BUILT, so each feature degrades on its own.

export const NOT_BUILT = 'On-device features need the Bridle helper: run `npm run build:native`'

/** Seconds per command before the call gives up (the helper keeps going; its late answer is dropped). */
const TIMEOUTS: Record<string, number> = { ping: 5, embed: 120, ocr: 60, thumbnail: 20, transcribe: 600, dictate: 120 }

export type HelperEvent = { event: string } & Record<string, unknown>

export class Helper {
  private child: ChildProcessWithoutNullStreams | null = null
  private next = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  private listeners = new Set<(e: HelperEvent) => void>()

  /** `locate` finds the command (and args) to run, or null when there's none. */
  constructor(private locate: () => { command: string; args?: string[] } | null) {}

  available(): boolean {
    return this.locate() !== null
  }

  request<T>(cmd: string, args: Record<string, unknown> = {}, timeoutSeconds = TIMEOUTS[cmd] ?? 60): Promise<T> {
    let child: ChildProcessWithoutNullStreams
    try {
      child = this.process()
    } catch (e) {
      return Promise.reject(e)
    }
    const id = this.next++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`bridle-helper: ${cmd} timed out`))
      }, timeoutSeconds * 1000)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      child.stdin.write(JSON.stringify({ ...args, id, cmd }) + '\n')
    })
  }

  /** Events without an id (dictation text). Returns the unsubscribe function. */
  onEvent(listener: (e: HelperEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  stop(): void {
    this.child?.kill()
  }

  private process(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child
    const found = this.locate()
    if (!found) throw new Error(NOT_BUILT)
    const child = spawn(found.command, found.args ?? [], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    createInterface({ input: child.stdout }).on('line', (line) => this.receive(line))
    child.stderr.on('data', (d: Buffer) => console.warn('[bridle-helper]', d.toString().trimEnd()))
    child.stdin.on('error', () => {}) // EPIPE after a crash; 'exit' reports it
    const gone = (why: string): void => {
      if (this.child !== child) return
      this.child = null
      for (const p of this.pending.values()) {
        clearTimeout(p.timer)
        p.reject(new Error(`bridle-helper ${why}`))
      }
      this.pending.clear()
      for (const l of this.listeners) l({ event: 'exit', why })
    }
    child.on('error', (e) => gone(`failed to start: ${e.message}`))
    child.on('exit', (code, signal) => gone(`quit (${signal ?? `code ${code}`})`))
    return child
  }

  private receive(line: string): void {
    let msg: { id?: number; ok?: unknown; error?: string; event?: string }
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.event) {
      for (const l of this.listeners) l(msg as HelperEvent)
      return
    }
    const p = msg.id === undefined ? undefined : this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id!)
    clearTimeout(p.timer)
    if (msg.error !== undefined) p.reject(new Error(msg.error))
    else p.resolve(msg.ok)
  }
}

/** Packaged: Contents/Resources/<name> (electron-builder extraResources). Dev: the SwiftPM release build. */
export function helperPath(name = 'bridle-helper'): string | null {
  try {
    const path = app.isPackaged
      ? join(process.resourcesPath, name)
      : join(app.getAppPath(), 'native', 'BridleHelper', '.build', 'release', name)
    return existsSync(path) ? path : null
  } catch {
    return null
  }
}

/** The app's one helper. */
export const helper = new Helper(() => {
  const path = helperPath()
  return path ? { command: path } : null
})
