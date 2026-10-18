import type { TranscribeResult, VoiceStatus } from '@shared/types'
import { AudioCapture } from './capture'

/**
 * Renderer-side voice pipeline: microphone → ElevenLabs speech-to-text → text.
 *
 * It owns one recording at a time and reports every phase honestly. Nothing
 * here ever runs a transcript — inserting text into a terminal is always a
 * separate, explicit user action.
 */

export type VoicePhase = 'idle' | 'recording' | 'transcribing'

export interface VoicePipelineState {
  phase: VoicePhase
  /** Input level 0..1 for the meter (real microphone energy). */
  level: number
  /** Elapsed capture time in milliseconds. */
  durationMs: number
  /** Last failure to show inline; null when healthy. */
  error: string | null
}

type Listener = (state: VoicePipelineState) => void

export class VoicePipeline {
  private readonly capture = new AudioCapture()
  private state: VoicePipelineState = { phase: 'idle', level: 0, durationMs: 0, error: null }
  private listeners = new Set<Listener>()
  private meterFrame = 0
  private running: Promise<void> | null = null

  /** Set once by the app shell to receive each finished transcription. */
  onResult: ((result: TranscribeResult) => void) | null = null

  get snapshot(): VoicePipelineState {
    return { ...this.state }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener({ ...this.state })
    return () => this.listeners.delete(listener)
  }

  private update(patch: Partial<VoicePipelineState>): void {
    this.state = { ...this.state, ...patch }
    const snapshot = { ...this.state }
    for (const listener of this.listeners) listener(snapshot)
  }

  /**
   * Begin a capture. Safe to call from a hotkey or a button: a press while
   * already recording is ignored so push-to-talk cannot double-start.
   */
  start(source: 'manual' | 'hotkey' = 'manual'): Promise<void> {
    if (this.state.phase !== 'idle' || this.running) return Promise.resolve()
    this.update({ phase: 'recording', level: 0, durationMs: 0, error: null })
    this.startMeter()

    this.running = (async () => {
      try {
        await this.capture.start()
        const result = await window.voxterm.voice.startRecording({ source })
        if (!result.ok) {
          this.capture.cancel()
          this.update({ phase: 'idle', level: 0, durationMs: 0, error: result.message ?? 'Recording could not start.' })
        }
      } catch (error) {
        this.capture.cancel()
        this.update({
          phase: 'idle',
          level: 0,
          durationMs: 0,
          error: error instanceof Error ? error.message : String(error)
        })
      } finally {
        this.running = null
        this.stopMeter()
      }
    })()
    return this.running
  }

  /** End the capture and hand it to the main process for transcription. */
  stop(): Promise<void> {
    if (this.state.phase !== 'recording' || this.running) return Promise.resolve()
    this.running = (async () => {
      try {
        const capture = await this.capture.stop()
        if (!capture) {
          await window.voxterm.voice.cancelRecording()
          this.update({ phase: 'idle', level: 0, durationMs: 0, error: 'No audio was captured.' })
          return
        }
        this.update({ phase: 'transcribing', durationMs: capture.durationMs, level: 0 })
        const result = await window.voxterm.voice.stopRecording({
          wav: capture.wav,
          sampleRate: capture.sampleRate,
          durationMs: capture.durationMs
        })
        this.update({ phase: 'idle', level: 0, durationMs: 0, error: result.ok ? null : (result.error ?? null) })
        this.onResult?.(result)
      } catch (error) {
        this.update({
          phase: 'idle',
          level: 0,
          durationMs: 0,
          error: error instanceof Error ? error.message : String(error)
        })
      } finally {
        this.running = null
        this.stopMeter()
      }
    })()
    return this.running
  }

  /** Throw the current recording away without transcribing it. */
  cancel(): void {
    this.capture.cancel()
    void window.voxterm.voice.cancelRecording().catch(() => undefined)
    this.update({ phase: 'idle', level: 0, durationMs: 0, error: null })
    this.stopMeter()
  }

  /** Hotkey bridge: a genuine press starts, a release stops (toggle flips). */
  handleHotkey(payload: { pressed: boolean }, status: VoiceStatus | null): void {
    if (!status?.enabled) return
    if (payload.pressed && this.state.phase === 'idle') void this.start('hotkey')
    if (!payload.pressed && this.state.phase === 'recording') void this.stop()
  }

  private startMeter(): void {
    this.stopMeter()
    const tick = (): void => {
      if (this.state.phase !== 'recording') return
      this.update({
        level: this.capture.level,
        durationMs: this.capture.elapsedMs
      })
      this.meterFrame = requestAnimationFrame(tick)
    }
    this.meterFrame = requestAnimationFrame(tick)
  }

  private stopMeter(): void {
    if (this.meterFrame) cancelAnimationFrame(this.meterFrame)
    this.meterFrame = 0
  }

  /** Release the microphone on unmount/application shutdown. */
  dispose(): void {
    this.cancel()
  }
}

export const voicePipeline = new VoicePipeline()
