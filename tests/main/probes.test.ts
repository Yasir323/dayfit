import { describe, expect, it } from 'vitest'
import { parseWindows } from '../../src/main/probes'

describe('parseWindows', () => {
  it('reads the probe output', () => {
    const out = '[{"pid":1,"layer":0,"x":0,"y":0,"w":10,"h":20}]'
    expect(parseWindows(out)).toEqual([{ pid: 1, layer: 0, x: 0, y: 0, w: 10, h: 20 }])
  })

  it('bad output is null, and entries missing numbers are dropped', () => {
    expect(parseWindows('nope')).toBeNull()
    expect(parseWindows('{}')).toBeNull()
    expect(parseWindows('[{"pid":1}]')).toEqual([])
  })
})
