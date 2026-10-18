'use client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import Avatar from './Avatar'
import { Icon } from '../lib/icons'

const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]
if (process.env.NEXT_PUBLIC_TURN_URL) {
  iceServers.push({
    urls: process.env.NEXT_PUBLIC_TURN_URL,
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
const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }

// tries the chosen microphone first and falls back to the default one if it is gone
async function getMic(id) {
  if (id) {
    try { return await navigator.mediaDevices.getUserMedia({ audio: { ...AUDIO, deviceId: { exact: id } } }) } catch {}
  }
  return navigator.mediaDevices.getUserMedia({ audio: AUDIO })
}

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
  const [remotes, setRemotes] = useState({})
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
  const syncGain = id => {
    const n = nodesRef.current[id]
    if (n?.gain && ctxRef.current) n.gain.gain.setTargetAtTime(gainOf(id), ctxRef.current.currentTime, 0.02)
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
    let queue = Promise.resolve()
    const pcs = pcsRef.current
    const senders = sendersRef.current
    const nodes = nodesRef.current
    const Ctx = window.AudioContext || window.webkitAudioContext
    const ctx = new Ctx()
    ctxRef.current = ctx
    ctx.resume().catch(() => {})
    const savedOut = getSaved(OUT_KEY)
    if (savedOut && ctx.setSinkId) ctx.setSinkId(savedOut).catch(() => {})

    const send = payload => channel?.send({ type: 'broadcast', event: 'sig', payload: { ...payload, from: uid } })
    const myState = () => ({ type: 'state', mic: micRef.current, deaf: deafRef.current })

    const refreshDevices = async () => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices()
        if (!closed) setDevs({ inputs: all.filter(d => d.kind === 'audioinput'), outputs: all.filter(d => d.kind === 'audiooutput') })
      } catch {}
    }

    const release = id => {
      const n = nodes[id]
      if (!n) return
      try { n.src.disconnect(); n.an.disconnect(); n.gain?.disconnect() } catch {}
      if (n.el) n.el.srcObject = null
      delete nodes[id]
    }

    // remote audio goes through a gain node so the volume can go above 100%
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
        el.srcObject = s
        el.muted = true
        el.play().catch(() => {})
        gain = ctx.createGain()
        src.connect(gain)
        gain.connect(ctx.destination)
      }
      nodes[id] = { src, an, gain, el, data: new Uint8Array(an.fftSize), last: 0 }
      syncGain(id)
    }

    const dropShare = id => setShares(r => { if (!r[id]) return r; const n = { ...r }; delete n[id]; return n })

    const drop = id => {
      const pc = pcs[id]
      if (pc) { pc.onconnectionstatechange = null; pc.close() }
      delete pcs[id]
      delete senders[id]
      release(id)
      setRemotes(r => { const n = { ...r }; delete n[id]; return n })
      setPeerMic(r => { const n = { ...r }; delete n[id]; return n })
      setPeerDeaf(r => { const n = { ...r }; delete n[id]; return n })
      dropShare(id)
    }

    // perfect negotiation: both sides may renegotiate (screen share) without colliding
    const make = id => {
      const pc = new RTCPeerConnection({ iceServers })
      const st = { making: false, ignore: false, polite: uid < id }
      pc.st = st
      stream.current.getTracks().forEach(t => pc.addTrack(t, stream.current))
      if (screenRef.current) {
        const t = screenRef.current.getVideoTracks()[0]
        senders[id] = [pc.addTrack(t, screenRef.current)]
      }
      pc.onicecandidate = e => e.candidate && send({ type: 'ice', to: id, data: e.candidate })
      pc.onnegotiationneeded = async () => {
        try {
          st.making = true
          await pc.setLocalDescription()
          send({ type: 'desc', to: id, data: pc.localDescription })
        } catch {} finally { st.making = false }
      }
      pc.ontrack = e => {
        if (e.track.kind === 'audio') {
          setRemotes(r => ({ ...r, [id]: e.streams[0] }))
          attach(id, e.streams[0], true)
        } else {
          setShares(r => ({ ...r, [id]: e.streams[0] }))
        }
      }
      pc.onconnectionstatechange = () => {
        if (pcs[id] === pc && ['failed', 'closed'].includes(pc.connectionState)) drop(id)
      }
      pcs[id] = pc
      return pc
    }

    const handle = async m => {
      if (closed || (m.to && m.to !== uid)) return
      if (m.type === 'hello') {
        drop(m.from)
        make(m.from)
        send({ ...myState(), to: m.from })
      } else if (m.type === 'desc') {
        const pc = pcs[m.from] || make(m.from)
        const st = pc.st
        const collision = m.data.type === 'offer' && (st.making || pc.signalingState !== 'stable')
        st.ignore = !st.polite && collision
        if (st.ignore) return
        await pc.setRemoteDescription(m.data)
        if (m.data.type === 'offer') {
          await pc.setLocalDescription()
          send({ type: 'desc', to: m.from, data: pc.localDescription })
        }
      } else if (m.type === 'ice') {
        const pc = pcs[m.from]
        try { await pc?.addIceCandidate(m.data) } catch (e) { if (!pc?.st.ignore) throw e }
      } else if (m.type === 'state') {
        setPeerMic(r => ({ ...r, [m.from]: m.mic }))
        setPeerDeaf(r => ({ ...r, [m.from]: !!m.deaf }))
      } else if (m.type === 'share') {
        if (!m.on) dropShare(m.from)
      } else if (m.type === 'bye') {
        drop(m.from)
      }
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
      channel = supabase.channel(`call:${conversationId}`, { config: { broadcast: { self: false } } })
      channel.on('broadcast', { event: 'sig' }, ({ payload }) => {
        queue = queue.then(() => handle(payload)).catch(() => {})
      })
      channel.subscribe(st => { if (st === 'SUBSCRIBED') send({ type: 'hello' }) })
    })().catch(e => endRef.current?.(e))

    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices)

    // speaking detection, with a short hold so the ring does not flicker
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
    }, 80)
    const clockTimer = setInterval(() => setSecs(v => v + 1), 1000)

    return () => {
      closed = true
      clearInterval(meter)
      clearInterval(clockTimer)
      navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices)
      send({ type: 'share', on: false })
      send({ type: 'bye' })
      Object.keys(pcs).forEach(drop)
      Object.keys(nodes).forEach(release)
      stream.current?.getTracks().forEach(t => t.stop())
      screenRef.current?.getTracks().forEach(t => { t.onended = null; t.stop() })
      screenRef.current = null
      if (channel) supabase.removeChannel(channel)
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
  const ids = Object.keys(remotes)
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
