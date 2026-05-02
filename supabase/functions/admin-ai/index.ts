// AI admin assistant — uses tool calling to perform safe edits to listings & settings.
// Available actions: update price/deposit/bio/address/description, hide/show photos,
// update default bio, update theme colors.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const tools = [
  {
    type: "function",
    function: {
      name: "update_listing",
      description: "Update fields on a listing. Only pass fields you want to change.",
      parameters: {
        type: "object",
        properties: {
          listing_id: { type: "string" },
          price: { type: "number" },
          deposit: { type: "number" },
          beds: { type: "number" },
          baths: { type: "number" },
          address: { type: "string" },
          bio: { type: "string" },
          description: { type: "string" },
        },
        required: ["listing_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_photo",
      description: "Hide or show a photo on a listing.",
      parameters: {
        type: "object",
        properties: {
          photo_id: { type: "string" },
          is_hidden: { type: "boolean" },
        },
        required: ["photo_id", "is_hidden"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_setting",
      description: "Update a global setting. Keys: default_bio (string), apply_url (string), theme (object with primary, accent hex strings).",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", enum: ["default_bio", "apply_url", "theme"] },
          value: {},
        },
        required: ["key", "value"],
      },
    },
  },
];

async function execTool(name: string, args: any) {
  if (name === "update_listing") {
    const { listing_id, ...rest } = args;
    const update: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined && v !== null && v !== "") update[k] = v;
    }
    if (Object.keys(update).length === 0) return { ok: false, error: "no fields to update" };
    const { error } = await supabase.from("listings").update(update).eq("id", listing_id);
    return error ? { ok: false, error: error.message } : { ok: true, updated: update };
  }
  if (name === "toggle_photo") {
    const { error } = await supabase.from("listing_photos").update({ is_hidden: args.is_hidden }).eq("id", args.photo_id);
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  if (name === "update_setting") {
    const { error } = await supabase.from("app_settings").upsert({ key: args.key, value: args.value, updated_at: new Date().toISOString() });
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  return { ok: false, error: "unknown tool" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { messages, context } = await req.json();

    const systemPrompt = `You are an admin assistant for a private landlord rental listing app.
You can edit listings, photos, and global settings via tools.
Be concise. Confirm what you changed. Never invent listing or photo IDs — only use IDs from the provided context.

Current admin context:
${JSON.stringify(context).slice(0, 6000)}`;

    let convo = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    // Allow up to 4 tool-calling rounds
    for (let round = 0; round < 4; round++) {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "google/gemini-3-flash-preview", messages: convo, tools, tool_choice: "auto" }),
      });

      if (res.status === 429) return new Response(JSON.stringify({ error: "Rate limited, try again in a moment." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (res.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted. Top up in Workspace > Usage." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (!res.ok) return new Response(JSON.stringify({ error: `AI gateway error ${res.status}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const data = await res.json();
      const choice = data.choices?.[0];
      const msg = choice?.message;
      if (!msg) return new Response(JSON.stringify({ error: "no response" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      convo.push(msg);

      const toolCalls = msg.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        return new Response(JSON.stringify({ reply: msg.content ?? "" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      for (const tc of toolCalls) {
        const args = JSON.parse(tc.function.arguments || "{}");
        const result = await execTool(tc.function.name, args);
        convo.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
      }
    }

    return new Response(JSON.stringify({ reply: "Reached max tool rounds." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
