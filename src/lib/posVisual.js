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

export function itemVisual(item = {}) {
  const text = `${item.categoria || ''} ${item.nome || ''}`
  const hit = RULES.find(([re]) => re.test(item.categoria || '')) || RULES.find(([re]) => re.test(text))
  const [, emoji, from, to, icon] = hit || [null, ...FALLBACK]
  return {
    image: item.imagem_url || item.image_url || null,
    emoji,
    icon,
    background: `linear-gradient(135deg, ${from}, ${to})`,
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
