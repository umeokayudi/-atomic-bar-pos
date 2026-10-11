/** Till tile look: a photo when the item has one, otherwise an icon and colour per category. */

const RULES = [
  [/beer|ビール|biru/i, '🍺', '#f5b82e', '#e08a00', 'catBeer'],
  [/champ|sparkl|シャンパン/i, '🍾', '#e9d8a6', '#b99a4a', 'catWine'],
  [/wine|ワイン/i, '🍷', '#b0324a', '#6e1430', 'catWine'],
  [/shochu|sake|焼酎|酎ハイ|hai\b/i, '🍶', '#7fb7d9', '#3c7fae', 'catSake'],
  [/tequila|mezcal|テキーラ/i, '🌵', '#8dc26f', '#3f8a3a', 'catSpirit'],
  [/vodka|ウォッカ/i, '🍸', '#9fc5f8', '#4a78c2', 'catCocktail'],
  [/gin|ジン/i, '🍸', '#86d3c4', '#2f8f80', 'catCocktail'],
  [/rum|ラム/i, '🍹', '#f29b6b', '#c4512b', 'catCocktail'],
  [/whisk|bourbon|scotch|ウイスキー|hennessy|cognac|brandy/i, '🥃', '#d9a35f', '#8a5420', 'catSpirit'],
  [/liqueur|リキュール|cocktail|カクテル/i, '🍹', '#e58fb8', '#a8467a', 'catCocktail'],
  [/shot|ショット/i, '🔥', '#ff8f6b', '#c73a2a', 'catShot'],
  [/soft|juice|cola|soda|water|tea|coffee|ソフト|ジュース|お茶/i, '🥤', '#7fd1e6', '#2f8fae', 'catSoft'],
  [/food|snack|フード/i, '🍟', '#f2c46d', '#c48a1f', 'catFood'],
]

const FALLBACK = ['🍸', '#9fb8ad', '#4d6b61', 'catCocktail']

// Tile colour = what is in the glass: the base spirit on the left half, the mixer on the right half.
// Same base -> same left colour everywhere; same mixer -> same right colour.
const BASES = [
  ['champagne', /champ|moet|veuve|mimosa|sparkl|シャンパン/i, '#c9a94e'],
  ['wine', /wine|ワイン/i, '#7a1a35'],
  ['beer', /beer|asahi|budweiser|corona|guinness|heineken|smirnoff ice|ビール/i, '#e0a000'],
  ['cognac', /hennessy|cognac|brandy/i, '#6b3a1a'],
  ['whisky', /whisk|jack|bourbon|scotch|godfather|ウイスキー/i, '#b06d1f'],
  ['vodka', /vodka|grey ?goose|lemon drop|ウォッカ/i, '#3f6fc4'],
  ['gin', /\bgin\b|gimlet|hendrick|tom collins|ジン/i, '#2a9184'],
  ['rum', /\brum\b|cuba libre|daiquiri|ラム/i, '#c4512b'],
  ['tequila', /tequila|margarita|paloma|mezcal|テキーラ/i, '#4b9a3c'],
  ['shochu', /shochu|uron hai|焼酎|酎ハイ/i, '#5b9cc8'],
  ['liqueur', /baileys|kahlua|malibu|jager|jäger|fireball|sambuca|b-52|blowjob|liqueur|リキュール/i, '#a8467a'],
]
const MIXERS = [
  ['redbull', /red ?bull|jager ?bomb/i, '#1f3f8f'],
  ['cola', /cola|cuba libre/i, '#3b2418'],
  ['gingerbeer', /ginger beer|buck/i, '#c98a2e'],
  ['gingerale', /ginger ale/i, '#e7c35a'],
  ['tonic', /tonic/i, '#d9ece4'],
  ['cranberry', /cranberry/i, '#b0213a'],
  ['orange', /orange|mimosa|sunrise/i, '#f28c13'],
  ['apple', /apple/i, '#a8c23a'],
  ['grapefruit', /grapefruit|paloma/i, '#ef7d76'],
  ['mango', /mango/i, '#f5b335'],
  ['pineapple', /pineapple/i, '#f2cf4a'],
  ['peach', /peach/i, '#f7a07a'],
  ['jasmine', /jasmine/i, '#c8b46a'],
  ['uron', /uron|oolong/i, '#8a5a2b'],
  ['tomato', /tomato/i, '#d2402c'],
  ['sour', /sour|gimlet|margarita|daiquiri|lemon|lime/i, '#9ccc4f'],
  ['soda', /soda|collins|water|mineral/i, '#a9d6e5'],
]

const find = (list, text) => list.find(([, re]) => re.test(text)) || null

/** { base, mixer } names and colours read from the drink's name and category. */
export function drinkParts(item = {}) {
  const nome = String(item.nome || '')
  const cat = String(item.categoria || '')
  const [head, ...rest] = nome.split(/\s*&\s*/)
  const soft = /soft|ソフト/i.test(cat)
  const base = soft ? null : (find(BASES, head) || find(BASES, nome) || find(BASES, cat))
  const mixerText = rest.length ? rest.join(' ') : nome
  let mixer = find(MIXERS, mixerText)
  // "Straight / On the Rocks" and shots have no mixer; the base name itself is not a mixer.
  if (!rest.length && base && mixer && !/cuba libre|mimosa|sunrise|paloma|collins|buck|gimlet|margarita|daiquiri|sour|lemon drop|bomb|peach|tonic/i.test(nome)) mixer = null
  return {
    base: base ? { id: base[0], color: base[2] } : null,
    mixer: mixer ? { id: mixer[0], color: mixer[2] } : null,
  }
}

export function itemVisual(item = {}) {
  const text = `${item.categoria || ''} ${item.nome || ''}`
  const hit = RULES.find(([re]) => re.test(item.categoria || '')) || RULES.find(([re]) => re.test(text))
  const [, emoji, from, to, icon] = hit || [null, ...FALLBACK]
  const { base, mixer } = drinkParts(item)
  let background = `linear-gradient(135deg, ${from}, ${to})`
  if (base && mixer) background = `linear-gradient(90deg, ${base.color} 0 50%, ${mixer.color} 50% 100%)`
  else if (base) background = base.color
  else if (mixer) background = mixer.color
  return {
    image: item.imagem_url || item.image_url || null,
    emoji,
    icon,
    background,
    base: base?.id || null,
    mixer: mixer?.id || null,
  }
}

/** Ids sold most, from sale lines ({drink_menu_id, produto_id, qtd}). */
export function rankTopSellers(lines = [], limit = 12) {
  const count = new Map()
  for (const line of lines || []) {
    const key = line.drink_menu_id ? `d-${line.drink_menu_id}` : line.produto_id ? `p-${line.produto_id}` : ''
    if (!key) continue
    count.set(key, (count.get(key) || 0) + Math.max(0, +line.qtd || 0))
  }
  return [...count.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => key)
}

/** With no sales yet: the first item of each category, so the start screen still has one of everything. */
export function starterPicks(catalog = [], limit = 12) {
  const seen = new Set()
  const picks = []
  for (const item of catalog) {
    if (seen.has(item.categoria)) continue
    seen.add(item.categoria)
    picks.push(item.key)
    if (picks.length >= limit) break
  }
  return picks
}
