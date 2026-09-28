/**
 * 시점별 상태와 미방문 판정(PRD F5), 연락 메모의 증상 표시. 규칙 문장은 볼트 D01 본문을 따른다.
 *
 * ── 방문 매칭(D01 '방문을 완료로 보는 기준') ──
 * 방문 기록의 kind는 그 방문이 채운 **시점 key**다. 같은 key의 방문이 [원래 날짜 − earlyDays] 이후에 있으면 완료.
 *   - 앞쪽 경계를 **원래 날짜**에서 세는 이유: 휴진으로 밀린 시점에 원래 날짜 무렵 온 환자를 미방문으로 몰지 않게.
 *   - 늦게 온 방문(유예가 지난 뒤)도 완료다. 연락을 받고 뒤늦게 온 환자가 "예정일 지남"에 남지 않게.
 *   - 그보다 이른 방문은 그 시점의 완료가 아니다(다른 시점의 방문을 잘못 적었을 수 있다).
 * 날짜만으로 짝을 짓지 않는 이유: 날짜만 보면 4주 진료와 두피 관리처럼 가까운 두 방문이 서로 바뀌어 붙는다.
 *
 * 상태(기준일 today, due = 옮긴 날짜, 예약이 있으면 예약 날짜가 앞선다):
 *   done        완료(원래 날짜보다 일찍 왔으면 early 표시)
 *   missed      due + graceDays < today, 방문 없음 → "예정일 지남"(지남이 된 날 = due + graceDays + 1)
 *               예약 날짜가 지났는데 방문 없음 → 예약 날짜 다음 날부터 다시 "예정일 지남"(유예 없음, D01 '예약 잡음')
 *               회차 시술에서 due + restartAfterDays < today면 restart 표시 → 의료진 진료 뒤 재시작 — 간호팀 확인(V08).
 *               앞으로 잡힌 예약(booked) 회차도 같다 — 예약은 재시작을 빼 주지 않는다.
 *   in-grace    due < today ≤ due + graceDays, 방문 없음 → 아직 지남이 아니다(주사면 재예약 대상)
 *   due-today   due = today → 목록에 올리지 않는다(전날 안내했다)
 *   upcoming    due > today
 *   booked      예약 날짜 ≥ today, 방문 없음 → 예약 날짜까지 지남·재예약·날짜 미정에서 빠진다
 *   unscheduled 허용 범위 안에 진료일이 없어 날짜 미정 → 간호팀 확인
 *   on-hold     재시작해야 하는 회차 뒤의 회차 → 재시작 뒤 날짜를 다시 정하므로 목록 이유를 만들지 않는다
 *   skipped     missed·날짜 미정이었지만 그 뒤 내원 시점이 완료됨 → 이미 다시 오고 있는 환자라 연락 대상에서 뺀다
 *   notice      안내 시점(내원 없음, 판정은 today.ts)
 *
 * ── 연락(D01 '다시 연락하는 간격과 최대 시도') ──
 * 시도 횟수 = 가장 이른 미방문 시점이 지남이 된 날 이후의 연락 기록 수. 결과(통화·부재·문자·다음에·예약 잡음)를 가리지 않는다.
 * 연락 원치 않음·수신 거부 풀기는 시도가 아니다(patient.isAttempt).
 * 다시 올릴 날(retryOn) = 마지막 연락일 + retryIntervalDays. 연락이 없었으면 지남이 된 날.
 * 시도 횟수 ≥ maxAttempts이거나 재시작할 회차가 있으면 "간호팀 확인"으로 옮긴다(더는 코디네이터 목록에 올리지 않는다).
 *
 * ── 증상 메모 ──
 * 연락 메모마다 한창구 적신호 규칙(V11, redflag.ts 복사본)을 그대로 돌려 "인계"가 나오면 "의료진 확인 필요" 표시만 한다(PRD 2절).
 * 판정표도 한창구와 같다: 증상어는 문맥 없이도, 모호어는 수술·주사 뒤라는 문맥과 함께일 때 표시.
 */

import { addDays, diffDays, kstDateOf, parseInstant, shiftToOpenDay, type ClinicCalendar, type LocalDate } from "./calendar";
import { maskPii } from "./mask";
import { isAttempt, type Booking, type Contact, type Patient, type Visit } from "./patient";
import { checkRedflags, type RedflagConfig, type RedflagRuleId } from "./redflag";
import type { Rules } from "./rules";
import { isVisitKind, type SchedulePoint } from "./schedule";

export type PointState = "done" | "missed" | "in-grace" | "due-today" | "upcoming" | "booked" | "unscheduled" | "on-hold" | "skipped" | "notice";

