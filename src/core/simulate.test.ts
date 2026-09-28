import { describe, expect, it } from "vitest";
import { applyRuleChange, forecastContacts, rulesToJson, simulate } from "./simulate";
import { parseRules } from "./rules";
import { withRules } from "./engine";
import { fixtureEngine, NOW } from "./__fixtures__/load";
import { fixturePatient, fixturePatients } from "./__fixtures__/patients";

const engine = fixtureEngine();
const nonZero = (xs: { date: string; count: number }[]) => xs.filter((x) => x.count > 0).map((x) => [x.date, x.count]);

describe("applyRuleChange", () => {
  it("rulesToJson → parseRules 왕복이 같은 규칙", () => {
    const r = parseRules(rulesToJson(engine.rules));
    expect(r.ok && r.rules).toEqual(engine.rules);
  });

  it("바꾼 규칙도 D01과 같은 검증을 거친다", () => {
    // 반복 안내·회차도 바꿀 수 있고, 음수는 D01 검증에서 막힌다.
    expect(applyRuleChange(engine.rules, { field: "graceDays", procedure: "scalp-care", key: "*", value: 5 }).ok).toBe(true);
    expect(applyRuleChange(engine.rules, { field: "earlyDays", procedure: "injection", key: "*", value: -1 }).ok).toBe(false);
    expect(applyRuleChange(engine.rules, { field: "graceDays", procedure: "injection", key: "inj-3", value: 1 })).toEqual({ ok: false, errors: ['injection는 전체("*")로만 바꿀 수 있습니다'] });
    expect(applyRuleChange(engine.rules, { field: "graceDays", procedure: "hair-transplant", key: "w5", value: 1 })).toEqual({ ok: false, errors: ["hair-transplant에 시점 w5가 없습니다"] });
    expect(applyRuleChange(engine.rules, { field: "maxAttempts", value: 0 }).ok).toBe(false);
  });

  it("개월 시점의 개월 수(6개월 → 5개월)를 바꿀 수 있다. 일수 시점이나 없는 시점은 거부", () => {
    const r = applyRuleChange(engine.rules, { field: "offsetMonths", procedure: "hair-transplant", key: "m6", value: 5 });
    const h = r.ok ? r.rules.procedures["hair-transplant"] : null;
    expect(h?.type === "fixed" && h.points.find((p) => p.key === "m6")?.offset).toEqual({ unit: "months", n: 5 });
    expect(applyRuleChange(engine.rules, { field: "offsetMonths", procedure: "hair-transplant", key: "w4", value: 1 })).toEqual({ ok: false, errors: ["hair-transplant에 개월로 정한 시점 w4가 없습니다"] });
    // 1년(12개월)보다 뒤로 가면 시점 순서가 뒤집혀 D01 검증에서 막힌다.
    expect(applyRuleChange(engine.rules, { field: "offsetMonths", procedure: "hair-transplant", key: "m6", value: 12 }).ok).toBe(false);
  });

  it("원본 규칙은 바뀌지 않는다", () => {
    const before = structuredClone(engine.rules);
    applyRuleChange(engine.rules, { field: "graceDays", procedure: "hair-transplant", key: "*", value: 0 });
    expect(engine.rules).toEqual(before);
  });
});

describe("simulate — 오늘 목록 차이", () => {
  const patients = fixturePatients();

  it("재연락 간격 3 → 1: P102(9/19 부재)가 9/20부터 연락 차례가 되어 오늘 목록에 더해진다", () => {
    const r = simulate(patients, engine, NOW, { field: "retryIntervalDays", value: 1 });
    if (!r.ok) throw new Error(r.errors.join());
    // 간호팀 확인 2명(P103 최대 시도, P105 D+7 날짜 미정)은 그대로.
    expect(r.today).toEqual({ beforeCount: 6, afterCount: 7, added: ["P102"], removed: [], changed: [], nurseBefore: 2, nurseAfter: 2, nurseAdded: [], nurseRemoved: [] });
  });

  it("최대 시도 3 → 4: 간호팀 확인이던 P103이 다시 코디네이터 목록으로", () => {
    const r = simulate(patients, engine, NOW, { field: "maxAttempts", value: 4 });
    if (!r.ok) throw new Error(r.errors.join());
    expect([r.today.added, r.today.nurseAfter, r.today.nurseRemoved]).toEqual([["P103"], 1, ["P103"]]);
  });

  it("휴진 이동 범위 D+7 뒤쪽 2 → 3일: P105 D+7(9/25)이 범위 안 9/28로 잡혀 간호팀 확인(날짜 미정)에서 빠진다", () => {
    const r = simulate(patients, engine, NOW, { field: "shiftAfter", procedure: "hair-transplant", key: "d7", value: 3 });
    if (!r.ok) throw new Error(r.errors.join());
    expect([r.today.beforeCount, r.today.afterCount, r.today.nurseRemoved, r.today.nurseAdded]).toEqual([6, 6, ["P105"], []]);
  });

  it("범위가 없는 시점의 범위는 새로 만들지 않는다(근거 문서 없이 지어내지 않음), 앞쪽 일수는 earlyDays를 넘지 못한다", () => {
    expect(applyRuleChange(engine.rules, { field: "shiftAfter", procedure: "hair-transplant", key: "w4", value: 3 })).toEqual({ ok: false, errors: ["hair-transplant w4에는 휴진 이동 범위가 없습니다"] });
    expect(applyRuleChange(engine.rules, { field: "shiftBefore", procedure: "hair-transplant", key: "d7", value: 2 }).ok).toBe(false);
    expect(applyRuleChange(engine.rules, { field: "shiftBefore", procedure: "injection", key: "*", value: 2 }).ok).toBe(true);
  });

  it("6개월 경과 진료 → 7개월: P101의 시점이 10/9(금, 한글날) → 10/10(토)로 밀려 아직 예정이라 오늘 목록에서 빠진다", () => {
    // P101: 3/9 + 7개월 = 10/9(한글날) → 10/10. 6개월(9/9) 미방문이 사라져 지남이 아니다.
    const r = simulate(patients, engine, NOW, { field: "offsetMonths", procedure: "hair-transplant", key: "m6", value: 7 });
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.today.removed).toContain("P101");
    expect(r.after.groups.flatMap((g) => g.rows).some((x) => x.patientId === "P101")).toBe(false);
  });

  it("4주 유예 7 → 6: 유예 마지막 날이던 P108이 오늘 지남으로", () => {
    const r = simulate(patients, engine, NOW, { field: "graceDays", procedure: "hair-transplant", key: "w4", value: 6 });
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.today.added).toEqual(["P108"]);
    expect(r.after.groups[0].rows.find((x) => x.patientId === "P108")?.items[0].daysPastDue).toBe(7);
  });
});

