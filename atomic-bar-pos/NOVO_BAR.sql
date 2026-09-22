-- Novo bar no ecossistema JBM.
-- 1) Cria o local
-- 2) Cria o usuário do bar no Authentication (Users) e copie o UUID
-- 3) Liga o perfil ao bar_id
-- Troque os valores entre aspas.

insert into bars (nome, cor)
select 'NOME DO BAR', '#C19C56'
where not exists (select 1 from bars where lower(nome) = lower('NOME DO BAR'));

-- Depois de criar o login do gerente no Auth:
-- update perfis
-- set role = 'cliente', bar_id = (select id from bars where nome = 'NOME DO BAR' limit 1)
-- where lower(email) = 'gerente@bar.com';

-- No POS, o mesmo bar_id isola produtos, vendas, cast e caixa.
