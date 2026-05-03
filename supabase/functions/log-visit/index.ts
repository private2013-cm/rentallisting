// Logs a tenant-page visit (IP + geo + UA) and notifies admins on Telegram.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { sendMessage } from "../_shared/telegram.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ADMIN_ID = Number(Deno.env.get("TELEGRAM_ADMIN_ID") ?? "0");

function parseUA(ua: string) {
  const u = ua.toLowerCase();
  let device = "Desktop", browser = "Unknown", os = "Unknown";
  if (/iphone|ipod/.test(u)) { device = "iPhone"; os = "iOS"; }
  else if (/ipad/.test(u)) { device = "iPad"; os = "iPadOS"; }
  else if (/android/.test(u)) { device = "Android"; os = "Android"; }
  else if (/windows/.test(u)) os = "Windows";
  else if (/mac os/.test(u)) os = "macOS";
  else if (/linux/.test(u)) os = "Linux";
  if (/edg\//.test(u)) browser = "Edge";
  else if (/chrome\//.test(u) && !/edg\//.test(u)) browser = "Chrome";
  else if (/safari\//.test(u) && !/chrome\//.test(u)) browser = "Safari";
  else if (/firefox\//.test(u)) browser = "Firefox";
  return { device, browser, os };
}

async function geoLookup(ip: string) {
  if (!ip || ip === "127.0.0.1" || ip.startsWith("::")) return null;
  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`, { headers: { "User-Agent": "rentals-bot/1.0" } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { slug, referrer } = await req.json();
    if (!slug || typeof slug !== "string") {
      return new Response(JSON.stringify({ error: "missing slug" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "";
    const ua = req.headers.get("user-agent") ?? "";
    const { device, browser, os } = parseUA(ua);

    const { data: group } = await supabase.from("link_groups").select("id, owner_telegram_id").eq("slug", slug).maybeSingle();

    const geo = await geoLookup(ip);
    const country = geo?.country_name ?? null;
    const region = geo?.region ?? null;
    const city = geo?.city ?? null;

    await supabase.from("visitor_logs").insert({
      link_group_id: group?.id ?? null, slug, ip,
      country, region, city,
      user_agent: ua.slice(0, 500), device, browser, os,
      referrer: (referrer ?? "").toString().slice(0, 500),
    });

    // Throttle Telegram pings: only notify once per IP per group per 6 hours
    let shouldPing = true;
    if (ip && group?.id) {
      const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const { count } = await supabase.from("visitor_logs")
        .select("id", { count: "exact", head: true })
        .eq("link_group_id", group.id).eq("ip", ip).gte("created_at", since);
      if ((count ?? 0) > 1) shouldPing = false;
    }

    if (shouldPing) {
      const msg =
        `👁 <b>New visitor</b> on /${slug}\n` +
        `🌐 ${ip || "unknown IP"}\n` +
        `📍 ${[city, region, country].filter(Boolean).join(", ") || "location unknown"}\n` +
        `📱 ${device} · ${browser} · ${os}\n` +
        (referrer ? `🔗 from: ${String(referrer).slice(0, 120)}` : "");
      const sent = new Set<number>();
      if (group?.owner_telegram_id) { try { await sendMessage(Number(group.owner_telegram_id), msg); sent.add(Number(group.owner_telegram_id)); } catch {} }
      if (ADMIN_ID && !sent.has(ADMIN_ID)) { try { await sendMessage(ADMIN_ID, msg); } catch {} }
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
