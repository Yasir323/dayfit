/**
 * Features that are built but not shipped yet. Turning one on is a release decision:
 * external integrations wait for a later version.
 */
export const FLAGS = {
  /** Google Calendar sync: Settings section, background sync and write-back. */
  calendar: false
} as const
