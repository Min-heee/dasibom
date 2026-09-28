/**
 * 연락 결과 기록과 되돌리기(PRD F6).
 *
 * 불변 데이터: 원본 환자 목록은 바꾸지 않고, "적용한 연락"의 쌓임(ContactLog)만 들고 다닌다.
 * 되돌리기는 마지막 항목을 빼는 것이다. 브라우저 저장도 이 쌓임만 저장하면 된다(원본 합성 데이터는 파일에 그대로).
 *
 * 다음 연락일은 status.ts의 규칙(마지막 연락일 + 재연락 간격, 화면에는 진료일로 민 날) 하나로만 계산한다.
 * 여기서 따로 계산하면 목록과 환자 화면이 서로 다른 날짜를 말하게 된다.
 */

import { checkDay, kstDateOf, parseInstant, type LocalDate } from "./calendar";
import type { Engine } from "./engine";
import { checkBooking, CONTACT_RESULTS, type Contact, type Patient } from "./patient";
import { buildSchedule } from "./schedule";
import { contactsBefore, evaluatePoints, overdueState, type OverdueState } from "./status";
import { evaluatePatient, type Reason } from "./today";

export interface AppliedContact {
  patientId: string;
  contact: Contact;
}

export interface ContactLog {
  applied: readonly AppliedContact[];
}

export const EMPTY_LOG: ContactLog = { applied: [] };

export type ApplyResult = { ok: true; log: ContactLog } | { ok: false; error: string };

/** 연락 한 건을 쌓는다. 시각이 그 환자의 마지막 연락보다 앞서면 거부한다(시도 횟수를 "배열 끝"으로 읽으므로). */
export function applyContact(base: readonly Patient[], log: ContactLog, entry: AppliedContact): ApplyResult {
  const patient = currentPatients(base, log).find((p) => p.id === entry.patientId);
  if (!patient) return { ok: false, error: `환자를 찾을 수 없습니다: ${entry.patientId}` };
  if (!(CONTACT_RESULTS as readonly string[]).includes(entry.contact.result)) return { ok: false, error: `연락 결과 값이 틀렸습니다: ${entry.contact.result}` };
  let ms: number;
  try {
    ms = parseInstant(entry.contact.at);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  // 예약 모양(날짜·시점, 연락한 날 이후)은 합성 데이터와 같은 검사를 거친다 — 화면에서 적은 예약만 느슨하게 받지 않게.
  const bookingError = checkBooking(entry.contact);
  if (bookingError) return { ok: false, error: bookingError };
  const last = patient.contacts[patient.contacts.length - 1];
  if (last && parseInstant(last.at) > ms) return { ok: false, error: `마지막 연락(${last.at})보다 앞선 시각입니다: ${entry.contact.at}` };
  const contact = { ...entry.contact, ...(entry.contact.booking ? { booking: { ...entry.contact.booking } } : {}) };
  return { ok: true, log: { applied: [...log.applied, { patientId: entry.patientId, contact }] } };
}

/** 마지막으로 적용한 연락을 뺀다. 뺄 것이 없으면 그대로. */
export function undoContact(log: ContactLog): { log: ContactLog; undone: AppliedContact | null } {
  if (log.applied.length === 0) return { log, undone: null };
  return { log: { applied: log.applied.slice(0, -1) }, undone: log.applied[log.applied.length - 1] };
}

/**
 * 이 환자에게 적용한 연락 중 마지막 것만 뺀다. 환자 화면의 되돌리기가 다른 환자의 연락을 지우지 않게.
 * 쌓인 순서는 그대로 둔다(다른 환자의 항목은 건드리지 않는다).
 */
export function undoLastFor(log: ContactLog, patientId: string): { log: ContactLog; undone: AppliedContact | null } {
  for (let i = log.applied.length - 1; i >= 0; i--) {
    if (log.applied[i].patientId !== patientId) continue;
    return { log: { applied: [...log.applied.slice(0, i), ...log.applied.slice(i + 1)] }, undone: log.applied[i] };
  }
  return { log, undone: null };
}

/** 원본 + 쌓인 연락 = 지금의 환자 목록. 원본 객체는 건드리지 않는다. */
export function currentPatients(base: readonly Patient[], log: ContactLog): Patient[] {
  if (log.applied.length === 0) return [...base];
  return base.map((p) => {
    const mine = log.applied.filter((a) => a.patientId === p.id).map((a) => a.contact);
    return mine.length === 0 ? p : { ...p, contacts: [...p.contacts, ...mine] };
  });
}

export interface NextContact {
  /** 미방문이 있으면 그 연락 상태. 없으면 null(내일 내원·안내 연락은 한 번으로 끝난다). */
  overdue: OverdueState | null;
  /** 다음 연락일. 미방문이 없거나 간호팀 확인으로 넘어갔으면 null. */
  nextContactDate: LocalDate | null;
}

/**
 * 연락을 적은 직후(그 연락 시각 기준) 그 환자의 다음 연락일. 화면이 "부재 → 다음 연락 9/24" 같은 결과를 바로 보이게 한다.
 */
export function nextContactAfter(patient: Patient, engine: Engine, atMs: number): NextContact {
  const today = kstDateOf(atMs);
  const statuses = evaluatePoints(buildSchedule(patient, today, engine.rules, engine.calendar), patient.visits, today, contactsBefore(patient.contacts, atMs));
  const overdue = overdueState(statuses, patient.contacts, engine.rules, engine.calendar, atMs);
  return { overdue, nextContactDate: overdue && overdue.action !== "nurse" ? overdue.nextContactDate : null };
}

export interface NextListing {
  date: LocalDate;
  reasons: Reason[];
}

const MS_PER_DAY = 86_400_000;

/**
 * 기준 시각 다음 날부터 horizonDays일 안에서, 이 환자가 코디네이터 목록에 다시 오르는 첫 진료일과 그날의 이유.
 * "그 사이 내원하지 않는다"고 가정한다(방문 기록을 더하지 않음). 그래서 내일 내원을 안내한 환자는
 * "오지 않으면 언제 예정일 지남으로 다시 오르는지"가 나온다. 휴진일은 목록을 만들지 않으므로 건너뛴다.
 * 판정은 today.evaluatePatient 하나로만 한다 — 화면이 다음 연락일을 따로 계산하지 않게.
 */
export function nextListedDay(patient: Patient, engine: Engine, nowMs: number, horizonDays = 90): NextListing | null {
  for (let i = 1; i <= horizonDays; i++) {
    // KST에는 서머타임이 없어 하루 = 86,400,000ms로 더해도 같은 시각이 된다.
    const at = nowMs + i * MS_PER_DAY;
    if (!checkDay(kstDateOf(at), engine.calendar).open) continue;
    const day = evaluatePatient(patient, engine, at);
    if (day.items.length === 0) continue;
    const reasons = engine.rules.reasonOrder.filter((r) => day.items.some((it) => it.reason === r));
    return { date: kstDateOf(at), reasons };
  }
  return null;
}
