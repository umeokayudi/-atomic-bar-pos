/** Textos en español para los ajustes de estructura del 03/11/2026 (se combinan sobre es.js). */
export default {
  aiAct: {
    hint: 'Pídele que haga algo, p. ej. "pide 6 Jameson para Atomic". Tus datos cambian solo después de pulsar Confirmar. Tus preguntas y respuestas quedan guardadas en el historial de IA.',
  },
  invoiceComp: {
    other: 'Otro {amount}',
    total: 'Total de la factura {amount}',
    received: 'Recibido (efectivo confirmado) {amount}',
    direct: 'Pagado por el bar al proveedor {amount}',
    review: 'En revisión, no recibido {amount}',
    remaining: 'Queda {amount}',
  },
  invoiceLock: {
    needSql: 'No se pudo guardar el ajuste. Inténtalo de nuevo o contacta con el soporte de JBM.',
  },
  monthClose: {
    title: 'Cierre del mes',
    delivered: 'Entregado por JBM (pedidos)',
    adjustment: 'Ajuste',
    recordedBy: 'Registrado por {who} el {when}',
    unexplained: 'Diferencia sin motivo registrado',
    adjustedBilling: 'Facturado (factura ajustada)',
    cost: 'Costo',
    estimateUntil: 'Estimado hasta que se registren las compras reales',
    recordHint: 'Registra el ajuste y su motivo en la factura (Facturas → "Registrar ajuste y motivo").',
  },
  collect: {
    button: 'Cobrar',
    title: 'Correo de cobranza',
    to: 'Para: {email}',
    noEmail: 'no hay correo de facturación registrado (Central → Bares)',
    subjectLabel: 'Asunto',
    copy: 'Copiar texto',
    openMail: 'Abrir en el correo',
    copied: 'Texto copiado',
    copyFailed: 'No se pudo copiar. Selecciona el texto y cópialo a mano.',
    subject: 'Recordatorio de pago — {bar} — {amount} pendiente',
    greeting: 'Estimado equipo de {bar}:',
    intro: 'Este es un resumen de las facturas pendientes de JBM Drinks:',
    introOverdue: 'Algunas facturas de JBM Drinks ya vencieron. Este es el resumen:',
    line: '• {period}: total {total}, ya saldado {settled}, pendiente {left}, vence {due}{flag}',
    overdueFlag: '(VENCIDA)',
    totalLeft: 'Total pendiente: {amount}',
    overdueLeft: 'vencido: {amount}',
    closing: 'Por favor, avísenos cuando se realice el pago. Gracias.',
    signature: 'JBM Drinks',
  },
  receipts: {
    alreadyTitle: 'Este pago ya tiene el recibo {numero}',
    printSame: 'Imprimir de nuevo el mismo recibo',
    duplicateOf: 'Duplicado de {numero}',
  },
  audit: {
    subtitle: 'Activado por defecto: quién cambió los totales de las facturas, los pagos recibidos, los recibos, las entregas y los movimientos de caja y efectivo del bar, y cuándo.',
    appOnly: 'Los cambios hechos en las pantallas de la app quedan registrados. Los cambios hechos directamente en la base de datos también quedan registrados una vez activado el registro de la base de datos (sql/audit_log.sql).',
    table: {
      vendas: 'entrega', vendas_itens: 'artículo de entrega', pos_vendas: 'venta de caja', pos_vendas_itens: 'artículo de venta de caja',
      pos_shifts: 'turno de caja', pos_close_checks: 'control de cierre de caja', caixa_movimentos: 'movimiento de efectivo', bar_overhead: 'costo del bar',
      bar_guest_ledger: 'cuenta de cliente', bar_profile: 'ficha del bar', jbm_company: 'datos de la empresa',
    },
    action: { upsert: 'guardado' },
  },
  catalog: {
    noCost: 'Sin costo',
  },
  pricing: {
    duplicate: 'Este producto ya tiene un precio de este proveedor como "{name}". Usa ese.',
    dupBadge: 'duplicado',
    sheetIncluded: 'La hoja del proveedor ya incluye impuesto: sin +10%',
    sheetExcluded: 'La hoja del proveedor sin impuesto: +10% de impuesto al consumo',
  },
  supplierPriceCheck: {
    taxIncluded: '(con impuesto, como en la hoja del proveedor)',
  },
  configs: {
    barsSubtitle: 'Bares clientes y lo que JBM entregó a cada uno',
    totalRevenue: 'Entregado por JBM (bruto)',
  },
  // Revisión del 05/11/2026
  portal: {
    bill: {
      adjusted: 'Factura {invoice} = entregas con un ajuste de {amount}. Motivo: {reason}',
    },
    home: {
      monthlySpend: 'Comprado a JBM (entregado)',
    },
  },
  dashboard: {
    deliveredLabel: 'Entregado a los bares',
    deliveredVsInvoice: 'Factura del mes {invoice}. Diferencia {gap}: ver el Reporte.',
  },
  clockHub: {
    noClockOut: 'Sin salida desde {when} ({hours} h)',
    noClockOutSub: 'Turno abierto, no contado: {names}',
  },
  house: {
    payDateOff: 'Revisa la fecha: lejos de {month}',
    payDateOffTitle: '¿Está bien el año?',
    payDateOffBody: 'Pagado el {date}, pero el costo es de {month} ({days} días de diferencia). ¿Guardar igual?',
    payDateOffKeep: 'Guardar con esta fecha',
  },
}
