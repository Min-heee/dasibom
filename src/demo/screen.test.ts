import { describe, expect, it } from "vitest";
import { kstInstant } from "@/core/calendar";
import { EMPTY_LOG, type ContactLog } from "@/core/contact";
import type { ContactResult } from "@/core/patient";
import { DEMO_NOW_MS, DEMO_TODAY } from "./clock";
import { mustDemo } from "./data";
import { patientFor, todayFor } from "./screen";
import { recordDemo } from "./storage";

/**
 * 버튼 → 기록 → 목록·환자 화면 재계산의 연결(PRD 3절 6~13초, F6). 화면 컴포넌트는 이 두 함수의 결과를 그리기만 하므로,
 * 여기서 로그를 넣어 보면 "연락을 적었는데 목록이 그대로" 같은 결함이 잡힌다. 기대값은 달력을 보고 센 값.
 */
const { engine, patients } = mustDemo();

function press(log: ContactLog, id: string, result: ContactResult): ContactLog {
  const r = recordDemo(patients, log, id, result);
  if (!r.ok) throw new Error(r.error);
  return r.log;
}

const at = (hhmm: string) => kstInstant(DEMO_TODAY, hhmm);

describe("todayFor — 연락을 적으면 첫 화면이 다시 계산된다", () => {
  it("P004 부재: 목록 25명 → 24명, P004는 재연락 대기(9/21 + 3일 = 9/24 추석 → 9/28부터)", () => {
    const before = todayFor(patients, engine, EMPTY_LOG, DEMO_NOW_MS);
    const after = todayFor(patients, engine, press(EMPTY_LOG, "P004", "no-answer"), DEMO_NOW_MS);
    expect([before.total, after.total]).toEqual([25, 24]);
    expect(after.groups[0].rows.some((r) => r.patientId === "P004")).toBe(false);
    expect(after.waiting.find((w) => w.patientId === "P004")?.next).toBe("9/28(월)부터 다시 연락(9/24(목)은 휴진)");
  });

  it("P001 부재(이미 2회): 원장 확인으로 옮겨 가고 목록에서 빠진다", () => {
    const after = todayFor(patients, engine, press(EMPTY_LOG, "P001", "no-answer"), DEMO_NOW_MS);
    expect(after.escalations.map((e) => e.patientId)).toContain("P001");
    expect(after.total).toBe(24);
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
    expect(v.badges.map((b) => b.label)).not.toContain("원장 확인");
  });

  it("문구를 만드는 시각이 시간대 밖이면 배지가 '시간 맞춰 보내기'(주황), 안이면 '지금 보내기'(초록)", () => {
    const send = (hhmm: string) => patientFor("P001", patients, engine, EMPTY_LOG, DEMO_NOW_MS, at(hhmm))!.messages[0].send;
    expect(send("08:30")).toEqual({ tone: "orange", label: "시간 맞춰 보내기 · 9/21(월) 09:00에 (연락 가능 시간대(09:00~20:00) 밖)" });
    expect(send("19:59")).toEqual({ tone: "green", label: "지금 보내기 · 연락 가능 시간대 안" });
    expect(send("20:30")).toEqual({ tone: "orange", label: "시간 맞춰 보내기 · 9/22(화) 09:00에 (연락 가능 시간대(09:00~20:00) 밖)" });
  });

  it("미방문 시점이 둘이어도 미방문 문자는 한 통(가장 이른 시점): P017 2회차 9/3", () => {
    const v = patientFor("P017", patients, engine, EMPTY_LOG, DEMO_NOW_MS, DEMO_NOW_MS)!;
    const overdue = v.messages.filter((m) => m.reason === "overdue");
    expect(overdue).toHaveLength(1);
    expect(overdue[0].slots.find((s) => s.name === "날짜")?.value).toBe("9/3(목)");
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
