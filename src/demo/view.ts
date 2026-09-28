/**
 * 화면에 보일 글자와 묶음을 만드는 순수 함수. 판단(누가 오늘 목록에 오르나, 다음 연락일은 언제인가)은 모두 src/core가 하고,
 * 여기서는 그 결과를 **어떤 말로 보일지**만 정한다. 화면 컴포넌트는 이 결과를 그리기만 한다 — 그래서 화면 판단을 시험할 수 있다.
 *
 * 색은 언제나 글자 라벨과 함께 쓴다(색만으로 구분하지 않음). tone은 배지·띠의 색 이름일 뿐이다.
 */

import { addDays, addMonths, checkDay, diffDays, formatShort, isLocalDate, parseInstant, type LocalDate } from "@/core/calendar";
import { nextContactAfter, nextListedDay } from "@/core/contact";
import type { Engine } from "@/core/engine";
import { composeMessage, templateKeyFor, valuesForItem, type Message, type SendTiming } from "@/core/message";
import { CONTACT_RESULT_LABEL, PROCEDURE_LABEL, PROCEDURES, type Contact, type Patient, type Procedure } from "@/core/patient";
import { templateSlots, type Rules, type TemplateSlot } from "@/core/rules";
import { buildSchedule, describeShift, type SchedulePoint } from "@/core/schedule";
import { contactDate, type OverdueState, type PointStatus } from "@/core/status";
import { REASON_LABEL, SAME_ANGLE_NOTE, type PatientDay, type Reason, type RowItem, type TodayList, type TodayRow } from "@/core/today";
import { formatKstDateTime } from "./clock";

export type Tone = "red" | "orange" | "green" | "blue" | "gray";

/** 이유별 색. 맨 위 '예정일 지남'은 빨강(PRD 3절 시연 0~6초). */
export const REASON_TONE: Record<Reason, Tone> = {
  overdue: "red",
  "upcoming-visit": "blue",
  "care-notice": "green",
  "injection-rebook": "orange",
  "photo-round": "gray",
};

export interface Badge {
  label: string;
  tone: Tone;
}

const fs = formatShort;

/** 모든 화면 위 띠(PRD F12). 기준 시각은 clock.ts의 값 하나에서 만든다. */
export function bandText(nowMs: number): string {
  return `가상 의원 · 합성 데이터 · 기준 시각 ${formatKstDateTime(nowMs)}`;
}

/** 기준일과 해가 다르면 해를 붙인다("2027년 3/9(화)"). 1년 타임라인은 해를 넘기므로 월/일만으로는 헷갈린다. */
export function dateWithYear(d: LocalDate, today: LocalDate): string {
  return d.slice(0, 4) === today.slice(0, 4) ? fs(d) : `${d.slice(0, 4)}년 ${fs(d)}`;
}

export function procedureLabel(p: Procedure): string {
  return PROCEDURE_LABEL[p];
}

/** 시점이 휴진으로 밀렸으면 "원래 9/20(일) → 휴진으로 미룸". 안 밀렸으면 null. */
export function shiftNote(p: SchedulePoint): string | null {
  if (p.skipped.length === 0) return null;
  return `원래 ${fs(p.originalDate)}에서 미룸 — ${describeShift(p)}`;
}

/** 목록 한 줄 안의 항목 하나를 한 문장으로. */
export function itemLine(item: RowItem): string {
  const p = item.point;
  const shifted = p.skipped.length > 0 ? ` (원래 ${fs(p.originalDate)}, 휴진으로 미룸)` : "";
  switch (item.reason) {
    case "overdue":
      return `${p.label} · 예정일 ${fs(p.dueDate)}${shifted} · ${item.daysPastDue}일 지남`;
    case "upcoming-visit":
      return `${p.label} · ${fs(p.dueDate)} 내원 예정${shifted}`;
    case "care-notice":
      return `${p.label} · ${fs(p.dueDate)} 안내${shifted}`;
    case "injection-rebook":
      return `${p.label} · ${fs(p.dueDate)} 예정이었음 · ${fs(addDays(p.dueDate, p.graceDays))}까지 날짜 옮기기${shifted}`;
    case "photo-round":
      return `${p.label} · 같은각도로 경과 사진`;
  }
}

/** "연락 2회 · 마지막 9/18(금) 부재". 미방문 연락 상태가 없으면 null(내일 내원·안내는 시도를 세지 않는다). */
export function attemptsText(o: OverdueState | null): string | null {
  if (!o) return null;
  if (!o.lastContact) return "연락 0회 · 첫 연락";
  return `연락 ${o.attempts}회 · 마지막 ${fs(contactDate(o.lastContact))} ${CONTACT_RESULT_LABEL[o.lastContact.result]}`;
}

