/** Missão Máxima strings (money labels, reconciliation, language, states, open tabs, offline). */
export default {
  "mm": {
    "money": {
      "faturado": "Facturado",
      "recebido": "Recibido (confirmado)",
      "aReceber": "Por cobrar",
      "pendente": "Pendiente de confirmación",
      "faturadoHint": "Total oficial de las facturas",
      "recebidoHint": "Solo pagos confirmados uno a uno",
      "aReceberHint": "Facturado menos confirmado",
      "pendenteHint": "Informado como pagado, aún sin confirmar. No cuenta como recibido",
      "loadError": "No se pudieron cargar los totales. Inténtelo de nuevo."
    },
    "conc": {
      "nav": "Conciliación",
      "title": "Central de Conciliación",
      "sub": "Lo que no cuadra, lado a lado. Nada aquí cambia un valor: cada punto espera la decisión del dueño.",
      "empty": "Nada que conciliar. Recibos, facturas y pagos coinciden.",
      "loading": "Revisando recibos, facturas y pagos…",
      "error": "No se pudieron cargar los registros: {error}",
      "retry": "Reintentar",
      "diff": "Diferencia",
      "decide": "Decisión del dueño",
      "decided": "Decisión registrada",
      "decidedBy": "{who} · {when}",
      "noDecision": "Esperando la decisión del dueño",
      "decisionTitle": "Decisión del dueño",
      "decisionHint": "Escriba lo que se decidió. Se guarda en el historial con su nombre y la hora. No se cambia ningún valor.",
      "decisionPlaceholder": "ej.: Vale el RY-202610-002, el RY-202610-003 es reimpresión",
      "save": "Guardar decisión",
      "cancel": "Cancelar",
      "saved": "Decisión guardada",
      "saveError": "La decisión no se guardó: {error}",
      "onlyOwner": "Solo el dueño (admin) registra una decisión",
      "kind": {
        "receipt_invoice": "Recibo y factura no coinciden",
        "receipt_duplicate": "Dos recibos para el mismo pago",
        "paid_no_row": "Marcado como pagado sin pago confirmado",
        "pending_credit": "Crédito esperando confirmación",
        "test_item": "Artículo de prueba (fuera de listas y totales)"
      },
      "side": {
        "receipt": "Recibo",
        "invoice": "Factura",
        "invoice_paid": "La factura dice pagado",
        "confirmed_rows": "Pagos confirmados",
        "payment": "Pago registrado",
        "product": "Producto"
      },
      "open": "{n} abiertos",
      "all": "Todos",
      "waiting": "En espera",
      "done": "Decididos"
    },
    "lang": {
      "title": "Idioma",
      "hint": "El idioma es fijo para esta cuenta. Solo se cambia aquí.",
      "saved": "Idioma guardado para esta cuenta"
    },
    "state": {
      "loading": "Cargando…",
      "empty": "Nada por aquí todavía",
      "error": "Algo salió mal",
      "retry": "Reintentar"
    },
    "openTabsQueue": {
      "title": "Cuentas abiertas",
      "age": "abierta hace {age}",
      "from": "abierta el {date}",
      "none": "No hay cuentas abiertas",
      "resolve": "Resolver",
      "resolveTitle": "Resolver cuenta antigua",
      "resolveHint": "Escriba por qué esta cuenta se cierra sin pago. Queda en el historial.",
      "days": "{n} d",
      "hours": "{n} h",
      "minutes": "{n} min",
      "total": "{n} abiertas · {amount}",
      "mustResolve": "Cierre o resuelva las cuentas abiertas antes de cerrar el día."
    },
    "offline": {
      "queued": "{n} venta(s) guardadas en este dispositivo, esperando conexión",
      "syncing": "Enviando ventas guardadas…",
      "synced": "Ventas guardadas enviadas",
      "offlineNow": "Sin conexión. Las ventas quedan en este dispositivo y se envían al volver."
    }
  }
}
