import { readdirSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const WASM_DIR = resolve('node_modules/@mediapipe/tasks-vision/wasm')
/** The SIMD build plus the no-SIMD fallback; MediaPipe picks one at run time. */
const WASM_FILES = readdirSync(WASM_DIR).filter((f) => /^vision_wasm(_nosimd)?_internal\./.test(f))

/** Ships MediaPipe's WASM with the camera page: served in dev, emitted at build. No CDN. */
function mediapipeWasm(): Plugin {
  return {
    name: 'dayfit-mediapipe-wasm',
    configureServer(server) {
      server.middlewares.use('/mediapipe', (req, res, next) => {
        const file = (req.url ?? '').replace(/^\//, '').split('?')[0]
        if (!WASM_FILES.includes(file)) return next()
        res.setHeader(
          'content-type',
          file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'
        )
        res.end(readFileSync(resolve(WASM_DIR, file)))
      })
    },
    generateBundle() {
      for (const file of WASM_FILES)
        this.emitFile({
          type: 'asset',
          fileName: `mediapipe/${file}`,
          source: readFileSync(resolve(WASM_DIR, file))
        })
    }
  }
}

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts'), camera: resolve('src/preload/camera.ts') }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), mediapipeWasm()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          camera: resolve('src/renderer/camera.html')
        }
      }
    }
  }
})
