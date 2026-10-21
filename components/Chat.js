'use client'

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { info } from '../lib/info'
import Avatar from './Avatar'
import { Icon } from '../lib/icons'
import GroupInfo from './GroupInfo'
import { Attachment, Once, Pic } from './Media'
import { playTone } from '../lib/notify'
import { shrinkPhoto } from '../lib/image'

const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']
const MAX_IMAGE = 50 * 1024 * 1024
const GIF_RE = /https?:\/\/[^\s<>()]+?\.(?:gif|gifv)(?:\?[^\s<>()]*)?/i
const URL_RE = /https?:\/\/[^\s<>()]+/i

const PAGE = 60
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }
const byTime = (a, b) => new Date(a.created_at) - new Date(b.created_at)
// server rows win over what is already in memory, rows that exist only here (just sent) are kept
const mergeMsgs = (cur, rows) => {
  const m = new Map(cur.map(x => [x.id, x]))
  rows.forEach(r => m.set(r.id, { ...m.get(r.id), ...r }))
  return [...m.values()].sort(byTime)
}
const tabOn = () => document.visibilityState === 'visible' && document.hasFocus()

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
          const embed = `https://giphy.com/embed/${id}`
          // a plain image loads much faster than the full giphy embed page; clips only exist as embeds
          if (parts[0] === 'gifs') return { type: 'image', url: `https://media.giphy.com/media/${id}/giphy.gif`, fallback: embed, originalUrl }
          return { type: 'iframe', url: embed, originalUrl }
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

function GifView({ media }) {
  const [failed, setFailed] = useState(false)
  if (media.type === 'iframe' || failed) {
    return <iframe className="embedded-gif embedded-gif-frame" src={failed ? media.fallback : media.url} title="GIF" allow="fullscreen" />
  }
  return <img className="embedded-gif" src={media.url} alt="GIF" decoding="async" onError={() => media.fallback && setFailed(true)} />
}

