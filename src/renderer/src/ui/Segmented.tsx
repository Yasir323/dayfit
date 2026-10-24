import { nextIndex } from '../lib/arrowNav'

interface Props<T extends string> {
  options: [T, string][]
  value: T
  onChange: (value: T) => void
  label: string
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label
}: Props<T>): React.JSX.Element {
  return (
    <div
      className="segmented"
      role="tablist"
      aria-label={label}
      onKeyDown={(e) => {
        const tabs = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
        const k = nextIndex(e.key, tabs.indexOf(e.target as HTMLButtonElement), tabs.length)
        if (k === null) return
        e.preventDefault()
        tabs[k].focus()
        onChange(options[k][0])
      }}
    >
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={key === value}
          tabIndex={key === value ? 0 : -1}
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
