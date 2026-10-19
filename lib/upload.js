import { supabase } from './supabase'

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' }

export async function upload(bucket, uid, file, name = String(Date.now())) {
  const path = `${uid}/${name}.${EXT[file.type]}`
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type, cacheControl: '31536000' })
  return error ? null : supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
}

// avatar is stored in 3 sizes (_l 512px, _m 256px, _s 128px), Avatar picks the best one for each place.
// Returns the url of the big one, or null if any of the three uploads failed.
export async function uploadAvatar(uid, v, prefix = '') {
  const t = Date.now()
  // animated gifs are stored as they are: going through a canvas would freeze them on the first frame.
  // The name has no _l/_m/_s suffix, so Avatar uses the url as it is.
  if (v.gif) return upload('avatars', uid, v.gif, `${prefix}${t}`)
  const [l, m, s] = await Promise.all([
    upload('avatars', uid, v.l, `${prefix}${t}_l`),
    upload('avatars', uid, v.m, `${prefix}${t}_m`),
    upload('avatars', uid, v.s, `${prefix}${t}_s`)
  ])
  return l && m && s ? l : null
}
