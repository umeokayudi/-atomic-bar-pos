const DEFAULT_EMITENTE = {
  nome: 'JBM Drinks',
  registro: 'T1234567890123',
  endereco: '',
  tel: '',
}

export function calcTaxFromZeikomi(totalZeikomi) {
  const total = Math.round(+totalZeikomi || 0)
  const subtotal = Math.round(total / 1.1)
  return { total, subtotal, tax: total - subtotal }
}

export function buildRyoshushoNumero(seq = 1, date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `RY-${y}${m}-${String(seq).padStart(3, '0')}`
}

/** 領収書 simplificado — pagamento confirmado de fatura */
export function buildPaymentRyoshushoHtml({
  numero,
  dataEmissao,
  barNome,
  valor,
  metodo,
  notas,
  periodoInicio,
  periodoFim,
  descricao,
  emitente = DEFAULT_EMITENTE,
}) {
  const { total, subtotal, tax } = calcTaxFromZeikomi(valor)
  const emissaoFmt = dataEmissao
    ? new Date(dataEmissao + 'T12:00').toLocaleDateString('ja-JP')
    : '—'
  const periodoLabel = periodoInicio && periodoFim
    ? `${periodoInicio} ～ ${periodoFim}`
    : ''
  const purpose = descricao || (periodoLabel
    ? `飲料代金のお支払い（${periodoLabel}）`
    : '飲料代金のお支払い')
  const metodoLabel = metodo || '—'

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${numero}</title>
<style>
body{font-family:serif;padding:40px;max-width:680px;margin:0 auto;color:#111}
h1{text-align:center;font-size:26px;letter-spacing:10px;margin-bottom:24px}
.row{display:flex;justify-content:space-between;margin-bottom:16px;font-size:13px}
.client{font-size:18px;font-weight:bold;border-bottom:2px solid #111;padding-bottom:6px;margin-bottom:14px}
.box{border:2px solid #111;padding:14px;text-align:center;margin:16px 0;font-size:20px;font-weight:bold}
.meta{font-size:13px;line-height:1.7;margin-bottom:16px;color:#333}
.totals{width:100%;border-collapse:collapse;margin:16px 0}
.totals td{font-size:13px;padding:6px 8px;border-bottom:1px solid #eee}
.footer{text-align:center;margin-top:28px;font-size:12px;color:#666;line-height:1.6}
@page{size:A4;margin:15mm}
@media print{body{padding:0}}
</style></head><body>
<h1>領　収　書</h1>
<div class="row"><span>No. <strong>${numero}</strong></span>
<span>発行日：<strong>${emissaoFmt}</strong></span></div>
<div class="client">${barNome || '—'}　御中</div>
<div class="meta">
  <div><strong>但し書き：</strong>${purpose}</div>
  <div><strong>支払日：</strong>${emissaoFmt}</div>
  <div><strong>支払方法：</strong>${metodoLabel}</div>
  ${notas ? `<div><strong>備考：</strong>${notas}</div>` : ''}
</div>
<div class="box">合計金額　¥ ${total.toLocaleString('ja-JP')}　（税込）</div>
<table class="totals">
<tr><td>小計（税抜）</td><td style="text-align:right">¥${subtotal.toLocaleString('ja-JP')}</td></tr>
<tr><td>消費税（10%）</td><td style="text-align:right">¥${tax.toLocaleString('ja-JP')}</td></tr>
<tr><td><strong>合計</strong></td><td style="text-align:right"><strong>¥${total.toLocaleString('ja-JP')}</strong></td></tr>
</table>
<div class="footer">上記の金額を正に領収いたしました。<br><br>
${emitente.nome}${emitente.endereco ? `　${emitente.endereco}` : ''}${emitente.tel ? `　TEL:${emitente.tel}` : ''}
${emitente.registro ? `<br>登録番号 ${emitente.registro}` : ''}
</div></body></html>`
}

export function printRyoshushoHtml(html) {
  const printWin = window.open('', '_blank', 'width=800,height=900')
  if (!printWin) {
    alert('Permita pop-ups para imprimir ou salvar o recibo em PDF.')
    return false
  }
  printWin.document.write(html)
  printWin.document.close()
  printWin.focus()
  setTimeout(() => printWin.print(), 500)
  return true
}

/** Persiste 領収書 no Supabase (ignora erro se RLS bloquear). */
export async function savePaymentRyoshusho(supabase, {
  barId,
  numero,
  dataEmissao,
  valor,
  metodo,
  periodoInicio,
  periodoFim,
  emitente = DEFAULT_EMITENTE,
}) {
  const { total, subtotal, tax } = calcTaxFromZeikomi(valor)
  try {
    const { data, error } = await supabase.from('ryoshusho').insert({
      numero,
      bar_id: barId,
      data_emissao: dataEmissao,
      periodo_inicio: periodoInicio || dataEmissao,
      periodo_fim: periodoFim || dataEmissao,
      subtotal,
      consumo_tax: tax,
      total,
      emitente_nome: emitente.nome,
      emitente_endereco: emitente.endereco,
      emitente_tel: emitente.tel,
      emitente_registro: emitente.registro,
      itens: [{ nome: `Pagamento — ${metodo || '—'}`, qtd: 1, preco: total }],
    }).select('id').single()
    if (error) return { ok: false, error: error.message }
    return { ok: true, id: data?.id }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}
