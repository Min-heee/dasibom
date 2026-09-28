import { describe, expect, it } from "vitest";
import { parsePatients, type Patient } from "./patient";
import { buildToday } from "./today";
import { fixtureEngine, NOW } from "./__fixtures__/load";

/**
 * 목록 안의 순서(변이 검사에서 살아남은 M10b·f·g·h·i·j를 잡으려고 더함).
 * 각 묶음에 줄을 둘 이상 두고, **ID 순과 날짜·시도 순이 반대**가 되게 환자를 골랐다 — 그래야 정렬을 뒤집거나 빼면 결과가 바뀐다.
 * 기대 순서는 달력을 보고 손으로 셌다(2026-09-21 월 09:00 KST 기준).
 */
const engine = fixtureEngine();

const hairBase = (id: string, start: string, visits: [string, string][], contacts: string[]) => ({
  id,
  alias: `가명${id}`,
  procedure: "hair-transplant",
  startDate: start,
  visits: visits.map(([date, kind]) => ({ date, kind })),
  contacts: contacts.map((at) => ({ at, result: "no-answer" })),
});

const RAW = [
  // 관리 안내 둘: P201은 8/24 + 28 = 9/21, P202는 8/22(토) + 28 = 9/19(토, 진료일)이고 유예 3일 안(9/22까지).
  // 이른 날짜 순이면 ID가 큰 P202가 먼저다.
  { id: "P201", alias: "가명P201", procedure: "scalp-care", startDate: "2026-06-29", visits: [{ date: "2026-07-27", kind: "scalp-care" }, { date: "2026-08-24", kind: "scalp-care" }], contacts: [] },
  { id: "P202", alias: "가명P202", procedure: "scalp-care", startDate: "2026-07-25", visits: [{ date: "2026-08-22", kind: "scalp-care" }], contacts: [] },
  // 한 환자의 미방문 둘: 주사 8/20(목) 시작, 방문 없음. 2회차 9/3(유예 끝 9/6) 18일 지남, 3회차 9/17(유예 끝 9/20) 4일 지남.
  { id: "P203", alias: "가명P203", procedure: "injection", startDate: "2026-08-20", visits: [], contacts: [] },
  // 원장 확인 셋. P301·P303은 6개월(9/4 금) 유예 끝 9/11 → 9/12부터 지남, P302는 주사 5회차(8/24) 유예 끝 8/27 → 8/28부터 지남.
  hairBase("P301", "2026-03-04", [["2026-03-05", "d1"], ["2026-03-11", "d7"], ["2026-04-01", "w4"]], ["2026-09-12T10:00:00+09:00", "2026-09-15T10:00:00+09:00", "2026-09-18T10:00:00+09:00"]),
  {
    id: "P302", alias: "가명P302", procedure: "injection", startDate: "2026-06-29",
    visits: [{ date: "2026-07-13", kind: "inj-2" }, { date: "2026-07-27", kind: "inj-3" }, { date: "2026-08-10", kind: "inj-4" }],
    contacts: ["2026-08-28T10:00:00+09:00", "2026-09-01T10:00:00+09:00", "2026-09-04T10:00:00+09:00"].map((at) => ({ at, result: "no-answer" })),
  },
  hairBase("P303", "2026-03-04", [["2026-03-05", "d1"], ["2026-03-11", "d7"], ["2026-04-01", "w4"]], ["2026-09-12T10:00:00+09:00", "2026-09-14T10:00:00+09:00", "2026-09-16T10:00:00+09:00", "2026-09-18T10:00:00+09:00"]),
  // 연락 대기 둘: 6개월(9/9 수) 유예 끝 9/16 → 9/17부터 지남. P401은 마지막 연락 9/21(08:30) + 3 = 9/24, P402는 9/19 + 3 = 9/22.
  hairBase("P401", "2026-03-09", [["2026-03-10", "d1"], ["2026-03-16", "d7"], ["2026-04-06", "w4"]], ["2026-09-17T10:00:00+09:00", "2026-09-21T08:30:00+09:00"]),
  hairBase("P402", "2026-03-09", [["2026-03-10", "d1"], ["2026-03-16", "d7"], ["2026-04-06", "w4"]], ["2026-09-19T11:00:00+09:00"]),
  // 의료진 확인 둘: 증상어 '고름'(문맥 없이도 표시). 두피 관리 9/1 시작 → 안내는 9/29라 오늘 목록 이유는 없다.
  ...["P501", "P502"].map((id) => ({
    id, alias: `가명${id}`, procedure: "scalp-care", startDate: "2026-09-01", visits: [],
    contacts: [{ at: "2026-09-10T10:00:00+09:00", result: "called", note: "고름이 보인다고 함" }],
  })),
];

function patients(): Patient[] {
  const r = parsePatients(structuredClone(RAW));
  if (!r.ok) throw new Error(r.errors.join("\n"));
  // 입력을 ID 역순으로 넣는다. 정렬을 빼면 입력 순서가 그대로 드러난다.
  return r.patients.reverse();
}

describe("buildToday — 목록 안의 순서", () => {
  const list = buildToday(patients(), engine, NOW);
  const group = (reason: string) => list.groups.find((g) => g.reason === reason)!.rows;

  it("관리 안내 묶음은 이른 날짜 순: 9/19(P202) → 9/21(P201)", () => {
    expect(group("care-notice").map((r) => r.patientId)).toEqual(["P202", "P201"]);
  });

  it("한 줄 안의 같은 이유는 날짜 순: 2회차(18일 지남) → 3회차(4일 지남)", () => {
    const row = group("overdue").find((r) => r.patientId === "P203")!;
    expect(row.items.map((i) => [i.reason, i.point.key, i.daysPastDue])).toEqual([
      ["overdue", "inj-2", 18],
      ["overdue", "inj-3", 4],
    ]);
  });

  it("원장 확인은 시도 많은 순, 같으면 오래 지난(since가 이른) 순: 4회 → 3회·8/28 → 3회·9/12", () => {
    expect(list.escalations.map((r) => [r.patientId, r.overdue.attempts, r.overdue.since])).toEqual([
      ["P303", 4, "2026-09-12"],
      ["P302", 3, "2026-08-28"],
      ["P301", 3, "2026-09-12"],
    ]);
  });

  it("연락 대기는 다시 올릴 날이 이른 순: 9/22(P402) → 9/24(P401)", () => {
    expect(list.waiting.map((r) => [r.patientId, r.overdue.retryOn])).toEqual([
      ["P402", "2026-09-22"],
      ["P401", "2026-09-24"],
    ]);
  });

  it("의료진 확인은 환자 ID 순(입력이 역순이어도)", () => {
    expect(list.clinicianReview.map((r) => r.patientId)).toEqual(["P501", "P502"]);
  });
});
