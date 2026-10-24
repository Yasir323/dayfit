import { useState } from 'react'

const SHOWN = 3

/** At most three banners at once; the rest wait behind "Show N more". */
export function BannerStack({ banners }: { banners: React.JSX.Element[] }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const hidden = banners.length - SHOWN
  // Folded again once the stack is short: a later pile-up starts folded.
  if (open && hidden <= 0) setOpen(false)
  return (
    <>
      {open || hidden <= 0 ? banners : banners.slice(0, SHOWN)}
      {hidden > 0 && (
        <button type="button" className="btn-ghost banner-more" onClick={() => setOpen(!open)}>
          {open ? 'Show fewer' : `Show ${hidden} more`}
        </button>
      )}
    </>
  )
}
