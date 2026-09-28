import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  checkDay,
  dayOfWeek,
  diffDays,
  formatKstIso,
  formatShort,
  isLocalDate,
  isOpenDay,
  kstDateOf,
  kstInstant,
  kstMinuteOfDay,
  localDate,
  nextOpenDay,
  parseClinicHours,
  parseInstant,
  prevOpenDay,
  shiftToOpenDay,
  shiftWithinWindow,
} from "./calendar";
import { fixtureEngine } from "./__fixtures__/load";

const d = localDate;

describe("LocalDate", () => {
  it("달력에 없는 날은 받지 않는다(2월 30일, 평년 2월 29일)", () => {
    expect(isLocalDate("2026-02-29")).toBe(false);
    expect(isLocalDate("2028-02-29")).toBe(true);
    expect(isLocalDate("2026-13-01")).toBe(false);
    expect(isLocalDate("2026-9-1")).toBe(false);
    expect(() => localDate("2026-02-30")).toThrow("날짜 형식이 틀렸습니다");
  });

  it("addDays·diffDays는 달·해를 넘긴다", () => {
    expect(addDays(d("2026-09-21"), 10)).toBe("2026-10-01");
    expect(addDays(d("2026-12-25"), 7)).toBe("2027-01-01");
    expect(addDays(d("2026-03-01"), -1)).toBe("2026-02-28");
    expect(addDays(d("2028-03-01"), -1)).toBe("2028-02-29");
    expect(diffDays(d("2026-09-09"), d("2026-09-21"))).toBe(12);
    expect(diffDays(d("2026-09-21"), d("2026-09-09"))).toBe(-12);
    expect(diffDays(d("2026-01-01"), d("2027-01-01"))).toBe(365);
  });

  it("요일: 2026-09-21은 월요일, 2026-09-25(추석)는 금요일, 2027-03-14는 일요일", () => {
    expect(dayOfWeek(d("2026-09-21"))).toBe(1);
    expect(dayOfWeek(d("2026-09-25"))).toBe(5);
    expect(dayOfWeek(d("2027-03-14"))).toBe(0);
    expect(formatShort(d("2026-09-24"))).toBe("9/24(목)");
  });
});

describe("addMonths — 월말 규칙 clamp", () => {
  it.each([
    ["2026-01-31", 1, "2026-02-28"],
    ["2028-01-31", 1, "2028-02-29"],
    ["2026-03-31", 1, "2026-04-30"],
    ["2026-03-31", 6, "2026-09-30"],
    ["2026-08-31", 6, "2027-02-28"],
    ["2026-01-31", 6, "2026-07-31"],
    ["2026-01-31", 12, "2027-01-31"],
    ["2026-05-31", 1, "2026-06-30"],
    ["2026-03-31", -1, "2026-02-28"],
    ["2026-09-14", 6, "2027-03-14"],
    ["2026-11-15", 2, "2027-01-15"],
  ] as const)("%s + %i개월 = %s", (from, n, to) => {
    expect(addMonths(d(from), n)).toBe(to);
  });

  it("다음 달 1일로 넘기지 않는다(JS setMonth는 1/31 + 1개월 = 3/3)", () => {
    expect(addMonths(d("2026-01-31"), 1)).not.toBe("2026-03-03");
  });
});

describe("시각", () => {
  it("시간대가 없는 ISO는 거부한다(실행 환경 시간대로 읽히므로)", () => {
    expect(() => parseInstant("2026-09-21T09:00:00")).toThrow("시간대가 적힌");
    expect(parseInstant("2026-09-21T09:00:00+09:00")).toBe(parseInstant("2026-09-21T00:00:00Z"));
  });

  it("KST 날짜 경계: UTC 15:00 = KST 다음 날 00:00", () => {
    expect(kstDateOf(parseInstant("2026-09-20T15:00:00Z"))).toBe("2026-09-21");
    expect(kstDateOf(parseInstant("2026-09-20T14:59:59Z"))).toBe("2026-09-20");
    expect(kstMinuteOfDay(parseInstant("2026-09-21T09:30:00+09:00"))).toBe(570);
    expect(formatKstIso(kstInstant(d("2026-09-22"), "09:00"))).toBe("2026-09-22T09:00:00+09:00");
  });
});

