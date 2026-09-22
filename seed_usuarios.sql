-- Atomic Bar + JBM fornecedor — cole no SQL Editor do projeto ojirgkqtqvugqktyuhem
-- Authentication → SQL Editor → Run
-- Pode rodar de novo: se o e-mail já existe, a senha e o papel são atualizados.

create extension if not exists pgcrypto;

create or replace function public.upsert_login_user(
  p_email text,
  p_password text,
  p_nome text,
  p_role text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  uid uuid;
  ident_id uuid;
begin
  select id into uid from auth.users where lower(email) = lower(p_email);

  if uid is null then
    uid := gen_random_uuid();

    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      uid,
      'authenticated',
      'authenticated',
      lower(p_email),
      crypt(p_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('nome', p_nome, 'role', p_role),
      now(),
      now(),
      '',
      '',
      '',
      ''
    );

    insert into auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      provider_id,
      last_sign_in_at,
      created_at,
      updated_at
    ) values (
      gen_random_uuid(),
      uid,
      jsonb_build_object('sub', uid::text, 'email', lower(p_email)),
      'email',
      uid::text,
      now(),
      now(),
      now()
    );
  else
    update auth.users
    set
      encrypted_password = crypt(p_password, gen_salt('bf')),
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
        || jsonb_build_object('nome', p_nome, 'role', p_role),
      updated_at = now()
    where id = uid;

    select id into ident_id from auth.identities where user_id = uid and provider = 'email' limit 1;
    if ident_id is null then
      insert into auth.identities (
        id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(),
        uid,
        jsonb_build_object('sub', uid::text, 'email', lower(p_email)),
        'email',
        uid::text,
        now(),
        now(),
        now()
      );
    end if;
  end if;

  return uid;
end;
$$;

select public.upsert_login_user(
  'umeokayudi@gmail.com',
  'Atomic#2026Admin',
  'Umeoka',
  'admin'
) as admin_id;

select public.upsert_login_user(
  'caixa@atomic.bar',
  'Atomic#2026Caixa',
  'Caixa Atomic',
  'staff'
) as caixa_id;

select public.upsert_login_user(
  'umeokagroup@gmail.com',
  'Jbm#Fornecedor2026',
  'Umeoka Group / JBM',
  'fornecedor'
) as fornecimento_id;

-- Bebidas Control (mesmo banco) lê a tabela perfis, não o metadata.
-- Fornecimento antigo: umeokagroup@gmail.com entra como staff nesse painel.
do $$
declare
  rec record;
  has_email boolean;
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'perfis'
  ) then
    return;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'perfis' and column_name = 'email'
  ) into has_email;

  for rec in
    select
      id,
      lower(email) as email,
      coalesce(raw_user_meta_data->>'nome', split_part(email, '@', 1)) as nome,
      case
        when lower(email) = 'umeokayudi@gmail.com' then 'admin'
        when lower(email) = 'umeokagroup@gmail.com' then 'staff'
        else 'staff'
      end as role
    from auth.users
    where lower(email) in ('umeokayudi@gmail.com', 'caixa@atomic.bar', 'umeokagroup@gmail.com')
  loop
    if has_email then
      insert into public.perfis (id, nome, email, role, bar_id)
      values (rec.id, rec.nome, rec.email, rec.role, null)
      on conflict (id) do update
        set nome = excluded.nome,
            email = excluded.email,
            role = excluded.role;
    else
      insert into public.perfis (id, nome, role)
      values (rec.id, rec.nome, rec.role)
      on conflict (id) do update
        set nome = excluded.nome,
            role = excluded.role;
    end if;
  end loop;
end;
$$;

select u.email,
       u.raw_user_meta_data->>'role' as role_pos,
       p.role as role_bebidas,
       u.email_confirmed_at is not null as confirmado
from auth.users u
left join public.perfis p on p.id = u.id
where lower(u.email) in ('umeokayudi@gmail.com', 'caixa@atomic.bar', 'umeokagroup@gmail.com');
