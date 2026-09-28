import { describe, expect, it } from "vitest";
import { localDate } from "./calendar";
import { composeMessage, fillTemplate, sendTiming, templateKeyFor, valuesForItem } from "./message";
import { buildToday } from "./today";
import { at, fixtureEngine, NOW } from "./__fixtures__/load";
import { fixturePatients } from "./__fixtures__/patients";

const engine = fixtureEngine();
const PHONE = "02-000-0000";

describe("fillTemplate", () => {
  it("칸만 채운다(안쪽 공백 허용)", () => {
    expect(fillTemplate("{{date}} {{ time }} 내원, 문의 {{clinicPhone}}", { date: "9/22(화)", time: "14:00", clinicPhone: PHONE })).toEqual({
      ok: true,
      text: "9/22(화) 14:00 내원, 문의 02-000-0000",
    });
  });

  it("없는 칸·빈 값·모르는 칸은 오류(빈칸으로 보내지 않는다)", () => {
    expect(fillTemplate("{{date}} {{time}}", { date: "9/22(화)" })).toEqual({ ok: false, errors: ["칸 값이 없습니다: {{time}}"] });
    expect(fillTemplate("{{date}}", { date: " " })).toEqual({ ok: false, errors: ["칸 값이 없습니다: {{date}}"] });
    expect(fillTemplate("{{name}}님", {})).toEqual({ ok: false, errors: ["모르는 칸입니다: {{name}}"] });
  });
});

describe("sendTiming — 연락 가능 시간대 [09:00, 20:00)", () => {
  const w = engine.rules.contactWindow;
  it.each([
    ["2026-09-21T09:00:00+09:00", { mode: "now" }],
    ["2026-09-21T19:59:00+09:00", { mode: "now" }],
    ["2026-09-21T08:59:00+09:00", { mode: "scheduled", scheduledSendAt: "2026-09-21T09:00:00+09:00", reason: "연락 가능 시간대(09:00~20:00) 밖" }],
    ["2026-09-21T20:00:00+09:00", { mode: "scheduled", scheduledSendAt: "2026-09-22T09:00:00+09:00", reason: "연락 가능 시간대(09:00~20:00) 밖" }],
    ["2026-09-23T23:30:00+09:00", { mode: "scheduled", scheduledSendAt: "2026-09-24T09:00:00+09:00", reason: "연락 가능 시간대(09:00~20:00) 밖" }],
  ])("%s", (iso, expected) => {
    expect(sendTiming(at(iso), w)).toEqual(expected);
  });
});

describe("composeMessage", () => {
  const list = buildToday(fixturePatients(), engine, NOW);

  it("목록 줄의 항목 → 승인 문구 + 칸(날짜·그날 진료시간·병원 전화) + 광고 검사 + 보낼 시각", () => {
    const item = list.groups[1].rows[0].items[0]; // P104 내일 내원 D+7(9/22 화)
    const m = composeMessage({ templateKey: templateKeyFor(item), values: valuesForItem(item, engine.rules, engine.calendar), rules: engine.rules, ad: engine.ad, nowMs: NOW });
    expect(m).toEqual({
      ok: true,
      templateKey: "upcoming-visit",
      text: "샘플의원입니다. 9/22(화) 내원 예정입니다. 이날 진료시간은 10:00~19:00입니다. 변경이 필요하면 02-000-0000으로 연락 주세요.",
      ad: { level: "clean", hits: [] },
      sendable: true,
      timing: { mode: "now" },
    });
  });

  it("진료시간 칸은 요일별(V02): 목요일은 21:00, 토요일은 15:00까지", () => {
    const thu = { point: { ...list.groups[1].rows[0].items[0].point, dueDate: localDate("2026-10-01") } };
    const sat = { point: { ...thu.point, dueDate: localDate("2026-10-17") } };
    expect(valuesForItem(thu, engine.rules, engine.calendar).time).toBe("10:00~21:00");
    expect(valuesForItem(sat, engine.rules, engine.calendar).time).toBe("10:00~15:00");
  });

  it("관리 안내는 care-notice-<시점 key> 문구를 쓴다", () => {
    expect(list.groups[2].rows.map((r) => templateKeyFor(r.items[0]))).toEqual(["care-notice-d3", "care-notice-scalp-care"]);
  });

  it("칸 값에 섞여 들어온 금지 표현도 잡아 보내기를 막는다", () => {
    const m = composeMessage({ templateKey: "overdue", values: { date: "9/9(수)", clinicPhone: "최고 상담 02-000-0000" }, rules: engine.rules, ad: engine.ad, nowMs: NOW });
    expect(m.ok && [m.ad.level, m.sendable]).toEqual(["banned", false]);
  });

  it("문구에 {{time}}이 있는데 시각을 안 주면 만들지 않는다", () => {
    expect(composeMessage({ templateKey: "upcoming-visit", values: { date: "9/22(화)", clinicPhone: PHONE }, rules: engine.rules, ad: engine.ad, nowMs: NOW })).toEqual({
      ok: false,
      templateKey: "upcoming-visit",
      errors: ["칸 값이 없습니다: {{time}}"],
    });
  });

  it("승인 문구가 없는 key는 오류", () => {
    expect(composeMessage({ templateKey: "w4", values: {}, rules: engine.rules, ad: engine.ad, nowMs: NOW }).ok).toBe(false);
  });

  it("시간대 밖이면 보낼 시각을 붙인다", () => {
    const m = composeMessage({ templateKey: "care-notice-d14", values: { clinicPhone: PHONE }, rules: engine.rules, ad: engine.ad, nowMs: at("2026-09-21T21:00:00+09:00") });
    expect(m.ok && m.timing).toEqual({ mode: "scheduled", scheduledSendAt: "2026-09-22T09:00:00+09:00", reason: "연락 가능 시간대(09:00~20:00) 밖" });
  });
});