/** 환자 머리의 미방문 한 줄: "9/18(금)부터 예정일 지남 · 그 뒤 연락 0회". */
export function overdueHeader(o: OverdueState | null): string | null {
  if (!o) return null;
  const last = o.lastContact ? ` · 마지막 ${fs(contactDate(o.lastContact))} ${CONTACT_RESULT_LABEL[o.lastContact.result]}` : " · 첫 연락 차례";
  return `${fs(o.since)}부터 예정일 지남 · 그 뒤 연락 ${o.attempts}회${last}`;
}

export interface RowView {
  patientId: string;
  alias: string;
  procedure: string;
  primary: Reason;
  badges: Badge[];
  lines: string[];
  attempts: string | null;
  href: string;
}

/** 다른 묶음의 줄에 함께 들어간 환자(한 환자 한 줄 원칙 때문에 이 묶음에는 줄이 없다). */
export interface AlsoIn {
  patientId: string;
  alias: string;
  /** 그 환자의 줄이 놓인 묶음 이름. */
  inLabel: string;
  href: string;
}

export interface TodayGroupView {
  reason: Reason;
  label: string;
  tone: Tone;
  /** 이 이유가 있는 환자 수(다른 묶음 줄에 합쳐진 사람 포함). 칩과 묶음 머리의 숫자. */
  count: number;
  /** 이 묶음에 놓인 줄(이 이유가 가장 앞선 환자). */
  rows: RowView[];
  alsoIn: AlsoIn[];
}

export interface TodayView {
  dateLabel: string;
  total: number;
  groups: TodayGroupView[];
  escalations: { patientId: string; alias: string; procedure: string; lines: string[]; attempts: string; since: string; href: string; symptom: boolean }[];
  clinician: { patientId: string; alias: string; procedure: string; notes: { at: string; text: string; words: string[] }[]; href: string; inList: boolean }[];
  waiting: { patientId: string; alias: string; procedure: string; next: string; attempts: string; href: string }[];
}

export const patientHref = (id: string) => `/patient/${id}/`;

export function rowBadges(row: Pick<TodayRow, "reasons" | "symptoms" | "holidayUnknown">): Badge[] {
  const out: Badge[] = row.reasons.map((r) => ({ label: REASON_LABEL[r], tone: REASON_TONE[r] }));
  if (row.symptoms.length > 0) out.push({ label: "의료진 확인", tone: "red" });
  if (row.holidayUnknown) out.push({ label: "공휴일 미확인", tone: "gray" });
  return out;
}

/**
 * 첫 화면. 한 환자는 가장 앞선 이유의 묶음에 한 줄로 놓이지만(연락 피로), 개수는 **그 이유가 있는 환자 수**로 센다.
 * 줄 수로 세면 '사진 회차'처럼 늘 다른 이유(내일 내원)와 함께 걸리는 묶음이 구조상 늘 0명으로 보인다.
 */
export function todayView(list: TodayList): TodayView {
  const allRows = list.groups.flatMap((g) => g.rows);
  const listed = new Set(allRows.map((r) => r.patientId));
  return {
    dateLabel: fs(list.today),
    total: listed.size,
    groups: list.groups.map((g) => ({
      reason: g.reason,
      label: g.label,
      tone: REASON_TONE[g.reason],
      count: allRows.filter((r) => r.reasons.includes(g.reason)).length,
      alsoIn: allRows
        .filter((r) => r.reasons.includes(g.reason) && r.primary !== g.reason)
        .map((r) => ({ patientId: r.patientId, alias: r.alias, inLabel: REASON_LABEL[r.primary], href: patientHref(r.patientId) })),
      rows: g.rows.map((r) => ({
        patientId: r.patientId,
        alias: r.alias,
        procedure: procedureLabel(r.procedure),
        primary: r.primary,
        badges: rowBadges(r),
        lines: r.items.map(itemLine),
        attempts: attemptsText(r.overdue),
        href: patientHref(r.patientId),
      })),
    })),
    escalations: list.escalations.map((e) => ({
      patientId: e.patientId,
      alias: e.alias,
      procedure: procedureLabel(e.procedure),
      lines: e.overdue.missed.map((s) => itemLine({ reason: "overdue", point: s.point, daysPastDue: s.daysPastDue })),
      attempts: attemptsText(e.overdue)!,
      since: `${fs(e.overdue.since)}부터 예정일 지남`,
      href: patientHref(e.patientId),
      symptom: e.symptoms.length > 0,
    })),
    clinician: list.clinicianReview.map((c) => ({
      patientId: c.patientId,
      alias: c.alias,
      procedure: procedureLabel(c.procedure),
      notes: c.symptoms.map((s) => ({ at: formatKstDateTime(parseInstant(s.at)), text: s.noteMasked, words: [...s.matchedSymptoms, ...s.matchedAmbiguous] })),
      href: patientHref(c.patientId),
      inList: listed.has(c.patientId),
    })),
    waiting: list.waiting.map((w) => ({
      patientId: w.patientId,
      alias: w.alias,
      procedure: procedureLabel(w.procedure),
      next:
        w.overdue.nextContactDate === w.overdue.retryOn
          ? `${fs(w.overdue.nextContactDate)}부터 다시 연락`
          : `${fs(w.overdue.nextContactDate)}부터 다시 연락(${fs(w.overdue.retryOn)}은 휴진)`,
      attempts: attemptsText(w.overdue)!,
      href: patientHref(w.patientId),
    })),
  };
}

