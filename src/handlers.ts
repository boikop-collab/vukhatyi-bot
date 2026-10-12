import { Env, LEAGUE, clip, esc, isAdmin, kyiv, nowIso, plural } from "./util";
import { View, answer, edit, send } from "./tg";
import { ADMIN_HELP, HELP, PRIVACY, RULES, WELCOME } from "./texts";
import {
  NO_MATCHES, OtherPred, Row, TeamRow, activeMatchday, championView, customAway, customHome,
  editList, matchCard, othersList, othersMatch, tableView, tourRows, tourView,
} from "./views";
import { broadcast, runCron, scoreMatch, standings, syncFixtures } from "./jobs";
import { HIT_ICON, HIT_LABEL, Hit } from "./scoring";

interface TgUser { id: number; first_name?: string; last_name?: string; username?: string }
interface TgMessage { message_id: number; chat: { id: number; type: string }; from?: TgUser; text?: string }
interface TgCallback { id: string; from: TgUser; message?: TgMessage; data?: string }
export interface TgUpdate { message?: TgMessage; callback_query?: TgCallback }

function defaultName(u: TgUser): string {
  const first = (u.first_name ?? "").trim() || u.username || `Гравець ${String(u.id).slice(-4)}`;
  const last = (u.last_name ?? "").trim();
  return clip(last ? `${first} ${last[0]}.` : first, 20);
}

/** Зареєструвати учасника, якщо його ще немає; повернути імʼя для таблиці. */
async function ensureUser(env: Env, u: TgUser): Promise<string> {
  const row = await env.DB.prepare(
    `INSERT INTO users (tg_id, display_name, username, joined_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(tg_id) DO UPDATE SET username = excluded.username, is_active = 1
     RETURNING display_name`,
  ).bind(u.id, defaultName(u), u.username ?? null, nowIso()).first<{ display_name: string }>();
  return row?.display_name ?? defaultName(u);
}

async function mdBounds(env: Env): Promise<[number, number]> {
  const r = await env.DB.prepare("SELECT MIN(matchday) lo, MAX(matchday) hi FROM matches WHERE stage = ?1")
    .bind(LEAGUE).first<{ lo: number | null; hi: number | null }>();
  return [r?.lo ?? 1, r?.hi ?? 1];
}

async function tourScreen(env: Env, userId: number, md: number): Promise<View> {
  if (!md) {
    const active = await activeMatchday(env);
    if (active == null) return NO_MATCHES;
    md = active;
  }
  const [rows, [lo, hi]] = await Promise.all([tourRows(env, userId, md), mdBounds(env)]);
  return tourView(rows, md, nowIso(), lo, hi);
}

async function tableScreen(env: Env, userId: number, md: number | null): Promise<View> {
  const [st, active] = await Promise.all([standings(env, md), activeMatchday(env)]);
  return tableView(st, userId, md == null ? "Загальна таблиця" : `Таблиця туру ${md}`, md, active);
}

async function meScreen(env: Env, userId: number): Promise<View> {
  const [st, hits] = await Promise.all([
    standings(env, null),
    env.DB.prepare("SELECT hit, COUNT(*) n FROM predictions WHERE user_id = ?1 AND hit IS NOT NULL GROUP BY hit")
      .bind(userId).all<{ hit: Hit; n: number }>(),
  ]);
  const me = st.find((s) => s.tg_id === userId);
  if (!me) return { text: "Спершу натисни /start." };
  const counts = new Map(hits.results.map((h) => [h.hit, h.n]));
  const order: Hit[] = ["exact", "diff", "one", "result", "miss"];
  const lines = order.map((h) => `${HIT_ICON[h]} ${counts.get(h) ?? 0} — ${HIT_LABEL[h]}`);
  return {
    text: `<b>${esc(me.display_name)}</b>\n${me.place}-ше місце з ${st.length} · <b>${me.total}</b> ${plural(me.total, "бал", "бали", "балів")}\n\n${lines.join("\n")}`,
    kb: [[{ text: "Мій тур", callback_data: "t:0" }, { text: "Таблиця", callback_data: "tb:all" }]],
  };
}

async function championScreen(env: Env, userId: number): Promise<View> {
  const [teams, pick] = await Promise.all([
    env.DB.prepare(
      `SELECT DISTINCT t.id, t.name, t.name_uk FROM teams t JOIN matches m ON m.home_id = t.id OR m.away_id = t.id
        ORDER BY COALESCE(t.name_uk, t.name)`,
    ).all<TeamRow>(),
    env.DB.prepare(
      "SELECT t.id, t.name, t.name_uk FROM champion_picks c JOIN teams t ON t.id = c.team_id WHERE c.user_id = ?1",
    ).bind(userId).first<TeamRow>(),
  ]);
  return championView(teams.results, pick, nowIso() < env.CHAMPION_DEADLINE, env.CHAMPION_DEADLINE);
}

