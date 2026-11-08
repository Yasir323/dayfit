import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/core/**/*.test.ts', 'tests/main/**/*.test.ts'],
          // Windows CI runners can stall on disk for seconds; real SQLite tests need the headroom.
          testTimeout: 20_000
        }
      },
      {
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['tests/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/renderer/setup.ts']
        }
      }
    ],
    passWithNoTests: true
  }
})
