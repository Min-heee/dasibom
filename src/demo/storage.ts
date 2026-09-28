/**
 * 이 브라우저에서 적은 연락 결과(PRD F6: 시연 동안 브라우저에만 남는다)의 저장 모양.
 * 저장하는 것은 core/contact의 쌓임(ContactLog)뿐이고, 합성 환자 원본은 번들에 그대로 있다.
 *
 * 읽을 때는 쌓임을 처음부터 applyContact로 다시 쌓아 본다. 하나라도 거부되면(번들이 바뀌어 환자가 없어졌거나 모양이 틀림)
 * 일부만 살리지 않고 전부 버린다 — 반쯤 남은 기록은 "누구에게 몇 번 연락했나"를 틀리게 말한다.
 *
 * localStorage 값은 누구나 고칠 수 있는 바깥 입력이다. applyContact는 코드가 만든 항목을 가정하므로(모양 검사 없음),
 * 여기서 모양을 먼저 본다: 이 화면이 적는 항목은 늘 {patientId, contact: {at: 기준 시각, result}} 하나뿐이다.
 * 모양이 틀린 값 하나 때문에 띠(모든 화면)가 예외로 멈추면 초기화 버튼까지 닿을 수 없다.
 * 예약 잡음만 booking({ pointKey, date })을 더 가진다. 날짜·시점 모양과 '연락한 날 이후'는 applyContact(core/patient.checkBooking)가 다시 본다.
 */

import { applyContact, EMPTY_LOG, undoLastFor, type AppliedContact, type ContactLog } from "@/core/contact";
import { isLocalDate } from "@/core/calendar";
import { CONTACT_RESULTS, type Booking, type ContactResult, type Patient } from "@/core/patient";
import { DEMO_NOW } from "./clock";

export const STORAGE_KEY = "dasibom.contact-log.v1";

export function serializeLog(log: ContactLog): string {
  return JSON.stringify({ v: 1, applied: log.applied });
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 이 화면이 적는 모양 그대로인지. 메모 칸은 이 화면에 없으므로 note가 있으면 거부한다(저장값으로 적신호 표시를 건드리지 못하게). */
function isDemoEntry(a: unknown): a is AppliedContact {
  if (!isObj(a) || typeof a.patientId !== "string" || !isObj(a.contact)) return false;
  if (Object.keys(a).some((k) => k !== "patientId" && k !== "contact")) return false;
  const c = a.contact;
  if (Object.keys(c).some((k) => k !== "at" && k !== "result" && k !== "booking")) return false;
  if (c.booking !== undefined) {
    const b = c.booking;
    if (c.result !== "booked" || !isObj(b) || Object.keys(b).length !== 2 || typeof b.pointKey !== "string" || !isLocalDate(b.date)) return false;
  }
  return c.at === DEMO_NOW && (CONTACT_RESULTS as readonly unknown[]).includes(c.result);
}

export function parseLog(raw: string | null, base: readonly Patient[]): { log: ContactLog; dropped: boolean } {
  if (raw === null || raw === "") return { log: EMPTY_LOG, dropped: false };
  const drop = { log: EMPTY_LOG, dropped: true };
  try {
    const j: unknown = JSON.parse(raw);
    if (!isObj(j) || j.v !== 1 || !Array.isArray(j.applied)) return drop;
    let log = EMPTY_LOG;
    for (const a of j.applied) {
      if (!isDemoEntry(a)) return drop;
      const r = applyContact(base, log, a);
      if (!r.ok) return drop;
      log = r.log;
    }
    return { log, dropped: false };
  } catch {
    // 모양 검사를 지나 예상 못 한 값이 남아도 화면을 멈추지 않는다(버리고 띠에 알린다).
    return drop;
  }
}

/**
 * 시연에서 적는 연락의 시각. 모두 기준 시각(9/21 09:00) 그대로 적는다: 화면의 '지금'이 09:00에 고정돼 있어
 * 그보다 뒤 시각을 적으면 기준 시각 이후 기록이라 판정에서 빠진다(core/status.contactsBefore).
 */
export function demoContact(patientId: string, result: ContactResult, booking?: Booking): AppliedContact {
  return { patientId, contact: { at: DEMO_NOW, result, ...(booking ? { booking: { ...booking } } : {}) } };
}

export type RecordResult = { ok: true; log: ContactLog; replaced: boolean } | { ok: false; error: string };

/**
 * 연락 결과 버튼 한 번. 이 브라우저에서 이 환자에게 이미 적은 결과가 있으면 **바꾼다**(쌓지 않는다).
 * 시계가 09:00에 멈춰 있어, 쌓으면 버튼을 비교해 보려고 두세 번 누른 것만으로 1분 안에 간호팀 확인까지 넘어가고
 * 재연락 간격(D01)이 기록에서 지켜지지 않는다.
 */
export function recordDemo(base: readonly Patient[], log: ContactLog, patientId: string, result: ContactResult, booking?: Booking): RecordResult {
  const already = log.applied.some((a) => a.patientId === patientId && a.contact.at === DEMO_NOW);
  const from = already ? undoLastFor(log, patientId).log : log;
  const r = applyContact(base, from, demoContact(patientId, result, booking));
  return r.ok ? { ok: true, log: r.log, replaced: already } : r;
}
