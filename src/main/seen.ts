import type { DayfitService, ViewState } from './service'

/** Popover shown: the latest reminder has been seen, so the menu-bar label clears. */
export function createSeenHandler(
  service: Pick<DayfitService, 'markSeen'>,
  publish: (v: ViewState) => ViewState
): () => void {
  return () => {
    publish(service.markSeen())
  }
}
