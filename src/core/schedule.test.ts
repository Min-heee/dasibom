import { describe, expect, it } from "vitest";
import { localDate } from "./calendar";
import { withRules, type Engine } from "./engine";
import type { Procedure, Visit } from "./patient";
import { buildSchedule, describeShift, windowRange } from "./schedule";
import { fixtureEngine, TODAY } from "./__fixtures__/load";

const d = localDate;
const engine = fixtureEngine();
const sched = (procedure: Procedure, start: string, e: Engine = engine, visits: Visit[] = [], today = TODAY) =>
  buildSchedule({ procedure, startDate: d(start), visits }, today, e.rules, e.calendar);
const row = (p: ReturnType<typeof sched>[number]) => [p.key, p.originalDate, p.dueDate, p.skipped.length, p.holidayUnknown];

describe("buildSchedule — 모발이식", () => {
  it("수술 9/18(금): D+7(9/25 추석)은 허용 범위 9/24~9/27(V07)이 모두 휴진이라 날짜 미정, 4주는 범위가 없어 내부 교육 휴진(10/16) 다음 날 10/17로 미룬다", () => {
    expect(sched("hair-transplant", "2026-09-18").map(row)).toEqual([
      ["d1", "2026-09-19", "2026-09-19", 0, false],
      ["d3", "2026-09-21", "2026-09-21", 0, false],
      // 살펴본 순서: 원래 날짜 → 뒤로(9/26, 9/27) → 앞으로(9/24). 범위 밖 9/28로 미루지 않는다.
      ["d7", "2026-09-25", null, 4, false],
      ["d14", "2026-10-02", "2026-10-02", 0, false],
      ["w4", "2026-10-16", "2026-10-17", 1, false],
      // 2027년은 픽스처의 공휴일 확인 기간 밖이다.
      ["m6", "2027-03-18", "2027-03-18", 0, true],
      ["y1", "2027-09-18", "2027-09-18", 0, true],
    ]);
    const s = sched("hair-transplant", "2026-09-18");
    expect(s.map((p) => p.shift)).toEqual(["none", "none", "unresolved", "none", "later", "none", "none"]);
    expect(s.map((p) => p.window?.basis ?? null)).toEqual([null, null, "V07", null, null, null, null]);
    expect(windowRange(s[2])).toEqual({ from: "2026-09-24", to: "2026-09-27" });
    expect(windowRange(s[4])).toBeNull();
  });

  it("수술 9/17(목): D+7(9/24 추석 연휴)은 범위 뒤쪽 9/25·9/26이 휴진이라 범위 안 이전 진료일 9/23(D+6)으로 앞당긴다", () => {
    const d7 = sched("hair-transplant", "2026-09-17")[2];
    expect([d7.originalDate, d7.dueDate, d7.shift, d7.skipped.map((x) => x.date)]).toEqual(["2026-09-24", "2026-09-23", "earlier", ["2026-09-24", "2026-09-25", "2026-09-26"]]);
    // D+3(9/20 일)은 범위가 없어 다음 진료일로 미룬다(앞당기지 않는다).
    const d3 = sched("hair-transplant", "2026-09-17")[1];
    expect([d3.dueDate, d3.shift]).toEqual(["2026-09-21", "later"]);
  });

  it("범위 안의 뒤 진료일이 있으면 앞당기지 않고 미룬다: 10/2(금) 수술 D+7 10/9(금, 한글날) → 10/10(토, D+8)", () => {
    const d7 = sched("hair-transplant", "2026-10-02")[2];
    expect([d7.dueDate, d7.shift]).toEqual(["2026-10-10", "later"]);
  });

  it("살펴본 휴진일과 사유를 한 줄로", () => {
    const s = sched("hair-transplant", "2026-09-18");
    expect(describeShift(s[2])).toBe("9/25 공휴일(추석), 9/26 공휴일(추석 연휴), 9/27 일요일 휴진, 9/24 공휴일(추석 연휴)");
    expect(describeShift(s[0])).toBeNull();
  });

  it("사진 회차는 photo, 안내는 notice", () => {
    expect(sched("hair-transplant", "2026-09-18").map((p) => p.kind)).toEqual(["visit", "notice", "photo", "notice", "visit", "photo", "photo"]);
  });

  it("개천절(토)·일요일·대체공휴일(월)을 연달아 건너뛴다: 4/3 수술의 6개월 10/3 → 10/6", () => {
    const m6 = sched("hair-transplant", "2026-04-03")[5];
    expect([m6.originalDate, m6.dueDate, m6.skipped.map((s) => s.date)]).toEqual(["2026-10-03", "2026-10-06", ["2026-10-03", "2026-10-04", "2026-10-05"]]);
  });
});

