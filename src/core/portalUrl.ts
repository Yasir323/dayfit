/** True only for an absolute http(s) link, the one kind of URL handed to the browser. */
export function isPortalUrl(s: string): boolean {
  const t = s.trim()
  if (t === '') return false
  try {
    const u = new URL(t)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
