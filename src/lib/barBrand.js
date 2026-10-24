/**
 * Each bar's own look in its app: colour, logo and name at the top. Chosen in HQ → Bars.
 * The colour and logo live in the `bar_brand` live-store table (one row per bar, id = bar id), so no SQL is needed;
 * bars.nome stays the name and bars.cor is kept in step for the HQ lists.
 * Pure helpers here (tested in scripts/barBrand.test.mjs); the logo resize runs only in the browser.
 */

export const ATOMIC_BAR_ID = 'b23a5f97-ad4c-4c2a-baa6-72a0d3ba85b9'
export const ATOMIC_RED = '#D7191F'

/** Quick picks in the HQ form. The first one gives the Atomic look (red and black). */
export const BRAND_COLORS = [
  { hex: ATOMIC_RED, key: 'red' },
  { hex: '#E8590C', key: 'orange' },
  { hex: '#C99A2E', key: 'gold' },
  { hex: '#2F9E44', key: 'green' },
  { hex: '#3F7F67', key: 'emerald' },
  { hex: '#1C7ED6', key: 'blue' },
  { hex: '#5F3DC4', key: 'purple' },
  { hex: '#C2255C', key: 'pink' },
  { hex: '#212529', key: 'black' },
]

export const isAtomicBar = bar => bar?.id === ATOMIC_BAR_ID || /\batomic\b/i.test(String(bar?.nome || ''))

/** "#abc" / "#AABBCC" → "#aabbcc"; anything else (CSS words, url(), var()) → ''. */
export function cleanHex(raw) {
  const v = String(raw || '').trim()
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v.slice(1).split('').map(c => c + c).join('')}`.toLowerCase()
  return ''
}

/** Only https pictures or inline image data (what the HQ upload stores). */
export function cleanLogo(raw) {
  const v = String(raw || '').trim()
  return /^https:\/\//.test(v) || /^data:image\/(png|jpeg|webp|gif);base64,/.test(v) ? v : ''
}

/**
 * The colour a bar's app uses: the one chosen in HQ, else Atomic red for Atomic, else the old bars.cor.
 * Atomic's old bars.cor (a blue from the first import) is ignored until someone picks a colour in HQ.
 */
export function brandColorOf(bar) {
  const chosen = cleanHex(bar?.marca?.cor)
  if (chosen) return chosen
  if (isAtomicBar(bar)) return cleanHex(ATOMIC_RED)
  return cleanHex(bar?.cor)
}

function rgb(hex) {
  const h = cleanHex(hex).slice(1)
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
}
const toHex = c => `#${c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`
/** Mix two colours: t = share of b (0 → a, 1 → b). */
export function mix(a, b, t) {
  const x = rgb(a)
  const y = rgb(b)
  return toHex(x.map((v, i) => v + (y[i] - v) * t))
}
/** WCAG relative luminance, 0 (black) … 1 (white). */
export function luminance(hex) {
  const [r, g, b] = rgb(hex).map(v => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Darken (light theme) or lighten (dark theme) until the colour reads as text on that background. */
function readableOn(color, bg, target = 4.5) {
  const toward = luminance(bg) > 0.5 ? '#000000' : '#ffffff'
  let out = color
  for (let i = 1; i <= 10 && contrast(out, bg) < target; i++) out = mix(color, toward, i * 0.08)
  return out
}

/**
 * Theme tokens for a bar colour, for both themes. The app reads them as --bb-* on <html> (src/design/barBrand.css).
 * Accent stays the picked colour where it is readable; chrome (sidebar, top bar) is the colour sunk into near-black.
 */
export function brandTokens(color) {
  const c = cleanHex(color)
  if (!c) return null
  const light = readableOn(c, '#ffffff', 3)
  const dark = readableOn(c, '#161618', 4.5)
  const onLight = contrast('#ffffff', light) >= 3 ? '#ffffff' : '#141414'
  const onDark = contrast('#ffffff', dark) >= 3 ? '#ffffff' : '#141414'
  const chrome = mix(c, '#0e0e0f', 0.86)
  return {
    '--bb-accent': light,
    '--bb-accent-2': mix(light, '#000000', 0.14),
    '--bb-soft': mix(c, '#ffffff', 0.88),
    '--bb-on': onLight,
    '--bb-accent-d': dark,
    '--bb-accent-2-d': mix(dark, '#ffffff', 0.14),
    '--bb-soft-d': `color-mix(in srgb, ${c} 16%, transparent)`,
    '--bb-on-d': onDark,
    '--bb-chrome': chrome,
    '--bb-chrome-2': mix(c, '#0e0e0f', 0.8),
    '--bb-chrome-3': mix(c, '#0e0e0f', 0.74),
    '--bb-raw': c,
  }
}

/** Everything a screen needs to draw the bar's top: name, mark (logo / atom / initials) and theme. */
export function resolveBrand(bar) {
  const name = String(bar?.nome || '').trim()
  const color = brandColorOf(bar)
  const atomic = isAtomicBar(bar)
  return {
    atomic,
    // Red/black (the Atomic look, staffApp.css + barBrand.css) whenever the bar's colour is Atomic red.
    theme: color === ATOMIC_RED.toLowerCase() ? 'atomic' : color ? 'custom' : '',
    name,
    color,
    logo: cleanLogo(bar?.marca?.logo) || cleanLogo(bar?.logo_url || bar?.logo),
  }
}

/** One bar_brand row from the HQ form. */
export function brandRow(barId, { cor, logo } = {}) {
  return {
    id: barId,
    bar_id: barId,
    cor: cleanHex(cor) || null,
    logo: cleanLogo(logo) || null,
    atualizado_em: new Date().toISOString(),
  }
}

export const LOGO_MAX_CHARS = 400_000

/**
 * Picture file → square PNG data URL (default 256 px), the whole logo fitted inside (no crop), transparency kept.
 * Browser only.
 */
export function fileToLogo(file, { size = 256 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type || '')) return reject(new Error('Pick a picture'))
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight, 1)
        const w = Math.max(1, Math.round(img.naturalWidth * scale))
        const h = Math.max(1, Math.round(img.naturalHeight * scale))
        const side = Math.max(w, h)
        const canvas = document.createElement('canvas')
        canvas.width = side
        canvas.height = side
        canvas.getContext('2d').drawImage(img, (side - w) / 2, (side - h) / 2, w, h)
        let out = canvas.toDataURL('image/png')
        // Photos make big PNGs: fall back to JPEG on white.
        if (out.length > LOGO_MAX_CHARS) {
          const ctx = canvas.getContext('2d')
          ctx.globalCompositeOperation = 'destination-over'
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, side, side)
          out = canvas.toDataURL('image/jpeg', 0.85)
        }
        URL.revokeObjectURL(url)
        resolve(out)
      } catch (e) {
        URL.revokeObjectURL(url)
        reject(e)
      }
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this picture')) }
    img.src = url
  })
}
