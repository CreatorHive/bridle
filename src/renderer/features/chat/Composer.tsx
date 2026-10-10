import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { ArrowUpRight, Mic, Plus } from 'lucide-react'
import { Button, MOTION, reducedMotion, Swap, useLayoutEffectInBrowser } from '../../components'
import { play } from '../../sound'
import { AttachmentChip } from './Transcript'
import s from './chat.module.css'

/** Dictated text after what's there, with a space between words. */
const joined = (a: string, b: string): string => (!a || !b || /\s$/.test(a) || /^\s/.test(b) ? a + b : `${a} ${b}`)

/** Pill input, add on the left, mic and send on the right; grows to ten lines
 *  on MOTION.composerLines. Return sends, Shift-Return adds a line; while a reply runs, send becomes a
 *  spinner that stops it. Dropped files sit above the text as chips until sent. */
export function Composer({ draft, setDraft, attachments, setAttachments, working, agentName, onSend, onStop }: {
  draft: string
  setDraft: (d: string) => void
  attachments: string[]
  setAttachments: Dispatch<SetStateAction<string[]>>
  working: boolean
  agentName: string
  onSend: () => void
  onStop: () => void
}) {
  const input = useRef<HTMLTextAreaElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | null>(null)
  const empty = !draft.trim() && !attachments.length
  // A removed chip shrinks away (scale 0.9, fading) on MOTION.composerLines before it leaves the list.
  const [leaving, setLeaving] = useState<string[]>([])
  const removeChip = (p: string) => {
    setLeaving((l) => [...l, p])
    setTimeout(() => {
      setAttachments((a) => a.filter((x) => x !== p))
      setLeaving((l) => l.filter((x) => x !== p))
    }, reducedMotion() ? 0 : MOTION.composerLines.duration)
  }
  useEffect(() => input.current?.focus(), [])

  // Dictation (PLAN.md Voice): SpeechAnalyzer through the native helper. Partial text shows live after what was
  // already typed; final text is committed. Click toggles, holding talks until release; Esc cancels, Return keeps.
  const dictation = useRef<{ base: string; committed: string } | null>(null)
  const pressedAt = useRef(0)
  const [listening, setListening] = useState(false)
  const [micNote, setMicNote] = useState<string | null>(null)

  useEffect(() => window.bridle.on('native:dictation', (e) => {
    const d = dictation.current
    if (!d) return
    if (e.error) {
      dictation.current = null
      setListening(false)
      setMicNote(e.error)
      return play('error')
    }
    if (e.text === undefined) return
    if (e.final) d.committed = joined(d.committed, e.text)
    setDraft(joined(d.base, e.final ? d.committed : joined(d.committed, e.text)))
  }), [setDraft])
  useEffect(() => () => {
    if (dictation.current) void window.bridle.native.dictate('cancel')
  }, [])

  const startDictation = async () => {
    dictation.current = { base: draft, committed: '' }
    setListening(true)
    setMicNote(null)
    input.current?.focus()
    play('toggle')
    try {
      await window.bridle.native.dictate('start')
    } catch (e) {
      dictation.current = null
      setListening(false)
      setMicNote((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      play('error')
    }
  }

  const stopDictation = async (cancel = false) => {
    const d = dictation.current
    if (!d) return
    setListening(false)
    play(cancel ? 'close' : 'toggle', { direction: -1 })
    await window.bridle.native.dictate(cancel ? 'cancel' : 'stop').catch(() => {})
    if (cancel) setDraft(d.base)
    dictation.current = null
  }

  // The field's height follows a hidden copy of the text, so a line added or removed eases in.
  useLayoutEffectInBrowser(() => {
    if (mirror.current) setHeight(mirror.current.offsetHeight)
  }, [draft])

  const submit = () => {
    if (empty || working) return play('error', { emphasis: 'subtle' })
    onSend()
  }

  const pick = async () => {
    const picked = (await window.bridle.workspace.pickFiles({ prompt: 'Attach', multiple: true }).catch(() => []))
      .filter((p) => !attachments.includes(p))
    if (!picked.length) return
    play('select')
    setAttachments([...attachments, ...picked])
  }

  return (
    <div className={s.composer} onClick={() => input.current?.focus()}>
      {attachments.length > 0 && (
        <div className={`${s.composerFiles} b-fade-entry`}>
          {attachments.map((p) => (
            <span key={p} className={leaving.includes(p) ? s.chipLeaving : 'b-pop-entry'}>
              <AttachmentChip path={p} remove={() => removeChip(p)} />
            </span>
          ))}
        </div>
      )}
      <div className={s.composerRow}>
        <Button cue={null} className={`${s.round} ${s.glass}`} title="Attach files" aria-label="Attach files" onClick={() => void pick()}>
          <Plus size={17} strokeWidth={2.4} />
        </Button>
        <div className={s.field}>
          <div ref={mirror} className={s.mirror} aria-hidden>{draft + '​'}</div>
          <textarea
            ref={input}
            rows={1}
            value={draft}
            placeholder={micNote ?? (listening ? 'Listening…' : `Ask ${agentName}…`)}
            style={height ? { height } : undefined}
            onChange={(e) => {
              setDraft(e.target.value)
              setMicNote(null)
            }}
            onKeyDown={(e) => {
              if (dictation.current && (e.key === 'Escape' || e.key === 'Enter')) {
                e.preventDefault()
                void stopDictation(e.key === 'Escape')
              } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
          />
        </div>
        <Button cue={null} className={`${s.round} ${s.glass} ${s.mic}`} style={listening ? { color: 'var(--red)' } : undefined}
          title={listening ? 'Stop dictation (Esc cancels)' : 'Dictate (click, or hold to talk)'}
          aria-label={listening ? 'Stop dictation' : 'Dictate'} aria-pressed={listening}
          onPointerDown={() => {
            if (dictation.current) return
            pressedAt.current = Date.now()
            void startDictation()
          }}
          onPointerUp={() => {
            const at = pressedAt.current
            pressedAt.current = 0
            if (at ? Date.now() - at > 400 : dictation.current) void stopDictation()
          }}
          onClick={(e) => {
            if (e.detail === 0) void (dictation.current ? stopDictation() : startDictation()) // keyboard
          }}>
          <Mic size={17} />
        </Button>
        <Button
          cue={null}
          className={`${s.round} ${s.send} ${empty && !working ? s.idle : ''}`}
          title={working ? 'Stop' : 'Send ↩ · New line ⇧↩'}
          aria-label={working ? 'Stop' : 'Send'}
          onClick={() => {
            if (!working) return submit()
            play('close')
            onStop()
          }}
        >
          {/* RoundButton: the arrow scales out (0.6×, fading) as the spinner takes its place. */}
          <Swap k={working ? 'spin' : 'send'}>
            {working ? <span className={s.sendSpinner} /> : <ArrowUpRight size={17} strokeWidth={2.4} />}
          </Swap>
        </Button>
      </div>
    </div>
  )
}
