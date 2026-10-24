import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DaySummary } from '../../src/core/summary'
import type { WeekTrend } from '../../src/main/service'

const api = vi.hoisted(() => ({ week: vi.fn() }))
vi.mock('../../src/renderer/src/api', () => ({ api }))

import { WeekView } from '../../src/renderer/src/views/WeekView'
import { makeView } from './fixtures'

const day = (date: string, o: Partial<DaySummary> = {}): DaySummary => ({
  date,
  focusMin: 0,
  breaksTaken: 0,
  waterMl: 0,
  waterTargetMl: 2000,
  coffeeCups: 0,
  done: 0,
  moved: 0,
  dropped: 0,
  meetings: 0,
  moodAvg: null,
  ...o
})
const dates = [
  '2026-10-17',
  '2026-10-18',
  '2026-10-19',
  '2026-10-20',
  '2026-10-21',
  '2026-10-22',
  '2026-10-23'
]

const trend = (
  days: { date: string; summary: DaySummary | null }[],
  o: Partial<WeekTrend> = {}
): WeekTrend => ({
  days,
  energyLow: null,
  risk: { level: 'Low', late: 0, fewBreaks: 0, lowMood: 0 },
  streaks: { water: 0, breaks: 0, onTime: 0 },
  ...o
})

beforeEach(() => api.week.mockReset())
afterEach(cleanup)

describe('WeekView', () => {
  it('shows labelled meters for focus, water and breaks', async () => {
    api.week.mockResolvedValue(
      trend(
        dates.map((date) => ({
          date,
          summary:
            date === '2026-10-22'
              ? day(date, { focusMin: 150, waterMl: 1500, breaksTaken: 6, moodAvg: 3.5 })
              : null
        }))
      )
    )
    render(<WeekView view={makeView()} />)
    const focus = await screen.findByRole('group', { name: 'Focus hours' })
    expect(within(focus).getByRole('meter', { name: 'Thu: 2.5 h' })).toHaveAttribute(
      'aria-valuenow',
      '2.5'
    )
    expect(within(focus).getByRole('meter', { name: 'Fri: no data' })).toBeInTheDocument()
    const water = screen.getByRole('group', { name: 'Water' })
    expect(within(water).getByRole('meter', { name: 'Thu: 75%' })).toBeInTheDocument()
    const breaks = screen.getByRole('group', { name: 'Breaks' })
    expect(within(breaks).getByRole('meter', { name: 'Thu: 6 breaks' })).toBeInTheDocument()
    const mood = screen.getByRole('group', { name: 'Mood' })
    expect(within(mood).getByRole('meter', { name: 'Thu: 3.5 / 5' })).toBeInTheDocument()
    expect(screen.getAllByRole('meter')).toHaveLength(28)
  })

  it('an empty week says so', async () => {
    api.week.mockResolvedValue(trend(dates.map((date) => ({ date, summary: null }))))
    render(<WeekView view={makeView()} />)
    expect(await screen.findByText('No history yet')).toBeInTheDocument()
    expect(screen.queryAllByRole('meter')).toHaveLength(0)
  })
  it('shows the low point, the burnout risk and the streaks', async () => {
    const days = dates.map((date) => ({ date, summary: day(date) }))
    api.week.mockResolvedValue(
      trend(days, {
        energyLow: 900,
        risk: { level: 'Watch', late: 3, fewBreaks: 2, lowMood: 0 },
        streaks: { water: 3, breaks: 5, onTime: 2 }
      })
    )
    render(<WeekView view={makeView()} />)
    expect(await screen.findByText('Your low point: around 15:00')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Burnout risk' })).toHaveTextContent(
      'Burnout risk: Watch — 3 late days, 2 low-break days'
    )
    expect(
      screen.getByText('Streaks: water 3 days · breaks 5 days · on-time 2 days')
    ).toBeInTheDocument()
  })
})
