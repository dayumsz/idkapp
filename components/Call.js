'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]
if (process.env.NEXT_PUBLIC_TURN_URL) {
  iceServers.push({
    urls: process.env.NEXT_PUBLIC_TURN_URL,
    username: process.env.NEXT_PUBLIC_TURN_USER,
    credential: process.env.NEXT_PUBLIC_TURN_CRED
  })
}

function Tile({ stream, label, muted }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.srcObject = stream }, [stream])
  return (
    <div className="tile">
      <video ref={ref} autoPlay playsInline muted={muted} />
      <span>{label}</span>
    </div>
  )
}

export default function Call({ conversationId, uid, video, names, onEnd }) {
  const [local, setLocal] = useState(null)
  const [remotes, setRemotes] = useState({})
  const [mic, setMic] = useState(true)
  const stream = useRef(null)

  useEffect(() => {
    let channel
    let closed = false
    const pcs = {}

    const send = payload => channel?.send({ type: 'broadcast', event: 'sig', payload: { ...payload, from: uid } })

    const drop = id => {
      pcs[id]?.close()
      delete pcs[id]
      setRemotes(r => { const n = { ...r }; delete n[id]; return n })
    }

    const make = id => {
      const pc = new RTCPeerConnection({ iceServers })
      stream.current.getTracks().forEach(t => pc.addTrack(t, stream.current))
      pc.onicecandidate = e => e.candidate && send({ type: 'ice', to: id, data: e.candidate })
      pc.ontrack = e => setRemotes(r => ({ ...r, [id]: e.streams[0] }))
      pc.onconnectionstatechange = () => ['failed', 'closed'].includes(pc.connectionState) && drop(id)
      pcs[id] = pc
      return pc
    }

    ;(async () => {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video })
      if (closed) { s.getTracks().forEach(t => t.stop()); return }
      stream.current = s
      setLocal(s)
      channel = supabase.channel(`call:${conversationId}`, { config: { broadcast: { self: false } } })
      channel.on('broadcast', { event: 'sig' }, async ({ payload: m }) => {
        if (m.to && m.to !== uid) return
        if (m.type === 'hello') {
          drop(m.from)
          const pc = make(m.from)
          const o = await pc.createOffer()
          await pc.setLocalDescription(o)
          send({ type: 'offer', to: m.from, data: o })
        } else if (m.type === 'offer') {
          drop(m.from)
          const pc = make(m.from)
          await pc.setRemoteDescription(m.data)
          const a = await pc.createAnswer()
          await pc.setLocalDescription(a)
          send({ type: 'answer', to: m.from, data: a })
        } else if (m.type === 'answer') {
          await pcs[m.from]?.setRemoteDescription(m.data)
        } else if (m.type === 'ice') {
          await pcs[m.from]?.addIceCandidate(m.data).catch(() => {})
        } else if (m.type === 'bye') {
          drop(m.from)
        }
      })
      channel.subscribe(st => { if (st === 'SUBSCRIBED') send({ type: 'hello' }) })
    })().catch(onEnd)

    return () => {
      closed = true
      send({ type: 'bye' })
      Object.keys(pcs).forEach(drop)
      stream.current?.getTracks().forEach(t => t.stop())
      if (channel) supabase.removeChannel(channel)
    }
  }, [conversationId, uid, video])

  function toggleMic() {
    stream.current?.getAudioTracks().forEach(t => { t.enabled = !mic })
    setMic(!mic)
  }

  return (
    <div className="call">
      <div className="grid">
        {local && <Tile stream={local} label="You" muted />}
        {Object.entries(remotes).map(([id, s]) => <Tile key={id} stream={s} label={names[id]} />)}
      </div>
      <div className="bar">
        <button onClick={toggleMic}>{mic ? 'Mute' : 'Unmute'}</button>
        <button className="end" onClick={onEnd}>End call</button>
      </div>
    </div>
  )
}
