import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { sendMessage } from "../_shared/telegram.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ADMIN_ID = Number(Deno.env.get("TELEGRAM_ADMIN_ID") ?? "0");

function assertOk(result: { error: { message: string } | null }, label: string) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

async function getMasterKey(): Promise<string | null> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "master_admin_key").maybeSingle();
  return typeof data?.value === "string" ? data.value : null;
}

async function authorize(slug: string | null, key: string, master: string) {
  const masterKey = await getMasterKey();
  const isMaster = !!master && !!masterKey && master === masterKey;

  if (!slug) {
    if (!isMaster) throw new Error("Missing or invalid master admin key.");
    return { isMaster: true as const, group: null };
  }

  const { data: group } = await supabase.from("link_groups").select("id, slug, owner_telegram_id").eq("slug", slug).maybeSingle();
  if (!group) throw new Error("Admin page not found");

  if (isMaster) return { isMaster: true as const, group };

  const { data: access } = await supabase.from("admin_access").select("admin_key").eq("link_group_id", group.id).maybeSingle();
  if (!access || access.admin_key !== key) throw new Error("Missing or invalid admin key. Open the admin link sent by the bot.");
  return { isMaster: false as const, group };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const { action, slug, key, master } = body;
    if (!action) throw new Error("Missing admin request data");
    const auth = await authorize(slug ?? null, key ?? "", master ?? "");
    const group = auth.group;

    if (action === "load") {
      const [headingRow, bioRow, interestsRes] = await Promise.all([
        supabase.from("app_settings").select("value").eq("key", "tenant_heading").maybeSingle(),
        supabase.from("app_settings").select("value").eq("key", "default_bio").maybeSingle(),
        supabase.from("listing_interests").select("listing_id, is_interested"),
      ]);

      let users: any[] = [];
      if (auth.isMaster) {
        const { data: usersData } = await supabase
          .from("bot_users").select("*")
          .order("created_at", { ascending: false }).limit(200);
        users = usersData ?? [];
      }

      let listings: any[] = [];
      let groupsOut: any[] = [];
      let applications: any[] = [];
      let chatMessages: any[] = [];
      let chatThreads: any[] = [];

      if (group) {
        const { data } = await supabase
          .from("listings")
          .select("*, listing_photos(id, url, is_hidden, position)")
          .eq("link_group_id", group.id).order("position");
        listings = data ?? [];

        const { data: apps } = await supabase
          .from("applications").select("*")
          .eq("link_group_id", group.id)
          .order("created_at", { ascending: false }).limit(500);
        applications = apps ?? [];

        // Tenant admin: load their chat thread with super admin
        if (!auth.isMaster && (group as any).owner_telegram_id) {
          const tid = (group as any).owner_telegram_id;
          const { data: msgs } = await supabase
            .from("admin_chat_messages").select("*")
            .eq("tenant_telegram_id", tid)
            .order("created_at", { ascending: true }).limit(500);
          chatMessages = msgs ?? [];
          // mark super messages as read by tenant
          await supabase.from("admin_chat_messages")
            .update({ read_by_tenant: true })
            .eq("tenant_telegram_id", tid).eq("sender", "super").eq("read_by_tenant", false);
        }
      }
      if (auth.isMaster) {
        const { data: gs } = await supabase.from("link_groups").select("*").order("created_at", { ascending: false }).limit(200);
        const groupIds = (gs ?? []).map((g: any) => g.id);
        const counts: Record<string, number> = {};
        if (groupIds.length) {
          const { data: ls } = await supabase.from("listings").select("link_group_id").in("link_group_id", groupIds);
          (ls ?? []).forEach((l: any) => { counts[l.link_group_id] = (counts[l.link_group_id] ?? 0) + 1; });
        }
        groupsOut = (gs ?? []).map((g: any) => ({ ...g, listing_count: counts[g.id] ?? 0 }));

        if (!group) {
          const { data: allApps } = await supabase
            .from("applications").select("*")
            .order("created_at", { ascending: false }).limit(500);
          applications = allApps ?? [];
        }

        // Super admin: load chat threads (one per tenant) — most recent first
        const { data: allMsgs } = await supabase
          .from("admin_chat_messages").select("*")
          .order("created_at", { ascending: false }).limit(2000);
        const byTenant = new Map<number, any>();
        for (const m of allMsgs ?? []) {
          const tid = Number(m.tenant_telegram_id);
          if (!byTenant.has(tid)) byTenant.set(tid, { tenant_telegram_id: tid, last: m, unread: 0, messages: [] });
          const t = byTenant.get(tid);
          t.messages.unshift(m); // chronological
          if (m.sender === "tenant" && !m.read_by_super) t.unread++;
        }
        chatThreads = Array.from(byTenant.values());
        // Enrich with bot_user info
        const tids = chatThreads.map(t => t.tenant_telegram_id);
        if (tids.length) {
          const { data: us } = await supabase.from("bot_users").select("telegram_id, username, first_name, last_name").in("telegram_id", tids);
          const map = new Map((us ?? []).map((u: any) => [Number(u.telegram_id), u]));
          chatThreads.forEach(t => { t.user = map.get(t.tenant_telegram_id) ?? null; });
        }
      }

      return new Response(JSON.stringify({
        groupId: group?.id ?? null,
        ownerTelegramId: (group as any)?.owner_telegram_id ?? null,
        groups: groupsOut,
        listings,
        applications,
        defaultBio: typeof bioRow.data?.value === "string" ? bioRow.data.value : "",
        tenantHeading: typeof headingRow.data?.value === "string" ? headingRow.data.value : "Private landlord rental listing",
        users,
        interests: interestsRes.data ?? [],
        chatMessages,
        chatThreads,
        isMaster: auth.isMaster,
        superAdminId: ADMIN_ID,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const requireGroup = () => { if (!group) throw new Error("This action requires a specific listing group. Open it from the master dashboard."); return group; };

    if (action === "update_listing") {
      const g = requireGroup();
      // Whitelist updatable fields
      const allowed = ["address","price","deposit","beds","baths","sqft","bio","description","heading"];
      const values: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body.values ?? {})) {
        if (allowed.includes(k)) values[k] = v;
      }
      assertOk(await supabase.from("listings").update(values).eq("id", body.listing_id).eq("link_group_id", g.id), "Update listing failed");
    }
    else if (action === "add_photo") {
      const g = requireGroup();
      const listingId = String(body.listing_id ?? "");
      const url = String(body.url ?? "").trim();
      if (!listingId || !/^https?:\/\//i.test(url)) throw new Error("Enter a valid photo URL");
      const { data: listing } = await supabase.from("listings").select("id").eq("id", listingId).eq("link_group_id", g.id).maybeSingle();
      if (!listing) throw new Error("Listing not found");
      const { count } = await supabase.from("listing_photos").select("*", { count: "exact", head: true }).eq("listing_id", listingId);
      assertOk(await supabase.from("listing_photos").insert({ listing_id: listingId, url, position: count ?? 0 }), "Add photo failed");
    }
    else if (action === "toggle_photo") assertOk(await supabase.from("listing_photos").update({ is_hidden: body.is_hidden }).eq("id", body.photo_id), "Update photo failed");
    else if (action === "delete_photo") assertOk(await supabase.from("listing_photos").delete().eq("id", body.photo_id), "Delete photo failed");
    else if (action === "delete_listing") {
      const g = requireGroup();
      assertOk(await supabase.from("listings").delete().eq("id", body.listing_id).eq("link_group_id", g.id), "Delete listing failed");
    }
    else if (action === "update_setting") {
      if (!auth.isMaster) throw new Error("Only the super admin can change global defaults.");
      assertOk(await supabase.from("app_settings").upsert({ key: body.setting_key, value: body.value, updated_at: new Date().toISOString() }), "Update setting failed");
    }
    else if (action === "toggle_user") {
      if (!auth.isMaster) throw new Error("Only the super admin can approve or deny users.");
      assertOk(await supabase.from("bot_users").update({ is_allowed: body.is_allowed }).eq("telegram_id", body.telegram_id).eq("is_admin", false), "Update user failed");
    }
    else if (action === "set_credits") {
      if (!auth.isMaster) throw new Error("Only the super admin can change credits.");
      const credits = Math.max(0, Math.floor(Number(body.credits ?? 0)));
      assertOk(await supabase.from("bot_users").update({ credits_remaining: credits }).eq("telegram_id", body.telegram_id).eq("is_admin", false), "Set credits failed");
    }
    else if (action === "send_chat") {
      const text = String(body.body ?? "").trim();
      if (!text) throw new Error("Empty message");
      let tenantId: number;
      let sender: "super" | "tenant";
      if (auth.isMaster) {
        tenantId = Number(body.tenant_telegram_id);
        if (!tenantId) throw new Error("Missing tenant_telegram_id");
        sender = "super";
      } else {
        const g = requireGroup();
        tenantId = Number((g as any).owner_telegram_id);
        if (!tenantId) throw new Error("This listing has no owner Telegram ID — chat unavailable.");
        sender = "tenant";
      }
      assertOk(await supabase.from("admin_chat_messages").insert({
        tenant_telegram_id: tenantId, sender, body: text,
        read_by_super: sender === "super", read_by_tenant: sender === "tenant",
      }), "Send chat failed");
      // Mirror to Telegram
      try {
        if (sender === "super") {
          await sendMessage(tenantId, `💬 <b>Message from admin</b>\n\n${text}\n\n<i>Reply here to respond.</i>`);
        } else if (ADMIN_ID) {
          await sendMessage(ADMIN_ID, `💬 <b>Message from tenant</b> (<code>${tenantId}</code>)\n\n${text}`);
        }
      } catch (e) { console.error("chat tg mirror failed", e); }
    }
    else if (action === "mark_chat_read") {
      const tenantId = Number(body.tenant_telegram_id);
      if (!tenantId) throw new Error("Missing tenant_telegram_id");
      if (auth.isMaster) {
        await supabase.from("admin_chat_messages").update({ read_by_super: true })
          .eq("tenant_telegram_id", tenantId).eq("sender", "tenant").eq("read_by_super", false);
      }
    }
    else if (action === "broadcast") {
      if (!auth.isMaster) throw new Error("Only the super admin can broadcast.");
      const text = String(body.body ?? "").trim();
      if (!text) throw new Error("Empty broadcast");
      const { data: us } = await supabase.from("bot_users").select("telegram_id");
      const recipients = (us ?? []).map((u: any) => Number(u.telegram_id)).filter(Boolean);
      let sent = 0, failed = 0;
      for (const tid of recipients) {
        try {
          const r = await sendMessage(tid, `📣 <b>Announcement</b>\n\n${text}`);
          if (r?.ok) sent++; else failed++;
        } catch (_) { failed++; }
        await new Promise(r => setTimeout(r, 35)); // ~30/sec rate-limit safety
      }
      await supabase.from("broadcasts").insert({ body: text, sent_count: sent, failed_count: failed });
      return new Response(JSON.stringify({ ok: true, sent, failed }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    else throw new Error("Unknown admin action");

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
