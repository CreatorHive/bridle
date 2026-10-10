import { useState } from 'react'
import type { MemorySource } from '../../../shared/types'
import { Button, Pill, SettingsCard, SettingsRow } from '../../components'
import { play } from '../../sound'
import { showSaved } from './ValueField'
import s from './settings.module.css'

const SOURCES: MemorySource[] = ['ChatGPT', 'Claude Code']

/** Copy the prompt, paste the other assistant's answer, import. */
export function MemoryImportCard() {
  const [source, setSource] = useState<MemorySource>('ChatGPT')
  const [answer, setAnswer] = useState('')
  const [result, setResult] = useState<string | null>(null)

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(await window.bridle.memory.prompt(source))
    if (source === 'ChatGPT') void window.bridle.shell.openExternal('https://chatgpt.com')
    setResult('Prompt copied')
  }

  const apply = async (): Promise<void> => {
    const added = await window.bridle.memory.apply(answer, source).catch(() => [])
    if (!added.length) {
      setResult('Nothing to import')
      play('error')
      return
    }
    setAnswer('')
    setResult('Added to ' + added.join(' and '))
    showSaved()
  }

  return (
    <SettingsCard>
      <SettingsRow label="1. Copy the prompt"
        description={source === 'ChatGPT' ? 'Paste it into a new ChatGPT chat' : 'Paste it into Claude Code in your terminal'}>
        <span className={s.inline}>
          <span className={s.segmented} role="radiogroup" aria-label="Import from">
            {SOURCES.map((src) => (
              <Button key={src} cue="select" role="radio" aria-checked={src === source} className={src === source ? s.segment + ' ' + s.on : s.segment}
                onClick={() => setSource(src)}>{src}</Button>
            ))}
          </span>
          <Pill onClick={() => void copy().catch(() => play('error', { emphasis: 'subtle' }))}>
            {source === 'ChatGPT' ? 'Copy and open ChatGPT' : 'Copy prompt'}
          </Pill>
        </span>
      </SettingsRow>
      <div className={s.importBox}>
        <span>2. Paste its answer</span>
        <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} spellCheck={false} aria-label="The answer to import"
          placeholder={'=== USER.md ===\n- …\n\n=== MEMORY.md ===\n- …'} />
        <div className={s.importFoot}>
          <span className={s.hint}>{result}</span>
          <Pill filled cue={null} disabled={!answer.trim()} onClick={() => {
            play('tap')
            void apply()
          }}>Import</Pill>
        </div>
      </div>
    </SettingsCard>
  )
}
