/**
 * 규칙 바꿔 보기(PRD F9): 규칙 값 하나를 바꾸면 오늘 목록과 오늘부터 30일(오늘 포함) 일자별 연락 수가 어떻게 달라지는지.
 * 볼트 원본은 바꾸지 않는다 — 바뀐 규칙은 이 함수 안에서만 산다.
 *
 * 바뀐 규칙도 D01을 읽을 때와 같은 검증(rules.parseRules)을 다시 거친다.
 * 예) 주사 유예를 늘려 조기 창과 겹치게 만들면 문서를 고친 것과 똑같이 거부된다.
 *
 * 앞으로 30일 예측의 가정(결과에 그대로 싣는다):
 * 1. 오늘 이후로 예정된 내원은 예정일(밀린 날짜)에 온다.
 * 2. 이미 미방문이거나 유예 중인 환자는 오지 않고, 목록에 오른 날 연락하면 늘 "부재"다(가장 많이 연락하게 되는 쪽).
 * 3. 목록에 오른 줄은 그날 모두 연락한다. 휴진일에는 연락하지 않고 0건으로 센다.
 * 실제 연락 수가 아니라 규칙 값에 따른 **차이**를 보려는 모형이다.
 */

import { addDays, checkDay, formatKstIso, kstDateOf, type LocalDate } from "./calendar";
import { withRules, type Engine } from "./engine";
import type { Patient, Procedure } from "./patient";
import { parseRules, type ProcedureRule, type Rules, type RulesResult } from "./rules";
import { buildSchedule, isVisitKind } from "./schedule";
import { evaluatePoints } from "./status";
import { buildToday, countRows, type Reason, type TodayList } from "./today";

export type RuleChange =
  | { field: "retryIntervalDays"; value: number }
  | { field: "maxAttempts"; value: number }
  /** key가 "*"이면 그 시술의 모든 시점(회차 시술은 회차 전체). */
  | { field: "graceDays" | "earlyDays"; procedure: Procedure; key: string; value: number }
  /** 개월로 정한 고정 시점 하나의 개월 수(예: 모발이식 6개월 경과 진료 → 7개월). 시점 순서는 parseRules·buildSchedule이 다시 본다. */
  | { field: "offsetMonths"; procedure: Procedure; key: string; value: number };

const MS_PER_DAY = 86_400_000;

/** Rules → D01 json 모양. 바꾼 규칙을 parseRules로 다시 검증하려고 되돌린다. */
export function rulesToJson(rules: Rules): Record<string, unknown> {
  const procedures: Record<string, unknown> = {};
  for (const [proc, r] of Object.entries(rules.procedures) as [Procedure, ProcedureRule][]) {
    if (r.type === "fixed") {
      procedures[proc] = r.points.map((p) => ({
        key: p.key,
        label: p.label,
        ...(p.offset.unit === "days" ? { offsetDays: p.offset.n } : { offsetMonths: p.offset.n }),
        kind: p.kind,
        earlyDays: p.earlyDays,
        graceDays: p.graceDays,
      }));
    } else {
      const { type: _type, ...rest } = r;
      void _type;
      procedures[proc] = structuredClone(rest);
    }
  }
  const { procedures: _p, ...top } = rules;
  void _p;
  return { ...structuredClone(top), procedures };
}

export function applyRuleChange(rules: Rules, change: RuleChange): RulesResult {
  const json = rulesToJson(rules) as { procedures: Record<string, unknown> } & Record<string, unknown>;
  if (change.field === "retryIntervalDays" || change.field === "maxAttempts") {
    json[change.field] = change.value;
    return parseRules(json);
  }
  const target = json.procedures[change.procedure];
  if (change.field === "offsetMonths") {
    const p = Array.isArray(target) ? (target as Record<string, unknown>[]).find((x) => x.key === change.key) : undefined;
    if (!p || p.offsetMonths === undefined) return { ok: false, errors: [`${change.procedure}에 개월로 정한 시점 ${change.key}가 없습니다`] };
    p.offsetMonths = change.value;
    return parseRules(json);
  }
  if (Array.isArray(target)) {
    const points = target as Record<string, unknown>[];
    const hit = points.filter((p) => change.key === "*" || p.key === change.key);
    if (hit.length === 0) return { ok: false, errors: [`${change.procedure}에 시점 ${change.key}가 없습니다`] };
    for (const p of hit) p[change.field] = change.value;
  } else {
    // 회차·반복 안내는 시점마다 값을 따로 두지 않는다. 시점 하나만 바꾸는 요청은 받지 않는다.
    if (change.key !== "*") return { ok: false, errors: [`${change.procedure}는 전체("*")로만 바꿀 수 있습니다`] };
    (target as Record<string, unknown>)[change.field] = change.value;
  }
  return parseRules(json);
}

