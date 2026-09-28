import { describe, expect, it } from "vitest";
import { EMPTY_LOG, applyContact } from "@/core/contact";
import { mustDemo } from "./data";
import { demoContact, parseLog, recordDemo, serializeLog } from "./storage";

const { patients } = mustDemo();

describe("브라우저 연락 기록 저장", () => {
  it("적은 연락을 저장했다가 그대로 읽는다(시각은 기준 시각 09:00)", () => {
    const r = applyContact(patients, EMPTY_LOG, demoContact("P004", "no-answer"));
    if (!r.ok) throw new Error(r.error);
    const back = parseLog(serializeLog(r.log), patients);
    expect(back).toEqual({ log: r.log, dropped: false });
    expect(back.log.applied[0].contact.at).toBe("2026-09-21T09:00:00+09:00");
  });

  it("비었으면 빈 기록, 깨졌거나 모르는 환자·모양이 섞였으면 일부만 살리지 않고 모두 버린다", () => {
    expect(parseLog(null, patients)).toEqual({ log: EMPTY_LOG, dropped: false });
    expect(parseLog("{", patients)).toEqual({ log: EMPTY_LOG, dropped: true });
    expect(parseLog(JSON.stringify({ v: 2, applied: [] }), patients)).toEqual({ log: EMPTY_LOG, dropped: true });
    const ok = demoContact("P004", "no-answer");
    const bad = demoContact("P999", "called");
    expect(parseLog(JSON.stringify({ v: 1, applied: [ok, bad] }), patients)).toEqual({ log: EMPTY_LOG, dropped: true });
    expect(parseLog(JSON.stringify({ v: 1, applied: [{ patientId: "P004", contact: { at: "2026-09-21T09:00:00+09:00", result: "busy" } }] }), patients).dropped).toBe(true);
  });

  it("모양이 틀린 저장값은 예외 없이 모두 버린다: null 항목, contact 없음·null, 메모, 모르는 키, 기준 시각이 아닌 시각", () => {
    const at = "2026-09-21T09:00:00+09:00";
    const cases: unknown[] = [
      [null],
      [{ patientId: "P004" }],
      [{ patientId: "P004", contact: null }],
      [{ patientId: "P004", contact: { at, result: "no-answer", note: 123 } }],
      [{ patientId: "P004", contact: { at, result: "no-answer", note: "이식 부위가 붓고 열감이 있어요" } }],
      [{ patientId: "P004", contact: { at, result: "no-answer" }, x: 1 }],
      [{ patientId: "P004", contact: { at, result: "no-answer", x: 1 } }],
      [{ patientId: "P004", contact: { at: "2026-09-22T09:00:00+09:00", result: "no-answer" } }],
      [{ patientId: 4, contact: { at, result: "no-answer" } }],
      [7],
    ];
    for (const applied of cases) {
      expect(() => parseLog(JSON.stringify({ v: 1, applied }), patients), JSON.stringify(applied)).not.toThrow();
      expect(parseLog(JSON.stringify({ v: 1, applied }), patients), JSON.stringify(applied)).toEqual({ log: EMPTY_LOG, dropped: true });
    }
    expect(parseLog("null", patients)).toEqual({ log: EMPTY_LOG, dropped: true });
    expect(parseLog("[]", patients)).toEqual({ log: EMPTY_LOG, dropped: true });
  });

  it("recordDemo: 같은 환자에 다시 누르면 바꾸고(쌓지 않음), 다른 환자는 그대로 쌓는다", () => {
    const a = recordDemo(patients, EMPTY_LOG, "P004", "no-answer");
    if (!a.ok) throw new Error(a.error);
    const b = recordDemo(patients, a.log, "P006", "sms");
    if (!b.ok) throw new Error(b.error);
    const c = recordDemo(patients, b.log, "P004", "called");
    if (!c.ok) throw new Error(c.error);
    expect([a.replaced, b.replaced, c.replaced]).toEqual([false, false, true]);
    expect(c.log.applied.map((x) => [x.patientId, x.contact.result])).toEqual([
      ["P006", "sms"],
      ["P004", "called"],
    ]);
  });
});
