# Contributing to Dayfit

Thanks for helping. Dayfit is a small Electron app, and the rules below keep it easy to change.

## Setup

You need Node.js 24 or later (Dayfit stores data with the built-in `node:sqlite`) and npm.

```sh
npm install      # also downloads the Electron binary
npm run dev      # start the app with hot reload
```

Before you open a pull request, run the same checks as CI:

```sh
npm run lint
npm run typecheck
npm test
```

`node scripts/drive.mjs <dir>` launches the built app (`npx electron-vite build` first) against a throwaway profile and saves a screenshot of each screen. Use it to check UI changes.

## Layout

| Path            | What lives there                                                                 |
| --------------- | -------------------------------------------------------------------------------- |
| `src/core`      | Pure logic: parsing, scheduling, reminders, breaks, summaries. No I/O.           |
| `src/main`      | Electron main process: tray, notifications, storage (SQLite), IPC, camera, sync. |
| `src/preload`   | The `window.dayfit` bridge between main and renderer.                            |
| `src/renderer`  | React UI for the popover.                                                        |
| `tests/<layer>` | Vitest tests, one folder per layer above.                                        |

## Keep the core pure

Code in `src/core` takes plain values and returns plain values. It must not:

- import Electron, Node built-ins (`fs`, `path`, `node:sqlite`, …) or React;
- read the clock (`Date.now()`, `new Date()` with no arguments): take `now` as a parameter;
- use timers, randomness, the network or global state.

Side effects belong in `src/main` (or the renderer), which calls into the core. This keeps the scheduler and reminder rules fast to test and the same on every platform.

## Test first

Work test-first (TDD):

1. Write a failing test that shows the behaviour or the bug.
2. Make it pass with the smallest change.
3. Tidy up while the tests stay green.

Every bug fix comes with a test that fails without the fix. Core changes get unit tests in `tests/core`; main-process logic gets tests in `tests/main` with Electron mocked; UI changes get Testing Library tests in `tests/renderer` that query by role and accessible name.

## Pull requests

- Keep each pull request to one change, with a clear title (`feat: …`, `fix: …`, `docs: …`, `build: …`).
- Explain the user-visible effect and how you checked it. Add screenshots for UI changes.
- Dayfit is local-only. Changes that send data off the machine need an issue and discussion first.
- By contributing you agree that your work is released under the [MIT License](LICENSE).