describe("forecastContacts — 앞으로 30일", () => {
  it("P101 한 명(손으로 센 값): 창은 오늘(9/21)부터 30일(10/20까지). 9/21 연락(2회) → 9/28 연락(3회, 이후 간호팀 확인)", () => {
    // 9/21: 9/17 부재 + 3 = 9/20 ≤ 오늘. 9/24: 9/21 + 3 = 9/24(추석) → 연락은 첫 진료일 9/28. 3회째라 그 뒤는 간호팀 확인. 1년(2027-03-09)은 창 밖.
    const f = forecastContacts([fixturePatient("P101")], engine, NOW, 30);
    expect(f).toHaveLength(30);
    expect([f[0].date, f[29].date]).toEqual(["2026-09-21", "2026-10-20"]);
    expect(nonZero(f)).toEqual([
      ["2026-09-21", 1],
      ["2026-09-28", 1],
    ]);
  });

  it("P102(주사 3회차 9/7 미방문): 9/22에 14일을 넘겨 재시작 → 간호팀 확인이라 30일 동안 코디네이터 연락이 없다(4회차 이후는 재시작 전)", () => {
    expect(nonZero(forecastContacts([fixturePatient("P102")], engine, NOW, 30))).toEqual([]);
  });

  it("같은 환자 P101, 재연락 간격 1: 오늘(9/21) 2회, 9/22에 3회 → 그 뒤 간호팀 확인", () => {
    const r = parseRules({ ...rulesToJson(engine.rules), retryIntervalDays: 1 });
    if (!r.ok) throw new Error(r.errors.join());
    expect(nonZero(forecastContacts([fixturePatient("P101")], withRules(engine, r.rules), NOW, 30))).toEqual([
      ["2026-09-21", 1],
      ["2026-09-22", 1],
    ]);
  });

  it("첫 연락일 차이: 재연락 간격 1이면 P102가 재시작(9/22) 전날인 오늘 한 번 연락된다(전에는 연락 없이 간호팀 확인)", () => {
    const r = simulate([fixturePatient("P102")], engine, NOW, { field: "retryIntervalDays", value: 1 });
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.firstContact).toEqual([{ patientId: "P102", before: null, after: "2026-09-21" }]);
  });

  it("휴진일(추석 9/24~26, 일요일, 10/16)은 0건", () => {
    const f = forecastContacts(fixturePatients(), engine, NOW, 30);
    for (const date of ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-10-04", "2026-10-16"]) {
      expect(f.find((x) => x.date === date)?.count).toBe(0);
    }
  });

  // 변이 검사 M15e: 예측이 쌓는 가정 연락의 날짜가 기준 시각의 시(時)에 따라 흔들리지 않는다.
  // 08:00 KST는 UTC로 전날 23:00이다. 두 기준 시각 모두 같은 날짜 축·같은 건수여야 한다.
  it("기준 시각이 08:00이든 09:00이든 같은 날짜 축과 같은 건수", () => {
    const f9 = forecastContacts(fixturePatients(), engine, NOW, 30);
    const f8 = forecastContacts(fixturePatients(), engine, NOW - 3_600_000, 30);
    expect(f8).toEqual(f9);
  });

  it("결정성: 같은 입력이면 같은 예측", () => {
    const r1 = simulate(fixturePatients(), engine, NOW, { field: "graceDays", procedure: "hair-transplant", key: "m6", value: 3 });
    const r2 = simulate(fixturePatients(), engine, NOW, { field: "graceDays", procedure: "hair-transplant", key: "m6", value: 3 });
    expect(r1).toEqual(r2);
    expect(r1.ok && r1.forecast).toHaveLength(30);
  });
});
