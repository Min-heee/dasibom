import { describe, expect, it } from "vitest";
import { currentPatients, EMPTY_LOG, applyContact } from "@/core/contact";
import { kstInstant, localDate } from "@/core/calendar";
import type { ContactResult } from "@/core/patient";
import { buildToday, evaluatePatient } from "@/core/today";
import { DEMO_NOW, DEMO_NOW_MS, DEMO_TODAY } from "./clock";
import { mustDemo } from "./data";
import { afterContact, bandText, messagesFor, noticeState, timeline, todayView, tryIt } from "./view";

/**
 * 화면 판단(무엇을 어떤 말로 보이나)을 순수 함수로 시험한다. 기대값은 달력을 보고 손으로 센 값이다
 * (2026-09-21 월 09:00 KST, 9/24~26 추석 연휴, 9/27 일요일). 환자 사연은 data/README.md 심은 사례 표.
 */
const { engine, patients } = mustDemo();
const P = (id: string) => patients.find((p) => p.id === id)!;
const withContact = (id: string, result: ContactResult) => {
  const r = applyContact(patients, EMPTY_LOG, { patientId: id, contact: { at: DEMO_NOW, result } });
  if (!r.ok) throw new Error(r.error);
  return currentPatients(patients, r.log).find((p) => p.id === id)!;
};

describe("띠", () => {
  it("가상 의원 · 합성 데이터 · 기준 시각 9/21(월) 09:00", () => {
    expect(bandText(DEMO_NOW_MS)).toBe("가상 의원 · 합성 데이터 · 기준 시각 9/21(월) 09:00");
  });
});

