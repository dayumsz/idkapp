'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { info, PROFILE_COLS } from '../lib/info'
import Chat from './Chat'
import Avatar from './Avatar'
import Friends from './Friends'
import NewGroup from './NewGroup'
import ProfileCard from './ProfileCard'
import ProfileEdit from './ProfileEdit'
import ThemePicker from './ThemePicker'

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
  const active = chats.find(c => c.id === activeId) || null

  const loadMe = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).single()
    setMe(data)
  }, [uid])

  const loadChats = useCallback(async () => {
    const { data } = await supabase
      .from('members')
      .select(`conversations(id,name,is_group,owner_id,created_at,members(profiles(${PROFILE_COLS})))`)
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
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [uid, loadMe, loadChats, loadRels])

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
    async createGroup(name, ids) {
      const r = await rpc('create_group', { group_name: name, member_ids: ids })
      if (r.error) return r.error
      await loadChats()
      setActiveId(r.data)
      setPanel(null)
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
    <div className={`app ${active ? 'open' : ''}`}>
      <aside>
        <header>
          <Avatar url={me?.avatar_url} name={me?.display_name} onClick={() => me && setViewing(me)} />
          <b>{me?.display_name}</b>
          <button className="ghost" onClick={() => setPanel('theme')}>Theme</button>
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
            <button className="ghost wide" onClick={() => setPanel('group')}>New group</button>
            {chats.length === 0 && <p className="note">No chats yet. Add a friend, then message them.</p>}
            {chats.map((c, n) => {
              const i = info(c, uid)
              return (
                <div key={c.id} className={`row ${activeId === c.id ? 'sel' : ''}`} style={{ '--i': n }} onClick={() => setActiveId(c.id)}>
                  <Avatar url={i.avatar} name={i.name} />
                  <span>{i.name}</span>
                  {c.is_group && <small className="tag">group</small>}
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
          ? <Chat key={active.id} chat={active} uid={uid} friends={friends} actions={actions} onBack={() => setActiveId(null)} onProfile={setViewing} />
          : <div className="empty">No chat selected<span className="caret">_</span></div>}
      </main>
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
    </div>
  )
}
