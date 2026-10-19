'use client'
import { useMemo, useState } from 'react'
import Modal from './Modal'
import Avatar from './Avatar'
import Cropper from './Cropper'

const ICON_TYPES = ['image/png', 'image/jpeg']

export default function NewGroup({ friends, onCreate, onClose }) {
  const [name, setName] = useState('')
  const [sel, setSel] = useState([])
  const [icon, setIcon] = useState(null) // { l, m, s } files from the cropper
  const [crop, setCrop] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const preview = useMemo(() => (icon ? URL.createObjectURL(icon.m) : null), [icon])

  const toggle = id => setSel(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]))

  const pickIcon = e => {
    const f = e.target.files[0]
    e.target.value = ''
    if (f && ICON_TYPES.includes(f.type)) setCrop(f)
    else if (f) setErr('Only PNG or JPEG images')
  }

  async function create() {
    setBusy(true)
    setErr('')
    const e = await onCreate(name, sel, icon)
    setBusy(false)
    if (e) setErr(e)
  }

  return (
    <>
      <Modal onClose={onClose}>
        {close => (
          <>
            <h3>New group</h3>
            <div className="gicon">
              <label className="gpic editable">
                <Avatar url={preview} name={name || 'G'} size={72} />
                <span className="overlay">Icon</span>
                <input type="file" hidden accept="image/png,image/jpeg" onChange={pickIcon} />
              </label>
              <div className="gside">
                <label className="attach">
                  {icon ? 'Change icon' : 'Add icon'}
                  <input type="file" hidden accept="image/png,image/jpeg" onChange={pickIcon} />
                </label>
                {icon && <button className="ghost" onClick={() => setIcon(null)}>Remove</button>}
              </div>
            </div>
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
            <button disabled={busy || !name.trim()} onClick={create}>{busy ? 'Creating...' : 'Create group'}</button>
            <button className="ghost" disabled={busy} onClick={close}>Cancel</button>
          </>
        )}
      </Modal>
      {crop && <Cropper file={crop} onCancel={() => setCrop(null)} onConfirm={f => { setIcon(f); setCrop(null) }} />}
    </>
  )
}
