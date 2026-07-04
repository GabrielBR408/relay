import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Channel, ChannelListItem, Membership } from '../types'

interface Props {
  userId: string
  displayName: string
  onOpen: (item: ChannelListItem) => void
  onSignOut: () => void
  onRename: (name: string) => void
}

export default function ChannelsScreen({ userId, displayName, onOpen, onSignOut, onRename }: Props) {
  const [items, setItems] = useState<ChannelListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(displayName)

  const load = useCallback(async () => {
    const { data: rows, error } = await supabase
      .from('channel_members')
      .select('channel_id, user_id, mode, tts_enabled, last_read_at, channels(id, name, invite_code, created_by)')
      .eq('user_id', userId)
    if (error || !rows) {
      setLoading(false)
      return
    }
    const list: ChannelListItem[] = []
    for (const r of rows as any[]) {
      if (!r.channels) continue
      const membership: Membership = {
        channel_id: r.channel_id,
        user_id: r.user_id,
        mode: r.mode,
        tts_enabled: r.tts_enabled,
        last_read_at: r.last_read_at,
      }
      const [{ count: unread }, { count: members }] = await Promise.all([
        supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('channel_id', r.channel_id)
          .neq('sender_id', userId)
          .gt('created_at', r.last_read_at),
        supabase
          .from('channel_members')
          .select('user_id', { count: 'exact', head: true })
          .eq('channel_id', r.channel_id),
      ])
      list.push({
        channel: r.channels as Channel,
        membership,
        unread: unread ?? 0,
        memberCount: members ?? 0,
      })
    }
    list.sort((a, b) => a.channel.name.localeCompare(b.channel.name))
    setItems(list)
    setLoading(false)
  }, [userId])

  useEffect(() => {
    load()
    const sub = supabase
      .channel('list-updates')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(sub)
    }
  }, [load])

  async function createChannel() {
    setErr(null)
    const name = newName.trim()
    if (!name) return
    const { data: ch, error } = await supabase
      .from('channels')
      .insert({ name, created_by: userId })
      .select()
      .single()
    if (error || !ch) {
      setErr(error?.message ?? 'Could not create channel')
      return
    }
    const defMode = (localStorage.getItem('relay-default-mode') as 'audio' | 'text') || 'audio'
    await supabase.from('channel_members').insert({ channel_id: ch.id, user_id: userId, mode: defMode })
    setNewName('')
    setShowNew(false)
    await load()
  }

  async function joinChannel() {
    setErr(null)
    const code = joinCode.trim().toLowerCase()
    if (!code) return
    const { error } = await supabase.rpc('join_channel', { code })
    if (error) {
      setErr('Invalid invite code')
      return
    }
    setJoinCode('')
    setShowNew(false)
    await load()
  }

  async function saveName() {
    const n = nameDraft.trim()
    if (n && n !== displayName) {
      await supabase.from('profiles').update({ display_name: n }).eq('id', userId)
      onRename(n)
    }
    setEditingName(false)
  }

  return (
    <div className="screen">
      <header className="bar">
        <div>
          <h2>Relay</h2>
          {editingName ? (
            <span className="me-edit">
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
              <button onClick={saveName}>✓</button>
            </span>
          ) : (
            <button className="me" onClick={() => { setNameDraft(displayName); setEditingName(true) }}>
              {displayName} ✎
            </button>
          )}
        </div>
        <button className="ghost" onClick={onSignOut}>Sign out</button>
      </header>

      <div className="list">
        {loading && <div className="empty">Loading…</div>}
        {!loading && items.length === 0 && (
          <div className="empty">
            No channels yet.
            <br />
            Create one, or join with an invite code.
          </div>
        )}
        {items.map((it) => (
          <button key={it.channel.id} className="channel-row" onClick={() => onOpen(it)}>
            <div className="ch-avatar">{it.channel.name.slice(0, 1).toUpperCase()}</div>
            <div className="ch-main">
              <div className="ch-name">{it.channel.name}</div>
              <div className="ch-sub">
                {it.memberCount} member{it.memberCount === 1 ? '' : 's'} · code {it.channel.invite_code}
              </div>
            </div>
            {it.unread > 0 && <span className="badge">{it.unread}</span>}
          </button>
        ))}
      </div>

      {showNew ? (
        <div className="new-panel">
          <div className="np-row">
            <input
              placeholder="New channel name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createChannel()}
            />
            <button className="primary" onClick={createChannel}>Create</button>
          </div>
          <div className="np-or">— or —</div>
          <div className="np-row">
            <input
              placeholder="Invite code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && joinChannel()}
            />
            <button className="primary" onClick={joinChannel}>Join</button>
          </div>
          {err && <div className="err">{err}</div>}
          <button className="ghost" onClick={() => setShowNew(false)}>Cancel</button>
        </div>
      ) : (
        <button className="fab" onClick={() => setShowNew(true)}>＋</button>
      )}
    </div>
  )
}
