/**
 * AI actions: the model only PROPOSES. Each proposal is validated here against
 * fresh data, shown to the user, and written only after they press Confirm.
 * Writes use the logged-in user's own Supabase session (never the service role),
 * and every action re-checks role and bar scope because table RLS is wide open.
 */

export const HQ_ROLES = ['admin', 'jbm']
export const BAR_MANAGER_ROLES = ['cliente', 'gerente']

const PAY_METHODS = ['Dinheiro', 'Transfer', 'Cartão', 'PayPay', 'Manual']

export const ACTIONS = {
  create_pedido: {
    scopes: ['hq', 'bar'],
    doc: 'Create a drinks order from JBM for a bar. params: { bar (bar name, HQ only), itens: [{ produto (product name), qtd }], obs?, data_entrega_prevista? (YYYY-MM-DD) }',
  },
  set_pedido_status: {
    scopes: ['hq'],
    doc: 'Confirm or cancel an open order. params: { pedido_ref (ref from ORDERS), status: "confirmado" | "cancelado" }. Delivery (entregue) is NOT allowed here.',
  },
  create_compra: {
    scopes: ['hq'],
    doc: `Record a JBM purchase from a supplier. params: { fornecedor (name), total (yen), data? (YYYY-MM-DD), pagamento? (${PAY_METHODS.join('|')}), pago? (true if already paid), obs?, itens?: [{ nome, qtd, custo_unitario }] }`,
  },
  mark_compra_paid: {
    scopes: ['hq'],
    doc: 'Mark an unpaid purchase as paid. params: { compra_ref (ref from UNPAID PURCHASES), data? (YYYY-MM-DD) }',
  },
  register_fatura_payment: {
    scopes: ['hq', 'bar'],
    doc: 'Record a payment on a bar invoice. params: { fatura_ref (ref from OPEN INVOICES), valor? (yen, default = remaining), metodo?, data? (YYYY-MM-DD), notas? }. For a bar account the payment is sent to JBM for confirmation.',
  },
  stock_move: {
    scopes: ['hq', 'bar'],
    doc: 'Record a stock movement for a bar. params: { bar (bar name, HQ only), produto (product name), qtd, tipo: "entrada" | "saida", obs? }',
  },
}

export function scopeForRole(perfil) {
  const role = perfil?.role
  if (HQ_ROLES.includes(role)) return 'hq'
  if (BAR_MANAGER_ROLES.includes(role) && perfil?.bar_id) return 'bar'
  return null
}

export function tokyoToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(now)
}

const yen = n => `¥${Math.round(+n || 0).toLocaleString('ja-JP')}`
const ref = id => String(id || '').slice(0, 8)
const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s))
}

function fail(type, error) {
  return { ok: false, type, error }
}

/** Find a row by full id, short ref (id prefix) or name. Returns { row } or { error }. */
export function pick(rows, value, { label, nameKey = 'nome' } = {}) {
  const v = String(value ?? '').trim()
  if (!v) return { error: `${label}: missing` }
  if (UUID.test(v)) {
    const row = rows.find(r => r.id === v)
    return row ? { row } : { error: `${label} "${v}" not found or not allowed` }
  }
  const byRef = rows.filter(r => String(r.id).startsWith(v.toLowerCase()))
  if (v.length >= 6 && byRef.length === 1) return { row: byRef[0] }
  const n = norm(v)
  const exact = rows.filter(r => norm(r[nameKey]) === n)
  if (exact.length === 1) return { row: exact[0] }
  const partial = rows.filter(r => norm(r[nameKey]).includes(n))
  if (partial.length === 1) return { row: partial[0] }
  if (exact.length > 1 || partial.length > 1) {
    const names = (exact.length ? exact : partial).slice(0, 5).map(r => r[nameKey]).join(', ')
    return { error: `${label} "${v}" is ambiguous: ${names}` }
  }
  return { error: `${label} "${v}" not found` }
}

function resolveBar(ctx, value) {
  if (ctx.scope === 'bar') {
    const bar = ctx.bars.find(b => b.id === ctx.barId)
    return bar ? { row: bar } : { error: 'Your bar was not found' }
  }
  return pick(ctx.bars, value, { label: 'Bar' })
}

