# Dayfit

Dayfit is a menu bar (macOS) and system tray (Windows) day planner for people who work long hours at a computer. You type or paste the day's tasks, calls and fixed items, and Dayfit schedules them around the things that cannot move. Health reminders sit on top of the plan, so breaks land in real gaps and never interrupt a meeting. Everything runs offline and all data stays on your machine.

## Features (v1)

- Menu bar / tray popover on macOS and Windows.
- Quick-add: one line of text, with recognised tokens highlighted and editable fields below.
- Morning brain-dump: one item per line, a preview, then "Plan my day".
- Fixed items (meetings, standup, a run, household tasks) with optional daily or weekly repeat.
- Automatic, explainable scheduler that never touches fixed items, stays inside working hours, honours `@am` / `@pm`, leaves short buffers, batches similar tasks, and asks before moving overflow to tomorrow.
- Call slot suggestions, such as "Call John: 11:30 or 14:15".
- Today view: a timeline of the planned day.
- Reminders for meetings, water toward a daily target, eye rest (20-20-20), stretching and walking, placed in real gaps.
- Busy mode: mutes Dayfit's own notifications during deep work and fixed items.
- Local-only storage. No account, no cloud.

## Syntax cheat-sheet

Syntax is optional: every field can also be set by clicking. Tokens are case-insensitive and can appear anywhere in the line. Whatever is left over becomes the title.

| Token | Meaning | Example |
|---|---|---|
| `30m`, `2h`, `1h30m` | Duration | `Review PRs 45m` |
| `#label` | Label | `#work` |
| `!high` `!med` `!low` | Priority | `!high` |
| `@am` `@pm` | Prefer morning or afternoon | `@pm` |
| `today` | Plan for today | `today` |
| `tomorrow` | Plan for tomorrow | `tomorrow` |
| `mon`..`sun`, `monday`..`sunday` | Next such weekday (today counts) | `fri` |
| `at <time>` | Fixed start time (makes the item fixed; household items stay household) | `at 14:30`, `at 2pm`, `at 9:15am` |
| `by tomorrow`, `by <weekday>` | Deadline on that day | `by friday` |
| `by <time>` | Deadline today at a time (there is no `by today`) | `by 5pm` |
| `~call` | Item type: call | `~call` |
| `~deep` | Item type: deep work | `~deep` |
| `~home` | Item type: household | `~home` |

Times accept `14:30`, `2pm` and `2:30pm`. Example: `Call John 15m #work !high @am today ~call`.

## Privacy

All data is stored locally, in one JSON file:

- macOS: `~/Library/Application Support/Dayfit/dayfit.json`
- Windows: `%APPDATA%\Dayfit\dayfit.json`

Dayfit has no telemetry or update pings. It makes no network calls unless you connect Google Calendar (below); then it talks only to Google.

## Google Calendar (optional)

Dayfit can bring today's meetings in as fixed items and, if you turn it on, show your planned task and deep-work blocks on your calendar as busy time. You use your own Google OAuth client:

1. In [Google Cloud Console](https://console.cloud.google.com/), pick or create a project.
2. Enable the **Google Calendar API**.
3. Create an **OAuth client ID** of type **Desktop app** (set up the consent screen first if asked; add yourself as a test user).
4. In Dayfit, open **Settings → Google Calendar**, paste the client ID and client secret, and click **Connect**.

Sign-in happens in your browser. Dayfit first asks for read-only access; it asks again for write access only when you turn on "Show my planned blocks on Google Calendar". The sign-in token is encrypted with the system keychain and kept out of backups. Dayfit only edits or deletes events it created itself. Sync runs every 15 minutes, when the Mac wakes, and on **Sync now**.

## Develop

```sh
npm i
npm run dev
npm test
```

`npm run typecheck` runs both TypeScript projects, and `npm run build` typechecks and builds.

## Build

```sh
npm run dist:mac   # dist/Dayfit-<version>.dmg and .zip
npm run dist:win   # dist/Dayfit-<version>-setup.exe
```

Run each on its own platform. The first build downloads the Electron binaries.

### Signing

Builds are unsigned by default (`mac.identity: null`, `notarize: false` in `electron-builder.yml`), so macOS Gatekeeper and Windows SmartScreen will warn on first launch. To sign:

- macOS: install a Developer ID Application certificate in your keychain, remove `identity: null`, set `notarize: true`, and export `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`.
- Windows: set `CSC_LINK` and `CSC_KEY_PASSWORD` to your code-signing certificate before running `dist:win`.

## Roadmap

See [TODO.md](TODO.md) for v1 scope, later versions and the full backlog.

## License

[MIT](LICENSE)
