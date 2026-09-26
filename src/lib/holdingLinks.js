/** URLs do painel JBM Holding (mirror em bebidas-control funciona; jbm-master.vercel.app precisa redeploy) */
const ORIGIN = typeof window !== 'undefined' ? window.location.origin : 'https://bebidas-control.vercel.app'

export const HOLDING_BASE = `${ORIGIN}/holding/#`
export const HOLDING_DRINKS = `${HOLDING_BASE}/drinks`
export const HOLDING_HR = `${HOLDING_BASE}/hr`
export const HOLDING_DASHBOARD = `${HOLDING_BASE}/`

/** Fallback standalone (404 em /hr até Vercel Root Directory = jbm-master-app) */
export const JBM_MASTER_URL = 'https://jbm-master.vercel.app'
