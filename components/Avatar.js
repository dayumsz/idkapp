'use client'
import { useState } from 'react'

// avatars uploaded by the new cropper are stored as <name>_l / _m / _s (512 / 256 / 128 px).
// The smallest one that still covers the screen density is used, so nothing is shrunk by a big factor.
const VARIANT = /_l\.(png|jpg)$/

function pick(url, size) {
  if (!url || !VARIANT.test(url)) return url
  const dpr = typeof window === 'undefined' ? 2 : Math.min(window.devicePixelRatio || 1, 3)
  const need = size * dpr
  const v = need <= 128 ? 's' : need <= 256 ? 'm' : 'l'
  return url.replace(VARIANT, `_${v}.$1`)
}

export default function Avatar({ url, name, size = 40, onClick }) {
  const [bad, setBad] = useState(false)
  const s = { width: size, height: size, fontSize: size * 0.4 }
  const cls = `av${onClick ? ' click' : ''}`
  if (!url) return <div className={cls} style={s} onClick={onClick}>{(name || '?')[0].toUpperCase()}</div>
  return (
    <img
      className={cls}
      src={bad ? url : pick(url, size)}
      style={s}
      alt=""
      draggable={false}
      decoding="async"
      onError={() => setBad(true)}
      onClick={onClick}
    />
  )
}
