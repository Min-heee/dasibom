/**
 * 화면 한 장이 그릴 것 전부를 (원본 환자 + 이 브라우저의 연락 기록 + 기준 시각)에서 한 번에 만든다.
 * 컴포넌트는 이 결과를 그리기만 한다. 그래서 "버튼 → 기록 → 목록·환자 화면 재계산"의 연결을 컴포넌트 없이 시험할 수 있다
 * (전에는 이 연결이 컴포넌트의 useMemo 안에 있어, 재계산을 빼먹는 변이 7개가 시험을 모두 통과했다).
 */

import { addDays, checkDay, diffDays, formatShort, isLocalDate, kstDateOf, parseInstant, type LocalDate } from "@/core/calendar";
import { currentPatients, type ContactLog } from "@/core/contact";
import type { Engine } from "@/core/engine";
import { maskPii } from "@/core/mask";
import type { Patient } from "@/core/patient";
import type { PointStatus } from "@/core/status";
import { buildToday, evaluatePatient, NURSE_CAUSE_LABEL, REASON_LABEL, SAME_ANGLE_NOTE, type PatientDay } from "@/core/today";
import {
  afterContact,
  contactEntries,
  dateWithYear,
  messagesFor,
  nurseLines,
  overdueHeader,
  procedureLabel,
  rowBadges,
  timeline,
  todayView,
  type AfterContact,
  type Badge,
  type ContactEntry,
  type MessageView,
  type Timeline,
  type TodayView,
} from "./view";

export function todayFor(base: readonly Patient[], engine: Engine, log: ContactLog, nowMs: number): TodayView {
  return todayView(buildToday(currentPatients(base, log), engine, nowMs));
}

const START_LABEL = { "hair-transplant": "수술일", injection: "첫 주사일", "scalp-care": "첫 방문일" } as const;

/** 예약 잡음에서 고를 수 있는 시점(완료·건너뜀·안내·재시작 대기가 아닌 내원·사진 시점). */
export interface BookableView {
  key: string;
  label: string;
  /** 고를 때 보일 상태 한 마디("예정일 지남", "날짜 미정" 등). */
  state: string;
  /** 예약 날짜의 마지막 허용일(주사 회차: 예정일 + 재시작 기준). 없으면 null. */
  latest: LocalDate | null;
}

const BOOKABLE_STATE: Partial<Record<PointStatus["state"], string>> = {
  missed: "예정일 지남",
  "in-grace": "유예 중",
  unscheduled: "날짜 미정",
  booked: "예약 잡음",
  upcoming: "예정",
  "due-today": "오늘 예정",
};

/**
 * 예약을 적을 수 있는 시점. 순서는 먼저 풀어야 할 것부터(지남 → 날짜 미정 → 유예 → 예약 → 예정)라, 화면은 첫 항목을 기본으로 고른다.
 * 재시작할 회차(14일 넘게 빠짐)와 그 뒤 회차는 뺀다 — 재예약이 아니라 의료진 진료가 먼저다(V08).
 */
export function bookablePoints(day: Pick<PatientDay, "statuses">, today: LocalDate): BookableView[] {
  const rank: PointStatus["state"][] = ["missed", "unscheduled", "in-grace", "booked", "due-today", "upcoming"];
  return day.statuses
    .filter((s) => BOOKABLE_STATE[s.state] !== undefined && !s.restart)
    .sort((a, b) => rank.indexOf(a.state) - rank.indexOf(b.state))
    .map((s) => ({
      key: s.point.key,
      label: s.point.label,
      state: s.state === "booked" ? `예약 잡음 ${formatShort(s.booking!.date)}` : BOOKABLE_STATE[s.state]!,
      latest: s.point.restartAfterDays !== undefined ? addDays(s.point.dueDate ?? s.point.originalDate, s.point.restartAfterDays) : null,
    }))
    .filter((b) => b.latest === null || b.latest >= today);
}

/**
 * 화면에서 넣은 예약 날짜 검사. 코어(patient.checkBooking)는 모양과 '연락한 날 이후'만 보고, 여기서는 사람이 고칠 수 있게 말로 돌려준다:
 * 진료일인지(휴진일 예약은 받지 않음), 90일 안인지, 주사 회차는 재시작 기준(예정일 + 14일) 안인지.
 */
