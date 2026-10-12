export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  FOOTBALL_API_KEY: string;
  ADMIN_IDS: string;
  SEASON: string;
  START_MATCHDAY: string;
  CHAMPION_DEADLINE: string;
  TG_API_BASE?: string; // лише для локальних тестів
  FD_API_BASE?: string; // лише для локальних тестів
}

export const LEAGUE = "LEAGUE_STAGE";

/** UTC у форматі БД: 2026-10-13T16:45:00Z */
export const toIso = (d: Date) => d.toISOString().slice(0, 19) + "Z";
export const nowIso = () => toIso(new Date());
export const addHours = (iso: string, h: number) => toIso(new Date(Date.parse(iso) + h * 3600e3));

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + "…");

export const isAdmin = (env: Env, id: number) =>
  env.ADMIN_IDS.split(",").map((s) => s.trim()).includes(String(id));

// У Workers немає української локалі для Intl, тому беремо лише числа, а назви — свої.
const DTF = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Kyiv",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const WD_SHORT = ["нд", "пн", "вт", "ср", "чт", "пт", "сб"];
const WD_FULL = ["Неділя", "Понеділок", "Вівторок", "Середа", "Четвер", "Пʼятниця", "Субота"];
const MONTHS = ["січня", "лютого", "березня", "квітня", "травня", "червня",
  "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];

export interface KyivTime {
  date: string;   // YYYY-MM-DD
  time: string;   // HH:MM
  wdShort: string;
  wdFull: string;
  dayMonth: string; // «13 жовтня»
}

export function kyiv(iso: string): KyivTime {
  const p: Record<string, string> = {};
  for (const part of DTF.formatToParts(new Date(iso))) p[part.type] = part.value;
  const wd = new Date(Date.UTC(+p.year, +p.month - 1, +p.day)).getUTCDay();
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    wdShort: WD_SHORT[wd],
    wdFull: WD_FULL[wd],
    dayMonth: `${+p.day} ${MONTHS[+p.month - 1]}`,
  };
}

/** «1 прогноз», «3 прогнози», «5 прогнозів» */
export function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}