// ── 환자 상세 ─────────────────────────────────────────────

export type NoticeState = "notice-upcoming" | "notice-active" | "notice-sent" | "notice-missed";

/**
 * 안내 시점을 네 갈래로 나눈다. D01은 "오늘 안내할지"만 정하고, 지난 안내를 '보냄'과 '놓침'으로 가르는 규칙은 없다.
 * 이 구분은 타임라인 표시와 기대값 표 대조에만 쓴다: 미룬 날짜 이후 첫 연락이 유예 안(graceEnd까지)에 있으면 보냄.
 * 오늘 목록 판정(today.ts)에는 쓰지 않는다.
 */
export function noticeState(s: Pick<PointStatus, "point" | "graceEnd">, contacts: Contact[], today: LocalDate): NoticeState {
  const due = s.point.dueDate;
  const after = contacts.map(contactDate).filter((d) => d >= due);
  if (due > today) return "notice-upcoming";
  if (today <= s.graceEnd && after.length === 0) return "notice-active";
  if (after.length > 0 && after[0] <= s.graceEnd) return "notice-sent";
  return "notice-missed";
}

/** 개월로 정한 시점이 월말 규칙(clamp)으로 잘렸는지: 시작일의 '일'이 그 달에 없어 말일로 당겨졌다. */
export function isMonthEndClamped(p: SchedulePoint, startDate: LocalDate, rules: Rules): boolean {
  const r = rules.procedures[p.procedure];
  if (r.type !== "fixed") return false;
  const rule = r.points.find((x) => x.key === p.key);
  return rule?.offset.unit === "months" && p.originalDate.slice(8) !== startDate.slice(8);
}

export const KIND_LABEL = { visit: "내원", photo: "내원·사진", notice: "안내" } as const;

export interface TimelineEntry {
  key: string;
  label: string;
  kindLabel: string;
  stateLabel: string;
  tone: Tone;
  dueDate: LocalDate;
  dateText: string;
  shift: string | null;
  monthEnd: boolean;
  holidayUnknown: boolean;
  sameAngle: boolean;
  /** 1년 띠 위의 위치(0~100). */
  pct: number;
}

export interface Timeline {
  start: LocalDate;
  end: LocalDate;
  todayPct: number;
  entries: TimelineEntry[];
  /** '공휴일 미확인' 표시가 하나라도 있으면 그 뜻을 한 번 적는 각주. */
  holidayFootnote: string | null;
}

function stateOf(s: PointStatus, contacts: Contact[], today: LocalDate): { label: string; tone: Tone } {
  switch (s.state) {
    case "done":
      return s.early ? { label: `완료 · ${fs(s.visit!.date)} 조금 일찍 옴`, tone: "green" } : { label: `완료 · ${fs(s.visit!.date)} 방문`, tone: "green" };
    case "missed":
      return { label: `미방문 · 예정일 ${s.daysPastDue}일 지남`, tone: "red" };
    case "skipped":
      return { label: "건너뜀 · 뒤 시점에 왔음", tone: "gray" };
    case "in-grace":
      return { label: `유예 중 · ${fs(s.graceEnd)}까지`, tone: "orange" };
    case "due-today":
      return { label: "오늘 예정", tone: "blue" };
    case "upcoming":
      return { label: "예정", tone: "gray" };
    case "notice": {
      const n = noticeState(s, contacts, today);
      if (n === "notice-upcoming") return { label: "안내 예정", tone: "gray" };
      if (n === "notice-active") return { label: "오늘 안내할 차례", tone: "green" };
      if (n === "notice-sent") return { label: "안내함", tone: "green" };
      return { label: "지난 안내 · 연락 기록 없음", tone: "gray" };
    }
  }
}

