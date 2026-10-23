import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_ID } from '../../src/main/appId'

describe('APP_ID', () => {
  it('matches the electron-builder appId (Windows AUMID for notifications)', () => {
    const yml = fs.readFileSync(path.join(__dirname, '../../electron-builder.yml'), 'utf8')
    expect(APP_ID).toBe('dev.dayfit.app')
    expect(yml).toMatch(new RegExp(`^appId: ${APP_ID.replace(/\./g, '\\.')}$`, 'm'))
  })

  it('is the id the shell sets as the app user model id', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/main/index.ts'), 'utf8')
    expect(src).toContain('setAppUserModelId(APP_ID)')
  })
})