function invoiceTotal(f) {
  return +f.total || +f.valor || 0
}

/**
 * Validate one proposed action against ctx and return a preview the user confirms.
 * Output params use ids only, so the same call on execute re-checks everything.
 * ctx: { scope, barId, userId, today, bars, produtos, fornecedores, faturas, pedidos, compras }
 */
export function normalizeAction(ctx, action) {
  const type = action?.type
  const p = action?.params || {}
  const def = ACTIONS[type]
  if (!def) return fail(type, `Unknown action "${type}"`)
  if (!def.scopes.includes(ctx.scope)) return fail(type, 'Your account cannot do this action')

  if (type === 'create_pedido') {
    const bar = resolveBar(ctx, p.bar_id || p.bar)
    if (bar.error) return fail(type, bar.error)
    const raw = Array.isArray(p.itens) ? p.itens : []
    if (!raw.length) return fail(type, 'No products in the order')
    const itens = []
    for (const it of raw) {
      const prod = pick(ctx.produtos, it.produto_id || it.produto, { label: 'Product' })
      if (prod.error) return fail(type, prod.error)
      const qtd = Math.round(+it.qtd)
      if (!(qtd > 0) || qtd > 999) return fail(type, `Invalid quantity for ${prod.row.nome}`)
      itens.push({ produto_id: prod.row.id, nome: prod.row.nome, qtd, preco_unitario: +prod.row.preco_venda || 0 })
    }
    if (p.data_entrega_prevista && !isDate(p.data_entrega_prevista)) return fail(type, 'Invalid delivery date')
    const total = itens.reduce((a, it) => a + it.qtd * it.preco_unitario, 0)
    return {
      ok: true,
      type,
      title: `New order for ${bar.row.nome}`,
      lines: [
        ...itens.map(it => `${it.qtd} × ${it.nome} (${yen(it.preco_unitario)})`),
        `Estimated total ${yen(total)}`,
        ...(p.data_entrega_prevista ? [`Delivery ${p.data_entrega_prevista}`] : []),
        ...(p.obs ? [`Note: ${String(p.obs).slice(0, 200)}`] : []),
      ],
      params: {
        bar_id: bar.row.id,
        itens: itens.map(({ produto_id, qtd }) => ({ produto_id, qtd })),
        obs: p.obs ? String(p.obs).slice(0, 500) : null,
        data_entrega_prevista: p.data_entrega_prevista || null,
      },
      write: { bar_nome: bar.row.nome, itens, total },
    }
  }

  if (type === 'set_pedido_status') {
    const status = String(p.status || '')
    if (!['confirmado', 'cancelado'].includes(status)) return fail(type, 'Status must be confirmado or cancelado')
    const ped = pick(ctx.pedidos, p.pedido_id || p.pedido_ref, { label: 'Order' })
    if (ped.error) return fail(type, ped.error)
    if (ped.row.status !== 'pendente' && !(ped.row.status === 'confirmado' && status === 'cancelado')) {
      return fail(type, `Order is already "${ped.row.status}"`)
    }
    return {
      ok: true,
      type,
      title: `${status === 'confirmado' ? 'Confirm' : 'Cancel'} order ${ref(ped.row.id)}`,
      lines: [
        `${ped.row.bar_nome || 'Bar'} · ${ped.row.data_pedido || ''} · ${yen(ped.row.total_estimado)}`,
        `${ped.row.status} → ${status}`,
      ],
      params: { pedido_id: ped.row.id, status },
      write: { pedido: ped.row },
    }
  }

  if (type === 'create_compra') {
    const forn = pick(ctx.fornecedores, p.fornecedor, { label: 'Supplier' })
    const fornecedor = forn.row?.nome || String(p.fornecedor || '').trim()
    if (!fornecedor) return fail(type, 'Supplier is missing')
    const total = Math.round(+p.total)
    if (!(total > 0)) return fail(type, 'Total must be more than zero')
    const data = p.data || ctx.today
    if (!isDate(data)) return fail(type, 'Invalid date')
    const pagamento = PAY_METHODS.includes(p.pagamento) ? p.pagamento : (forn.row?.pagamento || 'Dinheiro')
    const pago = p.pago === true || p.pago === 'true'
    const itens = (Array.isArray(p.itens) ? p.itens : [])
      .filter(it => it?.nome)
      .slice(0, 50)
      .map(it => ({ nome: String(it.nome).slice(0, 120), qtd: +it.qtd || 1, custo_unitario: +it.custo_unitario || 0 }))
    return {
      ok: true,
      type,
      title: `Record purchase from ${fornecedor}`,
      lines: [
        `${data} · ${yen(total)} · ${pagamento}`,
        pago ? 'Already paid' : 'Not paid yet',
        ...(forn.error ? [`New supplier name (not in the list)`] : []),
        ...itens.map(it => `${it.qtd} × ${it.nome} (${yen(it.custo_unitario)})`),
        ...(p.obs ? [`Note: ${String(p.obs).slice(0, 200)}`] : []),
      ],
      params: { fornecedor, total, data, pagamento, pago, obs: p.obs ? String(p.obs).slice(0, 500) : '', itens },
    }
  }

  if (type === 'mark_compra_paid') {
    const c = pick(ctx.compras, p.compra_id || p.compra_ref, { label: 'Purchase', nameKey: 'fornecedor' })
    if (c.error) return fail(type, c.error)
    if (c.row.status_pagamento === 'pago') return fail(type, 'Purchase is already paid')
    const data = p.data || ctx.today
    if (!isDate(data)) return fail(type, 'Invalid date')
    return {
      ok: true,
      type,
      title: `Mark purchase from ${c.row.fornecedor} as paid`,
      lines: [`${c.row.data} · ${yen(c.row.total_real || c.row.total_pago)}`, `Paid on ${data}`],
      params: { compra_id: c.row.id, data },
    }
  }

  if (type === 'register_fatura_payment') {
    const f = pick(ctx.faturas, p.fatura_id || p.fatura_ref, { label: 'Invoice', nameKey: 'bar_nome' })
    if (f.error) return fail(type, f.error)
    const total = invoiceTotal(f.row)
    const remaining = Math.max(0, total - (+f.row.pago || 0))
    if (remaining <= 0) return fail(type, 'Invoice is already paid')
    const valor = p.valor == null || p.valor === '' ? remaining : Math.round(+p.valor)
    if (!(valor > 0)) return fail(type, 'Amount must be more than zero')
    if (valor > remaining) return fail(type, `Amount ${yen(valor)} is more than what is left (${yen(remaining)})`)
    const data = p.data || ctx.today
    if (!isDate(data)) return fail(type, 'Invalid date')
    const metodo = String(p.metodo || 'Transfer').slice(0, 40)
    const confirmed = ctx.scope === 'hq'
    return {
      ok: true,
      type,
      title: `Payment on invoice ${ref(f.row.id)} (${f.row.bar_nome || 'bar'})`,
      lines: [
        `${yen(valor)} by ${metodo} on ${data}`,
        `Invoice ${yen(total)}, already paid ${yen(f.row.pago)}, left after this ${yen(remaining - valor)}`,
        confirmed ? 'Counts as paid now' : 'Sent to JBM to confirm',
      ],
      params: { fatura_id: f.row.id, valor, metodo, data, notas: p.notas ? String(p.notas).slice(0, 300) : null },
      write: { fatura: f.row, confirmed },
    }
  }

  if (type === 'stock_move') {
    const bar = resolveBar(ctx, p.bar_id || p.bar)
    if (bar.error) return fail(type, bar.error)
    const prod = pick(ctx.produtos, p.produto_id || p.produto, { label: 'Product' })
    if (prod.error) return fail(type, prod.error)
    const tipo = p.tipo === 'entrada' ? 'entrada' : p.tipo === 'saida' ? 'saida' : null
    if (!tipo) return fail(type, 'tipo must be entrada or saida')
    const qtd = Math.round(+p.qtd)
    if (!(qtd > 0) || qtd > 9999) return fail(type, 'Invalid quantity')
    return {
      ok: true,
      type,
      title: `Stock ${tipo === 'entrada' ? 'in' : 'out'}: ${prod.row.nome}`,
      lines: [`${bar.row.nome} · ${tipo === 'entrada' ? '+' : '−'}${qtd}`, ...(p.obs ? [`Note: ${String(p.obs).slice(0, 200)}`] : [])],
      params: { bar_id: bar.row.id, produto_id: prod.row.id, qtd, tipo, obs: p.obs ? String(p.obs).slice(0, 300) : 'AI' },
    }
  }

  return fail(type, 'Not supported')
}

