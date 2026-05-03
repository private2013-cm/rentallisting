
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS application_fee numeric,
  ADD COLUMN IF NOT EXISTS property_type text;

CREATE TABLE IF NOT EXISTS public.fetched_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_telegram_id bigint NOT NULL,
  source_url text NOT NULL,
  source text,
  address text,
  price numeric,
  beds integer,
  baths numeric,
  sqft integer,
  property_type text,
  description text,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  search_zip text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fetched_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no public access fetched_listings" ON public.fetched_listings FOR SELECT USING (false);

CREATE TABLE IF NOT EXISTS public.visitor_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_group_id uuid,
  slug text,
  ip text,
  country text,
  region text,
  city text,
  user_agent text,
  device text,
  browser text,
  os text,
  referrer text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.visitor_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no public access visitor_logs" ON public.visitor_logs FOR SELECT USING (false);

CREATE INDEX IF NOT EXISTS visitor_logs_group_idx ON public.visitor_logs(link_group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fetched_listings_owner_idx ON public.fetched_listings(owner_telegram_id, status, created_at DESC);
