import { useMemo, useState } from 'react'
import { splitDumpLines } from '../../../core/brainDump'
import { parseLine, toNewItem } from '../../../core/parser'
import type { DateStr, ItemType, NewItem, Settings } from '../../../core/types'
import { formatClock } from '../../../core/time'
import { api } from '../api'
import type { ViewState } from '../api'
import { Icon, type IconName } from '../ui/Icon'
import { ItemChips } from './ItemChips'
import { validateFields } from './validateFields'

interface Props {
  settings: Settings
  today: DateStr
  onPlanned: (v: ViewState) => void
}

const ICONS: Record<ItemType, IconName> = {
  task: 'check',
  call: 'phone',
  deep: 'clock',
  fixed: 'pin',
  household: 'home'
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
      <div className="qa-card">
        <textarea
          aria-label="Brain dump"
          className="dump-input"
          value={text}
          rows={6}
          spellCheck={false}
          placeholder={
            'Dump your day, one item per line\nCall John 15m ~call\nPayments refactor 2h ~deep'
          }
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      {rows.length > 0 && (
        <ul className="rows preview">
          {rows.map((r, i) => (
            <li key={i} className="dump-row">
              <button
                type="button"
                className="dump-row-head"
                aria-expanded={open === i}
                onClick={() => setOpen(open === i ? null : i)}
              >
                <span className="row-lead">
                  <Icon name={ICONS[r.item.type]} size={14} />
                </span>
                <span className="row-main">
                  <span className="row-title ellipsis">{r.item.title}</span>
                  <span className="row-detail">
                    {[durationText(r.item.durationMin), ...meta(r.item)].join(' · ')}
                  </span>
                </span>
              </button>
              {r.error && (
                <p className="error" role="alert">
                  {r.error}
                </p>
              )}
              {open === i && (
                <div className="dump-editor">
                  <ItemChips
                    value={r.item}
                    onChange={(next) => setEdits((s) => ({ ...s, [r.line]: next }))}
                    today={today}
                    defaultDurations={settings.defaultDurations}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}
      <footer className="dump-footer">
        <span className="muted">
          {rows.length} {rows.length === 1 ? 'item' : 'items'} · {formatTotal(total)}
        </span>
        <button
          type="button"
          className="btn-primary"
          disabled={!canPlan}
          onClick={() => void plan()}
        >
          Plan my day
        </button>
      </footer>
    </div>
  )
}
