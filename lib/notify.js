// Notification sounds + desktop notifications, shared by the whole app.
// One single AudioContext is reused (a new one per sound is slow and browsers limit how many can exist).

const PREFS_KEY = 'notify-prefs'
const DEFAULTS = { sound: true, desktop: true }

export const readNotifyPrefs = () => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') } } catch { return { ...DEFAULTS } }
}
export const writeNotifyPrefs = p => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch {} }

// ---------- sound ----------
const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null
let ctx = null
const context = () => {
  if (!AC) return null
  if (!ctx || ctx.state === 'closed') ctx = new AC()
  return ctx
}

// browsers only allow sound after the person interacted with the page once
export function unlockAudio() {
  const c = context()
  if (c && c.state !== 'running') c.resume().catch(() => {})
}
if (typeof window !== 'undefined') {
  ;['pointerdown', 'keydown', 'touchend', 'click'].forEach(e => window.addEventListener(e, unlockAudio, { capture: true, passive: true }))
}
export const audioReady = () => !!ctx && ctx.state === 'running'

// [frequency, start, duration]
const TONES = {
  message: { v: 0.09, n: [[600, 0, 0.06]] },
  send: { v: 0.09, n: [[520, 0, 0.07], [660, 0.08, 0.08]] },
  receive: { v: 0.07, n: [[740, 0, 0.1], [980, 0.12, 0.14]] }, // soft: message in the chat you are looking at
  notify: { v: 0.14, n: [[659, 0, 0.12], [880, 0.13, 0.12], [1175, 0.27, 0.24]] }, // message while you are elsewhere
  call: { v: 0.09, n: [[440, 0, 0.16], [554, 0.2, 0.18], [659, 0.42, 0.24]] },
  ring: { v: 0.12, n: [[660, 0, 0.18], [880, 0.22, 0.22], [660, 0.55, 0.18], [880, 0.78, 0.22]] }
}

export function playTone(kind = 'message') {
  const c = context()
  const t = TONES[kind] || TONES.message
  if (!c) return
  const asked = Date.now()
  const go = () => {
    // never play a late sound that was waiting for the audio engine to wake up
    if (c.state !== 'running' || Date.now() - asked > 1500) return
    const now = c.currentTime
    t.n.forEach(([f, start, dur]) => {
      const o = c.createOscillator()
      const g = c.createGain()
      o.type = 'sine'
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, now + start)
      g.gain.exponentialRampToValueAtTime(t.v, now + start + 0.015)
      g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur)
      o.connect(g)
      g.connect(c.destination)
      o.start(now + start)
      o.stop(now + start + dur + 0.02)
    })
  }
  if (c.state === 'running') go()
  else c.resume().then(go).catch(() => {})
}

// ---------- desktop notifications ----------
export const desktopSupported = () => typeof Notification !== 'undefined'
export const desktopState = () => (desktopSupported() ? Notification.permission : 'unsupported')

export async function askDesktop() {
  if (!desktopSupported()) return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  try { return await Notification.requestPermission() } catch { return Notification.permission }
}

// same tag = the notification of that chat is replaced instead of piling up
export function showDesktop({ title, body, tag, icon, onClick }) {
  if (!desktopSupported() || Notification.permission !== 'granted') return
  try {
    const n = new Notification(title, { body, tag, icon: icon || undefined, silent: true })
    n.onclick = () => { try { window.focus() } catch {} ; onClick?.(); n.close() }
    setTimeout(() => { try { n.close() } catch {} }, 8000)
  } catch {}
}

// ---------- what to show for a message ----------
const GIF_LINK = /^https?:\/\/\S+(\.gifv?\b|giphy\.com|tenor\.com)/i

export function previewOf(m) {
  if (!m) return 'New message'
  if (m.kind && m.kind !== 'text') return 'started a call'
  if (m.deleted_at) return 'Deleted a message'
  const cap = (m.body || '').trim()
  const short = s => (s.length > 140 ? `${s.slice(0, 140)}…` : s)
  if (m.view_once) return 'Photo (view once)'
  if (m.video_url) return cap ? `Video · ${short(cap)}` : 'Video'
  if (m.image_url) {
    const gif = /\.gif(?:[?#].*)?$/i.test(m.image_url)
    return cap ? `${gif ? 'GIF' : 'Photo'} · ${short(cap)}` : gif ? 'GIF' : 'Photo'
  }
  if (m.gif_url || GIF_LINK.test(cap)) return 'GIF'
  return short(cap) || 'New message'
}
