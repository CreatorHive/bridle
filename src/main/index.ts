import { app, BrowserWindow, dialog, Menu, nativeImage, shell } from 'electron'
import { join } from 'node:path'
import { installCrashLogging, watchWindow } from './log'
import icon from '../../resources/icon.png?asset' // the Bridle mark (build/icon.icns for packaged builds)
import { emit } from './events'
import { registerIpc } from './ipc'
import { startNotch } from './notch'
import { startAutomations } from './automations'
import { startSideChat, stopSideChat } from './sidechat'
import { loadRenderer, onboarding, onboardingOpen, showOnboarding } from './onboarding'
import { settings } from './services/settings'
import { stopAll } from './services/agent'
import { ensureWorkspace } from './services/seed'
import { startWatcher } from './watch'
import { openedAtLogin, startTray } from './tray'
import { startHeartbeat } from './heartbeat'
import { startDreams } from './dreams'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    // macOS: traffic lights inset into the 38px chrome strip. Windows/Linux: the system buttons drawn over it.
    ...(process.platform === 'darwin'
      // Frosted glass: the sidebar material shows through the chrome and sidebar's translucent tokens ([data-platform='mac']).
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 13 }, vibrancy: 'sidebar' as const,
          backgroundColor: '#00000000' }
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#EDEDEE', symbolColor: '#1A1B1E', height: 38 },
          backgroundColor: '#EDEDEE' }),
    icon, // Linux/Windows; macOS takes the Dock icon below
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      plugins: true // Chromium's PDF viewer, for PDFs in the file viewer
    }
  })
  // Onboarding covers the screen and brings this window forward when it finishes.
  win.once('ready-to-show', () => {
    if (!onboardingOpen() && !openedAtLogin()) win.show()
  })
  // Closing hides: the agent keeps running (routines, loops and the watcher send through this window). Quit ends it.
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    win.hide()
  })

  // Links never open inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })

  watchWindow(win)
  loadRenderer(win)
  return win
}

app.setName('Bridle')

installCrashLogging()

let quitting = false

/** The main window (no #hash), brought forward, or made again. */
function showMain(): void {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !w.webContents.getURL().includes('#'))
  if (!win) return void createWindow()
  win.show()
  win.focus()
}

// One Bridle at a time: a second launch brings this one forward instead of running everything twice.
if (!app.requestSingleInstanceLock()) app.exit(0)
app.on('second-instance', showMain)

app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.setIcon(nativeImage.createFromPath(icon)) // dev runs show Electron's icon otherwise
  Menu.setApplicationMenu(appMenu())
  registerIpc()
  startAutomations() // before the window, so it sees the window load
  await ensureWorkspace()
  const onboarded = await settings.get('onboarded')
  createWindow()
  if (!onboarded) showOnboarding()
  startWatcher()
  startHeartbeat()
  startDreams()
  startNotch()
  startSideChat()
  void startTray(showMain)
  app.on('activate', showMain)
})

// Running replies end with the app.
app.on('before-quit', () => {
  quitting = true
  stopAll()
})
app.on('will-quit', stopSideChat)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/** Replay Onboarding and Mute Interface Sounds after About, File → Open… (⌘O).
 *  No View → Reload, so ⌘R reaches Mail's Sync. Dev tools stay on ⌥⌘I. */
function appMenu(): Menu {
  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Replay Onboarding', click: () => void onboarding.show() },
        { id: 'mute', label: 'Mute Interface Sounds', type: 'checkbox', click: (item) => emit('menu:command', { command: 'mute', muted: item.checked }) },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [{
        label: 'Open…',
        accelerator: 'CmdOrCtrl+O',
        click: async () => {
          const r = await dialog.showOpenDialog({ buttonLabel: 'Open', properties: ['openFile', 'openDirectory'] })
          if (!r.canceled && r.filePaths[0]) emit('menu:command', { command: 'open', path: r.filePaths[0] })
        }
      }, { type: 'separator' }, { role: 'close' }]
    },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' }
  ])
  // The checkmark follows the setting, which Settings → General also changes.
  menu.items[0].submenu?.on('menu-will-show', () => {
    void settings.get('soundMuted').then((muted) => {
      const item = menu.getMenuItemById('mute')
      if (item) item.checked = muted
    })
  })
  return menu
}
