import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { API_METHODS, channel, type BridleAPI } from '../shared/api'

// Builds window.bridle from the contract: one ipcRenderer.invoke per listed method, plus `on`.
// Nothing else from Node or Electron reaches the page.
const api: Record<string, unknown> = {}
for (const [group, methods] of Object.entries(API_METHODS)) {
  api[group] = Object.fromEntries(
    Object.keys(methods).map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke(channel(group, m), ...args)])
  )
}
const on: BridleAPI['on'] = (event, listener) => {
  const wrapped = (_e: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
  ipcRenderer.on(event, wrapped)
  return () => ipcRenderer.removeListener(event, wrapped)
}
api.on = on
const pathForFile: BridleAPI['pathForFile'] = (file) => webUtils.getPathForFile(file)
api.pathForFile = pathForFile

contextBridge.exposeInMainWorld('bridle', api)
