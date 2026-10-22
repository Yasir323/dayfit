import { useEffect, useMemo, useRef, useState } from 'react'
import { parseLine, toNewItem } from '../../../core/parser'
import type { TokenSpan } from '../../../core/parser'
import type { DateStr, NewItem, Settings } from '../../../core/types'
import { api } from '../api'
import type { ViewState } from '../api'
import { ItemFields } from './ItemFields'
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
  'deadline'
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
      return { ...d, ...patch }
    })
  }

  const error = validateFields(draft)
  const canAdd = !saving && error === null && text.trim() !== ''

  const submit = async (openToday: boolean): Promise<void> => {
    if (!canAdd) return
    setSaving(true)
    setFailure(null)
    try {
      const v = await api.addItems([{ ...draft, title: line.title || text.trim() }])
      parsed.current = parseLine('', today)
      setText('')
      setFormKey((k) => k + 1)
      setDraft(toNewItem(parsed.current, today, settings))
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
          placeholder="Call John 15m ~call !high #work"
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
      <ItemFields
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
      <button type="submit" className="add" disabled={!canAdd}>
        Add
      </button>
    </form>
  )
}
