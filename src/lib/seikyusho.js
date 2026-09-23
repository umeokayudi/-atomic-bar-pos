async function readApiJson(res) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(text?.slice(0, 200) || res.statusText || 'Resposta inválida do servidor')
  }
}

async function seikyushoFetch(payload) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module: 'seikyusho', ...payload }),
  })
  const data = await readApiJson(res)
  if (!res.ok || data.error) throw new Error(data.error || res.statusText)
  return data
}

/** Margem JBM: preço ao bar − custo fornecedor */
export function calcLucroPreview(extracted, catalog = []) {
  const custo = (extracted.itens_custo || []).reduce((a, it) => a + (it.qtd || 1) * (it.custo_unitario || 0), 0)
    || (+extracted.total || 0)

  let venda = 0
  if (extracted.entrega_direta !== false) {
    venda = extracted.receita_estimada || 0
  } else {
    venda = (extracted.itens_venda || []).reduce((a, it) => a + (it.qtd || 1) * (it.preco_unitario || 0), 0)
      + (extracted.entregas || []).reduce((a, e) =>
        a + (e.itens || []).reduce((b, it) => b + (it.qtd || 1) * (it.preco_unitario || 0), 0), 0)
  }

  if (!venda && catalog.length && extracted.itens_custo?.length) {
    for (const it of extracted.itens_custo) {
      const prod = catalog.find(p =>
        p.nome?.toLowerCase().includes((it.nome || '').toLowerCase().split(' ')[0])
        || (it.nome || '').toLowerCase().includes(p.nome?.toLowerCase())
      )
      venda += (it.qtd || 1) * (prod?.preco_venda || 0)
    }
  }

  return { custo, venda, lucro: venda - custo, margemPct: venda > 0 ? Math.round(((venda - custo) / venda) * 100) : 0 }
}

export async function analyzeSeikyusho({ image, contextText, comentario, previous }) {
  const data = await seikyushoFetch({
    action: 'analyze',
    image,
    context: contextText,
    comentario,
    previous,
  })
  return { extracted: data.extracted, plano: data.plano }
}

export async function registerSeikyusho({ extracted, comentario, confirmed = true }) {
  return seikyushoFetch({
    action: 'register',
    extracted,
    comentario,
    confirmed,
  })
}
