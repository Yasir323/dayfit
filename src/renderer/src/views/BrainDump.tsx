import { useMemo, useState } from 'react'
import { splitDumpLines } from '../../../core/brainDump'
import { parseLine, toNewItem } from '../../../core/parser'
import type { DateStr, ItemType, NewItem, Settings } from '../../../core/types'
import { formatClock } from '../../../core/time'
import { api } from '../api'
import type { ViewState } from '../api'
import { ItemFields } from './ItemFields'
import { validateFields } from './validateFields'

interface Props {
  settings: Settings
  today: DateStr
  onPlanned: (v: ViewState) => void
}

const ICONS: Record<ItemType, string> = {
  task: '✅',
  call: '📞',
  deep: '🧠',
  fixed: '📌',
  household: '🏠'
}

function formatTotal(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h === 0 ? `${m}m` : `${h}h ${m}m`
}

const durationText = (n: number): string => (Number.isFinite(n) ? formatTotal(n) : '?')

function meta(it: NewItem): string[] {
  const out: string[] = []
  if (it.label) out.push(`#${it.label}`)
  if (it.half) out.push(it.half === 'am' ? 'first half' : 'second half')
  if (it.deadline)
    out.push(it.deadline.time === null ? 'due today' : `by ${formatClock(it.deadline.time)}`)
  if (it.type === 'call') out.push('suggest slot')
  return out
}

export function BrainDump({ settings, today, onPlanned }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  // edits are keyed by line text, so changing a line's text drops its override
  const [edits, setEdits] = useState<Record<string, NewItem>>({})
  const [open, setOpen] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const rows = useMemo(
    () =>
      splitDumpLines(text).map((line) => {
        const parsed = toNewItem(parseLine(line, today), today, settings)
        // A line made only of tokens keeps its raw text as the title (as in QuickAdd).
        const item = edits[line] ?? { ...parsed, title: parsed.title || line }
        return { line, item, error: validateFields(item) }
      }),
    [text, edits, today, settings]
  )

  const total = rows.reduce(
    (s, r) => s + (Number.isFinite(r.item.durationMin) ? r.item.durationMin : 0),
    0
  )
  const canPlan = !saving && rows.length > 0 && rows.every((r) => r.error === null)

  const plan = async (): Promise<void> => {
    if (!canPlan) return
    setSaving(true)
    setFailure(null)
    try {
      const v = await api.addItems(rows.map((r) => r.item))
      setText('')
      setEdits({})
      setOpen(null)
      // App shows the Review overlay for any decisions in the new view.
      onPlanned(v)
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Could not plan the day')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="brain-dump">
      <textarea
        aria-label="Brain dump"
        value={text}
        rows={6}
        spellCheck={false}
        placeholder={'One item per line\nCall John 15m ~call\nPayments refactor 2h ~deep'}
        onChange={(e) => setText(e.target.value)}
      />
      <ul className="preview">
        {rows.map((r, i) => (
          <li key={i}>
            <button type="button" onClick={() => setOpen(open === i ? null : i)}>
              <span aria-hidden="true">{ICONS[r.item.type]}</span>
              <span>{r.item.title}</span>
              <span>{durationText(r.item.durationMin)}</span>
              {meta(r.item).map((m) => (
                <span key={m} className="meta">
                  {m}
                </span>
              ))}
            </button>
            {r.error && (
              <p className="error" role="alert">
                {r.error}
              </p>
            )}
            {open === i && (
              <ItemFields
                value={r.item}
                onChange={(next) => setEdits((s) => ({ ...s, [r.line]: next }))}
                today={today}
                defaultDurations={settings.defaultDurations}
              />
            )}
          </li>
        ))}
      </ul>
      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}
      <footer>
        <span>
          {rows.length} {rows.length === 1 ? 'item' : 'items'} · {formatTotal(total)}
        </span>
        <button type="button" disabled={!canPlan} onClick={() => void plan()}>
          Plan my day
        </button>
      </footer>
    </div>
  )
}
