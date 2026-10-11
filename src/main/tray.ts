import { app, Menu, nativeImage, Tray } from 'electron'
import { readFileSync } from 'node:fs'
import tray1x from '../../resources/trayTemplate.png?asset'
import tray2x from '../../resources/trayTemplate@2x.png?asset'
import { running } from './services/agent'
import { pref, setPref } from './services/settings'
import { watcher } from './watch'

// The menu-bar icon: Bridle keeps working with its window closed (closing hides it), and opens at login.

let tray: Tray | null = null

/** Started by the login item: stay in the menu bar instead of opening the window. */
export const openedAtLogin = (): boolean => app.getLoginItemSettings().wasOpenedAtLogin || process.argv.includes('--hidden')

export async function startTray(show: () => void): Promise<void> {
  const icon = nativeImage.createEmpty()
  icon.addRepresentation({ scaleFactor: 1, buffer: readFileSync(tray1x) })
  icon.addRepresentation({ scaleFactor: 2, buffer: readFileSync(tray2x) })
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Bridle')

  // Open at login is on unless you've turned it off. Only packaged builds: a dev run would register Electron itself.
  if (app.isPackaged && !(await pref('loginItemSet'))) {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })
    await setPref('loginItemSet', true)
  }

  // Built on each click, so the status line is current.
  const menu = (): Menu => {
    const n = running()
    return Menu.buildFromTemplate([
      { label: n ? `Working on ${n} chat${n === 1 ? '' : 's'}` : 'Watching', enabled: false },
      { type: 'separator' },
      { label: 'Open Bridle', click: show },
      { label: 'Check Now', click: () => void watcher.checkNow() },
      { type: 'separator' },
      {
        label: 'Open at Login', type: 'checkbox', enabled: app.isPackaged, checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] })
      },
      { label: 'Quit Bridle', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
    ])
  }
  tray.on('click', () => tray?.popUpContextMenu(menu()))
  tray.on('right-click', () => tray?.popUpContextMenu(menu()))
}
