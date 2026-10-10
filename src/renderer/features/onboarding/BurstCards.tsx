import type { ReactNode } from 'react'
import { Calendar, CircleX, FileText, Folder, House, Mail, NotebookPen, Search, Sun } from 'lucide-react'
import { logos } from '../../theme'
import type { CardId } from './burst'
import { pill, source } from './Demos'
import d from './onboarding.module.css'
import s from './showcase.module.css'

// The burst's cards: Bridle's own pieces (the demo cards' source rows, pills, terminal), shrunk to a glance.
// Sample content only, the same people as the demos.

const BLUE = '#1A73E8'
const GREEN = '#1E9E5A'
const RED = '#ff3b30'
const img = (src: string) => <img src={src} alt="" className={d.dIcon} />

const CARDS: Record<CardId, () => ReactNode> = {
  mail: () => (
    <>
      {source(<span className={s.dotWrap}>{img(logos.google)}<i className={s.pulse} /></span>, 'Gmail · you@work.com', '2m')}
      <p className={d.dText}>Russell is waiting on the zip file for the site signup. <span style={{ color: BLUE }}>Open email</span></p>
    </>
  ),

  invite: () => (
    <div className={s.inviteRow}>
      <Calendar className={d.dIcon} color={BLUE} />
      <div className={d.dInviteText}>
        <strong>Phase 1 Kickoff</strong>
        <span>Tue 10:00 · from Brooke</span>
      </div>
      <span className={d.spacer} />
      <span className={s.tickYes}>{pill('Yes', false, { small: true })}</span>
      {pill('No', false, { small: true })}
      {pill('Maybe', false, { small: true })}
    </div>
  ),

  prep: () => (
    <>
      {source(<NotebookPen className={d.dIcon} />, 'Meetings', 'Tue 10:00')}
      <strong className={s.title}>Prep: Phase 1 Kickoff</strong>
      <ul className={s.bullets}>
        <li>Brooke wants a timeline by Friday</li>
        <li>Russell owns the signup flow</li>
        <li>Open: which staging domain?</li>
      </ul>
    </>
  ),

  github: () => (
    <>
      {source(img(logos.github), 'bridle · PR #212', '1m')}
      <div className={s.check}>
        <CircleX size={16} color="#fff" fill={RED} />
        <span><strong>test</strong> failed on your PR</span>
      </div>
      <span className={s.sub}>parsesGmailSenders: quoted names</span>
    </>
  ),

  linear: () => (
    <>
      {source(img(logos.linear), 'Linear · Website')}
      <div className={s.issue}>
        <span className={s.chip}>DUV-484</span>
        <span className={s.ellipsis}>Signup zip is missing the setup guide</span>
      </div>
      <div className={s.status}><i style={{ borderColor: '#F2C94C' }} />In Progress<span className={d.spacer} /><span className={s.sub}>Due Fri</span></div>
    </>
  ),

  terminal: () => (
    <>
      <div className={d.dSource}>
        {img(logos.claude)}
        <span>Code · bridle</span>
        <span className={d.branch}>bridle/naples</span>
      </div>
      <div className={`${d.terminal} ${s.term}`}>
        <div className={s.t1} style={{ color: 'rgba(255,255,255,0.85)' }}>$ swift test</div>
        <div className={s.t2} style={{ color: '#FF6B6B' }}>✗ parsesGmailSenders</div>
        <div className={s.t3} style={{ color: 'rgba(255,255,255,0.85)' }}>$ swift test</div>
        <div className={s.t4} style={{ color: '#51CF66' }}>✓ 16 tests passed<span className={s.caret} /></div>
      </div>
    </>
  ),

  change: () => (
    <div className={d.change}>
      <FileText className={d.dIcon} />
      <span className={d.mono}>Connections.swift</span>
      <span className={d.diff}><span style={{ color: GREEN }}>+3</span> <span style={{ color: RED }}>−1</span></span>
      <span className={d.spacer} />
      <span className={s.glowPulse}>{pill('Review', true, { small: true })}</span>
      {pill('Undo', false, { small: true })}
    </div>
  ),

  search: () => (
    <>
      <div className={s.searchField}>
        <Search size={14} strokeWidth={2.4} />
        <span>zip file<span className={s.caretDark} /></span>
        <span className={d.spacer} />
        <kbd>⌘K</kbd>
      </div>
      <div className={s.results}>
        <div className={s.hit}><Mail size={14} />Re: Site setup<span className={d.spacer} /><span className={s.sub}>Mail</span></div>
        <div className={s.result}><Folder size={14} />signup.zip<span className={d.spacer} /><span className={s.sub}>Files</span></div>
        <div className={s.result}><Calendar size={14} />Phase 1 Kickoff<span className={d.spacer} /><span className={s.sub}>Calendar</span></div>
      </div>
    </>
  ),

  files: () => (
    <>
      {source(<Folder className={d.dIcon} />, 'Files · Website')}
      <div className={s.tiles}>
        {[['kickoff.pdf', '#FDE2E1', '#E5484D'], ['signup.zip', '#E1ECFF', '#3B7CFF'], ['notes.md', '#E6F6EC', '#1E9E5A']].map(([name, bg, fg]) => (
          <div key={name} className={s.tile}>
            <div className={s.thumb} style={{ background: bg }}><i style={{ background: fg }} /><i /><i /></div>
            <span>{name}</span>
          </div>
        ))}
      </div>
    </>
  ),

  briefing: () => (
    <>
      {source(<Sun className={d.dIcon} color="#E8A200" />, 'Morning briefing', '8:00')}
      <div className={s.brief}>
        <strong>Today</strong>
        <span>Phase 1 Kickoff at 10:00, prep is ready</span>
        <strong>Needs you</strong>
        <span>Russell is waiting on the zip file</span>
        <span>A test failed on PR #212</span>
      </div>
    </>
  ),

  imessage: () => (
    <div className={s.phone}>
      <div className={s.notch} />
      <span className={s.phoneWho}>Bridle</span>
      <div className={s.imsg}>From Bridle: Russell is waiting on the zip file. Open Bridle to reply.</div>
      <span className={s.delivered}>Delivered</span>
    </div>
  ),

  approval: () => (
    <div className={`${d.dPanel} ${s.flat}`}>
      <div className={d.dPanelTitle}><Mail size={14} />Send this email?</div>
      <div className={d.dField}><span>To</span>Russell Johnson</div>
      <div className={d.dField}><span>Subject</span>Re: Site setup</div>
      <p className={d.dBody}>Hi Russell, the zip is attached. Setup takes about ten minutes…</p>
      <div className={d.dPills}>{pill('Send', true, { glow: true })}{pill('Edit', false)}</div>
    </div>
  ),

  drive: () => (
    <>
      {source(img(logos.google), 'Drive', '1h')}
      <div className={s.doc}>
        <div className={s.docIcon}><FileText size={16} color="#fff" /></div>
        <div className={s.docText}>
          <strong>Phase 1 Scope</strong>
          <span>Edited by Brooke</span>
        </div>
      </div>
    </>
  ),

  home: () => (
    <>
      {source(<House className={d.dIcon} />, 'Home', 'now')}
      <div className={s.homeRow}>
        <img src={logos.bridle} alt="" width={16} height={16} />
        <div className={s.homeBubble}>Brooke moved the kickoff to 10:30. Want me to tell Russell?</div>
      </div>
    </>
  )
}

export const BurstCard = ({ id }: { id: CardId }) => <>{CARDS[id]()}</>
