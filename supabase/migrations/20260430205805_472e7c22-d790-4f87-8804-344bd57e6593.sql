DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'applications' AND policyname = 'no public access applications'
  ) THEN
    CREATE POLICY "no public access applications"
    ON public.applications
    FOR SELECT
    USING (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'listing_interests' AND policyname = 'no public access listing_interests'
  ) THEN
    CREATE POLICY "no public access listing_interests"
    ON public.listing_interests
    FOR SELECT
    USING (false);
  END IF;
END $$;