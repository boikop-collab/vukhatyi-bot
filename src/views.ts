import { Env, LEAGUE, clip, esc, kyiv, nowIso, plural } from "./util";
import { CHAMPION_POINTS, HIT_ICON, Hit } from "./scoring";
import type { Button, Keyboard, View } from "./tg";

/** Матч туру разом із прогнозом конкретного учасника. */
export interface Row {
  id: number; matchday: number; kickoff: string; is_finished: number; status: string;
  home_score: number | null; away_score: number | null;
  hn: string; hu: string | null; an: string; au: string | null;
  ph: number | null; pa: number | null; pp: number | null; hit: Hit | null;
}

const home = (r: Row) => r.hu ?? r.hn;
const away = (r: Row) => r.au ?? r.an;
const isOpen = (r: Row, now: string) => r.kickoff > now && !r.is_finished;
const isOff = (r: Row) => r.status === "POSTPONED" || r.status === "CANCELLED";

export async function tourRows(env: Env, userId: number, md: number): Promise<Row[]> {
  const res = await env.DB.prepare(
    `SELECT m.id, m.matchday, m.kickoff, m.is_finished, m.status, m.home_score, m.away_score,
            h.name hn, h.name_uk hu, a.name an, a.name_uk au,
            p.home ph, p.away pa, p.points pp, p.hit
       FROM matches m
       JOIN teams h ON h.id = m.home_id
       JOIN teams a ON a.id = m.away_id
       LEFT JOIN predictions p ON p.match_id = m.id AND p.user_id = ?1
      WHERE m.stage = ?2 AND m.matchday = ?3
      ORDER BY m.kickoff, m.id`,
  ).bind(userId, LEAGUE, md).all<Row>();
  return res.results;
}

/** Тур, на який зараз приймаються прогнози (або останній, якщо все зіграно). */
export async function activeMatchday(env: Env): Promise<number | null> {
  const next = await env.DB.prepare(
    `SELECT matchday FROM matches WHERE stage = ?1 AND kickoff > ?2 ORDER BY kickoff LIMIT 1`,
  ).bind(LEAGUE, nowIso()).first<{ matchday: number }>();
  if (next) return next.matchday;
  const last = await env.DB.prepare(
    `SELECT MAX(matchday) md FROM matches WHERE stage = ?1`,
  ).bind(LEAGUE).first<{ md: number | null }>();
  return last?.md ?? null;
}

export const NO_MATCHES: View = {
  text: "Календар ще не завантажено. Спробуй трохи пізніше.",
};

export function tourView(rows: Row[], md: number, now: string, minMd: number, maxMd: number): View {
  if (!rows.length) return NO_MATCHES;
  const predicted = rows.filter((r) => r.ph != null).length;
  const missing = rows.filter((r) => isOpen(r, now) && r.ph == null).length;
  const anyOpen = rows.some((r) => isOpen(r, now));
  const anyStarted = rows.some((r) => r.kickoff <= now);
  const earned = rows.reduce((s, r) => s + (r.pp ?? 0), 0);

  const lines: string[] = [];
  let day = "";
  for (const r of rows) {
    const k = kyiv(r.kickoff);
    if (k.date !== day) {
      day = k.date;
      if (lines.length) lines.push("");
      lines.push(`${k.wdFull}, ${k.dayMonth}`);
    }
    const pair = clip(`${home(r)}–${away(r)}`, 19).padEnd(19);
    const pred = r.ph != null ? `${r.ph}:${r.pa}` : "·:·";
    let tail = "";
    if (isOff(r)) tail = " перен.";
    else if (r.is_finished) tail = r.ph != null ? ` +${r.pp ?? 0}` : "";
    else if (r.kickoff <= now) tail = " 🔒";
    lines.push(`${k.time} ${pair} ${pred}${tail}`);
  }

  let head = `<b>Тур ${md}</b> · ${predicted} з ${rows.length} прогнозів`;
  if (rows.some((r) => r.is_finished)) head += ` · <b>+${earned}</b>`;
  const text = `${head}\n<pre>${esc(lines.join("\n"))}</pre>`;

  const kb: Keyboard = [];
  if (missing > 0) kb.push([{ text: `Продовжити: лишилось ${missing}`, callback_data: `go:${md}`, style: "primary" }]);
  const second: Button[] = [];
  if (anyOpen && predicted > 0) second.push({ text: "Змінити прогноз", callback_data: `ed:${md}` });
  if (anyStarted) second.push({ text: "Прогнози інших", callback_data: `o:${md}` });
  if (second.length) kb.push(second);
  const nav: Button[] = [];
  if (md > minMd) nav.push({ text: `‹ Тур ${md - 1}`, callback_data: `t:${md - 1}` });
  if (md < maxMd) nav.push({ text: `Тур ${md + 1} ›`, callback_data: `t:${md + 1}` });
  if (nav.length) kb.push(nav);
  kb.push([{ text: "Таблиця", callback_data: "tb:all" }]);
  return { text, kb };
}

