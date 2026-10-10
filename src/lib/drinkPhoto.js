/** Drink photos for the till tiles: shrink in the browser, store in Supabase Storage, keep only the public URL on the row. */

export const DRINK_PHOTO_BUCKET = 'drink-photos'
export const DRINK_PHOTO_MAX = 800

/** Fit (w, h) inside max × max, keeping the aspect ratio. Never upscales. */
export function fitSize(w, h, max = DRINK_PHOTO_MAX) {
  const W = Math.max(1, +w || 1)
  const H = Math.max(1, +h || 1)
  const k = Math.min(1, max / Math.max(W, H))
  return { width: Math.round(W * k), height: Math.round(H * k) }
}

/** Storage path: <scope>/<time>-<slug>.jpg. Scope is the bar id or "menu" for the shared JBM menu. */
export function drinkPhotoPath(scope, name, now = Date.now()) {
  const slug = String(name || 'drink').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'drink'
  const dir = String(scope || 'menu').replace(/[^\w-]/g, '') || 'menu'
  return `${dir}/${now}-${slug}.jpg`
}

/** Load an image file and re-encode it as a JPEG no larger than max px. Falls back to the original file. */
export async function shrinkImage(file, max = DRINK_PHOTO_MAX) {
  if (!file || !/^image\//.test(file.type || '') || typeof document === 'undefined') return file
  try {
    const url = URL.createObjectURL(file)
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = reject
      el.src = url
    })
    URL.revokeObjectURL(url)
    const { width, height } = fitSize(img.naturalWidth, img.naturalHeight, max)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(img, 0, 0, width, height)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.84))
    return blob || file
  } catch {
    return file
  }
}

/** Upload and return the public URL. A missing bucket comes back as { code: 'bucket' } so the screen can say which SQL to run. */
export async function uploadDrinkPhoto(client, file, { scope, name } = {}) {
  const body = await shrinkImage(file)
  const path = drinkPhotoPath(scope, name)
  const { error } = await client.storage.from(DRINK_PHOTO_BUCKET).upload(path, body, { contentType: 'image/jpeg', upsert: false })
  if (error) {
    const msg = String(error.message || error)
    const err = new Error(msg)
    if (/bucket/i.test(msg) && /not.*found|does not exist/i.test(msg)) err.code = 'bucket'
    throw err
  }
  const { data } = client.storage.from(DRINK_PHOTO_BUCKET).getPublicUrl(path)
  if (!data?.publicUrl) throw new Error('Photo URL unavailable')
  return data.publicUrl
}
