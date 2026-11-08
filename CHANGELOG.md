# Changelog

All notable changes to Dayfit are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-08

First public release, for macOS (menu bar) and Windows (system tray). Everything runs offline: no account, no cloud, no telemetry and no network requests.

### Added

- **Planning.** Quick-add with optional syntax (duration, label, priority, morning or afternoon, day, fixed time, deadline, item type) and a brain-dump "Plan my day". The scheduler fits tasks around fixed items inside working hours, with buffers, batching of similar tasks and a lunch block. It explains overflow and asks before moving anything to tomorrow.
- **Timeline.** Drag a task to lock it at a time. Calls get suggested slots.
- **Breaks.** Eye rest (20-20-20), water toward a daily target, stretching and walking, combined into one reminder and placed in real gaps, never in a meeting. Snooze, Busy mode, per-task do-not-disturb and a focus timer (25 or 50 min).
- **End of day.** Check-in and check-out reminders with an optional HR portal link, a wrap-up screen for unfinished items, a preview of tomorrow, a daily summary, an overtime nudge and an evening wind-down.
- **Wellbeing nudges.** Posture and desk set-up, daylight, mood check-ins, call fatigue, box breathing, caffeine cap and cut-off, sit/stand, meals and medication. Mouse pace feeds a tiredness signal.
- **Camera cues** (optional, off by default). On-device face landmarks spot few blinks, drooping eyes, yawns, slouching and sitting too close. Frames never leave the machine; only per-minute numbers are kept. Calibrate once for posture and distance.
- **Week view** with seven days of focus time, water and breaks, plus streaks.
- **Backup.** Export everything to one JSON file and import it on another machine.
- Global shortcut and full keyboard use.
- Settings says when the system blocks notifications.
- macOS `.dmg` and `.zip` (Apple silicon and Intel) and a Windows installer.

### Known limitations

- macOS builds are ad-hoc signed, not notarized: open them once through **System Settings → Privacy & Security → Open Anyway**. macOS asks for camera access again after each update.
- Windows builds are unsigned, so SmartScreen warns about an unknown publisher.
- Ad-hoc signed macOS builds can't show system notifications. Settings says so, and reminders still appear next to the menu-bar icon and in the popover.
- Google Calendar sync is built but switched off (`FLAGS.calendar`). Integrations come in later versions.

[1.0.0]: https://github.com/Yasir323/dayfit/releases/tag/v1.0.0
