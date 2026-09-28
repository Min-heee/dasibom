/**
 * 환자 한 명의 관리 일정(PRD F3). 시작일 + 규칙 → 시점 목록(원래 날짜, 밀린 날짜, 밀린 사유).
 *
 * - 고정 시점과 회차는 모두 **시작일에서** 센다(앞 시점에서 이어 세지 않는다). 주사 5회차 = 첫 회차 + 4 × 간격.
 *   앞 회차가 휴진으로 밀려도 뒤 회차는 밀리지 않는다 — 첫 회차에 10회 날짜를 한꺼번에 잡는다는 V08과 맞춘다(D01).
 * - 회차 시술의 1회차는 시작일 자체라 시점을 만들지 않는다(D01: 기록 없이 완료).
 * - 반복 안내(두피 관리)는 마지막 방문(없으면 시작일) + 간격 **하나**만 만든다. 방문 기록에 기대므로
 *   기준일(today)까지의 방문만 본다 — 미래 방문이 섞여 있어도 오늘의 일정이 바뀌지 않게.
 * - 개월 단위는 calendar.addMonths의 월말 규칙(clamp)을 따른다.
 * - 휴진일(요일 휴진·공휴일·추가 휴진)이면 다음 진료일로 미루고, 건너뛴 날과 사유를 남긴다.
 *   안내(notice) 시점도 미룬다: 안내 연락은 직원이 하는데, 휴진일에는 직원이 없다.
 */

import { addDays, addMonths, shiftToOpenDay, type ClinicCalendar, type ClosedReason, type LocalDate } from "./calendar";
import type { Patient, Procedure } from "./patient";
import type { PointKind, Rules } from "./rules";

export interface SchedulePoint {
  /** 시점 key. 방문 기록의 kind와 같은 값이다(D01: 방문 기록에 시점 key를 적는다). */
  key: string;
  label: string;
  kind: PointKind;
  procedure: Procedure;
  /** 회차 시술의 회차(2부터). */
  session?: number;
  /** 규칙대로 센 날짜. */
  originalDate: LocalDate;
  /** 휴진을 피해 실제로 잡힌 날짜. */
  dueDate: LocalDate;
  /** 건너뛴 휴진일과 사유. 안 밀렸으면 빈 배열. */
  skipped: { date: LocalDate; reasons: ClosedReason[] }[];
  /** 공휴일 확인 기간 밖의 날을 지나갔다(밀림 계산을 믿을 수 없음). */
  holidayUnknown: boolean;
  earlyDays: number;
  graceDays: number;
}

export function isVisitKind(kind: PointKind): boolean {
  return kind === "visit" || kind === "photo";
}

type PointDraft = Omit<SchedulePoint, "dueDate" | "skipped" | "holidayUnknown">;

export function buildSchedule(patient: Pick<Patient, "procedure" | "startDate" | "visits">, today: LocalDate, rules: Rules, cal: ClinicCalendar): SchedulePoint[] {
  const { procedure, startDate } = patient;
  const rule = rules.procedures[procedure];
  const raw: PointDraft[] = [];
  if (rule.type === "fixed") {
    for (const p of rule.points) {
      const originalDate = p.offset.unit === "days" ? addDays(startDate, p.offset.n) : addMonths(startDate, p.offset.n, rules.monthEndRule);
      raw.push({ key: p.key, label: p.label, kind: p.kind, procedure, originalDate, earlyDays: p.earlyDays, graceDays: p.graceDays });
    }
  } else if (rule.type === "series") {
    for (let n = 2; n <= rule.sessions; n++) {
      raw.push({
        key: `${rule.keyPrefix}${n}`,
        // D01 이름표가 "두피 주사 회차"처럼 '회차'로 끝나면 "두피 주사 5회차"로 붙인다("… 회차 5회차"가 되지 않게).
        label: `${rule.label.replace(/\s*회차$/, "")} ${n}회차`,
        kind: rule.photoSessions.includes(n) ? "photo" : "visit",
        procedure,
        session: n,
        originalDate: addDays(startDate, (n - 1) * rule.intervalDays),
        earlyDays: rule.earlyDays,
        graceDays: rule.graceDays,
      });
    }
  } else {
    const anchor = patient.visits.filter((v) => v.kind === rule.key && v.date <= today).reduce((m, v) => (v.date > m ? v.date : m), startDate);
    const originalDate = addDays(anchor, rule.intervalDays);
    if (originalDate <= addMonths(startDate, rule.horizonMonths, rules.monthEndRule)) {
      raw.push({ key: rule.key, label: rule.label, kind: rule.kind, procedure, originalDate, earlyDays: rule.earlyDays, graceDays: rule.graceDays });
    }
  }
  const points = raw.map((p) => {
    const s = shiftToOpenDay(p.originalDate, cal);
    return { ...p, dueDate: s.date, skipped: s.skipped, holidayUnknown: s.holidayUnknown };
  });
  // 개월과 일이 섞인 규칙(28일과 1개월 등)은 규칙 단계에서 순서를 볼 수 없어 날짜로 다시 본다.
  // 순서가 뒤집히면 "뒤 시점 완료 → 앞 시점 건너뜀"이 흔들리므로 계산을 멈춘다.
  for (let i = 1; i < points.length; i++) {
    if (points[i].originalDate <= points[i - 1].originalDate) {
      throw new Error(`${procedure} 시점 순서가 날짜로 뒤집힙니다: ${points[i - 1].key}(${points[i - 1].originalDate}) → ${points[i].key}(${points[i].originalDate})`);
    }
  }
  return points;
}

/** "9/24 공휴일(추석)·9/25 공휴일(추석)"처럼 밀린 사유를 한 줄로. 안 밀렸으면 null. */
export function describeShift(p: SchedulePoint): string | null {
  if (p.skipped.length === 0) return null;
  return p.skipped.map((s) => `${Number(s.date.slice(5, 7))}/${Number(s.date.slice(8, 10))} ${s.reasons.map((r) => r.label).join("·")}`).join(", ");
}
