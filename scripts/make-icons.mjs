// Renders build/icon.svg to the app icons electron-builder uses: build/icon.png (1024),
// build/icon.ico (Windows, PNG entries) and, on macOS, build/icon.icns (via iconutil).
// Runs inside Electron so Chromium does the SVG rendering: `npm run icons`.
import { app, BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BUILD = path.resolve(import.meta.dirname, '..', 'build')
const svg = fs.readFileSync(path.join(BUILD, 'icon.svg'), 'utf8')

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
// iconutil names: icon_<n>x<n>.png and icon_<n>x<n>@2x.png.
const ICNS_SIZES = [16, 32, 128, 256, 512]

/** A Windows .ico whose entries are PNG images (supported since Vista). */
function ico(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const dir = Buffer.alloc(16 * pngs.length)
  let offset = header.length + dir.length
  pngs.forEach(({ size, data }, i) => {
    const e = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, e)
    dir.writeUInt8(size >= 256 ? 0 : size, e + 1)
    dir.writeUInt8(0, e + 2)
    dir.writeUInt8(0, e + 3)
    dir.writeUInt16LE(1, e + 4)
    dir.writeUInt16LE(32, e + 6)
    dir.writeUInt32LE(data.length, e + 8)
    dir.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)])
}

async function renderAt(win, size) {
  const url = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}'
    await img.decode()
    const c = document.querySelector('canvas')
    c.width = c.height = ${size}
    const g = c.getContext('2d')
    g.clearRect(0, 0, ${size}, ${size})
    g.imageSmoothingQuality = 'high'
    g.drawImage(img, 0, 0, ${size}, ${size})
    return c.toDataURL('image/png')
  })()`)
  return Buffer.from(url.split(',')[1], 'base64')
}

// No top-level await: in an ESM main script it would hold back the `ready` event.
async function main() {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html,<canvas></canvas>')
  const render = (size) => renderAt(win, size)

  fs.writeFileSync(path.join(BUILD, 'icon.png'), await render(1024))

  const pngs = []
  for (const size of ICO_SIZES) pngs.push({ size, data: await render(size) })
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), ico(pngs))

  if (process.platform === 'darwin') {
    const set = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dayfit-icon-')), 'icon.iconset')
    fs.mkdirSync(set)
    for (const n of ICNS_SIZES) {
      fs.writeFileSync(path.join(set, `icon_${n}x${n}.png`), await render(n))
      fs.writeFileSync(path.join(set, `icon_${n}x${n}@2x.png`), await render(n * 2))
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(BUILD, 'icon.icns')])
  } else {
    console.warn('icon.icns not regenerated: iconutil needs macOS')
  }
  console.log('icons written to', BUILD)
}

app.dock?.hide()
app
  .whenReady()
  .then(main)
  .then(
    () => app.quit(),
    (err) => {
      console.error(err)
      app.exit(1)
    }
  )
