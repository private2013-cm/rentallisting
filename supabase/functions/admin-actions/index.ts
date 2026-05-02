import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

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

  const { data: group } = await supabase.from("link_groups").select("id, slug").eq("slug", slug).maybeSingle();
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
      const [headingRow, bioRow, usersRes, interestsRes] = await Promise.all([
        supabase.from("app_settings").select("value").eq("key", "tenant_heading").maybeSingle(),
        supabase.from("app_settings").select("value").eq("key", "default_bio").maybeSingle(),
        supabase.from("bot_users").select("*").order("created_at", { ascending: false }).limit(200),
        supabase.from("listing_interests").select("listing_id, is_interested"),
      ]);

      let listings: any[] = [];
      let groupsOut: any[] = [];
      if (group) {
        const { data } = await supabase
          .from("listings")
          .select("*, listing_photos(id, url, is_hidden, position)")
          .eq("link_group_id", group.id)
          .order("position");
        listings = data ?? [];
      }
      if (auth.isMaster) {
        const { data: gs } = await supabase.from("link_groups").select("*").order("created_at", { ascending: false }).limit(200);
        const groupIds = (gs ?? []).map((g: any) => g.id);
        let counts: Record<string, number> = {};
        if (groupIds.length) {
          const { data: ls } = await supabase.from("listings").select("link_group_id").in("link_group_id", groupIds);
          (ls ?? []).forEach((l: any) => { counts[l.link_group_id] = (counts[l.link_group_id] ?? 0) + 1; });
        }
        groupsOut = (gs ?? []).map((g: any) => ({ ...g, listing_count: counts[g.id] ?? 0 }));
      }

      return new Response(JSON.stringify({
        groupId: group?.id ?? null,
        groups: groupsOut,
        listings,
        defaultBio: typeof bioRow.data?.value === "string" ? bioRow.data.value : "",
        tenantHeading: typeof headingRow.data?.value === "string" ? headingRow.data.value : "Private landlord rental listing",
        users: usersRes.data ?? [],
        interests: interestsRes.data ?? [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Mutations that need a group
    const requireGroup = () => { if (!group) throw new Error("This action requires a specific listing group. Open it from the master dashboard."); return group; };

    if (action === "update_listing") {
      const g = requireGroup();
      assertOk(await supabase.from("listings").update(body.values ?? {}).eq("id", body.listing_id).eq("link_group_id", g.id), "Update listing failed");
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
    else if (action === "update_setting") assertOk(await supabase.from("app_settings").upsert({ key: body.setting_key, value: body.value, updated_at: new Date().toISOString() }), "Update setting failed");
    else if (action === "toggle_user") assertOk(await supabase.from("bot_users").update({ is_allowed: body.is_allowed }).eq("telegram_id", body.telegram_id).eq("is_admin", false), "Update user failed");
    else if (action === "set_credits") {
      const credits = Math.max(0, Math.floor(Number(body.credits ?? 0)));
      assertOk(await supabase.from("bot_users").update({ credits_remaining: credits }).eq("telegram_id", body.telegram_id).eq("is_admin", false), "Set credits failed");
    }
    else throw new Error("Unknown admin action");

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
