import { useState } from 'react'
import { FileText } from 'lucide-react'
import type { DiffHunk } from '../../../shared/types'
import { Button, Pill } from '../../components'
import { diffRows, hunkHeader, prefixHunks } from './logic'
import s from './code.module.css'

const CAP = 400 // rows drawn before "Show all"

/** "+142 −28" in green and red, monospaced digits. */
export function Counts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className={s.counts}>
      <span className={s.added}>+{added}</span>
      <span className={s.removed}>−{removed}</span>
    </span>
  )
}

/** A file's change as hunks with three lines of context, both line numbers in the gutter,
 *  and "+N −M" beside the path. `hunks` null while loading. */
export function DiffView({ path, hunks, onRevert }: { path: string; hunks: DiffHunk[] | null; onRevert?: () => void }) {
  const [showAll, setShowAll] = useState(false)
  const all = hunks ?? []
  const lines = all.flatMap((h) => h.lines)
  const total = diffRows(all)
  return (
    <div className={s.diff}>
      <div className={s.diffHead}>
        <FileText size={14} />
        <span className={s.path} title={path}><bdi>{path}</bdi></span>
        <span className={s.added}>+{lines.filter((l) => l.kind === 'added').length}</span>
        <span className={s.removed}>−{lines.filter((l) => l.kind === 'removed').length}</span>
        {onRevert && <Pill cue={null} style={{ height: 26 }} onClick={onRevert}>Revert</Pill>}
      </div>
      {hunks && !hunks.length && <div className={s.note}>No changes</div>}
      <div className={s.diffBody}>
        {prefixHunks(all, showAll ? Infinity : CAP).map((h, i) => (
          <div key={i}>
            <div className={s.hunk}>{hunkHeader(h)}</div>
            {h.lines.map((l, j) => (
              <div key={j} className={`${s.line} ${l.kind === 'added' ? s.add : l.kind === 'removed' ? s.del : ''}`}>
                <span>{l.old ?? ''}</span>
                <span>{l.new ?? ''}</span>
                <span>{l.kind === 'removed' ? '−' : l.kind === 'added' ? '+' : ' '}</span>
                <span>{l.text || ' '}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {total > CAP && !showAll && (
        <Button cue="open" className={s.showAll} onClick={() => setShowAll(true)}>Show all {total} lines</Button>
      )}
    </div>
  )
}
