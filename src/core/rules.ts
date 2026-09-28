/**
 * 사후관리 연락 규정(볼트 D01) json 읽기(PRD F2).
 *
 * 원칙: 값이 빠지거나 깨지면 **전체를 멈춘다.** 기본값을 채우지 않는다.
 * 예) graceDays가 빠진 시점을 0으로 채우면 예정일 다음 날부터 모든 환자가 "예정일 지남"에 뜨고,
 *     7로 채우면 병원이 정하지 않은 유예가 생긴다. 어느 쪽이든 병원이 정한 값이 아니다.
 * 모르는 키도 거부한다: "gracedays" 같은 오타를 조용히 받으면 그 값이 없는 것과 같아진다.
 * 틀린 곳은 하나에서 멈추지 않고 모두 모아 돌려준다(문서를 고치는 사람이 한 번에 보게).
 *
 * 규칙 이름표(monthEndRule, shiftRule, upcomingNotice 등)는 코드가 아는 값 하나씩만 받는다.
 * 다른 값이 오면 "그 규칙대로 계산한 척"하지 않고 멈춘다.
 *
 * json 모양(D01 본문의 ```json 블록 하나, 볼트 vault/followup-policy.md):
 * {
 *   "timezone": "Asia/Seoul", "clinicPhone": "02-000-0000",
 *   "procedures": {
 *     "hair-transplant": [ { key, label, offsetDays | offsetMonths, kind, earlyDays, graceDays }, ... ],   고정 시점
 *     "injection":  { keyPrefix, label, intervalDays, sessions, photoSessions, earlyDays, graceDays },      회차(1회차 = 시작일)
 *     "scalp-care": { key, label, kind: "notice", anchor: "last-visit", intervalDays, earlyDays, graceDays, horizonMonths }  반복 안내
 *   },
 *   "upcomingNotice": "previous-open-day", "retryIntervalDays", "maxAttempts",
 *   "contactResults": ["called", "no-answer", "sms", "later"],
 *   "contactWindow": { "start": "09:00", "end": "20:00" },
 *   "monthEndRule": "clamp", "shiftRule": "next-open-day",
 *   "reasonOrder": ["overdue", "upcoming-visit", "care-notice", "injection-rebook", "photo-round"],
 *   "holidaysCoverage": { "from", "to", "checkedOn" },
 *   "holidays": [ { "date", "name" }, ... ],
 *   "templates": { "overdue", "upcoming-visit", "photo-round", "injection-rebook", "care-notice-<안내 시점 key>": "문구 {{date}}" }
 * }
 * 세 시술은 모양으로 가른다: 배열 = 고정 시점, keyPrefix가 있으면 회차, anchor가 있으면 반복 안내.
 */

import { isLocalDate, parseHhmm, type Holiday, type LocalDate, type MonthEndRule } from "./calendar";
import { CONTACT_RESULTS, PROCEDURES, type Procedure } from "./patient";

export const POINT_KINDS = ["visit", "notice", "photo"] as const;
/**
 * visit = 내원, photo = 내원해서 경과 사진도 찍는 회차(내원의 한 종류), notice = 내원 없이 안내만 하는 시점.
 * photo를 visit과 따로 두는 이유: 사진 회차에는 같은각도 안내를 붙이고(F11), 목록에 '사진 회차' 이유를 더한다.
 */
export type PointKind = (typeof POINT_KINDS)[number];

/** 오늘 목록의 이유. 이름은 D01 reasonOrder·templates와 같다. */
export const REASONS = ["overdue", "upcoming-visit", "care-notice", "injection-rebook", "photo-round"] as const;
export type Reason = (typeof REASONS)[number];

export interface FixedPointRule {
  key: string;
  label: string;
  offset: { unit: "days" | "months"; n: number };
  kind: PointKind;
  earlyDays: number;
  graceDays: number;
}

export interface SeriesRule {
  /** 회차 시점 key = keyPrefix + 회차(2부터). 1회차는 시작일 자체라 시점을 만들지 않는다(D01). */
  keyPrefix: string;
  label: string;
  intervalDays: number;
  sessions: number;
  photoSessions: number[];
  earlyDays: number;
  graceDays: number;
}

export interface RecurringNoticeRule {
  key: string;
  label: string;
  kind: "notice";
  anchor: "last-visit";
  intervalDays: number;
  earlyDays: number;
  graceDays: number;
  /** 시작일에서 이 개월 수까지만 안내한다. */
  horizonMonths: number;
}

