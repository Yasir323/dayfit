import { useState } from 'react'
import type { NudgeAnswer } from '../../../core/nudge'
import { api } from '../api'
import type { ViewState } from '../api'

interface Props {
  id: string
  title: string
  onView: (v: ViewState) => void
  ref?: React.Ref<HTMLDivElement>
}

const BUTTONS: [NudgeAnswer, string][] = [
  ['done', 'Done'],
  ['extend', 'Need 15 more min'],
  ['move', 'Move it']
]

/** End-of-item nudge: one banner per overdue item. */
export function NudgeBanner({ id, title, onView, ref }: Props): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const answer = async (a: NudgeAnswer): Promise<void> => {
    setBusy(true)
    setFailure(null)
    try {
      onView(await api.answerNudge(id, a))
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Could not answer')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="nudge" role="group" aria-label={`Nudge: ${title}`} ref={ref} tabIndex={-1}>
      <p className="nudge-text">{title} — time&apos;s up</p>
      <div className="nudge-actions">
        {BUTTONS.map(([a, label]) => (
          <button key={a} type="button" disabled={busy} onClick={() => void answer(a)}>
            {label}
          </button>
        ))}
      </div>
      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}
    </div>
  )
}
