'use client'
import { useEffect, useState } from 'react'
import { supabase, initialUrlParams } from '../lib/supabase'

// Supabase puts confirmation problems in the URL hash (#error=...&error_code=otp_expired)
function linkProblem() {
  const q = new URLSearchParams(initialUrlParams.replace(/^[#?]/, ''))
  const code = q.get('error_code') || q.get('error')
  if (!code) return ''
  window.history.replaceState(null, '', window.location.pathname)
  if (code === 'otp_expired' || code === 'access_denied') {
    return 'That confirmation link expired or was already used. If you already clicked it, just sign in. Otherwise press "Resend confirmation email".'
  }
  return q.get('error_description')?.replace(/\+/g, ' ') || 'Could not confirm the email'
}

function friendly(error) {
  const m = error.message || ''
  if (/not confirmed/i.test(m)) return { text: 'Confirm your email first, check your inbox (and spam).', resend: true }
  if (/rate limit/i.test(m)) return { text: 'Too many emails sent, wait a few minutes and try again.' }
  if (/invalid login/i.test(m)) return { text: 'Wrong email or password.' }
  if (/already registered/i.test(m)) return { text: 'This email already has an account, sign in instead.' }
  return { text: m }
}

export default function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signup, setSignup] = useState(false)
  const [msg, setMsg] = useState({ text: '', ok: false, resend: false })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const t = linkProblem()
    if (t) setMsg({ text: t, ok: false, resend: true })
  }, [])

  const redirect = () => window.location.origin

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setMsg({ text: '', ok: false, resend: false })
    const creds = { email: email.trim(), password }

    if (!signup) {
      const { error } = await supabase.auth.signInWithPassword(creds)
      if (error) setMsg({ ok: false, resend: false, ...friendly(error) })
      setBusy(false)
      return
    }

    const { data, error } = await supabase.auth.signUp({ ...creds, options: { emailRedirectTo: redirect() } })
    setBusy(false)
    if (error) return setMsg({ ok: false, resend: false, ...friendly(error) })
    // with "Confirm email" on, an existing address comes back as a user with no identities
    if (data.user && data.user.identities?.length === 0) {
      return setMsg({ text: 'This email already has an account, sign in instead.', ok: false, resend: false })
    }
    // no session means the project waits for the email confirmation
    if (!data.session) {
      setMsg({ text: 'Account created. We sent a confirmation link to your email, open it on this device and you will be signed in.', ok: true, resend: true })
    }
  }

  async function resend() {
    if (!email.trim()) return setMsg({ text: 'Type your email above first.', ok: false, resend: true })
    setBusy(true)
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: redirect() } })
    setBusy(false)
    setMsg(error
      ? { ok: false, resend: true, ...friendly(error) }
      : { text: 'Confirmation email sent again.', ok: true, resend: true })
  }

  return (
    <form className="auth" onSubmit={submit}>
      <h2>{signup ? 'Create account' : 'Sign in'}</h2>
      <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
      <input
        type="password"
        placeholder="Password (min 6)"
        value={password}
        onChange={e => setPassword(e.target.value)}
        required
        minLength={6}
        autoComplete={signup ? 'new-password' : 'current-password'}
      />
      <button disabled={busy}>{busy ? 'Please wait...' : signup ? 'Register' : 'Sign in'}</button>
      <button type="button" className="ghost" onClick={() => { setSignup(!signup); setMsg({ text: '', ok: false, resend: false }) }}>
        {signup ? 'I have an account' : 'Create account'}
      </button>
      {msg.text && <small className={msg.ok ? 'okmsg' : 'err'}>{msg.text}</small>}
      {msg.resend && <button type="button" className="ghost" disabled={busy} onClick={resend}>Resend confirmation email</button>}
    </form>
  )
}
