import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Checkbox } from '../../src/renderer/src/ui/Checkbox'
import { Icon } from '../../src/renderer/src/ui/Icon'
import { Segmented } from '../../src/renderer/src/ui/Segmented'

describe('Checkbox', () => {
  it('maps med to the neutral colour and reports checks', async () => {
    const onChange = vi.fn()
    render(<Checkbox priority="med" checked={false} onChange={onChange} label="Done: Write" />)
    const box = screen.getByRole('checkbox', { name: 'Done: Write' })
    expect(box).toHaveAttribute('aria-checked', 'false')
    expect(box.className).toContain('prio-none')
    await userEvent.click(box)
    expect(onChange).toHaveBeenCalledWith(true)
  })
  it('colours high and low', () => {
    render(
      <>
        <Checkbox priority="high" checked={false} onChange={() => {}} label="h" />
        <Checkbox priority="low" checked onChange={() => {}} label="l" />
      </>
    )
    expect(screen.getByRole('checkbox', { name: 'h' }).className).toContain('prio-high')
    const low = screen.getByRole('checkbox', { name: 'l' })
    expect(low.className).toContain('prio-low')
    expect(low).toHaveAttribute('aria-checked', 'true')
  })
})

describe('Segmented', () => {
  it('selects options as tabs', async () => {
    const onChange = vi.fn()
    render(
      <Segmented
        label="View"
        options={[
          ['list', 'List'],
          ['calendar', 'Calendar']
        ]}
        value="list"
        onChange={onChange}
      />
    )
    expect(screen.getByRole('tablist', { name: 'View' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Calendar' })).toHaveAttribute('aria-selected', 'false')
    await userEvent.click(screen.getByRole('tab', { name: 'Calendar' }))
    expect(onChange).toHaveBeenCalledWith('calendar')
  })
})

describe('Icon', () => {
  it('renders a decorative inline svg', () => {
    const { container } = render(<Icon name="pin" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })
})
