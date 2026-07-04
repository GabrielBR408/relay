import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res =
      mode === 'signup'
        ? await supabase.auth.signUp({
            email,
            password,
            options: { data: { display_name: name.trim() || email.split('@')[0] } },
          })
        : await supabase.auth.signInWithPassword({ email, password })
    if (res.error) setError(res.error.message)
    setBusy(false)
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="logo-row">
          <span className="logo-dot" />
          <h1>Relay</h1>
        </div>
        <p className="tagline">Walkie-talkie group chat, with everything transcribed.</p>
        <div className="tabs">
          <button className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>
            Sign up
          </button>
          <button className={mode === 'signin' ? 'on' : ''} onClick={() => setMode('signin')}>
            Sign in
          </button>
        </div>
        <form onSubmit={submit}>
          {mode === 'signup' && (
            <input
              placeholder="Display name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="nickname"
            />
          )}
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Password (6+ chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />
          {error && <div className="err">{error}</div>}
          <button className="primary" disabled={busy}>
            {busy ? '…' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </form>
        <p className="hint">
          Test tip: use two emails (e.g. you+a@gmail.com / you+b@gmail.com) on two devices.
        </p>
      </div>
    </div>
  )
}
