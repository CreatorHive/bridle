import { BrowserWindow, globalShortcut, screen } from 'electron'
import { join } from 'node:path'
import { loadRenderer } from './onboarding'

// Side chat (Comma's Side Chat): ⌘⇧Space, from any app, opens a small chat at the right edge of the screen
// you're on; again (or Esc) closes it. It's the renderer's chat on its own (#side); what you say saves to
// chats/ like any chat, and the main window picks it up when you come back.

export const SIDE_CHAT_SHORTCUT = 'CommandOrControl+Shift+Space'
let side: BrowserWindow | null = null

function toggle(): void {
  if (side && !side.isDestroyed()) {
    if (side.isFocused()) side.close()
    else side.show(), side.focus()
    return
  }
  const { x, y, width, height } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const w = 440
  side = new BrowserWindow({
    width: w, height: Math.min(680, height - 32), x: x + width - w - 16, y: y + 16,
    frame: false, resizable: true, minWidth: 360, minHeight: 420, show: false, skipTaskbar: true,
    backgroundColor: '#FFFFFF', alwaysOnTop: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  side.setAlwaysOnTop(true, 'floating')
  side.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  side.once('ready-to-show', () => side?.show())
  side.on('closed', () => (side = null))
  loadRenderer(side, 'side')
}

export function startSideChat(): void {
  if (!globalShortcut.register(SIDE_CHAT_SHORTCUT, toggle)) console.warn('[side chat] ⌘⇧Space is taken by another app')
}

export function stopSideChat(): void {
  globalShortcut.unregister(SIDE_CHAT_SHORTCUT)
}
