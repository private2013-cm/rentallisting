-- Per-listing heading override
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS heading text;

-- Admin chat: messages between super admin and each tenant admin (telegram user)
CREATE TABLE IF NOT EXISTS public.admin_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_telegram_id bigint NOT NULL,
  -- "super" = sent by super admin (web), "tenant" = sent by tenant admin (telegram or web)
  sender text NOT NULL CHECK (sender IN ('super','tenant')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_by_super boolean NOT NULL DEFAULT false,
  read_by_tenant boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_admin_chat_tenant ON public.admin_chat_messages (tenant_telegram_id, created_at DESC);

ALTER TABLE public.admin_chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "no public access admin_chat_messages" ON public.admin_chat_messages;
CREATE POLICY "no public access admin_chat_messages" ON public.admin_chat_messages FOR SELECT USING (false);

-- Broadcasts log
CREATE TABLE IF NOT EXISTS public.broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body text NOT NULL,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "no public access broadcasts" ON public.broadcasts;
CREATE POLICY "no public access broadcasts" ON public.broadcasts FOR SELECT USING (false);