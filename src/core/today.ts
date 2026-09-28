/**
 * 기준 시각의 "오늘 연락할 환자" 목록(PRD F4). 이유의 뜻은 볼트 D01 '오늘 연락할 이유'를 따르고,
 * 이유의 순서는 D01 reasonOrder(예정일 지남 → 내일 내원 → 관리 안내 → 주사 재예약 → 사진 회차)에서 읽는다.
 * 한 환자가 여러 이유에 걸리면 **한 줄**로 합치고, 가장 앞선 이유의 묶음에 둔다(연락 피로를 줄이려고, PRD 8절).
 *
 * - 예정일 지남(overdue): status.ts의 미방문 중 지금 연락할 차례(다시 올릴 날이 됐고 최대 시도 전)인 것.
 * - 내일 내원(upcoming-visit): 예정(upcoming) 내원 시점의 밀린 날짜 **바로 전 진료일**이 오늘이고, 오늘 이후 연락 기록이 없음.
 *   수요일(9/23) 뒤로 추석 연휴·일요일이 이어지면 월요일(9/28) 예정자는 수요일에 안내한다.
 * - 관리 안내(care-notice): 안내 시점의 밀린 날짜 ≤ 오늘 ≤ 밀린 날짜 + graceDays이고, 밀린 날짜 이후 연락 기록이 없음.
 * - 주사 재예약(injection-rebook): 주사 회차가 유예 중(in-grace)이고, 예정일 다음 날 이후 연락 기록이 없음.
 *   이 기간에는 직원이 바로 날짜를 옮길 수 있다(V08). 유예가 지나면 예정일 지남으로 넘어간다.
 * - 사진 회차(photo-round): 내일 내원할 시점이 사진 회차면 함께 붙인다. 같은각도로 찍으라는 안내를 단다(F11).
 *
 * 목록과 따로 돌려주는 것:
 * - 원장 확인(escalations): 최대 시도에 이른 미방문. 코디네이터 목록에는 올리지 않는다.
 * - 연락 대기(waiting): 미방문이지만 다시 올릴 날이 아직 안 됨.
 * - 의료진 확인(clinicianReview): 연락 메모에 증상 표현. 다른 이유가 없어도 여기에 오른다.
 */

import { addDays, diffDays, kstDateOf, prevOpenDay, type LocalDate } from "./calendar";
import type { Engine } from "./engine";
import type { Contact, Patient, Procedure } from "./patient";
import { REASONS, type Reason } from "./rules";
import { buildSchedule, isVisitKind, type SchedulePoint } from "./schedule";
import { contactDate, contactsBefore, evaluatePoints, overdueState, symptomNotes, type OverdueState, type PointStatus, type SymptomNote } from "./status";

export { REASONS, type Reason };

export const REASON_LABEL: Record<Reason, string> = {
  overdue: "예정일 지남",
  "upcoming-visit": "내일 내원",
  "care-notice": "관리 안내",
  "injection-rebook": "주사 재예약",
  "photo-round": "사진 회차",
};

export const SAME_ANGLE_NOTE = "경과 사진 회차입니다. 같은각도로 지난 사진과 같은 조건인지 확인하며 찍도록 안내하세요.";

export interface RowItem {
  reason: Reason;
  point: SchedulePoint;
  /** 예정일 지남: 밀린 날짜로부터 지난 날수. */
  daysPastDue?: number;
  /** 사진 회차 안내 문구(F11). */
  note?: string;
}

interface PatientRef {
  patientId: string;
  alias: string;
  procedure: Procedure;
}

export interface TodayRow extends PatientRef {
  /** 이 줄이 놓인 묶음(가장 앞선 이유). */
  primary: Reason;
  reasons: Reason[];
  items: RowItem[];
  /** 예정일 지남이 있을 때의 연락 상태(시도 횟수·마지막 연락). */
  overdue: OverdueState | null;
  symptoms: SymptomNote[];
  /** 이 줄의 시점 중 공휴일 확인 기간 밖의 날을 지나간 것이 있음. */
  holidayUnknown: boolean;
}

export interface EscalationRow extends PatientRef {
  overdue: OverdueState;
  symptoms: SymptomNote[];
}

export interface WaitingRow extends PatientRef {
  overdue: OverdueState;
}

export interface ClinicianRow extends PatientRef {
  symptoms: SymptomNote[];
}

export interface TodayList {
  today: LocalDate;
  groups: { reason: Reason; label: string; rows: TodayRow[] }[];
  escalations: EscalationRow[];
  waiting: WaitingRow[];
  clinicianReview: ClinicianRow[];
}

/** 환자 한 명의 오늘 판정(목록 조립 전). 타임라인 화면도 이 값을 쓴다. */
export interface PatientDay {
  patient: Patient;
  schedule: SchedulePoint[];
  statuses: PointStatus[];
  overdue: OverdueState | null;
  symptoms: SymptomNote[];
  items: RowItem[];
}

