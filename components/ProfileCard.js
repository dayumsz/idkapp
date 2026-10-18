'use client'
import { useState } from 'react'
import Modal from './Modal'
import Avatar from './Avatar'

export default function ProfileCard({ profile, isMe, onEdit, onClose }) {
  const [copied, setCopied] = useState(false)
  const since = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-US', { day: '2-digit', month: 'long', year: 'numeric' })
    : null

  function copy() {
    navigator.clipboard?.writeText(profile.public_id)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <Modal onClose={onClose} className="pcard">
      {close => (
        <>
          <div className="banner">
            {profile.banner_url ? <img src={profile.banner_url} alt="" /> : <div className="banner-fallback" />}
            <button className="x" onClick={close}>Close</button>
          </div>
          <div className="pavatar">
            <Avatar url={profile.avatar_url} name={profile.display_name} size={94} />
          </div>
          <div className="pbody">
            <h2 className="rise" style={{ '--d': '.1s' }}>{profile.display_name}</h2>
            <button className="idchip rise" style={{ '--d': '.15s' }} onClick={copy}>
              {copied ? 'Copied' : `# ${profile.public_id}`}
            </button>
            <div className="section rise" style={{ '--d': '.2s' }}>
              <h4>ABOUT ME</h4>
              <p>{profile.bio || 'No bio yet.'}</p>
            </div>
            {since && (
              <div className="section rise" style={{ '--d': '.25s' }}>
                <h4>MEMBER SINCE</h4>
                <p>{since}</p>
              </div>
            )}
            {isMe && (
              <button className="rise" style={{ '--d': '.3s' }} onClick={() => { close(); setTimeout(onEdit, 190) }}>
                Edit profile
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}
