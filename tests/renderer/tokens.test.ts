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
    expect(css).toContain('--accent: #e4572e')
    expect(css).toContain('prefers-color-scheme: dark')
  })
})
