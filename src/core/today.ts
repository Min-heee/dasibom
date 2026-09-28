/**
 * 기준 시각의 "오늘 연락할 환자" 목록(PRD F4). 이유의 뜻은 볼트 D01 '오늘 연락할 이유'를 따르고,
 * 이유의 순서는 D01 reasonOrder(예정일 지남 → 내일 내원 → 관리 안내 → 주사 재예약 → 사진 회차)에서 읽는다.
 * 한 환자가 여러 이유에 걸리면 **한 줄**로 합치고, 가장 앞선 이유의 묶음에 둔다(연락 피로를 줄이려고, PRD 8절).
 *
 * - 예정일 지남(overdue): status.ts의 미방문 중 지금 연락할 차례(다시 올릴 날이 됐고 최대 시도 전, 재시작할 회차 없음)인 것.
 * - 내일 내원(upcoming-visit): 예정(upcoming) 내원 시점의 옮긴 날짜(예약했으면 예약 날짜) **바로 전 진료일**이 오늘이고, 오늘 이후 연락 기록이 없음.
 *   수요일(9/23) 뒤로 추석 연휴·일요일이 이어지면 월요일(9/28) 예정자는 수요일에 안내한다.
 * - 관리 안내(care-notice): 안내 시점의 밀린 날짜 ≤ 오늘 ≤ 밀린 날짜 + graceDays이고, 밀린 날짜 이후 연락 기록이 없음.
 * - 주사 재예약(injection-rebook): 주사 회차가 유예 중(in-grace)이고, 예정일 다음 날 이후 연락 기록이 없음.
 *   이 기간에는 직원이 바로 날짜를 옮길 수 있다(V08). 유예가 지나면 예정일 지남으로 넘어간다.
 * - 사진 회차(photo-round): 내일 내원할 시점이 사진 회차면 함께 붙인다. 같은각도로 찍으라는 안내를 단다(F11).
 *
 * 목록과 따로 돌려주는 것:
 * - 간호팀 확인(nurseReview): 코디네이터가 연락으로 풀 수 없는 것 — 최대 시도에 이른 미방문, 14일 넘게 빠진 주사 회차(의료진 진료 뒤 재시작),
 *   허용 범위 안에 진료일이 없어 날짜를 못 정한 시점. 이름은 볼트의 역할 체계(V12 인계 절차의 담당 간호사, V07·V08의 간호팀 확인)를 따른다.
 * - 연락 대기(waiting): 미방문이지만 다시 올릴 날이 아직 안 됨.
 * - 의료진 확인(clinicianReview): 연락 메모에 증상 표현. 다른 이유가 없어도 여기에 오른다. 수신 거부 환자도 남긴다 — 연락 목록이 아니라 안전 확인이라서.
 * - 수신 거부(optedOut): '연락 원치 않음'을 적은 환자. 위의 연락 목록(오늘 목록·연락 대기·간호팀 확인) 어디에도 올리지 않고,
 *   무엇이 걸려 있었는지만 따로 보인다(빠진 환자가 보이지 않게 되는 것을 막으려고).
 */

import { diffDays, kstDateOf, prevOpenDay, addDays, type LocalDate } from "./calendar";
import type { Engine } from "./engine";
import { isAttempt, type Booking, type Contact, type Patient, type Procedure } from "./patient";
import { REASONS, type Reason } from "./rules";
import { buildSchedule, isVisitKind, type SchedulePoint } from "./schedule";
import { contactDate, contactsBefore, evaluatePoints, optOutOf, overdueState, symptomNotes, type NurseCause, type OverdueState, type PointStatus, type SymptomNote } from "./status";

export { REASONS, type Reason, type NurseCause };

export const REASON_LABEL: Record<Reason, string> = {
  overdue: "예정일 지남",
  "upcoming-visit": "내일 내원",
  "care-notice": "관리 안내",
  "injection-rebook": "주사 재예약",
  "photo-round": "사진 회차",
};

export const NURSE_CAUSE_LABEL: Record<NurseCause, string> = {
  "injection-restart": "의료진 진료 뒤 재시작",
  "max-attempts": "최대 시도까지 닿지 않음",
  "no-open-day": "허용 범위 안에 진료일 없음",
};

export const SAME_ANGLE_NOTE = "경과 사진 회차입니다. 같은각도로 지난 사진과 같은 조건인지 확인하며 찍도록 안내하세요.";

