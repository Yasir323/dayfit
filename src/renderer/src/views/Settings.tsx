import { useId, useState } from 'react'
import { formatClock, minutesOf } from '../../../core/time'
import type {
  CustomReminder,
  Features as FeaturesShape,
  ItemType,
  Settings as SettingsShape,
  SettingsPatch
} from '../../../core/types'
import { ERGONOMICS } from '../../../core/ergonomics'
import { api } from '../api'
import type { ViewState } from '../api'
import {
  LUNCH_ERROR,
  checkEnd,
  parseLunch,
  parsePortalUrl,
  parsePositive,
  parseTimes,
  parseSnooze,
  parseTime
} from './settingsValidation'
import type { Parsed } from './settingsValidation'
import './Settings.css'
import { FLAGS } from '../../../core/flags'

interface Props {
  view: ViewState
  onView?: (v: ViewState) => void
}

type Send = (patch: SettingsPatch) => Promise<boolean>

interface FieldProps<T> {
  label: string
  value: string
  type?: 'text' | 'time' | 'number' | 'password'
  parse: (draft: string) => Parsed<T>
  /** Resolves false when saving failed; the draft then reverts to the saved value. */
  onValid: (v: T) => Promise<boolean> | void
  /** Send on blur (and only when changed) instead of on every valid change. */
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
  const [seen, setSeen] = useState(value)
  const [error, setError] = useState<string | null>(null)
  // Resync from the saved value whenever it changes.
  if (seen !== value) {
    setSeen(value)
    setDraft(value)
    setError(null)
  }
  const run = (d: string): void => {
    const r = parse(d)
    if (r.ok) {
      setError(null)
      if (onBlurOnly && d === value) return
      void Promise.resolve(onValid(r.value)).then((saved) => {
        if (saved === false) setDraft(value)
      })
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

const num = (
  label: string,
  value: number,
  onValid: (n: number) => Promise<boolean>,
  parse: (s: string) => Parsed<number> = parsePositive
): React.JSX.Element => (
  <Field
    label={label}
    type="number"
    value={String(value)}
    parse={parse}
    onValid={onValid}
    onBlurOnly
  />
)

function Toggle({
  label,
  checked,
  onChange,
  disabled = false
}: {
  label: string
  checked: boolean
  onChange: (b: boolean) => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="field toggle-row">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="switch"
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="knob" />
      </button>
    </div>
  )
}

/** Monday first, as people read a week. */
const WEEK: [number, string][] = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [0, 'Sun']
]

const DURATION_TYPES: ItemType[] = ['task', 'call', 'deep', 'household', 'fixed']

type Switchable = Exclude<keyof FeaturesShape, 'reminders'>
const FEATURE_LABELS: [Switchable, string][] = [
  ['mood', 'Mood check-ins'],
  ['standing', 'Sit/stand reminders'],
  ['breathe', 'Breathing offers'],
  ['windDown', 'Wind-down'],
  ['daylight', 'Daylight nudge'],
  ['callFatigue', 'Call fatigue'],
  ['commute', 'Start-of-day ritual'],
  ['autoBusyFullscreen', 'Busy when full screen'],
  ['fatigue', 'Fatigue signals']
]

/** Every optional wellbeing feature: a switch each, with its numbers underneath. */
function FeaturesGroup({ s, send }: { s: SettingsShape; send: Send }): React.JSX.Element {
  const f = s.features
  const set = <K extends Switchable>(k: K, patch: Partial<FeaturesShape[K]>): Promise<boolean> =>
    send({ features: { [k]: { ...f[k], ...patch } } })
  return (
    <fieldset>
      <legend>Features</legend>
      <div className="group-card">
        {FEATURE_LABELS.map(([k, label]) => (
          <div key={k}>
            <Toggle
              label={label}
              checked={f[k].enabled}
              onChange={(b) => void set(k, { enabled: b })}
            />
            {k === 'mood' && (
              <Field
                label="Check-in times (HH:MM, …)"
                value={f.mood.times.map(formatClock).join(', ')}
                parse={parseTimes}
                onValid={(v) => set('mood', { times: v })}
                onBlurOnly
              />
            )}
            {k === 'standing' &&
              num('Switch sit/stand every (min)', f.standing.intervalMin, (n) =>
                set('standing', { intervalMin: n })
              )}
            {k === 'windDown' &&
              num('Wind down after work end (min)', f.windDown.afterMin, (n) =>
                set('windDown', { afterMin: n })
              )}
            {k === 'daylight' && (
              <Field
                label="Daylight nudge at"
                type="time"
                value={formatClock(f.daylight.at)}
                parse={parseTime}
                onValid={(v) => set('daylight', { at: v })}
              />
            )}
            {k === 'callFatigue' &&
              num('Call fatigue after (min of meetings)', f.callFatigue.thresholdMin, (n) =>
                set('callFatigue', { thresholdMin: n })
              )}
          </div>
        ))}
      </div>
    </fieldset>
  )
}

/** The user's own reminders: add (at set times or every N minutes), switch off, delete. */
function RemindersGroup({ s, send }: { s: SettingsShape; send: Send }): React.JSX.Element {
  const f = s.features
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<CustomReminder['kind']>('at')
  const [times, setTimes] = useState('')
  const [every, setEvery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ids = { title: useId(), kind: useId(), times: useId(), every: useId() }
  const save = (reminders: CustomReminder[]): Promise<boolean> => send({ features: { reminders } })
  const add = async (): Promise<void> => {
    if (title.trim() === '') return setError('Give the reminder a name')
    const base = { id: crypto.randomUUID(), title: title.trim(), kind, enabled: true }
    let r: CustomReminder
    if (kind === 'at') {
      const t = parseTimes(times)
      if (!t.ok) return setError(t.error)
      r = { ...base, times: t.value, everyMin: 0 }
    } else {
      const n = parsePositive(every)
      if (!n.ok) return setError(n.error)
      r = { ...base, times: [], everyMin: n.value }
    }
    setError(null)
    if (await save([...f.reminders, r])) {
      setTitle('')
      setTimes('')
      setEvery('')
    }
  }
  return (
    <fieldset>
      <legend>My reminders</legend>
      <div className="group-card">
        {f.reminders.map((r) => (
          <div key={r.id} className="reminder-row">
            <Toggle
              label={r.title}
              checked={r.enabled}
              onChange={(b) =>
                void save(f.reminders.map((x) => (x.id === r.id ? { ...x, enabled: b } : x)))
              }
            />
            <span className="muted reminder-when">
              {r.kind === 'at' ? r.times.map(formatClock).join(', ') : `every ${r.everyMin} min`}
            </span>
            <button
              type="button"
              className="btn-ghost"
              aria-label={`Delete ${r.title}`}
              onClick={() => void save(f.reminders.filter((x) => x.id !== r.id))}
            >
              Delete
            </button>
          </div>
        ))}
        <div className="field">
          <label htmlFor={ids.title}>Reminder</label>
          <input
            id={ids.title}
            value={title}
            placeholder="e.g. Take vitamin D"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={ids.kind}>Repeat</label>
          <select
            id={ids.kind}
            value={kind}
            onChange={(e) => setKind(e.target.value as CustomReminder['kind'])}
          >
            <option value="at">At times</option>
            <option value="every">Every N minutes of work</option>
          </select>
        </div>
        {kind === 'at' ? (
          <div className="field">
            <label htmlFor={ids.times}>Times (HH:MM, …)</label>
            <input
              id={ids.times}
              value={times}
              placeholder="08:00, 20:00"
              onChange={(e) => setTimes(e.target.value)}
            />
          </div>
        ) : (
          <div className="field">
            <label htmlFor={ids.every}>Every (min)</label>
            <input
              id={ids.every}
              type="number"
              value={every}
              onChange={(e) => setEvery(e.target.value)}
            />
          </div>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="backup-actions">
          <button type="button" className="btn" onClick={() => void add()}>
            Add reminder
          </button>
        </div>
      </div>
    </fieldset>
  )
}

/** A one-time home setup checklist; ticks are saved. */
function HomeSetup({
  ticked,
  onView
}: {
  ticked: string[]
  onView?: (v: ViewState) => void
}): React.JSX.Element {
  const toggle = async (id: string): Promise<void> => {
    const next = ticked.includes(id) ? ticked.filter((x) => x !== id) : [...ticked, id]
    // Saved first: `onView?.(await …)` would skip the save when there is no onView.
    const v = await api.setErgonomics(next)
    onView?.(v)
  }
  return (
    <fieldset>
      <legend>Home setup</legend>
      <div className="group-card">
        <p className="muted home-progress">{`${ticked.length} / ${ERGONOMICS.length}`}</p>
        {ERGONOMICS.map((e) => (
          <label key={e.id} className="check-row">
            <input
              type="checkbox"
              checked={ticked.includes(e.id)}
              onChange={() => void toggle(e.id)}
            />
            <span>{e.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** Export and import of everything, through the main process's file dialogs. */
function Backup({ onView }: { onView?: (v: ViewState) => void }): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const run = async (
    action: () => Promise<{ ok: true; text: string } | { ok: false; error: string | null }>
  ): Promise<void> => {
    setBusy(true)
    setNote(null)
    try {
      const r = await action()
      if (r.ok) setNote({ ok: true, text: r.text })
      else if (r.error) setNote({ ok: false, text: r.error })
    } catch {
      setNote({ ok: false, text: 'Something went wrong' })
    } finally {
      setBusy(false)
    }
  }
  const exportData = (): Promise<void> =>
    run(async () => {
      const r = await api.exportData()
      return r.ok ? { ok: true, text: `Saved to ${r.file}` } : r
    })
  const importData = (): Promise<void> =>
    run(async () => {
      setConfirming(false)
      const r = await api.importData()
      if (!r.ok) return r
      onView?.(r.view)
      return { ok: true, text: 'Data imported' }
    })

  return (
    <fieldset>
      <legend>Backup</legend>
      <div className="group-card">
        <div className="backup-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void exportData()}>
            Export data…
          </button>
          {confirming ? (
            <span className="confirm">
              <span>Replace all data?</span>
              <button type="button" onClick={() => void importData()}>
                Yes, replace
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                No
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              Import data…
            </button>
          )}
        </div>
        {note &&
          (note.ok ? (
            <p className="muted backup-note" role="status">
              {note.text}
            </p>
          ) : (
            <p className="field-error" role="alert">
              {note.text}
            </p>
          ))}
      </div>
    </fieldset>
  )
}

const asText = (d: string): Parsed<string> => ({ ok: true, value: d.trim() })

const CUE_NAMES: [keyof FeaturesShape['camera']['cues'], string][] = [
  ['dryEyes', 'Dry eyes'],
  ['drowsy', 'Tiredness'],
  ['posture', 'Posture'],
  ['distance', 'Screen distance']
]

/** Camera cues: on/off (asks for access), which cues, calibration, and what it saw last. */
const CAMERA_PROBLEMS: Record<Exclude<ViewState['camera']['problem'], null>, string> = {
  denied: 'Camera access is off — allow Dayfit in System Settings → Privacy & Security → Camera',
  'no-camera': 'No camera found — connect one, then turn this on again',
  busy: 'Another app is using the camera — close it, then turn this on again',
  failed: "Camera cues couldn't start — turn this on again to retry"
}

function CameraGroup({
  view,
  send,
  onView
}: {
  view: ViewState
  send: Send
  onView?: (v: ViewState) => void
}): React.JSX.Element {
  const camera = view.settings.features.camera
  const st = view.camera
  const [busy, setBusy] = useState(false)
  const act = async (a: Parameters<typeof api.camera>[0]): Promise<void> => {
    setBusy(true)
    try {
      const v = await api.camera(a)
      onView?.(v)
    } finally {
      setBusy(false)
    }
  }
  // A problem comes from the user turning the feature on, so it shows even while off.
  const status = st.problem
    ? CAMERA_PROBLEMS[st.problem]
    : !camera.enabled
      ? null
      : st.permission === 'denied'
        ? CAMERA_PROBLEMS.denied
        : st.running
          ? 'Camera on'
          : 'Camera paused — outside work hours, in a meeting, busy or away'
  const calibratedOn = camera.calibration
    ? new Date(camera.calibration.at).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short'
      })
    : null
  return (
    <fieldset>
      <legend>Camera cues</legend>
      <div className="group-card camera-card">
        <Toggle
          label="Use the camera"
          checked={camera.enabled}
          onChange={(on) => void act(on ? 'enable' : 'disable')}
        />
        {status && (
          <p className="muted" role="status">
            {status}
          </p>
        )}
        {camera.enabled && (
          <>
            {CUE_NAMES.map(([key, label]) => (
              <Toggle
                key={key}
                label={label}
                checked={camera.cues[key]}
                onChange={(b) =>
                  void send({
                    features: { camera: { ...camera, cues: { ...camera.cues, [key]: b } } }
                  })
                }
              />
            ))}
            <p className="muted">
              {st.calibrating
                ? 'Sit the way you want to sit… (5 s)'
                : st.calibrationFailed
                  ? "Couldn't see your face — sit in view of the camera and try again"
                  : st.setupChanged
                    ? 'Your setup looks different — recalibrate'
                    : calibratedOn
                      ? `Calibrated ${calibratedOn}`
                      : 'Calibrate to turn on posture and distance'}
            </p>
            <div className="backup-actions">
              <button
                type="button"
                className="btn"
                disabled={busy || st.calibrating || !st.running}
                onClick={() => void act('calibrate')}
              >
                Calibrate
              </button>
            </div>
            {st.lastMinute && <p className="muted">Last minute: {st.lastMinute.blinks} blinks</p>}
          </>
        )}
        <p className="muted">Video stays on this Mac; Dayfit keeps only per-minute scores.</p>
      </div>
    </fieldset>
  )
}

/** Google Calendar: the user's own OAuth client, sign-in, sync and write-back. */
function CalendarGroup({
  view,
  send,
  onView
}: {
  view: ViewState
  send: Send
  onView?: (v: ViewState) => void
}): React.JSX.Element {
  const creds = view.settings.calendar
  const cal = view.calendar
  const [busy, setBusy] = useState(false)
  const act = async (a: Parameters<typeof api.calendar>[0]): Promise<void> => {
    setBusy(true)
    try {
      const v = await api.calendar(a)
      onView?.(v)
    } finally {
      setBusy(false)
    }
  }
  const ready = creds.clientId.trim() !== '' && creds.clientSecret.trim() !== ''
  return (
    <fieldset>
      <legend>Google Calendar</legend>
      <div className="group-card calendar-card">
        {cal.connected ? (
          <>
            <p className="muted" role="status">
              {cal.lastSyncAt === null
                ? 'Connected'
                : `Connected · last synced ${formatClock(minutesOf(new Date(cal.lastSyncAt)))}`}
            </p>
            <Toggle
              label="Show my planned blocks on Google Calendar"
              checked={creds.writeBack}
              disabled={busy}
              onChange={(on) => void act(on ? 'writeBackOn' : 'writeBackOff')}
            />
            <div className="backup-actions">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void act('sync')}
              >
                Sync now
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void act('disconnect')}
              >
                Disconnect
              </button>
            </div>
          </>
        ) : cal.connecting ? (
          <div className="backup-actions">
            <span className="muted" role="status">
              Waiting for Google in your browser…
            </span>
            <button type="button" className="btn" onClick={() => void act('cancel')}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            {!ready && <p className="muted">Add your Google OAuth client ID</p>}
            <Field
              label="Client ID"
              value={creds.clientId}
              parse={asText}
              onValid={(clientId) => send({ calendar: { clientId } })}
            />
            <Field
              label="Client secret"
              type="password"
              value={creds.clientSecret}
              parse={asText}
              onValid={(clientSecret) => send({ calendar: { clientSecret } })}
            />
            <details className="muted">
              <summary>How to get these</summary>
              <ol>
                <li>Open Google Cloud Console and pick or create a project.</li>
                <li>Enable the Google Calendar API.</li>
                <li>Create an OAuth client ID of type Desktop app.</li>
                <li>Copy its client ID and client secret here.</li>
              </ol>
            </details>
            <div className="backup-actions">
              <button
                type="button"
                className="btn"
                disabled={!ready || busy}
                onClick={() => void act('connect')}
              >
                Connect
              </button>
            </div>
          </>
        )}
        {cal.lastError && (
          <p className="field-error" role="alert">
            {cal.lastError}
          </p>
        )}
      </div>
    </fieldset>
  )
}

export function Settings({ view, onView }: Props): React.JSX.Element {
  const s = view.settings
  const [saveError, setSaveError] = useState<string | null>(null)
  const send: Send = async (patch) => {
    try {
      const v = await api.updateSettings(patch)
      setSaveError(null)
      onView?.(v)
      return true
    } catch {
      setSaveError('Could not save')
      return false
    }
  }
  // Work-day taps build on each other, not on the last saved view: a second tap made before
  // the first save returns must keep the first. A newer saved list replaces the local one.
  const savedDays = s.workDays.join(',')
  const [dayDraft, setDayDraft] = useState({ from: savedDays, list: s.workDays })
  const workDays = dayDraft.from === savedDays ? dayDraft.list : s.workDays
  const toggleDay = async (day: number): Promise<void> => {
    const list = workDays.includes(day)
      ? workDays.filter((d) => d !== day)
      : [...workDays, day].sort((a, b) => a - b)
    setDayDraft({ from: savedDays, list })
    if (!(await send({ workDays: list }))) setDayDraft({ from: savedDays, list: s.workDays })
  }
  const lunchOk = (start: number, end: number): boolean =>
    s.lunch === null || (s.lunch > start && s.lunch < end)

  return (
    <section className="settings">
      <h2>Settings</h2>
      {saveError && (
        <p className="field-error" role="alert">
          {saveError}
        </p>
      )}

      <fieldset>
        <legend>Working hours</legend>
        <div className="group-card">
          <Field
            label="Start"
            type="time"
            value={formatClock(s.workStart)}
            parse={(d) => {
              const t = parseTime(d)
              if (!t.ok) return t
              const e = checkEnd(t.value, s.workEnd)
              if (e) return { ok: false, error: e }
              return lunchOk(t.value, s.workEnd) ? t : { ok: false, error: LUNCH_ERROR }
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
              if (e) return { ok: false, error: e }
              return lunchOk(s.workStart, t.value) ? t : { ok: false, error: LUNCH_ERROR }
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
          <div className="field work-days-row">
            <span>Work days</span>
            <div role="group" aria-label="Work days" className="work-days">
              {WEEK.map(([day, name]) => (
                <button
                  key={day}
                  type="button"
                  className="day-chip"
                  aria-pressed={workDays.includes(day)}
                  onClick={() => void toggleDay(day)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Planning</legend>
        <div className="group-card">
          {num('Buffer (min)', s.bufferMin, (n) => send({ bufferMin: n }))}
          {num('Caffeine cap (cups/day)', s.coffee.capCups, (n) =>
            send({ coffee: { ...s.coffee, capCups: n } })
          )}
          <Field
            label="No coffee after"
            type="time"
            value={formatClock(s.coffee.cutoff)}
            parse={parseTime}
            onValid={(v) => send({ coffee: { ...s.coffee, cutoff: v } })}
          />
          {num('Gap after back-to-back meetings (min)', s.meetingGapMin, (n) =>
            send({ meetingGapMin: n })
          )}
          {DURATION_TYPES.map((t) => (
            <div key={t}>
              {num(`Default ${t} (min)`, s.defaultDurations[t], (n) =>
                send({ defaultDurations: { ...s.defaultDurations, [t]: n } })
              )}
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Reminders</legend>
        <div className="group-card">
          {!view.notificationsOk && (
            <p className="field-error" role="alert">
              Notifications are blocked by the system. Reminders still show next to the menu bar
              icon and here.
            </p>
          )}
          <Toggle
            label="Water"
            checked={s.water.enabled}
            onChange={(b) => send({ water: { ...s.water, enabled: b } })}
          />
          {num('Water interval (min)', s.water.intervalMin, (n) =>
            send({ water: { ...s.water, intervalMin: n } })
          )}
          {num('Water target (ml)', s.water.targetMl, (n) =>
            send({ water: { ...s.water, targetMl: n } })
          )}
          {num('Glass size (ml)', s.water.glassMl, (n) =>
            send({ water: { ...s.water, glassMl: n } })
          )}
        </div>
        <div className="group-card">
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
        </div>
        <div className="group-card">
          <Toggle
            label="Stretch"
            checked={s.stretch.enabled}
            onChange={(b) => send({ stretch: { ...s.stretch, enabled: b } })}
          />
          {num('Stretch interval (min)', s.stretch.intervalMin, (n) =>
            send({ stretch: { ...s.stretch, intervalMin: n } })
          )}
        </div>
        <div className="group-card">
          <Toggle
            label="Walk"
            checked={s.walk.enabled}
            onChange={(b) => send({ walk: { ...s.walk, enabled: b } })}
          />
          {num('Walk interval (min)', s.walk.intervalMin, (n) =>
            send({ walk: { ...s.walk, intervalMin: n } })
          )}
          {num('Walk length (min)', s.walk.durationMin, (n) =>
            send({ walk: { ...s.walk, durationMin: n } })
          )}
        </div>
        <div className="group-card">
          {num(
            'Snooze length (min)',
            s.breaks.snoozeMin,
            (n) => send({ breaks: { snoozeMin: n } }),
            parseSnooze
          )}
        </div>
        <div className="group-card">
          <Toggle
            label="Meeting alert"
            checked={s.meetingAlert.enabled}
            onChange={(b) => send({ meetingAlert: { ...s.meetingAlert, enabled: b } })}
          />
          {num('Meeting alert lead (min)', s.meetingAlert.leadMin, (n) =>
            send({ meetingAlert: { ...s.meetingAlert, leadMin: n } })
          )}
        </div>
      </fieldset>

      <fieldset>
        <legend>End of day</legend>
        <div className="group-card">
          <Toggle
            label="Attendance reminders"
            checked={s.endOfDay.attendance}
            onChange={(b) => send({ endOfDay: { ...s.endOfDay, attendance: b } })}
          />
          <Field
            label="HRMS portal URL"
            value={s.endOfDay.portalUrl}
            onBlurOnly
            parse={parsePortalUrl}
            onValid={(v) => send({ endOfDay: { ...s.endOfDay, portalUrl: v } })}
          />
        </div>
        <div className="group-card">
          {num('Lunch length (min)', s.endOfDay.lunchMin, (n) =>
            send({ endOfDay: { ...s.endOfDay, lunchMin: n } })
          )}
          <Toggle
            label="Check-out heads-up"
            checked={s.endOfDay.headsUp}
            onChange={(b) => send({ endOfDay: { ...s.endOfDay, headsUp: b } })}
          />
          <Toggle
            label="Overtime nudge"
            checked={s.endOfDay.overtime}
            onChange={(b) => send({ endOfDay: { ...s.endOfDay, overtime: b } })}
          />
        </div>
      </fieldset>

      <fieldset>
        <legend>Shortcut and startup</legend>
        <div className="group-card">
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
          {!view.hotkeyOk && (
            <p className="field-error" role="alert">
              Shortcut unavailable — pick another
            </p>
          )}
          <Toggle
            label="Launch at login"
            checked={s.launchAtLogin}
            onChange={(b) => send({ launchAtLogin: b })}
          />
        </div>
      </fieldset>

      <FeaturesGroup s={s} send={send} />
      <CameraGroup view={view} send={send} onView={onView} />

      <RemindersGroup s={s} send={send} />
      {FLAGS.calendar && <CalendarGroup view={view} send={send} onView={onView} />}

      <HomeSetup ticked={view.ergonomics ?? []} onView={onView} />

      <Backup onView={onView} />

      <div className="quit-row">
        <button type="button" className="btn" onClick={() => api.quit()}>
          Quit Dayfit
        </button>
      </div>
    </section>
  )
}
