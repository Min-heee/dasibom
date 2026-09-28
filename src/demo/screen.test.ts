import { describe, expect, it } from "vitest";
import { kstInstant, localDate } from "@/core/calendar";
import { EMPTY_LOG, type ContactLog } from "@/core/contact";
import type { Booking, ContactResult } from "@/core/patient";
import { DEMO_NOW_MS, DEMO_TODAY } from "./clock";
import { mustDemo } from "./data";
import { checkBookingInput, patientFor, todayFor } from "./screen";
import { recordDemo } from "./storage";

/**
 * 버튼 → 기록 → 목록·환자 화면 재계산의 연결(PRD 3절 6~13초, F6). 화면 컴포넌트는 이 두 함수의 결과를 그리기만 하므로,
 * 여기서 로그를 넣어 보면 "연락을 적었는데 목록이 그대로" 같은 결함이 잡힌다. 기대값은 달력을 보고 센 값.
 */
const { engine, patients } = mustDemo();

function press(log: ContactLog, id: string, result: ContactResult, booking?: Booking): ContactLog {
  const r = recordDemo(patients, log, id, result, booking);
  if (!r.ok) throw new Error(r.error);
  return r.log;
}

const at = (hhmm: string) => kstInstant(DEMO_TODAY, hhmm);

describe("todayFor — 연락을 적으면 첫 화면이 다시 계산된다", () => {
  it("P004 부재: 목록 27명 → 26명, P004는 재연락 대기(9/21 + 3일 = 9/24 추석 → 9/28부터)", () => {
    const before = todayFor(patients, engine, EMPTY_LOG, DEMO_NOW_MS);
    const after = todayFor(patients, engine, press(EMPTY_LOG, "P004", "no-answer"), DEMO_NOW_MS);
    expect([before.total, after.total]).toEqual([27, 26]);
    expect(after.groups[0].rows.some((r) => r.patientId === "P004")).toBe(false);
    expect(after.waiting.find((w) => w.patientId === "P004")?.next).toBe("9/28(월)부터 다시 연락(9/24(목)은 휴진)");
  });

  it("P001 부재(이미 2회): 간호팀 확인으로 옮겨 가고 목록에서 빠진다", () => {
    const after = todayFor(patients, engine, press(EMPTY_LOG, "P001", "no-answer"), DEMO_NOW_MS);
    expect(after.nurse.find((n) => n.patientId === "P001")?.causes).toEqual(["최대 시도까지 닿지 않음"]);
    expect(after.total).toBe(26);
  });

  it("P004 연락 원치 않음 → 모든 연락 목록에서 빠지고 수신 거부에, 수신 거부 풀기(같은 시각이라 결과 바꾸기)로 되돌린다", () => {
    const log = press(EMPTY_LOG, "P004", "opt-out");
    const after = todayFor(patients, engine, log, DEMO_NOW_MS);
    expect(after.total).toBe(26);
    expect(after.optedOut.map((o) => [o.patientId, o.held])).toEqual([
      ["P004", "수신 거부가 아니었다면: 예정일 지남"],
      ["P121", "수신 거부가 아니었다면: 예정일 지남"],
    ]);
    expect([...after.waiting, ...after.nurse].some((r) => r.patientId === "P004")).toBe(false);
    const back = press(log, "P004", "opt-in");
    expect(back.applied).toHaveLength(1);
    // 풀기는 연락 시도가 아니라서 P004는 다시 '첫 연락' 차례로 목록에 돌아온다.
    expect(todayFor(patients, engine, back, DEMO_NOW_MS).total).toBe(27);
  });

  it("P121 수신 거부 풀기 → 예정일 지남 목록으로(9/16 부재 + 3일 = 9/19 ≤ 오늘)", () => {
    const after = todayFor(patients, engine, press(EMPTY_LOG, "P121", "opt-in"), DEMO_NOW_MS);
    expect(after.optedOut).toEqual([]);
    expect(after.groups[0].rows.some((r) => r.patientId === "P121")).toBe(true);
  });

  it("P033 D+7(날짜 미정) 예약 9/23 → 간호팀 확인에서 빠지고, 9/22 목록에 '예약한 날 내원'이 된다", () => {
    const log = press(EMPTY_LOG, "P033", "booked", { pointKey: "d7", date: localDate("2026-09-23") });
    const after = todayFor(patients, engine, log, DEMO_NOW_MS);
    expect(after.nurse.some((n) => n.patientId === "P033")).toBe(false);
    const tomorrow = todayFor(patients, engine, log, at("09:00") + 86_400_000);
    expect(tomorrow.groups.find((g) => g.reason === "upcoming-visit")!.rows.find((r) => r.patientId === "P033")?.lines).toEqual([
      "D+7 내원·경과 사진 · 9/23(수) 예약한 날 내원",
      "D+7 내원·경과 사진 · 같은각도로 경과 사진",
    ]);
  });
});

