// Telegram bot webhook — handles /start, link collection, admin auth, callbacks.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { sendMessage, answerCallback, tg } from "../_shared/telegram.ts";
import { draftFromUrl, scrapeZillow } from "../_shared/zillow.ts";

// Persistent reply keyboard shown to allowed users
const userKeyboard = {
  keyboard: [
    [{ text: "🏠 New listing link" }, { text: "🔎 Find listings" }],
    [{ text: "📝 Edit my listings" }, { text: "💬 Message admin" }],
    [{ text: "🪙 My credits" }, { text: "❓ Help" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};
const adminKeyboard = {
  keyboard: [
    [{ text: "🏠 New listing link" }, { text: "🔎 Find listings" }],
    [{ text: "📝 Edit my listings" }, { text: "👥 Users" }],
    [{ text: "🛡 Master admin" }, { text: "📣 Broadcast" }],
    [{ text: "❓ Help" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};
const kbFor = (u: any) => (u?.is_admin ? adminKeyboard : userKeyboard);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_ID = Number(Deno.env.get("TELEGRAM_ADMIN_ID") ?? "0");
const RAW_WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const WEBHOOK_SECRET = RAW_WEBHOOK_SECRET.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 256);

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function publicBase(_req: Request): Promise<string> {
  // Prefer the configured published webpage URL (set in app_settings.public_base)
  const { data } = await supabase.from("app_settings").select("value").eq("key", "public_base").maybeSingle();
  const configured = typeof data?.value === "string" ? data.value : null;
  if (configured) return configured.replace(/\/+$/, "");
  // Fallback: lovable preview
  const ref = SUPABASE_URL.match(/https:\/\/([^.]+)/)?.[1];
  return ref ? `https://${ref}.lovableproject.com` : "https://app.lovable.dev";
}

function slug(): string {
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);
}

async function getOrCreateUser(tgUser: any) {
  const isAdmin = tgUser.id === ADMIN_ID;
  const { data: existing } = await supabase
    .from("bot_users")
    .select("*")
    .eq("telegram_id", tgUser.id)
    .maybeSingle();

  if (existing) {
    // Keep admin flag fresh
    if (existing.is_admin !== isAdmin || (isAdmin && !existing.is_allowed)) {
      await supabase
        .from("bot_users")
        .update({ is_admin: isAdmin, is_allowed: isAdmin || existing.is_allowed })
        .eq("telegram_id", tgUser.id);
    }
    return { ...existing, is_admin: isAdmin, is_allowed: isAdmin || existing.is_allowed };
  }
  const { data } = await supabase
    .from("bot_users")
    .insert({
      telegram_id: tgUser.id,
      username: tgUser.username ?? null,
      first_name: tgUser.first_name ?? null,
      last_name: tgUser.last_name ?? null,
      is_admin: isAdmin,
      is_allowed: isAdmin,
    })
    .select()
    .single();
  return data;
}

function stateKey(chatId: number, userId?: number) {
  return chatId < 0 ? chatId : (userId ?? chatId);
}

async function isTelegramChatAdmin(chatId: number, userId: number) {
  if (chatId > 0) return true;
  if (userId === ADMIN_ID) return true;
  const res = await tg("getChatMember", { chat_id: chatId, user_id: userId });
  const status = res?.result?.status;
  return status === "creator" || status === "administrator";
}

async function setState(telegram_id: number, state: string, data: Record<string, unknown> = {}) {
  await supabase.from("bot_state").upsert({ telegram_id, state, data, updated_at: new Date().toISOString() });
}

async function getState(telegram_id: number) {
  const { data } = await supabase.from("bot_state").select("*").eq("telegram_id", telegram_id).maybeSingle();
  return data;
}

async function clearState(telegram_id: number) {
  await supabase.from("bot_state").delete().eq("telegram_id", telegram_id);
}

async function notifyAdminPendingApproval(user: any) {
  if (!ADMIN_ID) return;
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || `id ${user.telegram_id}`;
  await sendMessage(ADMIN_ID, `🔔 New user wants access:\n\n<b>${name}</b>\n@${user.username ?? "—"}\nID: <code>${user.telegram_id}</code>`, {
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ Allow", callback_data: `allow:${user.telegram_id}` },
        { text: "🚫 Deny", callback_data: `deny:${user.telegram_id}` },
      ]],
    },
  });
}

async function processListingLink(chatId: number, url: string, groupId: string, user: any) {
  await sendMessage(chatId, "🔍 Scraping listing…", { reply_markup: kbFor(user) });
  let scraped;
  try {
    scraped = await scrapeZillow(url);
  } catch (e) {
    console.error("scrape failed, creating draft", (e as Error).message);
    scraped = draftFromUrl(url);
  }

  const { data: bioRow } = await supabase.from("app_settings").select("value").eq("key", "default_bio").maybeSingle();
  const defaultBio = (bioRow?.value as string) ?? "";

  const { count } = await supabase.from("listings").select("*", { count: "exact", head: true }).eq("link_group_id", groupId);

  const { data: listing, error } = await supabase
    .from("listings")
    .insert({
      link_group_id: groupId,
      source_url: url,
      address: scraped.address,
      price: scraped.price,
      deposit: null,
      beds: scraped.beds,
      baths: scraped.baths,
      sqft: scraped.sqft,
      description: scraped.description,
      bio: defaultBio,
      position: count ?? 0,
    })
    .select()
    .single();

  if (error || !listing) {
    await sendMessage(chatId, `❌ Failed to save listing: ${error?.message}`);
    return null;
  }

  if (scraped.photos.length > 0) {
    const rows = scraped.photos.map((url, i) => ({ listing_id: listing.id, url, position: i }));
    await supabase.from("listing_photos").insert(rows);
  }

  const isDraft = scraped.photos.length === 0 && !scraped.price;
  const summary =
    `✅ <b>Saved</b>\n` +
    `📍 ${scraped.address ?? "address pending"}\n` +
    `💰 $${listing.price ?? "—"} · 🛏 ${listing.beds ?? "—"} · 📸 ${scraped.photos.length} photos\n` +
    (isDraft ? `\n⚠️ Zillow blocked details — open the admin page to fill in price/photos.\n` : "") +
    `\nReview & manage photos on the admin page.`;

  await sendMessage(chatId, summary);
  return listing;
}

function buildAddMoreKeyboard() {
  return {
    inline_keyboard: [[
      { text: "➕ Add more listings", callback_data: "addmore" },
      { text: "✅ No more — finish", callback_data: "finish" },
    ]],
  };
}

async function finishGroup(chatId: number, groupId: string, base: string) {
  const { data: group } = await supabase.from("link_groups").select("*").eq("id", groupId).single();
  const { data: access } = await supabase.from("admin_access").select("admin_key").eq("link_group_id", groupId).maybeSingle();
  const { data: listings } = await supabase.from("listings").select("id").eq("link_group_id", groupId);

  const tenantUrl = `${base}/l/${group?.slug}`;
  const adminUrl = `${base}/admin/${group?.slug}${access?.admin_key ? `?key=${access.admin_key}` : ""}`;

  await sendMessage(
    chatId,
    `✅ Done! <b>${listings?.length ?? 0}</b> listing(s) bundled.\n\n` +
    `🔗 <b>Tenant link</b> (share this):\n${tenantUrl}\n\n` +
    `⚙️ <b>Admin page</b> (only for you):\n${adminUrl}`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: "👁 Open tenant page", url: tenantUrl },
          { text: "⚙️ Admin", url: adminUrl },
        ]],
      },
    }
  );
  await clearState(chatId);
}

