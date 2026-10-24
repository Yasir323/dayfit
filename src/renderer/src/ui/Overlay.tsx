import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex="0"]'

/** A modal layer: focus moves to its first control when it opens. */
export function Overlay({
  label,
  initialFocus,
  children
}: {
  label: string
  /** Selector for the control to focus first (default: the first focusable one). */
  initialFocus?: string
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = ref.current
    const target =
      (initialFocus ? root?.querySelector<HTMLElement>(initialFocus) : null) ??
      root?.querySelector<HTMLElement>(FOCUSABLE)
    target?.focus()
  }, [initialFocus])
  return (
    <div ref={ref} className="overlay" role="dialog" aria-modal="true" aria-label={label}>
      {children}
    </div>
  )
}
