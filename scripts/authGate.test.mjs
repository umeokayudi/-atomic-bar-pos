import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  loginBlockedReason,
  sessionMatchesProfile,
  barMatches,
  portalDestination,
  canOpenHq,
} from '../src/lib/authGate.js'

assert.equal(loginBlockedReason('caixa', 'active'), '')
assert.equal(loginBlockedReason('caixa', 'invited'), '')
assert.equal(loginBlockedReason('caixa', null), '')
assert.equal(loginBlockedReason('bar_staff', 'suspended'), 'suspended')
assert.equal(loginBlockedReason('gerente', 'inactive'), 'suspended')
assert.equal(loginBlockedReason('admin', 'suspended'), '')

assert.equal(sessionMatchesProfile('user-1', { id: 'user-1' }), true)
assert.equal(sessionMatchesProfile('user-1', { id: 'user-2' }), false)
assert.equal(sessionMatchesProfile('', { id: 'user-1' }), false)
assert.equal(sessionMatchesProfile('user-1', null), false)

assert.equal(barMatches('bar-a', 'bar-a'), true)
assert.equal(barMatches('bar-a', 'bar-b'), false)
assert.equal(barMatches('bar-a', null), true)
assert.equal(barMatches('', 'bar-b'), false)

assert.equal(portalDestination('caixa'), '#/pos')
assert.equal(portalDestination('bar_staff'), '#/clock')
assert.equal(portalDestination('gerente'), '#/hq')
assert.equal(portalDestination('cliente'), '#/hq')
assert.equal(portalDestination('fornecedor'), '#/supplier')
assert.equal(portalDestination('admin'), '#/jbm')

assert.equal(canOpenHq('caixa'), false)
assert.equal(canOpenHq('bar_staff'), false)
assert.equal(canOpenHq('gerente'), false)
assert.equal(canOpenHq('admin'), true)
assert.equal(canOpenHq('jbm'), true)

const auth = readFileSync(new URL('../src/components/Auth.jsx', import.meta.url), 'utf8')
const signIn = auth.slice(auth.indexOf('async function signIn'), auth.indexOf('async function signOut'))
assert.match(signIn, /signInWithPassword/)
assert.doesNotMatch(signIn, /lane-login/)
assert.doesNotMatch(signIn, /writeLaneSession/)
assert.doesNotMatch(auth, /applyLane/)

const client = readFileSync(new URL('../src/lib/supabase.js', import.meta.url), 'utf8')
assert.match(client, /localStorage/)
assert.match(client, /storageKey: `sb-\$\{projectRef\}-auth-token`/)
assert.doesNotMatch(client, /auth-\$\{getTabId/)
assert.match(client, /autoRefreshToken: true/)
assert.doesNotMatch(client, /service_role/)

const lanes = readFileSync(new URL('../src/lib/barLanes.js', import.meta.url), 'utf8')
assert.doesNotMatch(lanes, /password:/)
assert.doesNotMatch(lanes, /PosOnly/)

const provision = readFileSync(new URL('./provisionDevAuth.mjs', import.meta.url), 'utf8')
assert.match(provision, /refusing/)
assert.match(provision, /SUPABASE_SERVICE_ROLE_KEY/)
assert.doesNotMatch(provision, /createUser\(\{[^}]*password:\s*['"]/)
assert.doesNotMatch(provision, /process\.env\.VITE_/)

const staff = readFileSync(new URL('../api/_routeBarStaff.js', import.meta.url), 'utf8')
assert.match(staff, /body\.status === 'inactive'/)
assert.match(staff, /ban_duration: '876000h'/)
assert.match(staff, /ban_duration: 'none'/)

console.log('auth gate tests passed')