async function showListingPicker(chatId: number, ownerId: number) {
  // Find groups owned by this user, list their listings
  const { data: groups } = await supabase.from("link_groups").select("id, slug").eq("owner_telegram_id", ownerId);
  const gids = (groups ?? []).map(g => g.id);
  if (!gids.length) { await sendMessage(chatId, "You don't have any listings yet. Tap 🏠 New listing link to create one."); return; }
  const { data: listings } = await supabase.from("listings").select("id, address, price, link_group_id").in("link_group_id", gids).order("created_at", { ascending: false }).limit(30);
  if (!listings?.length) { await sendMessage(chatId, "You don't have any listings yet."); return; }
  const slugById = new Map((groups ?? []).map(g => [g.id, g.slug]));
  const buttons = listings.map(l => [{
    text: `${l.address ? l.address.slice(0,40) : "Untitled"} ${l.price ? `· $${l.price}` : ""} · /${slugById.get(l.link_group_id) ?? ""}`,
    callback_data: `editpick:${l.id}`,
  }]);
  await sendMessage(chatId, "📝 <b>Pick a listing to edit:</b>", { reply_markup: { inline_keyboard: buttons } });
}

async function showFieldMenu(chatId: number, listingId: string) {
  const { data: l } = await supabase.from("listings").select("*").eq("id", listingId).maybeSingle();
  if (!l) { await sendMessage(chatId, "Listing not found."); return; }
  const fmt = (v: any) => (v === null || v === undefined || v === "") ? "—" : String(v);
  const summary =
    `<b>${l.address ?? "Untitled"}</b>\n` +
    `Heading: ${fmt(l.heading)}\n` +
    `Price: $${fmt(l.price)} · Deposit: $${fmt(l.deposit)}\n` +
    `Beds: ${fmt(l.beds)} · Sqft: ${fmt(l.sqft)}\n` +
    `Bio: ${l.bio ? l.bio.slice(0,80) : "—"}\n`;
  await sendMessage(chatId, `${summary}\n<b>Pick a field to edit:</b>`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "💰 Price", callback_data: `editfld:${listingId}:price` }, { text: "💵 Deposit", callback_data: `editfld:${listingId}:deposit` }],
        [{ text: "📋 Application fee", callback_data: `editfld:${listingId}:application_fee` }, { text: "🛏 Beds", callback_data: `editfld:${listingId}:beds` }],
        [{ text: "📐 Sqft", callback_data: `editfld:${listingId}:sqft` }, { text: "🚿 Baths", callback_data: `editfld:${listingId}:baths` }],
        [{ text: "📍 Address", callback_data: `editfld:${listingId}:address` }, { text: "🏷 Heading", callback_data: `editfld:${listingId}:heading` }],
        [{ text: "📝 Bio", callback_data: `editfld:${listingId}:bio` }, { text: "📄 Description", callback_data: `editfld:${listingId}:description` }],
        [{ text: "⬅️ Back to listings", callback_data: "editback" }],
      ],
    },
  });
}

