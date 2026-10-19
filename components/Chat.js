'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { info } from '../lib/info'
import Avatar from './Avatar'
import { Icon } from '../lib/icons'
import GroupInfo from './GroupInfo'
import { Attachment, Once, Pic } from './Media'

const TYPES = ['image/png', 'image/jpeg']
const MAX_IMAGE = 10 * 1024 * 1024
const GIF_RE = /https?:\/\/[^\s<>()]+\.(?:gif)(?:\?[^\s<>()]*)?/i
const URL_RE = /https?:\/\/[^\s<>()]+/i

function playTone(kind = 'message') {
  if (typeof window === 'undefined') return
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const tones = kind === 'call' ? [[440, 0, .16], [554, .2, .18], [659, .42, .24]]
      : kind === 'ring' ? [[660, 0, .18], [880, .22, .22], [660, .55, .18], [880, .78, .22]]
      : kind === 'send' ? [[520, 0, .07], [660, .08, .08]]
      : kind === 'receive' ? [[740, 0, .1], [980, .12, .14]]
      : [[600, 0, .06]]
    tones.forEach(([freq, start, duration]) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'; osc.frequency.value = freq
      gain.gain.setValueAtTime(.0001, ctx.currentTime + start)
      gain.gain.exponentialRampToValueAtTime(.09, ctx.currentTime + start + .015)
      gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + start + duration)
      osc.connect(gain); gain.connect(ctx.destination)
      osc.start(ctx.currentTime + start); osc.stop(ctx.currentTime + start + duration + .02)
    })
    setTimeout(() => ctx.close().catch(() => {}), 1800)
  } catch {}
}

function getGifUrl(body) {
  if (!body) return null
  const match = body.match(GIF_RE)
  if (match) return match[0].replace(/[.,!?]+$/, '')
  return null
}
function renderBody(body) {
  if (!body) return null
  const gif = getGifUrl(body)
  if (gif) return <><img className="embedded-gif" src={gif} alt="GIF" loading="lazy" /><a className="embed-link" href={gif} target="_blank" rel="noreferrer">{gif}</a></>
  const url = body.match(URL_RE)?.[0]
  if (url && /(?:giphy\.com\/gifs\/|tenor\.com\/view\/)/i.test(url)) return <a className="embed-link" href={url} target="_blank" rel="noreferrer">{url}</a>
  return body
}

