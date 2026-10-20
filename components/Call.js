'use client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import Avatar from './Avatar'
import { Icon } from '../lib/icons'

// Without a TURN relay, people behind mobile data / CGNAT / strict routers can never reach each other and
// stay on "Connecting..." forever. NEXT_PUBLIC_TURN_URL accepts several urls separated by commas
// (turn:host:3478, turn:host:443?transport=tcp, turns:host:443?transport=tcp) so restrictive networks have a way out.
const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }]
const turnUrls = (process.env.NEXT_PUBLIC_TURN_URL || '').split(',').map(u => u.trim()).filter(Boolean)
const HAS_TURN = turnUrls.length > 0
if (HAS_TURN) {
  iceServers.push({
    urls: turnUrls,
    username: process.env.NEXT_PUBLIC_TURN_USER,
    credential: process.env.NEXT_PUBLIC_TURN_CRED
  })
}

const PREFS_KEY = 'callprefs'
const readPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {} } catch { return {} } }
const writePrefs = p => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch {} }
const MIC_KEY = 'callmic'
const OUT_KEY = 'callout'
const getSaved = k => { try { return localStorage.getItem(k) || '' } catch { return '' } }
const setSaved = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k) } catch {} }
// Safari does not play remote WebRTC audio through WebAudio, there the audio element does all the work
const EL_ONLY = typeof navigator !== 'undefined' && /^((?!chrome|chromium|android|crios|fxios).)*safari/i.test(navigator.userAgent)
const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }

// tries the chosen microphone first and falls back to the default one if it is gone
async function getMic(id) {
  if (id) {
    try { return await navigator.mediaDevices.getUserMedia({ audio: { ...AUDIO, deviceId: { exact: id } } }) } catch {}
  }
  return navigator.mediaDevices.getUserMedia({ audio: AUDIO })
}

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
const clock = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
const same = (a, b) => {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every(k => a[k] === b[k])
}

// position of every [data-flip] piece of the dock, relative to the dock itself
function measureDock(el) {
  const d = el.getBoundingClientRect()
  const m = {}
  el.querySelectorAll('[data-flip]').forEach(n => {
    const r = n.getBoundingClientRect()
    m[n.dataset.flip] = { x: r.left - d.left, y: r.top - d.top, hide: n.classList.contains('gone') }
  })
  return m
}

function Screen({ stream, label, hasAudio, onMenu }) {
  const ref = useRef(null)
  const box = useRef(null)
  useEffect(() => { if (ref.current) ref.current.srcObject = stream }, [stream])
  return (
    <div className="screen" ref={box} onContextMenu={onMenu}>
      <video ref={ref} autoPlay playsInline muted />
      <span className="lbl">{label}{hasAudio ? ' · sound' : ''}</span>
      <button className="ghost fs" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : box.current?.requestFullscreen?.())}>
        Fullscreen
      </button>
    </div>
  )
}

function Bubble({ p, you, talking, badge, small, onMenu }) {
  const timer = useRef(null)
  const press = e => {
    const t = e.touches[0]
    timer.current = setTimeout(() => onMenu({ clientX: t.clientX, clientY: t.clientY, preventDefault() {} }), 450)
  }
  const cancel = () => clearTimeout(timer.current)
  return (
    <div
      className={`vb ${talking ? 'talk' : ''} ${small ? 'small' : ''} ${badge ? 'off' : ''}`}
      onContextMenu={onMenu}
      onTouchStart={you ? undefined : press}
      onTouchEnd={cancel}
      onTouchMove={cancel}
    >
      <div className="ring">
        <Avatar url={p?.avatar_url} name={p?.display_name} size={small ? 56 : 96} />
      </div>
      <span className="vname">{you ? 'You' : p?.display_name}</span>
      <small className="vbadge">{badge || '\u00a0'}</small>
    </div>
  )
}

function Menu({ x, y, name, vol, muted, onVol, onMute, onClose, onChange, onStop, note }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8))
    })
  }, [x, y])

  useEffect(() => {
    const away = e => { if (!ref.current?.contains(e.target)) onClose() }
    const key = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', key)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <div ref={ref} className="ctx" style={pos} onContextMenu={e => e.preventDefault()}>
      <b>{name}</b>
      {onChange && <button className="ghost" onClick={() => { onClose(); onChange() }}>Change screen or window</button>}
      {onStop && <button className="ghost" onClick={() => { onClose(); onStop() }}>Stop sharing</button>}
      {note && <small className="note">{note}</small>}
      {onMute && <button className={muted ? '' : 'ghost'} onClick={onMute}>{muted ? 'Unmute' : 'Mute'}</button>}
      {onVol && (
        <label className="vol">
          <span>Volume</span>
          <output>{vol}%</output>
          <input
            type="range"
            min="0"
            max="200"
            step="1"
            value={vol}
            onChange={e => {
              const v = Number(e.target.value)
              onVol(Math.abs(v - 100) <= 4 ? 100 : v)
            }}
          />
          <div className="ticks"><i>0</i><i>100</i><i>200</i></div>
        </label>
      )}
      {onVol && <button className="ghost" disabled={vol === 100} onClick={() => onVol(100)}>Reset volume</button>}
    </div>
  )
}

