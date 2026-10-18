'use client'
import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signup, setSignup] = useState(false)
  const [msg, setMsg] = useState('')

  async function submit(e) {
    e.preventDefault()
    setMsg('')
    const creds = { email, password }
    const { error } = signup
      ? await supabase.auth.signUp(creds)
      : await supabase.auth.signInWithPassword(creds)
    if (error) setMsg(error.message)
  }

  return (
    <form className="auth" onSubmit={submit}>
      <h2>{signup ? 'Create account' : 'Sign in'}</h2>
      <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
      <input type="password" placeholder="Password (min 6)" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
      <button>{signup ? 'Register' : 'Sign in'}</button>
      <button type="button" className="ghost" onClick={() => setSignup(!signup)}>
        {signup ? 'I have an account' : 'Create account'}
      </button>
      {msg && <small>{msg}</small>}
    </form>
  )
}
