import { describe, expect, it } from "vitest";
import { kstDateOf, localDate } from "./calendar";
import type { Patient } from "./patient";
import { buildSchedule } from "./schedule";
import { contactDate, evaluatePoints, overdueState, symptomNotes } from "./status";
import { at, fixtureEngine, NOW } from "./__fixtures__/load";
import { fixturePatient } from "./__fixtures__/patients";

const engine = fixtureEngine();

function evalAt(p: Patient, nowMs = NOW) {
  const today = kstDateOf(nowMs);
  const statuses = evaluatePoints(buildSchedule(p, today, engine.rules, engine.calendar), p.visits, today);
  return { statuses, overdue: overdueState(statuses, p.contacts, engine.rules, engine.calendar, nowMs) };
}
const states = (p: Patient, nowMs = NOW) => evalAt(p, nowMs).statuses.map((s) => [s.point.key, s.state]);
const withVisit = (p: Patient, date: string, kind: string): Patient => ({ ...p, visits: [...p.visits, { date: localDate(date), kind }] });

describe("evaluatePoints — 방문 매칭(시점 key)", () => {
  it("P101: 6개월(9/9) 유예 끝 9/16까지 안 옴 → 미방문, 9/17부터 지남, 예정일 12일 지남", () => {
    const { statuses } = evalAt(fixturePatient("P101"));
    expect(statuses.map((s) => [s.point.key, s.state])).toEqual([
      ["d1", "done"],
      ["d3", "notice"],
      ["d7", "done"],
      ["d14", "notice"],
      ["w4", "done"],
      ["m6", "missed"],
      ["y1", "upcoming"],
    ]);
    const m6 = statuses[5];
    expect([m6.windowStart, m6.graceEnd, m6.overdueSince, m6.daysPastDue]).toEqual(["2026-09-02", "2026-09-16", "2026-09-17", 12]);
  });

  it("P107: earlyDays 경계(3일 전)에 온 방문은 완료(일찍 옴), 하루 더 이르면 그 시점의 완료가 아니다", () => {
    const s = evalAt(fixturePatient("P107")).statuses[0];
    expect(s).toMatchObject({ state: "done", early: true, visit: { date: "2026-09-12" } });
    const tooEarly = { ...fixturePatient("P107"), visits: [{ date: localDate("2026-09-11"), kind: "inj-2" }] };
    expect(evalAt(tooEarly).statuses[0].state).toBe("missed"); // 2회차 9/15, 유예 끝 9/18
  });

  it("P108: 늦게 온 방문도 완료. 4주는 유예 마지막 날(오늘)이라 유예 중, 다음 날 미방문 8일", () => {
    expect(states(fixturePatient("P108")).filter(([, s]) => s !== "notice")).toEqual([
      ["d1", "done"],
      ["d7", "done"],
      ["w4", "in-grace"],
      ["m6", "upcoming"],
      ["y1", "upcoming"],
    ]);
    const next = evalAt(fixturePatient("P108"), at("2026-09-22T09:00:00+09:00")).statuses[4];
    expect([next.state, next.overdueSince, next.daysPastDue]).toEqual(["missed", "2026-09-22", 8]);
  });

  it("P109: 4주를 놓쳤어도 6개월에 왔으면 4주 미방문은 '건너뜀'(연락 대상 아님)", () => {
    const p = fixturePatient("P109");
    expect(states(p).filter(([, s]) => s !== "notice")).toEqual([
      ["d1", "done"],
      ["d7", "done"],
      ["w4", "skipped"],
      ["m6", "done"],
      ["y1", "upcoming"],
    ]);
    expect(evalAt(p).overdue).toBeNull();
  });

  it("key가 다른 방문은 날짜가 맞아도 완료로 보지 않는다", () => {
    expect(evalAt(withVisit(fixturePatient("P101"), "2026-09-09", "w4")).statuses[5].state).toBe("missed");
    expect(evalAt(withVisit(fixturePatient("P101"), "2026-09-09", "m6")).statuses[5].state).toBe("done");
  });

  it("기준일 뒤의 방문 기록은 보지 않는다", () => {
    expect(evalAt(withVisit(fixturePatient("P101"), "2026-09-22", "m6")).statuses[5].state).toBe("missed");
  });

  it("오늘이 예정일이면 due-today, 휴진으로 밀린 시점의 앞쪽 창은 원래 날짜에서 센다", () => {
    expect(evalAt(fixturePatient("P102")).statuses[2].state).toBe("due-today"); // 4회차 9/21
    const d7 = evalAt(fixturePatient("P105")).statuses[2]; // 원래 9/25(추석) → 9/28
    expect([d7.windowStart, d7.graceEnd]).toEqual(["2026-09-24", "2026-09-30"]);
  });
});

