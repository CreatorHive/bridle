import { Calendar, Code, Folder, Mail, MessagesSquare, Settings, SquareKanban, Users, type LucideIcon } from 'lucide-react'
import { Button } from '../components'
import { play } from '../sound'
import { SECTIONS, useApp, type Section } from './store'

export const SECTION_INFO: Record<Section, { title: string; icon: LucideIcon }> = {
  chat: { title: 'Chat', icon: MessagesSquare },
  board: { title: 'Board', icon: SquareKanban },
  calendar: { title: 'Calendar', icon: Calendar },
  meetings: { title: 'Meetings', icon: Users },
  mail: { title: 'Mail', icon: Mail },
  files: { title: 'Files', icon: Folder },
  code: { title: 'Code', icon: Code }
}

/** One button per section (pitch rising down the rail), then settings and you. */
export function Rail() {
  const { state, patch, openSettings } = useApp()
  const unread = state.mail.some((m) => m.unread && m.mailbox === 'Inbox')
  const userName = state.settings?.userName ?? ''

  const pick = (s: Section, i: number) => {
    play('select', { direction: i - SECTIONS.indexOf(state.section) })
    patch(s === 'chat' ? { section: s, chatId: null } : { section: s })
  }

  return (
    <nav className="rail" aria-label="Sections">
      {SECTIONS.map((s, i) => {
        const { title, icon: Icon } = SECTION_INFO[s]
        const selected = state.section === s
        return (
          <Button
            key={s}
            cue={null}
            className={`rail-button ${selected ? 'selected' : ''}`}
            aria-label={title}
            aria-current={selected || undefined}
            title={title}
            onClick={() => pick(s, i)}
          >
            <Icon size={18} strokeWidth={selected ? 2.2 : 1.8} />
            {s === 'mail' && unread && <span className="badge" />}
          </Button>
        )
      })}
      <div className="rail-spacer" />
      <Button cue="open" className="rail-button" aria-label="Settings" title="Settings" onClick={() => openSettings()}>
        <Settings size={18} strokeWidth={1.8} />
      </Button>
      <Button cue="open" className="rail-avatar" aria-label="Profile" title={userName || 'You'} onClick={() => openSettings('profile')}>
        {/* Circle().fill(.indigo.gradient) with your first letter. */}
        <span className="rail-me">{userName.slice(0, 1)}</span>
      </Button>
    </nav>
  )
}
