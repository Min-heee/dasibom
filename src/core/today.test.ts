import { describe, expect, it } from "vitest";
import { localDate } from "./calendar";
import type { Patient } from "./patient";
import { buildToday, countRows, SAME_ANGLE_NOTE, type TodayList } from "./today";
import { at, fixtureEngine, NOW } from "./__fixtures__/load";
import { fixturePatient, fixturePatients } from "./__fixtures__/patients";

const engine = fixtureEngine();
const shape = (l: TodayList) => l.groups.map((g) => [g.reason, g.rows.map((r) => [r.patientId, r.reasons.join("+")])]);

describe("buildToday — 2026-09-21(월) 09:00", () => {
  const list = buildToday(fixturePatients(), engine, NOW);

  it("이유별 묶음과 순서: 예정일 지남(오래 밀린 순) → 내일 내원 → 관리 안내 → 주사 재예약 → 사진 회차", () => {
    expect(list.today).toBe("2026-09-21");
    expect(shape(list)).toEqual([
      // P111 3회차 9/8 → 13일, P101 6개월 9/9 → 12일
      ["overdue", [["P111", "overdue+upcoming-visit"], ["P101", "overdue"]]],
      ["upcoming-visit", [["P104", "upcoming-visit+photo-round"]]],
      // 둘 다 9/21 안내 → 환자 ID 순
      ["care-notice", [["P105", "care-notice"], ["P113", "care-notice"]]],
      ["injection-rebook", [["P112", "injection-rebook"]]],
      ["photo-round", []],
    ]);
    expect(countRows(list)).toBe(6);
  });

  it("여러 이유에 걸린 환자는 한 줄: P111은 3회차 미방문 + 4회차 내일(9/22)", () => {
    const row = list.groups[0].rows[0];
    expect(row.items.map((i) => [i.reason, i.point.key, i.point.dueDate, i.daysPastDue ?? null])).toEqual([
      ["overdue", "inj-3", "2026-09-08", 13],
      ["upcoming-visit", "inj-4", "2026-09-22", null],
    ]);
    expect(row.overdue).toMatchObject({ attempts: 0, action: "contact" });
  });

  it("사진 회차에는 같은각도 안내를 붙인다", () => {
    const photo = list.groups[1].rows[0].items.find((i) => i.reason === "photo-round")!;
    expect([photo.point.key, photo.note]).toEqual(["d7", SAME_ANGLE_NOTE]);
  });

  it("간호팀 확인·연락 대기·의료진 확인은 목록과 따로. 날짜 미정(P105 D+7)은 간호팀 확인에 오르고 다른 이유(D+3 안내)는 목록에 그대로", () => {
    expect(list.nurseReview.map((r) => [r.patientId, r.items.map((i) => [i.cause, i.point?.key ?? null]), r.inList])).toEqual([
      ["P103", [["max-attempts", null]], false],
      ["P105", [["no-open-day", "d7"]], true],
    ]);
    expect(list.optedOut).toEqual([]);
    expect(list.waiting.map((r) => [r.patientId, r.overdue.retryOn])).toEqual([["P102", "2026-09-22"]]);
    expect(list.clinicianReview.map((r) => r.patientId)).toEqual(["P110"]);
  });

  it("오늘이 예정일인 시점(P102 4회차, P110 2회차)과 유예 중인 모발이식 시점(P108 4주)은 목록에 없다", () => {
    const ids = list.groups.flatMap((g) => g.rows.map((r) => r.patientId));
    expect(ids).not.toContain("P102");
    expect(ids).not.toContain("P110");
    expect(ids).not.toContain("P108");
  });

  it("결정성: 두 번 만들어도, 환자 순서를 섞어도 같은 목록", () => {
    expect(buildToday(fixturePatients(), engine, NOW)).toEqual(list);
    expect(buildToday([...fixturePatients()].reverse(), engine, NOW)).toEqual(list);
  });
});

describe("buildToday — 2026-09-23(수) 09:00, 추석 연휴 전날", () => {
  const now = at("2026-09-23T09:00:00+09:00");
  const list = buildToday(fixturePatients(), engine, now);

  it("월요일(9/28) 예정자의 '내일 내원'은 연휴 전 마지막 진료일인 수요일에: 4주 9/25(추석) → 9/28로 미룬 환자", () => {
    // 수술 8/28(금): 4주 원래 9/25 → 범위가 없는 시점이라 다음 진료일 9/28(월).
    const p: Patient = { id: "P120", alias: "가명T", procedure: "hair-transplant", startDate: localDate("2026-08-28"), visits: [{ date: localDate("2026-08-29"), kind: "d1" }, { date: localDate("2026-09-04"), kind: "d7" }], contacts: [] };
    const l = buildToday([p], engine, now);
    expect(shape(l)[1]).toEqual(["upcoming-visit", [["P120", "upcoming-visit"]]]);
    expect(l.groups[1].rows[0].items[0].date).toBe("2026-09-28");
  });

  it("날짜 미정인 시점(P105 D+7)은 내일 내원 안내를 만들지 않는다 — 안내할 날짜가 없다", () => {
    expect(list.groups.flatMap((g) => g.rows.map((r) => r.patientId))).not.toContain("P105");
    expect(list.nurseReview.find((r) => r.patientId === "P105")!.items.map((i) => i.cause)).toEqual(["no-open-day"]);
  });

  it("유예가 끝난 환자가 지남으로 넘어가고, 14일을 넘긴 주사 회차는 목록 대신 간호팀 확인(재시작), 유예 중인 주사 회차는 재예약", () => {
    expect(shape(list)).toEqual([
      [
        "overdue",
        [
          ["P101", "overdue"], // 6개월 9/9 → 14일
          ["P108", "overdue"], // 4주 9/14 → 9일
          ["P112", "overdue"], // 3회차 9/18 → 5일(유예 끝 9/21)
        ],
      ],
      ["upcoming-visit", []],
      ["care-notice", [["P113", "care-notice"]]], // 9/21 + 유예 3일
      ["injection-rebook", [["P110", "injection-rebook"]]], // 2회차 9/21, 유예 중
      ["photo-round", []],
    ]);
    // P102 3회차 9/7 → 16일, P111 3회차 9/8 → 15일: 14일 넘게 빠져 재시작. 그 뒤 4회차(유예 중)는 재시작 전이라 재예약을 붙이지 않는다.
    expect(list.nurseReview.map((r) => [r.patientId, r.items.map((i) => i.cause).join("+")])).toEqual([
      ["P103", "max-attempts"],
      ["P102", "injection-restart"],
      ["P111", "injection-restart"],
      ["P105", "no-open-day"],
    ]);
    expect(list.waiting).toEqual([]);
  });
});

