'use client'
import { useState } from 'react'
import Modal from './Modal'
import { askDesktop, desktopState, playTone, unlockAudio } from '../lib/notify'

export default function AlertsPicker({ prefs, onChange, onClose }) {
  const [perm, setPerm] = useState(desktopState())

  const toggleDesktop = async () => {
    if (!prefs.desktop) {
      const r = await askDesktop()
      setPerm(r)
      onChange({ ...prefs, desktop: true })
    } else onChange({ ...prefs, desktop: false })
  }

  return (
    <Modal onClose={onClose}>
      {close => (
        <>
          <h3>Alerts</h3>
          <button className={`opt-toggle ${prefs.sound ? 'on' : ''}`} onClick={() => { unlockAudio(); onChange({ ...prefs, sound: !prefs.sound }) }}>
            <span>Sound for new messages</span>
            <b>{prefs.sound ? 'On' : 'Off'}</b>
          </button>
          <button className={`opt-toggle ${prefs.desktop ? 'on' : ''}`} onClick={toggleDesktop} disabled={perm === 'unsupported'}>
            <span>Desktop notifications</span>
            <b>{perm === 'unsupported' ? 'Not supported' : prefs.desktop ? 'On' : 'Off'}</b>
          </button>
          {perm === 'denied' && prefs.desktop && (
            <small className="note">Notifications are blocked for this site. Allow them in the browser address bar settings.</small>
          )}
          <small className="note">
            To avoid constant beeping, the sound plays at most once every few seconds, and a chat you are
            looking at only gets a soft sound.
          </small>
          <div className="row-btns">
            <button className="ghost" onClick={() => { unlockAudio(); playTone('notify') }}>Test sound</button>
            <button className="ghost" onClick={close}>Close</button>
          </div>
        </>
      )}
    </Modal>
  )
}
