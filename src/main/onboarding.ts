import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import type { InvokeAPI } from '../shared/api'
import { emit } from './events'
import { watchWindow } from './log'
import { settings } from './services/settings'

// The onboarding window: a borderless, transparent window covering the whole screen, above other
// apps and the Dock but under the menu bar, on every Space. It loads the same renderer at #onboarding.

/** The renderer bundle, from the dev server or the built file; `hash` picks a route (main.tsx). */
export function loadRenderer(win: BrowserWindow, hash?: string): void {
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL + (hash ? `#${hash}` : ''))
  else void win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
}

let win: BrowserWindow | null = null
let aside = false
// CGWindowLevelForKey(.dockWindow) + 1 = 21: Electron's 'modal-panel' is NSModalPanelWindowLevel (8), +13.
// ('pop-up-menu' is 101, over the menu bar's 24.)
const overTheDock = (w: BrowserWindow) => w.setAlwaysOnTop(true, 'modal-panel', 13)

/** OnboardingWindow.show, on the screen under the pointer. */
export function showOnboarding(): void {
  if (win) return
  const { bounds } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const w = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    roundedCorners: false,
    enableLargerThanScreen: true, // the frame starts under the menu bar
    focusable: true,
    title: 'Welcome to Bridle',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  win = w
  aside = false
  overTheDock(w)
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // The page fades itself in and out (OnboardingWindow's 0.6 s on alphaValue), so the window just shows.
  w.once('ready-to-show', () => {
    w.show()
    w.focus()
    app.focus({ steal: true })
  })
  // Closed some other way (⌘W): not onboarded, so it replays next launch; the app comes back.
  w.on('closed', () => {
    if (win !== w) return
    win = null
    mainWindow()?.show()
  })
  watchWindow(w)
  loadRenderer(w, 'onboarding')
}

export const onboardingOpen = (): boolean => win !== null

/** The main window: every window but this one. */
const mainWindow = () => BrowserWindow.getAllWindows().find((w) => w !== win && !w.isDestroyed())

export const onboarding: InvokeAPI['onboarding'] = {
  async show() {
    await settings.set('onboarded', false)
    showOnboarding()
  },
  async finish() {
    await settings.set('onboarded', true)
    const main = mainWindow()
    const w = win
    win = null
    main?.show()
    main?.focus()
    emit('onboarding:done', {})
    w?.close()
  },
  async stepAside(next) {
    if (!win || next === aside) return
    aside = next
    if (aside) win.setAlwaysOnTop(false)
    else {
      overTheDock(win)
      win.show()
      win.focus()
      app.focus({ steal: true })
    }
  }
}
