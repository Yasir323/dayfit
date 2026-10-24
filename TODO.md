# Dayfit — Feature Backlog

Target audience: anyone working in front of a computer for long hours.
Status: v1 built (local, unreleased); UI redesign and break reminders v2 done. Specs live in `docs/superpowers/specs/` (not committed).
Everything below "Full backlog" is unprioritised beyond the v1 / later split.

## v1 (committed scope)

- [x] Mac + Windows menu bar / tray app (Electron, React, TypeScript)
- [x] Quick-add: one-line syntax (`15m #work !high @am today`) + editable fields
- [x] Morning brain-dump: one item per line, same syntax, preview, "Plan my day"
- [x] Fixed items entered by hand (meetings, standup, run, household), optional daily/weekly repeat
- [x] Scheduler: never touches fixed items, working hours only, `@am`/`@pm`, ~5 min buffers, batch similar tasks, overflow to tomorrow (asks first)
- [x] Call slot suggestions ("Call John: 11:30 or 14:15")
- [x] Today view (timeline of the planned day) + List and Calendar views, bottom tab bar (redesign)
- [x] Reminders: meeting alerts
- [x] Reminders: water toward daily target (progress bar; reminders every 60 min)
- [x] Reminders: eye rest (20-20-20)
- [x] Reminders: stretch and walk (reminders only, no planned slot)
- [x] Combined break notification (eye/water/stretch/walk) with snooze and per-task DND
- [x] Check-in/check-out attendance reminders with optional HRMS portal link
- [x] Lunch block in the plan, end-of-day check-out screen, one overtime nudge
- [x] Lunch clash: shorten, move, pick a time or skip today
- [x] Snooze/Drank from the popover on Windows (notifications have no buttons there)
- [x] In-app reminder fallback: menu-bar label + popover banners
- [x] Busy mode: mutes Dayfit's own notifications during deep work and fixed items
- [x] Local-only storage, no account, no cloud
- [ ] Open source release (MIT license in place; needs README, screenshots, signed builds)

## Known issues and polish (from reviews)

- [ ] Sign dev builds (Apple Development cert) so macOS shows notifications
- [x] Visual check of the redesign and break notifications in the running app (`npm run dev`)
- [x] Empty state missing when only Tomorrow/Later have items
- [x] Footer not sticky
- [x] Household items with a fixed start hide label and deadline
- [x] Today summary counts done items
- [x] Later hides an item's date when it has a deadline
- [x] Calendar and List accessibility labels
- [x] `⌘` glyph shown on Windows
- [x] Quick-add Cancel doesn't clear an earlier error
- [x] Only the tab bar is inert behind overlays
- [x] Week rule duplicated (service and renderer)
- [x] Accent colour contrast
- [x] Snooze acts on the latest break, not the clicked older notification
- [x] macOS shows only the first action (Snooze); Drank sits under Options
- [x] Stale fallback break counter after toggling Eye off/on/off
- [x] `!dnd` token highlight has no tinted background
- [x] Nudges use the old busy rule; breaks use DND/high priority — reconcile
- [x] A break can fire in the buffer between two different DND items
- [x] Nudge "+15 min" can push a future lunch block
- [x] "Unscheduled" answers (review and check-out) are lost on restart
- [x] "Tomorrow" at check-out keeps today's suggested call slots
- [x] macOS: "Punched" sits under Options when a portal link is set (only first action shows)
- [x] Punch-out and overtime can fire on the same tick
- [x] Lunch moves aren't announced in the "plan updated" toast
- [x] Answering a lunch clash can surface a second Review straight after Apply
- [x] Lunch clash says "clashes with Busy" when lunch only overflows working hours
- [x] Review selection resets if the lunch clash changes while it is open
- [x] Lunch pick validated against a possibly stale `now` in the renderer
- [x] Banners behind check-out / first-run overlays are keyboard-reachable
- [x] Banner "Check out" silently does nothing during a review (no feedback)
- [x] Alert banner "Check out" dismisses even if a pending review blocks the check-out screen
- [x] `markSeen` exposed over IPC but unused by the renderer
- [x] No test for popover show → markSeen wiring (first-run order depends on line order in index.ts)
- [x] Daily summary saved at check-out isn't updated by water/coffee/done logged afterwards
- [x] Unreadable or invalid `dayfit.json` at migration is silent and never retried
- [x] Corrupt `dayfit.db` starts fresh without offering `dayfit.json.migrated`
- [x] Ending focus overrides a Busy change made during the session
- [x] Focus crossing midnight credits the new day and fires a late "Focus done"
- [x] `doneDates` on daily items grows without limit (prune at rollover)
- [x] Snoozing a pre-midnight break notification lowers today's break count
- [x] During a lunch clash, call-slot suggestions can offer the slot lunch would move to
- [ ] Features toggles: two quick toggles before the view refreshes can undo the first
- [ ] Banners can still pile up in the popover over a busy day (one new nudge per tick)
- [ ] Waking the Mac runs the probe and tick twice (resume + unlock)
- [ ] Cursor jitter (`turns`) is measured but not used in the fatigue signal
- [ ] Work days setting: check-ins, start-of-day and wind-down also fire on weekends
- [ ] Mood check-in times can't be changed in Settings

## Pick next — finish the app end to end (tick what to build)
Calendar sync, Slack/Teams, AI and mood detection stay in "Later versions".

### Planning and tasks
- [x] Drag and drop on the timeline (drop = lock there; fixed items stay put)
- [x] Edit an existing item in place (title, duration, time, labels) from List/Timeline
- [x] Repeating tasks and chores (daily/weekly), not only fixed items
- [x] Evening preview: see and adjust tomorrow's plan before checking out
- [x] Meeting buffers: auto gap after back-to-back fixed items + "prep in 5 min" note

