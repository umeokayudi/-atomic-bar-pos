-- Cole isto no SQL Editor e clique Run:
-- https://supabase.com/dashboard/project/ojirgkqtqvugqktyuhem/sql/new
-- Só isso. Não precisa do arquivo grande.

update auth.users
set
  encrypted_password = crypt('Jbm#Fornecedor2026', gen_salt('bf')),
  email_confirmed_at = coalesce(email_confirmed_at, now()),
  banned_until = null,
  updated_at = now()
where lower(email) = 'umeokagroup@gmail.com';

select email, email_confirmed_at is not null as confirmado, updated_at
from auth.users
where lower(email) = 'umeokagroup@gmail.com';