/**
 * 가정 1을 반영한 환자 목록: 예정일이 오늘 이후인(아직 안 온) 내원마다 예정일에 그 시점 key의 방문을 하나 더한다.
 * 가정 2: 이미 미방문이거나 유예 중인 환자는 오지 않는다. 그런 환자의 뒤 시점에 방문을 넣으면
 * 앞의 미방문이 '건너뜀'으로 사라져 가정이 깨지므로 그 환자에게는 아무것도 더하지 않는다.
 */
function withExpectedVisits(patients: Patient[], engine: Engine, today: LocalDate, until: LocalDate): Patient[] {
  return patients.map((p) => {
    const statuses = evaluatePoints(buildSchedule(p, today, engine.rules, engine.calendar), p.visits, today);
    if (statuses.some((s) => s.state === "missed" || s.state === "in-grace")) return p;
    const extra = statuses
      .filter((s) => isVisitKind(s.point.kind) && (s.state === "upcoming" || s.state === "due-today") && s.point.dueDate <= until)
      .map((s) => ({ date: s.point.dueDate, kind: s.point.key }));
    return extra.length === 0 ? p : { ...p, visits: [...p.visits, ...extra] };
  });
}

export interface DailyCount {
  date: LocalDate;
  count: number;
}

export interface DailyListing extends DailyCount {
  /** 그날 목록에 오른 환자 ID(첫 연락이 앞당겨진 환자를 가리는 데 쓴다). */
  ids: string[];
}

/**
 * **오늘부터** days일 동안(오늘 포함) 일자별 연락(목록 줄) 수와 그날 오른 환자. 오늘을 넣는 이유: 유예를 줄이면
 * 내일 할 첫 연락이 오늘로 앞당겨지는데, 창이 내일부터면 오늘의 +1은 안 보이고 내일의 −1만 보여 "연락이 줄었다"로 읽힌다.
 */
export function forecastListings(patients: Patient[], engine: Engine, nowMs: number, days: number): DailyListing[] {
  const today = kstDateOf(nowMs);
  let state = withExpectedVisits(patients, engine, today, addDays(today, days));
  const out: DailyListing[] = [];
  for (let i = 0; i < days; i++) {
    // KST에는 서머타임이 없어 하루 = 86,400,000ms로 더해도 같은 시각이 된다.
    const at = nowMs + i * MS_PER_DAY;
    const date = kstDateOf(at);
    const open = checkDay(date, engine.calendar).open;
    const list = open ? buildToday(state, engine, at) : null;
    const ids = list ? list.groups.flatMap((g) => g.rows.map((r) => r.patientId)).sort() : [];
    out.push({ date, count: list ? countRows(list) : 0, ids });
    if (!list) continue;
    const listed = new Set(ids);
    // KST 오프셋을 붙여 쌓는다. UTC(Z)로 쌓으면 09:00 KST 전 기준 시각에서 글자 앞 10자가 전날이 되어,
    // 날짜를 글자로 읽는 코드가 하나라도 생기면 하루 어긋난다(변이 검사 M15e).
    const atIso = formatKstIso(at);
    state = state.map((p) => (listed.has(p.id) ? { ...p, contacts: [...p.contacts, { at: atIso, result: "no-answer" as const, note: "예측(가정)" }] } : p));
  }
  return out;
}

/** 오늘부터 days일 동안(오늘 포함) 일자별 연락(목록 줄) 수. 가정은 FORECAST_ASSUMPTIONS. */
export function forecastContacts(patients: Patient[], engine: Engine, nowMs: number, days: number): DailyCount[] {
  return forecastListings(patients, engine, nowMs, days).map(({ date, count }) => ({ date, count }));
}

/** 예측 기간 안에서 환자별 첫 연락일이 달라진 경우. 유예·간격을 바꾼 효과는 건수보다 '언제 처음 연락하나'에 먼저 드러난다. */
export interface FirstContactChange {
  patientId: string;
  before: LocalDate | null;
  after: LocalDate | null;
}

