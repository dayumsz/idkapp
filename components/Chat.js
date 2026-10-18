'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { info } from '../lib/info'
import Avatar from './Avatar'
import GroupInfo from './GroupInfo'
import { Attachment, Once, Pic } from './Media'

const TYPES = ['image/png', 'image/jpeg']
const MAX_IMAGE = 10 * 1024 * 1024

export default function Chat({ chat, uid, friends, actions, inCall, roomUsers, onJoinCall, onOpenCall, onBack, onProfile }) {
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [tick, setTick] = useState(0)
  const [showGroup, setShowGroup] = useState(false)
  const [att, setAtt] = useState(null)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const [views, setViews] = useState([])
  const attRef = useRef(null)
  const end = useRef(null)
  const people = Object.fromEntries(chat.members.map(m => [m.profiles.id, m.profiles]))
  const names = Object.fromEntries(Object.values(people).map(p => [p.id, p.display_name]))
  const i = info(chat, uid)
  const other = chat.is_group ? null : Object.values(people).find(p => p.id !== uid)

  useEffect(() => {
    supabase.from('messages').select('*').eq('conversation_id', chat.id).order('created_at')
      .then(async ({ data }) => {
        const list = data || []
        setMsgs(list)
        const ids = list.filter(x => x.view_once).map(x => x.id)
        if (!ids.length) return
        const { data: v } = await supabase.from('message_views').select('message_id,user_id').in('message_id', ids)
        setViews(v || [])
      })
    const ch = supabase
      .channel(`msgs:${chat.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${chat.id}` },
        p => setMsgs(m => (m.some(x => x.id === p.new.id) ? m : [...m, p.new])))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_views' },
        p => addView(p.new.message_id, p.new.user_id))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [chat.id])

  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  // only the newest call message can still be live, and only while someone is in the room
  const lastCallId = [...msgs].reverse().find(x => x.kind !== 'text')?.id
  const live = !!roomUsers && roomUsers.length > 0
  useEffect(() => {
    if (!lastCallId) return
    const t = setTimeout(() => setTick(v => v + 1), 8200) // grace while the presence list catches up
    return () => clearTimeout(t)
  }, [lastCallId])
  useEffect(() => { attRef.current = att }, [att])
  useEffect(() => () => { if (attRef.current) URL.revokeObjectURL(attRef.current.url) }, [])

  const addView = (mid, user) => setViews(v => (v.some(x => x.message_id === mid && x.user_id === user) ? v : [...v, { message_id: mid, user_id: user }]))

  function flash(msg) {
    setErr(msg)
    setTimeout(() => setErr(''), 3200)
  }

  const insert = row => supabase.from('messages').insert({ conversation_id: chat.id, sender_id: uid, ...row })

  async function send(e) {
    e.preventDefault()
    if (sending) return
    const body = text.trim()
    if (!body && !att) return

    if (!att) {
      setText('')
      const { error } = await insert({ body })
      if (error) flash('Message not sent')
      return
    }

    setSending(true)
    try {
      const f = att.file
      const path = `${uid}/${crypto.randomUUID()}.${f.type === 'image/png' ? 'png' : 'jpg'}`
      let error
      if (att.once) {
        const up = await supabase.storage.from('chat-once').upload(path, f, { contentType: f.type })
        if (up.error) throw new Error('Image upload failed')
        ;({ error } = await supabase.rpc('send_view_once', { cid: chat.id, path, caption: body || null }))
      } else {
        const up = await supabase.storage.from('chat-images').upload(path, f, { contentType: f.type })
        if (up.error) throw new Error('Image upload failed')
        const { data } = supabase.storage.from('chat-images').getPublicUrl(path)
        ;({ error } = await insert({ image_url: data.publicUrl, body: body || null, spoiler: att.spoiler }))
      }
      if (error) throw new Error(error.message)
      URL.revokeObjectURL(att.url)
      setAtt(null)
      setText('')
    } catch (x) {
      flash(x.message)
    }
    setSending(false)
  }

  function pickImage(e) {
    const f = e.target.files[0]
    e.target.value = ''
    if (!f) return
    if (!TYPES.includes(f.type)) return flash('Only PNG or JPEG images')
    if (f.size > MAX_IMAGE) return flash('Image too large (max 10 MB)')
    if (att) URL.revokeObjectURL(att.url)
    setAtt({ file: f, url: URL.createObjectURL(f), spoiler: false, once: false })
  }

  const toggleAtt = k => setAtt(a => ({ ...a, spoiler: k === 'spoiler' ? !a.spoiler : false, once: k === 'once' ? !a.once : false }))

  function removeAtt() {
    if (!att || att.leaving) return
    const url = att.url
    setAtt({ ...att, leaving: true })
    setTimeout(() => { URL.revokeObjectURL(url); setAtt(null) }, 180)
  }

  async function startCall() {
    if (inCall) return onOpenCall()
    // joining a call that is already running must not post a second "started a call"
    if (!live) await insert({ kind: 'voice', body: 'Voice call' })
    onJoinCall()
  }

  return (
    <div className="chat">
      <div className="top">
        <button className="ghost back" onClick={onBack}>Back</button>
        <Avatar url={i.avatar} name={i.name} onClick={other ? () => onProfile(other) : undefined} />
        <b>{i.name}</b>
        {chat.is_group && <button className="ghost" onClick={() => setShowGroup(true)}>Members</button>}
        <button className={inCall ? '' : 'ghost'} onClick={startCall}>{inCall ? 'In call' : live ? 'Join call' : 'Call'}</button>
      </div>
      <div className="msgs">
        {msgs.length === 0 && <div className="empty small">No messages yet<span className="caret">_</span></div>}
        {msgs.map(m => {
          if (m.kind !== 'text') {
            const last = m.id === lastCallId
            const fresh = Date.now() - new Date(m.created_at).getTime() < 8000
            let status = null
            if (!last) status = <span>Call ended</span>
            else if (inCall) status = <><span>You are in this call</span><button onClick={onOpenCall}>Open</button></>
            else if (live) status = <><span>{roomUsers.length} in call</span><button onClick={onJoinCall}>Join</button></>
            else if (roomUsers && !fresh) status = <span>Call ended</span>
            return (
              <div key={m.id} className="sys">
                {names[m.sender_id]} started a call
                {status}
              </div>
            )
          }
          const mine = m.sender_id === uid
          const p = people[m.sender_id]
          const t = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          return (
            <div key={m.id} className={`mrow ${mine ? 'me' : ''}`}>
              {chat.is_group && !mine && <Avatar url={p?.avatar_url} name={p?.display_name} size={28} onClick={() => p && onProfile(p)} />}
              <div className="msg">
                {chat.is_group && !mine && <small onClick={() => p && onProfile(p)}>{names[m.sender_id]}</small>}
                {m.view_once
                  ? (
                    <Once
                      m={m}
                      mine={mine}
                      isGroup={chat.is_group}
                      opened={views.some(v => v.message_id === m.id && v.user_id === uid)}
                      count={views.filter(v => v.message_id === m.id).length}
                      onOpened={() => addView(m.id, uid)}
                    />
                  )
                  : <>{m.image_url && <Pic src={m.image_url} spoiler={m.spoiler} />}{m.body}</>}
                <em className="time">{t}</em>
              </div>
            </div>
          )
        })}
        <div ref={end} />
      </div>
      {att && <Attachment att={att} busy={sending} onToggle={toggleAtt} onRemove={removeAtt} />}
      {err && <small className="err cerr">{err}</small>}
      <form className="compose" onSubmit={send}>
        <label className="attach">Attach<input type="file" accept="image/png,image/jpeg" onChange={pickImage} hidden /></label>
        <input value={text} onChange={e => setText(e.target.value)} placeholder={att ? 'Add a caption' : 'Message'} />
        <button disabled={sending}>{sending ? 'Sending...' : 'Send'}</button>
      </form>
      {showGroup && (
        <GroupInfo chat={chat} uid={uid} friends={friends} actions={actions} onProfile={onProfile} onClose={() => setShowGroup(false)} />
      )}
    </div>
  )
}
