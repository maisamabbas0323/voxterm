/**
 * Microphone capture for the voice pipeline.
 *
 * `getUserMedia` is the only thing that can reach the microphone, so capture
 * lives in the renderer; the main process only ever receives finished WAV
 * bytes. Samples are pulled through a ScriptProcessor (no extra worker module,
 * so the strict CSP needs no changes), level-metered for real, then resampled
 * to 16 kHz mono 16-bit PCM — a compact format ElevenLabs speech-to-text
 * accepts directly.
 */

export interface CaptureResult {
  /** Raw 16 kHz mono 16-bit PCM WAV bytes. */
  wav: ArrayBuffer
  durationMs: number
  sampleRate: number
}

export const CAPTURE_SAMPLE_RATE = 16_000
const PROCESSOR_SIZE = 4096

export class AudioCapture {
  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private processor: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private chunks: Float32Array[] = []
  private startedAt = 0
  private peakLevel = 0

  get isRecording(): boolean {
    return this.context !== null && this.stream !== null
  }

  /** Live input level (0..1) for the meter. Call while recording. */
  get level(): number {
    return this.peakLevel
  }

  get elapsedMs(): number {
    return this.isRecording ? Date.now() - this.startedAt : 0
  }

  /**
   * Ask main whether capture is permitted, then open the microphone.
   * Throws with a human-readable message on any failure (denied, no device,
   * insecure context).
   */
  async start(): Promise<void> {
    if (this.isRecording) return

    const access = await window.voxterm.voice.requestMicrophoneAccess()
    if (!access.allowed) {
      await window.voxterm.voice.requestMicrophoneAccess({ outcome: 'denied' }).catch(() => undefined)
      throw new Error(access.message ?? 'Microphone access is not available.')
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1
        },
        video: false
      })
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      const denied = name === 'NotAllowedError' || name === 'SecurityError'
      const missing = name === 'NotFoundError' || name === 'OverconstrainedError'
      if (denied) {
        await window.voxterm.voice.requestMicrophoneAccess({ outcome: 'denied' }).catch(() => undefined)
        throw new Error(
          'The operating system or browser denied microphone access. Allow VoxTerm to use the microphone in your system privacy settings.',
          { cause: error }
        )
      }
      if (missing) {
        throw new Error('No microphone input device was found.', { cause: error })
      }
      throw new Error(`Could not open the microphone: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error
      })
    }

    await window.voxterm.voice.requestMicrophoneAccess({ outcome: 'granted' }).catch(() => undefined)

    const context = new AudioContext()
    const source = context.createMediaStreamSource(stream)
    const processor = context.createScriptProcessor(PROCESSOR_SIZE, 1, 1)

    this.chunks = []
    this.peakLevel = 0
    this.startedAt = Date.now()

    processor.onaudioprocess = (event): void => {
      const input = event.inputBuffer.getChannelData(0)
      // Keep a private copy: the underlying buffer is reused by the audio thread.
      const copy = new Float32Array(input.length)
      copy.set(input)
      this.chunks.push(copy)

      let sum = 0
      for (let i = 0; i < copy.length; i++) sum += copy[i] * copy[i]
      const rms = Math.sqrt(sum / copy.length)
      // Smooth so the meter reads naturally instead of flickering per buffer.
      this.peakLevel = this.peakLevel * 0.7 + Math.min(1, rms * 4) * 0.3
    }

    // Loop back silently so the processor runs without producing output.
    const gain = context.createGain()
    gain.gain.value = 0
    source.connect(processor)
    processor.connect(gain)
    gain.connect(context.destination)

    this.context = context
    this.stream = stream
    this.processor = processor
    this.source = source
  }

  /** Stop recording and return the encoded WAV, or null when nothing captured. */
  async stop(): Promise<CaptureResult | null> {
    const durationMs = this.elapsedMs
    const { context, chunks } = this
    if (!context) return null

    const finalChunks = chunks
    this.teardown()

    if (finalChunks.length === 0) return null

    const flat = concat(finalChunks)
    const pcm = resample(flat, context.sampleRate, CAPTURE_SAMPLE_RATE)
    const wav = encodeWav(pcm, CAPTURE_SAMPLE_RATE)
    return { wav, durationMs, sampleRate: CAPTURE_SAMPLE_RATE }
  }

  /** Discard the current capture without producing bytes. */
  cancel(): void {
    this.teardown()
  }

  private teardown(): void {
    try {
      if (this.processor) this.processor.onaudioprocess = null
      this.source?.disconnect()
      this.processor?.disconnect()
    } catch {
      /* already disconnected */
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop()
    }
    if (this.context) {
      void this.context.close().catch(() => undefined)
    }
    this.context = null
    this.stream = null
    this.processor = null
    this.source = null
    this.chunks = []
    this.peakLevel = 0
  }
}

function concat(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** Linear-interpolation resample; good enough for speech sent for transcription. */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from <= 0 || to <= 0 || from === to) return input
  const ratio = from / to
  const outLength = Math.max(1, Math.floor(input.length / ratio))
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const position = i * ratio
    const index = Math.floor(position)
    const next = Math.min(index + 1, input.length - 1)
    const t = position - index
    out[i] = input[index] * (1 - t) + input[next] * t
  }
  return out
}

/** Encode mono float samples as a standard 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2
  const blockAlign = bytesPerSample
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // PCM fmt chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // bits per sample
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    offset += bytesPerSample
  }
  return buffer
}

function writeString(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
}