export interface RowItem {
  reason: Reason;
  point: SchedulePoint;
  /** 이 항목이 말하는 날짜(예약했으면 예약 날짜, 아니면 옮긴 날짜). 문구의 날짜 칸과 정렬이 이 값을 쓴다. */
  date: LocalDate;
  /** date가 예약 날짜다. */
  viaBooking?: boolean;
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

/** 간호팀 확인 한 건. no-open-day와 injection-restart는 해당 시점을, max-attempts는 미방문 연락 상태를 본다. */
export interface NurseItem {
  cause: NurseCause;
  point?: SchedulePoint;
  /** 재시작 회차에 적힌 예약. 지났든 앞으로든 재시작은 그대로다 — 화면이 "예약도 지남"·"예약 있음"을 가려 적는다. */
  booking?: Booking;
}

export interface NurseRow extends PatientRef {
  items: NurseItem[];
  overdue: OverdueState | null;
  symptoms: SymptomNote[];
  /** 같은 환자가 코디네이터 목록에도 있음(다른 이유로). */
  inList: boolean;
}

export interface OptOutRow extends PatientRef {
  /** 연락 원치 않음을 적은 시각. */
  at: string;
  /** 수신 거부가 아니었다면 오늘 걸렸을 이유와 간호팀 확인 까닭. */
  held: { reasons: Reason[]; nurse: NurseCause[]; waiting: boolean };
}

export interface WaitingRow extends PatientRef {
  overdue: OverdueState;
}

export interface ClinicianRow extends PatientRef {
  symptoms: SymptomNote[];
  optedOut: boolean;
}

export interface TodayList {
  today: LocalDate;
  groups: { reason: Reason; label: string; rows: TodayRow[] }[];
  nurseReview: NurseRow[];
  waiting: WaitingRow[];
  clinicianReview: ClinicianRow[];
  optedOut: OptOutRow[];
}

/** 환자 한 명의 오늘 판정(목록 조립 전). 타임라인 화면도 이 값을 쓴다. */
export interface PatientDay {
  patient: Patient;
  schedule: SchedulePoint[];
  statuses: PointStatus[];
  overdue: OverdueState | null;
  symptoms: SymptomNote[];
  /** 코디네이터 목록 항목. 수신 거부 중이면 비어 있다(무엇이 걸렸는지는 optOut.held). */
  items: RowItem[];
  /** 간호팀 확인 항목. 수신 거부 중이면 비어 있다. */
  nurse: NurseItem[];
  /** 수신 거부 중이면 그 기록과, 거부가 아니었다면 걸렸을 것. */
  optOut: { at: string; heldItems: RowItem[]; heldNurse: NurseItem[] } | null;
}

const contactedSince = (contacts: Contact[], from: LocalDate) => contacts.some((c) => contactDate(c) >= from);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function evaluatePatient(patient: Patient, engine: Engine, nowMs: number): PatientDay {
  const { rules, calendar } = engine;
  const today = kstDateOf(nowMs);
  const before = contactsBefore(patient.contacts, nowMs);
  const schedule = buildSchedule(patient, today, rules, calendar);
  const statuses = evaluatePoints(schedule, patient.visits, today, before);
  // 연락 원치 않음·수신 거부 풀기는 "연락함"이 아니다. 세면 수신 거부를 푼 날 안내가 "이미 연락함"으로 사라진다.
  const contacts = before.filter(isAttempt);
  const overdue = overdueState(statuses, before, rules, calendar, nowMs);
  const symptoms = symptomNotes(patient, engine.redflag, nowMs);

  const items: RowItem[] = [];
  if (overdue?.action === "contact")
    for (const s of overdue.missed) items.push({ reason: "overdue", point: s.point, date: s.date!, daysPastDue: s.daysPastDue, ...(s.booking ? { viaBooking: true } : {}) });
  for (const s of statuses) {
    const p = s.point;
    // 예약(booked)도 예정 내원과 같이 바로 전 진료일에 안내한다 — 날짜만 예약 날짜다.
    if ((s.state === "upcoming" || s.state === "booked") && isVisitKind(p.kind) && s.date && prevOpenDay(s.date, calendar) === today && !contactedSince(contacts, today)) {
      const via = s.state === "booked" ? { viaBooking: true } : {};
      items.push({ reason: "upcoming-visit", point: p, date: s.date, ...via });
      if (p.kind === "photo") items.push({ reason: "photo-round", point: p, date: s.date, note: SAME_ANGLE_NOTE, ...via });
    }
    if (s.state === "notice" && s.date && s.graceEnd && s.date <= today && today <= s.graceEnd && !contactedSince(contacts, s.date)) {
      items.push({ reason: "care-notice", point: p, date: s.date });
    }
    if (s.state === "in-grace" && p.procedure === "injection" && s.date && !contactedSince(contacts, addDays(s.date, 1))) {
      items.push({ reason: "injection-rebook", point: p, date: s.date });
    }
  }
  const order = rules.reasonOrder;
  items.sort((a, b) => order.indexOf(a.reason) - order.indexOf(b.reason) || cmp(a.date, b.date));

  const nurse: NurseItem[] = [];
  // 재시작 회차는 미방문(missed)이 아니라 앞으로 잡힌 예약일 수도 있어 statuses에서 찾는다. 그때는 미방문 연락 상태(overdue)가 없다.
  const restart = statuses.find((s) => s.restart);
  if (restart) nurse.push({ cause: "injection-restart", point: restart.point, ...(restart.booking ? { booking: restart.booking } : {}) });
  if (overdue?.nurseCauses.includes("max-attempts")) nurse.push({ cause: "max-attempts" });
  for (const s of statuses) if (s.state === "unscheduled") nurse.push({ cause: "no-open-day", point: s.point });

  const opt = optOutOf(before);
  if (opt) return { patient, schedule, statuses, overdue, symptoms, items: [], nurse: [], optOut: { at: opt.at, heldItems: items, heldNurse: nurse } };
  return { patient, schedule, statuses, overdue, symptoms, items, nurse, optOut: null };
}

const maxDaysPastDue = (row: TodayRow) => Math.max(0, ...row.items.map((i) => i.daysPastDue ?? 0));
const earliestDue = (row: TodayRow) => row.items.map((i) => i.date).reduce((a, b) => (a < b ? a : b));
const byId = (a: PatientRef, b: PatientRef) => cmp(a.patientId, b.patientId);

export function buildToday(patients: Patient[], engine: Engine, nowMs: number): TodayList {
  const order = engine.rules.reasonOrder;
  const rows: TodayRow[] = [];
  const nurseReview: NurseRow[] = [];
  const waiting: WaitingRow[] = [];
  const clinicianReview: ClinicianRow[] = [];
  const optedOut: OptOutRow[] = [];

  for (const patient of patients) {
    const day = evaluatePatient(patient, engine, nowMs);
    const ref: PatientRef = { patientId: patient.id, alias: patient.alias, procedure: patient.procedure };
    if (day.symptoms.length > 0) clinicianReview.push({ ...ref, symptoms: day.symptoms, optedOut: day.optOut !== null });
    if (day.optOut) {
      const held = day.optOut;
      optedOut.push({
        ...ref,
        at: held.at,
        held: { reasons: order.filter((r) => held.heldItems.some((i) => i.reason === r)), nurse: held.heldNurse.map((n) => n.cause), waiting: day.overdue?.action === "waiting" },
      });
      continue;
    }
    if (day.nurse.length > 0) nurseReview.push({ ...ref, items: day.nurse, overdue: day.overdue, symptoms: day.symptoms, inList: day.items.length > 0 });
    if (day.overdue?.action === "waiting") waiting.push({ ...ref, overdue: day.overdue });
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

  // 간호팀 확인: 미방문·재시작이 걸린 환자가 먼저(시도 많은 순, 오래 지난 순), 날짜 미정만 있는 환자는 그 뒤. 같으면 ID 순(결정성).
  // 재시작은 앞으로 잡힌 예약 회차일 수도 있어 미방문 연락 상태(overdue)가 없을 수 있다 — 그때 시도는 0회로 본다.
  const nurseKey = (r: NurseRow) => (r.items.some((i) => i.cause !== "no-open-day") ? 0 : 1);
  nurseReview.sort(
    (a, b) =>
      nurseKey(a) - nurseKey(b) ||
      (nurseKey(a) === 0 ? (b.overdue?.attempts ?? 0) - (a.overdue?.attempts ?? 0) || (a.overdue && b.overdue ? diffDays(b.overdue.since, a.overdue.since) : 0) : 0) ||
      byId(a, b),
  );
  waiting.sort((a, b) => cmp(a.overdue.retryOn, b.overdue.retryOn) || byId(a, b));
  clinicianReview.sort(byId);
  optedOut.sort(byId);

  return { today: kstDateOf(nowMs), groups, nurseReview, waiting, clinicianReview, optedOut };
}

/** 코디네이터 목록의 줄 수(= 오늘 연락 건수). */
export function countRows(list: TodayList): number {
  return list.groups.reduce((n, g) => n + g.rows.length, 0);
}
