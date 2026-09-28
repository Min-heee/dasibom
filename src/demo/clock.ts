/**
 * 시연 모드의 시계(PRD F12). 기준 시각은 **이 파일의 DEMO_NOW 하나**다.
 *
 * 왜 고정하나: 합성 환자 기록은 2026-09-21(월) 아침을 "오늘"로 두고 만들었다. 실제 시계로 목록을 만들면
 * 방문하는 날마다 모든 환자가 예정일 지남이 되고, 정적으로 미리 그린 화면과 브라우저 화면이 서로 달라진다.
 * 한창구(같은 날 10:00)보다 한 시간 이른 09:00 — 코디네이터가 하루를 시작하며 목록을 여는 시각이다.
 *
 * 날짜·시각 글자는 Intl·toLocaleString 없이 core/calendar의 KST 산술로 만든다(서버·브라우저 시간대가 달라도 같은 글자).
 */

import { formatShort, kstDateOf, kstMinuteOfDay, parseInstant, type LocalDate } from "@/core/calendar";

export const DEMO_NOW = "2026-09-21T09:00:00+09:00";
export const DEMO_NOW_MS = parseInstant(DEMO_NOW);
export const DEMO_TODAY: LocalDate = kstDateOf(DEMO_NOW_MS);

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "09:00" */
export function formatKstTime(ms: number): string {
  const m = kstMinuteOfDay(ms);
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** "9/21(월) 09:00" */
export function formatKstDateTime(ms: number): string {
  return `${formatShort(kstDateOf(ms))} ${formatKstTime(ms)}`;
}