describe("진료일 — V02 주간 진료표 + 공휴일 + 추가 휴진", () => {
  const cal = fixtureEngine().calendar;

  it("일요일·공휴일(추석)·추가 휴진(10/16 내부 교육)은 휴진, 토요일은 진료", () => {
    expect(isOpenDay(d("2026-09-20"), cal)).toBe(false);
    expect(isOpenDay(d("2026-09-19"), cal)).toBe(true);
    expect(isOpenDay(d("2026-09-24"), cal)).toBe(false);
    expect(isOpenDay(d("2026-09-26"), cal)).toBe(false); // 토요일이지만 추석 연휴
    expect(isOpenDay(d("2026-09-28"), cal)).toBe(true);
    expect(isOpenDay(d("2026-10-05"), cal)).toBe(false); // 대체공휴일
    expect(isOpenDay(d("2026-10-16"), cal)).toBe(false);
    expect(checkDay(d("2026-10-16"), cal).reasons).toEqual([{ kind: "extra", reason: "내부 교육", label: "휴진(내부 교육)" }]);
  });

  it("다음 진료일: 수요일(9/23) 다음은 연휴·일요일을 건너 9/28(월)", () => {
    expect(nextOpenDay(d("2026-09-21"), cal)).toBe("2026-09-22");
    expect(nextOpenDay(d("2026-09-23"), cal)).toBe("2026-09-28");
    expect(nextOpenDay(d("2026-10-02"), cal)).toBe("2026-10-06");
    expect(prevOpenDay(d("2026-09-28"), cal)).toBe("2026-09-23");
    expect(prevOpenDay(d("2026-10-06"), cal)).toBe("2026-10-02");
  });

  it("휴진일이면 다음 진료일로 미루고 건너뛴 날과 사유를 남긴다", () => {
    const s = shiftToOpenDay(d("2026-09-25"), cal);
    expect(s.date).toBe("2026-09-28");
    expect(s.skipped.map((x) => [x.date, x.reasons.map((r) => r.label)])).toEqual([
      ["2026-09-25", ["공휴일(추석)"]],
      ["2026-09-26", ["공휴일(추석 연휴)"]],
      ["2026-09-27", ["일요일 휴진"]],
    ]);
    expect(shiftToOpenDay(d("2026-09-22"), cal)).toEqual({ date: "2026-09-22", skipped: [], holidayUnknown: false });
  });

  it("공휴일 확인 기간 밖의 날은 '모름'으로 표시한다(진료일로 치되 믿지 않는다)", () => {
    // 픽스처 확인 기간은 2026-09-01~2026-12-31. 2027-03-01(삼일절)은 목록에 없어 진료일로 보이지만 모른다고 표시된다.
    expect(checkDay(d("2027-03-01"), cal)).toEqual({ open: true, reasons: [], holidayUnknown: true });
    expect(checkDay(d("2026-09-22"), cal).holidayUnknown).toBe(false);
  });
});

describe("parseClinicHours — V02 json", () => {
  const base = {
    timezone: "Asia/Seoul",
    weekly: { mon: { open: "10:00", close: "19:00" }, tue: { open: "10:00", close: "19:00" }, wed: { open: "10:00", close: "19:00" }, thu: { open: "10:00", close: "21:00" }, fri: { open: "10:00", close: "19:00" }, sat: { open: "10:00", close: "15:00" }, sun: null },
    closed: ["sun", "public-holiday"],
    extraClosedDates: [{ date: "2026-10-16", reason: "내부 교육" }],
  };

  it("weekly의 null과 closed 목록이 어긋나면 거부한다", () => {
    const r = parseClinicHours({ ...base, closed: ["public-holiday"] });
    expect(r).toEqual({ ok: false, errors: ["V02 weekly.sun와 closed 목록이 서로 다릅니다"] });
  });

  it("모르는 키·잘못된 날짜를 모두 모아 거부한다", () => {
    const r = parseClinicHours({ ...base, holidays: [], extraClosedDates: [{ date: "2026-02-30", reason: "x" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(2);
  });

  // 변이 검사 M13e: 진료일 판정에 쓰는 키는 하나씩 빼도 거부해야 한다. extraClosedDates가 빠졌을 때 빈 목록으로 받으면
  // 내부 교육일 같은 추가 휴진이 조용히 사라진다.
  it.each(["timezone", "weekly", "closed", "extraClosedDates"])("%s가 빠지면 거부한다", (k) => {
    const j: Record<string, unknown> = structuredClone(base);
    delete j[k];
    expect(parseClinicHours(j).ok).toBe(false);
  });

  it("공휴일 휴진이 closed에 없으면 공휴일을 휴진으로 보지 않는다", () => {
    const r = parseClinicHours({ ...base, closed: ["sun"] });
    expect(r.ok && r.hours.closedOnPublicHolidays).toBe(false);
  });
});

describe("shiftWithinWindow — 범위가 있는 시점의 휴진 이동(D01 window-next-then-previous)", () => {
  const cal = fixtureEngine().calendar;
  const w = (d: string, before: number, after: number) => {
    const r = shiftWithinWindow(localDate(d), cal, { before, after });
    return [r.date, r.direction, r.skipped.map((s) => s.date)];
  };
  it("진료일이면 그대로, 뒤를 먼저(가까운 날부터), 없으면 앞(가까운 날부터), 그래도 없으면 날짜 미정", () => {
    expect(w("2026-09-23", 1, 2)).toEqual(["2026-09-23", "none", []]);
    expect(w("2026-10-09", 1, 2)).toEqual(["2026-10-10", "later", ["2026-10-09"]]);
    expect(w("2026-09-24", 1, 2)).toEqual(["2026-09-23", "earlier", ["2026-09-24", "2026-09-25", "2026-09-26"]]);
    expect(w("2026-09-24", 3, 3)).toEqual(["2026-09-23", "earlier", ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]]);
    expect(w("2026-09-25", 1, 2)).toEqual([null, "unresolved", ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-24"]]);
    // 범위 끝은 포함: 뒤 3일이면 9/25 → 9/28.
    expect(w("2026-09-25", 1, 3)).toEqual(["2026-09-28", "later", ["2026-09-25", "2026-09-26", "2026-09-27"]]);
    // 범위가 0이면 그날만 본다.
    expect(w("2026-09-27", 0, 0)).toEqual([null, "unresolved", ["2026-09-27"]]);
  });
});
