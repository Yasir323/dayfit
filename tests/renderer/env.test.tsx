import { expect, it } from 'vitest'

it('renderer tests run under jsdom', () => {
  expect(typeof document).toBe('object')
})