export function firstContactChanges(before: DailyListing[], after: DailyListing[]): FirstContactChange[] {
  const first = (xs: DailyListing[]) => {
    const m = new Map<string, LocalDate>();
    for (const d of xs) for (const id of d.ids) if (!m.has(id)) m.set(id, d.date);
    return m;
  };
  const b = first(before);
  const a = first(after);
  const ids = [...new Set([...b.keys(), ...a.keys()])].sort();
  return ids.filter((id) => b.get(id) !== a.get(id)).map((id) => ({ patientId: id, before: b.get(id) ?? null, after: a.get(id) ?? null }));
}

export interface TodayDiff {
  beforeCount: number;
  afterCount: number;
  added: string[];
  removed: string[];
  /** 두 쪽 모두 있지만 이유가 달라진 환자. */
  changed: { patientId: string; before: Reason[]; after: Reason[] }[];
  escalationsBefore: number;
  escalationsAfter: number;
}

function reasonsById(list: TodayList): Map<string, Reason[]> {
  const m = new Map<string, Reason[]>();
  for (const g of list.groups) for (const r of g.rows) m.set(r.patientId, r.reasons);
  return m;
}

export function diffToday(before: TodayList, after: TodayList): TodayDiff {
  const b = reasonsById(before);
  const a = reasonsById(after);
  const sorted = (xs: string[]) => [...xs].sort();
  return {
    beforeCount: b.size,
    afterCount: a.size,
    added: sorted([...a.keys()].filter((id) => !b.has(id))),
    removed: sorted([...b.keys()].filter((id) => !a.has(id))),
    changed: sorted([...a.keys()].filter((id) => b.has(id) && b.get(id)!.join() !== a.get(id)!.join())).map((id) => ({ patientId: id, before: b.get(id)!, after: a.get(id)! })),
    escalationsBefore: before.escalations.length,
    escalationsAfter: after.escalations.length,
  };
}

export const FORECAST_ASSUMPTIONS = [
  "오늘 이후 예정된 내원은 예정일에 온다고 가정",
  "이미 미방문이거나 유예 중인 환자는 오지 않고, 연락하면 늘 부재라고 가정",
  "목록에 오른 줄은 그날 모두 연락하고, 휴진일에는 연락하지 않음",
];

export type SimulationResult =
  | {
      ok: true;
      rules: Rules;
      today: TodayDiff;
      before: TodayList;
      after: TodayList;
      forecast: { date: LocalDate; before: number; after: number }[];
      forecastTotal: { before: number; after: number };
      firstContact: FirstContactChange[];
      assumptions: string[];
    }
  | { ok: false; errors: string[] };

export function simulate(patients: Patient[], engine: Engine, nowMs: number, change: RuleChange, days = 30): SimulationResult {
  const next = applyRuleChange(engine.rules, change);
  if (!next.ok) return { ok: false, errors: next.errors };
  const changed = withRules(engine, next.rules);
  // 규칙 검증을 통과해도 날짜로 보면 시점 순서가 뒤집히는 값이 있다(개월 수를 줄여 4주보다 앞서게 되는 수술일).
  // buildSchedule이 던지는 그 오류를 화면이 멈추는 대신 "이 값은 쓸 수 없음"으로 돌려준다.
  try {
    return run(patients, engine, changed, next.rules, nowMs, days);
  } catch (e) {
    return { ok: false, errors: [(e as Error).message] };
  }
}

function run(patients: Patient[], engine: Engine, changed: Engine, rules: Rules, nowMs: number, days: number): SimulationResult {
  const before = buildToday(patients, engine, nowMs);
  const after = buildToday(patients, changed, nowMs);
  const fb = forecastListings(patients, engine, nowMs, days);
  const fa = forecastListings(patients, changed, nowMs, days);
  const forecast = fb.map((d, i) => ({ date: d.date, before: d.count, after: fa[i].count }));
  return {
    ok: true,
    rules,
    today: diffToday(before, after),
    before,
    after,
    forecast,
    forecastTotal: { before: fb.reduce((n, d) => n + d.count, 0), after: fa.reduce((n, d) => n + d.count, 0) },
    firstContact: firstContactChanges(fb, fa),
    assumptions: FORECAST_ASSUMPTIONS,
  };
}
