import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex="0"]'

/** A modal layer: focus moves to its first control when it opens. */
export function Overlay({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
  }, [])
  return (
    <div ref={ref} className="overlay" role="dialog" aria-modal="true" aria-label={label}>
      {children}
    </div>
  )
}
