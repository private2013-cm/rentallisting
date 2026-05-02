const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const API = `https://api.telegram.org/bot${TOKEN}`;

export async function tg(method: string, body: Record<string, unknown>) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    console.error(`tg ${method} failed`, res.status, data);
  }
  return data;
}

export const sendMessage = (chat_id: number, text: string, extra: Record<string, unknown> = {}) =>
  tg("sendMessage", { chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });

export const sendPhoto = (chat_id: number, photo: string, caption?: string) =>
  tg("sendPhoto", { chat_id, photo, caption, parse_mode: "HTML" });

export const sendMediaGroup = (chat_id: number, photos: string[]) => {
  // Telegram allows up to 10 per media group
  const media = photos.slice(0, 10).map((p, i) => ({
    type: "photo",
    media: p,
    ...(i === 0 ? {} : {}),
  }));
  return tg("sendMediaGroup", { chat_id, media });
};

export const answerCallback = (callback_query_id: string, text?: string) =>
  tg("answerCallbackQuery", { callback_query_id, text });

export const editMessageText = (chat_id: number, message_id: number, text: string, extra: Record<string, unknown> = {}) =>
  tg("editMessageText", { chat_id, message_id, text, parse_mode: "HTML", ...extra });
