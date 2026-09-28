import { describe, expect, it } from "vitest";
import { applyContact, currentPatients, EMPTY_LOG, nextContactAfter, nextListedDay, undoContact, undoLastFor, type ContactLog } from "./contact";
import { buildToday, countRows } from "./today";
import { at, fixtureEngine, NOW } from "./__fixtures__/load";
import { fixturePatients } from "./__fixtures__/patients";

const engine = fixtureEngine();

function apply(log: ContactLog, patientId: string, iso: string, result: "called" | "no-answer" | "sms" | "later" = "no-answer") {
  const r = applyContact(base, log, { patientId, contact: { at: iso, result } });
  if (!r.ok) throw new Error(r.error);
  return r.log;
}

const base = Object.freeze(fixturePatients());
const snapshot = structuredClone(fixturePatients());

describe("applyContact · undoContact", () => {
  it("부재를 적으면 다음 연락일이 규칙대로 바뀐다: P101 9/21 부재 → 9/24(추석) → 9/28", () => {
    const log = apply(EMPTY_LOG, "P101", "2026-09-21T09:30:00+09:00");
    const p = currentPatients(base, log).find((x) => x.id === "P101")!;
    const n = nextContactAfter(p, engine, at("2026-09-21T09:30:00+09:00"));
    expect([n.overdue?.attempts, n.nextContactDate]).toEqual([2, "2026-09-28"]);
  });

  it("세 번째 시도면 간호팀 확인으로 넘어가 다음 연락일이 없다", () => {
    let log = apply(EMPTY_LOG, "P101", "2026-09-21T09:30:00+09:00");
    log = apply(log, "P101", "2026-09-28T10:00:00+09:00", "later");
    const p = currentPatients(base, log).find((x) => x.id === "P101")!;
    const n = nextContactAfter(p, engine, at("2026-09-28T10:00:00+09:00"));
    expect([n.overdue?.attempts, n.overdue?.action, n.nextContactDate]).toEqual([3, "nurse", null]);
  });

  it("되돌리기: 마지막 연락을 빼면 목록이 원래대로. 원본은 한 번도 바뀌지 않는다", () => {
    const now = at("2026-09-21T09:40:00+09:00");
    const before = buildToday([...base], engine, now);
    const log = apply(apply(EMPTY_LOG, "P101", "2026-09-21T09:30:00+09:00"), "P111", "2026-09-21T09:35:00+09:00", "called");
    expect(countRows(buildToday(currentPatients(base, log), engine, now))).toBe(countRows(before) - 2); // P101은 대기로, P111은 미방문 대기 + 내일 내원 연락까지 처리됨
    const u1 = undoContact(log);
    expect(u1.undone?.patientId).toBe("P111");
    const u2 = undoContact(u1.log);
    expect(u2.log).toEqual(EMPTY_LOG);
    expect(buildToday(currentPatients(base, u2.log), engine, now)).toEqual(before);
    expect(undoContact(EMPTY_LOG)).toEqual({ log: EMPTY_LOG, undone: null });
    expect(fixturePatients()).toEqual(snapshot);
    expect([...base]).toEqual(snapshot);
  });

  it("마지막 연락보다 앞선 시각, 모르는 환자, 시간대 없는 시각은 거부한다", () => {
    expect(applyContact(base, EMPTY_LOG, { patientId: "P101", contact: { at: "2026-09-16T10:00:00+09:00", result: "called" } })).toEqual({
      ok: false,
      error: "마지막 연락(2026-09-17T10:00:00+09:00)보다 앞선 시각입니다: 2026-09-16T10:00:00+09:00",
    });
    expect(applyContact(base, EMPTY_LOG, { patientId: "P999", contact: { at: "2026-09-21T10:00:00+09:00", result: "called" } }).ok).toBe(false);
    expect(applyContact(base, EMPTY_LOG, { patientId: "P101", contact: { at: "2026-09-21T10:00:00", result: "called" } }).ok).toBe(false);
  });
});

