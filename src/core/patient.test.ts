import { describe, expect, it } from "vitest";
import { parsePatients } from "./patient";

const ok = { id: "P001", alias: "가명", procedure: "injection", startDate: "2026-09-01", visits: [{ date: "2026-09-01", kind: "injection" }], contacts: [] };

describe("parsePatients", () => {
  it("모양이 맞으면 받는다(메모는 없어도 된다)", () => {
    const r = parsePatients([{ ...ok, contacts: [{ at: "2026-09-02T10:00:00+09:00", result: "called" }] }]);
    expect(r.ok).toBe(true);
  });

  it("틀린 곳을 모두 모아 전체를 거부한다(빠진 환자가 조용히 사라지지 않게)", () => {
    const r = parsePatients([
      { ...ok, id: "P001", startDate: "2026-02-30" },
      { ...ok, id: "P001" },
      { ...ok, id: "P003", procedure: "laser", memo: "x" },
      { ...ok, id: "P004", contacts: [{ at: "2026-09-03T10:00:00+09:00", result: "called" }, { at: "2026-09-02T10:00:00+09:00", result: "sms" }] },
      { ...ok, id: "P005", contacts: [{ at: "2026-09-03 10:00", result: "busy" }] },
    ]);
    expect(r).toEqual({
      ok: false,
      errors: [
        "P001: startDate가 날짜가 아닙니다: 2026-02-30",
        "P001: id가 겹칩니다",
        "P003: 모르는 키입니다: memo",
        "P003: procedure 값이 틀렸습니다: laser",
        "P004: contacts가 시간순이 아닙니다(1번째)",
        "P005: contacts[0] 모양이 틀렸습니다",
      ],
    });
  });
});