### Focus and wellbeing
- [x] Focus timer (25/50 min) on any task: DND on, breaks held, short break after
- [x] Coffee and energy: caffeine cap + cut-off hour, afternoon-slump coffee/walk suggestion
- [x] Daily summary at check-out: focus time, breaks taken, water vs target, done/moved
- [x] Weekly trend view (last 7 days of the daily summary)

### App quality
- [ ] Keyboard navigation in the popover (tabs, list rows, actions)
- [x] Backup: export/import data as JSON from Settings
- [x] Leftover minors (5 items under "Known issues and polish")
- [x] Visual check in the running app (`npm run dev`)

### Release (end)
- [ ] App icon and packaging for Mac + Windows
- [ ] Sign dev and release builds (Apple Development / Developer ID)
- [ ] Open-source release: README, screenshots, contributing guide, CI

## Next up
- [x] Drag and drop on the timeline: drag tasks and lunch to a new time (drop = lock there); fixed items stay put

## Later versions

- [ ] Google Calendar sync (read meetings, write planned blocks back)
- [ ] Slack / Teams / Meet integration
- [ ] Paid AI brain-dump (free-form sentences)
- [ ] Camera mood / fatigue detection + coffee suggestion
- [ ] Wearables, reports, streaks, team features
- [ ] Everything else in the full backlog below

# Full backlog

## Original ideas

- [ ] Mood detection
- [x] Coffee break suggestion when user feels sleepy
- [x] Water reminder based on daily target intake
- [x] Stretching reminder
- [x] Walk reminder
- [ ] Meeting reminder (calendar connection)
- [ ] Meeting organiser and scheduler
- [ ] Google Calendar sync
- [x] Busy mode (turns off notifications)

## Mood and energy detection

- [ ] On-device webcam cues: yawns, eye-closure duration, slouching
- [x] Mouse pace and activity as fatigue signals (no camera needed)
- [ ] Typing rhythm and typo rate as fatigue signals (needs a native key hook + Accessibility permission)
- [x] Quick emoji check-in ("How you feeling?") to train the detector
- [ ] Wearable sync (Apple Health, Fitbit, Oura): sleep score, HRV, steps
- [x] Personal energy curve learned from past days; predict the afternoon slump

## Body and health

- [x] Eye-strain reminders (20-20-20 rule)
- [ ] Blink-rate detection for dry eyes
- [ ] Posture warning
- [ ] Screen-distance warning
- [x] Caffeine tracker: daily cap + cutoff hour; after cutoff suggest walk/water instead of coffee
- [x] Meal / skipped-lunch reminder
- [x] Snack reminder
- [x] Medication reminder
- [x] Sit/stand alternation for standing desks
- [x] Guided box breathing (header button; offered after long meeting runs)
- [ ] Offer breathing when stress is detected
- [x] Wind-down: evening nudge to stop working
- [ ] Blue-light nudge in the evening

## Work and focus

- [x] Auto busy mode while another app is full screen (macOS)
- [ ] Auto busy mode during screen share
- [x] Smart break timing: never mid-meeting, moved into gaps
- [x] Back-to-back meeting detection; auto-add buffer time
- [ ] Meeting prep pop-up 5 min before: agenda, join link, attendees
- [ ] Auto-book focus blocks into empty calendar slots
- [x] Pomodoro timer tied to break cycle
- [x] End-of-day shutdown ritual
- [x] Overtime warning

## Reports and motivation

- [x] Daily / weekly summary: breaks, water, screen time, mood trend
- [x] Streaks (water, breaks, on-time check-out)
- [ ] Badges
- [x] Burnout risk score from multi-week trends

## Team and social

- [ ] Slack / Teams status synced with busy mode
- [ ] Team coffee / walk invites ("3 people free at 3pm")
- [ ] Shared hydration / step challenges

## WFH-specific

- [x] Virtual commute: short start-of-day and end-of-day ritual (walk, plan, review) to mark work boundaries
- [ ] Hard stop: after work hours, hide/snooze work apps and notifications
- [x] Video-call fatigue: after N hours of calls, suggest camera-off, audio-only or walking meeting
- [ ] Step-deficit nudge: no office walking, so track movement gap and prompt
- [ ] Isolation check: "no human contact in X hours" nudge; virtual coffee with a teammate
- [ ] "On a call" signal for household: smart bulb (e.g. Hue) or phone status
- [x] Daylight / fresh-air nudge: go outside, open window
- [x] Lunch away from desk reminder
- [ ] Guilt-free break status: auto "back in 10" message on Slack/Teams during breaks
- [x] Home ergonomics checklist (chair, monitor height, lighting)
- [ ] Personal errands (school pickup, deliveries) blended into work calendar
- [ ] Timezone awareness for remote teams (late/early meeting warnings)

### Existing items that matter most for WFH (see sections above)

- [ ] Auto busy mode during meetings
- [x] Smart break timing (never mid-meeting)
- [x] Back-to-back meeting buffers
- [x] Walk reminder
- [x] Stretching reminder
- [x] Meal / skipped-lunch reminder
- [x] Water reminder
- [x] Overtime warning
- [x] End-of-day shutdown ritual
- [ ] Slack / Teams status synced with busy mode
- [ ] Team coffee / walk invites

## Privacy (cross-cutting requirement)

- [ ] All camera processing on-device; no video stored
- [x] Per-feature on/off toggle
- [x] Camera-free mode
