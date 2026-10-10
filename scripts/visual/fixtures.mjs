/** Fictional data for the visual checks only. Nothing here is read by the app in production. */
export const BAR = { id: '00000000-0000-4000-8000-0000000000b1', nome: 'Bar Demo', cor: '#3F7F67', criado_em: '2026-01-01T00:00:00Z' }
export const BAR2 = { id: '00000000-0000-4000-8000-0000000000b2', nome: 'Lounge Demo', cor: '#C9A15B', criado_em: '2026-01-01T00:00:00Z' }
export const ADMIN = { id: '00000000-0000-4000-8000-00000000a001', nome: 'Admin Demo', role: 'admin', bar_id: null, email: 'admin@example.com' }
export const MANAGER = { id: '00000000-0000-4000-8000-00000000a002', nome: 'Gerente Demo', role: 'gerente', bar_id: BAR.id, email: 'gerente@example.com' }

const day = n => { const d = new Date(Date.now() - n * 86400000); return d.toISOString().slice(0, 10) }
const ago = m => new Date(Date.now() - m * 60000).toISOString()

const drinks = [
  ['Highball', 'Whisky', 800, 'HB'], ['Gin Tonic', 'Gin', 900, '12'], ['Mojito', 'Cocktail', 1000, '13'], ['Draft beer', 'Beer', 700, 'BR'],
  ['Lemon sour', 'Shochu', 650, '21'], ['Red wine', 'Wine', 900, 'RW'], ['Cola', 'Soft drink', 400, ''], ['Oolong tea', 'Soft drink', 400, ''],
  ['Margarita', 'Tequila', 1100, '31'], ['Moscow mule', 'Vodka', 950, '32'], ['Cuba libre', 'Rum', 900, '33'], ['Nachos', 'Food', 800, 'F1'],
].map(([nome, categoria, preco_venda, codigo], i) => ({ id: `00000000-0000-4000-8000-0000000d00${String(i).padStart(2, '0')}`, bar_id: BAR.id, nome, categoria, preco_venda, codigo, preco_desconto: Math.round(preco_venda / 2) }))

const tables = [
  ['1', 'square', 60, 60, 100, 100, 4], ['2', 'square', 220, 60, 100, 100, 4], ['3', 'round', 380, 60, 100, 100, 4],
  ['VIP 1', 'rect', 60, 240, 160, 100, 6], ['VIP 2', 'rect', 260, 240, 160, 100, 6], ['VIP 3', 'rect', 460, 240, 160, 100, 6],
  ['Counter', 'bar', 560, 60, 260, 70, 8],
].map(([nome, forma, x, y, largura, altura, capacidade], i) => ({
  id: `00000000-0000-4000-8000-0000000f00${i}`, bar_id: BAR.id, layout_id: 'L1', nome, forma, x, y, largura, altura, rotacao: 0, capacidade,
  cor: null, sector_id: i >= 3 && i < 6 ? 'S1' : null, estado_manual: i === 2 ? 'reserved' : null, ativo: true,
}))

const tab = (id, nome, table, minutes, items, status = 'open', pays = []) => ({
  id, bar_id: BAR.id, table_id: table, mesa_nome: tables.find(t => t.id === table)?.nome || null, nome, status, pessoas: 3,
  service_pct: 10, aberta_em: ago(minutes), versao: 3, responsavel_nome: 'Gerente Demo',
  _items: items.map(([d, q, mAgo], j) => ({ id: `${id}-i${j}`, comanda_id: id, bar_id: BAR.id, drink_menu_id: drinks[d].id, nome: drinks[d].nome, categoria: drinks[d].categoria, qtd: q, preco_unitario: drinks[d].preco_venda, preco_lista: drinks[d].preco_venda, tipo_preco: 'regular', desconto_valor: 0, criado_em: ago(mAgo) })),
  _pays: pays.map((v, j) => ({ id: `${id}-p${j}`, comanda_id: id, bar_id: BAR.id, valor: v, metodo: 'Cash', criado_em: ago(5) })),
})
const tabs = [
  tab('00000000-0000-4000-8000-0000000c0001', 'Mesa 1', tables[0].id, 50, [[0, 2, 40], [1, 1, 20]]),
  tab('00000000-0000-4000-8000-0000000c0002', 'Tanaka', tables[3].id, 95, [[2, 3, 90], [5, 1, 80]]),
  tab('00000000-0000-4000-8000-0000000c0003', 'Mesa 2', tables[1].id, 6, []),
  tab('00000000-0000-4000-8000-0000000c0004', 'Suzuki', tables[4].id, 120, [[8, 2, 100], [11, 1, 100]], 'awaiting_payment', [1500]),
  tab('00000000-0000-4000-8000-0000000c0005', 'Walk-in', null, 15, [[3, 2, 10]]),
]

const vendas = []
for (let i = 0; i < 160; i++) vendas.push({ id: `v${i}`, bar_id: i % 3 ? BAR.id : BAR2.id, total: 20000 + (i % 7) * 4500, data: day(i % 170), obs: 'JBM supply', criado_em: day(i % 170) })