export type ProcedureRule =
  | { type: "fixed"; points: FixedPointRule[] }
  | ({ type: "series" } & SeriesRule)
  | ({ type: "recurring" } & RecurringNoticeRule);

/** 템플릿 칸. 이 밖의 칸 이름은 규정 문서 단계에서 거부한다(없는 칸을 빈칸으로 보내지 않게). */
export const TEMPLATE_SLOTS = ["date", "time", "clinicPhone"] as const;
export type TemplateSlot = (typeof TEMPLATE_SLOTS)[number];

/** 이유별 공통 문구. 관리 안내는 시점마다 문구가 달라 `care-notice-<시점 key>`를 쓴다. */
export const REQUIRED_TEMPLATES = ["overdue", "upcoming-visit", "photo-round", "injection-rebook"] as const;
export const careNoticeTemplateKey = (pointKey: string) => `care-notice-${pointKey}`;

export interface Rules {
  timezone: "Asia/Seoul";
  clinicPhone: string;
  procedures: Record<Procedure, ProcedureRule>;
  upcomingNotice: "previous-open-day";
  retryIntervalDays: number;
  maxAttempts: number;
  contactResults: string[];
  contactWindow: { start: string; end: string };
  monthEndRule: MonthEndRule;
  shiftRule: "next-open-day";
  reasonOrder: Reason[];
  holidaysCoverage: { from: LocalDate; to: LocalDate; checkedOn: LocalDate };
  holidays: Holiday[];
  templates: Record<string, string>;
}

export type RulesResult = { ok: true; rules: Rules } | { ok: false; errors: string[] };

const TOP_KEYS = [
  "timezone",
  "clinicPhone",
  "procedures",
  "upcomingNotice",
  "retryIntervalDays",
  "maxAttempts",
  "contactResults",
  "contactWindow",
  "monthEndRule",
  "shiftRule",
  "reasonOrder",
  "holidaysCoverage",
  "holidays",
  "templates",
] as const;
const POINT_KEYS = new Set(["key", "label", "offsetDays", "offsetMonths", "kind", "earlyDays", "graceDays"]);
const SERIES_KEYS = ["keyPrefix", "label", "intervalDays", "sessions", "photoSessions", "earlyDays", "graceDays"] as const;
const RECURRING_KEYS = ["key", "label", "kind", "anchor", "intervalDays", "earlyDays", "graceDays", "horizonMonths"] as const;
const KEY_RE = /^[a-z0-9][a-z0-9-]*$/;
const SLOT_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 정수이고 min 이상인지. 1.5나 "7"(문자열)은 받지 않는다. */
function intAtLeast(v: unknown, min: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min;
}

function checkInt(errors: string[], where: string, v: unknown, min: number): number {
  if (v === undefined) errors.push(`${where}가 없습니다`);
  else if (!intAtLeast(v, min)) errors.push(`${where}는 ${min} 이상의 정수여야 합니다: ${JSON.stringify(v)}`);
  return v as number;
}

function checkLabel(errors: string[], where: string, v: unknown): string {
  if (typeof v !== "string" || v.trim() === "") errors.push(`${where}가 비었거나 문자열이 아닙니다`);
  return v as string;
}

function checkKey(errors: string[], where: string, v: unknown, keys: Set<string>): string {
  if (typeof v !== "string" || !KEY_RE.test(v)) errors.push(`${where} 형식이 틀렸습니다: ${JSON.stringify(v)}`);
  else if (keys.has(v)) errors.push(`${where}가 겹칩니다: ${v}`);
  else keys.add(v);
  return v as string;
}

function unknownKeys(errors: string[], where: string, o: Record<string, unknown>, allowed: Iterable<string>) {
  const set = new Set(allowed);
  for (const k of Object.keys(o)) if (!set.has(k)) errors.push(`${where} 모르는 키입니다: ${k}`);
}