describe("buildSchedule — 월말 시작일", () => {
  it("1/31 수술: 6개월 7/31, 1년 2027-01-31(일) → 2/1", () => {
    const s = sched("hair-transplant", "2026-01-31");
    expect(row(s[5])).toEqual(["m6", "2026-07-31", "2026-07-31", 0, true]);
    expect(row(s[6])).toEqual(["y1", "2027-01-31", "2027-02-01", 1, true]);
  });

  it("3/31 수술: 6개월 9/30(수), 1년 2027-03-31", () => {
    const s = sched("hair-transplant", "2026-03-31");
    expect(row(s[5])).toEqual(["m6", "2026-09-30", "2026-09-30", 0, false]);
    expect(row(s[6])[1]).toBe("2027-03-31");
  });

  it("8/31 수술: 6개월 2027-02-28(일). 삼일절을 모르는 달력은 3/1로(미확인 표시), 아는 달력은 3/2로 민다", () => {
    const s = sched("hair-transplant", "2026-08-31");
    expect(row(s[5])).toEqual(["m6", "2027-02-28", "2027-03-01", 1, true]);

    const rules = {
      ...engine.rules,
      holidays: [...engine.rules.holidays, { date: d("2027-03-01"), name: "3·1절" }],
      holidaysCoverage: { from: d("2026-09-01"), to: d("2027-12-31"), checkedOn: d("2026-09-28") },
    };
    const s2 = sched("hair-transplant", "2026-08-31", withRules(engine, rules));
    expect(row(s2[5])).toEqual(["m6", "2027-02-28", "2027-03-02", 2, false]);
  });
});

describe("buildSchedule — 두피 주사(회차)", () => {
  it("8/10(월) 시작: 1회차는 시작일이라 시점 없음, 2~10회차 2주 간격, 5·10회차 사진, 5회차는 대체공휴일(10/5)이라 10/6", () => {
    const s = sched("injection", "2026-08-10");
    expect(s.map((p) => [p.key, p.dueDate, p.kind])).toEqual([
      ["inj-2", "2026-08-24", "visit"],
      ["inj-3", "2026-09-07", "visit"],
      ["inj-4", "2026-09-21", "visit"],
      ["inj-5", "2026-10-06", "photo"],
      ["inj-6", "2026-10-19", "visit"],
      ["inj-7", "2026-11-02", "visit"],
      ["inj-8", "2026-11-16", "visit"],
      ["inj-9", "2026-11-30", "visit"],
      ["inj-10", "2026-12-14", "photo"],
    ]);
    expect([s[3].originalDate, s[3].label, s[3].session]).toEqual(["2026-10-05", "두피 주사 5회차", 5]);
  });

  it("앞 회차가 옮겨져도 뒤 회차는 시작일에서 센다(이동이 누적되지 않는다)", () => {
    // 9/10(목) 시작: 2회차 9/24(목, 추석 연휴)는 앞뒤 3일(V08) 중 뒤 9/25~9/27이 휴진이라 9/23(수)으로 앞당김.
    // 3회차는 9/23 + 14가 아니라 9/10 + 28 = 10/8.
    const s = sched("injection", "2026-09-10");
    expect([s[0].dueDate, s[0].shift, s[1].dueDate]).toEqual(["2026-09-23", "earlier", "2026-10-08"]);
    expect([s[0].window, s[0].restartAfterDays]).toEqual([{ before: 3, after: 3, basis: "V08" }, 14]);
  });
});

describe("buildSchedule — 두피 관리(반복 안내)", () => {
  const v = (date: string): Visit => ({ date: d(date), kind: "scalp-care" });

  it("마지막 두피 관리 방문 + 28일 하나만 만든다", () => {
    expect(sched("scalp-care", "2026-06-29", engine, [v("2026-07-27"), v("2026-08-24")]).map(row)).toEqual([["scalp-care", "2026-09-21", "2026-09-21", 0, false]]);
  });

  it("방문이 없으면 시작일 + 28일, 기준일 뒤의 방문과 다른 key의 방문은 보지 않는다", () => {
    const visits = [v("2026-09-30"), { date: d("2026-08-20"), kind: "consult" }];
    expect(sched("scalp-care", "2026-08-27", engine, visits).map(row)).toEqual([["scalp-care", "2026-09-24", "2026-09-28", 4, false]]);
  });

  it("시작일 + 12개월을 넘으면 더 안내하지 않는다", () => {
    expect(sched("scalp-care", "2025-10-06", engine, [v("2026-09-14")])).toEqual([]);
    // 9/14 + 28 = 10/12 > 2026-10-06
    expect(sched("scalp-care", "2025-10-20", engine, [v("2026-09-14")]).map((p) => p.originalDate)).toEqual(["2026-10-12"]);
  });
});
