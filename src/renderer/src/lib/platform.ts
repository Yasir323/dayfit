/** The shortcut modifier to show in hints: ⌘ on a Mac, Ctrl elsewhere. */
export function modKey(userAgent: string): '⌘' | 'Ctrl' {
  return /Mac/i.test(userAgent) ? '⌘' : 'Ctrl'
}