/** Load what the model may reference, through the user's own session. */
export async function loadActionContext(db, { scope, barId, userId }) {
  const barFilter = q => (scope === 'bar' ? q.eq('bar_id', barId) : q)
  const [bars, produtos, fornecedores, faturas, pedidos, compras] = await Promise.all([
    scope === 'bar'
      ? db.from('bars').select('id,nome').eq('id', barId)
      : db.from('bars').select('id,nome').order('nome').limit(100),
    db.from('produtos').select('id,nome,categoria,preco_venda,ativo').eq('ativo', true).order('nome').limit(400),
    scope === 'hq'
      ? db.from('fornecedores').select('id,nome,pagamento').order('nome').limit(200)
      : Promise.resolve({ data: [] }),
    barFilter(db.from('faturas').select('id,bar_id,valor,total,pago,status,data_vencimento,vencimento,periodo_inicio,periodo_fim,bars(nome)'))
      .neq('status', 'pago').order('criado_em', { ascending: false }).limit(60),
    barFilter(db.from('pedidos').select('id,bar_id,status,data_pedido,total_estimado,criado_por,bars(nome)'))
      .in('status', ['pendente', 'confirmado']).order('criado_em', { ascending: false }).limit(60),
    scope === 'hq'
      ? db.from('compras').select('id,data,fornecedor,total_real,total_pago,status_pagamento')
        .or('status_pagamento.is.null,status_pagamento.neq.pago').order('data', { ascending: false }).limit(60)
      : Promise.resolve({ data: [] }),
  ])
  const withBar = rows => (rows || []).map(r => ({ ...r, bar_nome: r.bars?.nome || null }))
  return {
    scope,
    barId,
    userId,
    today: tokyoToday(),
    bars: bars.data || [],
    produtos: produtos.data || [],
    fornecedores: fornecedores.data || [],
    faturas: withBar(faturas.data),
    pedidos: withBar(pedidos.data),
    compras: compras.data || [],
  }
}

