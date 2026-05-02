// Tenant submits application form -> save & forward to admin via Telegram.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { sendMessage } from "../_shared/telegram.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ADMIN_ID = Number(Deno.env.get("TELEGRAM_ADMIN_ID") ?? "0");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const { listing_id, link_group_id, intent, data } = body;
    if (!data || typeof data !== "object") {
      return new Response(JSON.stringify({ error: "missing data" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const kind = intent === "tour" ? "tour" : "apply";

    // Basic field length caps
    const safe: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) {
      safe[k] = String(v ?? "").slice(0, 500);
    }

    await supabase.from("applications").insert({ listing_id: listing_id ?? null, link_group_id: link_group_id ?? null, data: safe });

    // Look up listing for context
    let context = "";
    if (listing_id) {
      const { data: listing } = await supabase.from("listings").select("address, price, beds").eq("id", listing_id).maybeSingle();
      if (listing) context = `\n🏠 ${listing.beds ?? "?"} bed at ${listing.address ?? "—"} ($${listing.price ?? "—"})\n`;
    }

    if (ADMIN_ID) {
      const lines = Object.entries(safe).map(([k, v]) => `<b>${k}</b>: ${v}`).join("\n");
      const header = kind === "tour" ? "📅 <b>New tour request</b>" : "📝 <b>New application</b>";
      await sendMessage(ADMIN_ID, `${header}${context}\n${lines}`);
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
