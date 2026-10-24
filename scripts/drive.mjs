// Screenshot driver for a visual check: launches the built app (`npx electron-vite build` first)
// against a throwaway profile, sets up a day around the current time, and screenshots each screen.
// Usage: node scripts/drive.mjs [outDir]
import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'dayfit-shots'))
fs.mkdirSync(OUT, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfit-profile-'))

const bin =
  process.platform === 'darwin'
    ? path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : path.join(APP_DIR, 'node_modules/electron/dist/electron')

const app = await electron.launch({
  executablePath: bin,
  args: [APP_DIR],
  env: { ...process.env, DAYFIT_USER_DATA: profile },
  timeout: 30_000
})
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
const show = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show())
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = async (name) => {
  await pause(400)
  const f = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: f })
  console.log('shot', f)
}
const click = (role, name) => page.getByRole(role, { name, exact: true }).first().click()
/** Late in the day some items won't fit: send them to tomorrow so the screens can be reached. */
const answerReview = async () => {
  const review = page.getByRole('dialog', { name: 'Review your plan' })
  if (!(await review.isVisible())) return
  for (const t of await review.getByText('Tomorrow', { exact: true }).all()) await t.click()
  const skip = review.getByText('Skip today', { exact: true })
  if (await skip.isVisible()) await skip.click()
  await review.getByRole('button', { name: 'Apply' }).click()
  await review.waitFor({ state: 'detached' })
}
const api = (fn, ...args) => page.evaluate(([f, a]) => window.dayfit[f](...a), [fn, args])

try {
  await show()
  await page.getByRole('dialog').first().waitFor({ timeout: 10_000 })
  await shot('01-first-run')

  // A working day around now, lunch an hour in, then a few items.
  const d = new Date()
  const now = d.getHours() * 60 + d.getMinutes()
  const start = Math.max(0, now - 60)
  const end = Math.min(24 * 60 - 5, now + 360)
  const v = await api('updateSettings', {
    firstRunDone: true,
    // Every day is a work day here, so the screenshots don't depend on the weekday.
    workDays: [0, 1, 2, 3, 4, 5, 6],
    workStart: start,
    workEnd: end,
    lunch: now + 90
  })
  const today = v.today
  const item = (o) => ({
    title: 'Task',
    type: 'task',
    durationMin: 30,
    label: null,
    priority: 'med',
    half: null,
    date: today,
    fixedStart: null,
    deadline: null,
    repeat: { kind: 'none' },
    dnd: false,
    ...o
  })
  const round = (m) => Math.ceil(m / 5) * 5
  await api('addItems', [
    item({ title: 'Write the quarterly planning document', durationMin: 45, priority: 'high' }),
    item({ title: 'Payments refactor', type: 'deep', durationMin: 90 }),
    item({ title: 'Standup', type: 'fixed', fixedStart: round(now + 20), durationMin: 15 }),
    item({
      title: 'Water the plants',
      type: 'household',
      durationMin: 10,
      repeat: { kind: 'daily' }
    }),
    item({ title: 'Call the bank', type: 'call', durationMin: 15 })
  ])
  await api('logWater')
  await api('logCoffee')
  await page.reload()
  await page.getByRole('navigation', { name: 'Main' }).waitFor()
  await pause(500)
  await answerReview()

  for (const [view, name] of [
    ['List', '02-today-list'],
    ['Calendar', '03-today-calendar'],
    ['Timeline', '04-today-timeline']
  ]) {
    await click('tab', view)
    await shot(name)
  }

  await click('button', 'Add')
  await shot('05-quick-add')
  await click('button', 'Settings')
  await shot('06-settings')
  await page.mouse.wheel(0, 3000)
  await shot('07-settings-bottom')
  await click('button', 'Today')

  // Focus timer on the first task.
  await click('tab', 'List')
  // Late in the day the tasks may have gone to tomorrow; focus on any open item still here.
  const focusOn = (await api('view')).items.find((i) => i.status === 'open' && i.type !== 'fixed')
  if (focusOn) {
    await api('startFocus', focusOn.id, 25)
    await page.reload()
    await page.getByRole('navigation', { name: 'Main' }).waitFor()
    await shot('08-focus')
    await api('stopFocus')
  }

  // Wellbeing banners: a check-in, daylight and a custom reminder due now (next tick fires them).
  const f = (await api('view')).settings.features
  await api('updateSettings', {
    features: {
      ...f,
      mood: { ...f.mood, times: [now] },
      daylight: { ...f.daylight, at: now },
      reminders: [
        { id: 'r1', title: 'Take vitamin D', kind: 'at', times: [now], everyMin: 0, enabled: true }
      ]
    }
  })
  // Nudges wait for the user to be active (system idle < 5 min): best effort when nobody is at it.
  const checkin = page.getByRole('region', { name: 'How are you feeling?' })
  const more = page.getByRole('button', { name: /^Show \d+ more$/ })
  await page.waitForTimeout(40_000)
  if (await more.isVisible()) await more.click()
  if (await checkin.isVisible()) {
    await shot('15-wellbeing-banners')
    await click('button', 'Good')
  } else {
    await shot('15-wellbeing-banners')
    console.log('note: no check-in yet (the Mac is idle, so nudges are waiting)')
  }

  // Breathing screen from the Today header.
  await click('button', 'Breathe')
  await pause(2500)
  await shot('16-breathe')
  await click('button', 'Stop')

  // The new Settings groups.
  await click('button', 'Settings')
  for (const [group, name] of [
    ['Features', '17-settings-features'],
    ['My reminders', '18-settings-reminders'],
    ['Home setup', '19-settings-home-setup'],
    ['Google Calendar', '20-settings-google-calendar']
  ]) {
    await page.getByRole('group', { name: group }).scrollIntoViewIfNeeded()
    await shot(name)
  }
  await click('button', 'Today')

  // Lunch clash: a meeting over lunch.
  await api('addItems', [
    item({ title: 'Client call', type: 'fixed', fixedStart: round(now + 85), durationMin: 60 })
  ])
  await page.reload()
  await page.getByRole('dialog', { name: 'Review your plan' }).waitFor({ timeout: 5_000 })
  await shot('09-lunch-clash')
  await answerReview()

  // Check-out, then the day summary.
  await api('updateSettings', { workEnd: round(now + 30) })
  await page.reload()
  await page.getByRole('navigation', { name: 'Main' }).waitFor()
  // A shorter day leaves items over: send them to tomorrow.
  const review = page.getByRole('dialog', { name: 'Review your plan' })
  if (await review.isVisible()) {
    for (const t of await review.getByText('Tomorrow', { exact: true }).all()) await t.click()
    await click('button', 'Apply')
    await review.waitFor({ state: 'detached' })
  }
  await shot('10-evening-today')
  await click('button', 'Check out')
  await shot('11-check-out')
  await click('button', 'Done for today')
  await shot('12-day-summary')
  await click('button', 'Close')
  await click('tab', 'Week')
  await shot('13-week')
  await click('tab', 'Tomorrow')
  await shot('14-tomorrow')
} catch (e) {
  await shot('zz-failure').catch(() => {})
  console.error(e)
  process.exitCode = 1
} finally {
  await app.close()
  fs.rmSync(profile, { recursive: true, force: true })
}
