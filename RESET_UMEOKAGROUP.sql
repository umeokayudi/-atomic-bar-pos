-- Cole TUDO e clique Run.
-- Tem de aparecer 1 linha no final com umeokagroup@gmail.com.

do $$
declare
  uid uuid;
begin
  select id into uid
  from auth.users
  where lower(email) = 'umeokagroup@gmail.com';

  if uid is null then
    uid := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      uid,
      'authenticated',
      'authenticated',
      'umeokagroup@gmail.com',
      crypt('Jbm#Fornecedor2026', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"nome":"Umeoka Group","role":"fornecedor"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    );

    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(),
      uid,
      jsonb_build_object('sub', uid::text, 'email', 'umeokagroup@gmail.com'),
      'email',
      uid::text,
      now(),
      now(),
      now()
    );
  else
    update auth.users
    set
      encrypted_password = crypt('Jbm#Fornecedor2026', gen_salt('bf')),
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      banned_until = null,
      updated_at = now()
    where id = uid;
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'perfis'
  ) then
    insert into public.perfis (id, nome, role)
    values (uid, 'Umeoka Group', 'staff')
    on conflict (id) do update
      set nome = excluded.nome, role = 'staff';
  end if;
end;
$$;

select id, email, email_confirmed_at is not null as confirmado
from auth.users
where lower(email) = 'umeokagroup@gmail.com';
