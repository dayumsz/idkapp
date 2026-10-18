'use client'
import { useState } from 'react'

export default function Modal({ onClose, children, className = '' }) {
  const [out, setOut] = useState(false)
  const close = () => { setOut(true); setTimeout(onClose, 180) }
  return (
    <div className={`modal ${out ? 'out' : ''}`} onMouseDown={e => e.target === e.currentTarget && close()}>
      <div className={`card ${className}`}>{children(close)}</div>
    </div>
  )
}
