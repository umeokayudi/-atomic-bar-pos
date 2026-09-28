import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url)
function read(path) {
  return readFileSync(new URL(path, root), 'utf8')
}

const hash = read('api/_hash.js')
assert.doesNotMatch(hash, /atomic-lane/)
assert.match(hash, /if \(!key\) return null/)

const lane = read('api/_barLaneAuth.js')
assert.match(lane, /Lane sign-in is not configured/)

const estoque = read('src/components/Estoque.jsx')
assert.doesNotMatch(estoque, /estoque_atual:/)

const sqlFiles = ['migration.sql', ...readdirSync(new URL('sql/', root)).filter(name => name.endsWith('.sql')).map(name => `sql/${name}`)]
for (const file of sqlFiles) {
  const text = read(file).replace(/--.*$/gm, '')
  assert.doesNotMatch(text, /USING\s*\(\s*true\s*\)/i, file)
  const chunks = text.split(/CREATE (?:OR REPLACE )?FUNCTION/i).slice(1)
  for (const chunk of chunks) {
    const head = chunk.slice(0, 1800)
    if (!/SECURITY DEFINER/i.test(head)) continue
    assert.match(head, /search_path/i, `${file} DEFINER function missing search_path`)
  }
}

const posUx = read('sql/pos_ux.sql')
assert.match(posUx, /p\.role IN \('cliente', 'gerente'\)/)
assert.doesNotMatch(posUx, /GRANT SELECT, INSERT, UPDATE ON public\.pos_bar_config TO anon/)

const src = read('src/lib/supabase.js')
assert.doesNotMatch(src, /service_role/)

console.log('security model tests passed')
