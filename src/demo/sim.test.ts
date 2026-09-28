import { describe, expect, it } from "vitest";
import { simulate } from "@/core/simulate";
import { DEMO_NOW_MS } from "./clock";
import { mustDemo } from "./data";
import { forecastBars, parseSimValue, SIM_OPTIONS, simOption } from "./sim";

const { engine, patients } = mustDemo();

describe("규칙 바꿔 보기 선택지", () => {
  it("지금 값은 볼트 D01에서 읽는다(6개월 유예 7, 4주 유예 7, 주사 유예 3, 재연락 3, 최대 시도 3, 6개월 경과 진료 6개월)", () => {
    expect(SIM_OPTIONS.map((o) => [o.id, o.current(engine.rules)])).toEqual([
      ["grace-m6", 7],
      ["grace-w4", 7],
      ["grace-inj", 3],
      ["retry", 3],
      ["max-attempts", 3],
      ["m6-months", 6],
    ]);
  });

  it("범위 안의 정수만 받는다", () => {
    const o = simOption("grace-m6");
    expect([parseSimValue("3", o), parseSimValue(" 21 ", o), parseSimValue("22", o), parseSimValue("-1", o), parseSimValue("2.5", o), parseSimValue("", o)]).toEqual([3, 21, null, null, null, null]);
    expect(simOption("없는 값").id).toBe("grace-m6");
  });

  it("PRD 시연 21~27초: 6개월 유예 7 → 3이면 P011(6개월 9/13 일 → 9/14, 유예 끝 9/17, 연락 없음)이 오늘 목록에 더해진다", () => {
    const r = simulate(patients, engine, DEMO_NOW_MS, simOption("grace-m6").change(3));
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.today.added).toContain("P011");
    expect(r.today.afterCount).toBeGreaterThan(r.today.beforeCount);
    // 창에 오늘이 들어 있어 +1(오늘)과 −1(원래 첫 연락일 9/22)이 같은 막대 표에 보이고, 첫 연락이 앞당겨진 것이 따로 보인다.
    expect(r.forecast[0].date).toBe("2026-09-21");
    expect(r.firstContact).toContainEqual({ patientId: "P011", before: "2026-09-22", after: "2026-09-21" });
  });
});

describe("볼트 원본은 바뀌지 않는다(F9)", () => {
  const deepFreeze = <T,>(o: T): T => {
    if (o && typeof o === "object" && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const v of Object.values(o as object)) deepFreeze(v);
    }
    return o;
  };

  // 검증 실패로 화면이 멈추지 않는지(모든 선택지의 끝값)도 같이 본다. simulate 한 번이 수백 ms라 끝값만.
  it("실제 번들의 규칙·달력·환자를 얼린 채 모든 선택지의 끝값으로 계산해도 예외 없이 끝나고, 값이 그대로다", () => {
    const before = JSON.stringify({ rules: engine.rules, cal: engine.calendar, patients });
    const frozenEngine = deepFreeze(structuredClone(engine));
    const frozenPatients = deepFreeze(structuredClone(patients));
    for (const o of SIM_OPTIONS) {
      for (const v of [o.min, o.max]) {
        expect(simulate(frozenPatients, frozenEngine, DEMO_NOW_MS, o.change(v)).ok, `${o.id}=${v}`).toBe(true);
      }
    }
    expect(JSON.stringify({ rules: frozenEngine.rules, cal: frozenEngine.calendar, patients: frozenPatients })).toBe(before);
  }, 30_000);
});

describe("forecastBars", () => {
  it("가장 큰 값을 100으로, 휴진일은 closed, 차이는 after − before", () => {
    const b = forecastBars(
      [
        { date: "2026-09-22", before: 2, after: 4 },
        { date: "2026-09-24", before: 0, after: 0 },
        { date: "2026-09-28", before: 1, after: 0 },
      ],
      (d) => d === "2026-09-24",
    );
    expect(b.map((x) => [x.beforePct, x.afterPct, x.delta, x.closed])).toEqual([
      [50, 100, 2, false],
      [0, 0, 0, true],
      [25, 0, -1, false],
    ]);
  });

  it("모두 0이어도 나누기 0이 없다", () => {
    expect(forecastBars([{ date: "2026-09-22", before: 0, after: 0 }], () => false)[0].afterPct).toBe(0);
  });
});