describe("buildToday — 수신 거부", () => {
  it("연락 원치 않음을 적은 환자는 오늘 목록·재연락 대기·간호팀 확인 어디에도 없고 수신 거부 목록에만(걸려 있던 것과 함께)", () => {
    const opt = (id: string) => ({ ...fixturePatient(id), contacts: [...fixturePatient(id).contacts, { at: "2026-09-20T10:00:00+09:00", result: "opt-out" as const }] });
    const l = buildToday([opt("P111"), opt("P102"), opt("P103")], engine, NOW);
    expect(countRows(l)).toBe(0);
    expect([l.waiting, l.nurseReview]).toEqual([[], []]);
    expect(l.optedOut.map((o) => [o.patientId, o.held])).toEqual([
      ["P102", { reasons: [], nurse: [], waiting: true }],
      ["P103", { reasons: [], nurse: ["max-attempts"], waiting: false }],
      ["P111", { reasons: ["overdue", "upcoming-visit"], nurse: [], waiting: false }],
    ]);
  });

  it("증상 메모의 의료진 확인은 수신 거부여도 남는다(연락 목록이 아니라 안전 확인)", () => {
    const p = { ...fixturePatient("P110"), contacts: [...fixturePatient("P110").contacts, { at: "2026-09-20T10:00:00+09:00", result: "opt-out" as const }] };
    const l = buildToday([p], engine, NOW);
    expect(l.clinicianReview.map((c) => [c.patientId, c.optedOut])).toEqual([["P110", true]]);
  });

  it("수신 거부 풀기 뒤에는 다시 목록에 오르고, 거부·풀기는 '이미 연락함'으로 보지 않는다", () => {
    const p = {
      ...fixturePatient("P105"),
      contacts: [
        { at: "2026-09-21T08:00:00+09:00", result: "opt-out" as const },
        { at: "2026-09-21T08:30:00+09:00", result: "opt-in" as const },
      ],
    };
    const l = buildToday([p], engine, NOW);
    expect(shape(l)[2]).toEqual(["care-notice", [["P105", "care-notice"]]]);
    expect(l.optedOut).toEqual([]);
  });
});

describe("buildToday — 이미 처리한 연락", () => {
  it("안내 시점 날짜 이후 연락 기록이 있으면 관리 안내에서 빠진다", () => {
    const p = { ...fixturePatient("P105"), contacts: [{ at: "2026-09-21T08:30:00+09:00", result: "sms" as const }] };
    expect(countRows(buildToday([p], engine, NOW))).toBe(0);
  });

  it("내일 내원: 안내일(오늘) 이후 연락했으면 빠진다. 그 전의 연락은 처리로 보지 않는다", () => {
    const base = fixturePatient("P104");
    const done = { ...base, contacts: [{ at: "2026-09-21T08:00:00+09:00", result: "called" as const }] };
    const earlier = { ...base, contacts: [{ at: "2026-09-19T10:00:00+09:00", result: "called" as const }] };
    expect(countRows(buildToday([done], engine, NOW))).toBe(0);
    expect(countRows(buildToday([earlier], engine, NOW))).toBe(1);
  });

  it("주사 재예약: 예정일 다음 날 이후 연락했으면 빠진다", () => {
    const p = { ...fixturePatient("P112"), contacts: [{ at: "2026-09-19T10:00:00+09:00", result: "no-answer" as const }] };
    expect(countRows(buildToday([p], engine, NOW))).toBe(0);
  });

  it("연락을 적으면 예정일 지남 환자는 재연락 간격 동안 대기로 옮겨 간다", () => {
    const p = { ...fixturePatient("P101"), contacts: [...fixturePatient("P101").contacts, { at: "2026-09-21T09:10:00+09:00", result: "no-answer" as const }] };
    const l = buildToday([p], engine, at("2026-09-21T09:20:00+09:00"));
    expect(countRows(l)).toBe(0);
    expect(l.waiting.map((w) => [w.patientId, w.overdue.attempts, w.overdue.retryOn, w.overdue.nextContactDate])).toEqual([["P101", 2, "2026-09-24", "2026-09-28"]]);
  });
});