const GRID = [["1:0", "2:0", "2:1"], ["0:0", "1:1", "2:2"], ["0:1", "0:2", "1:2"]];

function cardHead(rows: Row[], r: Row): string {
  const k = kyiv(r.kickoff);
  const idx = rows.findIndex((x) => x.id === r.id) + 1;
  return `<i>Тур ${r.matchday} · матч ${idx} з ${rows.length}</i>\n` +
    `<b>${esc(home(r))} — ${esc(away(r))}</b>\n${k.wdShort}, ${k.dayMonth} · ${k.time}`;
}

/** Картка матчу із сіткою рахунків: один дотик = збережений прогноз. */
export function matchCard(rows: Row[], r: Row, note?: string): View {
  let text = cardHead(rows, r);
  if (r.ph != null) text += `\nТвій прогноз: <b>${r.ph}:${r.pa}</b>`;
  if (note) text += `\n\n<i>${esc(note)}</i>`;
  const kb: Keyboard = GRID.map((line) =>
    line.map((s) => ({ text: s, callback_data: `p:${r.matchday}:${r.id}:${s}` })));
  kb.push([
    { text: "Інший рахунок", callback_data: `c:${r.matchday}:${r.id}` },
    { text: "Пропустити ›", callback_data: `sk:${r.matchday}:${r.id}` },
  ]);
  kb.push([{ text: "‹ До туру", callback_data: `t:${r.matchday}` }]);
  return { text, kb };
}

function digits(prefix: string): Keyboard {
  const row = (from: number) => [0, 1, 2, 3].map((i) => ({ text: String(from + i), callback_data: `${prefix}:${from + i}` }));
  return [row(0), row(4)];
}

export function customHome(rows: Row[], r: Row): View {
  const kb = digits(`g:${r.matchday}:${r.id}`);
  kb.push([{ text: "‹ Назад до сітки", callback_data: `e:${r.matchday}:${r.id}` }]);
  return { text: `${cardHead(rows, r)}\n\nСкільки забʼє <b>${esc(home(r))}</b>?`, kb };
}

export function customAway(rows: Row[], r: Row, h: number): View {
  const kb = digits(`p:${r.matchday}:${r.id}:${h}`);
  kb.push([{ text: "‹ Назад", callback_data: `c:${r.matchday}:${r.id}` }]);
  return { text: `${cardHead(rows, r)}\n\n${esc(home(r))}: <b>${h}</b>. Скільки забʼє <b>${esc(away(r))}</b>?`, kb };
}

/** Список відкритих матчів туру, щоб змінити прогноз. */
export function editList(rows: Row[], md: number, now: string): View {
  const open = rows.filter((r) => isOpen(r, now));
  const kb: Keyboard = open.map((r) => [{
    text: `${clip(`${home(r)}–${away(r)}`, 26)}  ${r.ph != null ? `${r.ph}:${r.pa}` : "·:·"}`,
    callback_data: `e:${md}:${r.id}`,
  }]);
  kb.push([{ text: "‹ До туру", callback_data: `t:${md}` }]);
  return { text: `<b>Тур ${md}</b>\nОбери матч, щоб змінити прогноз:`, kb };
}

