'use client'
import { useState } from 'react'
import Avatar from './Avatar'

function Person({ p, i, onProfile, children }) {
  return (
    <div className="row" style={{ '--i': i }}>
      <Avatar url={p.avatar_url} name={p.display_name} onClick={() => onProfile(p)} />
      <div className="who">
        <span>{p.display_name}</span>
        <small># {p.public_id}</small>
      </div>
      <div className="acts">{children}</div>
    </div>
  )
}

export default function Friends({ friends, incoming, outgoing, actions, onProfile }) {
  const [id, setId] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  async function add(e) {
    e.preventDefault()
    const v = id.trim()
    if (!v) return
    setBusy(true)
    setMsg(null)
    const err = await actions.request(v)
    setBusy(false)
    if (err) setMsg({ err: true, text: err })
    else { setMsg({ text: 'Request sent' }); setId('') }
  }

  return (
    <div className="list pane">
      <form className="addbox" onSubmit={add}>
        <input value={id} onChange={e => setId(e.target.value)} placeholder="Friend ID" />
        <button disabled={busy}>Add</button>
      </form>
      {msg && <p className={`note ${msg.err ? 'err' : ''}`}>{msg.text}</p>}
      {incoming.length > 0 && <h5>Requests</h5>}
      {incoming.map((p, i) => (
        <Person key={p.id} p={p} i={i} onProfile={onProfile}>
          <button onClick={() => actions.accept(p.id)}>Accept</button>
          <button className="ghost" onClick={() => actions.remove(p.id)}>Decline</button>
        </Person>
      ))}
      {outgoing.length > 0 && <h5>Sent</h5>}
      {outgoing.map((p, i) => (
        <Person key={p.id} p={p} i={i} onProfile={onProfile}>
          <button className="ghost" onClick={() => actions.remove(p.id)}>Cancel</button>
        </Person>
      ))}
      <h5>Friends ({friends.length})</h5>
      {friends.length === 0 && <p className="note">No friends yet</p>}
      {friends.map((p, i) => (
        <Person key={p.id} p={p} i={i} onProfile={onProfile}>
          <button onClick={() => actions.message(p.id)}>Message</button>
          <button className="ghost danger" onClick={() => actions.remove(p.id)}>Remove</button>
        </Person>
      ))}
    </div>
  )
}
