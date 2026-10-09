/** HQ AI prompt. Never imports React. Four books stay separate. */

export function buildHqChatSystem(snapshot, lang = 'en', strategy = '') {
  const s = snapshot || {}
  const yen = n => `¥${Math.round(n || 0).toLocaleString('ja-JP')}`
  const books = s.books || {}
  const facts = `
HQ SNAPSHOT (${s.mes || 'this month'}) synced ${s.syncedAt || 'now'}.
FOUR SEPARATE BOOKS — never add them into one number:
- POS till (guest money at the counter): ${yen(books.pos?.amount)}
- JBM bill (supplier invoices / deliveries): ${yen(books.jbm?.amount)}
- Staff wages (hours × rate + 25% late-night 22:00–05:00 JST): ${yen(books.staff?.amount)} · ${s.hoursTotal || 0}h
- Rent / lease for this bar: ${yen(books.rent?.amount)} (${s.rent?.note || 'no note'})

Source health:
- JBM postgres: ${s.sources?.jbm?.ok ? 'ok' : 'fail'} · ${s.sources?.jbm?.vendas || 0} supplier sales, ${s.sources?.jbm?.pedidos || 0} orders, ${s.sources?.jbm?.faturas || 0} invoices
- POS live-store: ${s.sources?.pos?.ok ? 'ok' : 'fail'} · ${s.sources?.pos?.sales || 0} till tickets (${s.sources?.pos?.via || '?'})
- Time clock: ${s.sources?.clock?.ok ? 'ok' : 'fail'} · ${s.sources?.clock?.punches || 0} punches
- Rent book: ${s.sources?.rent?.ok ? 'ok' : 'fail'}
- Inventory (estoque_regras + movimentos, not public.estoque): ${s.sources?.inventory?.ok ? 'ok' : 'fail'} · ${s.jbm?.estoqueBaixo?.length || 0} under minimum

Staff payroll this month: ${JSON.stringify(s.payroll || [])}
JBM open invoices: ${s.jbm?.faturasPendentes || 0} (${yen(s.jbm?.totalPendente)}) — ${s.jbm?.faturasAtraso || 0} overdue
Recent supplier orders: ${JSON.stringify(s.jbm?.pedidosRecentes || [])}
Low stock: ${JSON.stringify(s.jbm?.estoqueBaixo || [])}

Scope: this bar HQ — POS till, JBM supplier, local staff hours, rent.
Do not mix the four books. Do not invent numbers. Do not talk about other bars or the holding.

STRATEGY FROM WHAT ALREADY WORKED (nights, hours, cast) AND UPCOMING BIRTHDAYS.
The manager decides events. Suggest, do not pretend an event is already confirmed.
${strategy || 'No strategy digest yet.'}`

  if (lang === 'ja') {
    return `あなたはバー「${s.bar?.nome || 'client'}」の本部AIです。
日本語で短く答えてください。下のデータを根拠にし、4つの帳簿を足し合わせないでください。
これまでの売上（曜日、時間、キャスト）から戦略を提案し、誕生日イベントは店長が決める前提で出してください。
${facts}`
  }

  return `You are the bar HQ AI for "${s.bar?.nome || 'client'}".
If the user writes in Portuguese, answer in Portuguese. Otherwise answer in clear English. Use the data below. Never add the four books together.
When asked for strategy, use only what already sold (weekdays, hours, cast) and upcoming birthdays. The manager decides the event. Do not invent a result.
${facts}`
}

function yen(n) {
  return `¥${Math.round(n || 0).toLocaleString('ja-JP')}`
}

