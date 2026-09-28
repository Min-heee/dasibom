/**
 * 합성 환자 기록의 모양과 검증(PRD F1).
 *
 * 환자 파일은 규칙 문서가 아니라 입력 데이터다. 그래도 모양이 틀린 기록을 조용히 건너뛰면
 * "미방문 누락 0건"을 잴 때 빠진 환자가 보이지 않으므로, 틀린 곳을 모두 모아 전체를 거부한다.
 */

import { isInstant, isLocalDate, kstDateOf, parseInstant, type LocalDate } from "./calendar";

export const PROCEDURES = ["hair-transplant", "injection", "scalp-care"] as const;
export type Procedure = (typeof PROCEDURES)[number];

export const PROCEDURE_LABEL: Record<Procedure, string> = {
  "hair-transplant": "모발이식 수술",
  injection: "두피 주사",
  "scalp-care": "두피 관리",
};

export const CONTACT_RESULTS = ["called", "no-answer", "sms", "later", "booked", "opt-out", "opt-in"] as const;
export type ContactResult = (typeof CONTACT_RESULTS)[number];

export const CONTACT_RESULT_LABEL: Record<ContactResult, string> = {
  called: "통화함",
  "no-answer": "부재",
  sms: "문자 보냄",
  later: "다음에",
  booked: "예약 잡음",
  "opt-out": "연락 원치 않음",
  "opt-in": "수신 거부 풀기",
};

/**
 * 연락 시도로 세는 결과(D01 '다시 연락하는 간격과 최대 시도'). 예약 잡음은 환자와 닿아 날짜를 정한 연락이라 센다.
 * 연락 원치 않음·수신 거부 풀기는 환자의 뜻을 적은 기록이지 연락 시도가 아니다 — 세면 수신 거부를 풀자마자
 * "오늘 연락함"으로 읽혀 목록에 다시 오르지 못한다.
 */
export const ATTEMPT_RESULTS = ["called", "no-answer", "sms", "later", "booked"] as const satisfies readonly ContactResult[];
export const isAttempt = (c: Pick<Contact, "result">) => (ATTEMPT_RESULTS as readonly string[]).includes(c.result);

export interface Visit {
  date: LocalDate;
  /** 그 방문이 채운 시점 key(D01: "d7", "inj-3", "scalp-care" 등). 방문 매칭은 이 key로 한다 — status.ts 머리말 참고. */
  kind: string;
}

export interface Booking {
  /** 예약한 시점 key(방문 기록의 kind와 같은 값). */
  pointKey: string;
  /** 예약 날짜. 연락한 날(KST) 이후여야 한다. */
  date: LocalDate;
}

export interface Contact {
  /** 시간대가 적힌 ISO 시각. */
  at: string;
  result: ContactResult;
  /** 직원이 적은 메모. 증상 표현이 있으면 의료진 확인 표시를 건다(status.ts). */
  note?: string;
  /** result가 "booked"일 때만, 그때는 반드시 있다. */
  booking?: Booking;
}

export interface Patient {
  id: string;
  /** 가명. */
  alias: string;
  procedure: Procedure;
  /** 수술일(모발이식), 첫 주사일, 두피 관리 첫 방문일. */
  startDate: LocalDate;
  visits: Visit[];
  contacts: Contact[];
}

export type PatientsResult = { ok: true; patients: Patient[] } | { ok: false; errors: string[] };

const PATIENT_KEYS = new Set(["id", "alias", "procedure", "startDate", "visits", "contacts"]);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 예약 기록의 모양. 예약 잡음에는 날짜·시점이 꼭 있고, 다른 결과에는 없어야 한다.
 * 날짜 없는 예약을 받으면 "언제까지 예정일 지남에서 뺄지"를 코드가 지어내야 한다.
 * 연락한 날보다 이른 예약 날짜는 이미 지난 날이라 적을 수 없다. 시점 key가 그 환자 일정에 있는지는 규칙을 알아야 해서 여기서 보지 않는다.
 */
export function checkBooking(c: Pick<Contact, "at" | "result" | "booking">): string | null {
  const b = c.booking as unknown;
  if (c.result !== "booked") return b === undefined ? null : "예약 잡음이 아닌 연락에 예약 날짜가 있습니다";
  if (!isObj(b) || Object.keys(b).length !== 2 || typeof b.pointKey !== "string" || b.pointKey.trim() === "" || !isLocalDate(b.date)) {
    return "예약 잡음에는 { pointKey, date }가 있어야 합니다";
  }
  if (isInstant(c.at) && b.date < kstDateOf(parseInstant(c.at))) return `예약 날짜(${b.date})가 연락한 날보다 이릅니다`;
  return null;
}

export function parsePatients(json: unknown): PatientsResult {
  if (!Array.isArray(json)) return { ok: false, errors: ["환자 목록이 배열이 아닙니다"] };
  const errors: string[] = [];
  const seen = new Set<string>();
  const out: Patient[] = [];
  json.forEach((p, i) => {
    const where = isObj(p) && typeof p.id === "string" ? p.id : `#${i}`;
    if (!isObj(p)) {
      errors.push(`${where}: 객체가 아닙니다`);
      return;
    }
    const before = errors.length;
    for (const k of Object.keys(p)) if (!PATIENT_KEYS.has(k)) errors.push(`${where}: 모르는 키입니다: ${k}`);
    if (typeof p.id !== "string" || !/^P\d{3,}$/.test(p.id)) errors.push(`${where}: id 형식이 틀렸습니다`);
    else if (seen.has(p.id)) errors.push(`${where}: id가 겹칩니다`);
    else seen.add(p.id);
    if (typeof p.alias !== "string" || p.alias.trim() === "") errors.push(`${where}: alias가 없습니다`);
    if (!(PROCEDURES as readonly unknown[]).includes(p.procedure)) errors.push(`${where}: procedure 값이 틀렸습니다: ${String(p.procedure)}`);
    if (!isLocalDate(p.startDate)) errors.push(`${where}: startDate가 날짜가 아닙니다: ${String(p.startDate)}`);

    if (!Array.isArray(p.visits)) errors.push(`${where}: visits가 배열이 아닙니다`);
    else
      p.visits.forEach((v, j) => {
        if (!isObj(v) || !isLocalDate(v.date) || typeof v.kind !== "string" || v.kind.trim() === "" || Object.keys(v).length !== 2) {
          errors.push(`${where}: visits[${j}] 모양이 틀렸습니다`);
        }
      });

    if (!Array.isArray(p.contacts)) errors.push(`${where}: contacts가 배열이 아닙니다`);
    else {
      let prev = -Infinity;
      p.contacts.forEach((c, j) => {
        const keysOk = isObj(c) && Object.keys(c).every((k) => k === "at" || k === "result" || k === "note" || k === "booking");
        if (!isObj(c) || !keysOk || !isInstant(c.at) || !(CONTACT_RESULTS as readonly unknown[]).includes(c.result) || (c.note !== undefined && typeof c.note !== "string")) {
          errors.push(`${where}: contacts[${j}] 모양이 틀렸습니다`);
          return;
        }
        const bookingError = checkBooking(c as unknown as Contact);
        if (bookingError) {
          errors.push(`${where}: contacts[${j}] ${bookingError}`);
          return;
        }
        // 시도 횟수·마지막 연락일을 "배열 끝"으로 읽으므로 시간순이 아니면 거부한다.
        const ms = parseInstant(c.at as string);
        if (ms < prev) errors.push(`${where}: contacts가 시간순이 아닙니다(${j}번째)`);
        prev = ms;
      });
    }
    if (errors.length === before) out.push(p as unknown as Patient);
  });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, patients: out };
}
