import { useEffect, useState } from 'react'
import { api } from './api'
import type { ViewState } from './api'
import { QuickAdd } from './views/QuickAdd'

// Temporary shell: Task 13 replaces this with the tab layout.
export function App(): React.JSX.Element {
  const [view, setView] = useState<ViewState | null>(null)
  useEffect(() => {
    void api.view().then(setView)
    return api.onState(setView)
  }, [])
  if (!view) return <div>Dayfit</div>
  return <QuickAdd settings={view.settings} today={view.today} onAdded={setView} />
}
