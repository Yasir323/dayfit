import { useState } from 'react'
import type { Decision, DecisionAnswer, DecisionChoice, Item } from '../../../core/types'
import { api } from '../api'
import type { ViewState } from '../api'

interface Props {
  decisions: Decision[]
  items: Item[]
  onDone: (v: ViewState) => void
}

const LABELS: Record<DecisionChoice, string> = {
  'use-other-half': 'Use other half',
  tomorrow: 'Tomorrow',
  unscheduled: 'Keep unscheduled',
  drop: 'Drop'
}
const HALF_CHOICES: DecisionChoice[] = ['use-other-half', 'tomorrow', 'unscheduled', 'drop']
const NO_FIT_CHOICES: DecisionChoice[] = ['tomorrow', 'unscheduled', 'drop']

export function Review({ decisions, items, onDone }: Props): React.JSX.Element {
  const [choices, setChoices] = useState<Record<string, DecisionChoice>>({})
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const complete = decisions.every((d) => choices[d.itemId] !== undefined)

  const apply = async (): Promise<void> => {
    if (!complete || saving) return
    setSaving(true)
    setFailure(null)
    try {
      const answers: DecisionAnswer[] = decisions.map((d) => ({
        itemId: d.itemId,
        choice: choices[d.itemId]
      }))
      onDone(await api.answerDecisions(answers))
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Could not apply answers')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="review">
      <h2>Review</h2>
      {decisions.map((d) => {
        const title = items.find((i) => i.id === d.itemId)?.title ?? 'Unknown item'
        const options = d.kind === 'half-overflow' ? HALF_CHOICES : NO_FIT_CHOICES
        return (
          <div key={d.itemId} role="group" aria-label={title} className="review-row">
            <p className="review-title">{title}</p>
            <p className="review-why">
              {d.kind === 'half-overflow'
                ? `Does not fit the ${d.preferred === 'am' ? 'first' : 'second'} half`
                : 'Does not fit today'}
            </p>
            {options.map((c) => (
              <label key={c}>
                <input
                  type="radio"
                  name={`decision-${d.itemId}`}
                  checked={choices[d.itemId] === c}
                  onChange={() => setChoices((s) => ({ ...s, [d.itemId]: c }))}
                />
                {LABELS[c]}
              </label>
            ))}
          </div>
        )
      })}
      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}
      <button type="button" disabled={!complete || saving} onClick={() => void apply()}>
        Apply
      </button>
    </div>
  )
}
