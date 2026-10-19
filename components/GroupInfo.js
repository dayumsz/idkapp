'use client'
import { useState } from 'react'
import Modal from './Modal'
import Avatar from './Avatar'
import Cropper from './Cropper'

const ICON_TYPES = ['image/png', 'image/jpeg']

export default function GroupInfo({ chat, uid, friends, actions, onProfile, onClose }) {
  const [err, setErr] = useState('')
  const [crop, setCrop] = useState(null)
  const [busy, setBusy] = useState(false)
  const isOwner = chat.owner_id === uid
  const members = chat.members.map(m => m.profiles)
  const addable = friends.filter(f => !members.some(m => m.id === f.id))

  async function add(id) {
    setErr('')
    const e = await actions.addMember(chat.id, id)
    if (e) setErr(e)
  }

  const pickIcon = e => {
    const f = e.target.files[0]
    e.target.value = ''
    if (!f) return
    if (ICON_TYPES.includes(f.type)) setCrop(f)
    else setErr('Only PNG or JPEG images')
  }

  async function saveIcon(icon) {
    setCrop(null)
    setBusy(true)
    setErr('')
    const e = await actions.setGroupIcon(chat.id, icon)
    setBusy(false)
    if (e) setErr(e)
  }

  return (
    <>
      <Modal onClose={onClose}>
        {close => (
          <>
            <div className="gicon">
              {isOwner ? (
                <label className="gpic editable">
                  <Avatar url={chat.icon_url} name={chat.name} size={72} />
                  <span className="overlay">Icon</span>
                  <input type="file" hidden accept="image/png,image/jpeg" disabled={busy} onChange={pickIcon} />
                </label>
              ) : (
                <div className="gpic"><Avatar url={chat.icon_url} name={chat.name} size={72} /></div>
              )}
              <div className="gside">
                <h3>{chat.name}</h3>
                {isOwner && (
                  <div className="row-btns">
                    <label className="attach">
                      {busy ? 'Saving...' : chat.icon_url ? 'Change icon' : 'Add icon'}
                      <input type="file" hidden accept="image/png,image/jpeg" disabled={busy} onChange={pickIcon} />
                    </label>
                    {chat.icon_url && <button className="ghost" disabled={busy} onClick={() => saveIcon(null)}>Remove</button>}
                  </div>
                )}
              </div>
            </div>
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
      {crop && <Cropper file={crop} onCancel={() => setCrop(null)} onConfirm={saveIcon} />}
    </>
  )
}
