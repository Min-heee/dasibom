import { describe, expect, it } from "vitest";
import { localDate } from "./calendar";
import type { Contact, Patient } from "./patient";
import { buildToday, evaluatePatient } from "./today";
import { at, fixtureEngine, NOW } from "./__fixtures__/load";
import { fixturePatient } from "./__fixtures__/patients";

const engine = fixtureEngine();
const withContact = (p: Patient, c: Contact): Patient => ({ ...p, contacts: [...p.contacts, c] });

// 8/10(월) 첫 주사, 2~4회차 완료. 5회차 원래 10/5(대체공휴일) → 허용 범위 안 10/6(미룸). 6회차 10/19(월).
const shiftedInj: Patient = {
  id: "P900", alias: "가명Z", procedure: "injection", startDate: localDate("2026-08-10"),
  visits: [{ date: localDate("2026-08-24"), kind: "inj-2" }, { date: localDate("2026-09-07"), kind: "inj-3" }, { date: localDate("2026-09-21"), kind: "inj-4" }],
  contacts: [],
};

describe("변이 시험 빈틈 — 기준 시각 뒤 기록(D3·E7)", () => {
  it("기준 시각 뒤에 적은 연락 원치 않음은 아직 없는 것: P101은 오늘 목록에 있고 수신 거부 목록에 없다", () => {
    const p = withContact(fixturePatient("P101"), { at: "2026-09-21T10:00:00+09:00", result: "opt-out" });
    const l = buildToday([p], engine, NOW);
    expect(l.optedOut).toEqual([]);
    expect(l.groups[0].rows.map((r) => r.patientId)).toEqual(["P101"]);
  });

  it("기준 시각 뒤에 적은 예약은 오늘 목록 판정에도 없는 것: P101 6개월은 아직 예정일 지남", () => {
    const p = withContact(fixturePatient("P101"), { at: "2026-09-21T10:00:00+09:00", result: "booked", booking: { pointKey: "m6", date: localDate("2026-09-28") } });
    const day = evaluatePatient(p, engine, NOW);
    expect(day.statuses.find((s) => s.point.key === "m6")!.state).toBe("missed");
    expect(day.items.map((i) => i.reason)).toEqual(["overdue"]);
  });
});

describe("변이 시험 빈틈 — 수신 거부 환자의 간호팀 확인(D5)", () => {
  it("최대 시도(P103)에 연락 원치 않음 → evaluatePatient.nurse는 비고, 걸렸을 것은 optOut.heldNurse에만", () => {
    const p = withContact(fixturePatient("P103"), { at: "2026-09-20T10:00:00+09:00", result: "opt-out" });
    const day = evaluatePatient(p, engine, NOW);
    expect(day.nurse).toEqual([]);
    expect(day.optOut!.heldNurse.map((n) => n.cause)).toEqual(["max-attempts"]);
  });
});

describe("변이 시험 빈틈 — 재시작 기준일(F3·F11)", () => {
  it("휴진으로 미룬 회차는 옮긴 날짜(10/6)에서 센다: 10/20은 14일이라 아님, 10/21은 15일 → 재시작", () => {
    const s = (iso: string) => evaluatePatient(shiftedInj, engine, at(iso)).statuses.find((x) => x.point.key === "inj-5")!;
    expect([s("2026-10-20T09:00:00+09:00").point.dueDate, s("2026-10-20T09:00:00+09:00").point.shift]).toEqual(["2026-10-06", "later"]);
    expect(s("2026-10-20T09:00:00+09:00").restart).toBeUndefined();
    expect(s("2026-10-21T09:00:00+09:00").restart).toBe(true);
  });

  it("14일 넘게 빠진 회차가 둘이면 재시작은 첫 회차(5회차)에, 6회차는 재시작 전", () => {
    const day = evaluatePatient(shiftedInj, engine, at("2026-11-05T09:00:00+09:00"));
    expect(day.statuses.slice(3, 5).map((s) => [s.point.key, s.state, s.restart ?? false])).toEqual([
      ["inj-5", "missed", true],
      ["inj-6", "on-hold", false],
    ]);
    expect(day.nurse.map((n) => [n.cause, n.point?.key])).toEqual([["injection-restart", "inj-5"]]);
  });
});

// 독립 대조 불일치 1: 예정일에서 14일 넘게 지난 뒤 앞날로 예약해도 재시작이다(D01은 예약으로 재시작을 빼 주지 않는다).
// 8/18 첫 주사, 2회차 9/1·3회차 9/15 미방문, 9/18에 2회차를 9/23으로 예약. 9/21은 2회차 예정일에서 20일.
const lateBooked: Patient = {
  id: "P904", alias: "가명Y", procedure: "injection", startDate: localDate("2026-08-18"),
  visits: [],
  contacts: [{ at: "2026-09-18T10:00:00+09:00", result: "booked", booking: { pointKey: "inj-2", date: localDate("2026-09-23") } }],
};

describe("재시작은 앞으로 잡힌 예약으로 빠지지 않는다(독립 대조 불일치 1)", () => {
  it("2회차는 예약 잡음이면서 재시작, 3회차는 재시작 전 → 코디네이터 목록이 아니라 간호팀 확인", () => {
    const day = evaluatePatient(lateBooked, engine, NOW);
    expect(day.statuses.slice(0, 2).map((s) => [s.point.key, s.state, s.restart ?? false])).toEqual([
      ["inj-2", "booked", true],
      ["inj-3", "on-hold", false],
    ]);
    expect(day.overdue).toBeNull();
    expect(day.items).toEqual([]);
    expect(day.nurse.map((n) => [n.cause, n.point?.key, n.booking?.date])).toEqual([["injection-restart", "inj-2", "2026-09-23"]]);
    const l = buildToday([lateBooked], engine, NOW);
    expect(l.nurseReview.map((r) => r.patientId)).toEqual(["P904"]);
    expect(l.groups.flatMap((g) => g.rows)).toEqual([]);
  });

  it("경계: 앞으로 잡힌 예약이어도 예정일에서 14일째는 재시작 아님, 15일째는 재시작", () => {
    const p: Patient = { ...lateBooked, contacts: [{ at: "2026-09-10T10:00:00+09:00", result: "booked", booking: { pointKey: "inj-2", date: localDate("2026-09-17") } }] };
    const s = (iso: string) => evaluatePatient(p, engine, at(iso)).statuses[0];
    expect([s("2026-09-15T09:00:00+09:00").state, s("2026-09-15T09:00:00+09:00").restart]).toEqual(["booked", undefined]);
    expect([s("2026-09-16T09:00:00+09:00").state, s("2026-09-16T09:00:00+09:00").restart]).toEqual(["booked", true]);
  });
});
