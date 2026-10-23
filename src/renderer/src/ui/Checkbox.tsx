import type { Priority } from '../../../core/types'
import { Icon } from './Icon'

interface Props {
  priority: Priority
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}

const PRIO_CLASS: Record<Priority, string> = {
  high: 'prio-high',
  med: 'prio-none',
  low: 'prio-low'
}

/** Round, Todoist-style completion checkbox coloured by priority. */
export function Checkbox({ priority, checked, onChange, label }: Props): React.JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className={`checkbox ${PRIO_CLASS[priority]}`}
      onClick={() => onChange(!checked)}
    >
      <Icon name="check" size={11} />
    </button>
  )
}
