'use client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import Avatar from './Avatar'
import { Icon } from '../lib/icons'

// Without a TURN relay, people behind mobile data / CGNAT / strict routers can never reach each other and
// stay on "Connecting..." forever. NEXT_PUBLIC_TURN_URL accepts several urls separated by commas
// (turn:host:3478, turn:host:443?transport=tcp, turns:host:443?transport=tcp) so restrictive networks have a way out.
const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }]
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

function Screen({ stream, label }) {
  const ref = useRef(null)
  const box = useRef(null)
  useEffect(() => { if (ref.current) ref.current.srcObject = stream }, [stream])
  return (
    <div className="screen" ref={box}>
      <video ref={ref} autoPlay playsInline muted />
      <span className="lbl">{label}</span>
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

function Menu({ x, y, name, vol, muted, onVol, onMute, onClose }) {
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
      <button className={muted ? '' : 'ghost'} onClick={onMute}>{muted ? 'Unmute' : 'Mute'}</button>
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
      <button className="ghost" disabled={vol === 100} onClick={() => onVol(100)}>Reset volume</button>
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

export default function Call({ conversationId, uid, title, people, minimized, onMinimize, onExpand, onEnd }) {
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

    const dropShare = id => setShares(r => { if (!r[id]) return r; const n = { ...r }; delete n[id]; return n })
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
    const arm = (id, pc, ms = 9000) => {
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
      const pc = new RTCPeerConnection({ iceServers })
      const st = { making: false, ignore: false, polite: uid < id, pending: [], out: [], ft: null, watch: null, dis: null, restarts: 0, born: Date.now() }
      pc.st = st
      pc.lid = lid
      pc.rsid = rsid
      stream.current.getTracks().forEach(t => pc.addTrack(t, stream.current))
      if (screenRef.current) {
        const t = screenRef.current.getVideoTracks()[0]
        senders[id] = [pc.addTrack(t, screenRef.current)]
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
        const s = e.streams[0] || new MediaStream([e.track])
        if (e.track.kind === 'audio') {
          attach(id, s, true)
        } else {
          setShares(r => ({ ...r, [id]: s }))
          s.addEventListener('removetrack', () => dropShare(id))
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
          st.dis = setTimeout(() => { if (pcs[id] === pc && pc.connectionState !== 'connected') recover(id, pc) }, 4000)
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
        waits[id] = setTimeout(again, 6000)
      }
      waits[id] = setTimeout(again, 4500)
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

    const startShare = async () => {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false })
      const t = s.getVideoTracks()[0]
      try { t.contentHint = 'detail' } catch {}
      t.onended = () => api.current.stopShare()
      screenRef.current = s
      setScreen(s)
      Object.entries(pcs).forEach(([id, pc]) => { senders[id] = [pc.addTrack(t, s)] })
      send({ type: 'share', on: true })
    }

    const stopShare = () => {
      const s = screenRef.current
      if (!s) return
      screenRef.current = null
      setScreen(null)
      s.getTracks().forEach(t => { t.onended = null; t.stop() })
      Object.entries(pcs).forEach(([id, pc]) => {
        ;(senders[id] || []).forEach(sd => { try { pc.removeTrack(sd) } catch {} })
        delete senders[id]
      })
      send({ type: 'share', on: false })
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

    api.current = { send, myState, startShare, stopShare, switchMic, setSink }

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

  const menuEl = menu && (
    <Menu
      x={menu.x}
      y={menu.y}
      name={people[menu.id]?.display_name}
      vol={prefs[menu.id]?.vol ?? 100}
      muted={!!prefs[menu.id]?.muted}
      onVol={v => setPref(menu.id, { vol: v })}
      onMute={() => setPref(menu.id, { muted: !prefs[menu.id]?.muted })}
      onClose={closeMenu}
    />
  )

  // minimized: a small panel that stays on screen while the rest of the app is used
  if (minimized) {
    return (
      <div className="dock">
        <button className="dockinfo" onClick={onExpand} title="Back to the call">
          <span className="live" />
          <span className="dtxt">
            <b>{title}</b>
            <small>{ids.length + 1} in call · {clock(secs)}{sharing.length > 0 ? ' · screen' : ''}</small>
          </span>
          <span className="dexp"><Icon n="upRight" size={16} /></span>
        </button>
        <div className="mavs">
          {local && <span className={`mav ${youTalk ? 'talk' : ''}`}><Avatar url={people[uid]?.avatar_url} name={people[uid]?.display_name} size={26} /></span>}
          {ids.slice(0, 6).map(id => (
            <span key={id} className={`mav ${talkOf(id) ? 'talk' : ''}`}><Avatar url={people[id]?.avatar_url} name={people[id]?.display_name} size={26} /></span>
          ))}
        </div>
        <div className="dbtns">
          <button className={`ib ${mic ? 'ghost' : 'off'}`} onClick={toggleMic} title={mic ? 'Mute microphone' : 'Unmute microphone'}>
            <Icon n={mic ? 'mic' : 'micOff'} />
          </button>
          <button className={`ib ${deaf ? 'off' : 'ghost'}`} onClick={toggleDeaf} title={deaf ? 'Undeafen' : 'Deafen (mute everyone)'}>
            <Icon n={deaf ? 'phonesOff' : 'phones'} />
          </button>
          <button className={`ib ghost ${devOpen ? 'on' : ''}`} data-devbtn onClick={() => setDevOpen(v => !v)} title="Change microphone / speaker">
            <Icon n="sliders" />
          </button>
          <button className="ib ghost" onClick={onExpand} title="Open the call">
            <Icon n="upRight" />
          </button>
          <button className="ib end" onClick={() => onEnd()} title="Leave call">
            <Icon n="hangup" />
          </button>
        </div>
        {shareErr && <small className="err cerr">{shareErr}</small>}
        {devOpen && <DevicePanel {...devProps} className="dockpop" />}
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
            {sharing.map(([id, s, label]) => <Screen key={id} stream={s} label={label} />)}
          </div>
        )}
        {bubbles}
        {ids.length === 0 && local && <p className="wait">Waiting for others<span className="caret">_</span></p>}
      </div>
      {shareErr && <small className="err cerr">{shareErr}</small>}
      <div className="bar">
        <button className={mic ? 'ghost' : ''} onClick={toggleMic}>{mic ? 'Mute' : 'Unmute'}</button>
        <button className={deaf ? '' : 'ghost'} onClick={toggleDeaf}>{deaf ? 'Undeafen' : 'Deafen'}</button>
        {canShare && <button className={screen ? '' : 'ghost'} onClick={toggleShare}>{screen ? 'Stop sharing' : 'Share screen'}</button>}
        <button className={`ghost ${devOpen ? 'on' : ''}`} data-devbtn onClick={() => setDevOpen(v => !v)}>Audio devices</button>
        <button className="end" onClick={() => onEnd()}>Leave call</button>
        {devOpen && <DevicePanel {...devProps} className="barpop" />}
      </div>
      {menuEl}
    </div>
  )
}