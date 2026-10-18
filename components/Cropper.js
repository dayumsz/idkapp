'use client'
import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import { avatarVariants } from '../lib/image'

const BOX = 300 // viewport (css px)
const D = 260 // circle diameter (css px)
const MAX_ZOOM = 4

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

export default function Cropper({ file, onCancel, onConfirm }) {
  const [url, setUrl] = useState('')
  const [img, setImg] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const pointers = useRef(new Map())
  const pinch = useRef(0)
  const box = useRef(null)

  useEffect(() => {
    const u = URL.createObjectURL(file)
    const i = new Image()
    i.onload = () => { setUrl(u); setImg(i) }
    i.src = u
    return () => URL.revokeObjectURL(u)
  }, [file])

  const kmin = img ? D / Math.min(img.naturalWidth, img.naturalHeight) : 1
  const k = kmin * zoom

  const limit = (p, kk = k) => {
    if (!img) return p
    const mx = Math.max(0, (img.naturalWidth * kk - D) / 2)
    const my = Math.max(0, (img.naturalHeight * kk - D) / 2)
    return { x: clamp(p.x, -mx, mx), y: clamp(p.y, -my, my) }
  }

  const setZ = (z, p = pos) => {
    const nz = clamp(z, 1, MAX_ZOOM)
    setZoom(nz)
    setPos(limit(p, kmin * nz))
  }

  const snap = z => (Math.abs(z - 1) < 0.03 ? 1 : z)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const wheel = e => {
      e.preventDefault()
      setZ(zoom * (1 - e.deltaY * 0.0015))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  })

  const down = e => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = Math.hypot(a.x - b.x, a.y - b.y)
    }
    setDrag(true)
  }

  const move = e => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    const cur = { x: e.clientX, y: e.clientY }
    pointers.current.set(e.pointerId, cur)
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinch.current) setZ(zoom * (d / pinch.current))
      pinch.current = d
      return
    }
    setPos(p => limit({ x: p.x + cur.x - prev.x, y: p.y + cur.y - prev.y }))
  }

  const up = e => {
    pointers.current.delete(e.pointerId)
    pinch.current = 0
    if (!pointers.current.size) setDrag(false)
  }

  function reset() {
    setZoom(1)
    setPos({ x: 0, y: 0 })
  }

  async function apply(close) {
    if (!img) return
    setBusy(true)
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
    const side = D / k // crop side in source pixels
    const sx = img.naturalWidth / 2 - (D / 2 + pos.x) / k
    const sy = img.naturalHeight / 2 - (D / 2 + pos.y) / k
    const v = await avatarVariants(img, sx, sy, side, type)
    setBusy(false)
    if (!v.l || !v.m || !v.s) return
    const ext = type === 'image/png' ? 'png' : 'jpg'
    const mk = (b, n) => new File([b], `avatar_${n}.${ext}`, { type })
    onConfirm({ l: mk(v.l, 'l'), m: mk(v.m, 'm'), s: mk(v.s, 's') })
    close()
  }

  const cropPx = img ? Math.round(D / k) : 0
  const low = img && cropPx < 256

  return (
    <Modal onClose={onCancel} className="crop">
      {close => (
        <>
          <h3>Adjust photo</h3>
          <div
            ref={box}
            className={`cropbox ${drag ? 'drag' : ''}`}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          >
            {img && (
              <img
                src={url}
                alt=""
                draggable={false}
                style={{
                  width: img.naturalWidth * k,
                  height: img.naturalHeight * k,
                  transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))`
                }}
              />
            )}
            <div className="cropmask" />
          </div>
          <label className="zoom">
            <span>Zoom</span>
            <input
              type="range"
              min="1"
              max={MAX_ZOOM}
              step="0.01"
              value={zoom}
              onChange={e => setZ(snap(Number(e.target.value)))}
            />
            <output>{Math.round(zoom * 100)}%</output>
          </label>
          <small className={`cropnote ${low ? 'err' : ''}`}>
            {low ? 'Low resolution area, the result may look soft' : 'Drag to move, scroll or pinch to zoom'}
          </small>
          <div className="row-btns">
            <button disabled={busy || !img} onClick={() => apply(close)}>{busy ? 'Processing...' : 'Apply'}</button>
            <button className="ghost" disabled={busy} onClick={reset}>Reset</button>
            <button className="ghost" disabled={busy} onClick={close}>Cancel</button>
          </div>
        </>
      )}
    </Modal>
  )
}