describe("overdueState — 재연락 간격과 최대 시도", () => {
  it("P101: 9/17 부재 1회 → 9/20부터 다시(진료일로는 9/21), 오늘 연락", () => {
    const o = evalAt(fixturePatient("P101")).overdue!;
    expect([o.since, o.attempts, o.retryOn, o.nextContactDate, o.action]).toEqual(["2026-09-17", 1, "2026-09-20", "2026-09-21", "contact"]);
  });

  it("P102: 9/19 부재 → 9/22부터 다시. 오늘은 대기, 9/22에는 연락", () => {
    const o = evalAt(fixturePatient("P102")).overdue!;
    expect([o.since, o.attempts, o.retryOn, o.action]).toEqual(["2026-09-11", 1, "2026-09-22", "waiting"]);
    expect(evalAt(fixturePatient("P102"), at("2026-09-22T09:00:00+09:00")).overdue!.action).toBe("contact");
  });

  it("P103: 지남(9/12) 뒤 세 번 시도 → 원장 확인", () => {
    const o = evalAt(fixturePatient("P103")).overdue!;
    expect([o.since, o.attempts, o.action, o.missed[0].daysPastDue]).toEqual(["2026-09-12", 3, "escalate", 17]);
  });

  it("P111: 연락 기록 없음 → 지남이 된 날(9/12)부터 연락 대상", () => {
    const o = evalAt(fixturePatient("P111")).overdue!;
    expect([o.since, o.attempts, o.retryOn, o.action, o.missed[0].daysPastDue]).toEqual(["2026-09-12", 0, "2026-09-12", "contact", 13]);
  });

  it("지남 전의 연락은 시도로 세지 않는다", () => {
    const p = { ...fixturePatient("P111"), contacts: [{ at: "2026-09-11T10:00:00+09:00", result: "called" as const }] };
    expect(evalAt(p).overdue!.attempts).toBe(0);
  });

  it("기준 시각 뒤의 연락은 세지 않는다", () => {
    const p = { ...fixturePatient("P101"), contacts: [...fixturePatient("P101").contacts, { at: "2026-09-21T10:00:00+09:00", result: "no-answer" as const }] };
    expect(evalAt(p).overdue!.attempts).toBe(1);
    expect(evalAt(p, at("2026-09-21T10:00:00+09:00")).overdue!.attempts).toBe(2);
  });

  // 변이 검사 M15e: 연락일은 글자 앞 10자가 아니라 KST 달력 날짜다. UTC(Z)로 적힌 연락이 KST로는 다음 날인 경우.
  it("UTC로 적힌 연락도 KST 날짜로 센다: 2026-09-16T15:30Z = 9/17 00:30 KST → 지남(9/17) 뒤 시도 1회", () => {
    expect(contactDate({ at: "2026-09-20T15:30:00Z", result: "called" })).toBe("2026-09-21");
    expect(contactDate({ at: "2026-09-20T14:59:00Z", result: "called" })).toBe("2026-09-20");
    const p = { ...fixturePatient("P101"), contacts: [{ at: "2026-09-16T15:30:00Z", result: "no-answer" as const }] };
    const o = evalAt(p).overdue!;
    expect([o.since, o.attempts, o.retryOn, o.action]).toEqual(["2026-09-17", 1, "2026-09-20", "contact"]);
  });

  it("다시 올릴 날이 연휴에 걸리면 화면의 다음 연락은 다음 진료일: 9/22 부재 → 9/25(추석) → 9/28", () => {
    const p = { ...fixturePatient("P102"), contacts: [...fixturePatient("P102").contacts, { at: "2026-09-22T10:00:00+09:00", result: "no-answer" as const }] };
    const o = evalAt(p, at("2026-09-23T09:00:00+09:00")).overdue!;
    expect([o.attempts, o.retryOn, o.nextContactDate, o.action]).toEqual([2, "2026-09-25", "2026-09-28", "waiting"]);
  });
});

describe("symptomNotes — 증상 메모 → 의료진 확인(한창구 적신호 규칙 그대로)", () => {
  it("P110: '주사'(문맥) + 모호어가 있는 메모만 표시하고, 메모의 전화번호는 가린다. 문맥 없는 모호어('붓기')는 통과", () => {
    expect(symptomNotes(fixturePatient("P110"), engine.redflag, NOW)).toEqual([
      {
        at: "2026-09-16T14:00:00+09:00",
        noteMasked: "주사 맞은 자리가 부어 있고 열감이 있다고 함. 보호자 [전화]",
        // 한창구 원본은 공백을 모두 지워 "있고 열감"의 "고열"을 증상어로 잡았다(RF-01, 메모에 없는 말).
        // 다시봄 복사본은 어절 중간에서 시작해 다음 어절로 넘어가는 적중을 받지 않는다(redflag.ts matchesTerm).
        ruleIds: ["RF-03"],
        matchedSymptoms: [],
        matchedAmbiguous: ["부어", "열감"],
      },
    ]);
  });

  it("증상어(고름)는 문맥 없이도 표시한다", () => {
    const p = { ...fixturePatient("P104"), contacts: [{ at: "2026-09-18T10:00:00+09:00", result: "called" as const, note: "고름이 보인다고 함" }] };
    expect(symptomNotes(p, engine.redflag, NOW).map((s) => [s.ruleIds, s.matchedSymptoms])).toEqual([[["RF-02"], ["고름"]]]);
  });
});