export default function Chat({ chat, uid, friends, actions, inCall, roomUsers, onJoinCall, onOpenCall, onBack, onProfile }) {
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [tick, setTick] = useState(0)
  const [showGroup, setShowGroup] = useState(false)
  const [att, setAtt] = useState(null)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const [views, setViews] = useState([])
  const [receipts, setReceipts] = useState([])
  const [favorites, setFavorites] = useState([])
  const [gifFavorites, setGifFavorites] = useState([])
  const [showGifs, setShowGifs] = useState(false)
  const [reply, setReply] = useState(null)
  const [menu, setMenu] = useState(null)
  const attRef = useRef(null)
  const end = useRef(null)
  const touchRef = useRef(null)
  const people = Object.fromEntries(chat.members.map(m => [m.profiles.id, m.profiles]))
  const names = Object.fromEntries(Object.values(people).map(p => [p.id, p.display_name]))
  const i = info(chat, uid)
  const other = chat.is_group ? null : Object.values(people).find(p => p.id !== uid)

  const loadReceipts = useCallback(async ids => {
    if (!ids?.length) { setReceipts([]); return }
    const { data } = await supabase.from('message_receipts').select('message_id,user_id,status,updated_at').in('message_id', ids)
    setReceipts(data || [])
  }, [])

  const loadFavorites = useCallback(async () => {
    const [{ data: fav }, { data: gifs }] = await Promise.all([
      supabase.from('message_favorites').select('message_id').eq('user_id', uid),
      supabase.from('gif_favorites').select('id,gif_url').eq('user_id', uid).order('created_at', { ascending: false })
    ])
    setFavorites((fav || []).map(x => x.message_id))
    setGifFavorites(gifs || [])
  }, [uid])

  useEffect(() => {
    let alive = true
    const load = async () => {
      const { data } = await supabase.from('messages').select('*').eq('conversation_id', chat.id).order('created_at')
      const list = data || []
      if (!alive) return
      setMsgs(list)
      const ids = list.map(x => x.id)
      if (ids.length) {
        const { data: v } = await supabase.from('message_views').select('message_id,user_id').in('message_id', ids)
        if (alive) setViews(v || [])
        await loadReceipts(ids)
        await supabase.from('message_receipts').upsert(list.filter(m => m.sender_id !== uid && !m.deleted_at).map(m => ({ message_id: m.id, user_id: uid, status: 'seen', updated_at: new Date().toISOString() })), { onConflict: 'message_id,user_id' })
      }
      loadFavorites()
    }
    load()
    const ch = supabase.channel(`msgs:${chat.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${chat.id}` }, async p => {
        if (p.eventType === 'INSERT') {
          setMsgs(m => m.some(x => x.id === p.new.id) ? m : [...m, p.new])
          if (p.new.sender_id !== uid) {
            playTone(p.new.kind && p.new.kind !== 'text' ? 'ring' : 'receive')
            await supabase.from('message_receipts').upsert({ message_id: p.new.id, user_id: uid, status: 'seen', updated_at: new Date().toISOString() }, { onConflict: 'message_id,user_id' })
          }
          loadReceipts([p.new.id])
        } else if (p.eventType === 'UPDATE') setMsgs(m => m.map(x => x.id === p.new.id ? p.new : x))
        else if (p.eventType === 'DELETE') setMsgs(m => m.filter(x => x.id !== p.old.id))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_receipts' }, p => {
        const row = p.new
        if (row?.message_id) setReceipts(r => [...r.filter(x => !(x.message_id === row.message_id && x.user_id === row.user_id)), row])
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_views' }, p => setViews(v => v.some(x => x.message_id === p.new.message_id && x.user_id === p.new.user_id) ? v : [...v, p.new]))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_favorites', filter: `user_id=eq.${uid}` }, () => loadFavorites())
      .subscribe()
    return () => { alive = false; supabase.removeChannel(ch) }
  }, [chat.id, uid, loadReceipts, loadFavorites])

  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])
  const lastCallId = [...msgs].reverse().find(x => x.kind !== 'text')?.id
  const live = !!roomUsers && roomUsers.length > 0
  useEffect(() => {
    if (!lastCallId) return
    const t = setTimeout(() => setTick(v => v + 1), 8200)
    return () => clearTimeout(t)
  }, [lastCallId])
  useEffect(() => { attRef.current = att }, [att])
  useEffect(() => () => { if (attRef.current) URL.revokeObjectURL(attRef.current.url) }, [])

  const addView = (mid, user) => setViews(v => (v.some(x => x.message_id === mid && x.user_id === user) ? v : [...v, { message_id: mid, user_id: user }]))
  function flash(msg) { setErr(msg); setTimeout(() => setErr(''), 3200) }
  const insert = row => supabase.from('messages').insert({ conversation_id: chat.id, sender_id: uid, ...row })

  async function send(e) {
    e?.preventDefault?.()
    if (sending) return
    const body = text.trim()
    if (!body && !att) return
    setSending(true)
    try {
      let error
      let messageId = null
      if (!att) {
        const result = await insert({ body, reply_to: reply?.id || null })
        error = result.error
        messageId = result.data?.[0]?.id
      } else {
        const f = att.file
        const path = `${uid}/${crypto.randomUUID()}.${f.type === 'image/png' ? 'png' : 'jpg'}`
        if (att.once) {
          const up = await supabase.storage.from('chat-once').upload(path, f, { contentType: f.type })
          if (up.error) throw new Error('Image upload failed')
          const result = await supabase.rpc('send_view_once', { cid: chat.id, path, caption: body || null })
          error = result.error
        } else {
          const up = await supabase.storage.from('chat-images').upload(path, f, { contentType: f.type })
          if (up.error) throw new Error('Image upload failed')
          const { data } = supabase.storage.from('chat-images').getPublicUrl(path)
          const result = await insert({ image_url: data.publicUrl, body: body || null, spoiler: att.spoiler, reply_to: reply?.id || null })
          error = result.error
        }
      }
      if (error) throw new Error(error.message)
      setText(''); setReply(null)
      if (att) { URL.revokeObjectURL(att.url); setAtt(null) }
      playTone('send')
    } catch (x) { flash(x.message || 'Message not sent') }
    setSending(false)
  }

  function pickImage(e) {
    const f = e.target.files[0]; e.target.value = ''
    if (!f) return
    if (!TYPES.includes(f.type)) return flash('Only PNG or JPEG images')
    if (f.size > MAX_IMAGE) return flash('Image too large (max 10 MB)')
    if (att) URL.revokeObjectURL(att.url)
    setAtt({ file: f, url: URL.createObjectURL(f), spoiler: false, once: false })
  }
  const toggleAtt = k => setAtt(a => ({ ...a, spoiler: k === 'spoiler' ? !a.spoiler : false, once: k === 'once' ? !a.once : false }))
  function removeAtt() {
    if (!att || att.leaving) return
    const url = att.url; setAtt({ ...att, leaving: true })
    setTimeout(() => { URL.revokeObjectURL(url); setAtt(null) }, 180)
  }
  async function startCall() {
    if (inCall) return onOpenCall()
    if (!live) await insert({ kind: 'voice', body: 'Voice call' })
    playTone('call'); onJoinCall()
  }
  async function toggleFavorite(m) {
    if (favorites.includes(m.id)) {
      const { error } = await supabase.from('message_favorites').delete().eq('message_id', m.id).eq('user_id', uid)
      if (!error) setFavorites(v => v.filter(id => id !== m.id))
    } else {
      const { error } = await supabase.from('message_favorites').insert({ message_id: m.id, user_id: uid })
      if (!error) setFavorites(v => [...v, m.id]); else flash('Could not favorite message')
    }
  }
  async function unsend(m) {
    if (m.sender_id !== uid) return
    const { error } = await supabase.from('messages').update({ deleted_at: new Date().toISOString(), body: null, image_url: null, gif_url: null, spoiler: false }).eq('id', m.id).eq('sender_id', uid)
    if (error) flash('Could not delete message for everyone')
    setMenu(null)
  }
  async function copyMessage(m) {
    try { await navigator.clipboard.writeText(m.body || m.gif_url || m.image_url || '') } catch { flash('Clipboard access denied') }
    setMenu(null)
  }
  async function saveGif(url) {
    if (!url) return
    const exists = gifFavorites.some(g => g.gif_url === url)
    if (exists) {
      const { error } = await supabase.from('gif_favorites').delete().eq('user_id', uid).eq('gif_url', url)
      if (!error) setGifFavorites(g => g.filter(x => x.gif_url !== url))
    } else {
      const { data, error } = await supabase.from('gif_favorites').insert({ user_id: uid, gif_url: url }).select().single()
      if (!error && data) setGifFavorites(g => [data, ...g])
      else flash('Could not save GIF')
    }
  }
  async function sendGif(url) {
    const { error } = await insert({ body: url, gif_url: url, reply_to: reply?.id || null })
    if (error) flash('Could not send GIF')
    else { setReply(null); setShowGifs(false); playTone('send') }
  }
  const replyMessage = m => { setReply(m); setMenu(null); document.querySelector('.compose input[type="text"], .compose input:not([type])')?.focus() }
  const onMessageContext = (e, m) => {
    e.preventDefault()
    setMenu({ id: m.id, x: Math.min(e.clientX || 20, window.innerWidth - 210), y: Math.min(e.clientY || 80, window.innerHeight - 260) })
  }

  return (
    <div className="chat">
      <div className="top">
        <button className="ghost back" onClick={onBack}>Back</button>
        <Avatar url={i.avatar} name={i.name} onClick={other ? () => onProfile(other) : undefined} />
        <b>{i.name}</b>
        {chat.is_group && <button className="ghost iconbtn" onClick={() => setShowGroup(true)} title="Group settings" aria-label="Group settings"><Icon n="gear" size={18} /></button>}
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
            return <div key={m.id} className="sys">{names[m.sender_id]} started a call{status}</div>
          }
          const mine = m.sender_id === uid
          const p = people[m.sender_id]
          const t = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          const receipt = receipts.filter(r => r.message_id === m.id && r.user_id !== uid)
          const read = receipt.some(r => r.status === 'seen')
          const delivered = receipt.length > 0
          const replyTarget = m.reply_to ? msgs.find(x => x.id === m.reply_to) : null
          const gifUrl = m.gif_url || getGifUrl(m.body)
          return (
            <div key={m.id} className={`mrow ${mine ? 'me' : ''}`} onTouchStart={e => { touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, id: m.id } }} onTouchEnd={e => {
              const start = touchRef.current; if (!start || start.id !== m.id) return
              const dx = e.changedTouches[0].clientX - start.x
              if (Math.abs(dx) > 75) { setReply(m); touchRef.current = null }
            }}>
              {chat.is_group && !mine && <Avatar url={p?.avatar_url} name={p?.display_name} size={28} onClick={() => p && onProfile(p)} />}
              <div className="msg" onContextMenu={e => onMessageContext(e, m)}>
                {chat.is_group && !mine && <small onClick={() => p && onProfile(p)}>{names[m.sender_id]}</small>}
                {replyTarget && <div className="reply-preview"><b>{names[replyTarget.sender_id] || 'Message'}</b><span>{replyTarget.deleted_at ? 'Message deleted' : replyTarget.body || 'Attachment'}</span></div>}
                {m.deleted_at ? <i className="deleted-msg">This message was deleted</i> : <>
                  {m.view_once
                    ? <Once m={m} mine={mine} isGroup={chat.is_group} opened={views.some(v => v.message_id === m.id && v.user_id === uid)} count={views.filter(v => v.message_id === m.id).length} onOpened={() => addView(m.id, uid)} />
                    : <>
                      {m.image_url && <div className="spoiler-wrap"><Pic src={m.image_url} spoiler={m.spoiler} /></div>}
                      {gifUrl && <div className="gif-wrap"><img className="embedded-gif" src={gifUrl} alt="GIF" loading="lazy" /><button className="gif-heart ghost" title="Favorite GIF" onClick={() => saveGif(gifUrl)}>{gifFavorites.some(g => g.gif_url === gifUrl) ? '♥' : '♡'}</button></div>}
                      {m.body && !gifUrl && <div className="message-body">{renderBody(m.body)}</div>}
                    </>}
                </>}
                <div className="message-meta"><em className="time">{t}</em>{mine && !m.deleted_at && <small className="receipt">{read ? '✓✓ Seen' : delivered ? '✓✓ Delivered' : '✓ Sent'}</small>}</div>
                <button className="message-more ghost" aria-label="Message options" title="Message options" onClick={e => onMessageContext(e, m)}>⋯</button>
                {menu?.id === m.id && <div className="message-menu" style={{ left: menu.x, top: menu.y }} onClick={e => e.stopPropagation()}>
                  <button onClick={() => replyMessage(m)}>↩ Reply</button>
                  <button onClick={() => toggleFavorite(m)}>{favorites.includes(m.id) ? '★ Unfavorite' : '☆ Favorite'}</button>
                  <button onClick={() => copyMessage(m)}>⧉ Copy text</button>
                  {mine && !m.deleted_at && <button className="danger" onClick={() => unsend(m)}>Delete for everyone</button>}
                  <button onClick={() => setMenu(null)}>Close</button>
                </div>}
              </div>
            </div>
          )
        })}
        <div ref={end} />
      </div>
      {att && <Attachment att={att} busy={sending} onToggle={toggleAtt} onRemove={removeAtt} />}
      {reply && <div className="reply-bar"><span>Replying to <b>{names[reply.sender_id] || 'message'}</b>: {reply.body || 'Attachment'}</span><button className="ghost" onClick={() => setReply(null)}>×</button></div>}
      {showGifs && <div className="gif-picker"><div className="gif-picker-head"><b>Saved items</b><button className="ghost" onClick={() => setShowGifs(false)}>Close</button></div><h5 className="flat">Favorite GIFs</h5>{gifFavorites.length ? <div className="gif-grid">{gifFavorites.map(g => <div key={g.id} className="gif-option"><button className="gif-option-image" onClick={() => sendGif(g.gif_url)}><img src={g.gif_url} alt="Favorite GIF" /></button><button className="gif-remove ghost" onClick={() => saveGif(g.gif_url)} title="Remove favorite">♥</button></div>)}</div> : <p className="note">Favorite a GIF in chat to keep it here.</p>}<h5 className="flat">Favorite messages</h5>{msgs.filter(m => favorites.includes(m.id)).length ? msgs.filter(m => favorites.includes(m.id)).map(m => <div className="saved-message" key={m.id}><span>{m.deleted_at ? 'Message deleted' : m.body || m.gif_url || 'Attachment'}</span><button className="ghost" onClick={() => toggleFavorite(m)}>★</button></div>) : <p className="note">Favorite messages to keep them here.</p>}</div>}
      {err && <small className="err cerr">{err}</small>}
      <form className="compose" onSubmit={send}>
        <label className="attach">Attach<input type="file" accept="image/png,image/jpeg" onChange={pickImage} hidden /></label>
        <button type="button" className="ghost gif-toggle" onClick={() => setShowGifs(v => !v)} title="Favorite GIFs">GIFs</button>
        <input value={text} onChange={e => setText(e.target.value)} placeholder={att ? 'Add a caption' : 'Message'} />
        <button disabled={sending}>{sending ? 'Sending...' : 'Send'}</button>
      </form>
      {menu && <div className="menu-dismiss" onClick={() => setMenu(null)} />}
      {showGroup && <GroupInfo chat={chat} uid={uid} friends={friends} actions={actions} onProfile={onProfile} onClose={() => setShowGroup(false)} />}
    </div>
  )
}