describe("todayView — 첫 화면", () => {
  const v = todayView(buildToday(patients, engine, DEMO_NOW_MS));
  const rows = (reason: string) => v.groups.find((g) => g.reason === reason)!.rows;

  it("PRD 3절 순서의 묶음. 개수는 그 이유가 있는 환자 수(지남 13 · 내일 내원 8 · 관리 안내 6 · 주사 재예약 2 · 사진 회차 3), 줄은 가장 앞선 묶음에 한 번", () => {
    // 여러 이유 환자: P013(지남+내일), P014(지남+안내), P018·P020·P022(내일+사진).
    // v0.2와 달라진 것: P017·P045는 14일 넘게 빠진 주사 회차라 간호팀 확인으로(지남 −2, 재예약 −1), P122·P125가 지남에(+2),
    // P124가 예약한 날 내일 내원(+1), P126이 D+3 안내(+1).
    expect(v.groups.map((g) => [g.label, g.count, g.rows.length])).toEqual([
      ["예정일 지남", 13, 13],
      ["내일 내원", 8, 7],
      ["관리 안내", 6, 5],
      ["주사 재예약", 2, 2],
      ["사진 회차", 3, 0],
    ]);
    // 줄이 없는 묶음도 '0명'이 아니라 누가 어느 줄에 함께 있는지 보인다(사진 회차 = 같은각도로 잇는 장면).
    expect(v.groups[4].alsoIn.map((a) => [a.patientId, a.inLabel])).toEqual([
      ["P018", "내일 내원"],
      ["P020", "내일 내원"],
      ["P022", "내일 내원"],
    ]);
    expect(v.groups[1].alsoIn.map((a) => a.patientId)).toEqual(["P013"]);
    expect(v.total).toBe(27);
    expect(v.groups[0].tone).toBe("red");
  });

  it("주사 회차 이름은 'D01 이름표 − 회차 + n회차': P013 3회차 지남 + 4회차 내일, P040 3회차 재예약", () => {
    expect(rows("overdue").find((x) => x.patientId === "P013")!.lines).toEqual(["두피 주사 3회차 · 예정일 9/8(화) · 13일 지남", "두피 주사 4회차 · 9/22(화) 내원 예정"]);
    expect(rows("injection-rebook").find((x) => x.patientId === "P040")!.lines).toEqual(["두피 주사 3회차 · 9/19(토) 예정이었음 · 9/22(화)까지 날짜 옮기기"]);
  });

  it("예정일 지남은 오래 밀린 순: 18일(P006) → 14일(P004 4주 9/7, P008 4회차 9/7 → ID 순). 14일째인 주사 회차(P008)는 아직 재시작이 아니다", () => {
    expect(rows("overdue").slice(0, 3).map((r) => r.patientId)).toEqual(["P006", "P004", "P008"]);
    expect(rows("overdue")[0].lines).toEqual(["1년 경과 진료·경과 사진 · 예정일 9/3(목) · 18일 지남"]);
  });

  it("예약 날짜가 지나 다시 지남(P125): 예약일을 말하고 원래 예정일을 함께, 배지는 '예약일 지남'", () => {
    const r = rows("overdue").find((x) => x.patientId === "P125")!;
    expect(r.lines).toEqual(["6개월 경과 진료·경과 사진 · 예약일 9/16(수) 지나고 오지 않음 · 5일 지남 (원래 예정일 9/5(토))"]);
    expect(r.badges).toEqual([
      { label: "예정일 지남", tone: "red" },
      { label: "예약일 지남 · 9/16(수)", tone: "orange" },
    ]);
  });

  it("예약한 날의 내일 내원(P124): '예약한 날 내원'과 예약 배지", () => {
    const r = rows("upcoming-visit").find((x) => x.patientId === "P124")!;
    expect([r.lines, r.badges.map((b) => b.label)]).toEqual([["두피 주사 3회차 · 9/22(화) 예약한 날 내원"], ["내일 내원", "예약 잡음 · 9/22(화)"]]);
  });

  it("30초 시연 0~6초: P001 6개월 경과 진료 예정일 12일 지남, 연락 2회 부재", () => {
    const r = rows("overdue").find((x) => x.patientId === "P001")!;
    expect([r.alias, r.procedure, r.lines, r.attempts]).toEqual(["여름 달", "모발이식 수술", ["6개월 경과 진료·경과 사진 · 예정일 9/9(수) · 12일 지남"], "연락 2회 · 마지막 9/18(금) 부재"]);
    expect(r.badges).toEqual([{ label: "예정일 지남", tone: "red" }]);
  });

  it("여러 이유는 배지 여러 개: P013 지남 + 내일 내원, P012 지남 + 의료진 확인", () => {
    expect(rows("overdue").find((x) => x.patientId === "P013")!.badges.map((b) => b.label)).toEqual(["예정일 지남", "내일 내원"]);
    expect(rows("overdue").find((x) => x.patientId === "P012")!.badges.map((b) => b.label)).toEqual(["예정일 지남", "의료진 확인"]);
  });

  it("휴진으로 밀린 안내는 원래 날짜를 함께: P027 D+3 9/20(일) → 9/21", () => {
    expect(rows("care-notice").find((x) => x.patientId === "P027")!.lines).toEqual(["머리 감기 시작 안내(D+3) · 9/21(월) 안내 (원래 9/20(일), 휴진으로 미룸)"]);
  });

  it("사진 회차는 내일 내원과 한 줄: P018 D+7 9/22(화)", () => {
    const r = rows("upcoming-visit").find((x) => x.patientId === "P018")!;
    expect(r.lines).toEqual(["D+7 내원·경과 사진 · 9/22(화) 내원 예정", "D+7 내원·경과 사진 · 같은각도로 경과 사진"]);
    expect(r.attempts).toBeNull(); // 내일 내원은 미방문 시도를 세지 않는다
  });

  it("간호팀 확인(까닭별)·의료진 확인·재연락 대기·수신 거부", () => {
    // 최대 시도가 걸린 환자 먼저(둘 다 3회 → 지남이 더 오래된 P009), 그다음 재시작만(시도 많은 순, 예약만 있어 시도가 없는 P127은 0회), 날짜 미정만 있는 환자는 끝.
    expect(v.nurse.map((n) => [n.patientId, n.causes, n.inList])).toEqual([
      ["P009", ["의료진 진료 뒤 재시작", "최대 시도까지 닿지 않음"], false],
      ["P003", ["최대 시도까지 닿지 않음"], false],
      ["P017", ["의료진 진료 뒤 재시작"], false],
      ["P045", ["의료진 진료 뒤 재시작"], false],
      ["P127", ["의료진 진료 뒤 재시작"], false],
      ["P033", ["허용 범위 안에 진료일 없음"], true],
    ]);
    // 앞으로 잡힌 예약도 재시작을 빼 주지 않는다(독립 대조 불일치 1). 예약이 있다는 것만 덧붙인다.
    expect(v.nurse.find((n) => n.patientId === "P127")!.lines).toEqual(["두피 주사 2회차 · 예정일 9/1(화)에서 20일 빠짐 → 의료진 진료 뒤 재시작 — 간호팀 확인 (예약 9/23(수) 있음)"]);
    expect(v.nurse.find((n) => n.patientId === "P127")!.attempts).toBeNull();
    expect(v.nurse.find((n) => n.patientId === "P045")!.lines).toEqual(["두피 주사 3회차 · 예정일 9/4(금)에서 17일 빠짐 → 의료진 진료 뒤 재시작 — 간호팀 확인"]);
    expect(v.nurse.find((n) => n.patientId === "P033")!.lines).toEqual(["D+7 내원·경과 사진 · 원래 9/25(금) · 허용 범위 9/24(목)~9/27(일), 수술 후 관리 문서 안에 진료일 없음 → 간호팀 확인"]);
    expect(v.nurse.find((n) => n.patientId === "P033")!.attempts).toBeNull();
    expect(v.nurse[1].attempts).toBe("연락 3회 · 마지막 9/18(금) 문자 보냄 · 9/12(토)부터 예정일 지남");
    expect(v.optedOut).toEqual([
      { patientId: "P121", alias: "작은 별", procedure: "모발이식 수술", since: "9/17(목) 11:40부터 수신 거부", held: "수신 거부가 아니었다면: 예정일 지남", href: "/patient/P121/" },
    ]);
    expect(v.clinician.map((c) => [c.patientId, c.inList])).toEqual([
      ["P012", true],
      ["P039", true],
    ]);
    expect(v.waiting.map((w) => [w.patientId, w.next])).toEqual([["P002", "9/22(화)부터 다시 연락"]]);
  });
});

