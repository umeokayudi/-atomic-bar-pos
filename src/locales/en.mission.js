/** Missão Máxima strings (money labels, reconciliation, language, states, open tabs, offline). */
export default {
  "mm": {
    "money": {
      "faturado": "Invoiced",
      "recebido": "Received (confirmed)",
      "aReceber": "To receive",
      "pendente": "Pending confirmation",
      "faturadoHint": "Official invoice totals",
      "recebidoHint": "Only payments confirmed one by one",
      "aReceberHint": "Invoiced minus confirmed",
      "pendenteHint": "Reported as paid, nobody confirmed yet. Not counted as received",
      "loadError": "Could not load the money totals. Try again."
    },
    "conc": {
      "nav": "Reconciliation",
      "title": "Reconciliation Centre",
      "sub": "What does not add up, side by side. Nothing here changes a value: each item waits for the owner's decision.",
      "empty": "Nothing to reconcile. Receipts, invoices and payments agree.",
      "loading": "Checking receipts, invoices and payments…",
      "error": "Could not load the records: {error}",
      "retry": "Try again",
      "diff": "Difference",
      "decide": "Owner's decision",
      "decided": "Decision recorded",
      "decidedBy": "{who} · {when}",
      "noDecision": "Waiting for the owner's decision",
      "decisionTitle": "Owner's decision",
      "decisionHint": "Write what was decided. It is saved in the activity log with your name and the time. No value is changed.",
      "decisionPlaceholder": "e.g. Keep RY-202610-002, RY-202610-003 is a reprint",
      "save": "Save decision",
      "cancel": "Cancel",
      "saved": "Decision saved",
      "saveError": "The decision was not saved: {error}",
      "onlyOwner": "Only the owner (admin) records a decision",
      "kind": {
        "receipt_invoice": "Receipt and invoice differ",
        "receipt_duplicate": "Two receipts for the same payment",
        "paid_no_row": "Marked paid with no confirmed payment",
        "pending_credit": "Credit waiting for confirmation",
        "test_item": "Test item (kept out of lists and totals)"
      },
      "side": {
        "receipt": "Receipt",
        "invoice": "Invoice",
        "invoice_paid": "Invoice says paid",
        "confirmed_rows": "Confirmed payments",
        "payment": "Payment logged",
        "product": "Product"
      },
      "open": "{n} open",
      "all": "All",
      "waiting": "Waiting",
      "done": "Decided"
    },
    "lang": {
      "title": "Language",
      "hint": "The language is fixed for this account. Change it only here.",
      "saved": "Language saved for this account"
    },
    "state": {
      "loading": "Loading…",
      "empty": "Nothing here yet",
      "error": "Something went wrong",
      "retry": "Try again"
    },
    "openTabsQueue": {
      "title": "Open tabs",
      "age": "open for {age}",
      "from": "opened {date}",
      "none": "No open tabs",
      "resolve": "Resolve",
      "resolveTitle": "Resolve an old tab",
      "resolveHint": "Write why this tab is being closed without payment. It is kept in the activity log.",
      "days": "{n} d",
      "hours": "{n} h",
      "minutes": "{n} min",
      "total": "{n} open · {amount}",
      "mustResolve": "Open tabs must be closed or resolved before the day can be closed."
    },
    "offline": {
      "queued": "{n} sale(s) saved on this device, waiting for the connection",
      "syncing": "Sending saved sales…",
      "synced": "Saved sales sent",
      "offlineNow": "No connection. Sales are kept on this device and sent when it is back."
    }
  }
}