export const TABLES = {
  bars: [BAR, BAR2],
  perfis: [ADMIN, MANAGER],
  drink_menu: drinks,
  floor_layouts: [{ id: 'L1', bar_id: BAR.id, nome: 'Salão', ativo: true, largura: 900, altura: 420, versao: 3, criado_em: '2026-10-01T00:00:00Z' }],
  floor_sectors: [{ id: 'S1', bar_id: BAR.id, layout_id: 'L1', nome: 'VIP', cor: '#C9A15B', ordem: 0 }],
  floor_tables: tables,
  pos_comandas: tabs.map(({ _items, _pays, ...t }) => t),
  pos_comanda_itens: tabs.flatMap(t => t._items),
  pos_comanda_pagamentos: tabs.flatMap(t => t._pays),
  pos_comanda_eventos: [{ id: 'e1', comanda_id: tabs[0].id, bar_id: BAR.id, tipo: 'opened', dados: {}, criado_em: ago(50) }, { id: 'e2', comanda_id: tabs[0].id, bar_id: BAR.id, tipo: 'items_added', dados: {}, criado_em: ago(40) }],
  vendas,
  faturas: [
    { id: 'f1', bar_id: BAR.id, total: 180000, pago: 60000, status: 'parcial', vencimento: day(10), data_emissao: day(40) },
    { id: 'f2', bar_id: BAR2.id, total: 95000, pago: 0, status: 'pendente', vencimento: day(-12), data_emissao: day(5) },
  ],
  pedidos: [{ id: 'p1', bar_id: BAR.id, status: 'entregue', data_pedido: day(3) }, { id: 'p2', bar_id: BAR2.id, status: 'entregue', data_pedido: day(30) }],
  marketing_campaigns: [
    { id: 'm1', bar_id: BAR.id, nome: 'Happy hour weekdays', canal: 'in_store', status: 'running', inicio: day(14), fim: day(-14), oferta: '2nd highball half price 18–20h', objetivo: '+15% weekday sales', orcamento: 30000 },
    { id: 'm2', bar_id: null, nome: 'Autumn gin menu', canal: 'instagram', status: 'scheduled', inicio: day(-7), fim: day(-30), produtos: 'Gin Tonic, Gin Fizz', orcamento: 50000 },
  ],
  consulting_plans: [{ id: 'cp1', bar_id: BAR.id, titulo: 'Lift weekday nights', diagnostico: 'Weekends are full; Monday–Wednesday sell 40% less. Stock outs on gin twice last month.', status: 'active', baseline: { revenue: 410000, salesCount: 18, receivable: 150000, overdue: 0 }, baseline_em: day(45), criado_em: day(45) }],
  consulting_tasks: [
    { id: 'ct1', plan_id: 'cp1', bar_id: BAR.id, titulo: 'Weekday happy hour', responsavel: 'Gerente Demo', prazo: day(-5), prioridade: 'high', status: 'doing', kpi: 'weekday sales' },
    { id: 'ct2', plan_id: 'cp1', bar_id: BAR.id, titulo: 'Gin minimum stock 6', responsavel: 'JBM', prazo: day(2), prioridade: 'medium', status: 'todo', kpi: 'stock outs' },
    { id: 'ct3', plan_id: 'cp1', bar_id: BAR.id, titulo: 'New menu photos', responsavel: 'Gerente Demo', prazo: day(20), prioridade: 'low', status: 'done' },
  ],
  pos_settings: [{ bar_id: BAR.id, service_pct: 10, room_min: 10000, set_minutes: 60, set_price: 0 }],
}

/** /api/bar-staff GET: team, registry (suppliers, rent, power...), goals, events, day sheets. */
export const BAR_STAFF = {
  staff: [
    { id: 'st1', nome: 'Aiko Tanaka', role: 'bar_staff', cargo: 'Bartender', salario_hora: 1600, drink_back: true, comissao_pct: 10, dias: ['Fri', 'Sat'], idiomas: ['JA', 'EN'], aniversario: '1998-10-20', source: 'house' },
    { id: 'st2', nome: 'Ken Mori', role: 'bar_staff', cargo: 'Floor', salario_hora: 1300, drink_back: false, comissao_pct: 0, dias: ['Thu', 'Fri', 'Sat'], idiomas: ['JA'], source: 'house' },
    { id: 'st3', nome: 'Lucia Sato', role: 'bar_staff', cargo: 'Cast', salario_mes: 220000, drink_back: true, comissao_pct: 15, dias: ['Wed', 'Fri'], idiomas: ['PT', 'JA'], source: 'house' },
  ],
  people: [],
  registry: [
    { id: 'rg1', kind: 'aluguel', nome: 'Shibuya Realty', cargo: 'Mr. Ito', contato: '03-1234-5678', amount: 180000, vence_dia: 25 },
    { id: 'rg2', kind: 'energia', nome: 'Tokyo Power', amount: 32000, vence_dia: 10 },
    { id: 'rg3', kind: 'fornecedor', nome: 'Sake Wholesale', detalhe: 'Sake, shochu', contato: '03-9999-0000' },
    { id: 'rg4', kind: 'fixo', nome: 'Internet', amount: 6000, vence_dia: 5 },
  ],
  goals: { noite: 150000, hora: 20000, semana: 800000, turno: 90000, lucro: 400000, mes: 3200000, abre: 20, fecha: 5, corta: 0, pessoas: [] },
  events: [],
  sheets: [],
  bar: { id: BAR.id, nome: BAR.nome, geofence_m: 150, tabletPaired: false },
}

export const PUNCHES = [
  { id: 'pu1', bar_id: BAR.id, staff_id: 'st1', tipo: 'in', criado_em: ago(240), punched_at: ago(240) },
  { id: 'pu2', bar_id: BAR.id, staff_id: 'st2', tipo: 'in', criado_em: ago(200), punched_at: ago(200) },
  { id: 'pu3', bar_id: BAR.id, staff_id: 'st2', tipo: 'out', criado_em: ago(20), punched_at: ago(20) },
]
