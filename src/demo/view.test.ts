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

  it("PRD 3절 순서의 묶음. 개수는 그 이유가 있는 환자 수(지남 13 · 내일 내원 7 · 관리 안내 5 · 주사 재예약 3 · 사진 회차 3), 줄은 가장 앞선 묶음에 한 번", () => {
    // 여러 이유 환자: P013(지남+내일), P014(지남+안내), P045(지남+재예약), P018·P020·P022(내일+사진).
    expect(v.groups.map((g) => [g.label, g.count, g.rows.length])).toEqual([
      ["예정일 지남", 13, 13],
      ["내일 내원", 7, 6],
      ["관리 안내", 5, 4],
      ["주사 재예약", 3, 2],
      ["사진 회차", 3, 0],
    ]);
    // 줄이 없는 묶음도 '0명'이 아니라 누가 어느 줄에 함께 있는지 보인다(사진 회차 = 같은각도로 잇는 장면).
    expect(v.groups[4].alsoIn.map((a) => [a.patientId, a.inLabel])).toEqual([
      ["P018", "내일 내원"],
      ["P020", "내일 내원"],
      ["P022", "내일 내원"],
    ]);
    expect(v.groups[1].alsoIn.map((a) => a.patientId)).toEqual(["P013"]);
    expect(v.total).toBe(25);
    expect(v.groups[0].tone).toBe("red");
  });

  it("주사 회차 이름은 'D01 이름표 − 회차 + n회차': P045 3회차 지남 + 4회차 재예약", () => {
    expect(rows("overdue").find((x) => x.patientId === "P045")!.lines).toEqual(["두피 주사 3회차 · 예정일 9/4(금) · 17일 지남", "두피 주사 4회차 · 9/18(금) 예정이었음 · 9/21(월)까지 날짜 옮기기"]);
  });

  it("예정일 지남은 오래 밀린 순: 18일(P006 1년 9/3, P017 2회차 9/3 → ID 순) → 17일(P045)", () => {
    expect(rows("overdue").slice(0, 3).map((r) => r.patientId)).toEqual(["P006", "P017", "P045"]);
    expect(rows("overdue")[0].lines).toEqual(["1년 경과 진료·경과 사진 · 예정일 9/3(목) · 18일 지남"]);
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

  it("원장 확인·의료진 확인·재연락 대기", () => {
    // 둘 다 3회 → 지남이 더 오래된 P009(8/28)가 먼저
    expect(v.escalations.map((e) => [e.patientId, e.since])).toEqual([
      ["P009", "8/28(금)부터 예정일 지남"],
      ["P003", "9/12(토)부터 예정일 지남"],
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

  it("P001(이미 2회) 부재 → 3회 = 최대 시도 → 원장 확인", () => {
    expect(afterContact(withContact("P001", "no-answer"), engine, DEMO_NOW_MS)).toEqual({
      tone: "red",
      lines: ["미방문 연락 3회 → 원장 확인으로 넘어갑니다(최대 3회).", "코디네이터 목록에는 다시 오르지 않습니다."],
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
  it("P027: D+3는 원래 9/20(일)에서 미뤄 오늘 안내, D+7은 추석·일요일을 건너 9/28", () => {
    const tl = timeline(evaluatePatient(P("P027"), engine, DEMO_NOW_MS), engine.rules, DEMO_TODAY);
    const e = (k: string) => tl.entries.find((x) => x.key === k)!;
    expect([e("d3").dateText, e("d3").stateLabel, e("d3").shift]).toEqual(["9/21(월)", "오늘 안내할 차례", "원래 9/20(일)에서 미룸 — 9/20 일요일 휴진"]);
    expect([e("d7").dateText, e("d7").shift, e("d7").sameAngle]).toEqual(["9/28(월)", "원래 9/24(목)에서 미룸 — 9/24 공휴일(추석 연휴), 9/25 공휴일(추석), 9/26 공휴일(추석 연휴), 9/27 일요일 휴진", true]);
    expect([tl.start, tl.end]).toEqual(["2026-09-17", "2027-09-17"]);
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

  it("9/17 수술: D+3 9/20(일) → 9/21, D+7 9/24(추석) → 9/28", () => {
    const r = rows("2026-09-17");
    const x = (k: string) => r.rows.find((y) => y.key === k)!;
    expect([x("d3").original, x("d3").due, x("d3").shift]).toEqual(["9/20(일)", "9/21(월)", "9/20 일요일 휴진"]);
    expect([x("d7").original, x("d7").due, x("d7").shifted, x("d7").sameAngle]).toEqual(["9/24(목)", "9/28(월)", true, true]);
    expect(x("d1").shift).toBeNull();
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
    // 2회차 9/24(추석 연휴) → 9/28
    expect([r.rows[0].original, r.rows[0].due]).toEqual(["9/24(목)", "9/28(월)"]);
  });
});
