import { useEffect, useState } from 'react'
import type { Chat } from '../../../shared/types'
import { DEFAULT_SETTINGS } from '../../../shared/types'
import { useApp } from '../../app/store'
import { play } from '../../sound'
import { Composer } from './Composer'
import { basename, contactsLine, uuid } from './logic'
import { cancel, insertChat, send, sync, upload } from './session'
import { Transcript } from './Transcript'
import s from './chat.module.css'

/** Above this, the conversation scrolls inside the panel. */
export const SIDE_OPEN_HEIGHT = 520

/** The side chat (⌘⇧Space, src/main/sidechat.ts): a see-through bar just above the Dock. It starts as the composer
 *  alone, and grows upward into a glass panel with the conversation once you send. */
export function SideChat() {
  const { state, patch, upsertChat } = useApp()
  const settings = state.settings ?? DEFAULT_SETTINGS
  const agentName = settings.agentName || 'Bridle'
  const chat = state.chats.find((c) => c.id === state.chatId)
  const working = !!chat && state.working.includes(chat.id)
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])

  useEffect(() => sync(state.chats, upsertChat, (w) => patch({ working: w })), [state.chats, upsertChat, patch])
  // The window grows upward from the Dock once there's a conversation to show.
  useEffect(() => void window.bridle.side.resize(chat ? SIDE_OPEN_HEIGHT : 0), [!!chat])

  const submit = async () => {
    play('tap')
    const text = draft
    const files = await upload(attachments)
    setDraft('')
    setAttachments([])
    let target: Chat | undefined = chat
    if (!target) {
      target = { id: uuid(), title: text || (attachments[0] ? basename(attachments[0]) : ''), messages: [] }
      insertChat(target)
      patch({ chatId: target.id })
    }
    void send({ chatId: target.id, text, files, agentName, contacts: contactsLine(state.mail, state.accounts) })
  }

  return (
    <div className={s.side}>
      {chat && (
        <div className={s.sidePanel}>
          <Transcript chatId={chat.id} messages={chat.messages} agentName={agentName} working={working} />
        </div>
      )}
      <div className={s.sideComposer}>
        <Composer
          draft={draft} setDraft={setDraft}
          attachments={attachments} setAttachments={setAttachments}
          working={working} agentName={agentName}
          onSend={() => void submit()}
          onStop={() => chat && cancel(chat.id)}
        />
      </div>
    </div>
  )
}
