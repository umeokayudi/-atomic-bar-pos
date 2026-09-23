export const ATOMIC_BAR_ID = 'b23a5f97-ad4c-4c2a-baa6-72a0d3ba85b9'

/** Compras pagas diretamente pelo bar — abate na fatura (a receber), não é lucro */
export const BAR_PAID_CREDITS = {
  '2026-07': [
    {
      barId: ATOMIC_BAR_ID,
      fornecedor: 'Liquor Mountain',
      valor: 488350,
      nota: 'Pago pelo bar (Card) — julho/2026',
    },
  ],
}

export function barCreditsForMonth(selMonth, barId = null) {
  const list = BAR_PAID_CREDITS[selMonth] || []
  if (!barId) return list.reduce((a, c) => a + (+c.valor || 0), 0)
  return list
    .filter(c => c.barId === barId)
    .reduce((a, c) => a + (+c.valor || 0), 0)
}

export function barCreditsList(selMonth, barId = null) {
  const list = BAR_PAID_CREDITS[selMonth] || []
  if (!barId) return list
  return list.filter(c => c.barId === barId)
}
