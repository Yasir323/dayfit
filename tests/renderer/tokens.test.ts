import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../../src/renderer/src')
const cssFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? cssFiles(p) : p.endsWith('.css') ? [p] : []
  })

describe('design tokens', () => {
  it('component css uses tokens only', () => {
    const offenders = cssFiles(ROOT)
      .filter((f) => path.basename(f) !== 'theme.css')
      .flatMap((f) =>
        (fs.readFileSync(f, 'utf8').match(/#[0-9a-f]{3,8}\b/gi) ?? []).map(
          (hex) => `${path.relative(ROOT, f)}: ${hex}`
        )
      )
    expect(offenders).toEqual([])
  })
  it('theme.css defines light tokens and a dark override', () => {
    const css = fs.readFileSync(path.join(ROOT, 'theme.css'), 'utf8')
    expect(css).toContain('--accent: #c9431c')
    expect(css).toContain('prefers-color-scheme: dark')
  })

  it('accent colours meet 4.5:1 contrast in light and dark', () => {
    const css = fs.readFileSync(path.join(ROOT, 'theme.css'), 'utf8')
    const dark = css.slice(css.indexOf('prefers-color-scheme: dark'))
    const light = css.slice(0, css.indexOf('prefers-color-scheme: dark'))
    const token = (block: string, name: string): string =>
      (new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block) ?? [])[1] ?? ''
    const lum = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const ratio = (a: string, b: string): number => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
      return (hi + 0.05) / (lo + 0.05)
    }
    expect(ratio(token(light, 'accent'), '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(ratio(token(dark, 'on-accent'), token(dark, 'accent'))).toBeGreaterThanOrEqual(4.5)
  })

  it('banners cap their height and scroll, and the toast never blocks clicks', () => {
    const css = fs.readFileSync(path.join(ROOT, 'App.css'), 'utf8')
    const rule = (sel: string): string => css.slice(css.indexOf(`${sel} {`)).split('}')[0]
    expect(rule('.banners')).toMatch(/max-height:/)
    expect(rule('.banners')).toMatch(/overflow-y: auto/)
    expect(rule('.toast')).toMatch(/pointer-events: none/)
  })
})
