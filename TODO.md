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
- [ ] Snooze/Drank from the popover on Windows (notifications have no buttons there)
- [x] Busy mode: mutes Dayfit's own notifications during deep work and fixed items
- [x] Local-only storage, no account, no cloud
- [ ] Open source release (MIT license in place; needs README, screenshots, signed builds)

## Known issues and polish (from reviews)

- [ ] Visual check of the redesign and break notifications in the running app (`npm run dev`)
- [ ] Empty state missing when only Tomorrow/Later have items
- [ ] Footer not sticky
- [ ] Household items with a fixed start hide label and deadline
- [ ] Today summary counts done items
- [ ] Later hides an item's date when it has a deadline
- [ ] Calendar and List accessibility labels
- [ ] `⌘` glyph shown on Windows
- [ ] Quick-add Cancel doesn't clear an earlier error
- [ ] Only the tab bar is inert behind overlays
- [ ] Week rule duplicated (service and renderer)
- [ ] Accent colour contrast
- [ ] Snooze acts on the latest break, not the clicked older notification
- [ ] macOS shows only the first action (Snooze); Drank sits under Options
- [ ] Stale fallback break counter after toggling Eye off/on/off
- [ ] `!dnd` token highlight has no tinted background
- [ ] Nudges use the old busy rule; breaks use DND/high priority — reconcile
- [ ] A break can fire in the buffer between two different DND items

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
- [ ] Coffee break suggestion when user feels sleepy
- [x] Water reminder based on daily target intake
- [x] Stretching reminder
- [x] Walk reminder
- [ ] Meeting reminder (calendar connection)
- [ ] Meeting organiser and scheduler
- [ ] Google Calendar sync
- [x] Busy mode (turns off notifications)

## Mood and energy detection

- [ ] On-device webcam cues: yawns, eye-closure duration, slouching
- [ ] Typing rhythm, typo rate and mouse jitter as fatigue signals (no camera needed)
- [ ] Quick emoji check-in ("How you feeling?") to train the detector
- [ ] Wearable sync (Apple Health, Fitbit, Oura): sleep score, HRV, steps
- [ ] Personal energy curve learned from past days; predict the afternoon slump

## Body and health

- [x] Eye-strain reminders (20-20-20 rule)
- [ ] Blink-rate detection for dry eyes
- [ ] Posture warning
- [ ] Screen-distance warning
- [ ] Caffeine tracker: daily cap + cutoff hour; after cutoff suggest walk/water instead of coffee
- [ ] Meal / skipped-lunch reminder
- [ ] Snack reminder
- [ ] Medication reminder
- [ ] Sit/stand alternation for standing desks
- [ ] Guided breathing (box breathing) when stress detected
- [ ] Wind-down mode: blue-light nudge, stop late-night work

## Work and focus

- [ ] Auto busy mode during calendar meetings, screen share, or fullscreen apps
- [x] Smart break timing: never mid-meeting, moved into gaps
- [ ] Back-to-back meeting detection; auto-add buffer time
- [ ] Meeting prep pop-up 5 min before: agenda, join link, attendees
- [ ] Auto-book focus blocks into empty calendar slots
- [ ] Pomodoro timer tied to break cycle
- [x] End-of-day shutdown ritual
- [x] Overtime warning

## Reports and motivation

- [ ] Daily / weekly summary: breaks, water, screen time, mood trend
- [ ] Streaks and badges
- [ ] Burnout risk score from multi-week trends

## Team and social

- [ ] Slack / Teams status synced with busy mode
- [ ] Team coffee / walk invites ("3 people free at 3pm")
- [ ] Shared hydration / step challenges

## WFH-specific

- [ ] Virtual commute: short start-of-day and end-of-day ritual (walk, plan, review) to mark work boundaries
- [ ] Hard stop: after work hours, hide/snooze work apps and notifications
- [ ] Video-call fatigue: after N hours of calls, suggest camera-off, audio-only or walking meeting
- [ ] Step-deficit nudge: no office walking, so track movement gap and prompt
- [ ] Isolation check: "no human contact in X hours" nudge; virtual coffee with a teammate
- [ ] "On a call" signal for household: smart bulb (e.g. Hue) or phone status
- [ ] Daylight / fresh-air nudge: go outside, open window
- [x] Lunch away from desk reminder
- [ ] Guilt-free break status: auto "back in 10" message on Slack/Teams during breaks
- [ ] Home ergonomics checklist (chair, monitor height, lighting)
- [ ] Personal errands (school pickup, deliveries) blended into work calendar
- [ ] Timezone awareness for remote teams (late/early meeting warnings)

### Existing items that matter most for WFH (see sections above)

- [ ] Auto busy mode during meetings
- [x] Smart break timing (never mid-meeting)
- [ ] Back-to-back meeting buffers
- [x] Walk reminder
- [x] Stretching reminder
- [ ] Meal / skipped-lunch reminder
- [x] Water reminder
- [x] Overtime warning
- [x] End-of-day shutdown ritual
- [ ] Slack / Teams status synced with busy mode
- [ ] Team coffee / walk invites

## Privacy (cross-cutting requirement)

- [ ] All camera processing on-device; no video stored
- [ ] Per-feature on/off toggle
- [ ] Camera-free mode
