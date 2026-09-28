/**
 * 한국 시간(KST) 날짜 산술과 진료일 판정(PRD F3).
 *
 * 왜 시각 없는 날짜 타입(LocalDate)을 따로 두나: 관리 일정은 "며칠"의 문제이지 "몇 시"의 문제가 아니다.
 * Date 객체로 날짜를 더하면 실행 환경의 시간대가 끼어들어, 서버(UTC)와 브라우저(KST)에서 하루씩 어긋난다.
 * 여기서는 날짜를 "YYYY-MM-DD" 문자열로만 다루고, 계산은 UTC 자정 기준 일수로 바꿔서 한다(시간대가 끼어들 틈이 없다).
 *
 * 이 파일은 시계를 읽지 않는다. 기준 시각(ms)은 언제나 호출하는 쪽이 넘긴다.
 */

declare const LOCAL_DATE: unique symbol;
/** 시각 없는 달력 날짜 "YYYY-MM-DD"(한국 달력 기준). 검증을 거친 값만 이 타입이 된다. */
export type LocalDate = string & { readonly [LOCAL_DATE]: true };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DowKey = (typeof DOW_KEYS)[number];
export const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

export function isLocalDate(s: unknown): s is LocalDate {
  if (typeof s !== "string") return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

/** 문자열을 LocalDate로. 달력에 없는 날(2026-02-30)은 던진다 — 조용히 3월 2일로 넘기지 않는다. */
export function localDate(s: string): LocalDate {
  if (!isLocalDate(s)) throw new Error(`날짜 형식이 틀렸습니다: ${s}`);
  return s;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function parts(d: LocalDate): [number, number, number] {
  return [Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10))];
}

function fromParts(y: number, m: number, d: number): LocalDate {
  return `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}` as LocalDate;
}

/** 1970-01-01부터의 일수. 날짜 차이·요일 계산의 기준. */
function toDayNumber(d: LocalDate): number {
  const [y, m, day] = parts(d);
  return Date.UTC(y, m - 1, day) / MS_PER_DAY;
}

