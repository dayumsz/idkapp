'use client'
import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import Modal from './Modal'
import Avatar from './Avatar'
import Cropper from './Cropper'
import { shrinkBanner } from '../lib/image'
import { upload, uploadAvatar } from '../lib/upload'

const AVATAR_TYPES = ['image/png', 'image/jpeg']
const BANNER_TYPES = ['image/png', 'image/jpeg', 'image/gif']

export default function ProfileEdit({ me, onClose }) {
  const [name, setName] = useState(me.display_name)
  const [bio, setBio] = useState(me.bio || '')
  const [avatar, setAvatar] = useState(null)
  const [banner, setBanner] = useState(null)
  const [crop, setCrop] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const avatarSrc = useMemo(() => (avatar ? URL.createObjectURL(avatar.m) : me.avatar_url), [avatar, me.avatar_url])
  const bannerSrc = useMemo(() => (banner ? URL.createObjectURL(banner) : me.banner_url), [banner, me.banner_url])

  const pick = (types, set) => e => {
    const f = e.target.files[0]
    e.target.value = ''
    if (f && types.includes(f.type)) set(f)
  }

  const pickAvatar = e => {
    const f = e.target.files[0]
    e.target.value = ''
    if (f && AVATAR_TYPES.includes(f.type)) setCrop(f)
  }

  async function save(close) {
    setBusy(true)
    setErr('')
    const [a, b] = await Promise.all([
      avatar ? uploadAvatar(me.id, avatar) : null,
      banner ? shrinkBanner(banner).then(f => upload('banners', me.id, f)) : null
    ])
    if ((avatar && !a) || (banner && !b)) {
      setBusy(false)
      return setErr('Image upload failed')
    }
    const patch = { display_name: name.trim() || me.display_name, bio: bio.trim() || null }
    if (a) patch.avatar_url = a
    if (b) patch.banner_url = b
    const { error } = await supabase.from('profiles').update(patch).eq('id', me.id)
    setBusy(false)
    if (error) return setErr(error.message)
    close()
  }

  return (
    <>
    <Modal onClose={onClose} className="pcard">
      {close => (
        <>
          <label className="banner editable">
            {bannerSrc ? <img src={bannerSrc} alt="" /> : <div className="banner-fallback" />}
            <span className="overlay">Change banner (PNG, JPEG or GIF)</span>
            <input type="file" hidden accept="image/png,image/jpeg,image/gif" onChange={pick(BANNER_TYPES, setBanner)} />
          </label>
          <label className="pavatar editable">
            <Avatar url={avatarSrc} name={name} size={94} />
            <span className="overlay">Edit</span>
            <input type="file" hidden accept="image/png,image/jpeg" onChange={pickAvatar} />
          </label>
          <div className="pbody">
            <label className="field">
              Display name
              <input value={name} maxLength={40} onChange={e => setName(e.target.value)} />
            </label>
            <label className="field">
              Bio
              <textarea rows={3} maxLength={190} value={bio} onChange={e => setBio(e.target.value)} placeholder="Tell something about yourself" />
              <small>{bio.length}/190</small>
            </label>
            <div className="idchip static"># {me.public_id}</div>
            {err && <small className="err">{err}</small>}
            <div className="row-btns">
              <button disabled={busy} onClick={() => save(close)}>{busy ? 'Saving...' : 'Save'}</button>
              <button className="ghost" onClick={close}>Cancel</button>
            </div>
            <button className="ghost danger" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </>
      )}
    </Modal>
    {crop && <Cropper file={crop} onCancel={() => setCrop(null)} onConfirm={f => { setAvatar(f); setCrop(null) }} />}
    </>
  )
}
