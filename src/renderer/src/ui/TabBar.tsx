import { Icon, type IconName } from './Icon'

export type Tab = 'today' | 'add' | 'dump' | 'settings'

const TABS: [Tab, string, IconName][] = [
  ['today', 'Today', 'today'],
  ['add', 'Add', 'add'],
  ['dump', 'Dump', 'dump'],
  ['settings', 'Settings', 'settings']
]

interface Props {
  value: Tab
  onChange: (tab: Tab) => void
  /** True while a modal overlay (Review, first run) covers the app. */
  inert?: boolean
}

export function TabBar({ value, onChange, inert = false }: Props): React.JSX.Element {
  return (
    <nav className="tabbar" aria-label="Main" inert={inert}>
      {TABS.map(([tab, label, icon]) => (
        <button
          key={tab}
          type="button"
          aria-current={value === tab ? 'page' : undefined}
          onClick={() => onChange(tab)}
        >
          <Icon name={icon} size={18} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
