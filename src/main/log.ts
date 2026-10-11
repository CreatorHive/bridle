import { app, type BrowserWindow } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

// A plain log of what went wrong, at ~/Library/Logs/Bridle/bridle.log (~/.config/Bridle/logs on Linux), so a crash
// leaves evidence: main-process exceptions, renderer errors and renderer crashes.

let file: string | null = null

export function log(kind: string, message: string): void {
  try {
    if (!file) {
      const dir = app.getPath('logs')
      mkdirSync(dir, { recursive: true })
      file = join(dir, 'bridle.log')
    }
    appendFileSync(file, `${new Date().toISOString()} [${kind}] ${message}\n`)
  } catch {
    // logging must never take the app down
  }
}

/** Catches what would otherwise kill the main process or vanish silently. */
export function installCrashLogging(): void {
  app.setName('Bridle') // logs land in ~/Library/Logs/Bridle, not …/Electron
  process.on('uncaughtException', (e) => log('main', e.stack ?? String(e)))
  process.on('unhandledRejection', (e) => log('main', e instanceof Error ? e.stack ?? e.message : String(e)))
}

export function watchWindow(win: BrowserWindow): void {
  win.webContents.on('render-process-gone', (_e, d) => log('renderer-gone', `${d.reason} (exit ${d.exitCode})`))
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 3) log('renderer', `${message} (${source}:${line})`) // errors only
  })
  win.webContents.on('preload-error', (_e, path, error) => log('preload', `${path}: ${error.stack ?? error.message}`))
}
