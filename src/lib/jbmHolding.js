/**
 * JBM Holding — perfil de capital e custo de oportunidade entre negócios.
 * Sincroniza via localStorage + API /api/holding (Supabase storage privado).
 */

export const HOLDING_STORAGE_KEY = 'jbm_holding_profile'

export const DEFAULT_HOLDING = {
  nome: 'JBM Holding',
  custoOportunidadeBasePct: 28,
  capitalDisponivel: 0,
  regraCapital:
    'Se o capital estiver apertado, priorizar contratação/expansão dos outros negócios antes de comprar bebidas à vista.',
  negocios: [
    {
      id: 'jbm-drinks',
      nome: 'JBM Drinks',
      tipo: 'bebidas',
      custoOportunidadePct: 22,
      prioridade: 'media',
      notas: 'Fornecedor Atomic, estoque, entregas',
    },
    {
      id: 'outro-negocio',
      nome: 'Outro negócio',
      tipo: 'servicos',
      custoOportunidadePct: 45,
      prioridade: 'alta',
      notas: 'Ex.: contratar pessoas, expandir operação',
    },
  ],
}

export function resolveOpportunityCostPct(holding, { capitalTight = false } = {}) {
  const h = holding || DEFAULT_HOLDING
  const base = h.custoOportunidadeBasePct || DEFAULT_HOLDING.custoOportunidadeBasePct

  const outros = (h.negocios || []).filter(n => n.tipo !== 'bebidas')
  const alta = outros.filter(n => n.prioridade === 'alta')
  const pool = alta.length ? alta : outros

  const maxOutro = pool.reduce((m, n) => Math.max(m, +n.custoOportunidadePct || 0), 0)
  const effective = Math.max(base, maxOutro)

  if (capitalTight) return Math.round(effective * 1.15)
  return effective
}

/** Custo de oportunidade ao pagar à vista: dinheiro preso até cobrar do bar. */
export function opportunityCostPayNow(amount, daysLocked, oppPct) {
  if (!amount || !daysLocked || !oppPct) return 0
  return Math.round(amount * (oppPct / 100) * (daysLocked / 365))
}

export function describeForsakenAlternatives(holding, amount) {
  const h = holding || DEFAULT_HOLDING
  const outros = (h.negocios || []).filter(n => n.tipo !== 'bebidas' && n.prioridade === 'alta')
  if (!outros.length) return []

  return outros.map(n => ({
    negocio: n.nome,
    custoOportunidadePct: n.custoOportunidadePct,
    mensagem: `¥${Math.round(amount).toLocaleString('ja-JP')} à vista em bebidas poderia ir para ${n.nome} (${n.notas || 'expansão'}) — custo de oportunidade ~${n.custoOportunidadePct}%/ano`,
  }))
}

export function loadHoldingLocal() {
  try {
    const raw = localStorage.getItem(HOLDING_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_HOLDING, negocios: DEFAULT_HOLDING.negocios.map(n => ({ ...n })) }
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_HOLDING,
      ...parsed,
      negocios: parsed.negocios?.length ? parsed.negocios : DEFAULT_HOLDING.negocios,
    }
  } catch {
    return { ...DEFAULT_HOLDING, negocios: DEFAULT_HOLDING.negocios.map(n => ({ ...n })) }
  }
}

export function saveHoldingLocal(profile) {
  localStorage.setItem(HOLDING_STORAGE_KEY, JSON.stringify(profile))
}

import { staffFetch } from './apiAuth'

export async function syncHoldingFromCloud() {
  const res = await staffFetch('/api/holding')
  if (!res.ok) return loadHoldingLocal()
  const data = await res.json()
  if (data.profile) {
    saveHoldingLocal(data.profile)
    return data.profile
  }
  return loadHoldingLocal()
}

export async function syncHoldingToCloud(profile) {
  saveHoldingLocal(profile)
  const res = await staffFetch('/api/holding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Falha ao sincronizar JBM Holding')
  }
  return profile
}
