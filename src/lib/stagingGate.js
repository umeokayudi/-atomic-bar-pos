/** Fail-closed decision for operational database access. This module never opens a client. */

import { classifyRuntime, RUNTIME } from './supabaseTarget.js'

const STAGING_FLAG = 'ATOMIC_STAGING_AUTHORIZED'

export function describeRuntime(env = process.env) {
  const classified = classifyRuntime({
    channel: env.VITE_DEPLOY_CHANNEL,
    serverEnv: env.VERCEL_ENV,
    url: env.VITE_SUPABASE_URL,
    anonKey: env.VITE_SUPABASE_ANON_KEY,
    stagingAuthorized: env[STAGING_FLAG],
  })
  return {
    mode: classified.runtime === RUNTIME.STAGING ? 'staging' : classified.runtime === RUNTIME.PRODUCTION ? 'production' : 'refused',
    runtime: classified.runtime,
    operational: classified.runtime === RUNTIME.STAGING,
    writes: false,
    demoIndependent: classified.runtime === RUNTIME.LOCAL_DEMO,
    blockers: classified.blockers,
  }
}

export function assertMayWrite(env = process.env) {
  const decision = describeRuntime(env)
  if (!decision.operational) {
    const err = new Error(decision.blockers[0] || 'Operational writes are refused.')
    err.code = 'STAGING_REQUIRED'
    err.blockers = decision.blockers
    throw err
  }
  const err = new Error('Staging writes stay disabled until an isolated project is connected by the operator.')
  err.code = 'STAGING_NOT_CONNECTED'
  throw err
}
