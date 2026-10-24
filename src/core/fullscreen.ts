/** A window as the OS lists it: owner process, stacking layer and bounds (points). */
export interface WindowInfo {
  pid: number
  layer: number
  x: number
  y: number
  w: number
  h: number
}

export interface DisplayBounds {
  x: number
  y: number
  w: number
  h: number
}

/** Bounds within this many points count as covering the display. */
const SLACK = 2

/**
 * True when a normal-layer window of another app covers a whole display — a full-screen video,
 * presentation or game. A maximised window stops at the menu bar, so it doesn't count.
 */
export function isFullscreen(
  windows: WindowInfo[],
  displays: DisplayBounds[],
  ownPid: number
): boolean {
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= SLACK
  return windows.some(
    (w) =>
      w.layer === 0 &&
      w.pid !== ownPid &&
      displays.some((d) => near(w.x, d.x) && near(w.y, d.y) && near(w.w, d.w) && near(w.h, d.h))
  )
}
