/**
 * Bar id of the first client bar (Atomic). Kept as a constant only.
 *
 * The data-repair helpers that used to live here (fixAtomicReceivables, revertAtomicPedidosToJune,
 * markPedidosEntregue) deleted sales and invoices and re-created invoices with hard-coded amounts. They were
 * reachable from a public route (api/fix-atomic-june.js) and from GET query flags on the holding routes.
 * All of that was closed on 2026-11-18: no route in this app repairs, deletes or rewrites money data any more.
 * The old code stays readable in git history (commit ba2e583) and must not be brought back.
 */
export const ATOMIC_BAR_ID = 'b23a5f97-ad4c-4c2a-baa6-72a0d3ba85b9'
