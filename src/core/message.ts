/**
 * 연락 문구(PRD F7). 볼트 D01의 승인 문구에 칸(날짜·시각·병원 전화)만 채운다.
 *
 * - 없는 칸은 오류다. 빈칸이나 "{{time}}"이 그대로 남은 문자가 환자에게 가는 것보다 만들지 않는 편이 낫다.
 * - 칸을 채운 **뒤의** 전체 문구를 광고 표현 검사(한창구와 같은 V15 규칙)에 넣는다. 칸 값에 섞여 들어온 표현도 잡으려고.
 *   금지 표현이 걸리면 보내기를 막고(sendable=false), 주의 표현은 표시만 한다.
 * - 연락 가능 시간대(D01 contactWindow, [시작, 끝) — 끝 시각 정각은 밖) 밖이면 "시간 맞춰 보내기"로 표시하고 보낼 시각을 붙인다.
 *   시작 전이면 그날 시작 시각, 끝 이후면 다음 날 시작 시각. 휴진일인지는 보지 않는다:
 *   시간대는 환자가 받는 시각의 약속이고, 예약 발송은 직원이 없어도 나간다.
 * 실제 발송은 하지 않는다(PRD 5절). 문구와 보낼 시각까지만 만든다.
 */

import { checkAdExpressions, type AdCheckResult, type AdConfig } from "./adcheck";
import { addDays, dayOfWeek, DOW_KEYS, formatKstIso, formatShort, kstDateOf, kstInstant, kstMinuteOfDay, parseHhmm, type ClinicCalendar } from "./calendar";
import { careNoticeTemplateKey, templateSlots, TEMPLATE_SLOTS, type Rules, type TemplateSlot } from "./rules";
import type { RowItem } from "./today";

export type SlotValues = Partial<Record<TemplateSlot, string>>;

export type FillResult = { ok: true; text: string } | { ok: false; errors: string[] };

export function fillTemplate(template: string, values: SlotValues): FillResult {
  const errors: string[] = [];
  for (const slot of templateSlots(template)) {
    if (!(TEMPLATE_SLOTS as readonly string[]).includes(slot)) errors.push(`모르는 칸입니다: {{${slot}}}`);
    else {
      const v = values[slot as TemplateSlot];
      if (v === undefined || v.trim() === "") errors.push(`칸 값이 없습니다: {{${slot}}}`);
    }
  }
  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };
  return { ok: true, text: template.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (_, slot: string) => values[slot as TemplateSlot]!) };
}

export type SendTiming = { mode: "now" } | { mode: "scheduled"; scheduledSendAt: string; reason: string };

export function sendTiming(nowMs: number, window: Rules["contactWindow"]): SendTiming {
  const start = parseHhmm(window.start)!;
  const end = parseHhmm(window.end)!;
  const m = kstMinuteOfDay(nowMs);
  if (m >= start && m < end) return { mode: "now" };
  const today = kstDateOf(nowMs);
  const day = m < start ? today : addDays(today, 1);
  return {
    mode: "scheduled",
    scheduledSendAt: formatKstIso(kstInstant(day, window.start)),
    reason: `연락 가능 시간대(${window.start}~${window.end}) 밖`,
  };
}

/** 줄 항목이 쓰는 문구 key. 관리 안내는 시점마다 문구가 달라 `care-notice-<시점 key>`, 나머지는 이유 이름(D01 templates). */
export function templateKeyFor(item: Pick<RowItem, "reason" | "point">): string {
  return item.reason === "care-notice" ? careNoticeTemplateKey(item.point.key) : item.reason;
}

export type Message =
  | { ok: true; templateKey: string; text: string; ad: AdCheckResult; sendable: boolean; timing: SendTiming }
  | { ok: false; templateKey: string; errors: string[] };

export function composeMessage(args: { templateKey: string; values: SlotValues; rules: Rules; ad: AdConfig; nowMs: number }): Message {
  const { templateKey } = args;
  const template = args.rules.templates[templateKey];
  if (template === undefined) return { ok: false, templateKey, errors: [`승인 문구가 없습니다: ${templateKey}`] };
  const filled = fillTemplate(template, args.values);
  if (!filled.ok) return { ok: false, templateKey, errors: filled.errors };
  const ad = checkAdExpressions(filled.text, args.ad);
  return { ok: true, templateKey, text: filled.text, ad, sendable: ad.level !== "banned", timing: sendTiming(args.nowMs, args.rules.contactWindow) };
}

/**
 * 줄 항목의 칸 값(D01 '연락 문구'): 날짜 = 그 시점의 밀린 날짜, 시각 = 그날 진료시간(V02 요일별 시작~종료), 병원 전화 = D01 clinicPhone.
 * 그날이 요일 휴진이면 시각 칸을 비워 두어, 시각 칸을 쓰는 문구는 fillTemplate이 오류로 멈추게 한다.
 */
export function valuesForItem(item: Pick<RowItem, "point">, rules: Rules, cal: ClinicCalendar): SlotValues {
  const due = item.point.dueDate;
  const hours = cal.weekly[DOW_KEYS[dayOfWeek(due)]];
  return { date: formatShort(due), clinicPhone: rules.clinicPhone, ...(hours ? { time: `${hours.open}~${hours.close}` } : {}) };
}