const contactedSince = (contacts: Contact[], from: LocalDate) => contacts.some((c) => contactDate(c) >= from);

export function evaluatePatient(patient: Patient, engine: Engine, nowMs: number): PatientDay {
  const { rules, calendar } = engine;
  const today = kstDateOf(nowMs);
  const schedule = buildSchedule(patient, today, rules, calendar);
  const statuses = evaluatePoints(schedule, patient.visits, today);
  const contacts = contactsBefore(patient.contacts, nowMs);
  const overdue = overdueState(statuses, contacts, rules, calendar, nowMs);
  const symptoms = symptomNotes(patient, engine.redflag, nowMs);

  const items: RowItem[] = [];
  if (overdue?.action === "contact") for (const s of overdue.missed) items.push({ reason: "overdue", point: s.point, daysPastDue: s.daysPastDue });
  for (const s of statuses) {
    const p = s.point;
    if (s.state === "upcoming" && isVisitKind(p.kind) && prevOpenDay(p.dueDate, calendar) === today && !contactedSince(contacts, today)) {
      items.push({ reason: "upcoming-visit", point: p });
      if (p.kind === "photo") items.push({ reason: "photo-round", point: p, note: SAME_ANGLE_NOTE });
    }
    if (s.state === "notice" && p.dueDate <= today && today <= s.graceEnd && !contactedSince(contacts, p.dueDate)) {
      items.push({ reason: "care-notice", point: p });
    }
    if (s.state === "in-grace" && p.procedure === "injection" && !contactedSince(contacts, addDays(p.dueDate, 1))) {
      items.push({ reason: "injection-rebook", point: p });
    }
  }
  const order = rules.reasonOrder;
  items.sort((a, b) => order.indexOf(a.reason) - order.indexOf(b.reason) || (a.point.dueDate < b.point.dueDate ? -1 : a.point.dueDate > b.point.dueDate ? 1 : 0));
  return { patient, schedule, statuses, overdue, symptoms, items };
}

const maxDaysPastDue = (row: TodayRow) => Math.max(0, ...row.items.map((i) => i.daysPastDue ?? 0));
const earliestDue = (row: TodayRow) => row.items.map((i) => i.point.dueDate).reduce((a, b) => (a < b ? a : b));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byId = (a: PatientRef, b: PatientRef) => cmp(a.patientId, b.patientId);

export function buildToday(patients: Patient[], engine: Engine, nowMs: number): TodayList {
  const order = engine.rules.reasonOrder;
  const rows: TodayRow[] = [];
  const escalations: EscalationRow[] = [];
  const waiting: WaitingRow[] = [];
  const clinicianReview: ClinicianRow[] = [];

  for (const patient of patients) {
    const day = evaluatePatient(patient, engine, nowMs);
    const ref: PatientRef = { patientId: patient.id, alias: patient.alias, procedure: patient.procedure };
    if (day.overdue?.action === "escalate") escalations.push({ ...ref, overdue: day.overdue, symptoms: day.symptoms });
    if (day.overdue?.action === "waiting") waiting.push({ ...ref, overdue: day.overdue });
    if (day.symptoms.length > 0) clinicianReview.push({ ...ref, symptoms: day.symptoms });
    if (day.items.length === 0) continue;
    const reasons = order.filter((r) => day.items.some((i) => i.reason === r));
    rows.push({
      ...ref,
      primary: reasons[0],
      reasons,
      items: day.items,
      overdue: day.overdue?.action === "contact" ? day.overdue : null,
      symptoms: day.symptoms,
      holidayUnknown: day.items.some((i) => i.point.holidayUnknown),
    });
  }

  const groups = order.map((reason) => {
    const rs = rows.filter((r) => r.primary === reason);
    // 예정일 지남은 오래 밀린 순, 나머지는 날짜가 이른 순. 같으면 환자 ID 순(결정성).
    rs.sort((a, b) => (reason === "overdue" ? maxDaysPastDue(b) - maxDaysPastDue(a) : 0) || cmp(earliestDue(a), earliestDue(b)) || byId(a, b));
    return { reason, label: REASON_LABEL[reason], rows: rs };
  });

  escalations.sort((a, b) => b.overdue.attempts - a.overdue.attempts || diffDays(b.overdue.since, a.overdue.since) || byId(a, b));
  waiting.sort((a, b) => cmp(a.overdue.retryOn, b.overdue.retryOn) || byId(a, b));
  clinicianReview.sort(byId);

  return { today: kstDateOf(nowMs), groups, escalations, waiting, clinicianReview };
}

/** 코디네이터 목록의 줄 수(= 오늘 연락 건수). */
export function countRows(list: TodayList): number {
  return list.groups.reduce((n, g) => n + g.rows.length, 0);
}
