/**
 * Audio recorder — captures microphone input and encodes to MP3.
 *
 * Primary path: mp3-mediarecorder (WASM LAME encoder in a Web Worker) for
 * true MP3 output. The worker JS and vmsg.wasm must be in public/ — the
 * postinstall script (`scripts/copy-mp3-worker.mjs`) handles this.
 *
 * Fallback path: native MediaRecorder API. Used automatically when the WASM
 * worker fails to start within MP3_START_TIMEOUT_MS (e.g. on mobile where
 * WASM or Worker init may silently hang). Produces audio/mp4 on iOS Safari
 * and audio/webm on Android/Chrome. The mimeType is returned by stop() so
 * callers can persist the correct file extension.
 *
 * We keep our own AudioContext + AnalyserNode for real-time level metering
 * (the MediaRecorder API doesn't expose audio levels). The Mp3MediaRecorder
 * is dynamically imported to avoid crashing the static-export prerender.
 *
 * Pause/resume is supported — Mp3MediaRecorder implements the full
 * MediaRecorder interface including state transitions. Native MediaRecorder
 * also supports pause/resume on all modern browsers.
 */

export interface RecorderState {
  status: 'idle' | 'recording' | 'paused' | 'stopped'
  elapsedMs: number
  /** RMS audio level 0–1 for visualization. */
  level: number
}

/** How long to wait for the WASM worker to emit 'start' before falling back to native MediaRecorder. */
const MP3_START_TIMEOUT_MS = 6000

/** Pick the best native MIME type the browser supports. */
function nativeMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

export interface AudioRecorderOptions {
  /** Callback fired ~60fps with updated state. */
  onStateChange?: (state: RecorderState) => void
}

// Lazily resolved Mp3MediaRecorder constructor — avoids importing at module
// scope which would break prerendering (the library references browser globals).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Mp3MediaRecorderCtor: any = null

async function getMp3MediaRecorder() {
  if (!Mp3MediaRecorderCtor) {
    const mod = await import('mp3-mediarecorder')
    Mp3MediaRecorderCtor = mod.Mp3MediaRecorder ?? mod.default
  }
  return Mp3MediaRecorderCtor
}

export class AudioRecorder {
  private stream: MediaStream | null = null
  private audioCtx: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recorder: any = null // Mp3MediaRecorder or native MediaRecorder
  private recorderMimeType = 'audio/mpeg' // updated after start() resolves
  private chunks: Blob[] = []
  private _state: RecorderState = { status: 'idle', elapsedMs: 0, level: 0 }
  private startTime = 0
  private pauseOffset = 0
  private rafId = 0
  private analyser: AnalyserNode | null = null
  private analyserData: Uint8Array<ArrayBuffer> | null = null
  private opts: Required<AudioRecorderOptions>
  /** Resolve function for the stop() promise — set once, called by onstop. */
  private stopResolve: ((v: { audioBytes: Uint8Array; durationMs: number; mimeType: string }) => void) | null = null
  private stopReject: ((err: Error) => void) | null = null

  constructor(opts: AudioRecorderOptions = {}) {
    this.opts = {
      onStateChange: opts.onStateChange ?? (() => {}),
    }
  }

  get state(): RecorderState {
    return { ...this._state }
  }

  /** Request mic permission and start recording. */
  async start(): Promise<void> {
    if (this._state.status === 'recording') return

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    this.stream = stream

    // ── Level metering (our own AudioContext) ──────────────────────
    this.audioCtx = new AudioContext()
    this.source = this.audioCtx.createMediaStreamSource(stream)
    this.analyser = this.audioCtx.createAnalyser()
    this.analyser.fftSize = 256
    this.analyserData = new Uint8Array(this.analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>
    this.source.connect(this.analyser)

    // ── Try MP3 MediaRecorder, fall back to native on failure/timeout ──
    this.chunks = []
    let usedMp3 = false

    try {
      const Ctor = await getMp3MediaRecorder()
      const worker = new Worker('/mp3-recorder-worker.js')
      const mp3Rec = new Ctor(stream, { worker })

      await Promise.race([
        // Wait for the WASM worker to signal it's ready
        new Promise<void>((resolve, reject) => {
          const onStart = () => { cleanup(); resolve() }
          const onError = (e: Event) => {
            cleanup()
            reject(new Error(`MP3 recorder error: ${(e as ErrorEvent).message ?? 'unknown'}`))
          }
          const cleanup = () => {
            mp3Rec.removeEventListener('start', onStart)
            mp3Rec.removeEventListener('error', onError)
          }
          mp3Rec.addEventListener('start', onStart)
          mp3Rec.addEventListener('error', onError)
          mp3Rec.start()
        }),
        // Timeout — WASM worker silently hung (common on mobile)
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('MP3 recorder start timeout')),
            MP3_START_TIMEOUT_MS,
          )
        ),
      ])

