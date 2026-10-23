export type IconName =
  | 'today'
  | 'add'
  | 'dump'
  | 'settings'
  | 'pin'
  | 'phone'
  | 'home'
  | 'drop'
  | 'lock'
  | 'unlock'
  | 'trash'
  | 'check'
  | 'chevron'
  | 'clock'
  | 'flag'
  | 'tag'
  | 'calendar'
  | 'half'

// 24×24 stroke icons (drawn for Dayfit; no icon font or network asset).
const PATHS: Record<IconName, React.ReactNode> = {
  today: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="3" />
      <path d="M8 3v4M16 3v4M4 10h16" />
      <circle cx="12" cy="15" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  add: <path d="M12 5v14M5 12h14" />,
  dump: <path d="M5 7h14M5 12h14M5 17h9" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </>
  ),
  pin: <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5zM12 14v6" />,
  phone: (
    <path d="M6.5 4h3l1.5 4-2 1.5a10 10 0 0 0 5.5 5.5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A15 15 0 0 1 4.5 6a2 2 0 0 1 2-2z" />
  ),
  home: <path d="M4 11l8-6 8 6M6 10v9h12v-9M10 19v-5h4v5" />,
  drop: <path d="M12 4s6 6.5 6 10.5a6 6 0 0 1-12 0C6 10.5 12 4 12 4z" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 7.5-2" />
    </>
  ),
  trash: <path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  flag: <path d="M6 20V5M6 5h10l-2 3.5L16 12H6" />,
  tag: (
    <>
      <path d="M4 12V5h7l9 9-7 7-9-9z" />
      <circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="3" />
      <path d="M8 3v4M16 3v4M4 10h16" />
    </>
  ),
  half: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
    </>
  )
}

export function Icon({ name, size = 16 }: { name: IconName; size?: number }): React.JSX.Element {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}
