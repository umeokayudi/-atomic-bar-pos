/** Textos em português (pt-BR) para as correções de estrutura de 03/11/2026 (somados sobre pt.js). */
export default {
  aiAct: {
    hint: 'Peça para fazer algo, ex.: "pedir 6 Jameson para o Atomic". Seus dados só mudam depois que você apertar Confirmar. Suas perguntas e respostas ficam guardadas no histórico da IA.',
  },
  invoiceComp: {
    other: 'Outros {amount}',
    total: 'Total faturado {amount}',
    received: 'Recebido (dinheiro confirmado) {amount}',
    direct: 'Pago pelo bar ao fornecedor {amount}',
    review: 'Pendente de confirmação, não recebido {amount}',
    remaining: 'Restante {amount}',
  },
  invoiceLock: {
    needSql: 'O ajuste não pôde ser salvo. Tente novamente ou entre em contato com o suporte da JBM.',
  },
  monthClose: {
    title: 'Fechamento do mês',
    delivered: 'Entregue pela JBM (pedidos)',
    adjustment: 'Ajuste',
    recordedBy: 'Registrado por {who} em {when}',
    unexplained: 'Diferença sem motivo registrado',
    adjustedBilling: 'Faturado (fatura ajustada)',
    cost: 'Custo',
    estimateUntil: 'Estimativa até que as compras reais sejam registradas',
    recordHint: 'Registre o ajuste e o motivo na fatura (Faturas → "Registrar ajuste e motivo").',
  },
  collect: {
    button: 'Cobrar',
    title: 'E-mail de cobrança',
    to: 'Para: {email}',
    noEmail: 'sem e-mail de cobrança cadastrado (Matriz → Bares)',
    subjectLabel: 'Assunto',
    copy: 'Copiar texto',
    openMail: 'Abrir no e-mail',
    copied: 'Texto copiado',
    copyFailed: 'Não foi possível copiar. Selecione o texto e copie manualmente.',
    subject: 'Lembrete de pagamento — {bar} — {amount} em aberto',
    greeting: 'Prezada equipe do {bar},',
    intro: 'Segue o resumo das faturas em aberto da JBM Drinks:',
    introOverdue: 'Algumas faturas da JBM Drinks estão vencidas. Segue o resumo:',
    line: '• {period}: total {total}, já quitado {settled}, restante {left}, vencimento {due}{flag}',
    overdueFlag: '(VENCIDA)',
    totalLeft: 'Total restante: {amount}',
    overdueLeft: 'vencido: {amount}',
    closing: 'Por favor, nos avise quando o pagamento for feito. Obrigado.',
    signature: 'JBM Drinks',
  },
  receipts: {
    alreadyTitle: 'Este pagamento já tem o recibo {numero}',
    printSame: 'Imprimir o mesmo recibo novamente',
    duplicateOf: 'Duplicata de {numero}',
  },
  audit: {
    subtitle: 'Ativo por padrão: quem alterou totais de faturas, pagamentos recebidos, recibos, entregas e os lançamentos de caixa do bar, e quando.',
    appOnly: 'Alterações feitas nas telas do aplicativo são registradas. Alterações feitas diretamente no banco de dados também são registradas, quando o log do banco estiver ativado (sql/audit_log.sql).',
    table: {
      vendas: 'entrega', vendas_itens: 'item de entrega', pos_vendas: 'venda do caixa', pos_vendas_itens: 'item de venda do caixa',
      pos_shifts: 'turno do caixa', pos_close_checks: 'conferência de fechamento', caixa_movimentos: 'lançamento de caixa', bar_overhead: 'custo do bar',
      bar_guest_ledger: 'comanda de convidado', bar_profile: 'ficha do bar', jbm_company: 'dados da empresa',
    },
    action: { upsert: 'salvo' },
  },
  catalog: {
    noCost: 'Sem custo',
  },
  pricing: {
    duplicate: 'Este produto já tem um preço deste fornecedor como "{name}". Use esse.',
    dupBadge: 'duplicado',
    sheetIncluded: 'Planilha do fornecedor já inclui imposto: sem +10%',
    sheetExcluded: 'Planilha do fornecedor sem imposto: +10% de imposto de consumo',
  },
  supplierPriceCheck: {
    taxIncluded: '(com imposto, como na planilha do fornecedor)',
  },
  configs: {
    barsSubtitle: 'Bares clientes e o que a JBM entregou a cada um',
    totalRevenue: 'Entregue pela JBM (bruto)',
  },
  // 05/11/2026 review
  portal: {
    bill: {
      adjusted: 'Fatura {invoice} = entregas com ajuste de {amount}. Motivo: {reason}',
    },
    home: {
      monthlySpend: 'Comprado da JBM (entregue)',
    },
  },
  dashboard: {
    deliveredLabel: 'Entregue aos bares',
    deliveredVsInvoice: 'Fatura do mês {invoice}. Diferença {gap}: veja o Relatório.',
  },
  clockHub: {
    noClockOut: 'Sem registro de saída desde {when} ({hours}h)',
    noClockOutSub: 'Turno deixado aberto, não contado: {names}',
  },
  house: {
    payDateOff: 'Confira a data: distante de {month}',
    payDateOffTitle: 'O ano está certo?',
    payDateOffBody: 'Pago em {date}, mas o custo é de {month} ({days} dias de diferença). Salvar mesmo assim?',
    payDateOffKeep: 'Salvar com esta data',
  },
}