export function checkBookingInput(raw: string, point: BookableView | undefined, engine: Engine, today: LocalDate): { ok: true; date: LocalDate } | { ok: false; error: string } {
  if (!point) return { ok: false, error: "예약할 시점을 고르세요." };
  if (!isLocalDate(raw)) return { ok: false, error: "예약 날짜를 YYYY-MM-DD로 넣어 주세요." };
  const d = raw as LocalDate;
  if (d < today) return { ok: false, error: `오늘(${formatShort(today)})보다 이른 날은 예약할 수 없습니다.` };
  if (diffDays(today, d) > 90) return { ok: false, error: "90일 안의 날짜만 받습니다." };
  const c = checkDay(d, engine.calendar);
  if (!c.open) return { ok: false, error: `${formatShort(d)}은 휴진일입니다(${c.reasons.map((r) => r.label).join("·")}).` };
  if (point.latest && d > point.latest) return { ok: false, error: `${point.label} 예약은 ${formatShort(point.latest)}까지만 받습니다. 그 뒤는 의료진 진료 뒤 재시작입니다(두피 주사 프로그램 문서).` };
  return { ok: true, date: d };
}

export interface PatientView {
  id: string;
  alias: string;
  subtitle: string;
  /** 연락을 더한 **지금** 상태의 배지(목록과 같은 말을 하도록). */
  badges: Badge[];
  overdueLine: string | null;
  /** 기준 시각에 이유가 있었는데 이 브라우저에서 연락을 적어 처리됨. */
  handledToday: boolean;
  symptoms: { text: string; words: string[] }[];
  /** 이번 연락 문구는 **연락을 적기 전**(기준 시각)의 오늘 항목으로 만든다 — 방금 보낸 문구가 사라지면 무엇을 보냈는지 확인할 수 없다. */
  messages: MessageView[];
  /** 문구가 없을 때의 한 줄. */
  noMessage: string;
  after: AfterContact | null;
  localCount: number;
  timeline: Timeline;
  photoNote: string | null;
  /** 기준 시각의 오늘 이유(연락 전). */
  reasonsAtStart: string | null;
  /** 간호팀 확인 줄(지금 상태). 없으면 빈 배열. */
  nurse: { causes: string[]; lines: string[] };
  /** 수신 거부 중이면 그 한 줄. */
  optOutLine: string | null;
  bookable: BookableView[];
  visits: string[];
  contacts: ContactEntry[];
}

