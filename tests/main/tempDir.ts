import fs from 'node:fs'

/**
 * Removes a test's temp folder. Services under test keep their database open, and Windows will not
 * delete an open file, so there the folder is left for the OS to clean up.
 */
export function removeDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EBUSY')) return
    throw e
  }
}
