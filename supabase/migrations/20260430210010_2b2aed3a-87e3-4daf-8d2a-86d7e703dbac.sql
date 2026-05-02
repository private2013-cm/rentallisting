CREATE TABLE IF NOT EXISTS public.admin_access (
  link_group_id UUID PRIMARY KEY REFERENCES public.link_groups(id) ON DELETE CASCADE,
  admin_key TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_access ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'admin_access' AND policyname = 'no public access admin_access'
  ) THEN
    CREATE POLICY "no public access admin_access"
    ON public.admin_access
    FOR SELECT
    USING (false);
  END IF;
END $$;

INSERT INTO public.admin_access (link_group_id)
SELECT id FROM public.link_groups
ON CONFLICT (link_group_id) DO NOTHING;