'use client'
import { useState } from 'react'
import Modal from './Modal'
import Avatar from './Avatar'

export default function GroupInfo({ chat, uid, friends, actions, onProfile, onClose }) {
  const [err, setErr] = useState('')
  const isOwner = chat.owner_id === uid
  const members = chat.members.map(m => m.profiles)
  const addable = friends.filter(f => !members.some(m => m.id === f.id))

  async function add(id) {
    setErr('')
    const e = await actions.addMember(chat.id, id)
    if (e) setErr(e)
  }

  return (
    <Modal onClose={onClose}>
      {close => (
        <>
          <h3>{chat.name}</h3>
          <h5 className="flat">Members ({members.length})</h5>
          <div className="pick">
            {members.map((p, i) => (
              <div key={p.id} className="opt" style={{ '--i': i }} onClick={() => onProfile(p)}>
                <Avatar url={p.avatar_url} name={p.display_name} size={28} />
                <span>{p.display_name}</span>
                {p.id === chat.owner_id && <small>owner</small>}
              </div>
            ))}
          </div>
          {isOwner && (
            <>
              <h5 className="flat">Add friends</h5>
              <div className="pick">
                {addable.length === 0 && <p className="note">No friends to add</p>}
                {addable.map((f, i) => (
                  <div key={f.id} className="opt" style={{ '--i': i }}>
                    <Avatar url={f.avatar_url} name={f.display_name} size={28} />
                    <span>{f.display_name}</span>
                    <button onClick={() => add(f.id)}>Add</button>
                  </div>
                ))}
              </div>
            </>
          )}
          {err && <small className="err">{err}</small>}
          <button className="ghost danger" onClick={() => actions.leave(chat.id)}>Leave group</button>
          <button className="ghost" onClick={close}>Close</button>
        </>
      )}
    </Modal>
  )
}
