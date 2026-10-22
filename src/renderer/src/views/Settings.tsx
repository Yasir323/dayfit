import { useId, useState } from 'react'
import { formatClock } from '../../../core/time'
import type { ItemType, Settings as SettingsShape } from '../../../core/types'
import { api } from '../api'
import type { ViewState } from '../api'
import { checkEnd, parseLunch, parsePositive, parseTime } from './settingsValidation'
import type { Parsed } from './settingsValidation'
import './Settings.css'

interface Props {
  view: ViewState
  onView?: (v: ViewState) => void
}

type Send = (patch: Partial<SettingsShape>) => void

interface FieldProps<T> {
  label: string
  value: string
  type?: 'text' | 'time' | 'number'
  parse: (draft: string) => Parsed<T>
  onValid: (v: T) => void
  /** Send on blur instead of on every valid change. */
  onBlurOnly?: boolean
}

function Field<T>({
  label,
  value,
  type = 'text',
  parse,
  onValid,
  onBlurOnly
}: FieldProps<T>): React.JSX.Element {
  const id = useId()
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const run = (d: string): void => {
    const r = parse(d)
    if (r.ok) {
      setError(null)
      onValid(r.value)
    } else {
      setError(r.error)
    }
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={draft}
        aria-invalid={error !== null}
        onChange={(e) => {
          setDraft(e.target.value)
          if (!onBlurOnly) run(e.target.value)
        }}
        onBlur={onBlurOnly ? (e) => run(e.target.value) : undefined}
      />
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

const num = (label: string, value: number, onValid: (n: number) => void): React.JSX.Element => (
  <Field
    label={label}
    type="number"
    value={String(value)}
    parse={parsePositive}
    onValid={onValid}
  />
)

function Toggle({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (b: boolean) => void
}): React.JSX.Element {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

const DURATION_TYPES: ItemType[] = ['task', 'call', 'deep', 'household', 'fixed']

export function Settings({ view, onView }: Props): React.JSX.Element {
  const s = view.settings
  const send: Send = (patch) => {
    void api.updateSettings(patch).then((v) => onView?.(v))
  }

  return (
    <section className="settings">
      <h2>Settings</h2>

      <fieldset>
        <legend>Working hours</legend>
        <Field
          label="Start"
          type="time"
          value={formatClock(s.workStart)}
          parse={(d) => {
            const t = parseTime(d)
            if (!t.ok) return t
            const e = checkEnd(t.value, s.workEnd)
            return e ? { ok: false, error: e } : t
          }}
          onValid={(v) => send({ workStart: v })}
        />
        <Field
          label="End"
          type="time"
          value={formatClock(s.workEnd)}
          parse={(d) => {
            const t = parseTime(d)
            if (!t.ok) return t
            const e = checkEnd(s.workStart, t.value)
            return e ? { ok: false, error: e } : t
          }}
          onValid={(v) => send({ workEnd: v })}
        />
        <Field
          label="Lunch (optional)"
          type="time"
          value={s.lunch === null ? '' : formatClock(s.lunch)}
          parse={(d) => parseLunch(d, s.workStart, s.workEnd)}
          onValid={(v) => send({ lunch: v })}
        />
      </fieldset>

      <fieldset>
        <legend>Buffer</legend>
        {num('Buffer (min)', s.bufferMin, (n) => send({ bufferMin: n }))}
      </fieldset>

      <fieldset>
        <legend>Default durations (min)</legend>
        {DURATION_TYPES.map((t) => (
          <div key={t}>
            {num(`Default ${t} (min)`, s.defaultDurations[t], (n) =>
              send({ defaultDurations: { ...s.defaultDurations, [t]: n } })
            )}
          </div>
        ))}
      </fieldset>

      <fieldset>
        <legend>Reminders</legend>
        <Toggle
          label="Water"
          checked={s.water.enabled}
          onChange={(b) => send({ water: { ...s.water, enabled: b } })}
        />
        {num('Water target (ml)', s.water.targetMl, (n) =>
          send({ water: { ...s.water, targetMl: n } })
        )}
        {num('Glass size (ml)', s.water.glassMl, (n) =>
          send({ water: { ...s.water, glassMl: n } })
        )}

        <Toggle
          label="Eye break"
          checked={s.eye.enabled}
          onChange={(b) => send({ eye: { ...s.eye, enabled: b } })}
        />
        {num('Eye interval (min)', s.eye.intervalMin, (n) =>
          send({ eye: { ...s.eye, intervalMin: n } })
        )}
        {num('Eye idle reset (min)', s.eye.idleResetMin, (n) =>
          send({ eye: { ...s.eye, idleResetMin: n } })
        )}

        <Toggle
          label="Stretch"
          checked={s.stretch.enabled}
          onChange={(b) => send({ stretch: { ...s.stretch, enabled: b } })}
        />
        {num('Stretch interval (min)', s.stretch.intervalMin, (n) =>
          send({ stretch: { ...s.stretch, intervalMin: n } })
        )}

        <Toggle
          label="Walk"
          checked={s.walk.enabled}
          onChange={(b) => send({ walk: { ...s.walk, enabled: b } })}
        />
        {num('Walk interval (min)', s.walk.intervalMin, (n) =>
          send({ walk: { ...s.walk, intervalMin: n } })
        )}
        {num('Walk duration (min)', s.walk.durationMin, (n) =>
          send({ walk: { ...s.walk, durationMin: n } })
        )}

        <Toggle
          label="Meeting alert"
          checked={s.meetingAlert.enabled}
          onChange={(b) => send({ meetingAlert: { ...s.meetingAlert, enabled: b } })}
        />
        {num('Meeting alert lead (min)', s.meetingAlert.leadMin, (n) =>
          send({ meetingAlert: { ...s.meetingAlert, leadMin: n } })
        )}

        <Toggle
          label="Gentle reminders during busy mode"
          checked={s.busy.allowGentle}
          onChange={(b) => send({ busy: { allowGentle: b } })}
        />
      </fieldset>

      <fieldset>
        <legend>System</legend>
        <Field
          label="Hotkey"
          value={s.hotkey}
          onBlurOnly
          parse={(d) =>
            d.trim() === ''
              ? { ok: false, error: 'Hotkey is required' }
              : { ok: true, value: d.trim() }
          }
          onValid={(v) => send({ hotkey: v })}
        />
        <Toggle
          label="Launch at login"
          checked={s.launchAtLogin}
          onChange={(b) => send({ launchAtLogin: b })}
        />
      </fieldset>
    </section>
  )
}