function DevicePanel({ inputs, outputs, micId, outId, canOut, onMic, onOut, onClose, className }) {
  const ref = useRef(null)
  useEffect(() => {
    const away = e => { if (!ref.current?.contains(e.target) && !e.target.closest?.('[data-devbtn]')) onClose() }
    const key = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key) }
  }, [onClose])
  const nm = (d, i, w) => d.label || `${w} ${i + 1}`
  return (
    <div ref={ref} className={`devpop ${className || ''}`}>
      <label className="field">
        Microphone
        <select value={micId} onChange={e => onMic(e.target.value)}>
          <option value="">Default</option>
          {inputs.filter(d => d.deviceId !== 'default').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{nm(d, i, 'Microphone')}</option>)}
        </select>
      </label>
      {canOut && (
        <label className="field">
          Speaker
          <select value={outId} onChange={e => onOut(e.target.value)}>
            <option value="">Default</option>
            {outputs.filter(d => d.deviceId !== 'default').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{nm(d, i, 'Speaker')}</option>)}
          </select>
        </label>
      )}
      {!canOut && <small className="note">Speaker selection is not supported by this browser, it follows the system output.</small>}
    </div>
  )
}

export default function Call({ conversationId, uid, title, people, minimized, compact, onMinimize, onExpand, onEnd }) {
  const [local, setLocal] = useState(null)
  const [members, setMembers] = useState({}) // uid -> 'connecting' | 'connected'
  const [shares, setShares] = useState({})
  const [screen, setScreen] = useState(null)
  const [mic, setMic] = useState(true)
  const [deaf, setDeaf] = useState(false)
  const [peerMic, setPeerMic] = useState({})
  const [peerDeaf, setPeerDeaf] = useState({})
  const [speaking, setSpeaking] = useState({})
  const [menu, setMenu] = useState(null)
  const [secs, setSecs] = useState(0)
  const [shareErr, setShareErr] = useState('')
  const [shareNote, setShareNote] = useState('')
  const [shareAudio, setShareAudio] = useState({}) // uid -> true while that screen share carries sound
  const [fsEl, setFsEl] = useState(null)
  const [devOpen, setDevOpen] = useState(false)
  const [devs, setDevs] = useState({ inputs: [], outputs: [] })
  const [micId, setMicId] = useState(() => getSaved(MIC_KEY))
  const [outId, setOutId] = useState(() => getSaved(OUT_KEY))

  const stream = useRef(null)
  const screenRef = useRef(null)
  const micRef = useRef(true)
  const deafRef = useRef(false)
  const wasOn = useRef(true)
  const pcsRef = useRef({})
  const sendersRef = useRef({})
  const nodesRef = useRef({})
  const ctxRef = useRef(null)
  const api = useRef({})
  const endRef = useRef(onEnd)
  endRef.current = onEnd
  const prefsRef = useRef(null)
  if (prefsRef.current === null) prefsRef.current = readPrefs()
  const [prefs, setPrefs] = useState(prefsRef.current)

  useEffect(() => {
    const on = () => setFsEl(document.fullscreenElement || null)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  // the minimized dock morphs between its wide and narrow shape: the box grows/shrinks and every piece
  // (dot, avatars, buttons) travels from where it was to where it goes (FLIP), the rest fades
  const dockRef = useRef(null)
  const dockBox = useRef(null)
  const dockAnim = useRef(null)
  const dockPos = useRef(null)
  const dockKids = useRef([])
  useLayoutEffect(() => {
    const el = dockRef.current
    if (!el) { dockBox.current = null; dockAnim.current = null; dockPos.current = null; dockKids.current = []; return }
    if (dockAnim.current) {
      if (dockBox.current?.compact === !!compact) return
      // toggled again mid-animation: continue from what is on screen right now
      const r = el.getBoundingClientRect()
      dockPos.current = measureDock(el)
      const a = dockAnim.current
      a.onfinish = null
      a.oncancel = null
      a.cancel()
      dockKids.current.forEach(k => k.cancel())
      dockKids.current = []
      dockAnim.current = null
      dockBox.current = { w: r.width, h: r.height, compact: dockBox.current.compact }
    }
    const w = el.offsetWidth
    const h = el.offsetHeight
    const prev = dockBox.current
    const before = dockPos.current
    const after = measureDock(el)
    dockBox.current = { w, h, compact: !!compact }
    dockPos.current = after
    const calm = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!prev || prev.compact === !!compact || calm || typeof el.animate !== 'function') return

    const opts = { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' }
    el.style.overflow = 'hidden'
    const a = el.animate(
      [{ width: `${prev.w}px`, height: `${prev.h}px` }, { width: `${w}px`, height: `${h}px` }],
      opts
    )
    dockAnim.current = a
    const kids = []
    el.querySelectorAll('[data-flip]').forEach(n => {
      const f = before?.[n.dataset.flip]
      const t = after[n.dataset.flip]
      if (!f || !t || f.hide || t.hide) return
      const dx = f.x - t.x
      const dy = f.y - t.y
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
      kids.push(n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], opts))
    })
    dockKids.current = kids
    const done = () => {
      dockAnim.current = null
      dockKids.current = []
      el.style.overflow = ''
      dockBox.current = { w: el.offsetWidth, h: el.offsetHeight, compact: !!compact }
      dockPos.current = measureDock(el)
    }
    a.onfinish = done
    a.oncancel = done
  })

  const canOut = typeof window !== 'undefined' && typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype

  const gainOf = id => {
    if (deafRef.current && id !== 'local') return 0
    const p = prefsRef.current[id]
    return p?.muted ? 0 : (p?.vol ?? 100) / 100
  }
  // normally the audio engine plays everything (so the volume can pass 100%). If the browser keeps it
  // asleep, the plain audio element takes over so you never end up with a person you cannot hear.
  const syncGain = id => {
    const n = nodesRef.current[id]
    const ctx = ctxRef.current
    if (!n || !ctx) return
    const g = gainOf(id)
    const viaCtx = ctx.state === 'running' && !EL_ONLY
    if (n.gain) n.gain.gain.setTargetAtTime(viaCtx ? g : 0, ctx.currentTime, 0.02)
    if (n.el) {
      n.el.volume = Math.min(1, g)
      n.el.muted = viaCtx || g === 0
      if (!n.el.muted && n.el.paused) n.el.play().catch(() => {})
    }
  }
  const syncAll = () => Object.keys(nodesRef.current).forEach(syncGain)
  const setPref = (id, patch) => {
    const next = { ...prefsRef.current, [id]: { vol: 100, muted: false, ...prefsRef.current[id], ...patch } }
    prefsRef.current = next
    setPrefs(next)
    writePrefs(next)
    syncGain(id)
  }

  useEffect(() => {
    let channel
    let closed = false
    let subscribedOnce = false
    let queue = Promise.resolve()
    const sid = newId() // identifies this visit to the call, a rejoin always gets a new one
    const joinedAt = Date.now()
    const pcs = pcsRef.current
    const senders = sendersRef.current
    const nodes = nodesRef.current
    const roster = {} // uid -> { sid, t } people currently in the call (from realtime presence)
    const gone = new Set() // sessions that said goodbye, anything they still send is stale
    const waits = {} // uid -> timer, asks the other side to (re)start the link when it never arrives
    const early = {} // ice candidates that arrived before their offer
    const Ctx = window.AudioContext || window.webkitAudioContext
    const ctx = new Ctx()
    ctxRef.current = ctx
    ctx.resume().catch(() => {})
    const savedOut = getSaved(OUT_KEY)
    if (savedOut && ctx.setSinkId) ctx.setSinkId(savedOut).catch(() => {})

    // Only one side of each pair creates the link (the bigger id), the other one just follows.
    // That removes the old "both sides rebuild at the same time" collisions that left one side deaf.
    const offers = id => uid > id

    const send = payload => {
      try {
        const r = channel?.send({ type: 'broadcast', event: 'sig', payload: { ...payload, from: uid, fsid: sid } })
        if (r && r.catch) r.catch(() => {})
      } catch {}
    }
    const myState = () => ({ type: 'state', mic: micRef.current, deaf: deafRef.current })
    const sendState = (to, tsid) => send({ ...myState(), to, tsid })

    const refreshDevices = async () => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices()
        if (!closed) setDevs({ inputs: all.filter(d => d.kind === 'audioinput'), outputs: all.filter(d => d.kind === 'audiooutput') })
      } catch {}
    }

    // browsers keep the audio engine asleep until the user interacts, wake it on every chance
    const wake = () => {
      if (closed) return
      if (ctx.state !== 'running') ctx.resume().catch(() => {})
      Object.values(nodes).forEach(n => { if (n.el && n.el.paused) n.el.play().catch(() => {}) })
    }
    ctx.onstatechange = () => { syncAll(); if (ctx.state !== 'running') wake() }
    const wakeEvents = ['pointerdown', 'keydown', 'touchend', 'click']
    wakeEvents.forEach(e => window.addEventListener(e, wake, true))
    document.addEventListener('visibilitychange', wake)

    const release = id => {
      const n = nodes[id]
      if (!n) return
      try { n.src.disconnect(); n.an.disconnect(); n.gain?.disconnect() } catch {}
      if (n.el) { n.el.pause(); n.el.srcObject = null }
      delete nodes[id]
    }

    // remote audio goes through a gain node so the volume can go above 100%.
    // If the audio engine is not running, a plain audio element plays it instead (see syncGain).
    const attach = (id, s, remote) => {
      release(id)
      const src = ctx.createMediaStreamSource(s)
      const an = ctx.createAnalyser()
      an.fftSize = 512
      src.connect(an)
      let gain = null
      let el = null
      if (remote) {
        // Chromium only delivers remote WebRTC audio to WebAudio when a media element holds the stream
        el = new Audio()
        el.autoplay = true
        el.srcObject = s
        el.muted = true
        const out = getSaved(OUT_KEY)
        if (out && el.setSinkId) el.setSinkId(out).catch(() => {})
        el.play().catch(() => {})
        gain = ctx.createGain()
        src.connect(gain)
        gain.connect(ctx.destination)
      }
      nodes[id] = { src, an, gain, el, data: new Uint8Array(an.fftSize), last: 0 }
      syncGain(id)
      wake()
    }

    const without = (r, id) => { if (!(id in r)) return r; const n = { ...r }; delete n[id]; return n }
    // the person stopped sharing: the picture and its sound go away together
    const dropShare = id => {
      release(`screen:${id}`)
      setShareAudio(r => without(r, id))
      setShares(r => without(r, id))
    }
    // a track of one particular stream was removed (never touches a newer stream of the same person)
    const dropShareOf = (id, st) => setShares(r => (r[id] === st ? without(r, id) : r))
    const dropScreenAudio = (id, st) => {
      const k = `screen:${id}`
      if (nodes[k] && nodes[k].owner === st) {
        release(k)
        setShareAudio(r => without(r, id))
      }
    }
    const setMember = (id, state) => setMembers(m => (m[id] === state ? m : { ...m, [id]: state }))

    // keep = true when the link is only being rebuilt and the person is still in the call
    const drop = (id, keep) => {
      const pc = pcs[id]
      if (pc) {
        clearTimeout(pc.st.watch)
        clearTimeout(pc.st.dis)
        clearTimeout(pc.st.ft)
        pc.onconnectionstatechange = null
        pc.ontrack = null
        pc.onicecandidate = null
        pc.onnegotiationneeded = null
        try { pc.close() } catch {}
      }
      delete pcs[id]
      delete senders[id]
      release(id)
      dropShare(id)
      if (keep) {
        setMembers(m => (m[id] ? { ...m, [id]: 'connecting' } : m))
      } else {
        clearTimeout(waits[id])
        delete waits[id]
        setMembers(r => { if (!r[id]) return r; const n = { ...r }; delete n[id]; return n })
        setPeerMic(r => { const n = { ...r }; delete n[id]; return n })
        setPeerDeaf(r => { const n = { ...r }; delete n[id]; return n })
      }
    }

    // a link that does not reach "connected" is retried: first an ICE restart, then a brand new link
    const arm = (id, pc, ms = 6000) => {
      clearTimeout(pc.st.watch)
      pc.st.watch = setTimeout(() => {
        if (closed || pcs[id] !== pc || pc.connectionState === 'connected') return
        recover(id, pc)
      }, ms)
    }

    const recover = (id, pc) => {
      if (closed || pcs[id] !== pc) return
      if (!HAS_TURN && !pc.st.warned) { pc.st.warned = true; console.warn('[call] link to', id, 'is not connecting and no TURN server is configured (NEXT_PUBLIC_TURN_URL)') }
      if (offers(id)) {
        if (pc.st.restarts < 1 && pc.connectionState !== 'failed' && pc.restartIce) {
          pc.st.restarts++
          try { pc.restartIce() } catch {}
          arm(id, pc)
        } else {
          connect(id, pc.rsid)
        }
      } else {
        send({ type: 'redo', to: id, tsid: pc.rsid })
        arm(id, pc)
      }
    }

    // perfect negotiation: both sides may renegotiate (screen share) without colliding
    const make = (id, rsid, lid) => {
      const pc = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 4, bundlePolicy: 'max-bundle' })
      const st = { making: false, ignore: false, polite: uid < id, pending: [], out: [], ft: null, watch: null, dis: null, restarts: 0, born: Date.now() }
      pc.st = st
      pc.lid = lid
      pc.rsid = rsid
      stream.current.getTracks().forEach(t => pc.addTrack(t, stream.current))
      if (screenRef.current) {
        const sc = screenRef.current
        const a = sc.getAudioTracks()[0]
        senders[id] = [pc.addTrack(sc.getVideoTracks()[0], sc), ...(a ? [pc.addTrack(a, sc)] : [])]
      }
      const flush = () => {
        clearTimeout(st.ft)
        st.ft = null
        if (!st.out.length) return
        const data = st.out
        st.out = []
        send({ type: 'ice', to: id, tsid: rsid, lid, data })
      }
      // candidates are sent in small batches, one message each would hit the realtime rate limit
      pc.onicecandidate = e => {
        if (e.candidate) {
          st.out.push(e.candidate.toJSON())
          if (!st.ft) st.ft = setTimeout(flush, 60)
        } else flush()
      }
      pc.onnegotiationneeded = async () => {
        if (pcs[id] !== pc) return
        try {
          st.making = true
          await pc.setLocalDescription()
          if (pcs[id] !== pc) return
          const d = pc.localDescription
          send({ type: 'desc', to: id, tsid: rsid, lid, data: { type: d.type, sdp: d.sdp } })
        } catch {} finally { st.making = false }
      }
      pc.ontrack = e => {
        if (pcs[id] !== pc) return
        const stm = e.streams[0] || new MediaStream([e.track])
        if (e.track.kind === 'audio') {
          // the first audio stream is the voice, any other one belongs to a screen share
          const isScreen = stm.getVideoTracks().length > 0 || (st.mic && st.mic !== stm.id)
          if (isScreen) {
            const k = `screen:${id}`
            attach(k, new MediaStream([e.track]), true)
            if (nodes[k]) nodes[k].owner = stm
            setShareAudio(r => ({ ...r, [id]: true }))
            stm.addEventListener('removetrack', ev => { if (ev.track === e.track) dropScreenAudio(id, stm) })
          } else {
            st.mic = stm.id
            attach(id, stm, true)
          }
        } else {
          setShares(r => ({ ...r, [id]: stm }))
          stm.addEventListener('removetrack', ev => { if (ev.track === e.track) dropShareOf(id, stm) })
        }
      }
      pc.onconnectionstatechange = () => {
        if (pcs[id] !== pc) return
        const cs = pc.connectionState
        if (cs === 'connected') {
          clearTimeout(st.watch)
          clearTimeout(st.dis)
          setMember(id, 'connected')
          sendState(id, rsid)
          wake()
        } else if (cs === 'failed') {
          setMember(id, 'connecting')
          recover(id, pc)
        } else if (cs === 'disconnected') {
          setMember(id, 'connecting')
          clearTimeout(st.dis)
          st.dis = setTimeout(() => { if (pcs[id] === pc && pc.connectionState !== 'connected') recover(id, pc) }, 2500)
        } else if (cs === 'closed') {
          clearTimeout(st.watch)
        }
      }
      pcs[id] = pc
      setMembers(m => (m[id] ? m : { ...m, [id]: 'connecting' }))
      arm(id, pc)
      sendState(id, rsid)
      return pc
    }

    // I am the one who starts this link
    const connect = (id, rsid) => {
      if (closed || !stream.current) return
      drop(id, true)
      make(id, rsid, newId())
    }

    // I am the one who waits: if the other side never sends its offer, ask for it again
    const expect = id => {
      if (waits[id]) return
      const again = () => {
        waits[id] = null
        if (closed) return
        const r = roster[id]
        if (!r) return
        const pc = pcs[id]
        if (pc && pc.rsid === r.sid && pc.connectionState === 'connected') return
        if (!pc || pc.rsid !== r.sid) send({ type: 'redo', to: id, tsid: r.sid })
        waits[id] = setTimeout(again, 3000)
      }
      waits[id] = setTimeout(again, 2000)
    }

    const ensure = id => {
      const r = roster[id]
      if (closed || !r || !stream.current) return
      setMembers(m => (m[id] ? m : { ...m, [id]: 'connecting' }))
      const pc = pcs[id]
      if (offers(id)) {
        if (!pc || pc.rsid !== r.sid) connect(id, r.sid)
      } else {
        if (pc && pc.rsid !== r.sid) drop(id, true)
        expect(id)
      }
    }

    const drain = async pc => {
      const list = pc.st.pending.splice(0)
      for (const c of list) {
        try { await pc.addIceCandidate(c) } catch {}
      }
    }

    const handle = async m => {
      if (closed || !m || !m.from || m.from === uid) return
      if (m.to && m.to !== uid) return
      if (m.tsid && m.tsid !== sid) return
      if (gone.has(m.fsid)) return
      const id = m.from

      if (m.type === 'desc') {
        const d = m.data
        let pc = pcs[id]
        if (!pc || pc.lid !== m.lid) {
          // the side that owns the link only listens to its own link; the other side follows any new offer
          if (offers(id) || d.type !== 'offer' || !stream.current) return
          drop(id, true)
          pc = make(id, m.fsid, m.lid)
          const k = `${id}:${m.lid}`
          if (early[k]) { pc.st.pending.push(...early[k]); delete early[k] }
        }
        const st = pc.st
        const collision = d.type === 'offer' && (st.making || pc.signalingState !== 'stable')
        st.ignore = !st.polite && collision
        if (st.ignore) return
        await pc.setRemoteDescription(d)
        await drain(pc)
        if (d.type === 'offer') {
          await pc.setLocalDescription()
          if (pcs[id] !== pc) return
          const a = pc.localDescription
          send({ type: 'desc', to: id, tsid: m.fsid, lid: m.lid, data: { type: a.type, sdp: a.sdp } })
        }
      } else if (m.type === 'ice') {
        const list = Array.isArray(m.data) ? m.data : [m.data]
        const pc = pcs[id]
        if (!pc || pc.lid !== m.lid) {
          const k = `${id}:${m.lid}`
          early[k] = [...(early[k] || []), ...list]
          return
        }
        if (!pc.remoteDescription) { pc.st.pending.push(...list); return }
        for (const c of list) {
          try { await pc.addIceCandidate(c) } catch {}
        }
      } else if (m.type === 'redo') {
        // the other side is waiting for me to start the link
        if (!offers(id)) return
        const pc = pcs[id]
        if (pc && pc.rsid === m.fsid && Date.now() - pc.st.born < 3500) return
        if (!roster[id] || roster[id].sid !== m.fsid) roster[id] = { sid: m.fsid, t: Date.now() }
        connect(id, m.fsid)
      } else if (m.type === 'state') {
        setPeerMic(r => ({ ...r, [id]: m.mic }))
        setPeerDeaf(r => ({ ...r, [id]: !!m.deaf }))
      } else if (m.type === 'share') {
        if (!m.on) dropShare(id)
      } else if (m.type === 'bye') {
        gone.add(m.fsid)
        if (roster[id]?.sid === m.fsid) delete roster[id]
        if (pcs[id]?.rsid === m.fsid) drop(id)
        else if (!roster[id] && !pcs[id]) drop(id)
      }
    }

    const readRoster = () => {
      const next = {}
      for (const metas of Object.values(channel.presenceState())) {
        for (const p of metas) {
          if (!p.uid || p.uid === uid || p.sid === sid || gone.has(p.sid)) continue
          if (!next[p.uid] || (p.t || 0) > next[p.uid].t) next[p.uid] = { sid: p.sid, t: p.t || 0 }
        }
      }
      return next
    }

    const syncRoster = () => {
      if (closed || !channel) return
      const next = readRoster()
      Object.keys(next).forEach(id => { roster[id] = next[id]; ensure(id) })
    }

    // sound only exists when the person picks a whole screen or a tab and ticks "share audio" in the browser dialog
    // (newer Chrome can also offer the sound of one single window)
    const pickScreen = async () => {
      const md = navigator.mediaDevices
      const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      try {
        return await md.getDisplayMedia({ video: { frameRate: 30 }, audio, systemAudio: 'include', windowAudio: 'window' })
      } catch (e) {
        if (e?.name !== 'TypeError') throw e
        try { return await md.getDisplayMedia({ video: { frameRate: 30 }, audio }) } catch (e2) {
          if (e2?.name !== 'TypeError') throw e2
          return md.getDisplayMedia({ video: { frameRate: 30 }, audio: true })
        }
      }
    }

    const NO_SOUND = 'Your share has no sound. In the browser window choose "Entire screen" (or a tab) and tick "Share system audio" / "Share tab audio". A single window usually cannot carry sound.'

    const beginShare = stm => {
      const vt = stm.getVideoTracks()[0]
      const at = stm.getAudioTracks()[0]
      try { vt.contentHint = 'detail' } catch {}
      vt.onended = () => api.current.stopShare()
      screenRef.current = stm
      setScreen(stm)
      setShareNote(at ? '' : NO_SOUND)
      Object.entries(pcs).forEach(([id, pc]) => { senders[id] = [pc.addTrack(vt, stm), ...(at ? [pc.addTrack(at, stm)] : [])] })
      send({ type: 'share', on: true })
    }

    const startShare = async () => {
      beginShare(await pickScreen())
    }

    const stopShare = quiet => {
      const stm = screenRef.current
      if (!stm) return
      screenRef.current = null
      setScreen(null)
      setShareNote('')
      stm.getTracks().forEach(t => { t.onended = null; t.stop() })
      Object.entries(pcs).forEach(([id, pc]) => {
        ;(senders[id] || []).forEach(sd => { try { pc.removeTrack(sd) } catch {} })
        delete senders[id]
      })
      if (quiet !== true) send({ type: 'share', on: false })
    }

    // pick another screen or window while sharing, the viewers keep watching without a break
    const changeShare = async () => {
      const old = screenRef.current
      if (!old) return startShare()
      const next = await pickScreen() // cancelling the picker throws and the current share stays
      const nv = next.getVideoTracks()[0]
      const na = next.getAudioTracks()[0]
      if (!!old.getAudioTracks()[0] !== !!na) {
        stopShare(true)
        beginShare(next)
        return
      }
      await Promise.all(Object.keys(pcs).map(id => {
        const [vs, as] = senders[id] || []
        return Promise.all([vs ? vs.replaceTrack(nv) : null, as && na ? as.replaceTrack(na) : null]).catch(() => {})
      }))
      try { nv.contentHint = 'detail' } catch {}
      nv.onended = () => api.current.stopShare()
      old.getTracks().forEach(t => { t.onended = null; t.stop() })
      screenRef.current = next
      setScreen(next)
      setShareNote(na ? '' : NO_SOUND)
    }

    // swaps the microphone while the call keeps running, nobody has to reconnect
    const switchMic = async id => {
      const s = await getMic(id)
      if (closed) { s.getTracks().forEach(t => t.stop()); return }
      const nt = s.getAudioTracks()[0]
      nt.enabled = micRef.current
      await Promise.all(Object.values(pcs).map(pc => {
        const sd = pc.getSenders().find(x => x.track?.kind === 'audio')
        return sd ? sd.replaceTrack(nt).catch(() => {}) : null
      }))
      const old = stream.current
      stream.current = s
      old?.getTracks().forEach(t => t.stop())
      setLocal(s)
      attach('local', s, false)
      refreshDevices()
    }

    const setSink = async id => {
      Object.values(nodes).forEach(n => { try { n.el?.setSinkId?.(id || '')?.catch?.(() => {}) } catch {} })
      if (!ctx.setSinkId) return
      try { await ctx.setSinkId(id || '') } catch {}
    }

    api.current = { send, myState, startShare, stopShare, changeShare, switchMic, setSink }

    ;(async () => {
      const s = await getMic(getSaved(MIC_KEY))
      if (closed) { s.getTracks().forEach(t => t.stop()); return }
      stream.current = s
      setLocal(s)
      attach('local', s, false)
      refreshDevices()

      // supabase.channel() hands back the OLD channel while it is still closing (leaving and joining
      // again quickly, or React dev double mount). Talking on it means nobody hears you, so wait for it.
      const topic = `realtime:call:${conversationId}`
      for (let i = 0; i < 40 && supabase.getChannels().some(c => c.topic === topic); i++) await new Promise(r => setTimeout(r, 80))
      if (closed) return

      channel = supabase.channel(`call:${conversationId}`, { config: { broadcast: { self: false }, presence: { key: sid } } })
      channel.on('broadcast', { event: 'sig' }, ({ payload }) => {
        queue = queue.then(() => handle(payload)).catch(() => {})
      })
      channel.on('presence', { event: 'sync' }, syncRoster)
      channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
        for (const p of leftPresences || []) {
          if (!p.uid || p.sid === sid) continue
          if (roster[p.uid]?.sid === p.sid) delete roster[p.uid]
          if (pcs[p.uid]?.rsid === p.sid) {
            const next = readRoster()
            if (next[p.uid]) { roster[p.uid] = next[p.uid]; ensure(p.uid) } else drop(p.uid)
          }
        }
      })
      channel.subscribe(st => {
        if (closed || st !== 'SUBSCRIBED') return
        // after a connection loss the links built before it may be dead for the others, start clean
        if (subscribedOnce) Object.keys(pcs).forEach(id => drop(id, true))
        subscribedOnce = true
        channel.track({ uid, sid, t: joinedAt }).catch(() => {})
        syncRoster()
      })
    })().catch(e => endRef.current?.(e))

    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices)

    // speaking detection, with a short hold so the ring does not flicker
    let beat = 0
    const meter = setInterval(() => {
      const now = performance.now()
      const next = {}
      for (const [id, n] of Object.entries(nodes)) {
        n.an.getByteTimeDomainData(n.data)
        let sum = 0
        for (let i = 0; i < n.data.length; i++) {
          const v = (n.data[i] - 128) / 128
          sum += v * v
        }
        if (Math.sqrt(sum / n.data.length) > 0.025) n.last = now
        next[id] = now - n.last < 320
      }
      setSpeaking(prev => (same(prev, next) ? prev : next))
      // about once a second: wake a sleeping audio engine, every few seconds: repeat my mute state
      // (a lost message can never leave someone shown with the wrong state for long)
      if (++beat % 12 === 0) {
        if (ctx.state !== 'running') wake()
        if (beat % 60 === 0 && channel) send(myState())
      }
    }, 80)
    const clockTimer = setInterval(() => setSecs(v => v + 1), 1000)

    return () => {
      closed = true
      clearInterval(meter)
      clearInterval(clockTimer)
      wakeEvents.forEach(e => window.removeEventListener(e, wake, true))
      document.removeEventListener('visibilitychange', wake)
      navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices)
      ctx.onstatechange = null
      if (channel) {
        send({ type: 'share', on: false })
        send({ type: 'bye' })
      }
      Object.values(waits).forEach(clearTimeout)
      Object.keys(pcs).forEach(id => drop(id))
      Object.keys(nodes).forEach(release)
      stream.current?.getTracks().forEach(t => t.stop())
      screenRef.current?.getTracks().forEach(t => { t.onended = null; t.stop() })
      screenRef.current = null
      if (channel) {
        channel.untrack().catch?.(() => {})
        supabase.removeChannel(channel)
      }
      ctx.close().catch(() => {})
    }
  }, [conversationId, uid])

  function applyMic(on) {
    stream.current?.getAudioTracks().forEach(t => { t.enabled = on })
    micRef.current = on
    setMic(on)
  }

  const announce = () => api.current.send?.(api.current.myState())

  function setDeafened(on) {
    deafRef.current = on
    setDeaf(on)
    syncAll()
  }

  // like Discord: unmuting while deafened also undeafens
  function toggleMic() {
    if (deafRef.current) { setDeafened(false); applyMic(true) } else applyMic(!micRef.current)
    announce()
  }

  // deafen silences everyone for you and mutes your mic, undeafen puts the mic back as it was
  function toggleDeaf() {
    if (!deafRef.current) {
      wasOn.current = micRef.current
      setDeafened(true)
      applyMic(false)
    } else {
      setDeafened(false)
      if (wasOn.current) applyMic(true)
    }
    announce()
  }

  async function chooseMic(id) {
    setMicId(id)
    setSaved(MIC_KEY, id)
    try { await api.current.switchMic?.(id) } catch { setShareErr('Could not use that microphone') }
  }

  function chooseOut(id) {
    setOutId(id)
    setSaved(OUT_KEY, id)
    api.current.setSink?.(id)
  }

  async function toggleShare() {
    setShareErr('')
    try {
      if (screen) api.current.stopShare()
      else await api.current.startShare()
    } catch (e) {
      // dismissing the browser picker is not an error worth showing
      if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') setShareErr('Could not share the screen')
    }
  }

  const canShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia
  const ids = Object.keys(members)
  const openMenu = id => e => {
    e.preventDefault()
    if (id === uid) return
    ctxRef.current?.resume().catch(() => {})
    setMenu({ id, x: e.clientX, y: e.clientY })
  }
  const openScreenMenu = id => e => {
    e.preventDefault()
    ctxRef.current?.resume().catch(() => {})
    setMenu({ id, x: e.clientX, y: e.clientY, screen: true })
  }
  async function changeShare() {
    setShareErr('')
    try { await api.current.changeShare() } catch (e) {
      if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') setShareErr('Could not change the shared screen')
    }
  }
  const closeMenu = () => setMenu(null)
  const closeDev = () => setDevOpen(false)
  const sharing = [
    ...(screen ? [[uid, screen, 'Your screen']] : []),
    ...Object.entries(shares).map(([id, s]) => [id, s, `${people[id]?.display_name || 'Someone'}'s screen`])
  ]

  const badgeOf = id => {
    if (prefs[id]?.muted) return 'Muted by you'
    if (peerDeaf[id]) return 'Deafened'
    if (peerMic[id] === false) return 'Muted'
    if (members[id] === 'connecting') return 'Connecting...'
    return ''
  }
  const talkOf = id => !!speaking[id] && !prefs[id]?.muted && peerMic[id] !== false && !peerDeaf[id]
  const youTalk = mic && !!speaking.local
  const devProps = {
    inputs: devs.inputs,
    outputs: devs.outputs,
    micId,
    outId,
    canOut,
    onMic: chooseMic,
    onOut: chooseOut,
    onClose: closeDev
  }

  const menuKey = menu ? (menu.screen ? `screen:${menu.id}` : menu.id) : null
  const who = menu ? (people[menu.id]?.display_name || 'Someone') : ''
  let menuNode = null
  if (menu?.screen && menu.id === uid) {
    menuNode = <Menu x={menu.x} y={menu.y} name="Your screen" onChange={changeShare} onStop={() => api.current.stopShare()} note={shareNote || undefined} onClose={closeMenu} />
  } else if (menu?.screen && !shareAudio[menu.id]) {
    menuNode = <Menu x={menu.x} y={menu.y} name={`${who}'s screen`} note="This screen is being shared without sound." onClose={closeMenu} />
  } else if (menu) {
    menuNode = (
      <Menu
        x={menu.x}
        y={menu.y}
        name={menu.screen ? `${who}'s screen` : who}
        vol={prefs[menuKey]?.vol ?? 100}
        muted={!!prefs[menuKey]?.muted}
        onVol={v => setPref(menuKey, { vol: v })}
        onMute={() => setPref(menuKey, { muted: !prefs[menuKey]?.muted })}
        onClose={closeMenu}
      />
    )
  }
  const menuEl = menuNode && (fsEl ? createPortal(menuNode, fsEl) : menuNode)

  // minimized: a small panel that stays on screen while the rest of the app is used.
  // One single markup for both widths, so the pieces can travel instead of being swapped.
  if (minimized) {
    const shown = ids.slice(0, 3)
    const gone = compact ? 'gone' : ''
    return (
      <div className={`dock ${compact ? 'mini' : ''}`} ref={dockRef}>
        <button className="dockinfo" onClick={onExpand} title={compact ? `${title} · ${ids.length + 1} in call · open the call` : 'Back to the call'}>
          <span className="live" data-flip="dot" />
          <span className={`dtxt ${gone}`}>
            <b>{title}</b>
            <small>{ids.length + 1} in call · {clock(secs)}{sharing.length > 0 ? ' · screen' : ''}</small>
          </span>
          <small className={`dclock ${compact ? '' : 'gone'}`}>
            <span>{clock(secs)}</span>
            {sharing.length > 0 && <Icon n="monitor" size={11} />}
          </small>
          <span className={`dexp ${gone}`}><Icon n="upRight" size={16} /></span>
        </button>
        <div className="mavs">
          {local && (
            <span data-flip="av-you" className={`mav ${youTalk ? 'talk' : ''}`} title="You">
              <Avatar url={people[uid]?.avatar_url} name={people[uid]?.display_name} size={20} />
            </span>
          )}
          {shown.map(id => (
            <span key={id} data-flip={`av-${id}`} className={`mav ${talkOf(id) ? 'talk' : ''}`} title={people[id]?.display_name}>
              <Avatar url={people[id]?.avatar_url} name={people[id]?.display_name} size={20} />
            </span>
          ))}
          {ids.length > 3 && <span data-flip="more" className="mmore" title={`${ids.length - 3} more`}>+{ids.length - 3}</span>}
        </div>
        <div className="dbtns">
          <button data-flip="b-mic" className={`ib ${mic ? 'ghost' : 'off'}`} onClick={toggleMic} title={mic ? 'Mute microphone' : 'Unmute microphone'}>
            <Icon n={mic ? 'mic' : 'micOff'} />
          </button>
          <button data-flip="b-deaf" className={`ib ${deaf ? 'off' : 'ghost'}`} onClick={toggleDeaf} title={deaf ? 'Undeafen' : 'Deafen (mute everyone)'}>
            <Icon n={deaf ? 'phonesOff' : 'phones'} />
          </button>
          <button data-flip="b-dev" className={`ib ghost ${devOpen ? 'on' : ''} ${gone}`} data-devbtn onClick={() => setDevOpen(v => !v)} title="Change microphone / speaker">
            <Icon n="sliders" />
          </button>
          <button data-flip="b-exp" className={`ib ghost ${gone}`} onClick={onExpand} title="Open the call">
            <Icon n="upRight" />
          </button>
          <button data-flip="b-end" className="ib end" onClick={() => onEnd()} title="Leave call">
            <Icon n="hangup" />
          </button>
        </div>
        {shareErr && !compact && <small className="err cerr">{shareErr}</small>}
        {devOpen && !compact && <DevicePanel {...devProps} className="dockpop" />}
        {menuEl}
      </div>
    )
  }

  const bubbles = (
    <div className="bubbles">
      {local && (
        <Bubble
          p={people[uid]}
          you
          small={sharing.length > 0}
          talking={youTalk}
          badge={deaf ? 'Deafened' : mic ? '' : 'Muted'}
          onMenu={openMenu(uid)}
        />
      )}
      {ids.map(id => (
        <Bubble
          key={id}
          p={people[id]}
          small={sharing.length > 0}
          talking={talkOf(id)}
          badge={badgeOf(id)}
          onMenu={openMenu(id)}
        />
      ))}
    </div>
  )

  return (
    <div className="call">
      <div className="chead">
        <button className="ghost minbtn" onClick={onMinimize} title="Minimize: keep the call running and use the rest of the app">
          <Icon n="downLeft" size={16} /> Minimize
        </button>
        <b>{title}</b>
        <small>{ids.length + 1} in call</small>
        <span className="clock">{clock(secs)}</span>
      </div>
      <div className={`stage ${sharing.length ? 'has' : ''}`}>
        {sharing.length > 0 && (
          <div className="screens">
            {sharing.map(([id, stm, label]) => <Screen key={id} stream={stm} label={label} hasAudio={id === uid ? !!screen?.getAudioTracks().length : !!shareAudio[id]} onMenu={openScreenMenu(id)} />)}
          </div>
        )}
        {bubbles}
        {ids.length === 0 && local && <p className="wait">Waiting for others<span className="caret">_</span></p>}
      </div>
      {shareErr && <small className="err cerr">{shareErr}</small>}
      {shareNote && <small className="note cerr">{shareNote}</small>}
      <div className="bar">
        <button className={`ib ${mic ? 'ghost' : 'off'}`} onClick={toggleMic} title={mic ? 'Mute microphone' : 'Unmute microphone'} aria-label={mic ? 'Mute microphone' : 'Unmute microphone'}>
          <Icon n={mic ? 'mic' : 'micOff'} size={22} />
        </button>
        <button className={`ib ${deaf ? 'off' : 'ghost'}`} onClick={toggleDeaf} title={deaf ? 'Undeafen' : 'Deafen (mute everyone)'} aria-label={deaf ? 'Undeafen' : 'Deafen'}>
          <Icon n={deaf ? 'phonesOff' : 'phones'} size={22} />
        </button>
        {canShare && (
          <button className={`ib ${screen ? '' : 'ghost'}`} onClick={toggleShare} title={screen ? 'Stop sharing' : 'Share your screen'} aria-label={screen ? 'Stop sharing' : 'Share your screen'}>
            <Icon n={screen ? 'monitorOff' : 'monitor'} size={22} />
          </button>
        )}
        <button className={`ib ghost ${devOpen ? 'on' : ''}`} data-devbtn onClick={() => setDevOpen(v => !v)} title="Change microphone / speaker" aria-label="Audio devices">
          <Icon n="sliders" size={22} />
        </button>
        <button className="ib end" onClick={() => onEnd()} title="Leave call" aria-label="Leave call">
          <Icon n="hangup" size={22} />
        </button>
        {devOpen && <DevicePanel {...devProps} className="barpop" />}
      </div>
      {menuEl}
    </div>
  )
}