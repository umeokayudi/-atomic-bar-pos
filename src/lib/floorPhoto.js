/**
 * Room photo → floor pieces. The AI reads a photo (or a drawn sketch) of the room and lists what it sees;
 * nothing is saved: the pieces are added to the editor, where the owner moves, deletes or undoes them.
 */
import { SHAPES, clampTable, tempId } from './floorEditor.js'

const FORMAS = Object.keys(SHAPES)

export const FLOOR_PHOTO_SYSTEM = `You turn a photo or a sketch of a bar room into a floor plan seen from above.
Reply with JSON only, no prose:
{"room":{"w":<room width in cm>,"d":<room depth in cm>},"pieces":[{"name":"<short name>","shape":"<shape>","x":<cm from the left wall>,"y":<cm from the back wall>,"w":<width cm>,"d":<depth cm>,"seats":<people who sit there>}]}
shape is one of: round, square, rect (tables), bar (a counter), sofa, wall, door, stage (a room or area such as a karaoke room, toilet, DJ booth, stage), plant (a stool, a plant or another small thing).
Rules: one piece per table, sofa, counter, stool, wall and door you can see. Name tables "Mesa 1", "Mesa 2"... unless a number is visible; name rooms by what they are (Karaoke VIP, Toilet, Entrance). Stools at a counter are plant pieces with seats 1. Walls, doors and rooms with no seating have seats 0. Estimate real sizes (a 2-person table is about 70 cm, a stool about 40 cm). x and y are the top-left corner of the piece. Leave out what you cannot see.`

export const floorPhotoPrompt = note =>
  `Read this room and list its pieces as JSON.${note ? ` Notes from the owner: ${String(note).slice(0, 400)}` : ''}`

const num = v => (Number.isFinite(+v) ? +v : NaN)

/**
 * The AI's answer as editor tables, scaled into the layout (the room fills it, keeping its shape).
 * Pieces with a bad shape or size are skipped. Returns { tables, skipped }.
 */
export function piecesFromAi(answer, layout) {
  const pieces = Array.isArray(answer?.pieces) ? answer.pieces : []
  const roomW = num(answer?.room?.w) > 0 ? num(answer.room.w) : Math.max(1, ...pieces.map(p => num(p.x) + num(p.w)).filter(Number.isFinite))
  const roomD = num(answer?.room?.d) > 0 ? num(answer.room.d) : Math.max(1, ...pieces.map(p => num(p.y) + num(p.d)).filter(Number.isFinite))
  const scale = Math.min((+layout.largura || 900) / roomW, (+layout.altura || 500) / roomD)
  const tables = []
  let skipped = 0
  for (const p of pieces.slice(0, 300)) {
    const forma = String(p?.shape || '').toLowerCase()
    const x = num(p?.x); const y = num(p?.y); const w = num(p?.w); const d = num(p?.d)
    if (!FORMAS.includes(forma) || ![x, y, w, d].every(Number.isFinite) || w <= 0 || d <= 0) { skipped++; continue }
    const seats = Math.max(0, Math.min(500, Math.round(num(p.seats) || 0)))
    tables.push(clampTable({
      id: tempId(),
      nome: String(p.name || '').trim().slice(0, 60) || forma,
      forma,
      x: Math.round(x * scale), y: Math.round(y * scale),
      largura: Math.max(10, Math.round(w * scale)), altura: Math.max(10, Math.round(d * scale)),
      rotacao: 0, capacidade: seats, cor: '', sector_id: null, ativo: true,
    }, layout))
  }
  return { tables, skipped }
}

/** Shrink a photo to at most `max` px on its long side (JPEG), so the upload stays small. */
export function shrinkPhoto(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * s)
      c.height = Math.round(img.height * s)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')) }
    img.src = url
  })
}
