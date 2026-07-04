// Global audio playback manager: single element, sequential auto-play queue,
// and TTS for text messages.
import { clipUrl } from './lib/supabase'
import type { Message } from './types'

type Listener = (playingId: string | null, progress: number) => void

class AudioManager {
  private el: HTMLAudioElement = new Audio()
  private queue: Message[] = []
  private current: Message | null = null
  private listeners = new Set<Listener>()
  private raf = 0

  constructor() {
    this.el.onended = () => this.next()
    this.el.onerror = () => this.next()
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    const p = this.el.duration ? this.el.currentTime / this.el.duration : 0
    this.listeners.forEach((fn) => fn(this.current?.id ?? null, p))
  }

  private tick = () => {
    this.emit()
    if (this.current) this.raf = requestAnimationFrame(this.tick)
  }

  get playingId(): string | null {
    return this.current?.id ?? null
  }

  private unlocked = false

  /** Call from any user gesture: primes the audio element so later
   *  programmatic (auto-play queue) playback isn't blocked. */
  unlock() {
    if (this.unlocked || this.current) return
    this.unlocked = true
    const silence =
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='
    this.el.src = silence
    this.el.play().catch(() => {
      this.unlocked = false
    })
  }

  /** Play one message now (manual tap). Clears nothing from the queue. */
  play(msg: Message) {
    if (!msg.audio_path) return
    if (this.current?.id === msg.id) {
      this.stop()
      return
    }
    this.current = msg
    this.el.src = clipUrl(msg.audio_path)
    this.el.play().catch(() => {
      this.current = null
      this.emit()
    })
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(this.tick)
    this.emit()
  }

  /** Queue for walkie-talkie auto-play; starts immediately if idle. */
  enqueue(msg: Message) {
    if (this.current) {
      this.queue.push(msg)
    } else {
      this.play(msg)
    }
  }

  stop() {
    this.el.pause()
    this.current = null
    this.queue = []
    cancelAnimationFrame(this.raf)
    this.emit()
  }

  private next() {
    this.current = null
    const nxt = this.queue.shift()
    if (nxt) {
      this.play(nxt)
    } else {
      cancelAnimationFrame(this.raf)
      this.emit()
    }
  }
}

export const audioManager = new AudioManager()

export function speak(text: string) {
  try {
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.05
    window.speechSynthesis.speak(u)
  } catch {
    // TTS unavailable — silently skip
  }
}

// ---- waveform peak extraction (cached) ----
const peakCache = new Map<string, number[]>()

export async function getPeaks(path: string, bars = 28): Promise<number[]> {
  const hit = peakCache.get(path)
  if (hit) return hit
  try {
    const res = await fetch(clipUrl(path))
    const buf = await res.arrayBuffer()
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    const ctx = new Ctx()
    const decoded = await ctx.decodeAudioData(buf)
    const data = decoded.getChannelData(0)
    const block = Math.floor(data.length / bars) || 1
    const peaks: number[] = []
    for (let i = 0; i < bars; i++) {
      let max = 0
      for (let j = i * block; j < (i + 1) * block && j < data.length; j++) {
        const v = Math.abs(data[j])
        if (v > max) max = v
      }
      peaks.push(max)
    }
    const top = Math.max(...peaks, 0.01)
    const norm = peaks.map((p) => Math.max(0.12, p / top))
    ctx.close()
    peakCache.set(path, norm)
    return norm
  } catch {
    const flat = Array.from({ length: bars }, (_, i) => 0.3 + 0.4 * Math.abs(Math.sin(i)))
    peakCache.set(path, flat)
    return flat
  }
}
