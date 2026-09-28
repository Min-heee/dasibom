/**
 * 환자 한 명의 관리 일정(PRD F3). 시작일 + 규칙 → 시점 목록(원래 날짜, 밀린 날짜, 밀린 사유).
 *
 * - 고정 시점과 회차는 모두 **시작일에서** 센다(앞 시점에서 이어 세지 않는다). 주사 5회차 = 첫 회차 + 4 × 간격.
 *   앞 회차가 휴진으로 밀려도 뒤 회차는 밀리지 않는다 — 첫 회차에 10회 날짜를 한꺼번에 잡는다는 V08과 맞춘다(D01).
 * - 회차 시술의 1회차는 시작일 자체라 시점을 만들지 않는다(D01: 기록 없이 완료).
 * - 반복 안내(두피 관리)는 마지막 방문(없으면 시작일) + 간격 **하나**만 만든다. 방문 기록에 기대므로
 *   기준일(today)까지의 방문만 본다 — 미래 방문이 섞여 있어도 오늘의 일정이 바뀌지 않게.
 * - 개월 단위는 calendar.addMonths의 월말 규칙(clamp)을 따른다.
 * - 휴진일(요일 휴진·공휴일·추가 휴진)에 걸리면 옮기고, 살펴본 휴진일과 사유를 남긴다(D01 '휴진일에 걸리면').
 *   근거 문서가 옮길 범위를 적은 시점(D+7: V07, 주사 회차: V08)은 범위 안의 다음 진료일 → 이전 진료일(앞당김) → 없으면 날짜 미정.
 *   범위가 없는 시점은 다음 진료일로 미룬다. 안내(notice) 시점도 미룬다: 안내 연락은 직원이 하는데, 휴진일에는 직원이 없다.
 */

import { addDays, addMonths, shiftToOpenDay, shiftWithinWindow, type ClinicCalendar, type ClosedReason, type LocalDate, type ShiftDirection } from "./calendar";
import type { Patient, Procedure } from "./patient";
import type { PointKind, Rules, ShiftWindow } from "./rules";

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
  /**
   * 휴진을 피해 실제로 잡힌 날짜. 허용 범위 안에 진료일이 없으면 null(날짜 미정 → 간호팀 확인).
   * null을 허용하는 이유: 범위 밖 날짜를 채워 두면 그 날짜로 '예정일 지남'·'내일 내원'이 계산되어, 문서가 막은 날짜를 환자에게 안내하게 된다.
   */
  dueDate: LocalDate | null;
  /** 옮긴 방향: none(그대로), later(미룸), earlier(범위 안 앞당김), unresolved(범위 안에 진료일 없음). */
  shift: ShiftDirection;
  /** 옮겨도 되는 범위(근거 문서가 적은 시점만). 없으면 다음 진료일로 미룸. */
  window: ShiftWindow | null;
  /** 살펴본 휴진일과 사유. 안 옮겼으면 빈 배열. */
  skipped: { date: LocalDate; reasons: ClosedReason[] }[];
  /** 공휴일 확인 기간 밖의 날을 지나갔다(밀림 계산을 믿을 수 없음). */
  holidayUnknown: boolean;
  earlyDays: number;
  graceDays: number;
  /** 회차 시술만: 이 일수를 넘겨 빠지면 재시작(V08). */
  restartAfterDays?: number;
}

export function isVisitKind(kind: PointKind): boolean {
  return kind === "visit" || kind === "photo";
}

type PointDraft = Omit<SchedulePoint, "dueDate" | "shift" | "skipped" | "holidayUnknown">;

export function buildSchedule(patient: Pick<Patient, "procedure" | "startDate" | "visits">, today: LocalDate, rules: Rules, cal: ClinicCalendar): SchedulePoint[] {
  const { procedure, startDate } = patient;
  const rule = rules.procedures[procedure];
  const raw: PointDraft[] = [];
  if (rule.type === "fixed") {
    for (const p of rule.points) {
      const originalDate = p.offset.unit === "days" ? addDays(startDate, p.offset.n) : addMonths(startDate, p.offset.n, rules.monthEndRule);
      raw.push({ key: p.key, label: p.label, kind: p.kind, procedure, originalDate, window: p.shiftWindow ?? null, earlyDays: p.earlyDays, graceDays: p.graceDays });
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
        window: rule.shiftWindow ?? null,
        earlyDays: rule.earlyDays,
        graceDays: rule.graceDays,
        restartAfterDays: rule.restartAfterDays,
      });
    }
  } else {
    const anchor = patient.visits.filter((v) => v.kind === rule.key && v.date <= today).reduce((m, v) => (v.date > m ? v.date : m), startDate);
    const originalDate = addDays(anchor, rule.intervalDays);
    if (originalDate <= addMonths(startDate, rule.horizonMonths, rules.monthEndRule)) {
      raw.push({ key: rule.key, label: rule.label, kind: rule.kind, procedure, originalDate, window: null, earlyDays: rule.earlyDays, graceDays: rule.graceDays });
    }
  }
  const points: SchedulePoint[] = raw.map((p) => {
    if (p.window) {
      const w = shiftWithinWindow(p.originalDate, cal, p.window);
      return { ...p, dueDate: w.date, shift: w.direction, skipped: w.skipped, holidayUnknown: w.holidayUnknown };
    }
    const s = shiftToOpenDay(p.originalDate, cal);
    return { ...p, dueDate: s.date, shift: s.skipped.length > 0 ? "later" : "none", skipped: s.skipped, holidayUnknown: s.holidayUnknown };
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

/** "9/24 공휴일(추석)·9/25 공휴일(추석)"처럼 살펴본 휴진일과 사유를 한 줄로. 안 옮겼으면 null. */
export function describeShift(p: Pick<SchedulePoint, "skipped">): string | null {
  if (p.skipped.length === 0) return null;
  return p.skipped.map((s) => `${Number(s.date.slice(5, 7))}/${Number(s.date.slice(8, 10))} ${s.reasons.map((r) => r.label).join("·")}`).join(", ");
}

/** 허용 범위를 날짜로: [원래 날짜 − before, 원래 날짜 + after]. 범위가 없으면 null. */
export function windowRange(p: Pick<SchedulePoint, "originalDate" | "window">): { from: LocalDate; to: LocalDate } | null {
  if (!p.window) return null;
  return { from: addDays(p.originalDate, -p.window.before), to: addDays(p.originalDate, p.window.after) };
}
