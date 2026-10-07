/** Local AI turn planner. Mutations stay proposals until confirmAiProposal. */

import { localHqAnswer } from './hqChat.js'

const CHANGE = /\b(fecha|fechar|close the register|cash close|sangria|suprimento|desconto|estorna|estorno|pagar|pagamento|cancela|cancelar|apaga|apagar|exclui|excluir|altera|alterar|aplica|aplicar|ajusta|ajustar|muda|mudar|baixa|baixar)\b/i
const CLOCK = /ponto|bater|clock(?:\s|-)?(?:in|out)|打刻/i
const NOTE = /anota|lembrete|nota\b|remember|メモ/i
const NAV = /abre|abrir|mostra|mostrar|ir para|open\b|vai para/i

const SCREENS = [
  ['pos', /pos|venda|till|レジ/],
  ['estoque', /estoque|stock|在庫/],
  ['ponto', /ponto|clock|打刻/],
  ['fechamento', /caixa|fechamento|close|締め/],
  ['pedidos', /pedido|order|compra/],
  ['precos', /pre[cç]o|price|価格/],
]

export function screenFor(text) {
  const q = String(text || '')
  const hit = SCREENS.find(([, pattern]) => pattern.test(q))
  return hit ? hit[0] : null
}

function portuguese(text) {
  return /[áàâãéêíóôõúç]|\b(como|vendas|estoque|caixa|confirme|alterar|fechar|anota)\b/i.test(text)
}

function proposal(kind, text, extra = {}) {
  const pt = portuguese(text)
  return {
    id: `p-${kind}`,
    kind,
    title: extra.title || (pt ? 'Alteração proposta' : 'Proposed change'),
    question: pt ? 'Posso aplicar isso? Confirme para eu alterar. Sem confirmação, nada muda.' : 'May I apply this? Confirm before I change anything. Without confirmation, nothing changes.',
    detail: extra.detail || '',
    screen: extra.screen || null,
    payload: extra.payload || {},
    executed: false,
  }
}

export function planTurn(text, context = {}) {
  const raw = String(text || '').trim()
  const pt = portuguese(raw)
  if (!raw) {
    return {
      reply: pt ? 'Escreva a pergunta.' : 'Type a question.',
      sources: [],
      missing: [],
      proposal: null,
    }
  }

  const connected = context.connected === true && context.snapshot
  const missing = []
  if (!connected) missing.push(pt ? 'Livros operacionais não carregados nesta sessão' : 'Operational books are not loaded in this session')
  if (!context.modelConfigured) missing.push(pt ? 'Modelo externo não configurado' : 'External model is not configured')

  if (CHANGE.test(raw)) {
    const screen = screenFor(raw) || (/pre[cç]o|price/i.test(raw) ? 'precos' : /estoque|stock/i.test(raw) ? 'estoque' : 'fechamento')
    return {
      reply: pt
        ? 'Isso mexe em dinheiro, preço ou estoque. Preparei a alteração, mas ela ainda não foi aplicada.'
        : 'This touches money, price, or stock. I prepared the change. It is not applied yet.',
      sources: connected ? ['HQ snapshot'] : [],
      missing,
      proposal: proposal('ledger', raw, {
        title: pt ? 'Alteração de livro' : 'Ledger change',
        detail: raw,
        screen,
        payload: { request: raw },
      }),
    }
  }

  if (CLOCK.test(raw)) {
    return {
      reply: pt
        ? 'Posso registrar o ponto só depois da sua confirmação.'
        : 'I can record a clock punch only after you confirm.',
      sources: [],
      missing: context.connected ? missing : [...missing, pt ? 'Ponto não ligado no modo local' : 'Time clock is not connected in local mode'],
      proposal: proposal('clock', raw, {
        title: pt ? 'Registro de ponto' : 'Clock punch',
        detail: raw,
        screen: 'ponto',
        payload: { tipo: /out|sa[ií]da/i.test(raw) ? 'out' : 'in', clockConnected: context.connected === true && context.demo !== true },
      }),
    }
  }

  if (NOTE.test(raw)) {
    return {
      reply: pt
        ? 'Posso guardar essa nota nesta conversa. Ela não altera venda, caixa nem estoque.'
        : 'I can keep this note in the conversation. It does not change sales, cash, or stock.',
      sources: [],
      missing,
      proposal: proposal('note', raw, {
        title: pt ? 'Nota operacional' : 'Operational note',
        detail: raw,
        payload: { text: raw },
      }),
    }
  }

  if (NAV.test(raw)) {
    const screen = screenFor(raw)
    if (!screen) {
      return {
        reply: pt ? 'Diga qual tela: caixa, estoque, ponto, preços ou pedidos.' : 'Name the screen: cash, stock, clock, prices, or orders.',
        sources: [],
        missing,
        proposal: null,
      }
    }
    return {
      reply: pt ? 'Posso abrir essa tela depois da confirmação.' : 'I can open that screen after you confirm.',
      sources: [],
      missing,
      proposal: proposal('navigate', raw, {
        title: pt ? 'Abrir tela' : 'Open screen',
        detail: screen,
        screen,
        payload: { screen },
      }),
    }
  }

  if (connected) {
    const answer = localHqAnswer(raw, context.snapshot, pt ? 'en' : (context.lang || 'en'))
    const prefix = pt ? 'Números do snapshot desta sessão. Os quatro livros não foram somados.\n' : ''
    return {
      reply: prefix + answer,
      sources: ['HQ snapshot', 'Four books kept separate'],
      missing: context.modelConfigured ? [] : [pt ? 'Modelo externo não configurado. O número veio do snapshot, não de um modelo.' : 'External model is not configured. Figures come from the snapshot, not from a model.'],
      proposal: null,
    }
  }

  return {
    reply: pt
      ? 'Não li vendas, caixa, estoque nem folha nesta sessão. Não inventei número. O modelo externo não está ligado. Pergunte de novo com o sistema conectado, ou peça uma alteração — ela só acontece depois da confirmação.'
      : 'Sales, cash, stock, and payroll were not read in this session. No figure was invented. The external model is not connected. Ask again when the books are loaded, or request a change — it runs only after confirmation.',
    sources: [],
    missing,
    proposal: null,
  }
}

export function confirmAiProposal(proposal, { confirmed } = {}) {
  if (!proposal) return { executed: false, message: 'Nothing to confirm.' }
  if (!confirmed) {
    return { executed: false, message: 'Cancelado. Nada foi alterado.' }
  }
  if (proposal.kind === 'note') {
    return {
      executed: true,
      message: 'Nota guardada. Venda, caixa e estoque não mudaram.',
      write: { table: 'ai_notes', row: { text: proposal.payload?.text || proposal.detail, created_at: new Date().toISOString(), demo: true } },
    }
  }
  if (proposal.kind === 'navigate') {
    return { executed: true, message: 'Abrindo a tela.', navigate: proposal.screen }
  }
  if (proposal.kind === 'clock') {
    if (!proposal.payload?.clockConnected) {
      return {
        executed: false,
        message: 'Confirmação recebida. O ponto desta sessão não está ligado a um relógio real, então nenhum punch foi gravado.',
        navigate: 'ponto',
      }
    }
    return {
      executed: true,
      message: 'Confirmação recebida. O ponto será enviado agora.',
      clock: proposal.payload,
    }
  }
  return {
    executed: false,
    message: 'Confirmação recebida. Não apliquei a alteração no livro. Abra a tela indicada e conclua lá.',
    navigate: proposal.screen,
  }
}
