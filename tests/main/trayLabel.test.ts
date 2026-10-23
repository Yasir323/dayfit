import { describe, expect, it } from 'vitest'
import { trayDisplay } from '../../src/main/trayLabel'

describe('trayDisplay', () => {
  it('macOS shows the label as the tray title', () => {
    expect(trayDisplay('Break', 'darwin')).toEqual({ title: ' Break', tooltip: 'Dayfit — Break' })
    expect(trayDisplay(null, 'darwin')).toEqual({ title: '', tooltip: 'Dayfit' })
  })

  it('Windows never sets a title, only the tooltip', () => {
    expect(trayDisplay('Break', 'win32')).toEqual({ title: null, tooltip: 'Dayfit — Break' })
    expect(trayDisplay(null, 'win32')).toEqual({ title: null, tooltip: 'Dayfit' })
  })
})