/** Compact text the model sees. Refs are id prefixes; the server resolves them. */
export function contextForPrompt(ctx) {
  const lines = []
  if (ctx.scope === 'hq') lines.push(`BARS: ${ctx.bars.map(b => b.nome).join(' | ') || 'none'}`)
  else lines.push(`YOUR BAR: ${ctx.bars[0]?.nome || '?'}`)
  lines.push(`PRODUCTS (name · category · JBM price): ${ctx.produtos.map(p => `${p.nome} · ${p.categoria || ''} · ${yen(p.preco_venda)}`).join(' | ')}`)
  if (ctx.scope === 'hq') lines.push(`SUPPLIERS: ${ctx.fornecedores.map(f => f.nome).join(' | ') || 'none'}`)
  lines.push(`OPEN INVOICES (ref · bar · total · paid · due): ${ctx.faturas.map(f => `${ref(f.id)} · ${f.bar_nome || ''} · ${yen(invoiceTotal(f))} · ${yen(f.pago)} · ${f.data_vencimento || f.vencimento || ''}`).join(' | ') || 'none'}`)
  lines.push(`OPEN ORDERS (ref · bar · status · date · total): ${ctx.pedidos.map(o => `${ref(o.id)} · ${o.bar_nome || ''} · ${o.status} · ${o.data_pedido || ''} · ${yen(o.total_estimado)}`).join(' | ') || 'none'}`)
  if (ctx.scope === 'hq') {
    lines.push(`UNPAID PURCHASES (ref · date · supplier · total): ${ctx.compras.map(c => `${ref(c.id)} · ${c.data} · ${c.fornecedor} · ${yen(c.total_real || c.total_pago)}`).join(' | ') || 'none'}`)
  }
  return lines.join('\n')
}

