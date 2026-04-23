/**
 * pcm-processor.js — AudioWorklet processor (v2)
 *
 * Runs in the dedicated audio thread. Accumulates PCM frames and posts
 * them to the main thread at a configurable interval.
 *
 * Changes from v1:
 *  - Flush interval is configurable via MessagePort (no page reload needed)
 *  - Stereo → mono downmix is explicit (left+right averaged)
 *  - Reports a 'ready' message to the main thread when initialized
 *  - process() returns false once it receives a 'stop' command (clean shutdown)
 *
 * Messages TO this processor (main → worklet):
 *   { type: 'set_flush_every', value: <number> }   — set flush interval (frames)
 *   { type: 'stop' }                                — stop processing
 *
 * Messages FROM this processor (worklet → main):
 *   { type: 'ready' }                               — processor initialized
 *   { type: 'pcm', samples: Float32Array }          — audio data (zero-copy transfer)
 */

class PcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options)
    this._buffer      = []
    this._flushEvery  = 128    // process() calls between flushes (~2.9s at 44.1kHz)
    this._callCount   = 0
    this._running     = true

    this.port.onmessage = (e) => {
      const { type, value } = e.data ?? {}
      if (type === 'set_flush_every' && typeof value === 'number' && value > 0) {
        this._flushEvery = Math.round(value)
      }
      if (type === 'stop') {
        this._running = false
      }
    }

    // Notify the main thread that we're alive
    this.port.postMessage({ type: 'ready' })
  }

  process(inputs) {
    if (!this._running) return false   // returning false removes the node from the graph

    const input = inputs[0]
    if (!input || !input.length) return true

    // Downmix to mono: average all available channels
    const channelCount = input.length
    const frameLength  = input[0].length
    const mono         = new Float32Array(frameLength)

    for (let ch = 0; ch < channelCount; ch++) {
      const channel = input[ch]
      for (let i = 0; i < frameLength; i++) {
        mono[i] += channel[i] / channelCount
      }
    }

    this._buffer.push(mono)
    this._callCount++

    if (this._callCount >= this._flushEvery) {
      this._callCount = 0

      // Merge all buffered frames into a single Float32Array
      const totalSamples = this._buffer.reduce((n, b) => n + b.length, 0)
      const merged       = new Float32Array(totalSamples)
      let offset = 0
      for (const chunk of this._buffer) {
        merged.set(chunk, offset)
        offset += chunk.length
      }
      this._buffer = []

      // Transfer buffer ownership to main thread (zero-copy)
      this.port.postMessage({ type: 'pcm', samples: merged }, [merged.buffer])
    }

    return true
  }
}

registerProcessor('pcm-processor', PcmProcessor)
