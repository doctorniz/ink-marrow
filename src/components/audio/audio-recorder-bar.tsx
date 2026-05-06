'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Pause, Play, Square, X } from 'lucide-react'
import { AudioRecorder, type RecorderState } from '@/lib/audio/recorder'
import { cn } from '@/utils/cn'

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface AudioRecorderBarProps {
  /** Called with the audio bytes, duration, and MIME type when recording is complete. */
  onComplete: (audioBytes: Uint8Array, durationMs: number, mimeType: string) => void
  /** Called when the user cancels the recording. */
  onCancel: () => void
  /** Whether to auto-start recording on mount. Default true. */
  autoStart?: boolean
  className?: string
}

/**
 * Inline recording bar with record/stop/pause, elapsed timer,
 * and a live audio level indicator.
 */
export function AudioRecorderBar({
  onComplete,
  onCancel,
  autoStart = true,
  className,
}: AudioRecorderBarProps) {
  const recorderRef = useRef<AudioRecorder | null>(null)
  const [state, setState] = useState<RecorderState>({
    status: 'idle',
    elapsedMs: 0,
    level: 0,
  })
  const [error, setError] = useState<string | null>(null)
  const completeRef = useRef(onComplete)
  completeRef.current = onComplete

  useEffect(() => {
    const recorder = new AudioRecorder({
      onStateChange: setState,
    })
    recorderRef.current = recorder

    if (autoStart) {
      recorder.start().catch((err) => {
        console.error('Mic access failed:', err)
        setError('Microphone access denied')
      })
    }

    return () => {
      recorder.cancel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleStart = useCallback(() => {
    recorderRef.current?.start().catch((err) => {
      console.error('Mic access failed:', err)
      setError('Microphone access denied')
    })
  }, [])

  const handlePauseResume = useCallback(() => {
    const r = recorderRef.current
    if (!r) return
    if (r.state.status === 'recording') r.pause()
    else if (r.state.status === 'paused') r.resume()
  }, [])

  const handleStop = useCallback(() => {
    const r = recorderRef.current
    if (!r) return
    r.stop().then(({ audioBytes, durationMs, mimeType }) => {
      completeRef.current(audioBytes, durationMs, mimeType)
    }).catch((err) => {
      console.error('Recording stop failed:', err)
      setError('Failed to process recording')
    })
  }, [])

  const handleCancel = useCallback(() => {
    recorderRef.current?.cancel()
    onCancel()
  }, [onCancel])

  if (error) {
    return (
      <div className={cn('flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3', className)}>
        <Mic className="size-4 text-destructive" />
        <span className="text-sm text-destructive">{error}</span>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto rounded-md p-1 text-fg-muted hover:text-fg transition-colors"
          aria-label="Dismiss"
        >
          <X className="size-4" />
        </button>
      </div>
    )
  }

  const isRecording = state.status === 'recording'
  const isPaused = state.status === 'paused'
  const isIdle = state.status === 'idle'

  // Level visualization: 5 bars
  const levelBars = Array.from({ length: 5 }, (_, i) => {
    const threshold = (i + 1) / 6
    return state.level > threshold
  })

  return (
    <div className={cn(
      'flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors',
      isRecording
        ? 'border-red-300/60 bg-red-50/50 dark:border-red-800/40 dark:bg-red-950/20'
        : 'border-border bg-bg-secondary',
      className,
    )}>
      {/* Recording indicator */}
      <div className="flex items-center gap-2">
        {isRecording && (
          <div className="size-2 animate-pulse rounded-full bg-red-500" />
        )}
        {isPaused && (
          <div className="size-2 rounded-full bg-amber-500" />
        )}
        <span className="font-mono text-sm font-medium text-fg tabular-nums">
          {formatElapsed(state.elapsedMs)}
        </span>
      </div>

      {/* Level bars */}
      <div className="flex items-center gap-0.5">
        {levelBars.map((active, i) => (
          <div
            key={i}
            className={cn(
              'w-1 rounded-full transition-all duration-75',
              active ? 'bg-red-500' : 'bg-fg/10',
            )}
            style={{ height: `${8 + i * 3}px` }}
          />
        ))}
      </div>

      <div className="flex-1" />

      {/* Controls */}
      <div className="flex items-center gap-1.5">
        {isIdle ? (
          <button
            type="button"
            onClick={handleStart}
            className="flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600"
            aria-label="Start recording"
          >
            <Mic className="size-3.5" />
            Record
          </button>
        ) : (
          <>
            {/* Pause / Resume */}
            <button
              type="button"
              onClick={handlePauseResume}
              className="flex size-8 items-center justify-center rounded-lg border border-border bg-bg transition-colors hover:bg-bg-hover"
              aria-label={isRecording ? 'Pause' : 'Resume'}
            >
              {isRecording ? (
                <Pause className="size-3.5 text-fg" />
              ) : (
                <Play className="size-3.5 text-fg ml-0.5" />
              )}
            </button>

            {/* Stop (save) */}
            <button
              type="button"
              onClick={handleStop}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent/90"
              aria-label="Stop and save"
            >
              <Square className="size-3" fill="currentColor" />
              Done
            </button>
          </>
        )}

        {/* Cancel */}
        <button
          type="button"
          onClick={handleCancel}
          className="flex size-8 items-center justify-center rounded-lg text-fg-muted transition-colors hover:text-fg hover:bg-bg-hover"
          aria-label="Cancel recording"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