export function othersList(rows: Row[], md: number, now: string): View {
  const started = rows.filter((r) => r.kickoff <= now);
  const kb: Keyboard = started.map((r) => [{
    text: `${clip(`${home(r)}–${away(r)}`, 26)}${r.is_finished ? `  ${r.home_score}:${r.away_score}` : ""}`,
    callback_data: `om:${md}:${r.id}`,
  }]);
  kb.push([{ text: "‹ До туру", callback_data: `t:${md}` }]);
  return { text: `<b>Тур ${md}</b>\nПрогнози інших видно після початку матчу. Обери матч:`, kb };
}

export interface OtherPred { display_name: string; home: number; away: number; points: number | null; hit: Hit | null }

export function othersMatch(r: Row, preds: OtherPred[]): View {
  const lines = preds.map((p) => {
    const tail = p.hit ? ` ${HIT_ICON[p.hit]} +${p.points ?? 0}` : "";
    return `${clip(p.display_name, 16).padEnd(16)} ${p.home}:${p.away}${tail}`;
  });
  const score = r.is_finished ? ` <b>${r.home_score}:${r.away_score}</b>` : "";
  const body = lines.length ? `<pre>${esc(lines.join("\n"))}</pre>` : "Ніхто не зробив прогноз.";
  return {
    text: `<b>${esc(home(r))} — ${esc(away(r))}</b>${score}\n${body}`,
    kb: [[{ text: "‹ Назад", callback_data: `o:${r.matchday}` }]],
  };
}

export interface Standing { tg_id: number; display_name: string; total: number; exact: number; hits: number; place: number }

/** Місця з урахуванням рівності: однакові бали, точні й результати = спільне місце. */
export function rank(rows: Omit<Standing, "place">[]): Standing[] {
  const out: Standing[] = [];
  rows.forEach((r, i) => {
    const prev = out[i - 1];
    const same = prev && prev.total === r.total && prev.exact === r.exact && prev.hits === r.hits;
    out.push({ ...r, place: same ? prev.place : i + 1 });
  });
  return out;
}

/** Рядки таблиці для моноширинного блоку. meId — кого позначити «›» (null у груповому чаті). */
export function tableLines(st: Standing[], meId: number | null, limit = 100): string[] {
  const lines = [`  # ${"Учасник".padEnd(15)} Бали 🎯`];
  for (const s of st.slice(0, limit)) {
    const mark = s.tg_id === meId ? "›" : " ";
    lines.push(`${mark}${String(s.place).padStart(2)} ${clip(s.display_name, 15).padEnd(15)} ${String(s.total).padStart(4)} ${String(s.exact).padStart(2)}`);
  }
  if (st.length > limit) lines.push(`   … ще ${st.length - limit}`);
  return lines;
}

export function tableView(st: Standing[], meId: number, title: string, md: number | null, activeMd: number | null): View {
  const lines = tableLines(st, meId);
  const kb: Keyboard = [];
  if (md == null && activeMd != null) kb.push([{ text: `Таблиця туру ${activeMd}`, callback_data: `tb:${activeMd}` }]);
  if (md != null) kb.push([{ text: "Загальна таблиця", callback_data: "tb:all" }]);
  kb.push([{ text: "Мій тур", callback_data: "t:0" }]);
  const body = st.length ? `<pre>${esc(lines.join("\n"))}</pre>` : "Поки що нікого немає.";
  return { text: `🏆 <b>${title}</b>\n${body}`, kb };
}

export interface TeamRow { id: number; name: string; name_uk: string | null }

export function championView(teams: TeamRow[], pick: TeamRow | null, open: boolean, deadline: string): View {
  const k = kyiv(deadline);
  let text = `<b>Бонус: чемпіон сезону</b>\n+${CHAMPION_POINTS} балів, якщо вгадаєш переможця Ліги чемпіонів.\n`;
  text += pick ? `Твій вибір: <b>${esc(pick.name_uk ?? pick.name)}</b>\n` : "Ти ще не обрав.\n";
  if (!open) return { text: text + "Вибір закрито 🔒" };
  text += `Змінити можна до ${k.dayMonth}, ${k.time}.`;
  const kb: Keyboard = [];
  for (let i = 0; i < teams.length; i += 3) {
    kb.push(teams.slice(i, i + 3).map((t) => ({ text: clip(t.name_uk ?? t.name, 14), callback_data: `w:${t.id}` })));
  }
  return { text, kb };
}
