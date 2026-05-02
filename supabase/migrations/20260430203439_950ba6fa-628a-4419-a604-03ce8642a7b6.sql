
-- Bot users: anyone who pressed /start
CREATE TABLE public.bot_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  is_allowed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A shareable group of listings (one URL per /start session)
CREATE TABLE public.link_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  owner_telegram_id BIGINT NOT NULL,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Individual listings
CREATE TABLE public.listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_group_id UUID NOT NULL REFERENCES public.link_groups(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  address TEXT,
  price NUMERIC,
  deposit NUMERIC,
  beds INTEGER,
  baths NUMERIC,
  sqft INTEGER,
  description TEXT,
  bio TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Photos per listing
CREATE TABLE public.listing_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_hidden BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_photos_listing ON public.listing_photos(listing_id);

-- Tenant application submissions
CREATE TABLE public.applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID REFERENCES public.listings(id) ON DELETE SET NULL,
  link_group_id UUID REFERENCES public.link_groups(id) ON DELETE SET NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Interest clicks (interested / not interested)
CREATE TABLE public.listing_interests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  is_interested BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-user bot conversation state
CREATE TABLE public.bot_state (
  telegram_id BIGINT PRIMARY KEY,
  state TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Global key/value settings (default bio, theme, button labels)
CREATE TABLE public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default bio
INSERT INTO public.app_settings (key, value) VALUES
  ('default_bio', '"Ready to move in now, can also secure down till your lease is up, pets allowed, low credit accepted no background check, section 8 also accepted but I''ll need to verify your voucher"'::jsonb),
  ('apply_url', '"https://forms.gle/NkPjEnRDY75E3TnNA"'::jsonb),
  ('theme', '{"primary":"#1a4d3a","accent":"#c9a961"}'::jsonb);

-- Enable RLS
ALTER TABLE public.bot_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Public read for tenant-facing data
CREATE POLICY "public read link_groups" ON public.link_groups FOR SELECT USING (true);
CREATE POLICY "public read listings" ON public.listings FOR SELECT USING (true);
CREATE POLICY "public read photos" ON public.listing_photos FOR SELECT USING (true);
CREATE POLICY "public read settings" ON public.app_settings FOR SELECT USING (true);

-- Public insert for applications & interests (tenants submit without login)
CREATE POLICY "public insert applications" ON public.applications FOR INSERT WITH CHECK (true);
CREATE POLICY "public insert interests" ON public.listing_interests FOR INSERT WITH CHECK (true);

-- bot_users, bot_state: no public access (service role only)

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_listings_updated BEFORE UPDATE ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Realtime for live admin updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.listings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.listing_photos;
ALTER PUBLICATION supabase_realtime ADD TABLE public.listing_interests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.applications;
