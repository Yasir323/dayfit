import { useEffect, useMemo, useRef, useState } from 'react'
import { parseLine, toNewItem } from '../../../core/parser'
import type { TokenSpan } from '../../../core/parser'
import { defaultDnd } from '../../../core/types'
import type { DateStr, NewItem, Settings } from '../../../core/types'
import { api } from '../api'
import type { ViewState } from '../api'
import { ItemChips } from './ItemChips'
import { validateFields } from './validateFields'
import './QuickAdd.css'

interface Props {
  settings: Settings
  today: DateStr
  /** openToday is true when the user pressed Cmd/Ctrl+Enter. */
  onAdded: (v: ViewState, openToday: boolean) => void
}

const FIELD_KEYS = [
  'durationMin',
  'type',
  'label',
  'priority',
  'half',
  'date',
  'fixedStart',
  'deadline',
  'dnd'
] as const

function highlight(text: string, tokens: TokenSpan[]): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let at = 0
  for (const t of tokens) {
    if (t.start > at) out.push(text.slice(at, t.start))
    out.push(
      <span key={t.start} className={`tok tok-${t.kind}`}>
        {text.slice(t.start, t.end)}
      </span>
    )
    at = t.end
  }
  out.push(text.slice(at))
  return out
}

export function QuickAdd({ settings, today, onAdded }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const [draft, setDraft] = useState<NewItem>(() =>
    toNewItem(parseLine('', today), today, settings)
  )
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const parsed = useRef(parseLine('', today))
  const input = useRef<HTMLInputElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  const [formKey, setFormKey] = useState(0)
  const syncScroll = (): void => {
    if (mirror.current && input.current) mirror.current.scrollLeft = input.current.scrollLeft
  }
  const line = useMemo(() => parseLine(text, today), [text, today])

  // Past midnight the draft still says yesterday: move it to the new day unless hand-set.
  const [seenToday, setSeenToday] = useState(today)
  if (seenToday !== today) {
    setSeenToday(today)
    if (draft.date === seenToday) setDraft({ ...draft, date: today })
  }

  useEffect(() => input.current?.focus(), [])

  const onText = (next: string): void => {
    const prev = parsed.current
    const cur = parseLine(next, today)
    parsed.current = cur
    setText(next)
    // only fields whose parsed value changed are overwritten; hand edits elsewhere survive
    const base = toNewItem(cur, today, settings)
    setDraft((d) => {
      const patch: Partial<NewItem> = {}
      for (const k of FIELD_KEYS) {
        if (JSON.stringify(prev.fields[k]) !== JSON.stringify(cur.fields[k])) {
          Object.assign(patch, { [k]: base[k] })
        }
      }
      if (
        patch.type !== undefined &&
        patch.durationMin === undefined &&
        d.durationMin === settings.defaultDurations[d.type]
      ) {
        patch.durationMin = settings.defaultDurations[patch.type]
      }
      // DND follows type and fixed start until the user sets it by hand.
      if (
        (patch.type !== undefined || patch.fixedStart !== undefined) &&
        patch.dnd === undefined &&
        cur.fields.dnd === undefined &&
        d.dnd === defaultDnd(d.type, d.fixedStart)
      ) {
        patch.dnd = defaultDnd(
          patch.type ?? d.type,
          patch.fixedStart !== undefined ? patch.fixedStart : d.fixedStart
        )
      }
      return { ...d, ...patch }
    })
  }

  const error = validateFields(draft)
  const canAdd = !saving && error === null && text.trim() !== ''

  const reset = (): void => {
    parsed.current = parseLine('', today)
    setText('')
    setFormKey((k) => k + 1)
    setDraft(toNewItem(parsed.current, today, settings))
  }

  const submit = async (openToday: boolean): Promise<void> => {
    if (!canAdd) return
    setSaving(true)
    setFailure(null)
    try {
      const v = await api.addItems([{ ...draft, title: line.title || text.trim() }])
      reset()
      onAdded(v, openToday)
      input.current?.focus()
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Could not add item')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="quick-add"
      onSubmit={(e) => {
        e.preventDefault()
        void submit(false)
      }}
    >
      <div className="qa-card">
        <div className="syntax-box">
          <div ref={mirror} className="syntax-mirror" aria-hidden="true">
            {highlight(text, line.tokens)}
          </div>
          <input
            ref={input}
            aria-label="Quick add"
            className="syntax-input"
            type="text"
            value={text}
            placeholder="Task name, e.g. Call John 15m ~call"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              onText(e.target.value)
              syncScroll()
            }}
            onScroll={syncScroll}
            onKeyUp={syncScroll}
            onSelect={syncScroll}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (!e.nativeEvent.isComposing) void submit(e.metaKey || e.ctrlKey)
              }
            }}
          />
        </div>
        <ItemChips
          key={formKey}
          value={draft}
          onChange={setDraft}
          today={today}
          defaultDurations={settings.defaultDurations}
        />
        {failure && (
          <p className="error" role="alert">
            {failure}
          </p>
        )}
        <div className="qa-actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              reset()
              input.current?.focus()
            }}
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={!canAdd}>
            Add task
          </button>
        </div>
      </div>
      <p className="qa-hint muted">
        Type <code>15m</code> <code>#label</code> <code>!high</code> <code>@am</code>{' '}
        <code>at 14:00</code> <code>~call</code> · ↵ add · ⌘↵ add &amp; open Today
      </p>
    </form>
  )
}
