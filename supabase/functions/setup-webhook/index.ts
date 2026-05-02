// One-shot helper: registers the bot's webhook URL with Telegram.
// Call from the admin page; idempotent.
import { corsHeaders } from "../_shared/cors.ts";
import { tg } from "../_shared/telegram.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// Telegram only allows A-Z, a-z, 0-9, _, -. Sanitize whatever the user typed.
const RAW_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const SECRET = RAW_SECRET.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 256);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = `${SUPABASE_URL}/functions/v1/telegram-webhook`;
    const result = await tg("setWebhook", {
      url,
      secret_token: SECRET || undefined,
      drop_pending_updates: true,
      allowed_updates: ["message", "callback_query"],
    });
    return new Response(JSON.stringify({ ok: true, url, telegram: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
