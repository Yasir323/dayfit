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
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={key === value}
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