// ───────────── Команди ─────────────

async function onMessage(env: Env, msg: TgMessage) {
  const from = msg.from;
  if (!from || msg.chat.type !== "private" || !msg.text) return;
  const chat = msg.chat.id;
  const [rawCmd, ...rest] = msg.text.trim().split(/\s+/);
  const cmd = rawCmd.split("@")[0].toLowerCase();
  const arg = msg.text.trim().slice(rawCmd.length).trim();
  if (!cmd.startsWith("/")) {
    await send(env, chat, { text: "Я розумію лише команди й кнопки. Спробуй /tour або /help." });
    return;
  }
  const name = await ensureUser(env, from);

  switch (cmd) {
    case "/start":
      await send(env, chat, {
        text: WELCOME(esc(name)),
        kb: [[{ text: "Зробити прогнози", callback_data: "go:0", style: "primary" }],
          [{ text: "Правила", callback_data: "rules" }, { text: "Чемпіон сезону", callback_data: "champ" }]],
      });
      return;
    case "/tour": case "/predict": case "/matches":
      await send(env, chat, await tourScreen(env, from.id, 0)); return;
    case "/table": case "/leaderboard":
      await send(env, chat, await tableScreen(env, from.id, null)); return;
    case "/me": case "/mystats":
      await send(env, chat, await meScreen(env, from.id)); return;
    case "/champion":
      await send(env, chat, await championScreen(env, from.id)); return;
    case "/rules":
      await send(env, chat, { text: RULES }); return;
    case "/privacy":
      await send(env, chat, { text: PRIVACY }); return;
    case "/help":
      await send(env, chat, { text: HELP + (isAdmin(env, from.id) ? "\n\n/admin — команди адміна" : "") }); return;
    case "/name": {
      const clean = arg.replace(/[\u0000-\u001f<>]/g, "").trim();
      if (clean.length < 2 || clean.length > 20) {
        await send(env, chat, { text: "Напиши так: <code>/name Нове імʼя</code> — від 2 до 20 символів." });
        return;
      }
      await env.DB.prepare("UPDATE users SET display_name = ?2 WHERE tg_id = ?1").bind(from.id, clean).run();
      await send(env, chat, { text: `Готово. У таблиці ти тепер <b>${esc(clean)}</b>.` });
      return;
    }
    case "/deleteme":
      await send(env, chat, {
        text: "Видалити твій профіль і всі прогнози? Повернути їх буде неможливо.",
        kb: [[{ text: "Так, видалити", callback_data: "del:yes", style: "danger" }, { text: "Скасувати", callback_data: "del:no" }]],
      });
      return;
  }

  if (isAdmin(env, from.id)) {
    const handled = await onAdmin(env, chat, from.id, cmd, rest, arg);
    if (handled) return;
  }
  await send(env, chat, { text: "Не знаю такої команди. Дивись /help." });
}

