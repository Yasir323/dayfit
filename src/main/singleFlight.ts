/** Runs `fn` unless a previous run hasn't settled yet (waking the Mac fires two triggers). */
export function createSingleFlight(fn: () => Promise<void>): () => void {
  let running = false
  return () => {
    if (running) return
    running = true
    fn()
      .catch((e: unknown) => console.error('run failed', e))
      .finally(() => {
        running = false
      })
  }
}