function parseFixed(errors: string[], proc: string, arr: unknown[], keys: Set<string>): FixedPointRule[] {
  const out: FixedPointRule[] = [];
  if (arr.length === 0) errors.push(`procedures.${proc}가 비어 있습니다`);
  arr.forEach((p, i) => {
    const where = `procedures.${proc}[${i}]`;
    if (!isObj(p)) {
      errors.push(`${where}가 객체가 아닙니다`);
      return;
    }
    unknownKeys(errors, where, p, POINT_KEYS);
    const key = checkKey(errors, `${where}.key`, p.key, keys);
    const label = checkLabel(errors, `${where}.label`, p.label);
    const hasD = p.offsetDays !== undefined;
    const hasM = p.offsetMonths !== undefined;
    let offset: FixedPointRule["offset"] = { unit: "days", n: 0 };
    if (hasD === hasM) errors.push(`${where}에는 offsetDays와 offsetMonths 중 정확히 하나가 있어야 합니다`);
    else if (hasD) offset = { unit: "days", n: checkInt(errors, `${where}.offsetDays`, p.offsetDays, 1) };
    else offset = { unit: "months", n: checkInt(errors, `${where}.offsetMonths`, p.offsetMonths, 1) };
    if (!(POINT_KINDS as readonly unknown[]).includes(p.kind)) errors.push(`${where}.kind 값이 틀렸습니다: ${JSON.stringify(p.kind)}`);
    const earlyDays = checkInt(errors, `${where}.earlyDays`, p.earlyDays, 0);
    const graceDays = checkInt(errors, `${where}.graceDays`, p.graceDays, 0);
    out.push({ key, label, offset, kind: p.kind as PointKind, earlyDays, graceDays });
  });
  // 시점은 시작일에서 가까운 순이어야 한다("뒤 시점이 완료되면 앞 시점은 건너뜀" 판정이 이 순서에 기댄다).
  // 개월과 일을 섞어 비교할 수 없으니 같은 단위끼리만 본다. 섞인 순서는 schedule.ts가 날짜로 다시 본다.
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1].offset;
    const b = out[i].offset;
    if ((a.unit === b.unit && a.n >= b.n) || (a.unit === "months" && b.unit === "days")) {
      errors.push(`procedures.${proc}의 시점이 가까운 순이 아닙니다: ${out[i - 1].key} → ${out[i].key}`);
    }
  }
  return out;
}

function parseSeries(errors: string[], proc: string, o: Record<string, unknown>, keys: Set<string>): SeriesRule {
  const where = `procedures.${proc}`;
  unknownKeys(errors, where, o, SERIES_KEYS);
  const keyPrefix = o.keyPrefix;
  if (typeof keyPrefix !== "string" || !/^[a-z][a-z0-9-]*$/.test(keyPrefix)) errors.push(`${where}.keyPrefix 형식이 틀렸습니다: ${JSON.stringify(keyPrefix)}`);
  const label = checkLabel(errors, `${where}.label`, o.label);
  const intervalDays = checkInt(errors, `${where}.intervalDays`, o.intervalDays, 1);
  // 1회차는 시작일이라 시점이 없다. 2회 이상이어야 계산할 회차가 생긴다.
  const sessions = checkInt(errors, `${where}.sessions`, o.sessions, 2);
  const earlyDays = checkInt(errors, `${where}.earlyDays`, o.earlyDays, 0);
  const graceDays = checkInt(errors, `${where}.graceDays`, o.graceDays, 0);
  const photoSessions: number[] = [];
  if (!Array.isArray(o.photoSessions)) errors.push(`${where}.photoSessions가 배열이 아닙니다`);
  else
    for (const n of o.photoSessions) {
      if (!intAtLeast(n, 2) || (intAtLeast(sessions, 2) && n > sessions)) errors.push(`${where}.photoSessions에 2~sessions 밖의 값이 있습니다: ${JSON.stringify(n)}`);
      else if (photoSessions.includes(n)) errors.push(`${where}.photoSessions에 같은 회차가 두 번 있습니다: ${n}`);
      else photoSessions.push(n);
    }
  if (typeof keyPrefix === "string" && intAtLeast(sessions, 2)) {
    for (let n = 2; n <= sessions; n++) checkKey(errors, `${where} 회차 key`, `${keyPrefix}${n}`, keys);
  }
  return { keyPrefix: keyPrefix as string, label, intervalDays, sessions, photoSessions: [...photoSessions].sort((a, b) => a - b), earlyDays, graceDays };
}

