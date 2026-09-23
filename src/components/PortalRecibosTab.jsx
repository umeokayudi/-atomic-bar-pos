import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fmtYen, fmtDate, Spinner, Empty, SectionTitle } from './utils'
import { useI18n } from '../lib/i18n'
import {
  filterJbmDrinksFaturas,
  faturaEmissao,
  faturaPeriodoFim,
} from '../lib/barPortal'
import { receiptableItems } from '../lib/portalRecibos'
import {
  buildPaymentRyoshushoHtml,
  buildRyoshushoNumero,
  printRyoshushoHtml,
  savePaymentRyoshusho,
} from '../lib/ryoshushoPrint'

export default function PortalRecibosTab({ bar }) {
  const { t } = useI18n()
  const [faturas, setFaturas] = useState([])
  const [pagamentos, setPagamentos] = useState([])
  const [loading, setLoading] = useState(true)
  const [emittingReceipt, setEmittingReceipt] = useState(null)
  const [ryoSeq, setRyoSeq] = useState(1)
  const [receiptDates, setReceiptDates] = useState({})

  useEffect(() => { load() }, [bar])

  async function load() {
    setLoading(true)
    const [fR, pR] = await Promise.all([
      supabase.from('faturas').select('*').eq('bar_id', bar.id).order('data_vencimento', { ascending: false }),
      supabase.from('fatura_pagamentos').select('*, faturas!inner(bar_id)').eq('faturas.bar_id', bar.id).order('criado_em', { ascending: false }),
    ])
    const jbmFaturas = filterJbmDrinksFaturas(fR.data || [])
    setFaturas(jbmFaturas)
    setPagamentos(pR.data || [])
    const { count } = await supabase.from('ryoshusho').select('id', { count: 'exact', head: true }).eq('bar_id', bar.id)
    setRyoSeq((count || 0) + 1)
    setLoading(false)
  }

  function getReceiptDate(item) {
    const custom = receiptDates[item.key]
    if (custom) return custom.slice(0, 10)
    return (item.data || new Date().toISOString().slice(0, 10)).slice(0, 10)
  }

  async function emitPaymentReceipt(item) {
    if (!item?.valor) return
    setEmittingReceipt(item.key)
    try {
      const numero = buildRyoshushoNumero(ryoSeq)
      const dataEmissao = getReceiptDate(item)
      const html = buildPaymentRyoshushoHtml({
        numero,
        dataEmissao,
        barNome: bar.nome,
        valor: item.valor,
        metodo: item.metodo,
        notas: item.notas,
        periodoInicio: faturaEmissao(item.fatura),
        periodoFim: faturaPeriodoFim(item.fatura),
      })
      printRyoshushoHtml(html)
      await savePaymentRyoshusho(supabase, {
        barId: bar.id,
        numero,
        dataEmissao,
        valor: item.valor,
        metodo: item.metodo,
        periodoInicio: faturaEmissao(item.fatura),
        periodoFim: faturaPeriodoFim(item.fatura),
      })
      setRyoSeq(s => s + 1)
    } finally {
      setEmittingReceipt(null)
    }
  }

  const recibos = receiptableItems(faturas, pagamentos)

  if (loading) return <Spinner text={t('portal.loadingReceipts')} />

  return (
    <div className="fade-in portal-page" style={{ maxWidth: 860 }}>
      <SectionTitle sub={t('portal.receiptsSub')}>
        {t('portal.receiptsTitle')}
      </SectionTitle>

      {recibos.length === 0 ? (
        <Empty text={t('portal.noReceipts')} icon="🧾" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {recibos.map(item => (
            <div
              key={item.key}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                padding: '14px 16px',
                background: 'var(--bg2)',
                border: '1px solid var(--border)',
                borderRadius: 14,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--navy)' }}>{fmtYen(item.valor)}</div>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
                  {t('portal.paidOn', { date: fmtDate(item.data), method: item.metodo })}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                  {t('portal.invoicePeriod', { from: fmtDate(faturaEmissao(item.fatura)), to: fmtDate(faturaPeriodoFim(item.fatura)) })}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10, color: 'var(--text2)' }}>
                  {t('portal.receiptDate')}
                  <input
                    type="date"
                    value={getReceiptDate(item)}
                    onChange={e => setReceiptDates(d => ({ ...d, [item.key]: e.target.value }))}
                    style={{ padding: '7px 10px', borderRadius: 8, fontSize: 12, border: '1px solid var(--border)' }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => emitPaymentReceipt(item)}
                  disabled={emittingReceipt === item.key}
                  style={{
                    padding: '9px 18px',
                    fontSize: 12,
                    borderRadius: 10,
                    border: 'none',
                    background: 'var(--gold)',
                    color: 'var(--navy)',
                    cursor: 'pointer',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    alignSelf: 'flex-end',
                  }}
                >
                  {emittingReceipt === item.key ? t('portal.generating') : t('portal.issueReceipt')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
