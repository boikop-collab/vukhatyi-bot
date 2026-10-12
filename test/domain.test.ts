import { describe, expect, it } from "vitest";
import { hitType, pointsFor } from "../src/scoring";
import { regulationScore } from "../src/football";
import { addHours, kyiv, plural } from "../src/util";
import { Row, matchCard, rank, tourView } from "../src/views";

describe("бали", () => {
  it("точний рахунок — 5", () => expect(pointsFor(hitType(2, 1, 2, 1), "LEAGUE_STAGE")).toBe(5));
  it("результат і різниця — 3", () => expect(pointsFor(hitType(2, 1, 3, 2), "LEAGUE_STAGE")).toBe(3));
  it("нічия з іншим рахунком — це різниця, 3", () => expect(hitType(1, 1, 2, 2)).toBe("diff"));
  it("результат і голи однієї команди — 2", () => {
    expect(hitType(2, 0, 2, 1)).toBe("one");
    expect(hitType(3, 1, 2, 1)).toBe("one");
  });
  it("лише результат — 1", () => expect(pointsFor(hitType(1, 0, 3, 1), "LEAGUE_STAGE")).toBe(1));
  it("не вгадано — 0, навіть якщо голи однієї команди збіглися", () => {
    expect(hitType(1, 0, 1, 1)).toBe("miss");
    expect(hitType(0, 2, 2, 2)).toBe("miss");
  });
  it("плей-оф подвоює", () => {
    expect(pointsFor("exact", "LAST_16")).toBe(10);
    expect(pointsFor("result", "FINAL")).toBe(2);
  });
});

describe("рахунок за 90 хвилин", () => {
  it("звичайний матч — fullTime", () =>
    expect(regulationScore({ duration: "REGULAR", fullTime: { home: 2, away: 1 } })).toEqual([2, 1]));
  it("овертайм із regularTime — беремо regularTime", () =>
    expect(regulationScore({ duration: "EXTRA_TIME", fullTime: { home: 3, away: 2 }, regularTime: { home: 2, away: 2 } })).toEqual([2, 2]));
  it("пенальті без regularTime — не вгадуємо", () =>
    expect(regulationScore({ duration: "PENALTY_SHOOTOUT", fullTime: { home: 5, away: 4 } })).toBeNull());
  it("матч ще без рахунку", () =>
    expect(regulationScore({ duration: "REGULAR", fullTime: { home: null, away: null } })).toBeNull());
});

describe("київський час", () => {
  it("літній час: 16:45 UTC = 19:45", () => {
    const k = kyiv("2026-10-13T16:45:00Z");
    expect([k.date, k.time, k.wdShort, k.dayMonth]).toEqual(["2026-10-13", "19:45", "вт", "13 жовтня"]);
  });
  it("зимовий час: 20:00 UTC = 22:00", () => expect(kyiv("2026-11-03T20:00:00Z").time).toBe("22:00"));
  it("матч після півночі за Києвом потрапляє в наступну дату", () =>
    expect(kyiv("2026-11-03T22:30:00Z").date).toBe("2026-11-04"));
  it("addHours", () => expect(addHours("2026-10-13T23:00:00Z", 2)).toBe("2026-10-14T01:00:00Z"));
});

describe("дрібниці", () => {
  it("множина", () => {
    expect([1, 2, 5, 11, 21, 22, 112].map((n) => plural(n, "бал", "бали", "балів")))
      .toEqual(["бал", "бали", "балів", "балів", "бал", "бали", "балів"]);
  });
  it("спільні місця", () => {
    const r = rank([
      { tg_id: 1, display_name: "A", total: 10, exact: 1, hits: 4 },
      { tg_id: 2, display_name: "B", total: 10, exact: 1, hits: 4 },
      { tg_id: 3, display_name: "C", total: 10, exact: 0, hits: 5 },
    ]);
    expect(r.map((x) => x.place)).toEqual([1, 1, 3]);
  });
});

const row = (o: Partial<Row>): Row => ({
  id: 1, matchday: 2, kickoff: "2026-10-13T16:45:00Z", is_finished: 0, status: "TIMED",
  home_score: null, away_score: null, hn: "Arsenal", hu: "Арсенал", an: "Real Madrid", au: "Реал Мадрид",
  ph: null, pa: null, pp: null, hit: null, ...o,
});

describe("екрани", () => {
  const rows = [
    row({ id: 1, ph: 2, pa: 1 }),
    row({ id: 2, kickoff: "2026-10-13T19:00:00Z", hu: "Баварія", au: "Бенфіка" }),
    row({ id: 3, kickoff: "2026-10-14T19:00:00Z", hu: null, hn: "Qarabag FK", au: "ПСЖ" }),
  ];
  it("тур: рядки не ширші за 32 символи і є кнопка «Продовжити»", () => {
    const v = tourView(rows, 2, "2026-10-13T10:00:00Z", 2, 8);
    const pre = v.text.split("<pre>")[1].split("</pre>")[0].split("\n");
    expect(Math.max(...pre.map((l) => l.length))).toBeLessThanOrEqual(32);
    expect(v.kb![0][0].text).toBe("Продовжити: лишилось 2");
    expect(v.text).toContain("1 з 3 прогнозів");
  });
  it("після старту матч закрито", () => {
    const v = tourView(rows, 2, "2026-10-13T17:00:00Z", 2, 8);
    expect(v.text).toContain("🔒");
    expect(v.kb![0][0].text).toBe("Продовжити: лишилось 2");
  });
  it("кнопки картки вкладаються в 64 байти callback_data", () => {
    const v = matchCard(rows, row({ id: 9999999, matchday: 8 }));
    for (const b of v.kb!.flat()) expect(new TextEncoder().encode(b.callback_data).length).toBeLessThanOrEqual(64);
    expect(v.kb![0][0].callback_data).toBe("p:8:9999999:1:0");
  });
});
