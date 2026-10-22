# Dayfit — Feature Backlog

Target audience: anyone working in front of a computer for long hours.
Status: v1 scope agreed. Spec: `docs/superpowers/specs/2026-10-23-dayfit-design.md`.
Everything below "Full backlog" is unprioritised beyond the v1 / later split.

## v1 (committed scope)
- [ ] Mac + Windows menu bar / tray app (Electron, React, TypeScript)
- [ ] Quick-add: one-line syntax (`15m #work !high @am today`) + editable fields
- [ ] Morning brain-dump: one item per line, same syntax, preview, "Plan my day"
- [ ] Fixed items entered by hand (meetings, standup, run, household), optional daily/weekly repeat
- [ ] Scheduler: never touches fixed items, working hours only, `@am`/`@pm`, ~5 min buffers, batch similar tasks, overflow to tomorrow (asks first)
- [ ] Call slot suggestions ("Call John: 11:30 or 14:15")
- [ ] Today view (timeline of the planned day)
- [ ] Reminders: meeting alerts
- [ ] Reminders: water toward daily target
- [ ] Reminders: eye rest (20-20-20)
- [ ] Reminders: stretch and walk, placed in real gaps
- [ ] Busy mode: mutes Dayfit's own notifications during deep work and fixed items
- [ ] Local-only storage, no account, no cloud
- [ ] Open source release (license TBD)

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
- [ ] Water reminder based on daily target intake
- [ ] Stretching reminder
- [ ] Walk reminder
- [ ] Meeting reminder (calendar connection)
- [ ] Meeting organiser and scheduler
- [ ] Google Calendar sync
- [ ] Busy mode (turns off notifications)

## Mood and energy detection
- [ ] On-device webcam cues: yawns, eye-closure duration, slouching
- [ ] Typing rhythm, typo rate and mouse jitter as fatigue signals (no camera needed)
- [ ] Quick emoji check-in ("How you feeling?") to train the detector
- [ ] Wearable sync (Apple Health, Fitbit, Oura): sleep score, HRV, steps
- [ ] Personal energy curve learned from past days; predict the afternoon slump

## Body and health
- [ ] Eye-strain reminders (20-20-20 rule)
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
- [ ] Smart break timing: never mid-meeting, moved into gaps
- [ ] Back-to-back meeting detection; auto-add buffer time
- [ ] Meeting prep pop-up 5 min before: agenda, join link, attendees
- [ ] Auto-book focus blocks into empty calendar slots
- [ ] Pomodoro timer tied to break cycle
- [ ] End-of-day shutdown ritual
- [ ] Overtime warning

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
- [ ] Lunch away from desk reminder
- [ ] Guilt-free break status: auto "back in 10" message on Slack/Teams during breaks
- [ ] Home ergonomics checklist (chair, monitor height, lighting)
- [ ] Personal errands (school pickup, deliveries) blended into work calendar
- [ ] Timezone awareness for remote teams (late/early meeting warnings)

### Existing items that matter most for WFH (see sections above)
- [ ] Auto busy mode during meetings
- [ ] Smart break timing (never mid-meeting)
- [ ] Back-to-back meeting buffers
- [ ] Walk reminder
- [ ] Stretching reminder
- [ ] Meal / skipped-lunch reminder
- [ ] Water reminder
- [ ] Overtime warning
- [ ] End-of-day shutdown ritual
- [ ] Slack / Teams status synced with busy mode
- [ ] Team coffee / walk invites

## Privacy (cross-cutting requirement)
- [ ] All camera processing on-device; no video stored
- [ ] Per-feature on/off toggle
- [ ] Camera-free mode
