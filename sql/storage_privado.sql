-- Comprovantes de pagamento (bucket "recibos") e cobranças de fornecedor (bucket "cobrancas") deixam de ser
-- públicos (Missão Máxima, Bloco 1.3). PENDENTE: o dono aplica DEPOIS de publicar o código desta branch
-- (o app novo abre esses arquivos com endereço assinado de curta duração; o app antigo usa o endereço público
-- e pararia de abrir). Nenhum arquivo é apagado ou movido. Depende de sql/rls_por_papel.sql (funções jbm_*).
-- Pode rodar mais de uma vez. Rollback no fim.

UPDATE storage.buckets SET public = false WHERE id IN ('recibos', 'cobrancas');

-- recibos: caminho "recibos/<bar_id>/<arquivo>". O HQ de dinheiro lê tudo; dono/gerente só a pasta do próprio bar.
DROP POLICY IF EXISTS upload ON storage.objects;
DROP POLICY IF EXISTS read ON storage.objects;
DROP POLICY IF EXISTS recibos_read ON storage.objects;
DROP POLICY IF EXISTS recibos_upload ON storage.objects;
CREATE POLICY recibos_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'recibos' AND (
    public.jbm_is_money_hq()
    OR (public.jbm_role() IN ('cliente', 'gerente') AND (storage.foldername(name))[2] = public.jbm_my_bar()::text)));
CREATE POLICY recibos_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'recibos' AND (
    public.jbm_is_money_hq()
    OR (public.jbm_role() IN ('cliente', 'gerente') AND (storage.foldername(name))[2] = public.jbm_my_bar()::text)));

-- cobrancas (contas de fornecedor da JBM): só o HQ.
DROP POLICY IF EXISTS cobrancas_hq ON storage.objects;
CREATE POLICY cobrancas_hq ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'cobrancas' AND public.jbm_is_hq())
  WITH CHECK (bucket_id = 'cobrancas' AND public.jbm_is_hq());

-- Limites de upload no servidor: tamanho e tipo (fotos e PDF).
UPDATE storage.buckets SET file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf']
  WHERE id = 'recibos';
UPDATE storage.buckets SET file_size_limit = 20971520,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf','application/json','text/plain']
  WHERE id = 'cobrancas';
UPDATE storage.buckets SET file_size_limit = 5242880, allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
  WHERE id = 'drink-photos';

-- Rollback:
--   UPDATE storage.buckets SET public = true, file_size_limit = NULL, allowed_mime_types = NULL WHERE id IN ('recibos','cobrancas');
--   DROP POLICY recibos_read / recibos_upload / cobrancas_hq ON storage.objects;
--   CREATE POLICY upload ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'recibos');
--   CREATE POLICY read ON storage.objects FOR SELECT USING (bucket_id = 'recibos');
