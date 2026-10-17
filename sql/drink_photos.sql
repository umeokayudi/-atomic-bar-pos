-- JBMTech: Storage bucket for drink photos shown on the till tiles.
-- Additive and idempotent. NOT applied to production: run in staging first, together with pos_start.sql
-- (which adds drink_menu.imagem_url / produtos.imagem_url).
--
-- Public read (the till shows the picture), write only for signed-in staff, files under 2 MB, images only.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('drink-photos', 'drink-photos', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'drink_photos_read') THEN
    CREATE POLICY drink_photos_read ON storage.objects FOR SELECT USING (bucket_id = 'drink-photos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'drink_photos_insert') THEN
    CREATE POLICY drink_photos_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'drink-photos');
  END IF;
END $$;

-- Rollback (only if no photo URLs are in use):
--   DROP POLICY IF EXISTS drink_photos_insert ON storage.objects;
--   DROP POLICY IF EXISTS drink_photos_read ON storage.objects;
--   DELETE FROM storage.buckets WHERE id = 'drink-photos';  -- fails while the bucket still has files