function parseRecurring(errors: string[], proc: string, o: Record<string, unknown>, keys: Set<string>): RecurringNoticeRule {
  const where = `procedures.${proc}`;
  unknownKeys(errors, where, o, RECURRING_KEYS);
  const key = checkKey(errors, `${where}.key`, o.key, keys);
  const label = checkLabel(errors, `${where}.label`, o.label);
  // 반복 시점은 안내만 지원한다. 반복 내원을 받으려면 미방문 판정의 기준(무엇을 놓쳤나)을 먼저 정해야 한다.
  if (o.kind !== "notice") errors.push(`${where}.kind는 "notice"만 지원합니다: ${JSON.stringify(o.kind)}`);
  if (o.anchor !== "last-visit") errors.push(`${where}.anchor는 "last-visit"만 지원합니다: ${JSON.stringify(o.anchor)}`);
  const intervalDays = checkInt(errors, `${where}.intervalDays`, o.intervalDays, 1);
  const earlyDays = checkInt(errors, `${where}.earlyDays`, o.earlyDays, 0);
  const graceDays = checkInt(errors, `${where}.graceDays`, o.graceDays, 0);
  const horizonMonths = checkInt(errors, `${where}.horizonMonths`, o.horizonMonths, 1);
  return { key, label, kind: "notice", anchor: "last-visit", intervalDays, earlyDays, graceDays, horizonMonths };
}

/** 템플릿 문구 안의 칸 이름들. "{{ date }}"처럼 안쪽 공백은 무시한다. */
export function templateSlots(text: string): string[] {
  return [...text.matchAll(SLOT_RE)].map((m) => m[1]);
}

function checkConst(errors: string[], name: string, v: unknown, expected: string) {
  if (v !== expected) errors.push(`${name}는 ${JSON.stringify(expected)}만 지원합니다: ${JSON.stringify(v)}`);
}

