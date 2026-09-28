/**
 * 화면 한 장이 그릴 것 전부를 (원본 환자 + 이 브라우저의 연락 기록 + 기준 시각)에서 한 번에 만든다.
 * 컴포넌트는 이 결과를 그리기만 한다. 그래서 "버튼 → 기록 → 목록·환자 화면 재계산"의 연결을 컴포넌트 없이 시험할 수 있다
 * (전에는 이 연결이 컴포넌트의 useMemo 안에 있어, 재계산을 빼먹는 변이 7개가 시험을 모두 통과했다).
 */

import { formatShort, kstDateOf, type LocalDate } from "@/core/calendar";
import { currentPatients, type ContactLog } from "@/core/contact";
import type { Engine } from "@/core/engine";
import { maskPii } from "@/core/mask";
import type { Patient } from "@/core/patient";
import { buildToday, evaluatePatient, REASON_LABEL, SAME_ANGLE_NOTE } from "@/core/today";
import {
  afterContact,
  contactEntries,
  dateWithYear,
  messagesFor,
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

  const badges: Badge[] = rowBadges({ reasons: reasonsNow, symptoms: day.symptoms, holidayUnknown: day.items.some((i) => i.point.holidayUnknown) });
  if (day.overdue?.action === "escalate") badges.push({ label: "원장 확인", tone: "gray" });
  if (day.overdue?.action === "waiting") badges.push({ label: `재연락 대기 · ${formatShort(day.overdue.nextContactDate)}부터`, tone: "gray" });
  const handledToday = localCount > 0 && reasonsAtStart.length > 0 && reasonsNow.length === 0;
  if (handledToday) badges.push({ label: "오늘 연락 적음", tone: "blue" });

  // 사진 회차 안내: 밀린(미방문·유예 중) 사진 회차가 먼저다 — 다시 오는 날 같은 조건으로 찍어야 할 사진이 그것이다.
  const photo =
    day.statuses.find((s) => (s.state === "missed" || s.state === "in-grace") && s.point.kind === "photo") ??
    day.statuses.find((s) => (s.state === "upcoming" || s.state === "due-today") && s.point.kind === "photo");
  const photoNote = !photo
    ? null
    : photo.state === "missed" || photo.state === "in-grace"
      ? `밀린 경과 사진 회차: ${photo.point.label}(${dateWithYear(photo.point.dueDate, today)} 예정이었음). 다시 오시면 ${SAME_ANGLE_NOTE.replace("경과 사진 회차입니다. ", "")}`
      : `다음 경과 사진 회차는 ${dateWithYear(photo.point.dueDate, today)} ${photo.point.label}입니다. ${SAME_ANGLE_NOTE.replace("경과 사진 회차입니다. ", "")}`;

  const noMessage =
    `기준 시각에 오늘 연락할 이유가 없습니다.` +
    (day.overdue?.action === "escalate" ? " 최대 시도에 이르러 원장 확인 목록에 있습니다." : "") +
    (day.overdue?.action === "waiting" ? ` 재연락 간격 전이라 ${formatShort(day.overdue.nextContactDate)}부터 다시 목록에 오릅니다.` : "");

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
    visits: [...basePatient.visits].reverse().map((v) => `${v.date.slice(0, 4)}년 ${formatShort(v.date)} · ${day.schedule.find((p) => p.key === v.kind)?.label ?? v.kind}`),
    contacts: [...contactEntries(day, localCount, (s) => maskPii(s).masked)].reverse(),
  };
}