export function agentSystemPrompt(ctx, extra = '') {
  const allowed = Object.entries(ACTIONS).filter(([, d]) => d.scopes.includes(ctx.scope))
  return `You are the JBM management assistant (${ctx.scope === 'hq' ? 'JBM HQ / drinks supply' : 'bar manager'}). Today is ${ctx.today} (Tokyo).
Reply in the user's language (Portuguese, Japanese or English), short and clear.
You can answer questions AND propose actions that write to the database. You never write yourself: every action you propose is shown to the user, who must press Confirm.
Only propose an action when the user asks for something to be done. Use names and refs exactly as they appear in the data below. If something needed is missing or unclear, ask instead of guessing.
Never invent amounts, refs or products.

ACTIONS YOU MAY PROPOSE:
${allowed.map(([k, d]) => `- ${k}: ${d.doc}`).join('\n')}

Answer ONLY with JSON: {"reply": "text for the user", "actions": [{"type": "...", "params": {...}}]}. Use "actions": [] when nothing should be written.

DATA:
${contextForPrompt(ctx)}
${extra ? `\nSCREEN CONTEXT:\n${extra}` : ''}`
}

export function parseAgentJson(text) {
  const cleaned = String(text || '').replace(/```json|```/g, '').trim()
  try {
    const out = JSON.parse(cleaned)
    return {
      reply: String(out.reply || ''),
      actions: Array.isArray(out.actions) ? out.actions.slice(0, 5) : [],
    }
  } catch {
    return { reply: cleaned, actions: [] }
  }
}

function asError(e) {
  return e instanceof Error ? e : new Error(e?.message || e?.details || 'Database error')
}

async function notifyAdmins(db, titulo, mensagem, tipo = 'pedido_novo') {
  const { data: admins } = await db.from('perfis').select('id').eq('role', 'admin')
  if (!admins?.length) return
  await db.from('notificacoes').insert(admins.map(a => ({ user_id: a.id, tipo, titulo, mensagem })))
}

