'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { info } from '../lib/info'
import Avatar from './Avatar'
import Call from './Call'
import GroupInfo from './GroupInfo'

export default function Chat({ chat, uid, friends, actions, onBack, onProfile }) {
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [call, setCall] = useState(null)
  const [showGroup, setShowGroup] = useState(false)
  const end = useRef(null)
  const people = Object.fromEntries(chat.members.map(m => [m.profiles.id, m.profiles]))
  const names = Object.fromEntries(Object.values(people).map(p => [p.id, p.display_name]))
  const i = info(chat, uid)
  const other = chat.is_group ? null : Object.values(people).find(p => p.id !== uid)

  useEffect(() => {
    supabase.from('messages').select('*').eq('conversation_id', chat.id).order('created_at')
      .then(({ data }) => setMsgs(data || []))
    const ch = supabase
      .channel(`msgs:${chat.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${chat.id}` },
        p => setMsgs(m => (m.some(x => x.id === p.new.id) ? m : [...m, p.new])))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [chat.id])

  useEffect(() => { end.current?.scrollIntoView() }, [msgs])

  const insert = row => supabase.from('messages').insert({ conversation_id: chat.id, sender_id: uid, ...row })

  async function send(e) {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
    setText('')
    await insert({ body })
  }

  async function sendImage(e) {
    const f = e.target.files[0]
    e.target.value = ''
    if (!f || !['image/png', 'image/jpeg'].includes(f.type)) return
    const ext = f.type === 'image/png' ? 'png' : 'jpg'
    const path = `${uid}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from('chat-images').upload(path, f, { contentType: f.type })
    if (error) return
    const { data } = supabase.storage.from('chat-images').getPublicUrl(path)
    await insert({ image_url: data.publicUrl })
  }

  async function startCall(video) {
    await insert({ kind: video ? 'video' : 'voice', body: video ? 'Video call' : 'Voice call' })
    setCall({ video })
  }

  return (
    <div className="chat">
      <div className="top">
        <button className="ghost back" onClick={onBack}>Back</button>
        <Avatar url={i.avatar} name={i.name} onClick={other ? () => onProfile(other) : undefined} />
        <b>{i.name}</b>
        {chat.is_group && <button className="ghost" onClick={() => setShowGroup(true)}>Members</button>}
        <button className="ghost" onClick={() => startCall(false)}>Call</button>
        <button className="ghost" onClick={() => startCall(true)}>Video</button>
      </div>
      <div className="msgs">
        {msgs.length === 0 && <div className="empty small">No messages yet<span className="caret">_</span></div>}
        {msgs.map(m => {
          if (m.kind !== 'text') {
            const live = Date.now() - new Date(m.created_at).getTime() < 30 * 60 * 1000
            return (
              <div key={m.id} className="sys">
                {names[m.sender_id]} started a {m.kind === 'video' ? 'video' : 'voice'} call
                {live && <button onClick={() => setCall({ video: m.kind === 'video' })}>Join</button>}
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
                {m.image_url && <img src={m.image_url} alt="" />}
                {m.body}
                <em className="time">{t}</em>
              </div>
            </div>
          )
        })}
        <div ref={end} />
      </div>
      <form className="compose" onSubmit={send}>
        <label className="attach">Attach<input type="file" accept="image/png,image/jpeg" onChange={sendImage} hidden /></label>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Message" />
        <button>Send</button>
      </form>
      {call && <Call conversationId={chat.id} uid={uid} video={call.video} names={names} onEnd={() => setCall(null)} />}
      {showGroup && (
        <GroupInfo chat={chat} uid={uid} friends={friends} actions={actions} onProfile={onProfile} onClose={() => setShowGroup(false)} />
      )}
    </div>
  )
}
