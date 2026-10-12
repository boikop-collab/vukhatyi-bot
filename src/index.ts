import type { Env } from "./util";
import { TgUpdate, handleUpdate } from "./handlers";
import { runCron } from "./jobs";
import { tg } from "./tg";
import { COMMANDS } from "./texts";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // Вебхук Telegram. Секретний заголовок Telegram додає сам — чужі запити відкидаємо.
    if (req.method === "POST" && url.pathname === "/tg") {
      if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      const update = (await req.json()) as TgUpdate;
      // Завжди відповідаємо 200: інакше Telegram повторюватиме той самий апдейт.
      ctx.waitUntil(handleUpdate(env, update).catch((e) => console.error("update failed", e)));
      return new Response("ok");
    }

    // Одноразове налаштування після деплою: вебхук і меню команд.
    if (req.method === "POST" && url.pathname === "/setup") {
      if (req.headers.get("X-Setup-Secret") !== env.WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      const hook = await tg(env, "setWebhook", {
        url: `${url.origin}/tg`,
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
      });
      const cmds = await tg(env, "setMyCommands", { commands: COMMANDS });
      return Response.json({ webhook: hook, commands: cmds });
    }

    return new Response("Вухатий працює.");
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCron(env));
  },
} satisfies ExportedHandler<Env>;
