'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { info } from '../lib/info'
import Avatar from './Avatar'
import { Icon } from '../lib/icons'
import GroupInfo from './GroupInfo'
import { Attachment, Once, Pic } from './Media'

const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']
const MAX_IMAGE = 50 * 1024 * 1024
const GIF_RE = /https?:\/\/[^\s<>()]+?\.(?:gif|gifv)(?:\?[^\s<>()]*)?/i
const URL_RE = /https?:\/\/[^\s<>()]+/i

function playTone(kind = 'message') {
  if (typeof window === 'undefined') return

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return

    const context = new AudioContextClass()
    const tones = kind === 'call'
      ? [[440, 0, 0.16], [554, 0.2, 0.18], [659, 0.42, 0.24]]
      : kind === 'ring'
        ? [[660, 0, 0.18], [880, 0.22, 0.22], [660, 0.55, 0.18], [880, 0.78, 0.22]]
        : kind === 'send'
          ? [[520, 0, 0.07], [660, 0.08, 0.08]]
          : kind === 'receive'
            ? [[740, 0, 0.1], [980, 0.12, 0.14]]
            : [[600, 0, 0.06]]

    tones.forEach(([frequency, start, duration]) => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()

      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, context.currentTime + start)
      gain.gain.exponentialRampToValueAtTime(0.09, context.currentTime + start + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + start + duration)

      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(context.currentTime + start)
      oscillator.stop(context.currentTime + start + duration + 0.02)
    })

    setTimeout(() => context.close().catch(() => {}), 1800)
  } catch {}
}

function cleanUrl(url) {
  return url?.replace(/[.,!?;:]+$/, '') || ''
}

function getGifMedia(body) {
  if (!body) return null

  const direct = body.match(GIF_RE)?.[0]

  if (direct) {
    const url = cleanUrl(direct)
    return { type: 'image', url, originalUrl: url }
  }

  const raw = body.match(URL_RE)?.[0]
  if (!raw) return null

  const originalUrl = cleanUrl(raw)

  try {
    const parsed = new URL(originalUrl)
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')

    if (host === 'giphy.com' || host.endsWith('.giphy.com')) {
      const parts = parsed.pathname.split('/').filter(Boolean)

      if (parts[0] === 'gifs' || parts[0] === 'clips') {
        const last = parts[parts.length - 1] || ''
        const id = last.match(/-([a-zA-Z0-9]+)$/)?.[1] || (parts.length === 2 ? last : '')

        if (id) {
          return {
            type: 'iframe',
            url: `https://giphy.com/embed/${id}`,
            originalUrl
          }
        }
      }
    }

    if (host === 'tenor.com' || host.endsWith('.tenor.com')) {
      const id = parsed.pathname.match(/-(\d+)(?:\/|$)/)?.[1]

      if (id && /\/(?:view|embed)\//i.test(parsed.pathname)) {
        return {
          type: 'iframe',
          url: `https://tenor.com/embed/${id}`,
          originalUrl
        }
      }
    }

    if (host === 'media.tenor.com') {
      return { type: 'image', url: originalUrl, originalUrl }
    }
  } catch {}

  return null
}

function renderBody(body) {
  if (!body) return null

  const media = getGifMedia(body)

  if (media) {
    if (media.type === 'image') {
      return <img className="embedded-gif" src={media.url} alt="GIF" loading="lazy" />
    }

    return (
      <iframe
        className="embedded-gif embedded-gif-frame"
        src={media.url}
        title="GIF"
        loading="lazy"
        allow="fullscreen"
      />
    )
  }

  const url = body.match(URL_RE)?.[0]

  return url
    ? <a className="embed-link" href={cleanUrl(url)} target="_blank" rel="noreferrer">{body}</a>
    : body
}

