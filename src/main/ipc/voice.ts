import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import type { MicrophoneAccessResult } from '@shared/api'
import type { TranscribeResult, VoiceStatus } from '@shared/types'
import type { Services } from '../services'
import { parseOrThrow } from './util'

/** Payload validators for the voice channels. */

const microphoneAccessSchema = z
  .object({ outcome: z.enum(['granted', 'denied']).optional() })
  .optional()

const startRecordingSchema = z
  .object({ source: z.enum(['manual', 'hotkey']).default('manual') })
  .optional()

const MAX_WAV_BYTES = 40 * 1024 * 1024

const stopRecordingSchema = z.object({
  // Electron structured-clone preserves typed arrays; accept either shape.
  wav: z.union([z.instanceof(Uint8Array), z.instanceof(ArrayBuffer)]),
  sampleRate: z.number().int().min(8000).max(192000),
  durationMs: z.number().int().min(0).max(60 * 60 * 1000)
})

function toBuffer(value: Uint8Array | ArrayBuffer): Buffer {
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
}

export function registerVoiceIpc(services: Services): void {
  ipcMain.handle(IPC.voiceStatus, (): VoiceStatus => services.voice.status)

  ipcMain.handle(
    IPC.voiceRequestMicrophonePermission,
    (_event, payload: unknown): Promise<MicrophoneAccessResult> => {
      const parsed = parseOrThrow(microphoneAccessSchema, payload ?? {})
      return services.voice.microphoneAccess(parsed?.outcome)
    }
  )

  ipcMain.handle(IPC.voiceStartRecording, (_event, payload: unknown) => {
    const parsed = parseOrThrow(startRecordingSchema, payload ?? {})
    return services.voice.begin(parsed?.source ?? 'manual')
  })

  ipcMain.handle(IPC.voiceStopRecording, async (_event, payload: unknown): Promise<TranscribeResult> => {
    const parsed = parseOrThrow(stopRecordingSchema, payload)
    const wav = toBuffer(parsed.wav)
    if (wav.byteLength === 0) {
      return {
        ok: false,
        text: '',
        language: null,
        confidence: null,
        audioMs: parsed.durationMs,
        inferenceMs: 0,
        code: 'invalid-audio',
        error: 'The recording contained no audio.'
      }
    }
    if (wav.byteLength > MAX_WAV_BYTES) {
      return {
        ok: false,
        text: '',
        language: null,
        confidence: null,
        audioMs: parsed.durationMs,
        inferenceMs: 0,
        code: 'invalid-audio',
        error: 'The recording was too large to transcribe.'
      }
    }
    return services.voice.finish({ wav, durationMs: parsed.durationMs })
  })

  ipcMain.handle(IPC.voiceCancelRecording, (): void => {
    services.voice.cancel()
  })
}
