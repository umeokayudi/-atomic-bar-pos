import { supabase } from './supabase'
import { fmtYen, fmtDate } from '../components/utils'

const BUCKET = 'cobrancas'

/** Gera texto/HTML de cobrança a partir da compra + itens */
export function buildCobrancaDocument(compra, itens = []) {
  const lines = [
    'COBRANÇA / 請求書',
    '================',
    `Fornecedor: ${compra.fornecedor || '—'}`,
    `Data compra: ${fmtDate(compra.data)}`,
    `Vencimento: ${fmtDate(compra.data_pagamento)}`,
    `Total: ${fmtYen(compra.total_real || compra.total_pago)}`,
    `Status: ${compra.status_pagamento === 'pendente' ? 'PENDENTE' : 'PAGO'}`,
    compra.obs ? `Obs: ${compra.obs}` : '',
    '',
    'Itens:',
    '------',
  ]
  for (const it of itens) {
    const qtd = +it.qtd || 0
    const unit = +it.custo_unitario || 0
    lines.push(`${it.nome || '—'} | qtd ${qtd} | unit ${fmtYen(unit)} | ${fmtYen(qtd * unit)}`)
  }
  lines.push('', `Gerado em ${new Date().toISOString()}`)
  return lines.filter(Boolean).join('\n')
}

/** Download local de texto como arquivo */
export function downloadTextFile(content, filename) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Upload de arquivo (PDF, imagem, etc.) para Supabase Storage */
export async function uploadCobrancaDoc(compraId, file) {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
  const path = `${compraId}/${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type || 'application/octet-stream',
  })
  if (upErr) throw upErr

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path)
  const publicUrl = urlData?.publicUrl
  if (!publicUrl) throw new Error('URL do documento indisponível')

  const { error: dbErr } = await supabase.from('compras').update({ foto_url: publicUrl }).eq('id', compraId)
  if (dbErr) throw dbErr

  return publicUrl
}

/** Salva JSON de cobrança no storage (ex. Le Vin #971) */
export async function saveCobrancaJson(compraId, payload, filename = 'cobranca.json') {
  const path = `${compraId}/${filename}`
  const body = JSON.stringify(payload, null, 2)
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, body, {
    upsert: true,
    contentType: 'application/json',
  })
  if (upErr) throw upErr
  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return urlData?.publicUrl
}
