import { describe, expect, it } from "vitest";
import { kstInstant, localDate } from "@/core/calendar";
import { EMPTY_LOG, type ContactLog } from "@/core/contact";
import type { ContactResult, Patient } from "@/core/patient";
import { buildToday, evaluatePatient } from "@/core/today";
import { DEMO_NOW_MS } from "./clock";
import { mustDemo } from "./data";
import { patientFor, todayFor } from "./screen";
import { recordDemo } from "./storage";
import { timeline, todayView } from "./view";

const { engine, patients } = mustDemo();
const P = (id: string) => patients.find((p) => p.id === id)!;
function press(log: ContactLog, id: string, result: ContactResult): ContactLog {
  const r = recordDemo(patients, log, id, result);
  if (!r.ok) throw new Error(r.error);
  return r.log;
}

describe("변이 시험 빈틈 — 앞당김이 목록에 보이는가(B6·B7)", () => {
  it("9/22(화) 09:00 P027: D+7 내일 내원 줄에 '허용 범위 안에서 앞당김'과 배지", () => {
    const v = todayView(buildToday([P("P027")], engine, kstInstant(localDate("2026-09-22"), "09:00")));
    const row = v.groups.flatMap((g) => g.rows).find((r) => r.patientId === "P027")!;
    expect(row.badges.map((b) => b.label)).toContain("허용 범위 안 앞당김");
    expect(row.lines).toContain("D+7 내원·경과 사진 · 9/23(수) 내원 예정 (원래 9/24(목), 허용 범위 안에서 앞당김)");
  });
});

describe("변이 시험 빈틈 — 날짜 미정 설명(C10)", () => {
  it("9/23(수) P033: 다른 이유가 없을 때 문구 대신 날짜 미정 → 간호팀 확인을 말한다", () => {
    const ms = kstInstant(localDate("2026-09-23"), "09:00");
    const v = patientFor("P033", patients, engine, EMPTY_LOG, ms, ms)!;
    expect(v.messages).toEqual([]);
    expect(v.noMessage).toContain("허용 범위 안에 진료일이 없는 시점이 있어 간호팀 확인 목록에 있습니다");
  });
});

describe("변이 시험 빈틈 — 수신 거부 + 간호팀 확인(D5·G14)", () => {
  const log = press(EMPTY_LOG, "P003", "opt-out");
  it("환자 화면: 수신 거부 배지만, 간호팀 확인 배지·줄은 없다", () => {
    const v = patientFor("P003", patients, engine, log, DEMO_NOW_MS, DEMO_NOW_MS)!;
    expect(v.badges.map((b) => b.label)).toContain("수신 거부");
    expect(v.badges.some((b) => b.label.startsWith("간호팀 확인"))).toBe(false);
    expect(v.nurse.causes).toEqual([]);
  });
  it("수신 거부 줄: 걸려 있던 간호팀 확인을 볼트 역할 이름으로", () => {
    const o = todayFor(patients, engine, log, DEMO_NOW_MS).optedOut.find((x) => x.patientId === "P003")!;
    expect(o.held).toContain("간호팀 확인(최대 시도까지 닿지 않음)");
    expect(o.held).not.toContain("원장");
  });
});

describe("변이 시험 빈틈 — 재시작 일수 표시(F9)", () => {
  it("휴진으로 미룬 5회차(10/5 → 10/6): 10/21 타임라인은 옮긴 날짜에서 15일", () => {
    const p: Patient = {
      id: "P900", alias: "가명Z", procedure: "injection", startDate: localDate("2026-08-10"),
      visits: [{ date: localDate("2026-08-24"), kind: "inj-2" }, { date: localDate("2026-09-07"), kind: "inj-3" }, { date: localDate("2026-09-21"), kind: "inj-4" }],
      contacts: [],
    };
    const ms = kstInstant(localDate("2026-10-21"), "09:00");
    const e = timeline(evaluatePatient(p, engine, ms), engine.rules, localDate("2026-10-21")).entries.find((x) => x.key === "inj-5")!;
    expect(e.stateLabel).toBe("미방문 · 예정일에서 15일 빠짐 → 의료진 진료 뒤 재시작 — 간호팀 확인");
  });
});

import { SIM_OPTIONS } from "./sim";
describe("변이 시험 빈틈 — 규칙 바꿔 보기 힌트의 문서 이름(G12)", () => {
  it("화면은 선택한 값의 힌트만 그리므로 모든 힌트를 직접 본다: 문서 번호(V07 꼴)·옛 이름(원장) 없음", () => {
    for (const o of SIM_OPTIONS) {
      expect(o.hint).not.toMatch(/\bV\d{2}\b/);
      expect(o.hint).not.toContain("원장");
    }
    expect(SIM_OPTIONS.find((o) => o.hint.includes("D+7"))!.hint).toContain("수술 후 관리 문서의 D+9");
  });
});