describe("patientFor — 환자 화면", () => {
  it("연락 전: 배지는 목록과 같고, 이번 연락 문구 하나(지금 보내기)", () => {
    const v = patientFor("P006", patients, engine, EMPTY_LOG, DEMO_NOW_MS, DEMO_NOW_MS)!;
    expect(v.badges.map((b) => b.label)).toEqual(["예정일 지남"]);
    expect(v.overdueLine).toBe("9/18(금)부터 예정일 지남 · 그 뒤 연락 0회 · 첫 연락 차례");
    expect(v.messages.map((m) => [m.templateLabel, m.send?.label])).toEqual([["미방문 안내 문구", "지금 보내기 · 연락 가능 시간대 안"]]);
    expect(v.after).toBeNull();
  });

  it("P006 부재 뒤: 머리는 지금 상태(재연락 대기·오늘 연락 적음), 문구는 그대로, 다음 연락 9/28", () => {
    const v = patientFor("P006", patients, engine, press(EMPTY_LOG, "P006", "no-answer"), DEMO_NOW_MS, DEMO_NOW_MS)!;
    expect(v.badges.map((b) => b.label)).toEqual(["재연락 대기 · 9/28(월)부터", "오늘 연락 적음"]);
    expect(v.messages).toHaveLength(1);
    expect(v.after?.lines).toEqual(["미방문 연락 1회. 다음 연락 9/28(월)", "마지막 연락 9/21(월) + 3일 = 9/24(목) → 휴진이라 9/28(월)에 다시 연락"]);
    expect(v.contacts[0]).toMatchObject({ result: "부재", local: true, counted: true });
  });

  it("같은 환자에게 버튼을 여러 번 눌러도 시도는 한 번(마지막 결과로 바뀜)", () => {
    let log = EMPTY_LOG;
    for (const r of ["no-answer", "no-answer", "called"] as const) log = press(log, "P006", r);
    expect(log.applied).toHaveLength(1);
    expect(log.applied[0].contact.result).toBe("called");
    const v = patientFor("P006", patients, engine, log, DEMO_NOW_MS, DEMO_NOW_MS)!;
    expect(v.overdueLine).toContain("그 뒤 연락 1회");
    expect(v.badges.map((b) => b.label)).not.toContain("간호팀 확인 · 최대 시도까지 닿지 않음");
  });

  it("문구를 만드는 시각이 시간대 밖이면 배지가 '시간 맞춰 보내기'(주황), 안이면 '지금 보내기'(초록)", () => {
    const send = (hhmm: string) => patientFor("P001", patients, engine, EMPTY_LOG, DEMO_NOW_MS, at(hhmm))!.messages[0].send;
    expect(send("08:30")).toEqual({ tone: "orange", label: "시간 맞춰 보내기 · 9/21(월) 09:00에 (연락 가능 시간대(09:00~20:00) 밖)" });
    expect(send("19:59")).toEqual({ tone: "green", label: "지금 보내기 · 연락 가능 시간대 안" });
    expect(send("20:30")).toEqual({ tone: "orange", label: "시간 맞춰 보내기 · 9/22(화) 09:00에 (연락 가능 시간대(09:00~20:00) 밖)" });
  });

  it("미방문 시점이 둘이어도 미방문 문자는 한 통(가장 이른 시점): P005에서 D+1 방문을 빼면 D+1 9/10·D+7 9/16 → 9/10", () => {
    const two = patients.map((p) => (p.id === "P005" ? { ...p, visits: [] } : p));
    const v = patientFor("P005", two, engine, EMPTY_LOG, DEMO_NOW_MS, DEMO_NOW_MS)!;
    expect(v.timeline.entries.filter((e) => e.stateLabel.startsWith("미방문")).map((e) => e.key)).toEqual(["d1", "d7"]);
    const overdue = v.messages.filter((m) => m.reason === "overdue");
    expect(overdue).toHaveLength(1);
    expect(overdue[0].slots.find((s) => s.name === "날짜")?.value).toBe("9/10(목)");
  });

  it("14일 넘게 빠진 주사 회차(P017)는 재예약 문구를 만들지 않고 '의료진 진료 뒤 재시작 — 간호팀 확인'", () => {
    const v = patientFor("P017", patients, engine, EMPTY_LOG, DEMO_NOW_MS, DEMO_NOW_MS)!;
    expect(v.messages).toEqual([]);
    expect(v.badges).toEqual([{ label: "간호팀 확인 · 의료진 진료 뒤 재시작", tone: "red" }]);
    expect(v.noMessage).toContain("재예약 문구를 만들지 않습니다: 의료진 진료 뒤 재시작 — 간호팀 확인");
    // 재시작할 회차와 그 뒤 회차는 예약을 받지 않는다(재예약이 아니라 진료가 먼저).
    expect(v.bookable).toEqual([]);
  });

  it("예약 날짜가 지나 다시 지남(P125): 문구의 날짜 칸은 예약일 9/16", () => {
    const v = patientFor("P125", patients, engine, EMPTY_LOG, DEMO_NOW_MS, DEMO_NOW_MS)!;
    expect(v.messages[0].slots.find((s) => s.name === "날짜")?.value).toBe("9/16(수)");
  });

  it("수신 거부(P121): 문구 없음, 수신 거부 줄과 배지", () => {
    const v = patientFor("P121", patients, engine, EMPTY_LOG, DEMO_NOW_MS, DEMO_NOW_MS)!;
    expect([v.messages, v.badges, v.optOutLine]).toEqual([[], [{ label: "수신 거부", tone: "gray" }], "연락 원치 않음 — 모든 연락 목록에서 빠져 있습니다(9/17(목)부터)."]);
  });

  it("밀린 사진 회차가 있으면 그것을 안내한다(P001 6개월 사진 미방문)", () => {
    const v = patientFor("P001", patients, engine, EMPTY_LOG, DEMO_NOW_MS, DEMO_NOW_MS)!;
    expect(v.photoNote).toMatch(/^밀린 경과 사진 회차: 6개월 경과 진료·경과 사진\(9\/9\(수\) 예정이었음\)/);
  });

  it("'공휴일 미확인'은 끝난 지난 시점에 붙이지 않고, 뜻은 각주로 한 번", () => {
    const v = patientFor("P001", patients, engine, EMPTY_LOG, DEMO_NOW_MS, DEMO_NOW_MS)!;
    const done = v.timeline.entries.filter((e) => e.stateLabel.startsWith("완료"));
    expect(done.length).toBeGreaterThan(0);
    expect(done.every((e) => !e.holidayUnknown)).toBe(true);
    const m6 = v.timeline.entries.find((e) => e.key === "m6")!;
    expect(m6.holidayUnknown).toBe(false); // 9/9는 확인 기간(2026-09-01~) 안
  });

  it("없는 환자는 null", () => {
    expect(patientFor("P999", patients, engine, EMPTY_LOG, DEMO_NOW_MS, DEMO_NOW_MS)).toBeNull();
  });
});