describe("afterContact — 연락 결과 버튼 뒤", () => {
  it("P004(첫 연락) 부재 → 1회, 9/21 + 3일 = 9/24(추석) → 다음 연락 9/28", () => {
    expect(afterContact(withContact("P004", "no-answer"), engine, DEMO_NOW_MS)).toEqual({
      tone: "orange",
      lines: ["미방문 연락 1회. 다음 연락 9/28(월)", "마지막 연락 9/21(월) + 3일 = 9/24(목) → 휴진이라 9/28(월)에 다시 연락"],
    });
  });

  it("P001(이미 2회) 부재 → 3회 = 최대 시도 → 간호팀 확인", () => {
    expect(afterContact(withContact("P001", "no-answer"), engine, DEMO_NOW_MS)).toEqual({
      tone: "red",
      lines: ["미방문 연락 3회 → 간호팀 확인으로 넘어갑니다(최대 3회).", "코디네이터 목록에는 다시 오르지 않습니다."],
    });
  });

  it("P017(14일 넘게 빠진 주사 회차)에 연락을 적어도 재예약 대신 재시작 안내", () => {
    expect(afterContact(withContact("P017", "no-answer"), engine, DEMO_NOW_MS)).toEqual({
      tone: "red",
      lines: ["14일 넘게 빠진 주사 회차가 있어 간호팀 확인에 있습니다(의료진 진료 뒤 재시작).", "코디네이터 목록에는 오르지 않습니다."],
    });
  });

  it("P004 연락 원치 않음 → 다음 연락일을 말하지 않고 수신 거부 안내", () => {
    expect(afterContact(withContact("P004", "opt-out"), engine, DEMO_NOW_MS).lines[0]).toBe(
      "연락 원치 않음으로 적었습니다. 이 환자는 모든 연락 목록(오늘 목록·재연락 대기·간호팀 확인)에서 빠지고 '수신 거부'로 보입니다.",
    );
  });

  it("P004 예약 잡음 9/23 → 그날까지 지남에서 빠지고, 예약 날짜의 전 진료일(9/22)에 내일 내원", () => {
    const r = applyContact(patients, EMPTY_LOG, { patientId: "P004", contact: { at: DEMO_NOW, result: "booked", booking: { pointKey: "w4", date: localDate("2026-09-23") } } });
    if (!r.ok) throw new Error(r.error);
    expect(afterContact(currentPatients(patients, r.log).find((p) => p.id === "P004")!, engine, DEMO_NOW_MS)).toEqual({
      tone: "blue",
      lines: [
        "예약 9/23(수)로 적었습니다. 그날까지 이 시점은 예정일 지남에서 빠지고, 그날이 지나도 오지 않으면 다시 예정일 지남입니다.",
        "오늘 연락할 이유가 처리됐습니다.",
        "다음에 목록에 오르는 날: 9/22(화) · 내일 내원",
      ],
    });
  });

  it("P019 내일 내원(4주 9/22) 통화 → 처리됨. 오지 않으면 유예 끝 9/29 다음 날 9/30(수)에 예정일 지남", () => {
    expect(afterContact(withContact("P019", "called"), engine, DEMO_NOW_MS)).toEqual({
      tone: "green",
      lines: ["오늘 연락할 이유가 처리됐습니다.", "다음에 목록에 오르는 날: 9/30(수) · 예정일 지남 (그때까지 오지 않으면)"],
    });
  });
});

