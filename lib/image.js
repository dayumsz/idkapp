// Browser-side image helpers. A single huge downscale (4000px -> 96px) looks jagged in
// every browser, so images are always reduced in halving steps with high quality smoothing.

export function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); res(img) }
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read image')) }
    img.src = url
  })
}

const canvas = (w, h) => {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  const g = c.getContext('2d')
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  return c
}

// draws the region (sx, sy, sw, sh) of src into a canvas of w x h, halving until close to the target
export function resample(src, sx, sy, sw, sh, w, h) {
  let cur = src
  let cx = sx
  let cy = sy
  let cw = sw
  let ch = sh
  while (cw / 2 >= w && ch / 2 >= h) {
    const step = canvas(cw / 2, ch / 2)
    step.getContext('2d').drawImage(cur, cx, cy, cw, ch, 0, 0, step.width, step.height)
    cur = step
    cx = 0
    cy = 0
    cw = step.width
    ch = step.height
  }
  const out = canvas(w, h)
  out.getContext('2d').drawImage(cur, cx, cy, cw, ch, 0, 0, out.width, out.height)
  return out
}

export const toBlob = (c, type, q = 0.95) => new Promise(res => c.toBlob(res, type, q))

// square avatar: one crop, exported in the three sizes the app uses
export const AVATAR_SIZES = { l: 512, m: 256, s: 128 }

export async function avatarVariants(img, sx, sy, side, type) {
  const out = {}
  for (const [k, px] of Object.entries(AVATAR_SIZES)) {
    out[k] = await toBlob(resample(img, sx, sy, side, side, px, px), type, 0.96)
  }
  return out
}

// banner: png/jpeg wider than max are reduced once, gifs are left alone to keep the animation
export async function shrinkBanner(file, maxW = 1440) {
  if (file.type === 'image/gif') return file
  const img = await loadImage(file)
  if (img.naturalWidth <= maxW) return file
  const w = maxW
  const h = (img.naturalHeight * maxW) / img.naturalWidth
  const blob = await toBlob(resample(img, 0, 0, img.naturalWidth, img.naturalHeight, w, h), file.type, 0.93)
  return blob ? new File([blob], file.name, { type: file.type }) : file
}

// photo for a chat message: big png/jpeg are reduced before upload so they upload and arrive much faster.
// gifs and videos are never touched (it would freeze the animation). Falls back to the original on any problem.
export async function shrinkPhoto(file, maxSide = 2048) {
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') return file
  try {
    const img = await loadImage(file)
    const big = Math.max(img.naturalWidth, img.naturalHeight)
    if (big <= maxSide && file.size < 600 * 1024) return file
    const k = Math.min(1, maxSide / big)
    const w = Math.round(img.naturalWidth * k)
    const h = Math.round(img.naturalHeight * k)
    let type = 'image/jpeg'
    if (file.type === 'image/png') {
      // keep png only when it really has transparency
      const probe = canvas(64, 64)
      probe.getContext('2d').drawImage(img, 0, 0, 64, 64)
      const px = probe.getContext('2d').getImageData(0, 0, 64, 64).data
      for (let i = 3; i < px.length; i += 4) if (px[i] < 250) { type = 'image/png'; break }
    }
    const c = resample(img, 0, 0, img.naturalWidth, img.naturalHeight, w, h)
    if (type === 'image/jpeg') {
      // jpeg has no transparency: paint on white so nothing turns black
      const flat = canvas(c.width, c.height)
      const g = flat.getContext('2d')
      g.fillStyle = '#fff'
      g.fillRect(0, 0, flat.width, flat.height)
      g.drawImage(c, 0, 0)
      const blob = await toBlob(flat, type, 0.86)
      return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type }) : file
    }
    const blob = await toBlob(c, type)
    return blob && blob.size < file.size ? new File([blob], file.name, { type }) : file
  } catch {
    return file
  }
}
