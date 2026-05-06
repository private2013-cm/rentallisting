// Zillow-only "Find listings" — searches Zillow by zip/beds/baths/type,
// scrapes each in parallel, saves into fetched_listings for owner review.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { searchRentals, scrapeListing } from "../_shared/scraper.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function bedsMatch(target: string, actual: number | null): boolean {
  if (target === "any" || actual == null) return true;
  if (target.endsWith("+")) return actual >= Number(target.slice(0, -1));
  return Math.floor(actual) === Number(target);
}
function bathsMatch(target: string, actual: number | null): boolean {
  if (target === "any" || actual == null) return true;
  if (target.endsWith("+")) return actual >= Number(target.slice(0, -1));
  return Number(actual) === Number(target);
}
function typeMatch(targets: string[], actual: string | null): boolean {
  if (!targets.length || targets.includes("any")) return true;
  if (!actual) return true;
  return targets.includes(actual);
}

// Parallel-with-cap helper for fast scraping
async function mapPool<T, R>(items: T[], limit: number, fn: (it: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      try { out[idx] = await fn(items[idx]); } catch { out[idx] = null as any; }
    }
  });
  await Promise.all(workers);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { owner_telegram_id, zip, beds, baths, types, limit, mode, target_group_id } = await req.json();
    if (!owner_telegram_id || !zip) {
      return new Response(JSON.stringify({ error: "missing owner_telegram_id or zip" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: owner } = await supabase
      .from("bot_users")
      .select("credits_remaining,is_admin")
      .eq("telegram_id", Number(owner_telegram_id))
      .maybeSingle();
    const ownerCredits = owner?.credits_remaining ?? 0;
    const isAdmin = !!owner?.is_admin;
    // limit can be a number or "all"
    const isAll = limit === "all" || limit === -1;
    const requestedMax = isAll ? 40 : Math.min(Math.max(Number(limit ?? 10), 1), 40);
    const max = isAdmin ? requestedMax : Math.min(requestedMax, Math.max(ownerCredits, 0));
    if (!isAdmin && max <= 0) {
      return new Response(JSON.stringify({ error: "No credits remaining." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const search = await searchRentals({
      zip: String(zip),
      beds: String(beds ?? "any"),
      baths: String(baths ?? "any"),
      types: Array.isArray(types) ? types : ["any"],
      limit: max,
      mode: mode === "sale" ? "sale" : "rent",
    });
    const urls = search.urls;
    if (!urls.length) {
      return new Response(JSON.stringify({ ok: true, fetched: 0, scanned: 0, mode_used: search.modeUsed, fallback_used: search.fallbackUsed, message: "No matches found." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Scrape up to 6 in parallel for speed
    const results = await mapPool(urls, 6, (u) => scrapeListing(u));

    const inserts: any[] = [];
    for (const r of results) {
      if (!r) continue;
      if (!bedsMatch(String(beds ?? "any"), r.beds)) continue;
      if (!bathsMatch(String(baths ?? "any"), r.baths)) continue;
      if (!typeMatch(Array.isArray(types) ? types : ["any"], r.property_type)) continue;
      inserts.push({
        owner_telegram_id: Number(owner_telegram_id),
        target_group_id: target_group_id ? String(target_group_id) : null,
        source_url: r.source_url, source: r.source,
        address: r.address, price: r.price, beds: r.beds, baths: r.baths, sqft: r.sqft,
        property_type: r.property_type, description: r.description,
        photos: r.photos, search_zip: String(zip), status: "pending",
      });
    }
    if (inserts.length) {
      await supabase.from("fetched_listings").insert(inserts);
    }
    if (!isAdmin && inserts.length > 0) {
      await supabase.from("bot_users").update({ credits_remaining: Math.max(ownerCredits - inserts.length, 0) }).eq("telegram_id", Number(owner_telegram_id));
    }
    return new Response(JSON.stringify({ ok: true, fetched: inserts.length, scanned: urls.length, mode_used: search.modeUsed, fallback_used: search.fallbackUsed, credits_charged: isAdmin ? 0 : inserts.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
