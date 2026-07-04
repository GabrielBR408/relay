import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { audioManager, speak } from '../audio'
import { useRecorder } from '../hooks/useRecorder'
import Bubble from '../components/Bubble'
import type { ChannelListItem, ConsumeMode, Message, Profile } from '../types'

interface Props {
  item: ChannelListItem
  userId: string
  onBack: () => void
}

export default function ThreadScreen({ item, userId, onBack }: Props) {
  const { channel } = item
  const [messages, setMessages] = useState<Message[]>([])
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})
  const [receipts, setReceipts] = useState<Record<string, string[]>>({}) // message_id -> user_ids
  const [mode, setMode] = useState<ConsumeMode>(item.membership.mode)
  const [tts, setTts] = useState(item.membership.tts_enabled)
  const [draft, setDraft] = useState('')
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const { recording, elapsed, error: recError, start, stop } = useRecorder()
  const bottomRef = useRef<HTMLDivElement>(null)
  const modeRef = useRef(mode)
  const ttsRef = useRef(tts)
  modeRef.current = mode
  ttsRef.current = tts

  const showToast = (t: string) => {
    setToast(t)
    setTimeout(() => setToast(null), 2500)
  }

  // ---- load + realtime ----
  const loadProfiles = useCallback(async (ids: string[]) => {
    const missing = ids.filter((id) => !profiles[id])
    if (!missing.length) return
    const { data } = await supabase.from('profiles').select('id, display_name').in('id', missing)
    if (data) {
      setProfiles((p) => {
        const n = { ...p }
        for (const pr of data) n[pr.id] = pr as Profile
        return n
      })
    }
  }, [profiles])

  const markRead = useCallback(async (msgs: Message[]) => {
    const now = new Date().toISOString()
    await supabase
      .from('channel_members')
      .update({ last_read_at: now })
      .eq('channel_id', channel.id)
      .eq('user_id', userId)
    const others = msgs.filter((m) => m.sender_id !== userId)
    if (others.length) {
      await supabase.from('read_receipts').upsert(
        others.map((m) => ({ message_id: m.id, user_id: userId })),
        { onConflict: 'message_id,user_id', ignoreDuplicates: true },
      )
    }
  }, [channel.id, userId])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('channel_id', channel.id)
        .order('created_at', { ascending: true })
        .limit(300)
      if (!alive || !data) return
      setMessages(data as Message[])
      loadProfiles([...new Set(data.map((m: any) => m.sender_id))])
      markRead(data as Message[])

      const { data: rr } = await supabase
        .from('read_receipts')
        .select('message_id, user_id')
        .in('message_id', data.map((m: any) => m.id))
      if (rr && alive) {
        const map: Record<string, string[]> = {}
        for (const r of rr) (map[r.message_id] ??= []).push(r.user_id)
        setReceipts(map)
      }
    })()

    const sub = supabase
      .channel(`thread-${channel.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channel.id}` },
        (payload) => {
          const m = payload.new as Message
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
          loadProfiles([m.sender_id])
          if (m.sender_id !== userId) {
            markRead([m])
            if (m.type === 'audio' && modeRef.current === 'audio') {
              audioManager.enqueue(m)
            }
            if (m.type === 'text' && modeRef.current === 'audio' && ttsRef.current) {
              speak(m.text_content ?? '')
            }
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `channel_id=eq.${channel.id}` },
        (payload) => {
          const m = payload.new as Message
          setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)))
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'read_receipts' },
        (payload) => {
          const r = payload.new as { message_id: string; user_id: string }
          setReceipts((prev) => {
            const cur = prev[r.message_id] ?? []
            if (cur.includes(r.user_id)) return prev
            return { ...prev, [r.message_id]: [...cur, r.user_id] }
          })
        },
      )
      .subscribe()

    return () => {
      alive = false
      supabase.removeChannel(sub)
      audioManager.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id])

  useEffect(() => audioManager.subscribe((id, p) => { setPlayingId(id); setProgress(p) }), [])

  // Prime audio playback on the first user touch so the auto-play queue
  // isn't blocked by mobile autoplay policies.
  useEffect(() => {
    const unlock = () => audioManager.unlock()
    document.addEventListener('pointerdown', unlock, { once: true })
    return () => document.removeEventListener('pointerdown', unlock)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // ---- actions ----
  async function sendText() {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    const { error } = await supabase.from('messages').insert({
      channel_id: channel.id,
      sender_id: userId,
      type: 'text',
      text_content: text,
    })
    if (error) showToast('Send failed — retry')
  }

  async function finishRecording() {
    const result = await stop()
    if (!result) return
    if (result.durationMs < 400) {
      showToast('Hold to talk')
      return
    }
    setSending(true)
    try {
      const ext = result.mimeType.includes('mp4') ? 'm4a' : result.mimeType.includes('ogg') ? 'ogg' : 'webm'
      const path = `${channel.id}/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('clips')
        .upload(path, result.blob, { contentType: result.mimeType })
      if (upErr) throw upErr

      const hasLocalTranscript = result.transcript.length > 0
      const { data: msg, error: insErr } = await supabase
        .from('messages')
        .insert({
          channel_id: channel.id,
          sender_id: userId,
          type: 'audio',
          audio_path: path,
          duration_ms: result.durationMs,
          transcript: hasLocalTranscript ? result.transcript : null,
          transcript_status: hasLocalTranscript ? 'done' : 'pending',
        })
        .select()
        .single()
      if (insErr) throw insErr

      if (!hasLocalTranscript && msg) {
        // Server-side fallback (Whisper when key present, labeled stub otherwise)
        supabase.functions.invoke('transcribe', { body: { message_id: msg.id } }).catch(() => {})
      }
    } catch {
      showToast('Upload failed — check connection')
    } finally {
      setSending(false)
    }
  }

  async function switchMode(next: ConsumeMode) {
    setMode(next)
    if (next === 'text') audioManager.stop()
    await supabase
      .from('channel_members')
      .update({ mode: next })
      .eq('channel_id', channel.id)
      .eq('user_id', userId)
  }

  async function toggleTts() {
    const next = !tts
    setTts(next)
    await supabase
      .from('channel_members')
      .update({ tts_enabled: next })
      .eq('channel_id', channel.id)
      .eq('user_id', userId)
  }

  function copyInvite() {
    navigator.clipboard?.writeText(channel.invite_code)
    showToast(`Invite code ${channel.invite_code} copied`)
  }

  // ---- render ----
  return (
    <div className="screen thread">
      <header className="bar">
        <button className="ghost back" onClick={onBack}>‹</button>
        <div className="bar-title" onClick={copyInvite} title="Copy invite code">
          <h2>{channel.name}</h2>
          <span className="sub">code {channel.invite_code} · tap to copy</span>
        </div>
        <div className="mode-ctl">
          <button
            className={`mode-btn ${mode === 'audio' ? 'on' : ''}`}
            onClick={() => switchMode('audio')}
            title="Audio mode: incoming voice auto-plays"
          >
            🔊
          </button>
          <button
            className={`mode-btn ${mode === 'text' ? 'on' : ''}`}
            onClick={() => switchMode('text')}
            title="Text mode: silent, read transcripts"
          >
            💬
          </button>
          {mode === 'audio' && (
            <button
              className={`mode-btn tts ${tts ? 'on' : ''}`}
              onClick={toggleTts}
              title="Read incoming text aloud"
            >
              🗣
            </button>
          )}
        </div>
      </header>

      <div className="msgs">
        {messages.length === 0 && (
          <div className="empty">
            Say something — hold the mic button to transmit,
            <br />or type below. Share code <b>{channel.invite_code}</b> to invite.
          </div>
        )}
        {messages.map((m) => (
          <Bubble
            key={m.id}
            msg={m}
            mine={m.sender_id === userId}
            senderName={profiles[m.sender_id]?.display_name ?? '…'}
            readByOthers={(receipts[m.id] ?? []).some((u) => u !== userId)}
            playing={playingId === m.id}
            progress={playingId === m.id ? progress : 0}
            defaultShowTranscript={mode === 'text'}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {toast && <div className="toast">{toast}</div>}
      {recError && <div className="toast">{recError}</div>}

      <footer className="composer">
        <input
          placeholder={mode === 'text' ? 'Type a message…' : 'Type, or hold mic to talk'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendText()}
        />
        {draft.trim() ? (
          <button className="send" onClick={sendText}>➤</button>
        ) : (
          <button
            className={`ptt ${recording ? 'rec' : ''} ${sending ? 'busy' : ''}`}
            onPointerDown={(e) => {
              e.preventDefault()
              ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
              start()
            }}
            onPointerUp={finishRecording}
            onPointerCancel={finishRecording}
            onContextMenu={(e) => e.preventDefault()}
          >
            {sending ? '…' : recording ? `● ${(elapsed / 1000).toFixed(1)}s` : '🎙'}
          </button>
        )}
      </footer>
      {recording && (
        <div className="rec-overlay">
          <div className="rec-pulse" />
          Transmitting… release to send
        </div>
      )}
    </div>
  )
}
