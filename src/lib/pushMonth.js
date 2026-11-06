/** Month close numbers for the 1st-of-the-month notification. Pure; tested in scripts/pushTemplates.test.mjs. */
import { nightKeyOfSale, saleNet } from './nightClose.js'

/** Sales of the nights that belong to `monthKey` (YYYY-MM): net total, ticket count, best night. */
export function monthSummary(sales = [], monthKey) {
  const byNight = {}
  let total = 0
  let tickets = 0
  for (const s of sales) {
    const night = nightKeyOfSale(s)
    if (!night || night.slice(0, 7) !== monthKey) continue
    const net = saleNet(s)
    total += net
    if (net > 0) tickets++
    byNight[night] = (byNight[night] || 0) + net
  }
  const best = Object.entries(byNight).sort((a, b) => b[1] - a[1])[0]
  return { total, tickets, bestNight: best?.[0] || '', bestTotal: best?.[1] || 0 }
}
