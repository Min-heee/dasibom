import { describe, expect, it } from "vitest";
import { DEMO_NOW, DEMO_NOW_MS } from "./clock";
import { mustDemo, type EvalBundle } from "./data";
import { evalBundle as bundle } from "./evalData";
import { evaluateBundle } from "./evaluate";

/**
 * 평가 계산이 **틀린 것을 틀렸다고 말하는지**를 먼저 본다(기대값을 일부러 바꾼 번들). 그다음 지금 번들의 결과.
 * 분모는 코드 결과가 아니라 기대값 파일에서 직접 센다.
 */
const { engine, patients } = mustDemo();
const run = (b: EvalBundle = bundle) => evaluateBundle(b, engine, patients, DEMO_NOW_MS);

describe("evaluateBundle — 틀린 기대값을 잡는다", () => {
  it("P001 6개월 미룬 날짜를 9/10으로 바꾸면 그 시점 하나가 '다름'으로 나온다", () => {
    const b = structuredClone(bundle);
    b.expected.patients.find((p) => p.id === "P001")!.points.find((p) => p.key === "m6")!.due = "2026-09-10";
    const e = run(b);
    expect(e.mismatches).toEqual([{ group: "시점", target: "P001 m6", field: "미룬 날짜", expected: "2026-09-10", actual: "2026-09-09" }]);
    expect(e.accuracy.total - e.accuracy.matched).toBe(1);
    expect(e.allChecks.total - e.allChecks.matched).toBe(1);
  });

  it("심은 사례 의도를 바꾸면(P011 대조군을 '지남 목록'으로) 틀린 사례와 미방문 누락으로 나온다", () => {
    const b = structuredClone(bundle);
    const p = b.planted.find((x) => x.id === "P011")!;
    p.expectReasons = ["overdue"];
    p.expectOverdue = "listed";
    const e = run(b);
    expect(e.planted.wrong.map((w) => w.id)).toEqual(["P011"]);
    expect(e.missedOverdue.missing).toEqual(["P011"]);
  });

  it("오늘 목록 기대에서 한 줄을 빼면 엔진에만 있는 줄로 나온다", () => {
    const b = structuredClone(bundle);
    b.expected.todayList = b.expected.todayList.filter((x) => x.id !== "P043");
    expect(run(b).mismatches).toEqual([{ group: "오늘 목록", target: "P043", field: "이유", expected: "목록에 없음", actual: "[care-notice]" }]);
  });
});

describe("evaluateBundle — 지금 번들", () => {
  const e = run();
  const exp = bundle.expected;

  it("기준 시각이 기대값 표와 같다", () => {
    expect(exp.asOf).toBe(DEMO_NOW);
  });

  it("분모는 기대값 파일에서 센 수: 시점(환자·가상 입력), 오늘 목록 줄, 세 목록, 환자별 미방문, 시간대 시각", () => {
    const g = Object.fromEntries(e.groups.map((x) => [x.id, x.total]));
    expect(g.points).toBe(exp.patients.reduce((n, p) => n + p.points.length, 0));
    expect(g.hypotheticals).toBe(exp.hypotheticals.reduce((n, h) => n + h.points.length, 0));
    expect(g.today).toBe(exp.todayList.length);
    expect([g.director, g.waiting, g.medical]).toEqual([exp.directorReview.length, exp.waitingRetry.length, exp.medicalReview.length]);
    expect(g.overdue).toBe(exp.patients.length);
    expect(g.window).toBe(exp.contactWindowChecks.length);
  });

  it("일정 계산 정확도의 분모는 일정(시점 + 가상 입력)만, 대조 전체는 모든 묶음", () => {
    const g = Object.fromEntries(e.groups.map((x) => [x.id, x.total]));
    expect(e.accuracy.total).toBe(g.points + g.hypotheticals);
    expect(e.allChecks.total).toBe(e.groups.reduce((n, x) => n + x.total, 0));
  });

  it("PRD 6절 기준: 정확도 전부, 미방문 누락 0, 결정성 0, 시간대 위반 0, 심은 사례 모두", () => {
    expect(e.mismatches).toEqual([]);
    expect(e.accuracy.matched).toBe(e.accuracy.total);
    expect(e.missedOverdue).toMatchObject({ missing: [], total: bundle.planted.filter((p) => p.expectOverdue !== null).length });
    expect(e.determinism.differing).toBe(0);
    expect([e.window.engineViolations, e.window.screenViolations]).toEqual([0, 0]);
    expect(e.planted.wrong).toEqual([]);
  });

  it("변이 기록: 1차 생존 9개(정렬 6·파서 2·연락일 1), 2차 생존 0", () => {
    expect(e.mutation.survivors1.map((m) => m.id)).toEqual(["M10b", "M10f", "M10g", "M10h", "M10i", "M10j", "M13c", "M13e", "M15e"]);
    expect(e.mutation.survivors2).toEqual([]);
  });
});