describe("messagesFor — 이번 연락 문구", () => {
  const items = (id: string) => evaluatePatient(P(id), engine, DEMO_NOW_MS).items;

  it("P001: 지남 문구에 예정일(9/9)과 병원 전화만 채우고, 09:00이면 지금 보내기", () => {
    const [m] = messagesFor(items("P001"), engine, DEMO_NOW_MS);
    expect(m.message.ok && m.message.text).toBe("안녕하세요, 샘플의원입니다. 9/9(수)로 안내드린 내원 일정이 지나 연락드립니다. 편하신 날짜로 다시 예약을 도와드리겠습니다. 02-000-0000으로 연락 주세요. 감사합니다.");
    expect(m.slots).toEqual([
      { name: "날짜", value: "9/9(수)" },
      { name: "병원 전화", value: "02-000-0000" },
    ]);
    expect(m.timing).toBe("지금 보내기 · 연락 가능 시간대 안");
  });

  it("P018: 사진 회차 문구 하나(내일 내원 문구와 겹치지 않게), 화요일 진료시간 10:00~19:00, 같은각도 안내", () => {
    const ms = messagesFor(items("P018"), engine, DEMO_NOW_MS);
    expect(ms.map((m) => m.templateKey)).toEqual(["photo-round"]);
    expect(ms[0].slots.find((s) => s.name === "진료시간")?.value).toBe("10:00~19:00");
    expect(ms[0].sameAngle).toContain("같은각도");
  });

  it("시간대 밖이면 보낼 시각: 08:30 → 그날 09:00, 20:30 → 다음 날 09:00, 20:00 정각도 밖", () => {
    const t = (hhmm: string) => messagesFor(items("P001"), engine, kstInstant(DEMO_TODAY, hhmm))[0].timing;
    expect(t("08:30")).toBe("시간 맞춰 보내기 · 9/21(월) 09:00에 (연락 가능 시간대(09:00~20:00) 밖)");
    expect(t("20:30")).toBe("시간 맞춰 보내기 · 9/22(화) 09:00에 (연락 가능 시간대(09:00~20:00) 밖)");
    expect(t("20:00")).toBe("시간 맞춰 보내기 · 9/22(화) 09:00에 (연락 가능 시간대(09:00~20:00) 밖)");
    expect(t("19:59")).toBe("지금 보내기 · 연락 가능 시간대 안");
  });
});

