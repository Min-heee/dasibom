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
 * 상태(기준일 today, due = 밀린 날짜):
 *   done        완료(원래 날짜보다 일찍 왔으면 early 표시)
 *   missed      due + graceDays < today, 방문 없음 → "예정일 지남"(지남이 된 날 = due + graceDays + 1)
 *   in-grace    due < today ≤ due + graceDays, 방문 없음 → 아직 지남이 아니다(주사면 재예약 대상)
 *   due-today   due = today → 목록에 올리지 않는다(전날 안내했다)
 *   upcoming    due > today
 *   skipped     missed였지만 그 뒤 내원 시점이 완료됨 → 이미 다시 오고 있는 환자라 연락 대상에서 뺀다
 *   notice      안내 시점(내원 없음, 판정은 today.ts)
 *
 * ── 연락(D01 '다시 연락하는 간격과 최대 시도') ──
 * 시도 횟수 = 가장 이른 미방문 시점이 지남이 된 날 이후의 연락 기록 수. 결과(통화·부재·문자·다음에)를 가리지 않는다.
 * 다시 올릴 날(retryOn) = 마지막 연락일 + retryIntervalDays. 연락이 없었으면 지남이 된 날.
 * 시도 횟수 ≥ maxAttempts이면 "원장 확인"으로 옮긴다(더는 코디네이터 목록에 올리지 않는다).
 *
 * ── 증상 메모 ──
 * 연락 메모마다 한창구 적신호 규칙(V11, redflag.ts 복사본)을 그대로 돌려 "인계"가 나오면 "의료진 확인 필요" 표시만 한다(PRD 2절).
 * 판정표도 한창구와 같다: 증상어는 문맥 없이도, 모호어는 수술·주사 뒤라는 문맥과 함께일 때 표시.
 */

import { addDays, diffDays, kstDateOf, parseInstant, shiftToOpenDay, type ClinicCalendar, type LocalDate } from "./calendar";
import { maskPii } from "./mask";
import type { Contact, Patient, Visit } from "./patient";
import { checkRedflags, type RedflagConfig, type RedflagRuleId } from "./redflag";
import type { Rules } from "./rules";
import { isVisitKind, type SchedulePoint } from "./schedule";

export type PointState = "done" | "missed" | "in-grace" | "due-today" | "upcoming" | "skipped" | "notice";

export interface PointStatus {
  point: SchedulePoint;
  state: PointState;
  visit?: Visit;
  /** 방문이 원래 날짜보다 일찍(earlyDays 안) 왔다. */
  early?: boolean;
  /** 방문을 완료로 받는 첫날(원래 날짜 − earlyDays). 안내 시점은 밀린 날짜. */
  windowStart: LocalDate;
  /** 유예 마지막 날(밀린 날짜 + graceDays). */
  graceEnd: LocalDate;
  /** 미방문·건너뜀일 때 지남이 된 날(graceEnd + 1). */
  overdueSince?: LocalDate;
  /** 오늘 − 밀린 날짜(미방문일 때). "예정일 12일 지남"의 12. */
  daysPastDue?: number;
}

/** today = 기준 시각의 KST 날짜. 오늘 날짜까지의 방문 기록만 본다. */
export function evaluatePoints(points: SchedulePoint[], visits: Visit[], today: LocalDate): PointStatus[] {
  const past = visits.filter((v) => v.date <= today).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out: PointStatus[] = points.map((p) => {
    const graceEnd = addDays(p.dueDate, p.graceDays);
    if (!isVisitKind(p.kind)) return { point: p, state: "notice", windowStart: p.dueDate, graceEnd };
    const windowStart = addDays(p.originalDate, -p.earlyDays);
    const visit = past.find((v) => v.kind === p.key && v.date >= windowStart);
    if (visit) return { point: p, state: "done", visit, early: visit.date < p.originalDate, windowStart, graceEnd };
    if (graceEnd < today) return { point: p, state: "missed", windowStart, graceEnd, overdueSince: addDays(graceEnd, 1), daysPastDue: diffDays(p.dueDate, today) };
    if (p.dueDate < today) return { point: p, state: "in-grace", windowStart, graceEnd };
    if (p.dueDate === today) return { point: p, state: "due-today", windowStart, graceEnd };
    return { point: p, state: "upcoming", windowStart, graceEnd };
  });
  // 뒤 내원 시점이 완료됐으면 앞의 미방문은 건너뜀.
  let laterDone = false;
  for (let i = out.length - 1; i >= 0; i--) {
    const s = out[i];
    if (s.state === "missed" && laterDone) s.state = "skipped";
    if (s.state === "done") laterDone = true;
  }
  return out;
}

export type OverdueAction = "contact" | "waiting" | "escalate";

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
  const counted = contactsBefore(contacts, nowMs).filter((c) => contactDate(c) >= since);
  const lastContact = counted.length > 0 ? counted[counted.length - 1] : null;
  const retryOn = lastContact ? addDays(contactDate(lastContact), rules.retryIntervalDays) : since;
  const attempts = counted.length;
  const action: OverdueAction = attempts >= rules.maxAttempts ? "escalate" : retryOn <= today ? "contact" : "waiting";
  return { missed, since, attempts, counted, lastContact, retryOn, nextContactDate: shiftToOpenDay(retryOn, cal).date, action };
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
