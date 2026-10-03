/**
 * Local checks for the existing-project homologation audit.
 * Refuses hosted Supabase. Does not apply a mutation.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const preflight = readFileSync(new URL('../sql/audit/NOT_EXECUTED_readonly_catalog_preflight.sql', import.meta.url), 'utf8')
const refusal = readFileSync(new URL('../sql/audit/NOT_EXECUTED_incremental_apply.sql', import.meta.url), 'utf8')
const stripped = preflight
  .replace(/--.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')

assert.equal(/\b(create|alter|drop|insert|update|delete|grant|revoke|truncate|copy)\b/i.test(stripped), false)
assert.match(refusal, /RAISE EXCEPTION/)
assert.equal(/CREATE TABLE|ALTER TABLE|DROP POLICY|INSERT INTO/i.test(refusal), false)

const db = 'atomic_bar_foundation_test'
let ran = false
try {
  execFileSync('sudo', ['-u', 'postgres', 'psql', '-d', db, '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT 1'], { stdio: 'ignore' })
  const before = execFileSync('sudo', ['-u', 'postgres', 'psql', '-d', db, '-tA', '-c',
    `SELECT count(*) FROM public.schema_install`], { encoding: 'utf8' }).trim()
  const out = execFileSync('sudo', ['-u', 'postgres', 'psql', '-d', db, '-v', 'ON_ERROR_STOP=1',
    '-f', 'sql/audit/NOT_EXECUTED_readonly_catalog_preflight.sql'], { encoding: 'utf8' })
  assert.match(out, /mutation\s*\|\s*guard\s*\|\s*not_allowed/)
  assert.match(out, /platform_access\s*\|\s*table\s*\|\s*present/)
  const after = execFileSync('sudo', ['-u', 'postgres', 'psql', '-d', db, '-tA', '-c',
    `SELECT count(*) FROM public.schema_install`], { encoding: 'utf8' }).trim()
  assert.equal(after, before)
  let refused = false
  try {
    execFileSync('sudo', ['-u', 'postgres', 'psql', '-d', db, '-v', 'ON_ERROR_STOP=1',
      '-f', 'sql/audit/NOT_EXECUTED_incremental_apply.sql'], { encoding: 'utf8' })
  } catch (error) {
    refused = /incremental apply to an existing Supabase project is blocked/.test(String(error.stderr || error.stdout || error.message))
  }
  assert.equal(refused, true)
  const still = execFileSync('sudo', ['-u', 'postgres', 'psql', '-d', db, '-tA', '-c',
    `SELECT count(*) FROM public.schema_install`], { encoding: 'utf8' }).trim()
  assert.equal(still, before)
  ran = true
} catch (error) {
  if (error && error.status) throw error
}

if (!ran) {
  console.log('catalog preflight skipped (local foundation database is not present)')
}
console.log('existing catalog audit checks passed')
