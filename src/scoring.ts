import { LEAGUE } from "./util";

export type Hit = "exact" | "diff" | "one" | "result" | "miss";

export const BASE_POINTS: Record<Hit, number> = { exact: 5, diff: 3, one: 2, result: 1, miss: 0 };
export const HIT_ICON: Record<Hit, string> = { exact: "🎯", diff: "🟢", one: "🟡", result: "⚪", miss: "✖️" };
export const HIT_LABEL: Record<Hit, string> = {
  exact: "точний рахунок",
  diff: "результат і різниця голів",
  one: "результат і голи однієї з команд",
  result: "лише результат",
  miss: "не вгадано",
};
export const CHAMPION_POINTS = 15;

/** Тип влучання прогнозу ph:pa у реальний рахунок rh:ra (за основний час). */
export function hitType(ph: number, pa: number, rh: number, ra: number): Hit {
  if (Math.sign(ph - pa) !== Math.sign(rh - ra)) return "miss";
  if (ph === rh && pa === ra) return "exact";
  if (ph - pa === rh - ra) return "diff";
  if (ph === rh || pa === ra) return "one";
  return "result";
}

/** Плей-оф (усе, що не ліговий етап) — бали за рахунок ×2. */
export const stageMultiplier = (stage: string) => (stage === LEAGUE ? 1 : 2);

export const pointsFor = (hit: Hit, stage: string) => BASE_POINTS[hit] * stageMultiplier(stage);
