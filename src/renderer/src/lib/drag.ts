/** Timeline scale, shared by the timeline and its drag and drop. */
export const PX_PER_MIN = 1.5
const SNAP_MIN = 5

export const snapMinutes = (min: number): number => Math.round(min / SNAP_MIN) * SNAP_MIN || 0

/** A vertical drag in pixels → minutes, snapped to 5. */
export const dragMinutes = (px: number): number => snapMinutes(px / PX_PER_MIN)
