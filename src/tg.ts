import type { Env } from "./util";

export interface Button { text: string; callback_data?: string; url?: string; style?: "primary" | "success" | "danger" }
export type Keyboard = Button[][];
export interface View { text: string; kb?: Keyboard }

export interface TgResult { ok: boolean; error_code?: number; description?: string; result?: unknown }

export async function tg(env: Env, method: string, payload: unknown): Promise<TgResult> {
  const base = env.TG_API_BASE ?? "https://api.telegram.org";
  try {
    const resp = await fetch(`${base}/bot${env.BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await resp.json()) as TgResult;
    if (!data.ok) console.warn(`tg ${method} failed: ${data.error_code} ${data.description}`);
    return data;
  } catch (e) {
    console.error(`tg ${method} threw`, e);
    return { ok: false, description: String(e) };
  }
}

const markup = (kb?: Keyboard) => (kb && kb.length ? { inline_keyboard: kb } : undefined);

export const send = (env: Env, chatId: number, v: View, silent = false) =>
  tg(env, "sendMessage", {
    chat_id: chatId, text: v.text, parse_mode: "HTML",
    reply_markup: markup(v.kb), disable_notification: silent,
    link_preview_options: { is_disabled: true },
  });

export const edit = (env: Env, chatId: number, messageId: number, v: View) =>
  tg(env, "editMessageText", {
    chat_id: chatId, message_id: messageId, text: v.text, parse_mode: "HTML",
    reply_markup: markup(v.kb), link_preview_options: { is_disabled: true },
  });

export const answer = (env: Env, callbackId: string, text?: string, alert = false) =>
  tg(env, "answerCallbackQuery", { callback_query_id: callbackId, text, show_alert: alert });