export function parseRules(json: unknown): RulesResult {
  if (!isObj(json)) return { ok: false, errors: ["D01 json이 객체가 아닙니다"] };
  const errors: string[] = [];
  for (const k of Object.keys(json)) if (!(TOP_KEYS as readonly string[]).includes(k)) errors.push(`모르는 키입니다: ${k}`);
  for (const k of TOP_KEYS) if (json[k] === undefined) errors.push(`${k}가 없습니다`);
  if (errors.length > 0) return { ok: false, errors };

  checkConst(errors, "timezone", json.timezone, "Asia/Seoul");
  const clinicPhone = checkLabel(errors, "clinicPhone", json.clinicPhone);

  // procedures
  const procedures = {} as Record<Procedure, ProcedureRule>;
  const pointKeys = new Set<string>();
  const noticeKeys: string[] = [];
  if (!isObj(json.procedures)) errors.push("procedures가 객체가 아닙니다");
  else {
    for (const k of Object.keys(json.procedures)) if (!(PROCEDURES as readonly string[]).includes(k)) errors.push(`procedures 모르는 시술입니다: ${k}`);
    for (const proc of PROCEDURES) {
      const v = json.procedures[proc];
      if (v === undefined) errors.push(`procedures.${proc}가 없습니다`);
      else if (Array.isArray(v)) {
        const points = parseFixed(errors, proc, v, pointKeys);
        procedures[proc] = { type: "fixed", points };
        for (const p of points) if (p.kind === "notice") noticeKeys.push(p.key);
      } else if (isObj(v) && "keyPrefix" in v) procedures[proc] = { type: "series", ...parseSeries(errors, proc, v, pointKeys) };
      else if (isObj(v) && "anchor" in v) {
        const r = parseRecurring(errors, proc, v, pointKeys);
        procedures[proc] = { type: "recurring", ...r };
        noticeKeys.push(r.key);
      } else errors.push(`procedures.${proc}는 시점 배열, 회차 객체(keyPrefix), 반복 안내 객체(anchor) 중 하나여야 합니다`);
    }
  }

  checkConst(errors, "upcomingNotice", json.upcomingNotice, "previous-open-day");
  const retryIntervalDays = checkInt(errors, "retryIntervalDays", json.retryIntervalDays, 1);
  const maxAttempts = checkInt(errors, "maxAttempts", json.maxAttempts, 1);

  // 연락 결과 목록은 코드의 목록과 정확히 같아야 한다. 문서에만 있는 결과는 다음 연락일을 계산할 방법이 없다.
  const cr = json.contactResults;
  if (!Array.isArray(cr) || cr.length !== CONTACT_RESULTS.length || !CONTACT_RESULTS.every((r) => cr.includes(r))) {
    errors.push(`contactResults는 ${CONTACT_RESULTS.join(", ")} 네 가지여야 합니다: ${JSON.stringify(cr)}`);
  }

  // contactWindow
  const cw = json.contactWindow;
  let contactWindow = { start: "", end: "" };
  if (!isObj(cw) || Object.keys(cw).length !== 2 || typeof cw.start !== "string" || typeof cw.end !== "string") {
    errors.push("contactWindow는 { start, end } 모양이어야 합니다");
  } else {
    const s = parseHhmm(cw.start);
    const e = parseHhmm(cw.end);
    if (s === null || e === null) errors.push(`contactWindow 시각 형식이 틀렸습니다: ${cw.start}~${cw.end}`);
    // 자정을 넘는 창(22:00~02:00)은 받지 않는다. 연락 가능 시간대가 밤을 넘을 일은 없고, 넘기면 계산이 두 갈래가 된다.
    else if (s >= e) errors.push(`contactWindow 시작이 끝보다 앞이어야 합니다: ${cw.start}~${cw.end}`);
    contactWindow = { start: cw.start, end: cw.end };
  }

  checkConst(errors, "monthEndRule", json.monthEndRule, "clamp");
  checkConst(errors, "shiftRule", json.shiftRule, "next-open-day");

  // 이유 순서: 다섯 이유를 빠짐없이 한 번씩.
  const ro = json.reasonOrder;
  if (!Array.isArray(ro) || ro.length !== REASONS.length || !REASONS.every((r) => ro.includes(r))) {
    errors.push(`reasonOrder는 ${REASONS.join(", ")}를 한 번씩 담아야 합니다: ${JSON.stringify(ro)}`);
  }

  // holidaysCoverage
  const hc = json.holidaysCoverage;
  let holidaysCoverage = { from: "" as LocalDate, to: "" as LocalDate, checkedOn: "" as LocalDate };
  if (!isObj(hc) || Object.keys(hc).length !== 3 || !isLocalDate(hc.from) || !isLocalDate(hc.to) || !isLocalDate(hc.checkedOn) || hc.from > hc.to) {
    errors.push("holidaysCoverage는 { from, to, checkedOn } 날짜(from ≤ to)여야 합니다");
  } else holidaysCoverage = { from: hc.from, to: hc.to, checkedOn: hc.checkedOn };

  // holidays
  const holidays: Holiday[] = [];
  if (!Array.isArray(json.holidays)) errors.push("holidays가 배열이 아닙니다");
  else {
    const seen = new Set<string>();
    json.holidays.forEach((h, i) => {
      if (!isObj(h) || Object.keys(h).length !== 2 || !isLocalDate(h.date) || typeof h.name !== "string" || h.name.trim() === "") {
        errors.push(`holidays[${i}]는 { date, name }이어야 합니다: ${JSON.stringify(h)}`);
        return;
      }
      if (seen.has(h.date)) errors.push(`holidays에 같은 날짜가 두 번 있습니다: ${h.date}`);
      seen.add(h.date);
      // 확인 기간 밖의 공휴일이 적혀 있으면 확인 기간 자체가 틀린 것이다.
      if (holidaysCoverage.from !== "" && (h.date < holidaysCoverage.from || h.date > holidaysCoverage.to)) {
        errors.push(`holidays[${i}] ${h.date}가 holidaysCoverage 밖입니다`);
      }
      holidays.push({ date: h.date, name: h.name });
    });
  }

  // templates
  const templates: Record<string, string> = {};
  if (!isObj(json.templates)) errors.push("templates가 객체가 아닙니다");
  else {
    for (const [k, v] of Object.entries(json.templates)) {
      if (typeof v !== "string" || v.trim() === "") {
        errors.push(`templates.${k}가 비었거나 문자열이 아닙니다`);
        continue;
      }
      for (const slot of templateSlots(v)) {
        if (!(TEMPLATE_SLOTS as readonly string[]).includes(slot)) errors.push(`templates.${k}에 모르는 칸이 있습니다: {{${slot}}}`);
      }
      // 칸을 뺀 나머지에 중괄호가 남으면 칸을 잘못 적은 것이다("{{date}" 등).
      if (/[{}]/.test(v.replace(SLOT_RE, ""))) errors.push(`templates.${k}의 칸 표기가 틀렸습니다(중괄호 짝)`);
      templates[k] = v;
    }
    for (const k of [...REQUIRED_TEMPLATES, ...noticeKeys.map(careNoticeTemplateKey)]) if (json.templates[k] === undefined) errors.push(`templates.${k}가 없습니다`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    rules: {
      timezone: "Asia/Seoul",
      clinicPhone,
      procedures,
      upcomingNotice: "previous-open-day",
      retryIntervalDays,
      maxAttempts,
      contactResults: [...(cr as string[])],
      contactWindow,
      monthEndRule: "clamp",
      shiftRule: "next-open-day",
      reasonOrder: [...(ro as Reason[])],
      holidaysCoverage,
      holidays: [...holidays].sort((a, b) => (a.date < b.date ? -1 : 1)),
      templates,
    },
  };
}
