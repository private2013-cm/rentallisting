
-- Set search_path on the helper function (security hardening)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- Explicit deny-public policies on internal tables (service role bypasses RLS)
CREATE POLICY "no public access bot_users" ON public.bot_users FOR SELECT USING (false);
CREATE POLICY "no public access bot_state" ON public.bot_state FOR SELECT USING (false);

-- Public insert policies are intentional (tenants need to submit without auth);
-- mitigate abuse with rate limiting at the edge function layer if needed later.