describe("예약 잡음 — 고를 수 있는 시점과 날짜 검사", () => {
  const view = (id: string) => patientFor(id, patients, engine, EMPTY_LOG, DEMO_NOW_MS, DEMO_NOW_MS)!;

  it("먼저 풀어야 할 시점부터: P033은 날짜 미정 D+7이 첫 항목", () => {
    expect(view("P033").bookable.map((b) => [b.key, b.state])).toEqual([
      ["d7", "날짜 미정"],
      ["w4", "예정"],
      ["m6", "예정"],
      ["y1", "예정"],
    ]);
  });

  it("주사 회차는 재시작 기준(예정일 + 14일)까지만: P013 3회차 9/8 → 9/22까지", () => {
    const b = view("P013").bookable;
    expect(b[0]).toEqual({ key: "inj-3", label: "두피 주사 3회차", state: "예정일 지남", latest: "2026-09-22" });
    expect(checkBookingInput("2026-09-22", b[0], engine, DEMO_TODAY)).toEqual({ ok: true, date: "2026-09-22" });
    expect(checkBookingInput("2026-09-23", b[0], engine, DEMO_TODAY)).toEqual({
      ok: false,
      error: "두피 주사 3회차 예약은 9/22(화)까지만 받습니다. 그 뒤는 의료진 진료 뒤 재시작입니다(두피 주사 프로그램 문서).",
    });
  });

  it("휴진일·지난 날·90일 넘음·형식 오류·시점 없음은 받지 않는다", () => {
    const d7 = view("P033").bookable[0];
    expect(checkBookingInput("2026-09-24", d7, engine, DEMO_TODAY)).toEqual({ ok: false, error: "9/24(목)은 휴진일입니다(공휴일(추석 연휴))." });
    expect(checkBookingInput("2026-09-20", d7, engine, DEMO_TODAY).ok).toBe(false);
    expect(checkBookingInput("2026-12-21", d7, engine, DEMO_TODAY)).toEqual({ ok: false, error: "90일 안의 날짜만 받습니다." });
    expect(checkBookingInput("9/23", d7, engine, DEMO_TODAY)).toEqual({ ok: false, error: "예약 날짜를 YYYY-MM-DD로 넣어 주세요." });
    expect(checkBookingInput("2026-09-23", undefined, engine, DEMO_TODAY)).toEqual({ ok: false, error: "예약할 시점을 고르세요." });
  });
});
