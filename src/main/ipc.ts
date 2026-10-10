import { ipcMain, shell as electronShell } from 'electron'
import { API_METHODS, channel, type GroupName, type InvokeAPI } from '../shared/api'
import { automations } from './automations'
import { sideChat } from './sidechat'
import { phone, startBridge } from './bridge'
import { code } from './code'
import { banner } from './events'
import { agent } from './services/agent'
import { calendar, composio, gmail } from './services/composio'
import { composioKey, keychain } from './services/keychain'
import { claudeBinary } from './services/llm'
import { lmStudio } from './services/lmstudio'
import { avatar, memory } from './services/memory'
import { settings } from './services/settings'
import { mcp } from './services/mcp'
import { tasks } from './services/tasks'
import { viewer } from './services/viewer'
import { workspace } from './services/workspace'
import { search } from './search/service'
import { native } from './native'
import { onboarding } from './onboarding'
import { away, watcher } from './watch'

/** Banners only while Bridle isn't focused, and only if that kind is switched on. */
const notify: InvokeAPI['notify'] = {
  async post(title, body, chatId, when) {
    if (when && !(await settings.get(when))) return
    banner(title, body, chatId ?? undefined)
  }
}

const shell: InvokeAPI['shell'] = {
  async openExternal(url) {
    if (!/^(https?|mailto):/i.test(url)) throw new Error(`refusing to open ${url}`)
    await electronShell.openExternal(url)
  }
}

/** Settings' read-only facts: the Claude Code path (Models) and where the Composio key comes from (Connections). */
const about: InvokeAPI['about'] = {
  claudeBinary: async () => claudeBinary(),
  async composioKeySource() {
    if (await keychain.get('composio')) return 'keychain'
    return (await composioKey()) ? 'environment' : null
  }
}

/** Every contract group, implemented. Typed against BridleAPI, so a missing method fails typecheck. */
const services: InvokeAPI = { workspace, settings, keychain, composio, gmail, calendar, tasks, automations, mcp, side: sideChat, agent, watcher, away, notify, search, viewer, memory, avatar, lmStudio, about, code, native, shell, onboarding, phone }

/** One ipcMain.handle per method in API_METHODS: "<group>:<method>" → services[group][method](...args). */
export function registerIpc(): void {
  for (const [group, methods] of Object.entries(API_METHODS)) {
    const service = services[group as GroupName] as unknown as Record<string, (...args: unknown[]) => unknown>
    for (const method of Object.keys(methods)) {
      ipcMain.handle(channel(group, method), (_event, ...args: unknown[]) => service[method](...args))
    }
  }
  void startBridge(services)
}
