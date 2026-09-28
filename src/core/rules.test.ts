import { describe, expect, it } from "vitest";
import { parseRules } from "./rules";
import { activeJson, loadVault } from "./vault";
import { fixtureFiles } from "./__fixtures__/load";

function d01Json(): Record<string, unknown> {
  const j = activeJson(loadVault(fixtureFiles()), "D01");
  if (!j.ok) throw new Error(j.error);
  return structuredClone(j.value) as Record<string, unknown>;
}

type Json = Record<string, unknown>;
const procs = (j: Json) => j.procedures as Record<string, unknown>;
const hair = (j: Json) => procs(j)["hair-transplant"] as Json[];
const inj = (j: Json) => procs(j).injection as Json;

describe("parseRules — 픽스처 D01", () => {
  it("V07·V08·V09 일정대로 읽는다", () => {
    const r = parseRules(d01Json());
    if (!r.ok) throw new Error(r.errors.join("; "));
    const h = r.rules.procedures["hair-transplant"];
    expect(h.type).toBe("fixed");
    if (h.type !== "fixed") return;
    expect(h.points.map((p) => [p.key, p.offset.unit, p.offset.n, p.kind])).toEqual([
      ["d1", "days", 1, "visit"],
      ["d3", "days", 3, "notice"],
      ["d7", "days", 7, "photo"],
      ["d14", "days", 14, "notice"],
      ["w4", "days", 28, "visit"],
      ["m6", "months", 6, "photo"],
      ["y1", "months", 12, "photo"],
    ]);
    expect(r.rules.procedures.injection).toEqual({
      type: "series",
      keyPrefix: "inj-",
      label: "두피 주사",
      intervalDays: 14,
      sessions: 10,
      earlyDays: 3,
      graceDays: 3,
      photoSessions: [5, 10],
      shiftWindow: { before: 3, after: 3, basis: "V08" },
      restartAfterDays: 14,
    });
    // 휴진 이동 범위는 근거 문서가 적은 D+7(V07)에만 있고, 나머지 시점에는 지어내 채우지 않는다.
    expect(h.points.filter((p) => p.shiftWindow).map((p) => [p.key, p.shiftWindow])).toEqual([["d7", { before: 1, after: 2, basis: "V07" }]]);
    expect(r.rules.procedures["scalp-care"]).toMatchObject({ type: "recurring", key: "scalp-care", kind: "notice", anchor: "last-visit", intervalDays: 28, horizonMonths: 12 });
    expect(r.rules.reasonOrder).toEqual(["overdue", "upcoming-visit", "care-notice", "injection-rebook", "photo-round"]);
    expect(r.rules.clinicPhone).toBe("02-000-0000");
    expect(r.rules.retryIntervalDays).toBe(3);
    expect(r.rules.maxAttempts).toBe(3);
    expect(r.rules.holidays).toHaveLength(7);
  });
});

