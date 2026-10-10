import { useEffect, useRef } from 'react'
import { useApp } from '../../app/store'
import { contactsLine } from './logic'
import { getChat, insertChat, send, sync } from './session'

/** Turns main starts on its own (routines, loops, task runs: 'agent:start') go through the same send as yours,
 *  so they stream, ask for approvals and save alike. Main window only (the Shell mounts it).
 *  Also picks up chats other windows saved (the side chat) when you come back. */
export function useBackgroundTurns(): void {
  const app = useApp()
  const latest = useRef(app)
  latest.current = app // upsertChat is new each render; the listener reads the latest
  const { patch, reloadChats } = app

  useEffect(() => {
    const off = window.bridle.on('agent:start', ({ chatId, title, text }) => {
      const { state: s, upsertChat } = latest.current
      sync(s.chats, upsertChat, (working) => patch({ working }))
      if (!getChat(chatId)) insertChat({ id: chatId, title, messages: [] })
      void send({ chatId, text, files: [], agentName: s.settings?.agentName || 'Bridle', contacts: contactsLine(s.mail, s.accounts) })
    })
    // A reload mid-reply would show the saved copy over the live one, so it waits for quiet.
    const onFocus = () => {
      if (!latest.current.state.working.length) void reloadChats()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      off()
      window.removeEventListener('focus', onFocus)
    }
  }, [patch, reloadChats])
}
