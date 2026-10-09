import { readFileSync } from 'fs'
import { join } from 'path'

const FILES = [
  'ATOMIC_POS_SCHEMA.sql',
  'POS_EXTENDED_SCHEMA.sql',
  'BAR_ACCESS_SCHEMA.sql',
  'BAR_CRM_SPACES_SCHEMA.sql',
]

const TRIGGER_SQL = `
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfis (id, nome, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'staff')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

alter table public.perfis drop constraint if exists perfis_role_check;
`

const POOLER_HOSTS = [
  'aws-1-ap-northeast-2.pooler.supabase.com',
  'aws-0-ap-northeast-1.pooler.supabase.com',
  'aws-1-ap-northeast-1.pooler.supabase.com',
]

function sqlRoot() {
  return process.cwd()
}

export function bundledBarSql() {
  const root = sqlRoot()
  const chunks = FILES.map(name => {
    try { return `-- FILE ${name}\n` + readFileSync(join(root, name), 'utf8') }
    catch { return `-- missing ${name}` }
  })
  return chunks.join('\n\n') + '\n\n' + TRIGGER_SQL
}

async function tryPg(connectionString, sql) {
  const pg = (await import('pg')).default
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 })
  await client.connect()
  try {
    await client.query(sql)
    return { ok: true, via: 'postgres' }
  } finally {
    await client.end()
  }
}

export async function applyBarPosSql(extraPass) {
  const sql = bundledBarSql()
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL
  const pass = extraPass || process.env.SUPABASE_DB_PASSWORD || process.env.POSTGRES_PASSWORD
  const ref = (process.env.VITE_SUPABASE_URL || 'https://ojirgkqtqvugqktyuhem.supabase.co').match(/https:\/\/([^.]+)/)?.[1]

  const attempts = []
  if (dbUrl) attempts.push(dbUrl)
  if (pass && ref) {
    const encoded = encodeURIComponent(pass)
    for (const host of POOLER_HOSTS) {
      attempts.push(`postgresql://postgres.${ref}:${encoded}@${host}:6543/postgres`)
      attempts.push(`postgresql://postgres.${ref}:${encoded}@${host}:5432/postgres`)
    }
  }

  const errors = []
  for (const connectionString of attempts) {
    try {
      return await tryPg(connectionString, sql)
    } catch (e) {
      errors.push((e.message || String(e)).split('\n')[0])
    }
  }

  return {
    ok: false,
    error: 'No DATABASE_URL / SUPABASE_DB_PASSWORD. Run APPLY_BAR_LIVE.sql in Supabase SQL Editor.',
    files: FILES,
    attempts: errors.slice(0, 6),
  }
}