export interface PointStatus {
  point: SchedulePoint;
  state: PointState;
  visit?: Visit;
  /** 방문이 원래 날짜보다 일찍(earlyDays 안) 왔다. */
  early?: boolean;
  /** 방문을 완료로 받는 첫날(원래 날짜 − earlyDays, 그보다 이른 날로 예약했으면 예약 날짜). 안내 시점은 옮긴 날짜. */
  windowStart: LocalDate;
  /** 유예 마지막 날(옮긴 날짜 + graceDays). 날짜 미정이면 null. 예약 뒤 지남이면 예약 날짜. */
  graceEnd: LocalDate | null;
  /** 이 시점을 말할 날짜: 예약이 있으면 예약 날짜, 없으면 옮긴 날짜(날짜 미정이면 null). 목록 줄·문구의 날짜 칸이 이 값을 쓴다. */
  date: LocalDate | null;
  /** 이 시점에 적힌 마지막 예약(기준 시각 이전). */
  booking?: Booking;
  /** 미방문·건너뜀일 때 지남이 된 날(graceEnd + 1). */
  overdueSince?: LocalDate;
  /** 오늘 − date(미방문일 때). "예정일 12일 지남"의 12. */
  daysPastDue?: number;
  /** 회차가 예정일에서 restartAfterDays를 넘겨 빠짐 → 의료진 진료 뒤 재시작(V08). */
  restart?: boolean;
}

/** 시점 key별 마지막 예약. 연락 기록은 시간순이라(patient.ts가 확인) 뒤의 것이 앞의 것을 바꾼다. */
export function latestBookings(contacts: Contact[]): Map<string, Booking> {
  const m = new Map<string, Booking>();
  for (const c of contacts) if (c.result === "booked" && c.booking) m.set(c.booking.pointKey, c.booking);
  return m;
}

/**
 * today = 기준 시각의 KST 날짜. 오늘 날짜까지의 방문 기록만 본다.
 * contacts는 기준 시각 이전의 연락(호출하는 쪽이 contactsBefore로 거른 것) — 예약 기록만 쓴다.
 */
export function evaluatePoints(points: SchedulePoint[], visits: Visit[], today: LocalDate, contacts: Contact[] = []): PointStatus[] {
  const past = visits.filter((v) => v.date <= today).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const bookings = latestBookings(contacts);
  const out: PointStatus[] = points.map((p) => {
    if (!isVisitKind(p.kind)) {
      // 안내 시점은 범위를 두지 않으므로(rules.ts) 날짜가 늘 있다.
      const due = p.dueDate!;
      return { point: p, state: "notice", windowStart: due, graceEnd: addDays(due, p.graceDays), date: due };
    }
    const booking = bookings.get(p.key);
    const nominalStart = addDays(p.originalDate, -p.earlyDays);
    // 규정보다 이른 날로 예약했으면 그날 온 방문도 완료다(예약해 놓고 미완료로 모는 일이 없게).
    const windowStart = booking && booking.date < nominalStart ? booking.date : nominalStart;
    const visit = past.find((v) => v.kind === p.key && v.date >= windowStart);
    const base = { point: p, windowStart, ...(booking ? { booking } : {}) };
    if (visit) return { ...base, state: "done", visit, early: visit.date < p.originalDate, graceEnd: p.dueDate ? addDays(p.dueDate, p.graceDays) : null, date: booking?.date ?? p.dueDate };
    if (booking) {
      if (booking.date >= today) return { ...base, state: "booked", graceEnd: booking.date, date: booking.date };
      return { ...base, state: "missed", graceEnd: booking.date, date: booking.date, overdueSince: addDays(booking.date, 1), daysPastDue: diffDays(booking.date, today) };
    }
    if (p.dueDate === null) return { ...base, state: "unscheduled", graceEnd: null, date: null };
    const graceEnd = addDays(p.dueDate, p.graceDays);
    const date = p.dueDate;
    if (graceEnd < today) return { ...base, state: "missed", graceEnd, date, overdueSince: addDays(graceEnd, 1), daysPastDue: diffDays(p.dueDate, today) };
    if (p.dueDate < today) return { ...base, state: "in-grace", graceEnd, date };
    if (p.dueDate === today) return { ...base, state: "due-today", graceEnd, date };
    return { ...base, state: "upcoming", graceEnd, date };
  });
  // 뒤 내원 시점이 완료됐으면 앞의 미방문·날짜 미정은 건너뜀.
  let laterDone = false;
  for (let i = out.length - 1; i >= 0; i--) {
    const s = out[i];
    if ((s.state === "missed" || s.state === "unscheduled") && laterDone) s.state = "skipped";
    if (s.state === "done") laterDone = true;
  }
  // 재시작(V08 "예정일보다 14일 넘게 빠지면 의료진 진료를 받은 뒤 다시 시작"): 첫 해당 회차에 표시하고, 그 뒤 회차는 보류.
  // 예정일은 옮긴 날짜(없으면 원래 날짜)로 센다 — 예약 날짜가 아니다. 예약을 미뤄도 예정일에서 빠진 날수는 줄지 않는다.
  // 앞으로 잡힌 예약(booked)도 재시작 대상이다: D01이 예약으로 빼 주는 것은 지남·재예약·날짜 미정뿐이고,
  // 예정일에서 20일 지나 잡은 예약 날에 와도 V08의 "14일 넘게 빠짐"이다. 빼 주면 뒤 회차가 지남으로 코디네이터 목록에 오른다.
  const first = out.findIndex(
    (s) => (s.state === "missed" || s.state === "booked") && s.point.restartAfterDays !== undefined && diffDays(s.point.dueDate ?? s.point.originalDate, today) > s.point.restartAfterDays,
  );
  if (first >= 0) {
    out[first].restart = true;
    for (let i = first + 1; i < out.length; i++) {
      const s = out[i];
      if (s.point.restartAfterDays !== undefined && s.state !== "done" && s.state !== "skipped") {
        s.state = "on-hold";
        delete s.overdueSince;
        delete s.daysPastDue;
      }
    }
  }
  return out;
}

