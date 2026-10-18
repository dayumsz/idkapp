'use client'
import { useState } from 'react'
import Modal from './Modal'
import Avatar from './Avatar'

export default function NewGroup({ friends, onCreate, onClose }) {
  const [name, setName] = useState('')
  const [sel, setSel] = useState([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const toggle = id => setSel(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]))

  async function create() {
    setBusy(true)
    setErr('')
    const e = await onCreate(name, sel)
    setBusy(false)
    if (e) setErr(e)
  }

  return (
    <Modal onClose={onClose}>
      {close => (
        <>
          <h3>New group</h3>
          <input value={name} maxLength={40} onChange={e => setName(e.target.value)} placeholder="Group name" />
          <h5 className="flat">Members (friends only)</h5>
          <div className="pick">
            {friends.length === 0 && <p className="note">Add friends first</p>}
            {friends.map((f, i) => (
              <div key={f.id} className={`opt ${sel.includes(f.id) ? 'on' : ''}`} style={{ '--i': i }} onClick={() => toggle(f.id)}>
                <Avatar url={f.avatar_url} name={f.display_name} size={28} />
                <span>{f.display_name}</span>
                <i className="box" />
              </div>
            ))}
          </div>
          {err && <small className="err">{err}</small>}
          <button disabled={busy || !name.trim()} onClick={create}>Create group</button>
          <button className="ghost" onClick={close}>Cancel</button>
        </>
      )}
    </Modal>
  )
}
