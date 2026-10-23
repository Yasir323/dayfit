import { useState } from 'react'
import { lunchPickError } from '../../../core/scheduler'
import { formatClock, parseClock } from '../../../core/time'
import type {
  Decision,
  DecisionAnswer,
  DecisionChoice,
  Item,
  LunchChoice
} from '../../../core/types'
import { api } from '../api'
import type { ViewState } from '../api'

interface Props {
  decisions: Decision[]
  items: Item[]
  onDone: (v: ViewState) => void
  /** Needed for the lunch-clash row (plan, settings, now). */
  view?: ViewState
}

type LunchPick = 'shorten' | 'move' | 'pick' | 'skip'

const LABELS: Record<DecisionChoice, string> = {
  'use-other-half': 'Use other half',
  tomorrow: 'Tomorrow',
  unscheduled: 'Keep unscheduled',
  drop: 'Drop'
}
const HALF_CHOICES: DecisionChoice[] = ['use-other-half', 'tomorrow', 'unscheduled', 'drop']
const NO_FIT_CHOICES: DecisionChoice[] = ['tomorrow', 'unscheduled', 'drop']

export function Review({ decisions, items, onDone, view }: Props): React.JSX.Element {
  const [choices, setChoices] = useState<Record<string, DecisionChoice>>({})
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const clash = view?.plan.lunchClash ?? null
  const lunchMin = view?.settings.endOfDay.lunchMin ?? 0
  const [lunchPick, setLunchPick] = useState<LunchPick | null>(null)
  const [pickText, setPickText] = useState('')
  const picked = pickText === '' ? null : parseClock(pickText)
  const pickError =
    lunchPick !== 'pick' || !view
      ? null
      : picked === null
        ? pickText === ''
          ? null
          : 'Enter a time'
        : lunchPickError(picked, lunchMin, view.plan.blocks, view.items, view.settings, view.now)
  const lunchAnswer = ((): LunchChoice | null | undefined => {
    if (!clash) return undefined
    if (lunchPick === 'skip') return { kind: 'skip' }
    if (lunchPick === 'shorten' && clash.shorten) return { kind: 'shorten' }
    if (lunchPick === 'move' && clash.move !== null) return { kind: 'move' }
    if (lunchPick === 'pick' && picked !== null && pickError === null)
      return { kind: 'at', start: picked, len: lunchMin }
    return null
  })()
  const complete = decisions.every((d) => choices[d.itemId] !== undefined) && lunchAnswer !== null

  const apply = async (): Promise<void> => {
    if (!complete || saving) return
    setSaving(true)
    setFailure(null)
    try {
      const answers: DecisionAnswer[] = decisions.map((d) => ({
        itemId: d.itemId,
        choice: choices[d.itemId]
      }))
      onDone(
        await (lunchAnswer
          ? api.answerDecisions(answers, lunchAnswer)
          : api.answerDecisions(answers))
      )
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Could not apply answers')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="review card">
      <h2>Review your plan</h2>
      <p className="muted review-intro">Some items don&apos;t fit as planned. Choose what to do.</p>
      {decisions.map((d) => {
        const title = items.find((i) => i.id === d.itemId)?.title ?? 'Unknown item'
        const options = d.kind === 'half-overflow' ? HALF_CHOICES : NO_FIT_CHOICES
        return (
          <div key={d.itemId} role="group" aria-label={title} className="review-row">
            <p className="review-title">{title}</p>
            <p className="review-why">
              {d.kind === 'half-overflow'
                ? `${d.preferred === 'am' ? 'Morning' : 'Afternoon'} is full`
                : "Doesn't fit today"}
            </p>
            <div className="choice-seg">
              {options.map((c) => (
                <label key={c} className={choices[d.itemId] === c ? 'is-on' : undefined}>
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
          </div>
        )
      })}
      {clash && (
        <div role="group" aria-label="Lunch" className="review-row">
          <p className="review-title">Lunch</p>
          <p className="review-why">
            {clash.reason === 'passed'
              ? 'Lunch time has passed'
              : clash.outOfHours
                ? `Lunch ${formatClock(clash.usual)} runs past working hours`
                : `Lunch ${formatClock(clash.usual)} clashes with ${clash.clashWith ?? 'Busy'}`}
          </p>
          <div className="choice-seg">
            {(
              [
                clash.shorten && ['shorten', `Shorten to ${clash.shorten.len} min`],
                clash.move !== null && ['move', `Move to ${formatClock(clash.move)}`],
                ['pick', 'Pick a time'],
                ['skip', 'Skip today']
              ].filter(Boolean) as [LunchPick, string][]
            ).map(([c, label]) => (
              <label key={c} className={lunchPick === c ? 'is-on' : undefined}>
                <input
                  type="radio"
                  name="decision-lunch"
                  checked={lunchPick === c}
                  onChange={() => setLunchPick(c)}
                />
                {label}
              </label>
            ))}
          </div>
          {lunchPick === 'pick' && (
            <div className="lunch-pick">
              <input
                type="time"
                aria-label="Lunch start"
                value={pickText}
                onChange={(e) => setPickText(e.target.value)}
              />
              {pickError && (
                <p className="error" role="alert">
                  {pickError}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}
      <div className="review-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={!complete || saving}
          onClick={() => void apply()}
        >
          Apply
        </button>
      </div>
    </div>
  )
}
