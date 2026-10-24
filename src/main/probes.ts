import { execFile } from 'node:child_process'
import type { WindowInfo } from '../core/fullscreen'

/** JXA: the on-screen windows (owner, layer, bounds). Reading bounds needs no permission. */
const JXA = `ObjC.import('CoreGraphics')
var raw = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, $.kCGNullWindowID)
var list = ObjC.deepUnwrap(ObjC.castRefToObject(raw)) || []
JSON.stringify(list.map(function (w) {
  var b = w.kCGWindowBounds || {}
  return { pid: w.kCGWindowOwnerPID, layer: w.kCGWindowLayer, x: b.X, y: b.Y, w: b.Width, h: b.Height }
}))`

const TIMEOUT_MS = 2000

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The probe's JSON, or null when it isn't a list; entries without numbers are dropped. */
export function parseWindows(out: string): WindowInfo[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(out)
  } catch {
    return null
  }
  if (!Array.isArray(raw)) return null
  return raw.filter(
    (w): w is WindowInfo =>
      typeof w === 'object' &&
      w !== null &&
      ['pid', 'layer', 'x', 'y', 'w', 'h'].every((k) => isNum((w as Record<string, unknown>)[k]))
  )
}

/** On-screen windows on macOS; null elsewhere, on any error, or after 2 s. */
export function probeWindows(): Promise<WindowInfo[] | null> {
  if (process.platform !== 'darwin') return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(
      'osascript',
      ['-l', 'JavaScript', '-e', JXA],
      { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : parseWindows(stdout))
    )
  })
}
