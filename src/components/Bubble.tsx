import { useEffect, useState } from 'react'
import { audioManager, getPeaks } from '../audio'
import type { Message } from '../types'

interface Props {
  msg: Message
  mine: boolean
  senderName: string
  readByOthers: boolean
  playing: boolean
  progress: number
  defaultShowTranscript: boolean
}

function fmtDur(ms: number | null): string {
  const s = Math.max(1, Math.round((ms ?? 0) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function Bubble({
  msg, mine, senderName, readByOthers, playing, progress, defaultShowTranscript,
}: Props) {
  const [showT, setShowT] = useState(defaultShowTranscript)
  const [peaks, setPeaks] = useState<number[] | null>(null)

  useEffect(() => {
    setShowT(defaultShowTranscript)
  }, [defaultShowTranscript])

  useEffect(() => {
    if (msg.type === 'audio' && msg.audio_path) {
      getPeaks(msg.audio_path).then(setPeaks)
    }
  }, [msg.audio_path, msg.type])

  const transcriptBlock = () => {
    if (msg.transcript_status === 'pending')
      return <div className="transcript pending">Transcribing…</div>
    if (msg.transcript_status === 'failed')
      return <div className="transcript failed">Transcription failed — audio still playable</div>
    if (msg.transcript_status === 'done' && msg.transcript)
      return <div className="transcript">{msg.transcript}</div>
    return null
  }

  return (
    <div className={`bubble-row ${mine ? 'mine' : ''}`}>
      <div className={`bubble ${msg.type}`}>
        {!mine && <div className="sender">{senderName}</div>}
        {msg.type === 'text' ? (
          <div className="text-body">{msg.text_content}</div>
        ) : (
          <>
            <div className="audio-line">
              <button
                className={`play ${playing ? 'on' : ''}`}
                onClick={() => audioManager.play(msg)}
                aria-label={playing ? 'Stop' : 'Play'}
              >
                {playing ? '■' : '▶'}
              </button>
              <div className="wave">
                {(peaks ?? Array(28).fill(0.25)).map((p, i) => (
                  <span
                    key={i}
                    style={{ height: `${Math.round(p * 26)}px` }}
                    className={playing && i / 28 <= progress ? 'lit' : ''}
                  />
                ))}
              </div>
              <span className="dur">{fmtDur(msg.duration_ms)}</span>
              <button
                className={`t-toggle ${showT ? 'on' : ''}`}
                onClick={() => setShowT((v) => !v)}
                title="Toggle transcript"
              >
                Aa
              </button>
            </div>
            {showT && transcriptBlock()}
          </>
        )}
        <div className="meta">
          {fmtTime(msg.created_at)}
          {mine && <span className="ticks">{readByOthers ? ' ✓✓ Read' : ' ✓ Delivered'}</span>}
        </div>
      </div>
    </div>
  )
}
