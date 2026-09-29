-- Simulated rows for a disposable database. Not production data.

INSERT INTO public.bars (id, nome) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Bar A'),
  ('22222222-2222-4222-8222-222222222222', 'Bar B');

INSERT INTO public.perfis (id, nome, email, role, bar_id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Admin', 'admin@example.test', 'admin', NULL),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'JBM', 'jbm@example.test', 'jbm', NULL),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Gerente A', 'gerente-a@example.test', 'gerente', '11111111-1111-4111-8111-111111111111'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Caixa A', 'caixa-a@example.test', 'caixa', '11111111-1111-4111-8111-111111111111'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Staff A', 'staff-a@example.test', 'bar_staff', '11111111-1111-4111-8111-111111111111'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'Cliente A', 'cliente-a@example.test', 'cliente', '11111111-1111-4111-8111-111111111111'),
  ('99999999-9999-4999-8999-999999999999', 'Funcionario', 'func@example.test', 'funcionario', NULL),
  ('88888888-8888-4888-8888-888888888888', 'Fornecedor', 'supplier@example.test', 'fornecedor', NULL),
  ('77777777-7777-4777-8777-777777777777', 'Staff legado', 'staff@example.test', 'staff', NULL),
  ('66666666-6666-4666-8666-666666666666', 'Gerente B', 'gerente-b@example.test', 'gerente', '22222222-2222-4222-8222-222222222222');

INSERT INTO public.produtos (id, nome, categoria, preco_venda, custo, ativo, estoque_atual, estoque_minimo, estoque_maximo, volume_ml) VALUES
  ('33333333-3333-4333-8333-333333333333', 'Whisky', 'spirits', 8000, 3000, true, 7, 1, 20, 700),
  ('44444444-4444-4444-8444-444444444444', 'Beer', 'beer', 900, 300, true, 12, 2, 40, 350);

INSERT INTO public.fornecedores (id, nome, email, ativo) VALUES
  ('12121212-1212-4212-8212-121212121212', 'Source', 'source@example.test', true);

INSERT INTO public.pedidos (id, bar_id, status, total_estimado, criado_em, data_pedido, obs) VALUES
  ('13131313-1313-4313-8313-131313131313', '11111111-1111-4111-8111-111111111111', 'pendente', 8000, '2026-01-15 12:00+09', '2026-01-15', 'bar A order');

INSERT INTO public.pedidos_itens (id, pedido_id, produto_id, qtd, preco_unitario) VALUES
  ('14141414-1414-4414-8414-141414141414', '13131313-1313-4313-8313-131313131313', '33333333-3333-4333-8333-333333333333', 1, 8000);

INSERT INTO public.vendas (id, bar_id, data, data_venda, total, obs, criado_por, comissao_total) VALUES
  ('15151515-1515-4515-8515-151515151515', '11111111-1111-4111-8111-111111111111', '2026-01-10', '2026-01-10 20:00+09', 8000, 'jbm bill', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 0);

INSERT INTO public.vendas_itens (id, venda_id, produto_id, qtd, preco_unitario) VALUES
  ('16161616-1616-4616-8616-161616161616', '15151515-1515-4515-8515-151515151515', '33333333-3333-4333-8333-333333333333', 1, 8000);

INSERT INTO public.caixa_movimentos (id, tipo, valor, data, descricao) VALUES
  ('55555555-5555-4555-8555-555555555555', 'saida', 12345, '2024-06-01 10:00+09', 'historical-jbm');

INSERT INTO public.estoque_movimentos (id, produto_id, bar_id, tipo, qtd, criado_por, obs) VALUES
  ('17171717-1717-4717-8717-171717171717', '33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'entrada', 4, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'opening A'),
  ('18181818-1818-4818-8818-181818181818', '33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'entrada', 2, '66666666-6666-4666-8666-666666666666', 'opening B');

-- Pricing may already exist, without a unique key. One price per bar. Do not collapse them.
CREATE TABLE IF NOT EXISTS public.bar_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  produto_id uuid NOT NULL REFERENCES public.produtos(id),
  drinks_por_garrafa integer,
  preco_drink integer
);

INSERT INTO public.bar_pricing (id, bar_id, produto_id, drinks_por_garrafa, preco_drink) VALUES
  ('19191919-1919-4919-8919-191919191919', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 14, 1500),
  ('20202020-2020-4202-8202-202020202020', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 12, 1800);