async function onAdmin(env: Env, chat: number, adminId: number, cmd: string, args: string[], arg: string): Promise<boolean> {
  const audit = (action: string, details: string) =>
    env.DB.prepare("INSERT INTO audit_log (at, admin_id, action, details) VALUES (?1, ?2, ?3, ?4)")
      .bind(nowIso(), adminId, action, details).run();

  switch (cmd) {
    case "/admin":
      await send(env, chat, { text: ADMIN_HELP }); return true;
    case "/sync":
      await send(env, chat, { text: `Календар: ${esc(await syncFixtures(env))}` }); return true;
    case "/cron":
      await send(env, chat, { text: `<pre>${esc(await runCron(env))}</pre>` }); return true;
    case "/users": {
      const u = await env.DB.prepare(
        `SELECT u.tg_id, u.display_name, u.username, u.is_active, COUNT(p.match_id) n
           FROM users u LEFT JOIN predictions p ON p.user_id = u.tg_id GROUP BY u.tg_id ORDER BY u.joined_at`,
      ).all<{ tg_id: number; display_name: string; username: string | null; is_active: number; n: number }>();
      const lines = u.results.map((x) =>
        `${x.is_active ? " " : "×"} ${clip(x.display_name, 14).padEnd(14)} ${String(x.n).padStart(3)} ${x.username ? "@" + x.username : x.tg_id}`);
      await send(env, chat, { text: `Учасників: ${u.results.length}\n<pre>${esc(lines.join("\n").slice(0, 3500))}</pre>` });
      return true;
    }
    case "/ids": {
      const md = await activeMatchday(env);
      if (md == null) { await send(env, chat, NO_MATCHES); return true; }
      const rows = await tourRows(env, adminId, md);
      const lines = rows.map((r) => {
        const sc = r.is_finished ? `${r.home_score}:${r.away_score}` : r.status.slice(0, 5);
        return `${r.id} ${clip(`${r.hu ?? r.hn}–${r.au ?? r.an}`, 18).padEnd(18)} ${sc}`;
      });
      await send(env, chat, { text: `Тур ${md}\n<pre>${esc(lines.join("\n"))}</pre>` });
      return true;
    }
    case "/teams": {
      const t = await env.DB.prepare("SELECT id, name, name_uk FROM teams ORDER BY name").all<TeamRow>();
      const lines = t.results.map((x) => `${String(x.id).padEnd(5)} ${clip(x.name, 14).padEnd(14)} ${x.name_uk ?? "—"}`);
      await send(env, chat, { text: `<pre>${esc(lines.join("\n").slice(0, 3800))}</pre>` });
      return true;
    }
    case "/team": {
      const id = Number(args[0]);
      const ukr = args.slice(1).join(" ").replace(/[<>]/g, "").trim();
      if (!Number.isInteger(id) || !ukr) {
        await send(env, chat, { text: "Формат: <code>/team 57 Арсенал</code>" }); return true;
      }
      const res = await env.DB.prepare("UPDATE teams SET name_uk = ?2 WHERE id = ?1").bind(id, ukr).run();
      await send(env, chat, { text: res.meta.changes ? `Готово: ${esc(ukr)}` : "Команди з таким id немає. Дивись /teams." });
      return true;
    }
    case "/result": {
      // приймає «/result 123 2 1», «/result #123 2:1», «/result 123 2-1»
      const nums = arg.replace(/[#:\-–]/g, " ").trim().split(/\s+/).map(Number);
      if (nums.length !== 3 || nums.some((n) => !Number.isInteger(n) || n < 0) || nums[1] > 30 || nums[2] > 30) {
        await send(env, chat, { text: "Формат: <code>/result 123456 2 1</code> (id матчу з /ids, рахунок за 90 хв)" });
        return true;
      }
      const m = await env.DB.prepare(
        `SELECT m.stage, h.name hn, h.name_uk hu, a.name an, a.name_uk au
           FROM matches m JOIN teams h ON h.id = m.home_id JOIN teams a ON a.id = m.away_id WHERE m.id = ?1`,
      ).bind(nums[0]).first<{ stage: string; hn: string; hu: string | null; an: string; au: string | null }>();
      if (!m) { await send(env, chat, { text: "Матчу з таким id немає. Дивись /ids." }); return true; }
      await scoreMatch(env, nums[0], m.stage, nums[1], nums[2], "manual");
      await audit("result", `${nums[0]} ${nums[1]}:${nums[2]}`);
      await send(env, chat, { text: `Записано: <b>${esc(m.hu ?? m.hn)} ${nums[1]}:${nums[2]} ${esc(m.au ?? m.an)}</b>. Бали перераховано, API цей результат не змінить.` });
      return true;
    }
    case "/say": {
      if (!arg) { await send(env, chat, { text: "Формат: <code>/say текст повідомлення</code>" }); return true; }
      const n = await broadcast(env, esc(arg));
      await audit("say", arg.slice(0, 500));
      await send(env, chat, { text: `У черзі для ${n} учасників. Надішлеться протягом кількох хвилин.` });
      return true;
    }
  }
  return false;
}

// ───────────── Кнопки ─────────────

async function onCallback(env: Env, cb: TgCallback) {
  const msg = cb.message;
  const data = cb.data ?? "";
  if (!msg) { await answer(env, cb.id); return; }
  const chat = msg.chat.id, mid = msg.message_id, uid = cb.from.id;
  const [op, ...a] = data.split(":");
  const n = a.map(Number);
  const now = nowIso();
  const show = async (v: View, toast?: string, alert = false) => {
    await Promise.all([edit(env, chat, mid, v), answer(env, cb.id, toast, alert)]);
  };
  await ensureUser(env, cb.from);

  switch (op) {
    case "t": return show(await tourScreen(env, uid, n[0] || 0));
    case "tb": return show(await tableScreen(env, uid, a[0] === "all" ? null : n[0]));
    case "rules": await send(env, chat, { text: RULES }); return void (await answer(env, cb.id));
    case "champ": await send(env, chat, await championScreen(env, uid)); return void (await answer(env, cb.id));

    case "w": {
      if (now >= env.CHAMPION_DEADLINE) return show(await championScreen(env, uid), "Вибір уже закрито 🔒", true);
      const team = await env.DB.prepare("SELECT id FROM teams WHERE id = ?1").bind(n[0]).first();
      if (!team) return void (await answer(env, cb.id));
      await env.DB.prepare(
        `INSERT INTO champion_picks (user_id, team_id, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id) DO UPDATE SET team_id = excluded.team_id, updated_at = excluded.updated_at`,
      ).bind(uid, n[0], now).run();
      return show(await championScreen(env, uid), "Збережено");
    }

    case "del": {
      if (a[0] !== "yes") return show({ text: "Гаразд, нічого не видаляю." });
      await env.DB.batch([
        env.DB.prepare("DELETE FROM predictions WHERE user_id = ?1").bind(uid),
        env.DB.prepare("DELETE FROM tie_predictions WHERE user_id = ?1").bind(uid),
        env.DB.prepare("DELETE FROM champion_picks WHERE user_id = ?1").bind(uid),
        env.DB.prepare("DELETE FROM outbox WHERE tg_id = ?1").bind(uid),
        env.DB.prepare("DELETE FROM users WHERE tg_id = ?1").bind(uid),
      ]);
      // після ensureUser вище рядок щойно видалено остаточно; новий зʼявиться лише після /start
      return show({ text: "Профіль і прогнози видалено. Якщо захочеш повернутись — /start." });
    }
  }

  // Далі — дії в межах туру: перший аргумент завжди номер туру (0 = поточний).
  let md = n[0];
  if (!md) {
    const active = await activeMatchday(env);
    if (active == null) return show(NO_MATCHES);
    md = active;
  }
  const [rows, [lo, hi]] = await Promise.all([tourRows(env, uid, md), mdBounds(env)]);
  const tour = () => tourView(rows, md, now, lo, hi);
  const open = (r: Row) => r.kickoff > now && !r.is_finished;
  const match = rows.find((r) => r.id === n[1]);
  const nextAfter = (id: number | null, wrap: boolean): Row | undefined => {
    const i = id == null ? -1 : rows.findIndex((r) => r.id === id);
    const free = (r: Row) => open(r) && r.ph == null;
    return rows.slice(i + 1).find(free) ?? (wrap ? rows.slice(0, Math.max(i, 0)).find(free) : undefined);
  };

  switch (op) {
    case "go": {
      const next = nextAfter(null, false);
      return next ? show(matchCard(rows, next)) : show(tour(), "На цей тур усе заповнено");
    }
    case "ed": return show(editList(rows, md, now));
    case "o": return show(othersList(rows, md, now));
    case "om": {
      if (!match || match.kickoff > now) return show(tour(), "Прогнози відкриються після початку матчу", true);
      const preds = await env.DB.prepare(
        `SELECT u.display_name, p.home, p.away, p.points, p.hit FROM predictions p
           JOIN users u ON u.tg_id = p.user_id WHERE p.match_id = ?1
          ORDER BY COALESCE(p.points, 0) DESC, u.display_name`,
      ).bind(match.id).all<OtherPred>();
      return show(othersMatch(match, preds.results));
    }
  }

  if (!match) return show(tour());
  if (!open(match)) return show(tour(), "Прийом на цей матч закрито 🔒", true);

  switch (op) {
    case "e": return show(matchCard(rows, match));
    case "c": return show(customHome(rows, match));
    case "g": return show(customAway(rows, match, n[2]));
    case "sk": {
      const next = nextAfter(match.id, false);
      return next ? show(matchCard(rows, next)) : show(tour());
    }
    case "p": {
      const h = n[2], aw = n[3];
      if (![h, aw].every((x) => Number.isInteger(x) && x >= 0 && x <= 20)) return void (await answer(env, cb.id));
      // Дедлайн перевіряється ще раз у самому запиті: прогноз не запишеться, якщо матч уже почався.
      const res = await env.DB.prepare(
        `INSERT INTO predictions (user_id, match_id, home, away, updated_at)
         SELECT ?1, id, ?3, ?4, ?5 FROM matches WHERE id = ?2 AND kickoff > ?5 AND is_finished = 0
         ON CONFLICT(user_id, match_id) DO UPDATE SET home = excluded.home, away = excluded.away,
           updated_at = excluded.updated_at, points = NULL, hit = NULL`,
      ).bind(uid, match.id, h, aw, now).run();
      if (!res.meta.changes) return show(tour(), "Прийом на цей матч закрито 🔒", true);
      match.ph = h; match.pa = aw;
      const saved = `Збережено: ${match.hu ?? match.hn} ${h}:${aw} ${match.au ?? match.an}`;
      const next = nextAfter(match.id, true);
      return next ? show(matchCard(rows, next, saved), "Збережено") : show(tour(), "Збережено. Тур заповнено!");
    }
  }
  await answer(env, cb.id);
}

export async function handleUpdate(env: Env, update: TgUpdate) {
  if (update.message) await onMessage(env, update.message);
  else if (update.callback_query) await onCallback(env, update.callback_query);
}
