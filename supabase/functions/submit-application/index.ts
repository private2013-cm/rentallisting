// Tenant submits application form -> save & forward to listing owner + super admin via Telegram.
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

    await supabase.from("applications").insert({
      listing_id: listing_id ?? null,
      link_group_id: link_group_id ?? null,
      data: safe,
    });

    // Look up listing for context + owner
    let listingLine = "";
    let ownerTgId: number | null = null;
    let listingName = "";
    if (listing_id) {
      const { data: listing } = await supabase
        .from("listings")
        .select("address, price, beds, link_group_id")
        .eq("id", listing_id)
        .maybeSingle();
      if (listing) {
        listingName = listing.address ?? `Listing`;
        listingLine = `\n🏠 <b>${listingName}</b>\n${listing.beds ?? "?"} bed · $${listing.price ?? "—"}\n`;
        const { data: group } = await supabase
          .from("link_groups")
          .select("owner_telegram_id")
          .eq("id", listing.link_group_id)
          .maybeSingle();
        ownerTgId = group?.owner_telegram_id ?? null;
      }
    } else if (link_group_id) {
      const { data: group } = await supabase
        .from("link_groups")
        .select("owner_telegram_id")
        .eq("id", link_group_id)
        .maybeSingle();
      ownerTgId = group?.owner_telegram_id ?? null;
    }

    const lines = Object.entries(safe).map(([k, v]) => `<b>${k}</b>: ${v}`).join("\n");
    const header = kind === "tour" ? "📅 <b>New tour request</b>" : "📝 <b>New application</b>";
    const message = `${header}${listingLine}\n${lines}`;

    // Notify the listing-group owner (the tenant admin)
    const sentTo = new Set<number>();
    if (ownerTgId && ownerTgId > 0) {
      await sendMessage(ownerTgId, message);
      sentTo.add(ownerTgId);
    }
    // Also notify the super admin (avoid double-send if they own it)
    if (ADMIN_ID && !sentTo.has(ADMIN_ID)) {
      await sendMessage(ADMIN_ID, `${message}\n\n<i>(forwarded — super admin copy)</i>`);
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
