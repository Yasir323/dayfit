import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { frameCue } from '../../core/faceCues'
import { createCollector, FPS } from './collector'

/**
 * The hidden camera page. Frames are read, reduced to a few numbers, folded into minute
 * scores, and dropped; only the scores (and a calibration) go to the app.
 */
const api = window.dayfitCamera

/** MediaPipe's matrices are column-major; frameCue reads row-major. */
const rowMajor = (data: number[]): number[] =>
  Array.from({ length: 16 }, (_, i) => data[(i % 4) * 4 + Math.floor(i / 4)] ?? 0)

async function landmarker(): Promise<FaceLandmarker> {
  const files = await FilesetResolver.forVisionTasks('./mediapipe')
  const options = (
    delegate: 'GPU' | 'CPU'
  ): Parameters<typeof FaceLandmarker.createFromOptions>[1] => ({
    baseOptions: { modelAssetPath: './models/face_landmarker.task', delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true
  })
  try {
    return await FaceLandmarker.createFromOptions(files, options('GPU'))
  } catch {
    return FaceLandmarker.createFromOptions(files, options('CPU'))
  }
}

async function start(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 320, height: 240, frameRate: 15 },
    audio: false
  })
  window.addEventListener('pagehide', () => stream.getTracks().forEach((t) => t.stop()))
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  await video.play()
  const face = await landmarker()
  const collector = createCollector({
    now: () => Date.now(),
    onMinute: (m) => api.sendMinute(m),
    onCalibration: (c) => api.sendCalibration(c)
  })
  api.onCalibrate(() => collector.startCalibration())
  let last = -1
  setInterval(() => {
    if (video.readyState < 2) return
    const t = performance.now()
    if (t <= last) return
    last = t
    const r = face.detectForVideo(video, t)
    const lm = r.faceLandmarks[0]
    collector.push(
      frameCue(
        t,
        lm
          ? {
              landmarks: lm,
              blendshapes: r.faceBlendshapes[0]?.categories ?? [],
              matrix: rowMajor(r.facialTransformationMatrixes?.[0]?.data ?? [])
            }
          : null
      )
    )
  }, 1000 / FPS)
}

start().catch((e: unknown) =>
  api.sendError(e instanceof Error ? `${e.name}: ${e.message}` : String(e))
)
