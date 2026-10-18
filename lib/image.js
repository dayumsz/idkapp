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
