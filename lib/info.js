export const PROFILE_COLS = 'id,display_name,avatar_url,banner_url,bio,public_id,created_at'

export const info = (c, uid) => {
  if (c.is_group) return { name: c.name, avatar: null }
  const o = c.members.map(m => m.profiles).find(p => p.id !== uid) || {}
  return { name: o.display_name, avatar: o.avatar_url }
}
