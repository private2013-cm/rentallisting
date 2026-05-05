
ALTER TABLE public.link_groups ADD COLUMN IF NOT EXISTS tenant_heading text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('listing-photos', 'listing-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "public read listing photos" ON storage.objects;
CREATE POLICY "public read listing photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'listing-photos');

DROP POLICY IF EXISTS "service writes listing photos" ON storage.objects;
CREATE POLICY "service writes listing photos"
ON storage.objects FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'listing-photos');

DROP POLICY IF EXISTS "service deletes listing photos" ON storage.objects;
CREATE POLICY "service deletes listing photos"
ON storage.objects FOR DELETE
TO service_role
USING (bucket_id = 'listing-photos');
