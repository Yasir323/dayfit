import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/** The `files:` list of electron-builder.yml. */
function filesList(): string[] {
  const yml = fs.readFileSync(path.join(__dirname, '../../electron-builder.yml'), 'utf8')
  const block = /^files:\n((?:\s+- .*\n)+)/m.exec(yml)
  if (!block) throw new Error('no files list')
  return block[1].split('\n').flatMap((l) => {
    const m = /^\s+- '?([^']*)'?$/.exec(l)
    return m ? [m[1]] : []
  })
}

describe('electron-builder files', () => {
  it('is an allowlist of the build output, resources and package.json', () => {
    expect(filesList()).toEqual(['out/**', 'resources/**', 'package.json'])
  })
})
