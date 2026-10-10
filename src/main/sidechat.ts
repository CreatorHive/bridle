import { BrowserWindow, globalShortcut, screen, type Rectangle } from 'electron'
import { join } from 'node:path'
import type { BridleAPI } from '../shared/api'
import { loadRenderer } from './onboarding'

// Side chat (Comma's Side Chat): ⌘⇧Space, from any app, opens a see-through bar just above the Dock on the screen
// you're on; again (or Esc) closes it. It starts as the composer alone and grows upward into the conversation
// (the renderer's #side route asks with side.resize). What you say saves to chats/ like any chat.

export const SIDE_CHAT_SHORTCUT = 'CommandOrControl+Shift+Space'
const WIDTH = 680
/** The composer and its shadow. */
const COMPACT = 104

let side: BrowserWindow | null = null
let open = false

/** Bottom-centered on the work area (which ends at the Dock), `height` tall. */
function frame(height: number): Rectangle {
  const area = side ? screen.getDisplayMatching(side.getBounds()).workArea : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const h = Math.min(height, area.height - 40)
  return { x: Math.round(area.x + (area.width - WIDTH) / 2), y: area.y + area.height - h - 8, width: WIDTH, height: h }
}

function toggle(): void {
  if (side && !side.isDestroyed()) {
    if (side.isFocused()) side.close()
    else side.show(), side.focus()
    return
  }
  open = false
  side = new BrowserWindow({
    ...frame(COMPACT),
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false,
    show: false, skipTaskbar: true, alwaysOnTop: true, fullscreenable: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  side.setAlwaysOnTop(true, 'floating')
  side.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  side.once('ready-to-show', () => side?.show())
  // Like Spotlight, an empty bar goes away when you click elsewhere; a conversation stays until Esc.
  side.on('blur', () => { if (!open) side?.close() })
  side.on('closed', () => (side = null))
  loadRenderer(side, 'side')
}

export const sideChat: BridleAPI['side'] = {
  async resize(height) {
    if (!side || side.isDestroyed()) return
    open = height > 0
    side.setBounds(frame(open ? height : COMPACT), true)
  }
}

export function startSideChat(): void {
  if (!globalShortcut.register(SIDE_CHAT_SHORTCUT, toggle)) console.warn('[side chat] ⌘⇧Space is taken by another app')
}

export function stopSideChat(): void {
  globalShortcut.unregister(SIDE_CHAT_SHORTCUT)
}
