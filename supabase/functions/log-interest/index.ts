// Tenant clicks Interested / Not interested -> log and notify admin.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { sendMessage } from "../_shared/telegram.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ADMIN_ID = Number(Deno.env.get("TELEGRAM_ADMIN_ID") ?? "0");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { listing_id, is_interested } = await req.json();
    if (!listing_id || typeof is_interested !== "boolean") {
      return new Response(JSON.stringify({ error: "bad request" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    await supabase.from("listing_interests").insert({ listing_id, is_interested });

    if (ADMIN_ID) {
      const { data: listing } = await supabase.from("listings").select("address, price, beds").eq("id", listing_id).maybeSingle();
      const label = is_interested ? "💚 INTERESTED" : "💔 Not interested";
      await sendMessage(ADMIN_ID, `${label}\n🏠 ${listing?.beds ?? "?"} bed at ${listing?.address ?? "—"} ($${listing?.price ?? "—"})`);
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