describe("applyContact — 예약 잡음·연락 원치 않음", () => {
  const book = (booking: unknown, result = "booked") =>
    applyContact(base, EMPTY_LOG, { patientId: "P101", contact: { at: "2026-09-21T09:30:00+09:00", result, booking } as never });

  it("예약 잡음은 { pointKey, date }가 있어야 하고 연락한 날보다 이를 수 없다. 다른 결과에는 예약을 붙일 수 없다", () => {
    expect(book(undefined)).toEqual({ ok: false, error: "예약 잡음에는 { pointKey, date }가 있어야 합니다" });
    expect(book({ pointKey: "m6", date: "2026-9-28" })).toEqual({ ok: false, error: "예약 잡음에는 { pointKey, date }가 있어야 합니다" });
    expect(book({ pointKey: "m6", date: "2026-09-20" })).toEqual({ ok: false, error: "예약 날짜(2026-09-20)가 연락한 날보다 이릅니다" });
    expect(book({ pointKey: "m6", date: "2026-09-28" }, "called")).toEqual({ ok: false, error: "예약 잡음이 아닌 연락에 예약 날짜가 있습니다" });
    expect(book({ pointKey: "m6", date: "2026-09-21" }).ok).toBe(true);
  });

  it("P101 예약 9/28 → 오늘 목록에서 빠지고, 9/28이 지나도 오지 않으면 9/29부터 다시 예정일 지남", () => {
    const r = book({ pointKey: "m6", date: "2026-09-28" });
    if (!r.ok) throw new Error(r.error);
    const now = at("2026-09-21T09:40:00+09:00");
    const ids = (ms: number) => buildToday(currentPatients(base, r.log), engine, ms).groups.flatMap((g) => g.rows.map((x) => [x.patientId, g.reason]));
    expect(ids(now).filter(([id]) => id === "P101")).toEqual([]);
    // 내일 내원 안내는 예약 날짜의 전 진료일(9/23 수, 추석 연휴 전)에.
    expect(ids(at("2026-09-23T09:00:00+09:00")).filter(([id]) => id === "P101")).toEqual([["P101", "upcoming-visit"]]);
    expect(ids(at("2026-09-29T09:00:00+09:00")).filter(([id]) => id === "P101")).toEqual([["P101", "overdue"]]);
  });

  it("연락 원치 않음 → 모든 연락 목록에서 빠지고 수신 거부 목록에, 되돌리면 원래대로", () => {
    const now = at("2026-09-21T09:40:00+09:00");
    const before = buildToday([...base], engine, now);
    const r = applyContact(base, EMPTY_LOG, { patientId: "P103", contact: { at: "2026-09-21T09:30:00+09:00", result: "opt-out" } });
    if (!r.ok) throw new Error(r.error);
    const after = buildToday(currentPatients(base, r.log), engine, now);
    expect(after.nurseReview.map((x) => x.patientId)).not.toContain("P103");
    expect(after.optedOut.map((o) => [o.patientId, o.held.nurse])).toEqual([["P103", ["max-attempts"]]]);
    expect(nextContactAfter(currentPatients(base, r.log).find((p) => p.id === "P103")!, engine, now).overdue?.attempts).toBe(3); // 시도로 세지 않음
    expect(buildToday(currentPatients(base, undoContact(r.log).log), engine, now)).toEqual(before);
  });
});

describe("undoLastFor — 환자 화면의 되돌리기", () => {
  it("그 환자의 마지막 연락만 빼고 다른 환자의 연락은 그대로", () => {
    let log = apply(EMPTY_LOG, "P101", "2026-09-21T09:00:00+09:00");
    log = apply(log, "P111", "2026-09-21T09:00:00+09:00", "called");
    log = apply(log, "P101", "2026-09-21T09:00:00+09:00", "sms");
    const u = undoLastFor(log, "P111");
    expect(u.undone?.patientId).toBe("P111");
    expect(u.log.applied.map((a) => [a.patientId, a.contact.result])).toEqual([
      ["P101", "no-answer"],
      ["P101", "sms"],
    ]);
    expect(undoLastFor(log, "P999")).toEqual({ log, undone: null });
    expect(log.applied).toHaveLength(3); // 원래 쌓임은 바뀌지 않는다
  });
});

describe("nextListedDay — 연락을 적은 뒤 다시 목록에 오르는 날", () => {
  const withContact = (id: string, result: "called" | "no-answer") => currentPatients(base, apply(EMPTY_LOG, id, "2026-09-21T09:00:00+09:00", result)).find((p) => p.id === id)!;

  it("P101 부재(2회째) → 9/24부터 다시인데 9/24~26 추석·9/27 일요일 → 9/28(월) 예정일 지남", () => {
    expect(nextListedDay(withContact("P101", "no-answer"), engine, NOW)).toEqual({ date: "2026-09-28", reasons: ["overdue"] });
  });

  it("P104 내일 내원(9/22) 안내 통화 → 오지 않으면 유예 끝(9/24) 다음 첫 진료일 9/28에 예정일 지남", () => {
    expect(nextListedDay(withContact("P104", "called"), engine, NOW)).toEqual({ date: "2026-09-28", reasons: ["overdue"] });
  });

  it("P103 간호팀 확인(최대 시도)은 코디네이터 목록에 다시 오르지 않는다", () => {
    expect(nextListedDay(base.find((p) => p.id === "P103")!, engine, NOW)).toBeNull();
  });
});