export default function Chat({
  chat,
  uid,
  friends,
  actions,
  inCall,
  roomUsers,
  onJoinCall,
  onOpenCall,
  onBack,
  onProfile,
  pinned,
  onTogglePin,
  onShowFavorites,
  dismissKey
}) {
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
  const [mediaTab, setMediaTab] = useState('upload')
  const [reply, setReply] = useState(null)
  const [menu, setMenu] = useState(null)
  const [topMenu, setTopMenu] = useState(false)

  useEffect(() => {
    setShowGifs(false)
    setTopMenu(false)
  }, [dismissKey])

  const attRef = useRef(null)
  const end = useRef(null)
  const touchRef = useRef(null)

  const people = Object.fromEntries(chat.members.map(m => [m.profiles.id, m.profiles]))
  const names = Object.fromEntries(Object.values(people).map(p => [p.id, p.display_name]))
  const i = info(chat, uid)
  const other = chat.is_group ? null : Object.values(people).find(p => p.id !== uid)

  const loadReceipts = useCallback(async ids => {
    if (!ids?.length) {
      setReceipts([])
      return
    }

    const { data } = await supabase
      .from('message_receipts')
      .select('message_id,user_id,status,updated_at')
      .in('message_id', ids)

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
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', chat.id)
        .order('created_at')

      const list = data || []
      if (!alive) return

      setMsgs(current => {
        const merged = new Map(list.map(message => [message.id, message]))

        current.forEach(message => {
          merged.set(message.id, { ...merged.get(message.id), ...message })
        })

        return [...merged.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      })

      const ids = list.map(x => x.id)

      if (ids.length) {
        const { data: v } = await supabase
          .from('message_views')
          .select('message_id,user_id')
          .in('message_id', ids)

        if (alive) setViews(v || [])

        await loadReceipts(ids)

        await supabase.from('message_receipts').upsert(
          list
            .filter(m => m.sender_id !== uid && !m.deleted_at)
            .map(m => ({
              message_id: m.id,
              user_id: uid,
              status: 'seen',
              updated_at: new Date().toISOString()
            })),
          { onConflict: 'message_id,user_id' }
        )
      }

      loadFavorites()
    }

    load()

    const ch = supabase
      .channel(`msgs:${chat.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${chat.id}`
        },
        async p => {
          if (p.eventType === 'INSERT') {
            setMsgs(current =>
              current.some(message => message.id === p.new.id)
                ? current
                : [...current, p.new].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
            )

            if (p.new.sender_id !== uid) {
              playTone(p.new.kind && p.new.kind !== 'text' ? 'ring' : 'receive')

              await supabase.from('message_receipts').upsert({
                message_id: p.new.id,
                user_id: uid,
                status: 'seen',
                updated_at: new Date().toISOString()
              }, { onConflict: 'message_id,user_id' })
            }

            loadReceipts([p.new.id])
          } else if (p.eventType === 'UPDATE') {
            setMsgs(m => m.map(x => x.id === p.new.id ? p.new : x))
          } else if (p.eventType === 'DELETE') {
            setMsgs(m => m.filter(x => x.id !== p.old.id))
          }
        }
      )
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'message_receipts'
      }, p => {
        const row = p.new

        if (row?.message_id) {
          setReceipts(r => [
            ...r.filter(x => !(x.message_id === row.message_id && x.user_id === row.user_id)),
            row
          ])
        }
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'message_views'
      }, p => {
        setViews(v =>
          v.some(x => x.message_id === p.new.message_id && x.user_id === p.new.user_id)
            ? v
            : [...v, p.new]
        )
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'message_favorites',
        filter: `user_id=eq.${uid}`
      }, () => loadFavorites())
      .subscribe()

    return () => {
      alive = false
      supabase.removeChannel(ch)
    }
  }, [chat.id, uid, loadReceipts, loadFavorites])

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs])

  const lastCallId = [...msgs].reverse().find(x => x.kind !== 'text')?.id
  const live = !!roomUsers && roomUsers.length > 0

  useEffect(() => {
    if (!lastCallId) return

    const t = setTimeout(() => setTick(v => v + 1), 8200)
    return () => clearTimeout(t)
  }, [lastCallId])

  useEffect(() => {
    attRef.current = att
  }, [att])

  useEffect(() => () => {
    if (attRef.current) URL.revokeObjectURL(attRef.current.url)
  }, [])

  const addView = (mid, user) => {
    setViews(v => (
      v.some(x => x.message_id === mid && x.user_id === user)
        ? v
        : [...v, { message_id: mid, user_id: user }]
    ))
  }

  function flash(msg) {
    setErr(msg)
    setTimeout(() => setErr(''), 3200)
  }

  const insert = async row => {
    const { data, error } = await supabase
      .from('messages')
      .insert({ conversation_id: chat.id, sender_id: uid, ...row })
      .select('*')
      .single()

    if (!error && data) {
      setMsgs(current =>
        current.some(message => message.id === data.id)
          ? current
          : [...current, data].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      )
    }

    return { data, error }
  }

  async function send(e) {
    e?.preventDefault?.()

    if (sending) return

    const body = text.trim()
    if (!body && !att) return

    setSending(true)

    try {
      let error

      if (!att) {
        const result = await insert({ body, reply_to: reply?.id || null })
        error = result.error
      } else {
        const f = att.file
        const isVideo = f.type.startsWith('video/')
        const extension = f.name.split('.').pop()?.toLowerCase() || (isVideo ? 'mp4' : f.type === 'image/png' ? 'png' : f.type === 'image/gif' ? 'gif' : 'jpg')
        const path = `${uid}/${crypto.randomUUID()}.${extension}`

        if (att.once) {
          const up = await supabase.storage.from('chat-once').upload(path, f, {
            contentType: f.type
          })

          if (up.error) throw new Error('Image upload failed')

          const result = await supabase.rpc('send_view_once', {
            cid: chat.id,
            path,
            caption: body || null
          })

          error = result.error
        } else {
          const up = await supabase.storage.from('chat-images').upload(path, f, {
            contentType: f.type
          })

          if (up.error) throw new Error('Image upload failed')

          const { data } = supabase.storage.from('chat-images').getPublicUrl(path)

          const result = await insert({
            image_url: isVideo ? null : data.publicUrl,
            video_url: isVideo ? data.publicUrl : null,
            body: body || null,
            spoiler: att.spoiler,
            reply_to: reply?.id || null
          })

          error = result.error
        }
      }

      if (error) throw new Error(error.message)

      setText('')
      setReply(null)

      if (att) {
        URL.revokeObjectURL(att.url)
        setAtt(null)
      }

      playTone('send')
    } catch (x) {
      flash(x.message || 'Message not sent')
    }

    setSending(false)
  }

  function pickImage(e) {
    const f = e.target.files[0]
    e.target.value = ''

    if (!f) return
    if (!TYPES.includes(f.type)) return flash('Use PNG, JPEG, GIF, MP4, WEBM or MOV')
    if (f.size > MAX_IMAGE) return flash('Media too large (max 50 MB)')

    if (att) URL.revokeObjectURL(att.url)

    setShowGifs(false)

    setAtt({
      file: f,
      url: URL.createObjectURL(f),
      spoiler: false,
      once: false
    })
  }

  const toggleAtt = k => setAtt(a => ({
    ...a,
    spoiler: k === 'spoiler' ? !a.spoiler : false,
    once: k === 'once' ? !a.once : false
  }))

  function removeAtt() {
    if (!att || att.leaving) return

    const url = att.url
    setAtt({ ...att, leaving: true })

    setTimeout(() => {
      URL.revokeObjectURL(url)
      setAtt(null)
    }, 180)
  }

  async function startCall() {
    setShowGifs(false)
    setTopMenu(false)

    if (inCall) return onOpenCall()

    if (!live) await insert({ kind: 'voice', body: 'Voice call' })

    playTone('call')
    onJoinCall()
  }

  async function toggleFavorite(m) {
    if (favorites.includes(m.id)) {
      const { error } = await supabase
        .from('message_favorites')
        .delete()
        .eq('message_id', m.id)
        .eq('user_id', uid)

      if (!error) setFavorites(v => v.filter(id => id !== m.id))
    } else {
      const { error } = await supabase
        .from('message_favorites')
        .insert({ message_id: m.id, user_id: uid })

      if (!error) {
        setFavorites(v => [...v, m.id])
      } else {
        flash('Could not favorite message')
      }
    }
  }

  async function unsend(m) {
    if (m.sender_id !== uid) return

    setMenu(null)

    const wipe = {
      deleted_at: new Date().toISOString(),
      body: null,
      image_url: null,
      video_url: null,
      gif_url: null,
      spoiler: false
    }

    const run = patch => supabase
      .from('messages')
      .update(patch)
      .eq('id', m.id)
      .eq('sender_id', uid)
      .select('*')

    let { data, error } = await run(wipe)

    // older databases may not have the video_url column yet
    if (error && /video_url/i.test(error.message || '')) {
      const { video_url, ...withoutVideo } = wipe
      ;({ data, error } = await run(withoutVideo))
    }

    if (error) return flash(`Could not delete message: ${error.message}`)

    // RLS blocks silently: no error, but zero rows changed
    if (!data?.length) return flash('Could not delete message (permission denied). Run migration_unsend_fix.sql in Supabase.')

    setMsgs(current => current.map(x => x.id === m.id ? { ...x, ...data[0] } : x))
  }

  async function copyMessage(m) {
    try {
      await navigator.clipboard.writeText(m.body || m.gif_url || m.image_url || m.video_url || '')
    } catch {
      flash('Clipboard access denied')
    }

    setMenu(null)
  }

  async function saveGif(url) {
    if (!url) return

    const exists = gifFavorites.some(g => g.gif_url === url)

    if (exists) {
      const { error } = await supabase
        .from('gif_favorites')
        .delete()
        .eq('user_id', uid)
        .eq('gif_url', url)

      if (!error) setGifFavorites(g => g.filter(x => x.gif_url !== url))
    } else {
      const { data, error } = await supabase
        .from('gif_favorites')
        .insert({ user_id: uid, gif_url: url })
        .select()
        .single()

      if (!error && data) {
        setGifFavorites(g => [data, ...g])
      } else {
        flash('Could not save GIF')
      }
    }
  }

  async function sendGif(url) {
    const { error } = await insert({
      body: url,
      gif_url: url,
      reply_to: reply?.id || null
    })

    if (error) {
      flash('Could not send GIF')
    } else {
      setReply(null)
      setShowGifs(false)
      playTone('send')
    }
  }

  const replyMessage = m => {
    setReply(m)
    setMenu(null)
    document.querySelector('.compose input[type="text"], .compose input:not([type])')?.focus()
  }

  const onMessageContext = (e, m) => {
    e.preventDefault()

    setMenu({
      id: m.id,
      x: Math.min(e.clientX || 20, window.innerWidth - 210),
      y: Math.min(e.clientY || 80, window.innerHeight - 260)
    })
  }

  return (
    <div className="chat">
      <div className="top">
        <button className="ghost back" onClick={onBack}>Back</button>
        <Avatar url={i.avatar} name={i.name} onClick={other ? () => onProfile(other) : undefined} />
        <b>{i.name}</b>

        <div className="top-gear">
          <button
            className="ghost iconbtn"
            onClick={() => setTopMenu(v => !v)}
            title="Conversation options"
            aria-label="Conversation options"
          >
            <Icon n="gear" size={18} />
          </button>

          {topMenu && (
            <>
              <div className="top-dismiss" onClick={() => setTopMenu(false)} />
              <div className="top-menu">
                {chat.is_group && (
                  <button onClick={() => { setTopMenu(false); setShowGroup(true) }}>Group settings</button>
                )}
                <button onClick={() => { setTopMenu(false); onTogglePin?.() }}>
                  {pinned ? 'Unpin conversation' : 'Pin conversation to top'}
                </button>
                <button onClick={() => { setTopMenu(false); onShowFavorites?.() }}>Favorite messages</button>
              </div>
            </>
          )}
        </div>

        <button className={inCall ? '' : 'ghost'} onClick={startCall}>
          {inCall ? 'In call' : live ? 'Join call' : 'Call'}
        </button>
      </div>

      <div className="msgs">
        {msgs.length === 0 && (
          <div className="empty small">
            No messages yet<span className="caret">_</span>
          </div>
        )}

        {msgs.map(m => {
          if (m.kind !== 'text') {
            const last = m.id === lastCallId
            const fresh = Date.now() - new Date(m.created_at).getTime() < 8000
            let status = null

            if (!last) {
              status = <span>Call ended</span>
            } else if (inCall) {
              status = <><span>You are in this call</span><button onClick={onOpenCall}>Open</button></>
            } else if (live) {
              status = <><span>{roomUsers.length} in call</span><button onClick={onJoinCall}>Join</button></>
            } else if (roomUsers && !fresh) {
              status = <span>Call ended</span>
            }

            return (
              <div key={m.id} className="sys">
                {names[m.sender_id]} started a call{status}
              </div>
            )
          }

          const mine = m.sender_id === uid
          const p = people[m.sender_id]
          const t = new Date(m.created_at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
          })

          const receipt = receipts.filter(r => r.message_id === m.id && r.user_id !== uid)
          const read = receipt.some(r => r.status === 'seen')
          const delivered = receipt.length > 0
          const replyTarget = m.reply_to ? msgs.find(x => x.id === m.reply_to) : null
          const gifMedia = !m.deleted_at ? getGifMedia(m.gif_url || m.body) : null
          const imageGif = !m.deleted_at && !m.view_once && /\.gif(?:[?#].*)?$/i.test(m.image_url || '')
          const gifUrl = gifMedia?.originalUrl || (imageGif ? m.image_url : null)
          const bare = !m.deleted_at && !m.view_once && !!(m.image_url || m.video_url || gifMedia)

          return (
            <div
              key={m.id}
              className={`mrow ${mine ? 'me' : ''}`}
              onTouchStart={e => {
                touchRef.current = {
                  x: e.touches[0].clientX,
                  y: e.touches[0].clientY,
                  id: m.id
                }
              }}
              onTouchEnd={e => {
                const start = touchRef.current
                if (!start || start.id !== m.id) return

                const dx = e.changedTouches[0].clientX - start.x

                if (Math.abs(dx) > 75) {
                  setReply(m)
                  touchRef.current = null
                }
              }}
            >
              {chat.is_group && !mine && (
                <Avatar
                  url={p?.avatar_url}
                  name={p?.display_name}
                  size={28}
                  onClick={() => p && onProfile(p)}
                />
              )}

              <div className={`msg ${bare ? 'bare' : ''}`} onContextMenu={e => onMessageContext(e, m)}>
                {chat.is_group && !mine && (
                  <small onClick={() => p && onProfile(p)}>
                    {names[m.sender_id]}
                  </small>
                )}

                {replyTarget && (
                  <div className="reply-preview">
                    <b>{names[replyTarget.sender_id] || 'Message'}</b>
                    <span>
                      {replyTarget.deleted_at
                        ? 'Message deleted'
                        : replyTarget.body || 'Attachment'}
                    </span>
                  </div>
                )}

                {m.deleted_at ? (
                  <i className="deleted-msg">This message was deleted</i>
                ) : (
                  <>
                    {m.view_once ? (
                      <Once
                        m={m}
                        mine={mine}
                        isGroup={chat.is_group}
                        opened={views.some(v => v.message_id === m.id && v.user_id === uid)}
                        count={views.filter(v => v.message_id === m.id).length}
                        onOpened={() => addView(m.id, uid)}
                      />
                    ) : (
                      <>
                        {m.image_url && (
                          <div className={`media-frame ${m.spoiler ? 'media-spoiler' : ''} ${imageGif ? 'gif-wrap' : ''}`}>
                            <Pic src={m.image_url} spoiler={m.spoiler} />

                            {imageGif && (
                              <button
                                type="button"
                                className="gif-heart ghost"
                                title="Favorite GIF"
                                aria-label="Favorite GIF"
                                onClick={() => saveGif(gifUrl)}
                              >
                                {gifFavorites.some(g => g.gif_url === gifUrl) ? '♥' : '♡'}
                              </button>
                            )}
                          </div>
                        )}
                        {m.video_url && (
                          <div className="media-frame">
                            <video className="chat-video" src={m.video_url} controls playsInline preload="metadata" />
                          </div>
                        )}

                        {gifMedia && (
                          <div className="gif-wrap">
                            {gifMedia.type === 'image' ? (
                              <img
                                className="embedded-gif"
                                src={gifMedia.url}
                                alt="GIF"
                                loading="lazy"
                              />
                            ) : (
                              <iframe
                                className="embedded-gif embedded-gif-frame"
                                src={gifMedia.url}
                                title="GIF"
                                loading="lazy"
                                allow="fullscreen"
                              />
                            )}

                            <button
                              className="gif-heart ghost"
                              title="Favorite GIF"
                              aria-label="Favorite GIF"
                              onClick={() => saveGif(gifUrl)}
                            >
                              {gifFavorites.some(g => g.gif_url === gifUrl) ? '♥' : '♡'}
                            </button>
                          </div>
                        )}

                        {m.body && !gifMedia && (
                          <div className="message-body">{renderBody(m.body)}</div>
                        )}
                      </>
                    )}
                  </>
                )}

                <div className="message-meta">
                  <em className="time">{t}</em>
                  {mine && !m.deleted_at && (
                    <small className="receipt">
                      {read ? '✓✓ Seen' : delivered ? '✓✓ Delivered' : '✓ Sent'}
                    </small>
                  )}
                </div>

                <button
                  className="message-more ghost"
                  aria-label="Message options"
                  title="Message options"
                  onClick={e => onMessageContext(e, m)}
                >
                  ⋯
                </button>

                {menu?.id === m.id && (
                  <div
                    className="message-menu"
                    style={{ left: menu.x, top: menu.y }}
                    onClick={e => e.stopPropagation()}
                  >
                    <button onClick={() => replyMessage(m)}>↩ Reply</button>

                    <button onClick={() => toggleFavorite(m)}>
                      {favorites.includes(m.id) ? '★ Unfavorite' : '☆ Favorite'}
                    </button>

                    <button onClick={() => copyMessage(m)}>⧉ Copy text</button>

                    {mine && !m.deleted_at && (
                      <button className="danger" onClick={() => unsend(m)}>
                        Delete for everyone
                      </button>
                    )}

                    <button onClick={() => setMenu(null)}>Close</button>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        <div ref={end} />
      </div>

      {att && (
        <Attachment
          att={att}
          busy={sending}
          onToggle={toggleAtt}
          onRemove={removeAtt}
        />
      )}

      {reply && (
        <div className="reply-bar">
          <span>
            Replying to <b>{names[reply.sender_id] || 'message'}</b>: {reply.body || 'Attachment'}
          </span>
          <button className="ghost" onClick={() => setReply(null)}>×</button>
        </div>
      )}

      {showGifs && (
        <div className="gif-picker">
          <div className="gif-picker-head">
            <b>Media</b>
            <button className="ghost" onClick={() => setShowGifs(false)}>Close</button>
          </div>

          <div className="media-tabs">
            <button className={mediaTab === 'upload' ? 'on' : ''} onClick={() => setMediaTab('upload')}>Upload</button>
            <button className={mediaTab === 'gifs' ? 'on' : ''} onClick={() => setMediaTab('gifs')}>GIFs</button>
          </div>
          {mediaTab === 'upload' ? (
            <div className="media-upload">
              <label className="media-upload-button">Choose image or video
                <input type="file" accept="image/png,image/jpeg,image/gif,video/mp4,video/webm,video/quicktime" onChange={pickImage} hidden />
              </label>
              <p className="note">PNG, JPEG, GIF, MP4, WEBM or MOV · up to 50 MB</p>
            </div>
          ) : <>
          <h5 className="flat">Favorite GIFs</h5>

          {gifFavorites.length ? (
            <div className="gif-grid">
              {gifFavorites.map(g => {
                const media = getGifMedia(g.gif_url)

                return (
                  <div key={g.id} className="gif-option">
                    <button
                      className="gif-option-image"
                      onClick={() => sendGif(g.gif_url)}
                      title="Send GIF"
                    >
                      {media?.type === 'iframe' ? (
                        <iframe src={media.url} title="Favorite GIF" loading="lazy" />
                      ) : (
                        <img
                          src={media?.url || g.gif_url}
                          alt="Favorite GIF"
                          loading="lazy"
                        />
                      )}
                    </button>

                    <button
                      className="gif-remove ghost"
                      onClick={() => saveGif(g.gif_url)}
                      title="Remove favorite"
                    >
                      ♥
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="note">Favorite a GIF in chat to keep it here.</p>
          )}

          </>}
        </div>
      )}

      {err && <small className="err cerr">{err}</small>}

      <form className="compose" onSubmit={send}>
        <button type="button" className="ghost media-toggle" onClick={() => setShowGifs(v => !v)} title="Media">▧ Media</button>

        <input
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={att ? 'Add a caption' : 'Message'}
        />

        <button disabled={sending}>
          {sending ? 'Sending...' : 'Send'}
        </button>
      </form>

      {menu && <div className="menu-dismiss" onClick={() => setMenu(null)} />}

      {showGroup && (
        <GroupInfo
          chat={chat}
          uid={uid}
          friends={friends}
          actions={actions}
          onProfile={onProfile}
          onClose={() => setShowGroup(false)}
        />
      )}
    </div>
  )
}