export function timeline(day: PatientDay, rules: Rules, today: LocalDate): Timeline {
  const start = day.patient.startDate;
  const last = day.schedule.length > 0 ? day.schedule[day.schedule.length - 1].dueDate : start;
  const yearEnd = addMonths(start, 12);
  const end = last > yearEnd ? last : yearEnd;
  const span = Math.max(1, diffDays(start, end));
  const pct = (d: LocalDate) => Math.min(100, Math.max(0, (diffDays(start, d) / span) * 100));
  const contacts = day.patient.contacts;
  // 이미 끝난 시점(완료·건너뜀·지난 안내)에는 붙이지 않는다: 그 날짜가 공휴일이었어도 이제 바뀌는 것이 없다.
  const openPoint = (s: PointStatus) => !(s.state === "done" || s.state === "skipped" || (s.state === "notice" && s.point.dueDate < today));
  const entries: TimelineEntry[] = day.statuses.map((s) => {
    const st = stateOf(s, contacts, today);
    return {
      key: s.point.key,
      label: s.point.label,
      kindLabel: KIND_LABEL[s.point.kind],
      stateLabel: st.label,
      tone: st.tone,
      dueDate: s.point.dueDate,
      dateText: dateWithYear(s.point.dueDate, today),
      shift: shiftNote(s.point),
      monthEnd: isMonthEndClamped(s.point, start, rules),
      holidayUnknown: s.point.holidayUnknown && openPoint(s),
      sameAngle: s.point.kind === "photo",
      pct: pct(s.point.dueDate),
    };
  });
  const c = rules.holidaysCoverage;
  return {
    start,
    end,
    todayPct: pct(today),
    entries,
    holidayFootnote: entries.some((e) => e.holidayUnknown)
      ? `'공휴일 미확인': 공휴일 목록은 ${dateWithYear(c.from, today)}~${dateWithYear(c.to, today)}만 확인했습니다. 그 밖의 날짜는 일요일·추가 휴진만 반영했습니다.`
      : null,
  };
}

export interface ContactEntry {
  at: string;
  result: string;
  note: string | null;
  /** 지금 미방문 연락 시도로 센 연락. */
  counted: boolean;
  /** 이 브라우저에서 적은 연락(시연). */
  local: boolean;
  symptom: boolean;
}

/** 연락 기록. 메모는 개인정보를 가린 글만 보인다(core/mask — 증상 메모는 status.symptomNotes가 이미 가림). */
export function contactEntries(day: PatientDay, localCount: number, mask: (s: string) => string): ContactEntry[] {
  const cs = day.patient.contacts;
  const counted = new Set(day.overdue?.counted ?? []);
  const symptomAt = new Set(day.symptoms.map((s) => s.at));
  return cs.map((c, i) => ({
    at: formatKstDateTime(parseInstant(c.at)),
    result: CONTACT_RESULT_LABEL[c.result],
    note: c.note ? mask(c.note) : null,
    counted: counted.has(c),
    local: i >= cs.length - localCount,
    symptom: symptomAt.has(c.at),
  }));
}

// ── 연락 문구 ─────────────────────────────────────────────

const SLOT_LABEL: Record<TemplateSlot, string> = { date: "날짜", time: "진료시간", clinicPhone: "병원 전화" };

/** 승인 문구의 이름(화면용). 코드 키(D01 templates의 키)를 그대로 보이지 않는다. */
export const TEMPLATE_LABEL: Record<string, string> = {
  overdue: "미방문 안내 문구",
  "upcoming-visit": "내원 전날 안내 문구",
  "photo-round": "사진 회차 내원 안내 문구",
  "injection-rebook": "주사 날짜 다시 잡기 문구",
  "care-notice-d3": "머리 감기 시작 안내 문구",
  "care-notice-d14": "2주 무렵 안내 문구",
  "care-notice-scalp-care": "두피 관리 다음 회차 안내 문구",
};

export const templateLabel = (key: string) => TEMPLATE_LABEL[key] ?? (key.startsWith("care-notice-") ? "관리 안내 문구" : "승인 문구");

