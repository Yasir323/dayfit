/** A tray click first blurs (and hides) the popover, then toggles it; this long apart is one click. */
const SAME_CLICK_MS = 250

/** Lets a tray click close the popover instead of the blur-hide and toggle reopening it. */
export function createBlurGuard(now: () => number = Date.now): {
  blurHidden(): void
  mayShow(): boolean
} {
  let hiddenAt = -Infinity
  return {
    blurHidden: () => {
      hiddenAt = now()
    },
    mayShow: () => now() - hiddenAt >= SAME_CLICK_MS
  }
}
