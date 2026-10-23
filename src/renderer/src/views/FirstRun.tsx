import { useRef, useState } from 'react'
import { formatClock } from '../../../core/time'
import { defaultDnd } from '../../../core/types'
import type { NewItem, Settings } from '../../../core/types'
import { api } from '../api'
import type { ViewState } from '../api'
import { checkEnd, parseLunch, parsePositive, parseTime } from './settingsValidation'
import './Settings.css'

interface Props {
  settings: Settings
  today: string
  onDone: (v: ViewState) => void
}

const STEPS = 3

export function FirstRun({ settings, today, onDone }: Props): React.JSX.Element {
  const [step, setStep] = useState(1)
  const [start, setStart] = useState(formatClock(settings.workStart))
  const [end, setEnd] = useState(formatClock(settings.workEnd))
  const [lunch, setLunch] = useState(settings.lunch === null ? '' : formatClock(settings.lunch))
  const [water, setWater] = useState(String(settings.water.targetMl))
  const [title, setTitle] = useState('Evening run')
  const [runStart, setRunStart] = useState('18:30')
  const [runDur, setRunDur] = useState('45')
  const added = useRef(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const s = parseTime(start)
  const e = parseTime(end)
  const startError = s.ok ? null : s.error
  const endError = !e.ok ? e.error : s.ok ? checkEnd(s.value, e.value) : null
  const l = s.ok && e.ok ? parseLunch(lunch, s.value, e.value) : null
  const lunchError = l && !l.ok ? l.error : null
  const w = parsePositive(water)
  const waterError = w.ok ? null : w.error
  const rs = parseTime(runStart)
  const rd = parsePositive(runDur)
  const runError = !title.trim()
    ? 'Title is required'
    : !rs.ok
      ? rs.error
      : !rd.ok
        ? rd.error
        : null

  const stepError =
    step === 1 ? (startError ?? endError ?? lunchError) : step === 2 ? waterError : null
  const canNext = stepError === null

  const finish = async (keep: boolean): Promise<void> => {
    if (saving || !s.ok || !e.ok || !l || !l.ok || !w.ok) return
    if (keep && (!rs.ok || !rd.ok || runError)) return
    setSaving(true)
    setFailure(null)
    try {
      if (keep && !added.current && rs.ok && rd.ok) {
        const item: NewItem = {
          title: title.trim(),
          type: 'fixed',
          durationMin: rd.value,
          label: null,
          priority: 'med',
          half: null,
          date: today,
          fixedStart: rs.value,
          deadline: null,
          repeat: { kind: 'daily' },
          dnd: defaultDnd('fixed', rs.value)
        }
        await api.addItems([item])
        added.current = true
      }
      const v = await api.updateSettings({
        workStart: s.value,
        workEnd: e.value,
        lunch: l.value,
        water: { ...settings.water, targetMl: w.value },
        firstRunDone: true
      })
      onDone(v)
    } catch {
      setFailure('Could not save setup. Try again.')
      setSaving(false)
    }
  }

  return (
    <section className="firstrun card" aria-label="First run setup">
      <h2>Welcome to Dayfit</h2>
      <div className="steps">
        <span>
          Step {step} of {STEPS}
        </span>
        <span
          className="step-dots"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={1}
          aria-valuemax={STEPS}
          aria-valuenow={step}
        >
          {Array.from({ length: STEPS }, (_, k) => (
            <i key={k} className={k < step ? 'is-on' : undefined} />
          ))}
        </span>
      </div>

      {step === 1 && (
        <div>
          <label className="field">
            <span>Start</span>
            <input type="time" value={start} onChange={(ev) => setStart(ev.target.value)} />
          </label>
          <label className="field">
            <span>End</span>
            <input type="time" value={end} onChange={(ev) => setEnd(ev.target.value)} />
          </label>
          <label className="field">
            <span>Lunch (optional)</span>
            <input type="time" value={lunch} onChange={(ev) => setLunch(ev.target.value)} />
          </label>
        </div>
      )}

      {step === 2 && (
        <label className="field">
          <span>Daily water target (ml)</span>
          <input type="number" value={water} onChange={(ev) => setWater(ev.target.value)} />
        </label>
      )}

      {step === 3 && (
        <div>
          <p>Add a repeating evening item, or skip.</p>
          <label className="field">
            <span>Title</span>
            <input value={title} onChange={(ev) => setTitle(ev.target.value)} />
          </label>
          <label className="field">
            <span>Starts at</span>
            <input type="time" value={runStart} onChange={(ev) => setRunStart(ev.target.value)} />
          </label>
          <label className="field">
            <span>Duration (min)</span>
            <input type="number" value={runDur} onChange={(ev) => setRunDur(ev.target.value)} />
          </label>
          <p className="muted small">Repeats daily.</p>
        </div>
      )}

      {(stepError ?? (step === 3 ? runError : null)) && (
        <p className="field-error" role="alert">
          {stepError ?? runError}
        </p>
      )}
      {failure && (
        <p className="field-error" role="alert">
          {failure}
        </p>
      )}

      <div className="actions">
        {step > 1 && (
          <button type="button" className="btn" onClick={() => setStep(step - 1)} disabled={saving}>
            Back
          </button>
        )}
        {step < STEPS && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => setStep(step + 1)}
            disabled={!canNext}
          >
            Next
          </button>
        )}
        {step === STEPS && (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => void finish(false)}
              disabled={saving}
            >
              Skip
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void finish(true)}
              disabled={saving || runError !== null}
            >
              Add and finish
            </button>
          </>
        )}
      </div>
    </section>
  )
}
