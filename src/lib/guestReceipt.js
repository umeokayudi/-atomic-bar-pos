/** Guest 領収書 from POS till — never a JBM invoice / RY- number. */

import { includedTaxBreakdown } from './consumptionTax.js'
import { orderCastFromObs, orderDetailsFromObs } from './orderMeta.js'

function yen(n) {
  return `¥${Math.round(+n || 0).toLocaleString('ja-JP')}`
}

export function buildPosReceiptNumero(sale, date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const id = String(sale?.id || 'POS').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase() || 'POS'
  return `POS-${y}${m}${d}-${id}`
}

export function buildGuestReceiptHtml({
  barNome = '',
  sale = {},
  items = [],
  guestNome = '',
  castNome = '',
  spaceNome = '',
  payMethod = 'Cash',
  cash = null,
} = {}) {
  const total = Math.round(+sale.total || items.reduce((a, it) => a + (+it.preco_unitario || +it.preco || 0) * (it.qtd || 1), 0))
  const tax = includedTaxBreakdown(total)
  const numero = buildPosReceiptNumero(sale)
  const when = String(sale.data || sale.criado_em || '').slice(0, 10)
  const cast = castNome || orderCastFromObs(sale.obs)
  const details = orderDetailsFromObs(sale.obs)
  const lines = (items || []).map(it => {
    const qty = it.qtd || 1
    const unit = +it.preco_unitario || +it.preco || 0
    const name = String(it.nome || '').replace(/</g, '')
    return `<tr><td>${name}</td><td style="text-align:center">${qty}</td><td style="text-align:right">${yen(unit * qty)}</td></tr>`
  }).join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${numero}</title>
<style>
body{font-family:serif;padding:36px;max-width:640px;margin:0 auto;color:#111}
h1{text-align:center;font-size:24px;letter-spacing:10px;margin-bottom:8px}
.sub{text-align:center;font-size:11px;color:#666;margin-bottom:20px}
.row{display:flex;justify-content:space-between;margin-bottom:12px;font-size:13px}
.client{font-size:17px;font-weight:bold;border-bottom:2px solid #111;padding-bottom:6px;margin-bottom:14px}
.box{border:2px solid #111;padding:12px;text-align:center;margin:16px 0;font-size:20px;font-weight:bold}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}
td,th{padding:6px 4px;border-bottom:1px solid #eee;text-align:left}
.footer{text-align:center;margin-top:24px;font-size:12px;color:#666;line-height:1.6}
@page{size:A4;margin:15mm}
@media print{body{padding:0}}
</style></head><body>
<h1>領　収　書</h1>
<div class="sub">ゲスト用（バー売上）— JBM請求ではありません</div>
<div class="row"><span>No. <strong>${numero}</strong></span>
<span>発行日：<strong>${when || '—'}</strong></span></div>
<div class="client">${(guestNome || 'ゲスト').replace(/</g, '')}　様</div>
<div style="font-size:13px;line-height:1.7;margin-bottom:12px">
  <div><strong>店舗：</strong>${(barNome || '—').replace(/</g, '')}</div>
  ${cast ? `<div><strong>CAST：</strong>${String(cast).replace(/</g, '')}</div>` : ''}
  ${spaceNome ? `<div><strong>席：</strong>${String(spaceNome).replace(/</g, '')}</div>` : ''}
  <div><strong>支払方法：</strong>${String(payMethod || sale.metodo_pagamento || 'Cash').replace(/</g, '')}</div>
  ${cash?.restMethod ? `<div><strong>現金：</strong>${yen(cash.tendered)}　<strong>${String(cash.restMethod).replace(/</g, '')}：</strong>${yen(cash.rest)}（記録のみ）</div>` : ''}
  ${cash && !cash.exact && !cash.restMethod ? `<div><strong>預かり：</strong>${yen(cash.tendered)}　<strong>お釣り：</strong>${yen(cash.change)}</div>` : ''}
  ${cash?.exact ? `<div><strong>預かり：</strong>${yen(cash.tendered)}（ちょうど）</div>` : ''}
  ${!cash && payMethod && !/cash|現金/i.test(payMethod) ? `<div><strong>記録のみ：</strong>端末・PayPay連携なし</div>` : ''}
  ${details ? `<div><strong>備考：</strong>${String(details).replace(/</g, '')}</div>` : ''}
</div>
<table>
<thead><tr><th>品名</th><th style="text-align:center">数量</th><th style="text-align:right">金額</th></tr></thead>
<tbody>${lines || '<tr><td colspan="3">—</td></tr>'}</tbody>
</table>
<div class="box">合計金額　${yen(tax.total)}　（税込）</div>
<table>
<tr><td>小計（税抜）</td><td style="text-align:right">${yen(tax.net)}</td></tr>
<tr><td>消費税（10%）</td><td style="text-align:right">${yen(tax.tax)}</td></tr>
<tr><td><strong>合計</strong></td><td style="text-align:right"><strong>${yen(tax.total)}</strong></td></tr>
</table>
<div class="footer">上記の金額を正に領収いたしました。<br>この領収書はバーレジ（POS）の売上です。仕入先の請求書・領収書ではありません。</div>
</body></html>`
}

export function printGuestReceipt(opts) {
  const html = buildGuestReceiptHtml(opts)
  const printWin = window.open('', '_blank', 'width=800,height=900')
  if (!printWin) return { ok: false, error: 'popup' }
  printWin.document.write(html)
  printWin.document.close()
  printWin.focus()
  setTimeout(() => printWin.print(), 400)
  return { ok: true }
}