describe("timeline — 환자 상세 1년", () => {
  it("P027: D+3는 원래 9/20(일)에서 미뤄 오늘 안내, D+7은 허용 범위(9/23~9/26, V07) 안의 9/23으로 앞당김", () => {
    const tl = timeline(evaluatePatient(P("P027"), engine, DEMO_NOW_MS), engine.rules, DEMO_TODAY);
    const e = (k: string) => tl.entries.find((x) => x.key === k)!;
    expect([e("d3").dateText, e("d3").stateLabel, e("d3").shift]).toEqual(["9/21(월)", "오늘 안내할 차례", "원래 9/20(일)에서 미룸 — 9/20 일요일 휴진"]);
    expect([e("d7").dateText, e("d7").shift, e("d7").sameAngle]).toEqual([
      "9/23(수)",
      "원래 9/24(목)에서 앞당김 — 9/24 공휴일(추석 연휴), 9/25 공휴일(추석), 9/26 공휴일(추석 연휴) · 허용 범위 9/23(수)~9/26(토), 수술 후 관리 문서 안에 뒤 진료일이 없음",
      true,
    ]);
    expect([tl.start, tl.end]).toEqual(["2026-09-17", "2027-09-17"]);
  });

  it("새 상태: 날짜 미정(P033 D+7), 재시작·재시작 전(P017), 예약 잡음 전·후(P123·P125), 예약으로 정한 날짜 미정(P126), 예약해도 재시작(P127)", () => {
    const e = (id: string, k: string) => timeline(evaluatePatient(P(id), engine, DEMO_NOW_MS), engine.rules, DEMO_TODAY).entries.find((x) => x.key === k)!;
    expect([e("P033", "d7").dateText, e("P033", "d7").stateLabel, e("P033", "d7").tone]).toEqual(["날짜 미정 (원래 9/25(금))", "날짜 미정 · 허용 범위 안에 진료일 없음 → 간호팀 확인", "orange"]);
    expect(e("P017", "inj-2").stateLabel).toBe("미방문 · 예정일에서 18일 빠짐 → 의료진 진료 뒤 재시작 — 간호팀 확인");
    expect(e("P017", "inj-3").stateLabel).toBe("재시작 전 · 의료진 진료 뒤 날짜를 다시 정함");
    expect([e("P123", "m6").dateText, e("P123", "m6").stateLabel]).toEqual(["9/28(월) (예약)", "예약 잡음 · 9/28(월)"]);
    expect(e("P125", "m6").stateLabel).toBe("미방문 · 예약일 9/16(수) 지나고 5일");
    // 예정일에서 14일 넘게 지나 앞날로 예약한 회차는 예약 잡음이면서 재시작(빨강), 뒤 회차는 재시작 전.
    expect([e("P127", "inj-2").stateLabel, e("P127", "inj-2").tone]).toEqual(["예약 잡음 · 9/23(수) · 예정일에서 20일 빠짐 → 의료진 진료 뒤 재시작 — 간호팀 확인", "red"]);
    expect(e("P127", "inj-3").stateLabel).toBe("재시작 전 · 의료진 진료 뒤 날짜를 다시 정함");
    expect(e("P126", "d7").shift).toBe(
      "원래 9/25(금) — 허용 범위 9/24(목)~9/27(일), 수술 후 관리 문서 안에 진료일 없음(9/25 공휴일(추석), 9/26 공휴일(추석 연휴), 9/27 일요일 휴진, 9/24 공휴일(추석 연휴)) → 예약 날짜로 정함",
    );
  });

  it("P001: 6개월 미방문 12일 지남, 앞 시점은 완료, 띠 위치는 0~100", () => {
    const tl = timeline(evaluatePatient(P("P001"), engine, DEMO_NOW_MS), engine.rules, DEMO_TODAY);
    expect(tl.entries.find((x) => x.key === "m6")!.stateLabel).toBe("미방문 · 예정일 12일 지남");
    expect(tl.entries.find((x) => x.key === "w4")!.stateLabel).toBe("완료 · 4/6(월) 방문");
    expect(tl.entries.every((x) => x.pct >= 0 && x.pct <= 100)).toBe(true);
    expect(tl.entries.find((x) => x.key === "y1")!.pct).toBe(100);
    expect(tl.entries.find((x) => x.key === "y1")!.dateText).toBe("2027년 3/9(화)"); // 해를 넘기면 해를 붙인다
  });

  it("P038: 10/31 수술의 6개월은 4/30(월말 규칙 clamp)", () => {
    const e = timeline(evaluatePatient(P("P038"), engine, DEMO_NOW_MS), engine.rules, DEMO_TODAY).entries.find((x) => x.key === "m6")!;
    expect([e.dateText, e.monthEnd]).toEqual(["4/30(목)", true]);
  });
});

describe("noticeState — 안내 시점 표시(D01에 없는 구분, 표시용)", () => {
  const s = { point: { dueDate: localDate("2026-09-10") } as never, graceEnd: localDate("2026-09-12") };
  const c = (at: string) => [{ at, result: "sms" as const }];
  it("예정·오늘·보냄·놓침", () => {
    expect(noticeState(s, [], localDate("2026-09-09"))).toBe("notice-upcoming");
    expect(noticeState(s, [], localDate("2026-09-12"))).toBe("notice-active");
    expect(noticeState(s, c("2026-09-12T10:00:00+09:00"), localDate("2026-09-21"))).toBe("notice-sent");
    expect(noticeState(s, c("2026-09-13T10:00:00+09:00"), localDate("2026-09-21"))).toBe("notice-missed"); // 유예 뒤 연락은 보낸 것으로 보지 않음
    expect(noticeState(s, c("2026-09-09T10:00:00+09:00"), localDate("2026-09-21"))).toBe("notice-missed"); // 미룬 날짜 전 연락
  });
});

