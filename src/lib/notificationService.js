/**
 * In-app alerts only. LINE, email, WhatsApp and push are not connected.
 * The database writes fulfillment_alerts inside the RPCs. This module
 * names the events so a later adapter can subscribe without inventing a send.
 */

export const FULFILLMENT_EVENTS = [
  'supplier_order_created',
  'supplier_order_confirmed',
  'supplier_purchase_completed',
  'supplier_issue',
  'supplier_delay',
  'order_in_transit',
  'order_delivered',
  'bar_delivery_confirmed',
  'order_exception',
]

export const notificationAdapters = {
  inApp: 'fulfillment_alerts',
  line: null,
  email: null,
  whatsapp: null,
  push: null,
}
