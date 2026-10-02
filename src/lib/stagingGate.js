/** Fail-closed decision for operational database access. This module never opens a client. */

import { protectedRefIn } from './supabaseTarget.js'

const STAGING_FLAG = 'ATOMIC_STAGING_AUTHORIZED'

export function describeRuntime(env = process.env) {
  const serverEnv = String(env.VERCEL_ENV || '').trim()
  const channel = String(env.VITE_DEPLOY_CHANNEL || '').trim()
  const url = String(env.VITE_SUPABASE_URL || '').trim()
  const anonKey = String(env.VITE_SUPABASE_ANON_KEY || '').trim()
  const authorized = String(env[STAGING_FLAG] || '').trim() === '1'
  const blockers = []

  if (!serverEnv && !channel) blockers.push('The environment is unidentified.')
  if (serverEnv === 'production' || channel === 'production') blockers.push('Production is not a staging target.')
  if (!url) blockers.push('The Supabase URL is missing.')
  else if (protectedRefIn(url)) blockers.push('The target is a protected production project.')
  else if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/i.test(url)) blockers.push('The Supabase URL is not a project host.')
  if (!anonKey || anonKey.length < 80 || /placeholder|SENSITIVE/i.test(anonKey) || protectedRefIn(anonKey)) {
    blockers.push('The anon key is missing or incomplete.')
  }
  if (!authorized) blockers.push('ATOMIC_STAGING_AUTHORIZED is not set to 1.')
  if (serverEnv && serverEnv !== 'preview') blockers.push('The server environment is not preview.')

  return {
    mode: blockers.length ? 'refused' : 'staging',
    operational: blockers.length === 0,
    writes: false,
    demoIndependent: true,
    blockers,
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