export function patientFor(id: string, base: readonly Patient[], engine: Engine, log: ContactLog, nowMs: number, composeMs: number): PatientView | null {
  const basePatient = base.find((p) => p.id === id);
  if (!basePatient) return null;
  const current = currentPatients(base, log).find((p) => p.id === id)!;
  const today: LocalDate = kstDateOf(nowMs);
  const baseDay = evaluatePatient(basePatient, engine, nowMs);
  const day = evaluatePatient(current, engine, nowMs);
  const localCount = log.applied.filter((a) => a.patientId === id).length;
  const order = engine.rules.reasonOrder;
  const reasonsNow = order.filter((r) => day.items.some((i) => i.reason === r));
  const reasonsAtStart = order.filter((r) => baseDay.items.some((i) => i.reason === r));

  const badges: Badge[] = rowBadges({ reasons: reasonsNow, symptoms: day.symptoms, holidayUnknown: day.items.some((i) => i.point.holidayUnknown), items: day.items });
  if (day.optOut) badges.push({ label: "수신 거부", tone: "gray" });
  for (const c of [...new Set(day.nurse.map((n) => n.cause))]) badges.push({ label: `간호팀 확인 · ${NURSE_CAUSE_LABEL[c]}`, tone: c === "no-open-day" ? "orange" : "red" });
  if (!day.optOut && day.overdue?.action === "waiting") badges.push({ label: `재연락 대기 · ${formatShort(day.overdue.nextContactDate)}부터`, tone: "gray" });
  const handledToday = localCount > 0 && reasonsAtStart.length > 0 && reasonsNow.length === 0;
  if (handledToday) badges.push({ label: "오늘 연락 적음", tone: "blue" });

  // 사진 회차 안내: 밀린(미방문·유예 중) 사진 회차가 먼저다 — 다시 오는 날 같은 조건으로 찍어야 할 사진이 그것이다.
  const photo =
    day.statuses.find((s) => (s.state === "missed" || s.state === "in-grace") && s.point.kind === "photo" && s.date) ??
    day.statuses.find((s) => (s.state === "upcoming" || s.state === "due-today" || s.state === "booked") && s.point.kind === "photo" && s.date);
  const sameAngle = SAME_ANGLE_NOTE.replace("경과 사진 회차입니다. ", "");
  const photoNote = !photo
    ? null
    : photo.state === "missed" || photo.state === "in-grace"
      ? `밀린 경과 사진 회차: ${photo.point.label}(${dateWithYear(photo.date!, today)} ${photo.booking ? "예약" : "예정"}이었음). 다시 오시면 ${sameAngle}`
      : `다음 경과 사진 회차는 ${dateWithYear(photo.date!, today)} ${photo.point.label}입니다${photo.state === "booked" ? "(예약)" : ""}. ${sameAngle}`;

  const baseNurse = baseDay.nurse.map((n) => n.cause);
  const noMessage =
    `기준 시각에 오늘 연락할 이유가 없습니다.` +
    (baseDay.optOut ? " 연락 원치 않음(수신 거부)이라 모든 연락 목록에서 빠져 있습니다." : "") +
    // 14일 넘게 빠진 주사 회차는 재예약 문구 대신 이 말을 보인다(V08: 의료진 진료 뒤 재시작).
    (baseNurse.includes("injection-restart") ? " 14일 넘게 빠진 두피 주사 회차가 있어 재예약 문구를 만들지 않습니다: 의료진 진료 뒤 재시작 — 간호팀 확인." : "") +
    (baseNurse.includes("max-attempts") ? " 최대 시도에 이르러 간호팀 확인 목록에 있습니다." : "") +
    (baseNurse.includes("no-open-day") ? " 허용 범위 안에 진료일이 없는 시점이 있어 간호팀 확인 목록에 있습니다(날짜는 간호팀이 의료진과 확인해 정함)." : "") +
    (!baseDay.optOut && baseDay.overdue?.action === "waiting" ? ` 재연락 간격 전이라 ${formatShort(baseDay.overdue.nextContactDate)}부터 다시 목록에 오릅니다.` : "");

  return {
    id,
    alias: basePatient.alias,
    subtitle: `${procedureLabel(basePatient.procedure)} · ${START_LABEL[basePatient.procedure]} ${basePatient.startDate.slice(0, 4)}년 ${formatShort(basePatient.startDate)}`,
    badges,
    overdueLine: overdueHeader(day.overdue),
    handledToday,
    symptoms: day.symptoms.map((s) => ({ text: s.noteMasked, words: [...s.matchedSymptoms, ...s.matchedAmbiguous] })),
    messages: messagesFor(baseDay.items, engine, composeMs),
    noMessage,
    after: localCount > 0 ? afterContact(current, engine, nowMs) : null,
    localCount,
    timeline: timeline(day, engine.rules, today),
    photoNote,
    reasonsAtStart: reasonsAtStart.length > 0 ? reasonsAtStart.map((r) => REASON_LABEL[r]).join(", ") : null,
    nurse: { causes: [...new Set(day.nurse.map((n) => NURSE_CAUSE_LABEL[n.cause]))], lines: nurseLines(day.nurse, day.overdue, today) },
    optOutLine: day.optOut ? `연락 원치 않음 — 모든 연락 목록에서 빠져 있습니다(${formatShort(kstDateOf(parseInstant(day.optOut.at)))}부터).` : null,
    bookable: bookablePoints(day, today),
    visits: [...basePatient.visits].reverse().map((v) => `${v.date.slice(0, 4)}년 ${formatShort(v.date)} · ${day.schedule.find((p) => p.key === v.kind)?.label ?? v.kind}`),
    contacts: [...contactEntries(day, localCount, (s) => maskPii(s).masked)].reverse(),
  };
}
