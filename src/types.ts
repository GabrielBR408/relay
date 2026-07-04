export type ConsumeMode = 'audio' | 'text'

export interface Profile {
  id: string
  display_name: string
}

export interface Channel {
  id: string
  name: string
  invite_code: string
  created_by: string
}

export interface Membership {
  channel_id: string
  user_id: string
  mode: ConsumeMode
  tts_enabled: boolean
  last_read_at: string
}

export interface Message {
  id: string
  channel_id: string
  sender_id: string
  type: 'audio' | 'text'
  text_content: string | null
  audio_path: string | null
  duration_ms: number | null
  transcript: string | null
  transcript_status: 'none' | 'pending' | 'done' | 'failed'
  created_at: string
}

export interface ChannelListItem {
  channel: Channel
  membership: Membership
  unread: number
  memberCount: number
}
