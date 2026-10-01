import assert from 'node:assert/strict'
import { classifySupabaseTarget, protectedRefIn } from './supabaseGuard.js'

assert.equal(protectedRefIn('https://ojirgkqtqvugqktyuhem.supabase.co'), 'ojirgkqtqvugqktyuhem')
assert.equal(protectedRefIn('https://fxsakrshmldmkdmbevna.supabase.co'), 'fxsakrshmldmkdmbevna')
assert.equal(protectedRefIn('postgres://127.0.0.1/pos_test'), '')

assert.equal(classifySupabaseTarget({}).mode, 'local')
assert.equal(classifySupabaseTarget({
  VITE_SUPABASE_URL: 'https://ojirgkqtqvugqktyuhem.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'anon',
}).mode, 'blocked')
assert.equal(classifySupabaseTarget({
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
  VITE_SUPABASE_ANON_KEY: 'local-key-for-fxsakrshmldmkdmbevna',
}).blockedRef, 'fxsakrshmldmkdmbevna')
assert.equal(classifySupabaseTarget({
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
  VITE_SUPABASE_ANON_KEY: 'local-anon-key',
}).mode, 'remote')

const client = await import('node:fs').then(fs => fs.readFileSync(new URL('./supabase.js', import.meta.url), 'utf8'))
assert.match(client, /classifySupabaseTarget/)
assert.doesNotMatch(client, /createClient\(supabaseUrl/)

console.log('supabase guard tests passed')
