'use client'
import { useState } from 'react'
import Modal from './Modal'
import { themes, getTheme, setTheme } from '../lib/theme'

export default function ThemePicker({ onClose }) {
  const [cur, setCur] = useState(getTheme())
  return (
    <Modal onClose={onClose}>
      {close => (
        <>
          <h3>Theme</h3>
          <div className="themes">
            {themes.map((t, i) => (
              <button
                key={t.id}
                className={`swatch ${cur === t.id ? 'on' : ''}`}
                style={{ '--i': i, background: t.c[0], color: t.c[2], borderColor: cur === t.id ? t.c[1] : 'transparent' }}
                onClick={() => { setTheme(t.id); setCur(t.id) }}
              >
                <i style={{ background: t.c[1] }} />
                <span>{t.name}</span>
              </button>
            ))}
          </div>
          <button className="ghost" onClick={close}>Close</button>
        </>
      )}
    </Modal>
  )
}