/** Run an action already normalized against fresh ctx. Throws on DB error. */
export async function executeAction(db, ctx, n) {
  const p = n.params

  if (n.type === 'create_pedido') {
    const rpc = await db.rpc('submit_bar_order', {
      p_bar_id: p.bar_id,
      p_need: p.data_entrega_prevista ? `${p.data_entrega_prevista}T09:00:00Z` : null,
      p_obs: p.obs ? `${p.obs} · AI` : 'AI',
      p_items: p.itens,
      p_idempotency_key: n.key || null,
    })
    let pedidoId = null
    const rpcMissing = rpc.error && (rpc.error.code === 'PGRST202' || rpc.error.code === '42883')
    if (rpc.error && !rpcMissing) throw asError(rpc.error)
    if (!rpc.error) {
      pedidoId = typeof rpc.data === 'string' ? rpc.data : rpc.data?.order_id || rpc.data?.pedido_id || rpc.data?.id || null
    } else {
      // Older databases have no submit_bar_order: same inserts the screens use.
      const { data: pedido, error } = await db.from('pedidos').insert({
        bar_id: p.bar_id,
        criado_por: ctx.userId,
        status: 'pendente',
        data_pedido: ctx.today,
        data_entrega_prevista: p.data_entrega_prevista,
        obs: p.obs ? `${p.obs} · AI` : 'AI',
        total_estimado: Math.round(n.write.total),
      }).select('id').single()
      if (error) throw asError(error)
      pedidoId = pedido.id
      const { error: itemsErr } = await db.from('pedidos_itens').insert(n.write.itens.map(it => ({
        pedido_id: pedido.id, produto_id: it.produto_id, qtd: it.qtd, preco_unitario: it.preco_unitario,
      })))
      if (itemsErr) {
        await db.from('pedidos').delete().eq('id', pedido.id)
        throw asError(itemsErr)
      }
    }
    if (ctx.scope === 'bar') {
      await notifyAdmins(db, `New order from ${n.write.bar_nome}`, `${n.write.itens.length} product(s) · ${yen(n.write.total)} · AI`).catch(() => {})
    }
    return { id: pedidoId, message: `Order created for ${n.write.bar_nome}` }
  }

  if (n.type === 'set_pedido_status') {
    const { error } = await db.from('pedidos').update({ status: p.status }).eq('id', p.pedido_id)
    if (error) throw asError(error)
    const owner = n.write.pedido.criado_por
    if (owner) {
      await db.from('notificacoes').insert({
        user_id: owner,
        tipo: p.status === 'confirmado' ? 'pedido_confirmado' : 'pedido_cancelado',
        titulo: p.status === 'confirmado' ? 'Order confirmed' : 'Order cancelled',
        mensagem: `${ref(p.pedido_id)} · ${yen(n.write.pedido.total_estimado)}`,
      }).then(() => {}, () => {})
    }
    return { id: p.pedido_id, message: `Order ${p.status}` }
  }

  if (n.type === 'create_compra') {
    const { data: compra, error } = await db.from('compras').insert({
      data: p.data,
      data_compra: p.data,
      fornecedor: p.fornecedor,
      pagamento: p.pagamento,
      subtotal: p.total,
      desconto_pontos: 0,
      total_pago: p.total,
      total_real: p.total,
      pontos_ganhos: 0,
      status_pagamento: p.pago ? 'pago' : 'pendente',
      data_pagamento: p.pago ? p.data : null,
      obs: p.obs ? `${p.obs} · AI` : 'AI',
      criado_por: ctx.userId,
    }).select('id').single()
    if (error) throw asError(error)
    if (p.itens.length) {
      const { error: itemsErr } = await db.from('compras_itens').insert(p.itens.map(it => ({ compra_id: compra.id, ...it })))
      if (itemsErr) throw asError(itemsErr)
    }
    return { id: compra.id, message: `Purchase recorded (${yen(p.total)})` }
  }

  if (n.type === 'mark_compra_paid') {
    const { error } = await db.from('compras').update({ status_pagamento: 'pago', data_pagamento: p.data }).eq('id', p.compra_id)
    if (error) throw asError(error)
    return { id: p.compra_id, message: 'Purchase marked paid' }
  }

  if (n.type === 'register_fatura_payment') {
    const confirmed = n.write.confirmed
    const { error } = await db.from('fatura_pagamentos').insert({
      fatura_id: p.fatura_id,
      valor: p.valor,
      metodo: p.metodo,
      data: p.data,
      notas: p.notas ? `${p.notas} · AI` : 'AI',
      confirmado: confirmed,
      confirmado_em: confirmed ? new Date().toISOString() : null,
      submetido_por: ctx.userId,
    })
    if (error) throw asError(error)
    if (confirmed) {
      const newPago = (+n.write.fatura.pago || 0) + p.valor
      const { error: upd } = await db.from('faturas')
        .update({ pago: newPago, status: newPago >= invoiceTotal(n.write.fatura) ? 'pago' : 'parcial' })
        .eq('id', p.fatura_id)
      if (upd) throw asError(upd)
    } else {
      await notifyAdmins(db, `Payment sent by ${n.write.fatura.bar_nome || 'bar'}`, `${yen(p.valor)} · ${p.metodo} · AI`, 'pagamento_enviado').catch(() => {})
    }
    return { id: p.fatura_id, message: confirmed ? 'Payment recorded' : 'Payment sent to JBM to confirm' }
  }

  if (n.type === 'stock_move') {
    const { error } = await db.from('estoque_movimentos').insert({
      produto_id: p.produto_id, bar_id: p.bar_id, tipo: p.tipo, qtd: p.qtd, obs: `${p.obs} · AI`, criado_por: ctx.userId,
    })
    if (error) throw asError(error)
    return { message: 'Stock movement recorded' }
  }

  throw new Error('Not supported')
}

/** Public part of a proposal (what the browser shows and sends back). */
export function publicProposal(n, key) {
  if (!n.ok) return { ok: false, type: n.type, error: n.error }
  return { ok: true, key, type: n.type, title: n.title, lines: n.lines, params: n.params }
}