describe("parseRules — 빠지거나 깨지면 전체를 멈춘다(기본값을 채우지 않는다)", () => {
  it("값이 빠진 시점", () => {
    const j = d01Json();
    delete hair(j)[4].graceDays;
    expect(parseRules(j)).toEqual({ ok: false, errors: ["procedures.hair-transplant[4].graceDays가 없습니다"] });
  });

  it("문자열 숫자·음수·소수", () => {
    const j = d01Json();
    hair(j)[0].graceDays = "1";
    hair(j)[1].earlyDays = -1;
    inj(j).intervalDays = 14.5;
    const r = parseRules(j);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors).toEqual([
        'procedures.hair-transplant[0].graceDays는 0 이상의 정수여야 합니다: "1"',
        "procedures.hair-transplant[1].earlyDays는 0 이상의 정수여야 합니다: -1",
        "procedures.injection.intervalDays는 1 이상의 정수여야 합니다: 14.5",
      ]);
  });

  it("모르는 키(오타)", () => {
    const j = d01Json();
    j.retryIntervalDay = 3;
    hair(j)[0].gracedays = 1;
    const r = parseRules(j);
    expect(r).toEqual({ ok: false, errors: ["모르는 키입니다: retryIntervalDay"] });
    delete j.retryIntervalDay;
    expect(parseRules(j)).toEqual({ ok: false, errors: ["procedures.hair-transplant[0] 모르는 키입니다: gracedays"] });
  });

  // 변이 검사 M13c: 키마다 따로 빼 본다. 일부 키만 보면 "이 키 하나는 빠져도 빈 값으로 받는" 구멍이 남는다
  // (holidays가 빠지면 추석 밀림이 조용히 사라진다).
  it.each(Object.keys(d01Json()))("최상위 키 %s 하나만 빠져도 멈춘다", (k) => {
    const j = d01Json();
    delete j[k];
    const r = parseRules(j);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain(`${k}가 없습니다`);
  });

  it("최상위 키가 빠짐", () => {
    const j = d01Json();
    delete j.maxAttempts;
    delete j.holidaysCoverage;
    expect(parseRules(j)).toEqual({ ok: false, errors: ["maxAttempts가 없습니다", "holidaysCoverage가 없습니다"] });
  });

  it("offsetDays와 offsetMonths가 둘 다 있거나 둘 다 없음", () => {
    const j = d01Json();
    hair(j)[0].offsetMonths = 1;
    delete hair(j)[1].offsetDays;
    const r = parseRules(j);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.filter((e) => e.includes("정확히 하나"))).toHaveLength(2);
  });

  it("지원하지 않는 규칙 이름표(월말·밀림·안내일·시간대)", () => {
    const j = d01Json();
    j.monthEndRule = "overflow";
    j.shiftRule = "prev-open-day";
    j.upcomingNotice = "calendar-day-before";
    j.timezone = "UTC";
    expect(parseRules(j)).toEqual({
      ok: false,
      errors: [
        'timezone는 "Asia/Seoul"만 지원합니다: "UTC"',
        'upcomingNotice는 "previous-open-day"만 지원합니다: "calendar-day-before"',
        'monthEndRule는 "clamp"만 지원합니다: "overflow"',
        'shiftRule는 "window-next-then-previous"만 지원합니다: "prev-open-day"',
      ],
    });
  });

  it("휴진 이동 범위: 모양, 근거 문서 id, before ≤ earlyDays, 안내 시점에는 두지 않음", () => {
    const j = d01Json();
    hair(j)[2].shiftWindow = { before: 2, after: 2, basis: "V07" }; // d7 earlyDays 1
    (hair(j)[1] as Json).shiftWindow = { before: 0, after: 1, basis: "V07" }; // d3 안내
    inj(j).shiftWindow = { before: 3, after: "3", basis: "postop" };
    const r = parseRules(j);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors).toEqual([
        "procedures.hair-transplant[1].shiftWindow는 내원·사진 시점에만 둡니다",
        "procedures.hair-transplant[2].shiftWindow.before(2)는 earlyDays(1) 이하여야 합니다 — 앞당긴 날에 온 방문이 완료로 인정되게",
        'procedures.injection.shiftWindow.after는 0 이상의 정수여야 합니다: "3"',
        'procedures.injection.shiftWindow.basis는 근거 문서 id(V07 꼴)여야 합니다: "postop"',
      ]);
  });

  it("주사 재시작 기준: 없으면 멈추고, 유예보다 길어야 한다", () => {
    const j = d01Json();
    delete inj(j).restartAfterDays;
    const r1 = parseRules(j);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.errors).toEqual(["procedures.injection.restartAfterDays가 없습니다"]);
    inj(j).restartAfterDays = 3;
    const r2 = parseRules(j);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.errors).toEqual(["procedures.injection.restartAfterDays(3)는 graceDays(3)보다 커야 합니다"]);
  });

  it("연락 결과 목록과 이유 순서는 코드가 아는 값과 정확히 같아야 한다", () => {
    const j = d01Json();
    j.contactResults = ["called", "no-answer", "sms", "busy"];
    j.reasonOrder = ["overdue", "upcoming-visit", "care-notice", "injection-rebook"];
    const r = parseRules(j);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.split("는")[0])).toEqual(["contactResults", "reasonOrder"]);
  });

  it("두피 관리 반복 시점은 안내만 받는다, 주사 사진 회차에 1회차는 없다", () => {
    const j = d01Json();
    (procs(j)["scalp-care"] as Json).kind = "visit";
    inj(j).photoSessions = [1, 5];
    expect(parseRules(j)).toEqual({
      ok: false,
      errors: ["procedures.injection.photoSessions에 2~sessions 밖의 값이 있습니다: 1", 'procedures.scalp-care.kind는 "notice"만 지원합니다: "visit"'],
    });
  });

  it("문구: 모르는 칸, 중괄호 짝, 필수 문구·안내 시점 문구 누락", () => {
    const j = d01Json();
    const t = j.templates as Record<string, string>;
    t.overdue = "{{name}}님 예정일이 지났습니다";
    t["upcoming-visit"] = "{{date} 내원";
    delete t["photo-round"];
    delete t["care-notice-d14"];
    const r = parseRules(j);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors).toEqual([
        "templates.overdue에 모르는 칸이 있습니다: {{name}}",
        "templates.upcoming-visit의 칸 표기가 틀렸습니다(중괄호 짝)",
        "templates.photo-round가 없습니다",
        "templates.care-notice-d14가 없습니다",
      ]);
  });

  it("공휴일: 확인 기간 밖·같은 날 두 번·모양이 틀림", () => {
    const j = d01Json();
    (j.holidays as unknown[]).push({ date: "2027-01-01", name: "신정" }, { date: "2026-09-25", name: "추석" }, "2026-12-31");
    const r = parseRules(j);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors).toEqual([
        "holidays[7] 2027-01-01가 holidaysCoverage 밖입니다",
        "holidays에 같은 날짜가 두 번 있습니다: 2026-09-25",
        'holidays[9]는 { date, name }이어야 합니다: "2026-12-31"',
      ]);
  });

  it("회차 key가 고정 시점 key와 겹치면 거부(방문 기록이 어느 시점 것인지 모호해진다)", () => {
    const j = d01Json();
    inj(j).keyPrefix = "d";
    const r = parseRules(j);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("procedures.injection 회차 key가 겹칩니다: d7");
  });

  it("시점 순서가 가까운 순이 아니면 거부", () => {
    const j = d01Json();
    const h = hair(j);
    [h[0], h[2]] = [h[2], h[0]];
    const r = parseRules(j);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain("가까운 순이 아닙니다");
  });

  it("연락 가능 시간대: 시작이 끝보다 늦거나 형식이 틀림", () => {
    const j = d01Json();
    j.contactWindow = { start: "20:00", end: "09:00" };
    expect(parseRules(j)).toEqual({ ok: false, errors: ["contactWindow 시작이 끝보다 앞이어야 합니다: 20:00~09:00"] });
    j.contactWindow = { start: "9:00", end: "20:00" };
    expect(parseRules(j)).toEqual({ ok: false, errors: ["contactWindow 시각 형식이 틀렸습니다: 9:00~20:00"] });
  });
});
