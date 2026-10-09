import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { fmtYen } from './utils'
import { fromZeikomi, parseSupplierPriceNotas, formatPriceChange } from '../lib/consumptionTax'
import { useI18n } from '../lib/i18n'

/** Carrega preços de fornecedor (税込) com metadados de variação */
export function useSupplierPrices(fornecedorId) {
  const [precos, setPrecos] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!fornecedorId) { setPrecos([]); return }
    let cancelled = false
    setLoading(true)
    supabase
      .from('fornecedor_precos')
      .select('*, produtos(id,nome,categoria,custo)')
      .eq('fornecedor_id', fornecedorId)
      .then(({ data }) => {
        if (!cancelled) setPrecos(data || [])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [fornecedorId])

  const byProductId = useMemo(() => {
    const m = new Map()
    for (const p of precos) {
      if (p.produto_id) m.set(p.produto_id, p)
    }
    return m
  }, [precos])

  const byProductName = useMemo(() => {
    const m = new Map()
    for (const p of precos) {
      const name = p.produtos?.nome
      if (name) m.set(name.toLowerCase(), p)
    }
    return m
  }, [precos])

  return { precos, loading, byProductId, byProductName }
}

/** Painel de conferência ao registrar compra */
export function SupplierPricePanel({ fornecedorId, fornecedorNome, onApplyPrice }) {
  const { t } = useI18n()
  const { precos, loading } = useSupplierPrices(fornecedorId)

  if (!fornecedorId) return null
  if (loading) return <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>{t('supplierPriceCheck.loading', { supplier: fornecedorNome })}</div>
  if (!precos.length) return null

  const sorted = [...precos].sort((a, b) => (a.produtos?.nome || '').localeCompare(b.produtos?.nome || ''))

  return (
    <div style={{
      marginBottom: 14, padding: '12px 14px', borderRadius: 12,
      background: 'linear-gradient(135deg,#f8fafc,#eef2ff)', border: '1px solid #c7d2fe',
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy)', marginBottom: 8 }}>
        {t('supplierPriceCheck.registeredPrices', { supplier: fornecedorNome })} <span style={{ fontWeight: 500, color: 'var(--text2)' }}>{t('supplierPriceCheck.taxIncluded')}</span>
      </div>
      <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {sorted.map(p => {
          const meta = parseSupplierPriceNotas(p.notas)
          const zeibetsu = meta.zeibetsu ?? fromZeikomi(p.preco)
          const variacao = meta.variacao_pct
          return (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
              background: 'white', borderRadius: 8, fontSize: 12,
            }}>
              <div style={{ flex: 1, fontWeight: 600 }}>{p.produtos?.nome}</div>
              <div style={{ color: 'var(--text2)', fontSize: 11 }}>税抜 {fmtYen(zeibetsu)}</div>
              <div style={{ fontWeight: 800, color: 'var(--navy)' }}>{fmtYen(p.preco)}</div>
              {variacao != null && variacao !== 0 && (
                <div style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6,
                  background: variacao > 0 ? '#fef2f2' : '#f0fdf4',
                  color: variacao > 0 ? 'var(--red)' : 'var(--green)',
                }}>
                  {formatPriceChange(variacao)}
                </div>
              )}
              {onApplyPrice && (
                <button type="button" onClick={() => onApplyPrice(p)}
                  style={{ padding: '3px 8px', fontSize: 10, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg3)', cursor: 'pointer' }}>
                  {t('supplierPriceCheck.use')}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Badge de custo fornecedor no checklist de pedido */
export function SupplierCostHint({ produtoId, produtoNome, byProductId, byProductName }) {
  const sp = (produtoId && byProductId?.get(produtoId))
    || (produtoNome && byProductName?.get(produtoNome.toLowerCase()))
  if (!sp) return null

  const meta = parseSupplierPriceNotas(sp.notas)
  const zeibetsu = meta.zeibetsu ?? fromZeikomi(sp.preco)
  const variacao = meta.variacao_pct

  return (
    <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 2 }}>
      LM: 税抜 {fmtYen(zeibetsu)} → <strong style={{ color: 'var(--navy)' }}>{fmtYen(sp.preco)}</strong>
      {variacao != null && variacao !== 0 && (
        <span style={{ marginLeft: 6, fontWeight: 700, color: variacao > 0 ? 'var(--red)' : 'var(--green)' }}>
          {formatPriceChange(variacao)} jul
        </span>
      )}
    </div>
  )
}
