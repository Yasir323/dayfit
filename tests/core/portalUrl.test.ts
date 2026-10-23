import { describe, expect, it } from 'vitest'
import { isPortalUrl } from '../../src/core/portalUrl'

describe('isPortalUrl', () => {
  it('accepts http and https links', () => {
    expect(isPortalUrl('https://hr.example.com/punch')).toBe(true)
    expect(isPortalUrl('http://10.0.0.5:8080')).toBe(true)
  })

  it('rejects everything else', () => {
    for (const s of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'example.com',
      '',
      '   ',
      'mailto:a@b.c'
    ])
      expect(isPortalUrl(s)).toBe(false)
  })
})
