import type { DayfitCameraApi } from '../../preload/camera'

declare global {
  interface Window {
    dayfitCamera: DayfitCameraApi
  }
}
