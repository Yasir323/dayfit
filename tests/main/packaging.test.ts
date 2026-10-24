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

const root = path.join(__dirname, '../..')
const read = (f: string): string => fs.readFileSync(path.join(root, f), 'utf8')

describe('camera cues packaging', () => {
  it('model file matches its pinned SHA-256', async () => {
    const { createHash } = await import('node:crypto')
    const bytes = fs.readFileSync(
      path.join(root, 'src/renderer/public/models/face_landmarker.task')
    )
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff'
    )
  })
  it('package pins mediapipe exactly', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> }
    expect(pkg.dependencies['@mediapipe/tasks-vision']).toBe('1.1.1')
  })
  it('mac build asks for the camera', () => {
    expect(read('electron-builder.yml')).toContain(
      'NSCameraUsageDescription: Dayfit uses the camera on your Mac to notice tiredness and posture. Nothing is recorded or sent.'
    )
    expect(read('build/entitlements.mac.plist')).toContain('com.apple.security.device.camera')
  })
  it('camera page has a strict CSP', () => {
    expect(read('src/renderer/camera.html')).toContain(
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' blob:; media-src 'self' blob: mediastream:"
    )
  })
})