type FindFilters = { zip: string; beds: string; baths: string; types: string[] };

function findKeyboard(f: FindFilters) {
  const opt = (val: string, cur: string) => (val === cur ? `✅ ${val}` : val);
  const typeOpt = (val: string) => (f.types.includes(val) ? `✅ ${val}` : val);
  return {
    inline_keyboard: [
      [{ text: `Beds: ${f.beds}`, callback_data: "noop" }],
      [
        { text: opt("any", f.beds), callback_data: "find:beds:any" },
        { text: opt("1", f.beds), callback_data: "find:beds:1" },
        { text: opt("2", f.beds), callback_data: "find:beds:2" },
        { text: opt("3", f.beds), callback_data: "find:beds:3" },
        { text: opt("3+", f.beds), callback_data: "find:beds:3+" },
      ],
      [{ text: `Baths: ${f.baths}`, callback_data: "noop" }],
      [
        { text: opt("any", f.baths), callback_data: "find:baths:any" },
        { text: opt("1", f.baths), callback_data: "find:baths:1" },
        { text: opt("1.5", f.baths), callback_data: "find:baths:1.5" },
        { text: opt("2", f.baths), callback_data: "find:baths:2" },
        { text: opt("2+", f.baths), callback_data: "find:baths:2+" },
      ],
      [{ text: `Type: ${f.types.join(", ")}`, callback_data: "noop" }],
      [
        { text: typeOpt("any"), callback_data: "find:type:any" },
        { text: typeOpt("house"), callback_data: "find:type:house" },
        { text: typeOpt("apartment"), callback_data: "find:type:apartment" },
        { text: typeOpt("condo"), callback_data: "find:type:condo" },
      ],
      [{ text: `🔎 Search ZIP ${f.zip}`, callback_data: "find:go" }, { text: "❌ Cancel", callback_data: "find:cancel" }],
    ],
  };
}

async function sendFindMenu(chatId: number, f: FindFilters) {
  await sendMessage(chatId, `🔎 <b>Find listings in ${f.zip}</b>\n\nPick filters then tap <b>Search</b>:`, { reply_markup: findKeyboard(f) });
}

