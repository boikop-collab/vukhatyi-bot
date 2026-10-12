import { Env, LEAGUE, addHours, clip, esc, kyiv, nowIso, plural } from "./util";
import { fdMatches, regulationScore } from "./football";
import { HIT_ICON, Hit, hitType, pointsFor } from "./scoring";
import { ukName } from "./teamsUk";
import { Keyboard, tg } from "./tg";
import { rank, tableLines } from "./views";

// Ліміти безкоштовного тарифу Workers: до 50 запитів до D1 і до 50 зовнішніх запитів за один запуск.
// Тому кожна задача робить обмежену кількість роботи, решта — у наступному запуску (cron кожні 2 хв).
const MAX_SENDS_PER_RUN = 25;
const MAX_MATCHES_SCORED_PER_RUN = 6;

async function getMeta(env: Env): Promise<Map<string, string>> {
  const res = await env.DB.prepare("SELECT key, value FROM meta").all<{ key: string; value: string }>();
  return new Map(res.results.map((r) => [r.key, r.value]));
}
const setMeta = (env: Env, key: string, value: string) =>
  env.DB.prepare("INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value);

function enqueue(env: Env, tgId: number, text: string, kb: Keyboard | null, silent: boolean, now: string) {
  return env.DB.prepare(
    "INSERT INTO outbox (tg_id, text, markup, silent, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  ).bind(tgId, text, kb ? JSON.stringify({ inline_keyboard: kb }) : null, silent ? 1 : 0, now);
}

/** Груповий чат турніру (адмін вмикає командою /here у групі). Кнопка веде в особистий чат із ботом. */
export function groupChat(meta: Map<string, string>): { id: number; open: Keyboard } | null {
  const id = Number(meta.get("group_id"));
  const username = meta.get("bot_username");
  if (!id || !username) return null;
  return { id, open: [[{ text: "Зробити прогнози", url: `https://t.me/${username}?start=tour` }]] };
}

/** Поставити в чергу повідомлення всім активним учасникам (розсилка адміна). */
export async function broadcast(env: Env, text: string): Promise<number> {
  const users = await env.DB.prepare("SELECT tg_id FROM users WHERE is_active = 1").all<{ tg_id: number }>();
  const now = nowIso();
  if (users.results.length) await env.DB.batch(users.results.map((u) => enqueue(env, u.tg_id, text, null, false, now)));
  return users.results.length;
}

// ───────────── Календар ─────────────

/** Завантажити/оновити матчі лігового етапу. Рахунки тут не чіпаємо. */
export async function syncFixtures(env: Env): Promise<string> {
  const api = await fdMatches(env, { season: env.SEASON, stage: LEAGUE });
  if (api === null) return "API недоступний";
  const startMd = Number(env.START_MATCHDAY) || 1;
  const stmts: D1PreparedStatement[] = [];
  const seenTeams = new Set<number>();
  let count = 0;
  for (const m of api) {
    if (m.stage !== LEAGUE || m.matchday == null || m.matchday < startMd) continue;
    if (m.homeTeam?.id == null || m.awayTeam?.id == null || !m.utcDate) continue;
    for (const t of [m.homeTeam, m.awayTeam]) {
      if (seenTeams.has(t.id!)) continue;
      seenTeams.add(t.id!);
      const name = t.shortName ?? t.name ?? `#${t.id}`;
      stmts.push(env.DB.prepare(
        `INSERT INTO teams (id, name, tla, name_uk) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, tla = excluded.tla,
           name_uk = COALESCE(teams.name_uk, excluded.name_uk)`,
      ).bind(t.id, name, t.tla ?? null, ukName(t.shortName ?? t.name)));
    }
    const kickoff = m.utcDate.slice(0, 19) + "Z";
    stmts.push(env.DB.prepare(
      `INSERT INTO matches (id, stage, matchday, kickoff, kyiv_date, home_id, away_id, status)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(id) DO UPDATE SET matchday = excluded.matchday, kickoff = excluded.kickoff,
         kyiv_date = excluded.kyiv_date, home_id = excluded.home_id, away_id = excluded.away_id,
         status = CASE WHEN matches.is_finished = 1 THEN matches.status ELSE excluded.status END`,
    ).bind(m.id, m.stage, m.matchday, kickoff, kyiv(kickoff).date, m.homeTeam.id, m.awayTeam.id, m.status));
    count++;
  }
  stmts.push(setMeta(env, "fixtures_synced_at", nowIso()));
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  return `матчів: ${count}, команд: ${seenTeams.size}`;
}

// ───────────── Результати ─────────────

/** Записати результат матчу й перерахувати бали всіх прогнозів на нього. */
export async function scoreMatch(env: Env, matchId: number, stage: string, h: number, a: number, source: "auto" | "manual") {
  const preds = await env.DB.prepare("SELECT user_id, home, away FROM predictions WHERE match_id = ?1")
    .bind(matchId).all<{ user_id: number; home: number; away: number }>();
  const stmts = [
    env.DB.prepare(
      "UPDATE matches SET home_score = ?2, away_score = ?3, is_finished = 1, status = 'FINISHED', result_source = ?4 WHERE id = ?1",
    ).bind(matchId, h, a, source),
    ...preds.results.map((p) => {
      const hit = hitType(p.home, p.away, h, a);
      return env.DB.prepare("UPDATE predictions SET points = ?3, hit = ?4 WHERE user_id = ?1 AND match_id = ?2")
        .bind(p.user_id, matchId, pointsFor(hit, stage), hit);
    }),
  ];
  await env.DB.batch(stmts);
}

/** Чи є зараз матчі, що вже почались і ще не зараховані (або щойно зараховані — для звірки). */
async function hasLiveWindow(env: Env, now: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) n FROM matches
      WHERE kickoff <= ?1 AND kickoff > ?2 AND status NOT IN ('POSTPONED', 'CANCELLED')
        AND (is_finished = 0 OR kickoff > ?3)`,
  ).bind(now, addHours(now, -36), addHours(now, -6)).first<{ n: number }>();
  return (row?.n ?? 0) > 0;
}

export async function syncResults(env: Env, now: string): Promise<number> {
  if (!(await hasLiveWindow(env, now))) return 0;
  const api = await fdMatches(env, { dateFrom: addHours(now, -36).slice(0, 10), dateTo: now.slice(0, 10) });
  if (!api || !api.length) return 0;

  const ids = api.map((m) => m.id);
  const db = await env.DB.prepare(
    `SELECT id, stage, status, is_finished, home_score, away_score, result_source
       FROM matches WHERE id IN (${ids.map(() => "?").join(",")})`,
  ).bind(...ids).all<{ id: number; stage: string; status: string; is_finished: number; home_score: number | null; away_score: number | null; result_source: string | null }>();
  const byId = new Map(db.results.map((m) => [m.id, m]));

  let scored = 0;
  const statusUpdates: D1PreparedStatement[] = [];
  for (const m of api) {
    const cur = byId.get(m.id);
    if (!cur) continue;
    if (cur.result_source === "manual") continue; // рішення адміна остаточне
    if (m.status !== "FINISHED") {
      if (!cur.is_finished && cur.status !== m.status) {
        statusUpdates.push(env.DB.prepare("UPDATE matches SET status = ?2 WHERE id = ?1").bind(m.id, m.status));
      }
      continue;
    }
    const reg = regulationScore(m.score);
    if (!reg) continue; // овертайм без рахунку за 90 хв — вносить адмін
    const changed = !cur.is_finished || cur.home_score !== reg[0] || cur.away_score !== reg[1];
    if (!changed || scored >= MAX_MATCHES_SCORED_PER_RUN) continue;
    await scoreMatch(env, m.id, cur.stage, reg[0], reg[1], "auto");
    scored++;
  }
  if (statusUpdates.length) await env.DB.batch(statusUpdates);
  return scored;
}

// ───────────── Нагадування: одне на ігровий день ─────────────

const REMIND_HOURS_BEFORE = 2;

export async function enqueueReminders(env: Env, now: string, meta: Map<string, string>): Promise<number> {
  const today = kyiv(now).date;
  if (meta.has(`remind:${today}`)) return 0;
  const first = await env.DB.prepare(
    "SELECT MIN(kickoff) k, COUNT(*) n FROM matches WHERE kyiv_date = ?1 AND status NOT IN ('POSTPONED', 'CANCELLED')",
  ).bind(today).first<{ k: string | null; n: number }>();
  if (!first?.k || now >= first.k || now < addHours(first.k, -REMIND_HOURS_BEFORE)) return 0;

  const missing = await env.DB.prepare(
    `SELECT u.tg_id, COUNT(m.id) n, MIN(m.matchday) md
       FROM users u
       JOIN matches m ON m.kyiv_date = ?1 AND m.kickoff > ?2 AND m.status NOT IN ('POSTPONED', 'CANCELLED')
       LEFT JOIN predictions p ON p.user_id = u.tg_id AND p.match_id = m.id
      WHERE u.is_active = 1 AND p.user_id IS NULL
      GROUP BY u.tg_id`,
  ).bind(today, now).all<{ tg_id: number; n: number; md: number }>();

  const time = kyiv(first.k).time;
  const stmts = missing.results.map((u) => enqueue(env, u.tg_id,
    `⏰ Сьогодні ${first.n} ${plural(first.n, "матч", "матчі", "матчів")}, перший о <b>${time}</b>.\n` +
    `У тебе немає прогнозу на <b>${u.n}</b> з них.`,
    [[{ text: `Зробити ${u.n} ${plural(u.n, "прогноз", "прогнози", "прогнозів")}`, callback_data: `go:${u.md}`, style: "primary" }]],
    false, now));
  const group = groupChat(meta);
  if (group) {
    stmts.push(enqueue(env, group.id,
      `⏰ Сьогодні ${first.n} ${plural(first.n, "матч", "матчі", "матчів")} Ліги чемпіонів, перший о <b>${time}</b>.
` +
      `Прогноз на кожен матч приймається до його стартового свистка.`,
      group.open, false, now));
  }
  stmts.push(setMeta(env, `remind:${today}`, now));
  await env.DB.batch(stmts);
  return missing.results.length;
}

// ───────────── Підсумок вечора: одне повідомлення замість сповіщення на кожен матч ─────────────

interface DayPred {
  user_id: number; home: number; away: number; points: number | null; hit: Hit | null;
  matchday: number; is_finished: number; home_score: number | null; away_score: number | null;
  hn: string; hu: string | null; an: string; au: string | null;
}

export async function standings(env: Env, md: number | null) {
  const sql = md == null
    ? `SELECT u.tg_id, u.display_name,
              COALESCE(SUM(p.points), 0) + COALESCE(MAX(c.points), 0) total,
              COALESCE(SUM(p.hit = 'exact'), 0) exact,
              COALESCE(SUM(p.hit IN ('exact', 'diff', 'one', 'result')), 0) hits
         FROM users u
         LEFT JOIN predictions p ON p.user_id = u.tg_id
         LEFT JOIN champion_picks c ON c.user_id = u.tg_id
        GROUP BY u.tg_id
        ORDER BY total DESC, exact DESC, hits DESC, u.display_name`
    : `SELECT u.tg_id, u.display_name,
              COALESCE(SUM(p.points), 0) total,
              COALESCE(SUM(p.hit = 'exact'), 0) exact,
              COALESCE(SUM(p.hit IN ('exact', 'diff', 'one', 'result')), 0) hits
         FROM users u
         JOIN predictions p ON p.user_id = u.tg_id
         JOIN matches m ON m.id = p.match_id AND m.stage = '${LEAGUE}' AND m.matchday = ?1
        GROUP BY u.tg_id
        ORDER BY total DESC, exact DESC, hits DESC, u.display_name`;
  const stmt = md == null ? env.DB.prepare(sql) : env.DB.prepare(sql).bind(md);
  const res = await stmt.all<{ tg_id: number; display_name: string; total: number; exact: number; hits: number }>();
  return rank(res.results);
}

export async function enqueueDigests(env: Env, now: string, meta: Map<string, string>): Promise<number> {
  const today = kyiv(now).date;
  const yesterday = kyiv(addHours(now, -24)).date;
  const days = await env.DB.prepare(
    `SELECT kyiv_date d, COUNT(*) total, SUM(is_finished) fin, MAX(kickoff) last
       FROM matches
      WHERE kyiv_date IN (?1, ?2) AND status NOT IN ('POSTPONED', 'CANCELLED')
      GROUP BY kyiv_date ORDER BY kyiv_date`,
  ).bind(yesterday, today).all<{ d: string; total: number; fin: number; last: string }>();

  // Готовий день: усі матчі зараховано, або минуло 5 годин від останнього стартового свистка.
  const day = days.results.find((d) =>
    !meta.has(`digest:${d.d}`) && d.fin > 0 && (d.fin === d.total || now > addHours(d.last, 5)));
  if (!day) return 0;

  const preds = await env.DB.prepare(
    `SELECT p.user_id, p.home, p.away, p.points, p.hit, m.matchday, m.is_finished, m.home_score, m.away_score,
            h.name hn, h.name_uk hu, a.name an, a.name_uk au
       FROM predictions p
       JOIN matches m ON m.id = p.match_id
       JOIN teams h ON h.id = m.home_id
       JOIN teams a ON a.id = m.away_id
       JOIN users u ON u.tg_id = p.user_id AND u.is_active = 1
      WHERE m.kyiv_date = ?1
      ORDER BY p.user_id, m.kickoff, m.id`,
  ).bind(day.d).all<DayPred>();

  const table = await standings(env, null);
  const leader = table[0];
  const byUser = new Map<number, DayPred[]>();
  for (const p of preds.results) {
    if (!byUser.has(p.user_id)) byUser.set(p.user_id, []);
    byUser.get(p.user_id)!.push(p);
  }

  const k = kyiv(`${day.d}T12:00:00Z`);
  const stmts: D1PreparedStatement[] = [];
  for (const [userId, list] of byUser) {
    const sum = list.reduce((s, p) => s + (p.points ?? 0), 0);
    const lines = list.map((p) => {
      const hmN = clip(p.hu ?? p.hn, 9), awN = clip(p.au ?? p.an, 9);
      if (!p.is_finished) return `⏳ ${hmN} – ${awN}  ${p.home}:${p.away}`;
      return `${HIT_ICON[p.hit ?? "miss"]} ${hmN} ${p.home_score}:${p.away_score} ${awN}  ${p.home}:${p.away} +${p.points ?? 0}`;
    });
    const me = table.find((s) => s.tg_id === userId);
    let tail = "";
    if (me && leader) {
      tail = me.place === 1
        ? `\nТи лідер таблиці: ${me.total} ${plural(me.total, "бал", "бали", "балів")}.`
        : `\nТи на ${me.place}-му місці, до лідера ${leader.total - me.total} ${plural(leader.total - me.total, "бал", "бали", "балів")}.`;
    }
    stmts.push(enqueue(env, userId,
      `<b>${k.wdFull}, тур ${list[0].matchday}</b> · твої <b>+${sum}</b>\n<pre>${esc(lines.join("\n"))}</pre>${tail}`,
      [[{ text: "Таблиця", callback_data: "tb:all" }, { text: "Прогнози інших", callback_data: `o:${list[0].matchday}` }]],
      true, now)); // тихо: матчі закінчуються близько півночі за Києвом
  }
  const group = groupChat(meta);
  if (group && byUser.size) {
    const nameOf = new Map(table.map((s) => [s.tg_id, s.display_name]));
    const best = [...byUser].map(([id, list]) => ({
      name: nameOf.get(id) ?? "?",
      sum: list.reduce((s, p) => s + (p.points ?? 0), 0),
    })).sort((x, y) => y.sum - x.sum || x.name.localeCompare(y.name)).slice(0, 5);
    const bestLines = best.map((b, i) => `${String(i + 1).padStart(2)} ${clip(b.name, 15).padEnd(15)} ${("+" + b.sum).padStart(4)}`);
    const exact = preds.results.filter((p) => p.hit === "exact").slice(0, 8).map((p) =>
      `🎯 ${esc(nameOf.get(p.user_id) ?? "?")}: ${esc(p.hu ?? p.hn)} ${p.home_score}:${p.away_score} ${esc(p.au ?? p.an)}`);
    const md = preds.results[0].matchday;
    stmts.push(enqueue(env, group.id,
      `<b>${k.wdFull}, тур ${md}: підсумок дня</b>
<pre>${esc(bestLines.join("\n"))}</pre>` +
      (exact.length ? `
${exact.join("\n")}
` : "") +
      `
🏆 <b>Загальна таблиця</b>
<pre>${esc(tableLines(table, null, 10).join("\n"))}</pre>`,
      [[{ text: "Мої бали й повна таблиця", url: group.open[0][0].url!.replace("start=tour", "start=table") }]],
      true, now));
  }
  stmts.push(setMeta(env, `digest:${day.d}`, now));
  await env.DB.batch(stmts);
  return byUser.size;
}

// ───────────── Черга повідомлень ─────────────

export async function drainOutbox(env: Env, now: string): Promise<number> {
  const rows = await env.DB.prepare(
    "SELECT id, tg_id, text, markup, silent FROM outbox WHERE sent_at IS NULL AND attempts < 3 ORDER BY id LIMIT ?1",
  ).bind(MAX_SENDS_PER_RUN).all<{ id: number; tg_id: number; text: string; markup: string | null; silent: number }>();
  if (!rows.results.length) return 0;

  const stmts: D1PreparedStatement[] = [];
  let sent = 0;
  for (const r of rows.results) {
    const res = await tg(env, "sendMessage", {
      chat_id: r.tg_id, text: r.text, parse_mode: "HTML",
      reply_markup: r.markup ? JSON.parse(r.markup) : undefined,
      disable_notification: !!r.silent, link_preview_options: { is_disabled: true },
    });
    if (res.ok) {
      sent++;
      stmts.push(env.DB.prepare("UPDATE outbox SET sent_at = ?2 WHERE id = ?1").bind(r.id, now));
    } else if (res.error_code === 429) {
      break; // Telegram просить пригальмувати — продовжимо наступного запуску
    } else if (res.error_code === 403) {
      // учасник заблокував бота: більше не турбуємо
      stmts.push(env.DB.prepare("UPDATE outbox SET attempts = 3, error = 'blocked' WHERE id = ?1").bind(r.id));
      stmts.push(env.DB.prepare("UPDATE users SET is_active = 0 WHERE tg_id = ?1").bind(r.tg_id));
    } else {
      stmts.push(env.DB.prepare("UPDATE outbox SET attempts = attempts + 1, error = ?2 WHERE id = ?1")
        .bind(r.id, (res.description ?? "error").slice(0, 200)));
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return sent;
}

// ───────────── Один запуск cron ─────────────

export async function runCron(env: Env): Promise<string> {
  const now = nowIso();
  const meta = await getMeta(env);
  const log: string[] = [];
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      const r = await fn();
      if (r) log.push(`${name}: ${r}`);
    } catch (e) {
      console.error(`cron ${name} failed`, e);
      log.push(`${name}: помилка ${String(e).slice(0, 120)}`);
    }
  };

  const lastSync = meta.get("fixtures_synced_at");
  if (!lastSync || lastSync < addHours(now, -12)) await step("календар", () => syncFixtures(env));
  await step("результати", () => syncResults(env, now));
  await step("нагадування", () => enqueueReminders(env, now, meta));
  await step("підсумки", () => enqueueDigests(env, now, meta));
  await step("надіслано", () => drainOutbox(env, now));
  if (log.length) console.log(log.join(" | "));
  return log.join("\n") || "нічого робити";
}
