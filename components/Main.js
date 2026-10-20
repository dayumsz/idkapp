'use client'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { info, PROFILE_COLS } from '../lib/info'
import Call from './Call'
import Chat from './Chat'
import Avatar from './Avatar'
import Friends from './Friends'
import NewGroup from './NewGroup'
import ProfileCard from './ProfileCard'
import ProfileEdit from './ProfileEdit'
import ThemePicker from './ThemePicker'
import { uploadAvatar } from '../lib/upload'

const rpc = async (fn, args) => {
  const { data, error } = await supabase.rpc(fn, args)
  return { data, error: error ? error.message : null }
}

export default function Main({ session }) {
  const uid = session.user.id
  const [me, setMe] = useState(null)
  const [chats, setChats] = useState([])
  const [rels, setRels] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [tab, setTab] = useState('chats')
  const [panel, setPanel] = useState(null)
  const [viewing, setViewing] = useState(null)
  // the call lives here (not inside Chat) so it keeps running while you browse other chats
  const [call, setCall] = useState(null) // conversation id of the call you are in
  const [expanded, setExpanded] = useState(true)
  const [rooms, setRooms] = useState({}) // conversation id -> user ids currently in its call
  const [notice, setNotice] = useState('')
  const [pinned, setPinned] = useState([])
  const [favoriteChat, setFavoriteChat] = useState(null)
<<<<<<< HEAD
=======
  const [compact, setCompact] = useState(false)
  const [wide, setWide] = useState(true)
  useEffect(() => {
    const m = window.matchMedia('(min-width: 701px)')
    const on = () => setWide(m.matches)
    on()
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  useEffect(() => { try { setCompact(localStorage.getItem('sidebar-compact') === '1') } catch {} }, [])
  const toggleCompact = () => setCompact(v => { const n = !v; try { localStorage.setItem('sidebar-compact', n ? '1' : '0') } catch {} if (n) setTab('chats'); return n })
>>>>>>> 099f928 (some adds)
  const [favoriteMessages, setFavoriteMessages] = useState([])
  const roomsRef = useRef({})
  const active = chats.find(c => c.id === activeId) || null
  useEffect(() => { try { setPinned(JSON.parse(localStorage.getItem(`pinned-chats:${uid}`) || '[]')) } catch { setPinned([]) } }, [uid])
  const togglePin = cid => setPinned(current => { const next = current.includes(cid) ? current.filter(id => id !== cid) : [...current, cid]; try { localStorage.setItem(`pinned-chats:${uid}`, JSON.stringify(next)) } catch {} return next })
  const showFavorites = async cid => { const { data: fav } = await supabase.from('message_favorites').select('message_id').eq('user_id', uid); const ids = (fav || []).map(x => x.message_id); if (!ids.length) { setFavoriteMessages([]); setFavoriteChat(cid); return } const { data } = await supabase.from('messages').select('*').in('id', ids).eq('conversation_id', cid).order('created_at'); setFavoriteMessages(data || []); setFavoriteChat(cid) }
  const callChat = call ? chats.find(c => c.id === call) || null : null

  const loadMe = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).single()
    setMe(data)
  }, [uid])

  const loadChats = useCallback(async () => {
    const { data } = await supabase
      .from('members')
      .select(`conversations(id,name,is_group,owner_id,icon_url,created_at,members(profiles(${PROFILE_COLS})))`)
      .eq('user_id', uid)
    setChats((data || []).map(r => r.conversations).filter(Boolean))
  }, [uid])

  const loadRels = useCallback(async () => {
    const { data } = await supabase
      .from('friendships')
      .select(`id,status,requester_id,addressee_id,requester:profiles!friendships_requester_id_fkey(${PROFILE_COLS}),addressee:profiles!friendships_addressee_id_fkey(${PROFILE_COLS})`)
    setRels(data || [])
  }, [])

  useEffect(() => {
    loadMe()
    loadChats()
    loadRels()
    const ch = supabase
      .channel(`sync:${uid}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'members', filter: `user_id=eq.${uid}` }, loadChats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, loadRels)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations' }, loadChats)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [uid, loadMe, loadChats, loadRels])

  // Realtime presence tells who is in each call, so a call really ends when the last person leaves.
  // One presence channel per chat you opened, kept open until you leave the app.
  useEffect(() => {
    const open = e => {
      const cid = e.cid
      const topic = `realtime:room:${cid}`
      ;(async () => {
        // a channel with this topic may still be closing (React dev double mount), wait for it
        for (let i = 0; i < 25 && supabase.getChannels().some(c => c.topic === topic); i++) await new Promise(r => setTimeout(r, 80))
        if (e.dead) return
        const ch = supabase.channel(`room:${cid}`, { config: { presence: { key: uid } } })
        e.ch = ch
        ch.on('presence', { event: 'sync' }, () => {
          if (!e.dead) setRooms(r => ({ ...r, [cid]: Object.keys(ch.presenceState()) }))
        })
        ch.subscribe(st => {
          if (st !== 'SUBSCRIBED' || e.dead) return
          e.ready = true
          if (callRef.current === cid && !e.tracked) { e.tracked = true; ch.track({ at: Date.now() }) }
          setTimeout(() => { if (!e.dead) setRooms(r => (r[cid] ? r : { ...r, [cid]: Object.keys(ch.presenceState()) })) }, 1500)
        })
      })()
    }
    const rs = roomsRef.current
    for (const cid of [activeId, call]) {
      if (cid && !rs[cid]) { rs[cid] = { cid, ch: null, ready: false, tracked: false, dead: false }; open(rs[cid]) }
    }
  }, [activeId, call, uid])

  const callRef = useRef(null)
  callRef.current = call

  // announce / withdraw my presence in the room of the call I am in
  useEffect(() => {
    for (const e of Object.values(roomsRef.current)) {
      if (!e.ready || !e.ch) continue
      if (e.cid === call && !e.tracked) { e.tracked = true; e.ch.track({ at: Date.now() }) }
      if (e.cid !== call && e.tracked) { e.tracked = false; e.ch.untrack() }
    }
  }, [call])

  useEffect(() => () => {
    for (const e of Object.values(roomsRef.current)) {
      e.dead = true
      if (e.ch) supabase.removeChannel(e.ch)
    }
    roomsRef.current = {}
  }, [uid])

  // left the group while in its call
  useEffect(() => { if (call && chats.length && !callChat) setCall(null) }, [call, chats, callChat])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 4500)
    return () => clearTimeout(t)
  }, [notice])

  const joinCall = useCallback(cid => { setCall(cid); setExpanded(true) }, [])
  const endCall = useCallback(err => {
    setCall(null)
    if (err && err.name) {
      setNotice(
        err.name === 'NotAllowedError' ? 'Microphone blocked. Allow it in the browser settings and try again.'
          : err.name === 'NotFoundError' ? 'No microphone found.'
          : 'Could not start the call.'
      )
    }
  }, [])

  const friends = useMemo(() => rels.filter(r => r.status === 'accepted').map(r => (r.requester_id === uid ? r.addressee : r.requester)), [rels, uid])
  const incoming = useMemo(() => rels.filter(r => r.status === 'pending' && r.addressee_id === uid).map(r => r.requester), [rels, uid])
  const outgoing = useMemo(() => rels.filter(r => r.status === 'pending' && r.requester_id === uid).map(r => r.addressee), [rels, uid])

  const actions = {
    async request(publicId) {
      const r = await rpc('send_friend_request', { target_public_id: publicId })
      await loadRels()
      return r.error
    },
    async accept(id) {
      await rpc('accept_friend', { other: id })
      await loadRels()
    },
    async remove(id) {
      await rpc('remove_friend', { other: id })
      await loadRels()
    },
    async message(id) {
      const r = await rpc('open_dm', { friend: id })
      if (r.error) return
      await loadChats()
      setActiveId(r.data)
      setTab('chats')
    },
    async createGroup(name, ids, icon) {
      const r = await rpc('create_group', { group_name: name, member_ids: ids })
      if (r.error) return r.error
      if (icon) {
        const e = await actions.setGroupIcon(r.data, icon)
        if (e) setNotice('Group created, but the icon could not be saved')
      }
      await loadChats()
      setActiveId(r.data)
      setPanel(null)
      return null
    },
    // icon = the three cropped sizes from the Cropper, or null to remove the icon
    async setGroupIcon(cid, icon) {
      let url = null
      if (icon) {
        url = await uploadAvatar(uid, icon, 'group_')
        if (!url) return 'Icon upload failed'
      }
      const r = await rpc('set_group_icon', { cid, url })
      if (r.error) return r.error
      await loadChats()
      return null
    },
    async addMember(cid, id) {
      const r = await rpc('add_group_member', { cid, new_member: id })
      await loadChats()
      return r.error
    },
    async leave(cid) {
      await rpc('leave_group', { cid })
      setActiveId(null)
      await loadChats()
    }
  }

  return (
    <div className={`app ${active ? 'open' : ''} ${call && !expanded ? 'incall' : ''} ${compact ? 'compact' : ''}`}>
      <aside>
        <header>
          <Avatar url={me?.avatar_url} name={me?.display_name} onClick={() => me && setViewing(me)} />
          <b>{me?.display_name}</b>
          <button className="ghost themebtn" onClick={() => setPanel('theme')}>Theme</button>
          <button className="ghost compact-btn" onClick={toggleCompact} title={compact ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'}>{compact ? '›' : '‹'}</button>
        </header>
        <nav className="tabs" data-tab={tab}>
          <button className={tab === 'chats' ? 'on' : ''} onClick={() => setTab('chats')}>Chats</button>
          <button className={tab === 'friends' ? 'on' : ''} onClick={() => setTab('friends')}>
            Friends{incoming.length > 0 && <i className="badge">{incoming.length}</i>}
          </button>
          <span className="ink" />
        </nav>
        {tab === 'chats' ? (
          <div className="list pane" key="chats">
            <button className="ghost wide" title="New group" onClick={() => setPanel('group')}><span className="lbl-full">New group</span><span className="lbl-short">+</span></button>
            {chats.length === 0 && <p className="note">No chats yet. Add a friend, then message them.</p>}
            {[...chats].sort((a, b) => Number(pinned.includes(b.id)) - Number(pinned.includes(a.id))).map((c, n) => {
              const i = info(c, uid)
              return (
                <div key={c.id} title={i.name} className={`row ${activeId === c.id ? 'sel' : ''} ${call === c.id ? 'row-incall' : ''}`} style={{ '--i': n }} onClick={() => setActiveId(c.id)}>
                  <Avatar url={i.avatar} name={i.name} />
                  <span>{i.name}</span>
                  {pinned.includes(c.id) && <small className="pin-mark" title="Pinned">◆</small>}
                  {c.is_group && <small className="tag">group</small>}
                  {call === c.id && <small className="tag inlive">in call</small>}
                </div>
              )
            })}
          </div>
        ) : (
          <Friends key="friends" friends={friends} incoming={incoming} outgoing={outgoing} actions={actions} onProfile={setViewing} />
        )}
      </aside>
      <main>
        {active
          ? <Chat
              key={active.id}
              chat={active}
              uid={uid}
              friends={friends}
              actions={actions}
              inCall={call === active.id}
              roomUsers={rooms[active.id]}
              onJoinCall={() => joinCall(active.id)}
              onOpenCall={() => setExpanded(true)}
              onBack={() => setActiveId(null)}
              onProfile={setViewing}
              pinned={pinned.includes(active.id)}
              onTogglePin={() => togglePin(active.id)}
              onShowFavorites={() => showFavorites(active.id)}
              dismissKey={`${viewing?.id || ''}|${panel || ''}|${call || ''}|${favoriteChat || ''}`}
            />
          : <div className="empty">No chat selected<span className="caret">_</span></div>}
      </main>
      {favoriteChat && (
        <div className="favorite-conversation">
          <div className="gif-picker-head"><b>Favorite messages</b><button className="ghost" onClick={() => setFavoriteChat(null)}>Close</button></div>
          {favoriteMessages.length ? favoriteMessages.map(m => <article key={m.id}><small>{new Date(m.created_at).toLocaleString()}</small><div>{m.deleted_at ? 'Message deleted' : m.body || m.gif_url || (m.video_url ? 'Video' : m.image_url ? 'Image' : 'Attachment')}</div></article>) : <p className="note">No favorite messages in this conversation.</p>}
        </div>
      )}
      {viewing && (
        <ProfileCard
          profile={viewing.id === uid && me ? me : viewing}
          isMe={viewing.id === uid}
          onEdit={() => setPanel('edit')}
          onClose={() => setViewing(null)}
        />
      )}
      {panel === 'edit' && me && (
        <ProfileEdit me={me} onClose={() => { setPanel(null); loadMe(); loadChats() }} />
      )}
      {panel === 'theme' && <ThemePicker onClose={() => setPanel(null)} />}
      {panel === 'group' && <NewGroup friends={friends} onCreate={actions.createGroup} onClose={() => setPanel(null)} />}
      {call && callChat && (
        <Call
          key={call}
          conversationId={call}
          uid={uid}
          title={info(callChat, uid).name}
          people={Object.fromEntries(callChat.members.map(m => [m.profiles.id, m.profiles]))}
          minimized={!expanded}
          compact={compact && wide}
          onMinimize={() => setExpanded(false)}
          onExpand={() => setExpanded(true)}
          onEnd={endCall}
        />
      )}
      {notice && <div className="toast">{notice}</div>}
    </div>
  )
}