async function handleUpdate(update: any, req: Request) {
  // Callback queries (inline buttons)
  if (update.callback_query) {
    const cb = update.callback_query;
    const fromId = cb.from.id;
    const chatId = cb.message?.chat?.id ?? fromId;
    const data: string = cb.data ?? "";
    await answerCallback(cb.id);

    // Admin approval & credit-add buttons
    if (fromId === ADMIN_ID && (data.startsWith("allow:") || data.startsWith("deny:"))) {
      const [action, idStr] = data.split(":");
      const targetId = Number(idStr);
      await supabase.from("bot_users").update({ is_allowed: action === "allow" }).eq("telegram_id", targetId);
      await sendMessage(ADMIN_ID, `${action === "allow" ? "✅ Allowed" : "🚫 Denied"} user <code>${targetId}</code>`);
      if (action === "allow") {
        await sendMessage(targetId, "✅ You've been approved! Send /start to begin.");
      }
      return;
    }
    if (fromId === ADMIN_ID && data.startsWith("addcred:")) {
      const [, idStr, amtStr] = data.split(":");
      const targetId = Number(idStr);
      if (amtStr === "custom") {
        await setState(ADMIN_ID, "awaiting_custom_credits", { target_id: targetId });
        await sendMessage(ADMIN_ID, `✏️ Send the credit amount to ADD to <code>${targetId}</code> (e.g. <code>25</code>, or negative like <code>-10</code> to subtract).`);
        return;
      }
      const amt = Number(amtStr);
      const { data: row } = await supabase.from("bot_users").select("credits_remaining,is_admin").eq("telegram_id", targetId).maybeSingle();
      if (!row || row.is_admin) { await sendMessage(ADMIN_ID, "Cannot adjust this user."); return; }
      const next = Math.max(0, (row.credits_remaining ?? 0) + amt);
      await supabase.from("bot_users").update({ credits_remaining: next }).eq("telegram_id", targetId);
      await sendMessage(ADMIN_ID, `🪙 <code>${targetId}</code> → ${next} credits`);
      return;
    }

    const user = await getOrCreateUser(cb.from);
    if (chatId < 0 && !(await isTelegramChatAdmin(chatId, fromId))) {
      await sendMessage(chatId, "🔒 Only Telegram group admins can control listing links in this group.");
      return;
    }
    if (!user.is_allowed) {
      await sendMessage(chatId, "⏳ Waiting for admin approval.");
      return;
    }

    const stateId = stateKey(chatId, fromId);
    const state = await getState(stateId);
    const groupId = state?.data?.group_id;
    const base = await publicBase(req);

    if (data === "addmore" && groupId) {
      await setState(stateId, "awaiting_link", { group_id: groupId });
      await sendMessage(chatId, "📨 Send the next Zillow listing URL.");
      return;
    }
    if (data === "finish" && groupId) {
      await finishGroup(chatId, groupId, base);
      return;
    }

    // Edit-listing flow
    if (data.startsWith("editpick:")) {
      const lid = data.split(":")[1];
      await showFieldMenu(chatId, lid);
      return;
    }
    if (data.startsWith("editfld:")) {
      const [, lid, field] = data.split(":");
      const labels: Record<string,string> = { price:"price ($)", deposit:"deposit ($)", application_fee:"application fee ($)", beds:"beds", baths:"baths", sqft:"square feet", bio:"bio", description:"description", heading:"page heading", address:"address" };
      await setState(stateId, "awaiting_field_value", { listing_id: lid, field });
      await sendMessage(chatId, `✏️ Send the new <b>${labels[field] ?? field}</b>. Send <code>-</code> to clear it. Send /cancel to abort.`);
      return;
    }
    if (data === "editback") {
      await showListingPicker(chatId, fromId);
      return;
    }
    if (data.startsWith("find:")) {
      const st = await getState(stateId);
      const f: FindFilters = (st?.data as any) ?? { zip: "", beds: "any", baths: "any", types: ["any"] };
      const [, kind, val] = data.split(":");
      if (kind === "cancel") { await clearState(stateId); await sendMessage(chatId, "Cancelled."); return; }
      if (kind === "go") {
        if (!f.zip) { await sendMessage(chatId, "Send /find again."); return; }
        await sendMessage(chatId, `🔎 Searching ZIP <b>${f.zip}</b>… this may take ~30s.`);
        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/find-listings`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify({ owner_telegram_id: fromId, zip: f.zip, beds: f.beds, baths: f.baths, types: f.types, limit: 8 }),
          });
          const out = await res.json();
          if (!res.ok) throw new Error(out?.error ?? "Search failed");
          const base = await publicBase(req);
          const { data: grp } = await supabase.from("link_groups").select("slug").eq("owner_telegram_id", fromId).order("created_at", { ascending: false }).limit(1).maybeSingle();
          const reviewUrl = grp ? `${base}/admin/${grp.slug}` : `${base}/admin`;
          await sendMessage(chatId, `✅ Found <b>${out.fetched ?? 0}</b> listing(s) (scanned ${out.scanned ?? 0}).\n\nReview & import them on the <a href="${reviewUrl}">admin page → Find listings</a>.`);
        } catch (e) {
          await sendMessage(chatId, `❌ ${(e as Error).message}`);
        }
        await clearState(stateId);
        return;
      }
      if (kind === "beds") f.beds = val;
      else if (kind === "baths") f.baths = val;
      else if (kind === "type") {
        if (val === "any") f.types = ["any"];
        else {
          const cur = new Set(f.types.filter(t => t !== "any"));
          if (cur.has(val)) cur.delete(val); else cur.add(val);
          f.types = cur.size ? Array.from(cur) : ["any"];
        }
      }
      await setState(stateId, "find_filters", f as unknown as Record<string, unknown>);
      try {
        await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: cb.message?.message_id, reply_markup: findKeyboard(f) });
      } catch (_) {}
      return;
    }
    if (fromId === ADMIN_ID && data.startsWith("chatreply:")) {
      const targetId = Number(data.split(":")[1]);
      await setState(ADMIN_ID, "replying_to_tenant", { target_id: targetId });
      await sendMessage(chatId, `💬 Type your reply to <code>${targetId}</code>. /cancel to abort.`);
      return;
    }
    return;
  }

  if (!update.message) return;
  const msg = update.message;
  const chatId = msg.chat.id;
  let text: string = msg.text ?? "";
  const user = await getOrCreateUser(msg.from);
  const fromId = msg.from?.id ?? chatId;
  const groupChat = chatId < 0;
  const stateId = stateKey(chatId, fromId);

  // Map keyboard button labels → commands
  const labelMap: Record<string, string> = {
    "🏠 New listing link": "/start",
    "🪙 My credits": "/credits",
    "❓ Help": "/help",
    "👥 Users": "/users",
    "🛡 Master admin": "/master",
    "📝 Edit my listings": "/edit",
    "💬 Message admin": "/chat",
    "📣 Broadcast": "/broadcast",
    "🔎 Find listings": "/find",
  };
  if (labelMap[text]) text = labelMap[text];

  const startNewGroup = async () => {
    const newSlug = slug();
    const { data: group } = await supabase
      .from("link_groups")
      .insert({ slug: newSlug, owner_telegram_id: groupChat ? fromId : chatId })
      .select()
      .single();
    await supabase.from("admin_access").insert({ link_group_id: group!.id });
    await setState(stateId, "awaiting_link", { group_id: group!.id });
    await sendMessage(
      chatId,
      "🏠 Send me a Zillow listing URL and I'll build a tenant page for you.\n\nPaste the link below 👇",
      { reply_markup: kbFor(user) }
    );
  };

  // /start
  if (text.startsWith("/start")) {
    if (groupChat && !(await isTelegramChatAdmin(chatId, fromId))) {
      await sendMessage(chatId, "🔒 Only Telegram group admins can start and manage listing links in this group.");
      return;
    }
    const handle = user.username ? `@${user.username}` : (user.first_name || `id ${user.telegram_id}`);
    if (!user.is_allowed) {
      await sendMessage(chatId, `👋 Welcome <b>${handle}</b>!\n\nYour access is pending admin approval. You'll be notified when approved.`);
      await notifyAdminPendingApproval(user);
      return;
    }
    const creditLine = user.is_admin
      ? "🪙 Credits: <b>unlimited</b> (admin)"
      : `🪙 Credits remaining: <b>${user.credits_remaining ?? 0}</b>`;
    await sendMessage(
      chatId,
      `👋 Welcome <b>${handle}</b>!\n${creditLine}\n\nTap 🏠 <b>New listing link</b> below or paste a Zillow URL to begin.`,
      { reply_markup: kbFor(user) }
    );
    await startNewGroup();
    return;
  }

  // /help
  if (text.startsWith("/help")) {
    const lines = [
      "<b>How to use</b>",
      "🏠 Tap <b>New listing link</b> then paste a Zillow URL.",
      "🪙 Each Zillow link costs 1 credit.",
      "Add multiple listings to the same shareable link before tapping <i>Finish</i>.",
    ];
    if (user.is_admin) {
      lines.push("", "<b>Admin</b>", "👥 Users — approve / deny / set credits", "🛡 Master admin — full dashboard link", "<code>/addcredits TG_ID 25</code> — add credits (negative subtracts)", "<code>/setcredits TG_ID 100</code> — set exact balance");
    }
    await sendMessage(chatId, lines.join("\n"), { reply_markup: kbFor(user) });
    return;
  }

  // /credits
  if (text.startsWith("/credits")) {
    if (user.is_admin) {
      await sendMessage(chatId, "🪙 You're an admin — unlimited credits.", { reply_markup: kbFor(user) });
    } else {
      const { data: fresh } = await supabase.from("bot_users").select("credits_remaining").eq("telegram_id", fromId).maybeSingle();
      await sendMessage(chatId, `🪙 You have <b>${fresh?.credits_remaining ?? 0}</b> credit(s) left.`, { reply_markup: kbFor(user) });
    }
    return;
  }

  // /master (admin only) — returns master admin dashboard URL
  if (text.startsWith("/master") && user.is_admin) {
    const { data } = await supabase.from("app_settings").select("value").eq("key", "master_admin_key").maybeSingle();
    const key = typeof data?.value === "string" ? data.value : null;
    if (!key) {
      await sendMessage(chatId, "⚠️ Master admin key not configured. Set <code>master_admin_key</code> in app_settings.");
      return;
    }
    const base = await publicBase(req);
    const url = `${base}/admin?master=${key}`;
    await sendMessage(chatId, `🛡 <b>Master admin dashboard</b>\n${url}\n\nAnyone with this link has full admin access — keep it private.`, {
      reply_markup: { inline_keyboard: [[{ text: "Open dashboard", url }]] },
    });
    return;
  }

  // /edit — show listing picker
  if (text.startsWith("/edit")) {
    if (!user.is_allowed) { await sendMessage(chatId, "⏳ Waiting for admin approval."); return; }
    await showListingPicker(chatId, fromId);
    return;
  }

  // /find — interactive search flow
  if (text.startsWith("/find")) {
    if (!user.is_allowed) { await sendMessage(chatId, "⏳ Waiting for admin approval."); return; }
    await setState(stateId, "find_zip", {});
    await sendMessage(chatId, "🔎 <b>Find listings</b>\n\nSend the <b>ZIP code</b> to search (e.g. <code>30341</code>). /cancel to stop.");
    return;
  }

  // /chat — tenant opens chat with super admin
  if (text.startsWith("/chat") && !user.is_admin) {
    if (!user.is_allowed) { await sendMessage(chatId, "⏳ Waiting for admin approval."); return; }
    await setState(stateId, "chatting_admin", {});
    await sendMessage(chatId, "💬 You're now chatting with the admin. Just type your message. Send /cancel to stop.");
    return;
  }

  // /broadcast — super admin only
  if (text.startsWith("/broadcast") && user.is_admin) {
    await setState(ADMIN_ID, "awaiting_broadcast", {});
    await sendMessage(chatId, "📣 Send the broadcast text. It will go to <b>all bot users</b>. Send /cancel to abort.");
    return;
  }

  // /reply <tg_id> — super admin replies to a tenant
  if (text.startsWith("/reply") && user.is_admin) {
    const m = text.match(/^\/reply\s+(\d+)/);
    if (!m) { await sendMessage(chatId, "Usage: /reply 123456789"); return; }
    const targetId = Number(m[1]);
    await setState(ADMIN_ID, "replying_to_tenant", { target_id: targetId });
    await sendMessage(chatId, `💬 Now type your reply to <code>${targetId}</code>. Send /cancel to abort.`);
    return;
  }

  // /cancel — clear any active state
  if (text.startsWith("/cancel")) {
    await clearState(stateId);
    await sendMessage(chatId, "Cancelled.", { reply_markup: kbFor(user) });
    return;
  }
  if (text.startsWith("/users") && user.is_admin) {
    const { data: users } = await supabase.from("bot_users").select("*").order("created_at", { ascending: false }).limit(20);
    const lines = (users ?? []).map(u => {
      const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || `id ${u.telegram_id}`;
      return `${u.is_allowed ? "✅" : "🚫"} ${name} · 🪙${u.credits_remaining ?? 0} (<code>${u.telegram_id}</code>)`;
    });
    const keyboard = (users ?? []).slice(0, 10).filter(u => !u.is_admin).map(u => [
      {
        text: `${u.is_allowed ? "🚫 Deny" : "✅ Allow"} ${u.first_name ?? u.username ?? u.telegram_id}`,
        callback_data: `${u.is_allowed ? "deny" : "allow"}:${u.telegram_id}`,
      },
      { text: `+10 🪙`, callback_data: `addcred:${u.telegram_id}:10` },
      { text: `+100 🪙`, callback_data: `addcred:${u.telegram_id}:100` },
      { text: `✏️ Custom`, callback_data: `addcred:${u.telegram_id}:custom` },
    ]);
    await sendMessage(chatId, `<b>Recent users:</b>\n\n${lines.join("\n")}\n\nReply <code>/setcredits TG_ID NUMBER</code> to set an exact balance.`, { reply_markup: { inline_keyboard: keyboard } });
    return;
  }

  // /setcredits <telegram_id> <amount>  (admin only) — set exact value
  if (text.startsWith("/setcredits") && user.is_admin) {
    const m = text.match(/^\/setcredits\s+(\d+)\s+(\d+)/);
    if (!m) { await sendMessage(chatId, "Usage: /setcredits 123456789 50"); return; }
    const targetId = Number(m[1]);
    const credits = Number(m[2]);
    await supabase.from("bot_users").update({ credits_remaining: credits }).eq("telegram_id", targetId).eq("is_admin", false);
    await sendMessage(chatId, `🪙 Set <code>${targetId}</code> → ${credits} credits`);
    return;
  }

  // /addcredits <telegram_id> <amount>  (admin only) — add (or subtract with negative)
  if (text.startsWith("/addcredits") && user.is_admin) {
    const m = text.match(/^\/addcredits\s+(\d+)\s+(-?\d+)/);
    if (!m) { await sendMessage(chatId, "Usage: /addcredits 123456789 25  (use a negative number to subtract)"); return; }
    const targetId = Number(m[1]);
    const delta = Number(m[2]);
    const { data: row } = await supabase.from("bot_users").select("credits_remaining,is_admin").eq("telegram_id", targetId).maybeSingle();
    if (!row || row.is_admin) { await sendMessage(chatId, "Cannot adjust this user."); return; }
    const next = Math.max(0, (row.credits_remaining ?? 0) + delta);
    await supabase.from("bot_users").update({ credits_remaining: next }).eq("telegram_id", targetId);
    await sendMessage(chatId, `🪙 <code>${targetId}</code> → ${next} credits (${delta >= 0 ? "+" : ""}${delta})`);
    return;
  }

  // Awaiting custom credit amount from the inline-button flow
  if (user.is_admin) {
    const adminState = await getState(ADMIN_ID);
    if (adminState?.state === "awaiting_custom_credits") {
      const targetId = Number(adminState.data?.target_id);
      const delta = parseInt(text.trim(), 10);
      if (!targetId || isNaN(delta)) {
        await sendMessage(chatId, "⚠️ Send a whole number (e.g. <code>25</code> or <code>-10</code>). Or send /cancel.");
        if (text.trim() === "/cancel") await clearState(ADMIN_ID);
        return;
      }
      const { data: row } = await supabase.from("bot_users").select("credits_remaining,is_admin").eq("telegram_id", targetId).maybeSingle();
      if (!row || row.is_admin) {
        await sendMessage(chatId, "Cannot adjust this user.");
        await clearState(ADMIN_ID);
        return;
      }
      const next = Math.max(0, (row.credits_remaining ?? 0) + delta);
      await supabase.from("bot_users").update({ credits_remaining: next }).eq("telegram_id", targetId);
      await clearState(ADMIN_ID);
      await sendMessage(chatId, `🪙 <code>${targetId}</code> → <b>${next}</b> credits (${delta >= 0 ? "+" : ""}${delta})`, { reply_markup: kbFor(user) });
      return;
    }
  }

  if (!user.is_allowed) {
    await sendMessage(chatId, "⏳ Waiting for admin approval.");
    return;
  }

  // Handle awaiting_link state
  const state = await getState(stateId);

  // Awaiting field value (edit-listing flow)
  if (state?.state === "awaiting_field_value") {
    const lid = String(state.data?.listing_id ?? "");
    const field = String(state.data?.field ?? "");
    const raw = text.trim();
    const numeric = ["price","deposit","beds","sqft"];
    let value: any;
    if (raw === "-" || raw === "") value = null;
    else if (numeric.includes(field)) {
      const n = Number(raw);
      if (isNaN(n)) { await sendMessage(chatId, "⚠️ Send a number, or <code>-</code> to clear."); return; }
      value = field === "beds" || field === "sqft" ? Math.round(n) : n;
    } else value = raw;
    // Verify ownership
    const { data: l } = await supabase.from("listings").select("id, link_group_id").eq("id", lid).maybeSingle();
    const { data: grp } = l ? await supabase.from("link_groups").select("owner_telegram_id").eq("id", l.link_group_id).maybeSingle() : { data: null };
    if (!l || !grp || (Number(grp.owner_telegram_id) !== fromId && !user.is_admin)) {
      await sendMessage(chatId, "⚠️ You don't own that listing."); await clearState(stateId); return;
    }
    const { error } = await supabase.from("listings").update({ [field]: value }).eq("id", lid);
    if (error) { await sendMessage(chatId, `❌ ${error.message}`); return; }
    await clearState(stateId);
    await sendMessage(chatId, `✅ Updated <b>${field}</b>.`);
    await showFieldMenu(chatId, lid);
    return;
  }

  // Awaiting broadcast (super admin)
  if (user.is_admin && state?.state === "awaiting_broadcast") {
    await clearState(stateId);
    const { data: us } = await supabase.from("bot_users").select("telegram_id");
    const recipients = (us ?? []).map((u: any) => Number(u.telegram_id)).filter(Boolean);
    let sent = 0, failed = 0;
    for (const tid of recipients) {
      try { const r = await sendMessage(tid, `📣 <b>Announcement</b>\n\n${text}`); if (r?.ok) sent++; else failed++; }
      catch { failed++; }
      await new Promise(r => setTimeout(r, 35));
    }
    await supabase.from("broadcasts").insert({ body: text, sent_count: sent, failed_count: failed });
    await sendMessage(chatId, `📣 Broadcast sent — ✅ ${sent} · ❌ ${failed}`, { reply_markup: kbFor(user) });
    return;
  }

  // Super admin replying to a tenant
  if (user.is_admin && state?.state === "replying_to_tenant") {
    const targetId = Number(state.data?.target_id);
    await clearState(stateId);
    if (!targetId) { await sendMessage(chatId, "⚠️ Lost target."); return; }
    await supabase.from("admin_chat_messages").insert({
      tenant_telegram_id: targetId, sender: "super", body: text, read_by_super: true,
    });
    try { await sendMessage(targetId, `💬 <b>Message from admin</b>\n\n${text}`); } catch (_) {}
    await sendMessage(chatId, `✅ Sent to <code>${targetId}</code>.`, { reply_markup: kbFor(user) });
    return;
  }

  // Tenant in chat-with-admin mode
  if (!user.is_admin && state?.state === "chatting_admin") {
    await supabase.from("admin_chat_messages").insert({
      tenant_telegram_id: fromId, sender: "tenant", body: text, read_by_tenant: true,
    });
    if (ADMIN_ID) {
      const handle = user.username ? `@${user.username}` : (user.first_name || `id ${fromId}`);
      try {
        await sendMessage(ADMIN_ID, `💬 <b>${handle}</b> (<code>${fromId}</code>):\n\n${text}`, {
          reply_markup: { inline_keyboard: [[{ text: "↩️ Reply", callback_data: `chatreply:${fromId}` }]] },
        });
      } catch (_) {}
    }
    await sendMessage(chatId, "✅ Sent. Type another message or /cancel to stop.");
    return;
  }

  // Find listings flow — collect zip then show filter menu
  if (state?.state === "find_zip") {
    const zip = text.trim().match(/^\d{5}$/)?.[0];
    if (!zip) { await sendMessage(chatId, "⚠️ Send a 5-digit ZIP code, or /cancel."); return; }
    await setState(stateId, "find_filters", { zip, beds: "any", baths: "any", types: ["any"] });
    await sendFindMenu(chatId, { zip, beds: "any", baths: "any", types: ["any"] });
    return;
  }

  if (state?.state === "awaiting_link") {
    if (groupChat && !(await isTelegramChatAdmin(chatId, fromId))) {
      await sendMessage(chatId, "🔒 Only Telegram group admins can add listings to this group link.");
      return;
    }
    const urlMatch = text.match(/https?:\/\/[^\s]+zillow\.com[^\s]*/i);
    if (!urlMatch) {
      await sendMessage(chatId, "⚠️ Please send a valid Zillow URL (must include zillow.com).");
      return;
    }

    // Credit check (admins are unlimited)
    if (!user.is_admin) {
      const { data: fresh } = await supabase.from("bot_users").select("credits_remaining").eq("telegram_id", fromId).maybeSingle();
      const credits = fresh?.credits_remaining ?? 0;
      if (credits <= 0) {
        await sendMessage(chatId, "🪙 You're out of credits. Please contact the admin to top up your balance, then try again.");
        return;
      }
      await supabase.from("bot_users").update({ credits_remaining: credits - 1 }).eq("telegram_id", fromId);
    }

    const groupId = state.data.group_id as string;
    const listing = await processListingLink(chatId, urlMatch[0], groupId, user);
    if (listing) {
      if (!user.is_admin) {
        const { data: after } = await supabase.from("bot_users").select("credits_remaining").eq("telegram_id", fromId).maybeSingle();
        const left = after?.credits_remaining ?? 0;
        await sendMessage(chatId, `🪙 ${left} credit${left === 1 ? "" : "s"} remaining.`);
      }
      await setState(stateId, "post_listing", { group_id: groupId });
      await sendMessage(chatId, "Add another listing to the same shareable link?", { reply_markup: buildAddMoreKeyboard() });
    }
    return;
  }

  // Default: detect a Zillow URL & auto-start a fresh group
  const urlMatch = text.match(/https?:\/\/[^\s]+zillow\.com[^\s]*/i);
  if (urlMatch) {
    await startNewGroup();
    // Fall through hint — user can resend the URL now that state is awaiting_link
    await sendMessage(chatId, "Resend the Zillow URL above so I can save it. (Tip: tap 🏠 first next time.)");
    return;
  }

  await sendMessage(chatId, "Tap a button below to get started.", { reply_markup: kbFor(user) });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Webhook secret check
  if (WEBHOOK_SECRET) {
    const headerSecret = req.headers.get("x-telegram-bot-api-secret-token");
    if (headerSecret !== WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
  }

  try {
    const update = await req.json();
    // Run async, return 200 fast (Telegram retries on slow responses)
    handleUpdate(update, req).catch(e => console.error("handleUpdate", e));
    return new Response("ok", { headers: corsHeaders });
  } catch (e) {
    console.error("webhook error", e);
    return new Response("error", { status: 500, headers: corsHeaders });
  }
});