/** Offline HQ answers until an external AI API key is plugged into /api/chat. Never mixes books. */
export function localHqAnswer(question, snapshot, lang = 'en', strategy = '') {
  const s = snapshot || {}
  const books = s.books || {}
  const q = String(question || '').toLowerCase()
  const ja = lang === 'ja'

  const four = ja
    ? `4つの帳簿（合算しない） ${s.mes || ''}：\n- POSレジ ${yen(books.pos?.amount)}\n- JBM請求 ${yen(books.jbm?.amount)}\n- スタッフ給与 ${yen(books.staff?.amount)}（${s.hoursTotal || 0}h）\n- 家賃 ${yen(books.rent?.amount)}${s.rent?.note ? `（${s.rent.note}）` : ''}`
    : `Four books for ${s.mes || 'this month'} — not added together:\n- POS till ${yen(books.pos?.amount)}\n- JBM bill ${yen(books.jbm?.amount)}\n- Staff wages ${yen(books.staff?.amount)} (${s.hoursTotal || 0}h)\n- Rent ${yen(books.rent?.amount)}${s.rent?.note ? ` (${s.rent.note})` : ''}`

  if (/rent|aluguel|家賃|lease/.test(q)) {
    return ja
      ? `家賃帳簿のみ：${yen(books.rent?.amount)}（${s.rent?.note || 'メモなし'}）。POSでもJBMでも給与でもありません。`
      : `Rent book only: ${yen(books.rent?.amount)} (${s.rent?.note || 'no note'}). Not POS, not JBM, not wages.`
  }
  if (/hour|wage|pay|salár|給与|時間|ponto/.test(q)) {
    const rows = (s.payroll || []).map(r => `${r.nome}: ${Number(r.hours || 0).toFixed(2)}h → ${yen(r.pay)}`).join('\n')
    return ja
      ? `勤務時間帳簿のみ：合計 ${s.hoursTotal || 0}h → ${yen(books.staff?.amount)}。\n${rows || '打刻なし'}`
      : `Hours book only: ${s.hoursTotal || 0}h → ${yen(books.staff?.amount)}.\n${rows || 'No punches this month.'}`
  }
  if (/jbm|invoice|fatura|請求|supplier|fornecedor|order|pedido/.test(q)) {
    const gap = s.jbm?.gap
    const extra = gap?.kind === 'orders-other-date'
      ? (ja
        ? `\n注文 ${gap.orderCount} 件は今月保存（${yen(gap.orderAmount)}）だが伝票日付は別月。`
        : `\n${gap.orderCount} orders were saved this month (${yen(gap.orderAmount)}) but supplier notes are dated another month.`)
      : ''
    return ja
      ? `JBM請求帳簿：今月の伝票 ${yen(books.jbm?.amount)}。未払 ${yen(s.jbm?.totalPendente)}（延滞 ${s.jbm?.faturasAtraso || 0}）。POSレジではない。${extra}`
      : `JBM bill book: ${yen(books.jbm?.amount)} in notes dated ${s.mes || 'this month'}. Open invoices ${yen(s.jbm?.totalPendente)} (${s.jbm?.faturasAtraso || 0} overdue). Not the till.${extra}`
  }
  if (/pos|till|caixa|レジ|counter/.test(q)) {
    return ja
      ? `POSレジ：今月 ${yen(books.pos?.amount)}（${s.pos?.salesCount || 0}件）。JBM請求ではありません。`
      : `POS till: ${yen(books.pos?.amount)} this month (${s.pos?.salesCount || 0} tickets). Not the JBM bill.`
  }
  if (/estrat|estratég|anivers|evento|festa|birthday|strategy|戦略|誕生日/.test(q)) {
    const body = strategy || (ja
      ? 'まだ戦略データがありません。イベントページでキャスト、パートナー、客の誕生日を見てください。'
      : 'No strategy digest yet. Open Events and use cast, partner and guest birthdays.')
    if (ja) return `これまでの実績に基づく戦略：\n${body}\nイベントは店長が決めます。`
    return `Strategy from what already worked:\n${body}\nThe manager decides whether the event happens.`
  }
  if (/stock|estoque|在庫|restock/.test(q)) {
    const low = (s.jbm?.estoqueBaixo || []).map(e => `${e.nome} ${e.qtd}/${e.minimo}`).join(', ')
    return ja
      ? `在庫（JBM仕入側）：${low || '下限割れなし'}。`
      : `Inventory (JBM supply side): ${low || 'nothing under minimum'}.`
  }
  return four
}