export interface MessageView {
  reason: Reason;
  reasonLabel: string;
  tone: Tone;
  pointLabel: string;
  templateKey: string;
  templateLabel: string;
  message: Message;
  slots: { name: string; value: string }[];
  timing: string | null;
  /** 보내기 배지 하나. 광고 금지 표현이 있으면 시간대와 상관없이 '보내기 막힘'만 보인다(지금 보내기와 함께 뜨지 않게). */
  send: Badge | null;
  /** 광고 표현 검사 결과 배지(의료광고 표현 가이드). */
  ad: Badge | null;
  sameAngle: string | null;
}

export function sendBadge(m: Message): Badge | null {
  if (!m.ok) return null;
  if (!m.sendable) return { label: "보내기 막힘 · 광고 금지 표현", tone: "red" };
  return { label: timingText(m.timing), tone: m.timing.mode === "now" ? "green" : "orange" };
}

export function adBadge(m: Message): Badge | null {
  if (!m.ok) return null;
  if (m.ad.level === "banned") return { label: "광고 금지 표현 있음", tone: "red" };
  if (m.ad.level === "warn") return { label: "광고 주의 표현 있음", tone: "orange" };
  return { label: "광고 표현 기준 통과", tone: "gray" };
}

export function timingText(t: SendTiming): string {
  if (t.mode === "now") return "지금 보내기 · 연락 가능 시간대 안";
  return `시간 맞춰 보내기 · ${formatKstDateTime(parseInstant(t.scheduledSendAt))}에 (${t.reason})`;
}

/**
 * 오늘 항목마다 승인 문구에 칸을 채운다. 미방문 문구는 시점이 여럿이어도 **가장 이른 시점 하나**만 만든다
 * (같은 환자에게 거의 같은 미방문 문자가 두 통 가지 않게, PRD 8절 연락 피로). 그 밖에는 같은 문구·같은 날짜를 한 번만.
 * 사진 회차 문구는 내원 안내 문구를 포함하므로(날짜·진료시간·전화), 같은 시점의 '내일 내원' 문구는 따로 만들지 않는다 —
 * 환자에게 같은 날 두 통이 가지 않게.
 */