describe("tryIt — 직접 해 보기", () => {
  const rows = (start: string, proc = "hair-transplant") => {
    const r = tryIt(start, proc, engine, DEMO_TODAY);
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  it("9/17 수술: D+3 9/20(일) → 9/21(미룸), D+7 9/24(추석) → 허용 범위 안 9/23(앞당김, D+6)", () => {
    const r = rows("2026-09-17");
    const x = (k: string) => r.rows.find((y) => y.key === k)!;
    expect([x("d3").original, x("d3").due, x("d3").direction, x("d3").shift, x("d3").window]).toEqual(["9/20(일)", "9/21(월)", "later", "9/20 일요일 휴진", null]);
    expect([x("d7").original, x("d7").due, x("d7").direction, x("d7").window, x("d7").sameAngle]).toEqual(["9/24(목)", "9/23(수)", "earlier", "9/23(수)~9/26(토), 수술 후 관리 문서", true]);
    expect(x("d1").shift).toBeNull();
  });

  it("9/18 수술: D+7 9/25는 허용 범위 9/24~9/27이 모두 휴진 → 날짜 미정, 간호팀 확인 안내", () => {
    const r = rows("2026-09-18");
    const d7 = r.rows.find((y) => y.key === "d7")!;
    expect([d7.due, d7.direction, d7.window]).toEqual(["날짜 미정", "unresolved", "9/24(목)~9/27(일), 수술 후 관리 문서"]);
    expect(r.notes.some((n) => n.includes("간호팀 확인"))).toBe(true);
  });

  it("H2 2027-04-09: 6개월 10/9(토, 한글날) → 10/10(일) → 10/11(대체공휴일) → 10/12(화), 1년은 2028년이라 공휴일 미확인", () => {
    const r = rows("2027-04-09");
    const m6 = r.rows.find((y) => y.key === "m6")!;
    expect([m6.original, m6.due, m6.shift]).toEqual(["10/9(토)", "10/12(화)", "10/9 공휴일(한글날), 10/10 일요일 휴진, 10/11 공휴일(대체공휴일(한글날))"]);
    expect(r.rows.find((y) => y.key === "y1")!.holidayUnknown).toBe(true);
    expect(r.notes.some((n) => n.includes("공휴일 미확인"))).toBe(true);
  });

  it("H3 2027-08-31: 6개월 = 2028-02-29(윤년 월말 clamp)", () => {
    const m6 = rows("2027-08-31").rows.find((y) => y.key === "m6")!;
    expect([m6.original, m6.monthEnd]).toEqual(["2028년 2/29(화)", true]);
  });

  it("휴진일 시작은 알리고 계산은 그대로, 달력에 없는 날·형식 오류는 계산하지 않는다", () => {
    expect(rows("2026-09-20").notes[0]).toBe("시작일 9/20(일)은 휴진일입니다(일요일 휴진). 계산은 그대로 합니다.");
    expect(tryIt("2026-02-30", "hair-transplant", engine, DEMO_TODAY)).toEqual({ ok: false, error: "달력에 없는 날짜입니다: 2026-02-30" });
    expect(tryIt("", "hair-transplant", engine, DEMO_TODAY)).toEqual({ ok: false, error: "날짜를 YYYY-MM-DD로 넣어 주세요." });
    expect(tryIt("2026-09-01", "laser", engine, DEMO_TODAY)).toEqual({ ok: false, error: "모르는 시술입니다: laser" });
  });

  it("두피 주사: 2~10회차 9개, 5·10회차는 사진", () => {
    const r = rows("2026-09-10", "injection");
    expect(r.rows).toHaveLength(9);
    expect(r.rows.filter((y) => y.sameAngle).map((y) => y.key)).toEqual(["inj-5", "inj-10"]);
    // 2회차 9/24(추석 연휴) → 앞뒤 3일(V08) 중 뒤 9/25~9/27이 휴진 → 9/23으로 앞당김(v0.2까지는 9/28, +4일)
    expect([r.rows[0].original, r.rows[0].due, r.rows[0].direction, r.rows[0].window]).toEqual(["9/24(목)", "9/23(수)", "earlier", "9/21(월)~9/27(일), 두피 주사 프로그램 문서"]);
  });
});
