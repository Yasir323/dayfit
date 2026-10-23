/** Wraps `fn` so an error is logged and swallowed (timers and event handlers keep running). */
export function guarded<A extends unknown[]>(
  label: string,
  fn: (...args: A) => void
): (...args: A) => void {
  return (...args) => {
    try {
      fn(...args)
    } catch (e) {
      console.error(`${label} failed`, e)
    }
  }
}
