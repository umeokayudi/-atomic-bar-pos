/**
 * Files for the AI chat: photos (shrunk to 1600 px JPEG), PDFs, text/CSV and short videos.
 * The server takes about 2.5 MB of files per message (Vercel request limit), so bigger files are refused here.
 */
export const ATTACH_MAX_BYTES = 2_500_000
export const ATTACH_MAX_FILES = 4
export const ATTACH_ACCEPT = {
  photo: 'image/*',
  file: '.pdf,.csv,.txt,.md,.json,.tsv,application/pdf,text/plain,text/csv,application/json',
  video: 'video/*',
}

export function attachKind(mime = '') {
  if (mime.startsWith('image/')) return 'photo'
  if (mime.startsWith('video/')) return 'video'
  return 'file'
}

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(r.error || new Error('read failed'))
    r.readAsDataURL(blob)
  })
}

async function shrinkImage(file, max = 1600) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = reject
      el.src = url
    })
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.82)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** File → { name, mimeType, data (base64), size, kind, preview } or throws Error(code) with code in ai.attach* keys. */
export async function readAttachment(file) {
  const mime = file.type || (/\.csv$/i.test(file.name) ? 'text/csv' : /\.(txt|md)$/i.test(file.name) ? 'text/plain' : /\.json$/i.test(file.name) ? 'application/json' : '')
  const kind = attachKind(mime)
  let dataUrl
  if (kind === 'photo' && !/gif/i.test(mime)) {
    try { dataUrl = await shrinkImage(file) } catch { dataUrl = await readAsDataUrl(file) }
  } else {
    if (file.size > ATTACH_MAX_BYTES) throw new Error(kind === 'video' ? 'ai.attachVideoTooBig' : 'ai.attachTooBig')
    dataUrl = await readAsDataUrl(file)
  }
  const [head, data = ''] = dataUrl.split(',')
  const mimeType = (head.match(/^data:([^;]+)/) || [])[1] || mime || 'application/octet-stream'
  const size = Math.round(data.length * 0.75)
  if (size > ATTACH_MAX_BYTES) throw new Error('ai.attachTooBig')
  return { name: file.name || kind, mimeType, data, size, kind, preview: kind === 'photo' ? dataUrl : '' }
}
