import type { Env } from "./util";

export interface ApiTeam { id: number | null; name: string | null; shortName: string | null; tla: string | null }
export interface ApiScore {
  winner?: string | null;
  duration?: string;
  fullTime?: { home: number | null; away: number | null };
  regularTime?: { home: number | null; away: number | null };
}
export interface ApiMatch {
  id: number;
  utcDate: string;
  status: string;
  stage: string;
  matchday: number | null;
  homeTeam: ApiTeam;
  awayTeam: ApiTeam;
  score: ApiScore;
}

/** Матчі Ліги чемпіонів з football-data.org. null — якщо API недоступний. */
export async function fdMatches(env: Env, query: Record<string, string>): Promise<ApiMatch[] | null> {
  const base = env.FD_API_BASE ?? "https://api.football-data.org";
  const url = `${base}/v4/competitions/CL/matches?${new URLSearchParams(query)}`;
  try {
    const resp = await fetch(url, { headers: { "X-Auth-Token": env.FOOTBALL_API_KEY } });
    if (!resp.ok) {
      console.error(`football-data ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      return null;
    }
    const data = (await resp.json()) as { matches?: ApiMatch[] };
    return data.matches ?? [];
  } catch (e) {
    console.error("football-data fetch failed", e);
    return null;
  }
}

/**
 * Рахунок за ОСНОВНИЙ час (90 хв). null — якщо надійно визначити не можна.
 *  1) є regularTime → беремо його (матч мав овертайм/пенальті);
 *  2) duration == REGULAR → fullTime і є 90 хв;
 *  3) овертайм/пенальті без regularTime → null: fullTime містить голи овертайму,
 *     такий матч вносить адмін вручну.
 */
export function regulationScore(score: ApiScore | undefined): [number, number] | null {
  const rt = score?.regularTime;
  if (rt && rt.home != null && rt.away != null) return [rt.home, rt.away];
  if (score?.duration === "REGULAR") {
    const ft = score.fullTime;
    if (ft && ft.home != null && ft.away != null) return [ft.home, ft.away];
  }
  return null;
}