/** 간호팀 확인으로 가는 까닭. 미방문 연락으로는 풀리지 않는 것들이다. */
export type NurseCause = "injection-restart" | "max-attempts" | "no-open-day";

export type OverdueAction = "contact" | "waiting" | "nurse";

export interface OverdueState {
  /** 지금 연락 대상인 미방문 시점들(건너뜀 제외), 날짜순. */
  missed: PointStatus[];
  /** 가장 이른 미방문 시점이 지남이 된 날. 이날 이후의 연락만 시도로 센다. */
  since: LocalDate;
  attempts: number;
  /** 시도로 센 연락(기준 시각 이전, 지남이 된 날 이후). 화면의 '미방문 시도로 셈' 표시도 이 목록을 쓴다 — 따로 세면 규칙이 갈린다. */
  counted: Contact[];
  lastContact: Contact | null;
  /** 다시 목록에 올릴 날(D01 문장 그대로: 마지막 연락일 + 간격, 연락이 없었으면 지남이 된 날). */
  retryOn: LocalDate;
  /** retryOn을 진료일로 민 날. 화면에 "다음 연락"으로 보인다(휴진일에는 연락하지 않으므로). */
  nextContactDate: LocalDate;
  action: OverdueAction;
  /** action이 nurse인 까닭(재시작 먼저). 그 밖에는 빈 배열. */
  nurseCauses: NurseCause[];
}

/** 기준 시각 이전의 연락만. 기록에 미래 시각이 섞여 있어도 오늘 판정에 쓰지 않는다. */
export function contactsBefore(contacts: Contact[], nowMs: number): Contact[] {
  return contacts.filter((c) => parseInstant(c.at) <= nowMs);
}

export function contactDate(c: Contact): LocalDate {
  return kstDateOf(parseInstant(c.at));
}

export function overdueState(statuses: PointStatus[], contacts: Contact[], rules: Rules, cal: ClinicCalendar, nowMs: number): OverdueState | null {
  const missed = statuses.filter((s) => s.state === "missed");
  if (missed.length === 0) return null;
  const today = kstDateOf(nowMs);
  const since = missed.map((s) => s.overdueSince!).reduce((a, b) => (a < b ? a : b));
  const counted = contactsBefore(contacts, nowMs).filter((c) => isAttempt(c) && contactDate(c) >= since);
  const lastContact = counted.length > 0 ? counted[counted.length - 1] : null;
  const retryOn = lastContact ? addDays(contactDate(lastContact), rules.retryIntervalDays) : since;
  const attempts = counted.length;
  // 재시작은 missed가 아니라 statuses 전체에서 본다 — 앞으로 잡힌 예약 회차도 재시작일 수 있다(evaluatePoints).
  const nurseCauses: NurseCause[] = [...(statuses.some((s) => s.restart) ? (["injection-restart"] as const) : []), ...(attempts >= rules.maxAttempts ? (["max-attempts"] as const) : [])];
  const action: OverdueAction = nurseCauses.length > 0 ? "nurse" : retryOn <= today ? "contact" : "waiting";
  return { missed, since, attempts, counted, lastContact, retryOn, nextContactDate: shiftToOpenDay(retryOn, cal).date, action, nurseCauses };
}

/** 수신 거부 상태: 연락 원치 않음·수신 거부 풀기 중 마지막 기록이 연락 원치 않음이면 그 기록. */
export function optOutOf(contacts: Contact[]): Contact | null {
  let last: Contact | null = null;
  for (const c of contacts) if (c.result === "opt-out" || c.result === "opt-in") last = c;
  return last?.result === "opt-out" ? last : null;
}

export interface SymptomNote {
  at: string;
  /** 화면에 보일 메모(개인정보 가림 뒤). */
  noteMasked: string;
  ruleIds: RedflagRuleId[];
  matchedSymptoms: string[];
  matchedAmbiguous: string[];
}

export function symptomNotes(patient: Pick<Patient, "contacts">, redflag: RedflagConfig, nowMs: number): SymptomNote[] {
  const out: SymptomNote[] = [];
  for (const c of contactsBefore(patient.contacts, nowMs)) {
    if (!c.note) continue;
    const r = checkRedflags(c.note, redflag);
    if (r.decision !== "handover") continue;
    out.push({ at: c.at, noteMasked: maskPii(c.note).masked, ruleIds: r.ruleIds, matchedSymptoms: r.matchedSymptoms, matchedAmbiguous: r.matchedAmbiguous });
  }
  return out;
}
