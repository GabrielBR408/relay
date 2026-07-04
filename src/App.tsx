import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import AuthScreen from './screens/Auth'
import ChannelsScreen from './screens/Channels'
import ThreadScreen from './screens/Thread'
import type { ChannelListItem } from './types'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [open, setOpen] = useState<ChannelListItem | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (!s) setOpen(null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    supabase
      .from('profiles')
      .select('display_name')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setDisplayName(data?.display_name ?? 'Me'))
  }, [session])

  if (!ready) return <div className="boot">Relay</div>
  if (!session) return <AuthScreen />

  if (open) {
    return (
      <ThreadScreen
        item={open}
        userId={session.user.id}
        onBack={() => setOpen(null)}
      />
    )
  }

  return (
    <ChannelsScreen
      userId={session.user.id}
      displayName={displayName}
      onOpen={setOpen}
      onSignOut={() => supabase.auth.signOut()}
      onRename={setDisplayName}
    />
  )
}