function fromDayNumber(n: number): LocalDate {
  const dt = new Date(n * MS_PER_DAY);
  return fromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(d: LocalDate, n: number): LocalDate {
  if (!Number.isInteger(n)) throw new Error(`일수는 정수여야 합니다: ${n}`);
  return fromDayNumber(toDayNumber(d) + n);
}

/** b - a (일). a가 b보다 늦으면 음수. */
export function diffDays(a: LocalDate, b: LocalDate): number {
  return toDayNumber(b) - toDayNumber(a);
}

/** 0=일 … 6=토 */
export function dayOfWeek(d: LocalDate): number {
  // 1970-01-01은 목요일(4).
  return (((toDayNumber(d) + 4) % 7) + 7) % 7;
}

export type MonthEndRule = "clamp";

/**
 * n개월 뒤. 월말 규칙(PRD F3)은 "clamp" 하나다: 같은 날짜가 그 달에 없으면 그 달의 마지막 날로 당긴다.
 *   1/31 + 1개월 = 2/28(윤년 2/29), 3/31 + 6개월 = 9/30, 8/31 + 6개월 = 다음 해 2/28.
 * 다음 달 1일로 넘기는 방식(JS Date의 setMonth가 하는 일, 1/31 + 1개월 = 3/3)은 쓰지 않는다:
 * "6개월 경과 진료"가 7개월 쪽으로 밀리면 환자에게 설명할 수 없는 날짜가 나온다.
 *
 * 여러 시점은 언제나 **시작일에서** 센다(6개월 = 시작일 + 6개월). 앞 시점에서 이어 세면 clamp가 누적된다
 * (1/31 → 2/28 → 3/28처럼 월말이 점점 당겨진다).
 */
export function addMonths(d: LocalDate, n: number, rule: MonthEndRule = "clamp"): LocalDate {
  if (!Number.isInteger(n)) throw new Error(`개월 수는 정수여야 합니다: ${n}`);
  if (rule !== "clamp") throw new Error(`모르는 월말 규칙입니다: ${String(rule)}`);
  const [y, m, day] = parts(d);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fromParts(ny, nm, Math.min(day, daysInMonth(ny, nm)));
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return a >= b ? a : b;
}

/** "9/24(목)" — 목록과 문구의 날짜 칸에 쓴다. */
export function formatShort(d: LocalDate): string {
  const [, m, day] = parts(d);
  return `${m}/${day}(${DOW_KO[dayOfWeek(d)]})`;
}

// ── 시각(instant) ──────────────────────────────────────────────

/**
 * 시간대가 적힌 ISO 시각만 받는다("2026-09-21T09:00:00+09:00" 또는 "...Z").
 * 시간대가 없는 "2026-09-21T09:00"은 Date.parse가 실행 환경의 시간대로 읽으므로 거부한다.
 */
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function parseInstant(s: string): number {
  if (!INSTANT_RE.test(s)) throw new Error(`시간대가 적힌 ISO 시각이어야 합니다: ${s}`);
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new Error(`시각을 읽을 수 없습니다: ${s}`);
  // 날짜 부분이 달력에 있는지도 본다(Date.parse는 2026-02-30을 3월로 넘기는 환경이 있다).
  if (!isLocalDate(s.slice(0, 10))) throw new Error(`날짜가 달력에 없습니다: ${s}`);
  return ms;
}

export function isInstant(s: unknown): s is string {
  if (typeof s !== "string") return false;
  try {
    parseInstant(s);
    return true;
  } catch {
    return false;
  }
}

/** 그 시각의 KST 날짜. */
export function kstDateOf(ms: number): LocalDate {
  const dt = new Date(ms + KST_OFFSET_MS);
  return fromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** 그 시각의 KST 자정부터 흐른 분. */
export function kstMinuteOfDay(ms: number): number {
  const dt = new Date(ms + KST_OFFSET_MS);
  return dt.getUTCHours() * 60 + dt.getUTCMinutes();
}

/** KST 날짜 + "HH:MM" → ms. */
export function kstInstant(d: LocalDate, hhmm: string): number {
  const min = parseHhmm(hhmm);
  if (min === null) throw new Error(`시각 형식이 틀렸습니다: ${hhmm}`);
  const [y, m, day] = parts(d);
  return Date.UTC(y, m - 1, day) - KST_OFFSET_MS + min * 60_000;
}

/** 오프셋을 붙인 KST ISO 문자열. 브라우저 저장과 화면이 같은 글자를 보게 한다. */
export function formatKstIso(ms: number): string {
  const dt = new Date(ms + KST_OFFSET_MS);
  return `${fromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())}T${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}:${pad2(dt.getUTCSeconds())}+09:00`;
}

/** "HH:MM" → 자정부터의 분. 형식이 틀리면 null. 24:00은 받지 않는다. */
export function parseHhmm(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

// ── 진료일 ──────────────────────────────────────────────────

export interface Holiday {
  date: LocalDate;
  name: string;
}

export interface ExtraClosed {
  date: LocalDate;
  reason: string;
}

export interface DayHours {
  open: string;
  close: string;
}

/** V02(진료시간·휴진)의 json + D01의 공휴일 목록을 합친 달력. */
export interface ClinicCalendar {
  weekly: Record<DowKey, DayHours | null>;
  /** "public-holiday"가 V02 closed에 있으면 true. */
  closedOnPublicHolidays: boolean;
  holidays: Holiday[];
  /**
   * 공휴일 목록을 공식 출처로 확인한 기간(양 끝 포함). 이 밖의 날짜는 공휴일인지 **모른다**.
   * 모르는 날을 진료일로 치되 `holidayUnknown`으로 표시한다 — 조용히 "평일"로 믿지 않게.
   */
  holidayCoverage: { from: LocalDate; to: LocalDate };
  extraClosed: ExtraClosed[];
}

export type ClosedReason =
  | { kind: "weekly"; dow: DowKey; label: string }
  | { kind: "holiday"; name: string; label: string }
  | { kind: "extra"; reason: string; label: string };

export interface DayCheck {
  open: boolean;
  /** 휴진 사유. 여러 개가 겹칠 수 있다(추석 연휴의 토요일). */
  reasons: ClosedReason[];
  /** 공휴일 확인 기간 밖이라 공휴일 여부를 모름. */
  holidayUnknown: boolean;
}

export function checkDay(d: LocalDate, cal: ClinicCalendar): DayCheck {
  const reasons: ClosedReason[] = [];
  const dow = DOW_KEYS[dayOfWeek(d)];
  if (cal.weekly[dow] === null) reasons.push({ kind: "weekly", dow, label: `${DOW_KO[dayOfWeek(d)]}요일 휴진` });
  const inCoverage = d >= cal.holidayCoverage.from && d <= cal.holidayCoverage.to;
  if (cal.closedOnPublicHolidays) {
    for (const h of cal.holidays) if (h.date === d) reasons.push({ kind: "holiday", name: h.name, label: `공휴일(${h.name})` });
  }
  for (const x of cal.extraClosed) if (x.date === d) reasons.push({ kind: "extra", reason: x.reason, label: `휴진(${x.reason})` });
  return { open: reasons.length === 0, reasons, holidayUnknown: cal.closedOnPublicHolidays && !inCoverage };
}

export function isOpenDay(d: LocalDate, cal: ClinicCalendar): boolean {
  return checkDay(d, cal).open;
}

/** 연휴가 이보다 길면 달력 자료가 잘못된 것으로 본다(무한 반복 방지). */
const MAX_CLOSED_RUN = 31;

export interface Shift {
  /** 실제로 잡힌 날(진료일). */
  date: LocalDate;
  /** 미뤘으면 건너뛴 날과 사유. 안 미뤘으면 빈 배열. */
  skipped: { date: LocalDate; reasons: ClosedReason[] }[];
  /** 살펴본 날 중 공휴일 확인 기간 밖인 날이 있었음. */
  holidayUnknown: boolean;
}

/**
 * 그날이 진료일이면 그날, 아니면 다음 진료일. 옮길 범위가 문서에 없는 시점(D01)과 다시 연락할 날에 쓴다.
 * 앞당기지 않는 이유: 수술 후 시점을 앞당기면 "D+7 전에는 하지 말라"는 안내와 부딪힐 수 있다. 범위가 있는 시점은 shiftWithinWindow.
 */
export function shiftToOpenDay(d: LocalDate, cal: ClinicCalendar): Shift {
  const skipped: Shift["skipped"] = [];
  let cur = d;
  let unknown = false;
  for (let i = 0; i <= MAX_CLOSED_RUN; i++) {
    const c = checkDay(cur, cal);
    unknown ||= c.holidayUnknown;
    if (c.open) return { date: cur, skipped, holidayUnknown: unknown };
    skipped.push({ date: cur, reasons: c.reasons });
    cur = addDays(cur, 1);
  }
  throw new Error(`${d}부터 ${MAX_CLOSED_RUN}일 넘게 진료일이 없습니다. 달력 자료를 확인하세요`);
}

/** 옮겨도 되는 범위: 원래 날짜 앞 before일 ~ 뒤 after일(양 끝 포함). 근거 문서가 적은 범위만 둔다(D01 shiftWindow). */
export interface DayWindow {
  before: number;
  after: number;
}

export type ShiftDirection = "none" | "later" | "earlier" | "unresolved";

export interface WindowShift {
  /** 잡힌 날(진료일). 범위 안에 진료일이 없으면 null — 날짜를 지어내지 않고 사람(간호팀)이 정하게 둔다. */
  date: LocalDate | null;
  direction: ShiftDirection;
  /** 살펴본 휴진일과 사유. 살펴본 순서(원래 날짜 → 뒤로 → 앞으로)대로. */
  skipped: { date: LocalDate; reasons: ClosedReason[] }[];
  holidayUnknown: boolean;
}

/**
 * 범위가 있는 시점의 휴진 이동(D01 shiftRule "window-next-then-previous").
 *   ① 원래 날짜가 진료일이면 그대로 ② 범위 안의 다음 진료일(뒤로 가장 가까운 날) ③ 없으면 범위 안의 이전 진료일(앞당김, 가장 가까운 날)
 *   ④ 그래도 없으면 date = null(허용 범위 안에 진료일 없음).
 * 뒤를 먼저 보는 이유: D01은 원래 "앞당기지 않는다"였고, 앞당김은 범위 안에 뒤 진료일이 없을 때만 쓰는 예외로 둔다
 * (앞당기면 "D+7 전에는 하지 말라" 같은 안내와 부딪힐 수 있다 — 그래서 before는 earlyDays를 넘지 못하게 rules.ts가 막는다).
 * 범위가 없는 시점은 이 함수가 아니라 shiftToOpenDay(다음 진료일로 미룸)를 쓴다.
 */
export function shiftWithinWindow(d: LocalDate, cal: ClinicCalendar, window: DayWindow): WindowShift {
  const skipped: WindowShift["skipped"] = [];
  let unknown = false;
  const look = (cur: LocalDate): boolean => {
    const c = checkDay(cur, cal);
    unknown ||= c.holidayUnknown;
    if (!c.open) skipped.push({ date: cur, reasons: c.reasons });
    return c.open;
  };
  if (look(d)) return { date: d, direction: "none", skipped, holidayUnknown: unknown };
  for (let i = 1; i <= window.after; i++) {
    const cur = addDays(d, i);
    if (look(cur)) return { date: cur, direction: "later", skipped, holidayUnknown: unknown };
  }
  for (let i = 1; i <= window.before; i++) {
    const cur = addDays(d, -i);
    if (look(cur)) return { date: cur, direction: "earlier", skipped, holidayUnknown: unknown };
  }
  return { date: null, direction: "unresolved", skipped, holidayUnknown: unknown };
}

/** d **다음** 진료일(d 자신은 빼고). "내일 내원"의 '내일'을 정하는 데 쓴다. */
export function nextOpenDay(d: LocalDate, cal: ClinicCalendar): LocalDate {
  return shiftToOpenDay(addDays(d, 1), cal).date;
}

/** d **이전** 진료일(d 자신은 빼고). */
export function prevOpenDay(d: LocalDate, cal: ClinicCalendar): LocalDate {
  let cur = addDays(d, -1);
  for (let i = 0; i <= MAX_CLOSED_RUN; i++) {
    if (isOpenDay(cur, cal)) return cur;
    cur = addDays(cur, -1);
  }
  throw new Error(`${d} 전 ${MAX_CLOSED_RUN}일 동안 진료일이 없습니다. 달력 자료를 확인하세요`);
}

// ── V02 json 읽기 ─────────────────────────────────────────────

export interface ClinicHours {
  weekly: Record<DowKey, DayHours | null>;
  closedOnPublicHolidays: boolean;
  extraClosed: ExtraClosed[];
}

export type HoursResult = { ok: true; hours: ClinicHours } | { ok: false; errors: string[] };

const V02_KEYS = new Set(["timezone", "weekly", "lunch", "lastEntryMinutesBeforeClose", "closed", "extraClosedDates", "noSurgeryDays"]);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * V02 json(한창구 볼트 그대로)에서 진료일 판정에 쓰는 값만 검증해 꺼낸다.
 * 모르는 키는 거부한다(한창구 규격에 없는 키가 생겼다면 다시봄도 그 뜻을 알아야 한다).
 * weekly의 null과 closed 목록이 서로 어긋나면 거부한다 — 어느 쪽이 맞는지 코드가 고르지 않는다.
 */
export function parseClinicHours(json: unknown): HoursResult {
  const errors: string[] = [];
  if (!isObj(json)) return { ok: false, errors: ["V02 json이 객체가 아닙니다"] };
  for (const k of Object.keys(json)) if (!V02_KEYS.has(k)) errors.push(`V02 모르는 키입니다: ${k}`);
  if (json.timezone !== "Asia/Seoul") errors.push(`V02 timezone은 Asia/Seoul이어야 합니다: ${String(json.timezone)}`);

  const weekly = {} as Record<DowKey, DayHours | null>;
  if (!isObj(json.weekly)) errors.push("V02 weekly가 객체가 아닙니다");
  else {
    for (const k of Object.keys(json.weekly)) if (!(DOW_KEYS as readonly string[]).includes(k)) errors.push(`V02 weekly 모르는 요일: ${k}`);
    for (const dow of DOW_KEYS) {
      const v = json.weekly[dow];
      if (v === null) weekly[dow] = null;
      else if (v === undefined) errors.push(`V02 weekly.${dow}가 없습니다`);
      else if (!isObj(v) || typeof v.open !== "string" || typeof v.close !== "string" || Object.keys(v).length !== 2) {
        errors.push(`V02 weekly.${dow} 모양이 틀렸습니다`);
      } else {
        const o = parseHhmm(v.open);
        const c = parseHhmm(v.close);
        if (o === null || c === null || o >= c) errors.push(`V02 weekly.${dow} 시각이 틀렸습니다: ${v.open}~${v.close}`);
        else weekly[dow] = { open: v.open, close: v.close };
      }
    }
  }

  let closedOnPublicHolidays = false;
  if (!Array.isArray(json.closed) || !json.closed.every((x) => typeof x === "string")) errors.push("V02 closed가 문자열 배열이 아닙니다");
  else {
    const closed = json.closed as string[];
    for (const c of closed) if (c !== "public-holiday" && !(DOW_KEYS as readonly string[]).includes(c)) errors.push(`V02 closed 모르는 값: ${c}`);
    closedOnPublicHolidays = closed.includes("public-holiday");
    if (isObj(json.weekly)) {
      for (const dow of DOW_KEYS) {
        const nullDay = json.weekly[dow] === null;
        if (nullDay !== closed.includes(dow)) errors.push(`V02 weekly.${dow}와 closed 목록이 서로 다릅니다`);
      }
    }
  }

  const extraClosed: ExtraClosed[] = [];
  if (!Array.isArray(json.extraClosedDates)) errors.push("V02 extraClosedDates가 배열이 아닙니다");
  else {
    for (const x of json.extraClosedDates) {
      if (!isObj(x) || !isLocalDate(x.date) || typeof x.reason !== "string" || x.reason.trim() === "" || Object.keys(x).length !== 2) {
        errors.push(`V02 extraClosedDates 항목이 틀렸습니다: ${JSON.stringify(x)}`);
      } else extraClosed.push({ date: x.date, reason: x.reason });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, hours: { weekly, closedOnPublicHolidays, extraClosed } };
}

export function buildCalendar(hours: ClinicHours, holidays: Holiday[], holidayCoverage: { from: LocalDate; to: LocalDate }): ClinicCalendar {
  return { weekly: hours.weekly, closedOnPublicHolidays: hours.closedOnPublicHolidays, extraClosed: hours.extraClosed, holidays, holidayCoverage };
}