function renderBody(body) {
  if (!body) return null

  const media = getGifMedia(body)

  if (media) return <GifView media={media} />

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
  subscribe,
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
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)

  useEffect(() => {
    setShowGifs(false)
    setTopMenu(false)
  }, [dismissKey])

  const attRef = useRef(null)
  const end = useRef(null)
  const touchRef = useRef(null)
  const box = useRef(null)
  const stick = useRef(true) // the list is scrolled to the bottom, so new messages keep it there
  const prepend = useRef(null)
  const firstScroll = useRef(true)
  const msgsRef = useRef([])
  const seenMine = useRef(new Set())
  msgsRef.current = msgs

  const people = Object.fromEntries(chat.members.map(m => [m.profiles.id, m.profiles]))
  const names = Object.fromEntries(Object.values(people).map(p => [p.id, p.display_name]))
  const i = info(chat, uid)
  const other = chat.is_group ? null : Object.values(people).find(p => p.id !== uid)

  // ids go in small groups: hundreds of uuids in one request make the url too long and the request fails silently
  const loadReceipts = useCallback(async ids => {
    if (!ids?.length) return []
    const parts = await Promise.all(chunk(ids, 80).map(c => supabase
      .from('message_receipts')
      .select('message_id,user_id,status,updated_at')
      .in('message_id', c)))
    const rows = parts.flatMap(r => r.data || [])
    rows.filter(r => r.user_id === uid && r.status === 'seen').forEach(r => seenMine.current.add(r.message_id))
    setReceipts(cur => {
      const m = new Map(cur.map(r => [`${r.message_id}:${r.user_id}`, r]))
      rows.forEach(r => m.set(`${r.message_id}:${r.user_id}`, r))
      return [...m.values()]
    })
    return rows
  }, [uid])

  const loadViews = useCallback(async ids => {
    if (!ids?.length) return
    const parts = await Promise.all(chunk(ids, 80).map(c => supabase.from('message_views').select('message_id,user_id').in('message_id', c)))
    const rows = parts.flatMap(r => r.data || [])
    setViews(cur => {
      const m = new Map(cur.map(v => [`${v.message_id}:${v.user_id}`, v]))
      rows.forEach(v => m.set(`${v.message_id}:${v.user_id}`, v))
      return [...m.values()]
    })
  }, [])

  // tells the senders I saw their messages. Only messages not yet marked, and only while the tab is really
  // in front of me. (Marking the whole history on every open used to flood realtime and slow everything down.)
  const markSeen = useCallback(async list => {
    if (!tabOn()) return
    const todo = list.filter(m => m.sender_id !== uid && !m.deleted_at && !seenMine.current.has(m.id))
    if (!todo.length) return
    todo.forEach(m => seenMine.current.add(m.id))
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('message_receipts')
      .upsert(todo.map(m => ({ message_id: m.id, user_id: uid, status: 'seen', updated_at: now })), { onConflict: 'message_id,user_id' })
    if (error) todo.forEach(m => seenMine.current.delete(m.id))
  }, [uid])

  const loadFavorites = useCallback(async () => {
    const [{ data: fav }, { data: gifs }] = await Promise.all([
      supabase.from('message_favorites').select('message_id').eq('user_id', uid),
      supabase.from('gif_favorites').select('id,gif_url').eq('user_id', uid).order('created_at', { ascending: false })
    ])

    setFavorites((fav || []).map(x => x.message_id))
    setGifFavorites(gifs || [])
  }, [uid])

  // newest page of the conversation. Also used to catch up after a reconnect / coming back to the tab.
  const loadLatest = useCallback(async initial => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', chat.id)
      .order('created_at', { ascending: false })
      .limit(PAGE)
    if (error || !data) return
    const list = [...data].reverse()
    if (initial) setHasMore(data.length === PAGE)
    setMsgs(cur => mergeMsgs(cur, list))
    const ids = list.map(x => x.id)
    await Promise.all([loadViews(ids), loadReceipts(ids)])
    markSeen(list)
  }, [chat.id, loadReceipts, loadViews, markSeen])

  useEffect(() => {
    loadLatest(true)
    loadFavorites()
  }, [loadLatest, loadFavorites])

  // live events come from the one app-wide realtime connection (see Main.js)
  useEffect(() => {
    if (!subscribe) return
    return subscribe(ev => {
      if (ev.type === 'insert') {
        const m = ev.row
        if (m.conversation_id !== chat.id) return
        setMsgs(cur => (cur.some(x => x.id === m.id) ? cur : mergeMsgs(cur, [m])))
        if (m.sender_id !== uid) markSeen([m])
      } else if (ev.type === 'update') {
        if (ev.row.conversation_id !== chat.id) return
        setMsgs(cur => cur.map(x => (x.id === ev.row.id ? { ...x, ...ev.row } : x)))
      } else if (ev.type === 'delete') {
        setMsgs(cur => cur.filter(x => x.id !== ev.id))
      } else if (ev.type === 'receipt') {
        const row = ev.row
        setReceipts(r => [...r.filter(x => !(x.message_id === row.message_id && x.user_id === row.user_id)), row])
      } else if (ev.type === 'view') {
        setViews(v => (v.some(x => x.message_id === ev.row.message_id && x.user_id === ev.row.user_id) ? v : [...v, ev.row]))
      } else if (ev.type === 'resync') {
        loadLatest(false)
      }
    })
  }, [subscribe, chat.id, uid, loadLatest, markSeen])

  async function loadOlder() {
    const first = msgsRef.current[0]
    if (!first || loadingOlder) return
    setLoadingOlder(true)
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', chat.id)
      .lt('created_at', first.created_at)
      .order('created_at', { ascending: false })
      .limit(PAGE)
    const older = [...(data || [])].reverse()
    setHasMore((data || []).length === PAGE)
    if (older.length) {
      prepend.current = box.current ? box.current.scrollHeight : null
      setMsgs(cur => mergeMsgs(cur, older))
      const ids = older.map(x => x.id)
      loadViews(ids)
      loadReceipts(ids)
    }
    setLoadingOlder(false)
  }

  // keep the bottom in view only when the person is already at the bottom (or just sent something),
  // and keep the position when older messages are added on top
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    if (prepend.current !== null) {
      el.scrollTop += el.scrollHeight - prepend.current
      prepend.current = null
      return
    }
    const last = msgs[msgs.length - 1]
    if (!last) return
    if (firstScroll.current) {
      firstScroll.current = false
      el.scrollTop = el.scrollHeight
    } else if (stick.current || last.sender_id === uid) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }, [msgs, uid])

  // photos / GIFs / videos change the height when they finish loading: stay at the bottom
  const settle = () => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }

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
        const isVideo = att.file.type.startsWith('video/')
        // big photos are reduced first: much faster upload, and much faster to show up for the other person
        const f = isVideo ? att.file : await shrinkPhoto(att.file)
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
            contentType: f.type,
            cacheControl: '31536000'
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

      <div
        className="msgs"
        ref={box}
        onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160 }}
        onLoadCapture={settle}
        onLoadedMetadataCapture={settle}
      >
        {hasMore && (
          <button className="ghost load-older" disabled={loadingOlder} onClick={loadOlder}>
            {loadingOlder ? 'Loading...' : 'Load earlier messages'}
          </button>
        )}
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
                            <GifView media={gifMedia} />

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