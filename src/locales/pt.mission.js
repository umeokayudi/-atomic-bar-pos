/** Missão Máxima strings (money labels, reconciliation, language, states, open tabs, offline). */
export default {
  "mm": {
    "money": {
      "faturado": "Faturado",
      "recebido": "Recebido (confirmado)",
      "aReceber": "A receber",
      "pendente": "Pendente de confirmação",
      "faturadoHint": "Total oficial das faturas",
      "recebidoHint": "Só pagamentos confirmados um a um",
      "aReceberHint": "Faturado menos confirmado",
      "pendenteHint": "Informado como pago, ainda sem confirmação. Não conta como recebido",
      "loadError": "Não foi possível carregar os totais. Tente de novo."
    },
    "conc": {
      "nav": "Conciliação",
      "title": "Central de Conciliação",
      "sub": "O que não bate, lado a lado. Nada aqui altera valor: cada item espera a decisão do dono.",
      "empty": "Nada para conciliar. Recibos, faturas e pagamentos batem.",
      "loading": "Conferindo recibos, faturas e pagamentos…",
      "error": "Não foi possível carregar os registros: {error}",
      "retry": "Tentar de novo",
      "diff": "Diferença",
      "decide": "Decisão do dono",
      "decided": "Decisão registrada",
      "decidedBy": "{who} · {when}",
      "noDecision": "Aguardando decisão do dono",
      "decisionTitle": "Decisão do dono",
      "decisionHint": "Escreva o que foi decidido. Fica salvo no histórico com seu nome e a hora. Nenhum valor é alterado.",
      "decisionPlaceholder": "ex.: Vale o RY-202610-002, o RY-202610-003 é reimpressão",
      "save": "Salvar decisão",
      "cancel": "Cancelar",
      "saved": "Decisão salva",
      "saveError": "A decisão não foi salva: {error}",
      "onlyOwner": "Só o dono (admin) registra uma decisão",
      "kind": {
        "receipt_invoice": "Recibo e fatura não batem",
        "receipt_duplicate": "Dois recibos para o mesmo pagamento",
        "paid_no_row": "Marcado como pago sem pagamento confirmado",
        "pending_credit": "Crédito aguardando confirmação",
        "test_item": "Item de teste (fora de listas e totais)"
      },
      "side": {
        "receipt": "Recibo",
        "invoice": "Fatura",
        "invoice_paid": "Fatura diz pago",
        "confirmed_rows": "Pagamentos confirmados",
        "payment": "Pagamento lançado",
        "product": "Produto"
      },
      "open": "{n} em aberto",
      "all": "Todos",
      "waiting": "Aguardando",
      "done": "Decididos"
    },
    "lang": {
      "title": "Idioma",
      "hint": "O idioma é fixo para esta conta. Só se troca aqui.",
      "saved": "Idioma salvo para esta conta"
    },
    "state": {
      "loading": "Carregando…",
      "empty": "Nada por aqui ainda",
      "error": "Algo deu errado",
      "retry": "Tentar de novo"
    },
    "openTabsQueue": {
      "title": "Comandas em aberto",
      "age": "aberta há {age}",
      "from": "aberta em {date}",
      "none": "Nenhuma comanda em aberto",
      "resolve": "Resolver",
      "resolveTitle": "Resolver comanda antiga",
      "resolveHint": "Escreva por que esta comanda está sendo encerrada sem pagamento. Fica no histórico.",
      "days": "{n} d",
      "hours": "{n} h",
      "minutes": "{n} min",
      "total": "{n} em aberto · {amount}",
      "mustResolve": "Feche ou resolva as comandas em aberto antes de fechar o dia."
    },
    "offline": {
      "queued": "{n} venda(s) salvas neste aparelho, esperando a conexão",
      "syncing": "Enviando vendas salvas…",
      "synced": "Vendas salvas enviadas",
      "offlineNow": "Sem conexão. As vendas ficam neste aparelho e sobem quando voltar."
    }
  }
}
