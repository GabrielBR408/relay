// Push-to-talk recorder: MediaRecorder + (when available) Web Speech API
// live transcription running in parallel.
import { useCallback, useRef, useState } from 'react'

export interface RecordingResult {
  blob: Blob
  mimeType: string
  durationMs: number
  transcript: string // '' when speech recognition unavailable / heard nothing
  speechAvailable: boolean
}

const SpeechRec: any =
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

function pickMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c
  }
  return ''
}

export function useRecorder() {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAt = useRef(0)
  const timerRef = useRef(0)
  const speechRef = useRef<any>(null)
  const transcriptRef = useRef('')
  const streamRef = useRef<MediaStream | null>(null)

  const start = useCallback(async () => {
    setError(null)
    transcriptRef.current = ''
    chunksRef.current = []
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = pickMime()
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.start(250)
      recRef.current = rec
      startedAt.current = Date.now()
      setElapsed(0)
      timerRef.current = window.setInterval(
        () => setElapsed(Date.now() - startedAt.current),
        200,
      )

      if (SpeechRec) {
        try {
          const sr = new SpeechRec()
          sr.continuous = true
          sr.interimResults = false
          sr.lang = navigator.language || 'en-US'
          sr.onresult = (e: any) => {
            for (let i = e.resultIndex; i < e.results.length; i++) {
              if (e.results[i].isFinal) {
                transcriptRef.current += e.results[i][0].transcript + ' '
              }
            }
          }
          sr.onerror = () => {}
          sr.start()
          speechRef.current = sr
        } catch {
          speechRef.current = null
        }
      }
      setRecording(true)
      return true
    } catch (e: any) {
      setError(e?.name === 'NotAllowedError' ? 'Mic permission denied' : 'Mic unavailable')
      return false
    }
  }, [])

  const stop = useCallback((): Promise<RecordingResult | null> => {
    return new Promise((resolve) => {
      const rec = recRef.current
      clearInterval(timerRef.current)
      setRecording(false)
      if (!rec || rec.state === 'inactive') {
        streamRef.current?.getTracks().forEach((t) => t.stop())
        resolve(null)
        return
      }
      const durationMs = Date.now() - startedAt.current

      // Give speech recognition a beat to flush its final result.
      const sr = speechRef.current
      speechRef.current = null
      if (sr) {
        try { sr.stop() } catch { /* noop */ }
      }

      rec.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        const mimeType = rec.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: mimeType })
        // small delay so late speech results land in transcriptRef
        setTimeout(() => {
          resolve({
            blob,
            mimeType,
            durationMs,
            transcript: transcriptRef.current.trim(),
            speechAvailable: !!SpeechRec,
          })
        }, sr ? 600 : 0)
      }
      try {
        rec.stop()
      } catch {
        resolve(null)
      }
      recRef.current = null
    })
  }, [])

  return { recording, elapsed, error, start, stop }
}