      this.recorder = mp3Rec
      this.recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) this.chunks.push(e.data)
      }
      this.recorder.onerror = (evt: Event) => {
        console.error('[AudioRecorder] Mp3MediaRecorder error', evt)
        this.stopReject?.(new Error('MP3 encoding failed'))
        this.stopResolve = null
        this.stopReject = null
      }
      this.recorderMimeType = 'audio/mpeg'
      usedMp3 = true
    } catch (mp3Err) {
      console.warn('[AudioRecorder] mp3-mediarecorder failed, falling back to native MediaRecorder:', mp3Err)

      // Guard: cancel() may have been called during the 6s MP3 timeout,
      // nulling this.stream. Bail rather than crash the native fallback.
      if (!this.stream) return

      // ── Native MediaRecorder fallback ──────────────────────────
      const mime = nativeMimeType()
      const nativeRec = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream)

      await new Promise<void>((resolve, reject) => {
        const onStart = () => { cleanup(); resolve() }
        const onError = (e: Event) => {
          cleanup()
          reject(new Error(`Native recorder error: ${(e as ErrorEvent).message ?? 'unknown'}`))
        }
        const cleanup = () => {
          nativeRec.removeEventListener('start', onStart)
          nativeRec.removeEventListener('error', onError)
        }
        nativeRec.addEventListener('start', onStart)
        nativeRec.addEventListener('error', onError)
        nativeRec.start()
      })

      nativeRec.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) this.chunks.push(e.data)
      }
      nativeRec.onerror = (evt: Event) => {
        console.error('[AudioRecorder] native MediaRecorder error', evt)
        this.stopReject?.(new Error('Recording failed'))
        this.stopResolve = null
        this.stopReject = null
      }
      this.recorder = nativeRec
      this.recorderMimeType = nativeRec.mimeType || mime || 'audio/webm'
    }

    if (!usedMp3) {
      console.info('[AudioRecorder] Using native MediaRecorder, mimeType:', this.recorderMimeType)
    }

    this.startTime = performance.now()
    this.pauseOffset = 0
    this.updateState('recording')
    this.tick()
  }

  /** Pause recording. */
  pause(): void {
    if (this._state.status !== 'recording') return
    this.recorder?.pause()
    this.pauseOffset = this._state.elapsedMs
    cancelAnimationFrame(this.rafId)
    this.updateState('paused')
  }

  /** Resume from pause. */
  resume(): void {
    if (this._state.status !== 'paused') return
    this.recorder?.resume()
    this.startTime = performance.now()
    this.updateState('recording')
    this.tick()
  }

  /** Stop recording and return audio bytes + MIME type. */
  async stop(): Promise<{ audioBytes: Uint8Array; durationMs: number; mimeType: string }> {
    cancelAnimationFrame(this.rafId)
    const elapsed = this._state.elapsedMs
    const rec = this.recorder
    const mimeType = this.recorderMimeType

    if (!rec) {
      this.cleanup()
      this.updateState('stopped')
      throw new Error('No active recording')
    }

    // If the recorder already transitioned to 'inactive' (e.g. worker error),
    // return whatever chunks we collected rather than throwing.
    if (rec.state === 'inactive') {
      const blob = new Blob(this.chunks, { type: mimeType })
      const arrayBuffer = await blob.arrayBuffer()
      const audioBytes = new Uint8Array(arrayBuffer)
      this.cleanup()
      this.updateState('stopped')
      return { audioBytes, durationMs: elapsed, mimeType }
    }

    return new Promise<{ audioBytes: Uint8Array; durationMs: number; mimeType: string }>((resolve, reject) => {
      this.stopResolve = resolve
      this.stopReject = reject

      const onStop = async () => {
        rec.removeEventListener('stop', onStop)
        try {
          const blob = new Blob(this.chunks, { type: mimeType })
          const arrayBuffer = await blob.arrayBuffer()
          const audioBytes = new Uint8Array(arrayBuffer)

          this.cleanup()
          this.updateState('stopped')
          resolve({ audioBytes, durationMs: elapsed, mimeType })
        } catch (err) {
          this.cleanup()
          reject(err instanceof Error ? err : new Error(String(err)))
        } finally {
          this.stopResolve = null
          this.stopReject = null
        }
      }

      rec.addEventListener('stop', onStop)
      rec.stop()
    })
  }

  /** Cancel recording without producing output. */
  cancel(): void {
    cancelAnimationFrame(this.rafId)
    try {
      if (this.recorder && this.recorder.state !== 'inactive') {
        this.recorder.stop()
      }
    } catch { /* ignore */ }
    this.cleanup()
    this.updateState('idle')
  }

  // ── Internal helpers ──────────────────────────────────────────────

  private tick = () => {
    if (this._state.status !== 'recording') return
    const now = performance.now()
    const elapsed = this.pauseOffset + (now - this.startTime)

    // Compute RMS level from analyser
    let level = 0
    if (this.analyser && this.analyserData) {
      this.analyser.getByteTimeDomainData(this.analyserData)
      let sum = 0
      for (let i = 0; i < this.analyserData.length; i++) {
        const v = (this.analyserData[i] - 128) / 128
        sum += v * v
      }
      level = Math.sqrt(sum / this.analyserData.length)
    }

    this._state = { status: 'recording', elapsedMs: elapsed, level }
    this.opts.onStateChange(this._state)
    this.rafId = requestAnimationFrame(this.tick)
  }

  private updateState(status: RecorderState['status']) {
    this._state = { ...this._state, status }
    this.opts.onStateChange(this._state)
  }

  private cleanup(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.audioCtx?.close().catch(() => {})
    this.chunks = []
    this.stream = null
    this.audioCtx = null
    this.source = null
    this.recorder = null
    this.analyser = null
    this.analyserData = null
  }
}
