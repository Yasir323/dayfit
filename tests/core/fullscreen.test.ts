import { describe, expect, it } from 'vitest'
import { isFullscreen, type WindowInfo } from '../../src/core/fullscreen'

const display = { x: 0, y: 0, w: 1710, h: 1112 }
const second = { x: 1710, y: 0, w: 1920, h: 1080 }
const win = (o: Partial<WindowInfo>): WindowInfo => ({
  pid: 10,
  layer: 0,
  x: 0,
  y: 0,
  w: 1710,
  h: 1112,
  ...o
})

describe('isFullscreen', () => {
  it('another app covering a display is full screen', () => {
    expect(isFullscreen([win({})], [display], 99)).toBe(true)
  })

  it('our own window does not count', () => {
    expect(isFullscreen([win({ pid: 99 })], [display], 99)).toBe(false)
  })

  it('a maximised window below the menu bar is not full screen', () => {
    expect(isFullscreen([win({ y: 39, h: 1073 })], [display], 99)).toBe(false)
  })

  it('system layers (menu bar, overlays) do not count', () => {
    expect(isFullscreen([win({ layer: 24 }), win({ layer: 2000 })], [display], 99)).toBe(false)
  })

  it('covers a second display, within 2 px', () => {
    expect(isFullscreen([win({ x: 1711, y: 1, w: 1918, h: 1078 })], [display, second], 99)).toBe(
      true
    )
  })

  it('no windows or no displays is not full screen', () => {
    expect(isFullscreen([], [display], 99)).toBe(false)
    expect(isFullscreen([win({})], [], 99)).toBe(false)
  })
})