export function messagesFor(items: RowItem[], engine: Engine, composeAtMs: number): MessageView[] {
  const seen = new Set<string>();
  const out: MessageView[] = [];
  const photoKeys = new Set(items.filter((i) => i.reason === "photo-round").map((i) => i.point.key));
  let overdueDone = false;
  for (const item of items) {
    if (item.reason === "upcoming-visit" && photoKeys.has(item.point.key)) continue;
    // items는 이유 순, 같은 이유 안에서는 날짜순(today.evaluatePatient)이라 첫 미방문이 가장 이른 시점이다.
    if (item.reason === "overdue") {
      if (overdueDone) continue;
      overdueDone = true;
    }
    const templateKey = templateKeyFor(item);
    const values = valuesForItem(item, engine.rules, engine.calendar);
    const dedupe = `${templateKey}|${values.date}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const message = composeMessage({ templateKey, values, rules: engine.rules, ad: engine.ad, nowMs: composeAtMs });
    const template = engine.rules.templates[templateKey] ?? "";
    const used = [...new Set(templateSlots(template))] as TemplateSlot[];
    out.push({
      reason: item.reason,
      reasonLabel: REASON_LABEL[item.reason],
      tone: REASON_TONE[item.reason],
      pointLabel: item.point.label,
      templateKey,
      templateLabel: templateLabel(templateKey),
      message,
      slots: used.map((s) => ({ name: SLOT_LABEL[s] ?? s, value: values[s] ?? "(없음)" })),
      timing: message.ok ? timingText(message.timing) : null,
      send: sendBadge(message),
      ad: adBadge(message),
      sameAngle: item.reason === "photo-round" ? SAME_ANGLE_NOTE : null,
    });
  }
  return out;
}

// ── 연락 결과를 적은 뒤 ───────────────────────────────────────

export interface AfterContact {
  tone: Tone;
  lines: string[];
}

/**
 * 연락을 적은 뒤의 환자(연락이 더해진 상태)로 다음 연락을 말한다. 계산은 core/contact 둘(nextContactAfter·nextListedDay)만 쓴다.
 * 미방문 환자면 "다음 연락일"(재연락 간격, 휴진이면 미룸), 아니면 "다음에 목록에 오르는 날"(오지 않는다고 가정).
 */
export function afterContact(patient: Patient, engine: Engine, nowMs: number): AfterContact {
  const n = nextContactAfter(patient, engine, nowMs);
  const o = n.overdue;
  if (o?.action === "escalate") {
    return { tone: "red", lines: [`미방문 연락 ${o.attempts}회 → 원장 확인으로 넘어갑니다(최대 ${engine.rules.maxAttempts}회).`, "코디네이터 목록에는 다시 오르지 않습니다."] };
  }
  const nl = nextListedDay(patient, engine, nowMs);
  const nextListed = nl ? `다음에 목록에 오르는 날: ${fs(nl.date)} · ${nl.reasons.map((r) => REASON_LABEL[r]).join(", ")}` : "앞으로 90일 안에 목록에 다시 오르지 않습니다.";
  if (o && n.nextContactDate) {
    const lastDay = o.lastContact ? contactDate(o.lastContact) : null;
    const why = lastDay ? `마지막 연락 ${fs(lastDay)} + ${engine.rules.retryIntervalDays}일 = ${fs(o.retryOn)}` : `지남이 된 날 ${fs(o.since)}`;
    const shifted = n.nextContactDate !== o.retryOn ? ` → 휴진이라 ${fs(n.nextContactDate)}에 다시 연락` : "";
    return { tone: "orange", lines: [`미방문 연락 ${o.attempts}회. 다음 연락 ${fs(n.nextContactDate)}`, `${why}${shifted}`] };
  }
  const overdueLater = nl?.reasons.includes("overdue") ? " (그때까지 오지 않으면)" : "";
  return { tone: "green", lines: ["오늘 연락할 이유가 처리됐습니다.", `${nextListed}${overdueLater}`] };
}

// ── 직접 해 보기 ─────────────────────────────────────────────

export interface TryRow {
  key: string;
  label: string;
  kindLabel: string;
  original: string;
  due: string;
  shifted: boolean;
  shift: string | null;
  monthEnd: boolean;
  holidayUnknown: boolean;
  sameAngle: boolean;
}

export type TryResult = { ok: true; rows: TryRow[]; notes: string[]; points: SchedulePoint[] } | { ok: false; error: string };

/** 수술일·시술 → 1년 일정. 방문 기록 없이 규칙만으로 계산한다(core/schedule.buildSchedule 그대로). */
export function tryIt(startDate: string, procedure: string, engine: Engine, today: LocalDate): TryResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return { ok: false, error: "날짜를 YYYY-MM-DD로 넣어 주세요." };
  if (!(PROCEDURES as readonly string[]).includes(procedure)) return { ok: false, error: `모르는 시술입니다: ${procedure}` };
  const proc = procedure as Procedure;
  let points: SchedulePoint[];
  try {
    // 달력에 없는 날(2월 30일)을 3월로 넘겨 계산하지 않는다. 먼저 확인해 알아듣게 말한다.
    if (!isLocalDate(startDate)) return { ok: false, error: `달력에 없는 날짜입니다: ${startDate}` };
    points = buildSchedule({ procedure: proc, startDate, visits: [] }, today, engine.rules, engine.calendar);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const start = startDate as LocalDate;
  const notes: string[] = [];
  const startDay = checkDay(start, engine.calendar);
  if (!startDay.open) notes.push(`시작일 ${fs(start)}은 휴진일입니다(${startDay.reasons.map((r) => r.label).join("·")}). 계산은 그대로 합니다.`);
  if (points.some((p) => p.holidayUnknown)) {
    const c = engine.calendar.holidayCoverage;
    notes.push(`공휴일은 ${c.from}~${c.to}만 확인했습니다. 그 밖의 날짜는 일요일·추가 휴진만 반영하고 '공휴일 미확인'으로 표시합니다.`);
  }
  if (proc === "scalp-care") notes.push("두피 관리는 마지막 방문에서 28일 뒤 안내 하나만 계산합니다. 방문할 때마다 다음 안내가 새로 잡힙니다.");
  return {
    ok: true,
    points,
    notes,
    rows: points.map((p) => ({
      key: p.key,
      label: p.label,
      kindLabel: KIND_LABEL[p.kind],
      // 1년 경과 진료는 해를 넘기므로 시작일과 해가 다르면 해를 붙인다.
      original: dateWithYear(p.originalDate, start),
      due: dateWithYear(p.dueDate, start),
      shifted: p.skipped.length > 0,
      shift: describeShift(p),
      monthEnd: isMonthEndClamped(p, start, engine.rules),
      holidayUnknown: p.holidayUnknown,
      sameAngle: p.kind === "photo",
    })),
  };
}
