import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Breathe } from '../../src/renderer/src/views/Breathe'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

/** Each phase's timer is set after the previous one renders, so step one phase at a time. */
const phases = (n: number): void => {
  for (let k = 0; k < n; k++) act(() => vi.advanceTimersByTime(4000))
}

describe('Breathe', () => {
  it('steps through in, hold, out, hold for four rounds, then closes', () => {
    const onClose = vi.fn()
    render(<Breathe onClose={onClose} />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Breathe in')
    expect(status).toHaveTextContent('Round 1 of 4')
    act(() => vi.advanceTimersByTime(4000))
    expect(status).toHaveTextContent('Hold')
    act(() => vi.advanceTimersByTime(4000))
    expect(status).toHaveTextContent('Breathe out')
    phases(2)
    expect(status).toHaveTextContent('Round 2 of 4')
    phases(11)
    act(() => vi.advanceTimersByTime(3999))
    expect(onClose).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onClose).toHaveBeenCalled()
  })

  it('Stop closes it', () => {
    const onClose = vi.fn()
    render(<Breathe onClose={onClose} />)
    act(() => screen.getByRole('button', { name: 'Stop' }).click())
    expect(onClose).toHaveBeenCalled()
  })
})
