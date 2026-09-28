/**
 * 평가(PRD 6절)를 번들에서 계산한다. 기대값 표(data/expected-schedule.json)는 파이썬 계산기가 앱 엔진을 쓰지 않고 만든 값이고,
 * **AI가 계산, 오너 검수 전**이다. 화면은 이 표시를 숨기지 않는다.
 *
 * 여기서는 엔진 결과를 기대값과 **글자 그대로** 맞춰 본다. 맞추는 방식(어느 필드를 어느 필드와 비교하나)만 정하고,
 * 판정 자체는 src/core를 그대로 부른다. 어긋나면 어느 환자·시점·필드가 어떻게 다른지 모두 돌려준다(못 미쳐도 그대로 싣는다).
 */

import { kstDateOf, kstInstant, kstMinuteOfDay, parseHhmm, prevOpenDay, type LocalDate } from "@/core/calendar";
import type { Engine } from "@/core/engine";
import { composeMessage, sendTiming, templateKeyFor, valuesForItem } from "@/core/message";
import type { Patient, Procedure } from "@/core/patient";
import { buildSchedule, type SchedulePoint } from "@/core/schedule";
import { contactDate, type PointStatus } from "@/core/status";
import { buildToday, evaluatePatient, type PatientDay, type TodayList } from "@/core/today";
import type { EvalBundle, ExpectedPoint, Hypothetical } from "./data";
import { isMonthEndClamped, messagesFor, noticeState } from "./view";

export interface Mismatch {
  group: string;
  target: string;
  field: string;
  expected: string;
  actual: string;
}

export interface CheckGroup {
  id: string;
  label: string;
  matched: number;
  total: number;
}

const show = (v: unknown) => (v === undefined || v === null ? "(없음)" : Array.isArray(v) ? `[${v.join(", ")}]` : String(v));

/** 엔진의 시점 상태를 기대값 표의 상태 이름으로. 안내 시점의 네 갈래는 view.noticeState(D01에 없는 구분, 표시·대조용). */
export function expectedStatusName(s: PointStatus, contacts: Patient["contacts"], today: LocalDate): string {
  switch (s.state) {
    case "done":
      return s.early ? "done-early" : "done";
    case "missed":
      return "overdue";
    case "notice":
      return noticeState(s, contacts, today);
    default:
      return s.state;
  }
}

type Field = [name: string, expected: unknown, actual: unknown];

/** 시점 하나를 필드별로 비교. 기대값 표에 없는 필드(가상 입력의 windowStart 등)는 비교하지 않는다. */
export function comparePoint(exp: ExpectedPoint, p: SchedulePoint | undefined, extra: { status?: PointStatus; contacts?: Patient["contacts"]; today: LocalDate; startDate: LocalDate; engine: Engine; prevOpen?: LocalDate | null }): Field[] {
  if (!p) return [["시점", exp.key, "(엔진에 없음)"]];
  const fields: Field[] = [
    ["원래 날짜", exp.nominal, p.originalDate],
    ["미룬 날짜", exp.due, p.dueDate],
    ["미룬 날 목록", exp.shifted.map((x) => x.from), p.skipped.map((x) => x.date)],
    ["월말 clamp", exp.monthEndClamped, isMonthEndClamped(p, extra.startDate, extra.engine.rules)],
    ["공휴일 미확인", exp.holidayUnverified === true, p.holidayUnknown],
  ];
  const s = extra.status;
  if (s) {
    // 안내 시점은 방문으로 완료하지 않으므로 '완료 인정 시작일'이 뜻이 없다. 기대값 표는 원래 날짜를, 엔진은 미룬 날짜를 적어
    // 휴진으로 밀린 안내 시점에서만 글자가 다르다(판정에는 쓰이지 않음). 내원·사진 시점만 비교한다.
    if (exp.windowStart !== undefined && p.kind !== "notice") fields.push(["완료 인정 시작일", exp.windowStart, s.windowStart]);
    if (exp.graceEnd !== undefined) fields.push(["유예 끝", exp.graceEnd, s.graceEnd]);
    if (exp.status !== undefined) fields.push(["상태", exp.status, expectedStatusName(s, extra.contacts ?? [], extra.today)]);
    fields.push(["방문일", exp.visitDate ?? null, s.state === "done" ? s.visit!.date : null]);
    fields.push(["지남 시작일", exp.overdueSince ?? null, s.state === "missed" ? (s.overdueSince ?? null) : null]);
    if (exp.reminderDay !== undefined) fields.push(["내일 내원 안내일", exp.reminderDay, extra.prevOpen ?? null]);
  }
  return fields;
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 직접 해 보기 입력이 기대값 표의 가상 입력(H1~H3)과 같으면 시점마다 대조한다. 평가 화면과 직접 해 보기가 같은 함수를 쓴다. */
export function checkHypothetical(h: Hypothetical, points: SchedulePoint[], engine: Engine, today: LocalDate): { matched: number; total: number; bad: Mismatch[] } {
  let matched = 0;
  const bad: Mismatch[] = [];
  for (const e of h.points) {
    const fields = comparePoint(e, points.find((x) => x.key === e.key), { today, startDate: h.startDate as LocalDate, engine });
    const wrong = fields.filter(([, a, b]) => !eq(a, b));
    if (wrong.length === 0) matched++;
    for (const [field, a, b] of wrong) bad.push({ group: "가상 입력", target: `${h.id} ${e.key}`, field, expected: show(a), actual: show(b) });
  }
  return { matched, total: h.points.length, bad };
}

export interface Evaluation {
  expectedStatus: string;
  groups: CheckGroup[];
  /** 일정 계산 정확도(PRD 6절): 시점 날짜·상태 + 가상 입력만. */
  accuracy: { matched: number; total: number };
  /** 기대값 대조 전체(일정 + 오늘 목록·세 목록·미방문 연락·시간대). */
  allChecks: { matched: number; total: number };
  mismatches: Mismatch[];
  missedOverdue: { missing: string[]; total: number; ids: string[] };
  planted: { caught: number; total: number; wrong: { id: string; story: string; problems: string[] }[] };
  determinism: { differing: number; runs: number };
  /** violations = 엔진 판정 위반 + 화면 배지 위반(messagesFor가 만든 '지금 보내기' 배지가 시간대 밖에 뜬 분). */
  window: { violations: number; engineViolations: number; screenViolations: number; minutes: number; expectedChecks: { time: string; expected: string; actual: string }[]; messages: { total: number; now: number; blocked: number } };
  mutation: { run1: { killed: number; total: number }; run2: { killed: number; total: number }; survivors1: { id: string; desc: string }[]; survivors2: { id: string; desc: string }[]; families: { id: string; name: string; total: number; killed1: number; killed2: number }[]; runs: EvalBundle["mutation"]["runs"] };
  todayCount: number;
}

export function evaluateBundle(bundle: EvalBundle, engine: Engine, patients: Patient[], nowMs: number): Evaluation {
  const exp = bundle.expected;
  const today = kstDateOf(nowMs);
  const mismatches: Mismatch[] = [];
  const groups: CheckGroup[] = [];
  const byId = new Map(patients.map((p) => [p.id, p]));
  const days = new Map<string, PatientDay>();
  const dayOf = (id: string) => {
    if (!days.has(id)) days.set(id, evaluatePatient(byId.get(id)!, engine, nowMs));
    return days.get(id)!;
  };

  // 1) 50명의 시점별 날짜·상태
  {
    let matched = 0;
    let total = 0;
    for (const ep of exp.patients) {
      const p = byId.get(ep.id);
      if (!p) {
        total += ep.points.length;
        mismatches.push({ group: "시점", target: ep.id, field: "환자", expected: ep.id, actual: "(환자 파일에 없음)" });
        continue;
      }
      const day = dayOf(ep.id);
      const statusByKey = new Map(day.statuses.map((s) => [s.point.key, s]));
      for (const e of ep.points) {
        total++;
        const s = statusByKey.get(e.key);
        const prevOpen = s && s.state === "upcoming" ? prevOpenOrNull(s.point, engine) : null;
        const fields = comparePoint(e, s?.point, { status: s, contacts: p.contacts, today, startDate: p.startDate, engine, prevOpen });
        const bad = fields.filter(([, a, b]) => !eq(a, b));
        if (bad.length === 0) matched++;
        for (const [field, a, b] of bad) mismatches.push({ group: "시점", target: `${ep.id} ${e.key}`, field, expected: show(a), actual: show(b) });
      }
      // 엔진에만 있는 시점(기대값 표에 없는 시점)도 틀린 것으로 센다.
      for (const s of day.statuses) {
        if (!ep.points.some((e) => e.key === s.point.key)) {
          total++;
          mismatches.push({ group: "시점", target: `${ep.id} ${s.point.key}`, field: "시점", expected: "(기대값에 없음)", actual: s.point.key });
        }
      }
    }
    groups.push({ id: "points", label: `시점 날짜·상태 (환자 ${exp.patients.length}명)`, matched, total });
  }

  // 2) 가상 입력 H1~H3(직접 해 보기)
  {
    let matched = 0;
    let total = 0;
    for (const h of exp.hypotheticals) {
      const pts = buildSchedule({ procedure: h.procedure as Procedure, startDate: h.startDate as LocalDate, visits: [] }, today, engine.rules, engine.calendar);
      const c = checkHypothetical(h, pts, engine, today);
      matched += c.matched;
      total += c.total;
      mismatches.push(...c.bad);
    }
    groups.push({ id: "hypotheticals", label: `가상 입력 ${exp.hypotheticals.map((h) => h.id).join("·")} 시점`, matched, total });
  }

  // 3) 오늘 목록(120명 전체) — 줄마다 환자와 이유
  const list = buildToday(patients, engine, nowMs);
  const rows = new Map(list.groups.flatMap((g) => g.rows.map((r) => [r.patientId, r.reasons as string[]] as const)));
  {
    let matched = 0;
    const ids = new Set([...exp.todayList.map((x) => x.id), ...rows.keys()]);
    for (const id of [...ids].sort()) {
      const e = exp.todayList.find((x) => x.id === id)?.reasons ?? null;
      const a = rows.get(id) ?? null;
      if (eq(e, a)) matched++;
      else mismatches.push({ group: "오늘 목록", target: id, field: "이유", expected: show(e ?? "목록에 없음"), actual: show(a ?? "목록에 없음") });
    }
    groups.push({ id: "today", label: `오늘 목록 (기대 ${exp.todayList.length}줄)`, matched, total: ids.size });
  }

  // 4) 원장 확인·재연락 대기·의료진 확인
  const setCheck = (id: string, label: string, e: string[], a: string[]) => {
    const all = [...new Set([...e, ...a])].sort();
    let matched = 0;
    for (const x of all) {
      if (e.includes(x) && a.includes(x)) matched++;
      else mismatches.push({ group: label, target: x.split("|")[0], field: label, expected: e.includes(x) ? x.replace("|", " ") : "(없음)", actual: a.includes(x) ? x.replace("|", " ") : "(없음)" });
    }
    groups.push({ id, label: `${label} (기대 ${e.length}명)`, matched, total: all.length });
  };
  setCheck("director", "원장 확인", exp.directorReview, list.escalations.map((r) => r.patientId));
  setCheck("waiting", "재연락 대기", exp.waitingRetry.map((w) => `${w.id}|${w.retryOn}부터`), list.waiting.map((w) => `${w.patientId}|${w.overdue.retryOn}부터`));
  setCheck("medical", "의료진 확인", exp.medicalReview, list.clinicianReview.map((r) => r.patientId));

  // 5) 미방문 연락 상태(지남 시작일·센 연락 수·마지막 연락·다시 올릴 날·지난 일수)
  {
    let matched = 0;
    let total = 0;
    for (const ep of exp.patients) {
      if (!byId.has(ep.id)) continue;
      total++;
      const o = dayOf(ep.id).overdue;
      const e = ep.overdue;
      const actual = o
        ? {
            state: o.action === "escalate" ? "director-review" : o.action === "waiting" ? "waiting" : "listed",
            since: o.since,
            attempts: o.attempts,
            lastContact: o.lastContact ? contactDate(o.lastContact) : null,
            // 기대값 표는 연락이 없었거나 원장 확인이면 다시 올릴 날을 비워 둔다.
            retryOn: o.attempts === 0 || o.action === "escalate" ? null : o.retryOn,
            points: o.missed.map((s) => s.point.key),
            daysPastDue: Math.max(...o.missed.map((s) => s.daysPastDue ?? 0)),
          }
        : null;
      const expected = e ? { state: e.state, since: e.since, attempts: e.attempts, lastContact: e.lastContact, retryOn: e.retryOn, points: e.points, daysPastDue: e.daysPastDue } : null;
      if (eq(expected, actual)) matched++;
      else if (!expected || !actual) mismatches.push({ group: "미방문 연락", target: ep.id, field: "미방문", expected: show(expected ? expected.state : null), actual: show(actual ? actual.state : null) });
      else
        for (const k of Object.keys(expected) as (keyof typeof expected)[]) {
          if (!eq(expected[k], actual[k])) mismatches.push({ group: "미방문 연락", target: ep.id, field: k, expected: show(expected[k]), actual: show(actual[k]) });
        }
    }
    groups.push({ id: "overdue", label: "미방문 연락 상태 (환자별)", matched, total });
  }

  // 6) 연락 가능 시간대: 기대값 표의 다섯 시각
  const start = parseHhmm(engine.rules.contactWindow.start)!;
  const end = parseHhmm(engine.rules.contactWindow.end)!;
  const expectedChecks = exp.contactWindowChecks.map((c) => {
    const t = sendTiming(kstInstant(today, c.time), engine.rules.contactWindow);
    return { time: c.time, expected: c.expected, actual: t.mode === "now" ? "send-now" : "send-later" };
  });
  {
    const matched = expectedChecks.filter((c) => c.expected === c.actual).length;
    for (const c of expectedChecks) if (c.expected !== c.actual) mismatches.push({ group: "연락 시간대", target: c.time, field: "보내기", expected: c.expected, actual: c.actual });
    groups.push({ id: "window", label: "연락 가능 시간대 (기대값 표의 시각)", matched, total: expectedChecks.length });
  }

  const sum = (gs: CheckGroup[]) => gs.reduce((a, g) => ({ matched: a.matched + g.matched, total: a.total + g.total }), { matched: 0, total: 0 });
  // PRD 6절 '일정 계산 정확도'는 일정(시점 날짜·상태, 가상 입력)만 센다. 목록·연락 상태 대조까지 합치면 이름과 분모가 어긋난다.
  const accuracy = sum(groups.filter((g) => g.id === "points" || g.id === "hypotheticals"));
  const allChecks = sum(groups);

  // 미방문 누락: 심은 미방문 사례가 제자리(목록·대기·원장 확인)에 있는가
  const overduePlanted = bundle.planted.filter((p) => p.expectOverdue !== null);
  const placeOf = (id: string): string | null => {
    if (list.escalations.some((r) => r.patientId === id)) return "director-review";
    if (list.waiting.some((r) => r.patientId === id)) return "waiting";
    if (rows.get(id)?.includes("overdue")) return "listed";
    return null;
  };
  const missing = overduePlanted.filter((p) => placeOf(p.id) !== p.expectOverdue).map((p) => p.id);

  // 심은 사례 전체(45건): 오늘 이유·미방문 상태·의료진 확인이 의도와 같은가
  const wrong: Evaluation["planted"]["wrong"] = [];
  for (const p of bundle.planted) {
    const problems: string[] = [];
    const reasons = rows.get(p.id) ?? [];
    if (!eq(reasons, p.expectReasons)) problems.push(`오늘 이유: 기대 ${show(p.expectReasons)} / 엔진 ${show(reasons)}`);
    const place = placeOf(p.id);
    if (place !== p.expectOverdue) problems.push(`미방문: 기대 ${show(p.expectOverdue)} / 엔진 ${show(place)}`);
    const med = list.clinicianReview.some((r) => r.patientId === p.id);
    if (med !== p.expectMedicalReview) problems.push(`의료진 확인: 기대 ${p.expectMedicalReview ? "예" : "아니오"} / 엔진 ${med ? "예" : "아니오"}`);
    if (problems.length > 0) wrong.push({ id: p.id, story: p.story, problems });
  }

  // 결정성: 두 번 만들기, 입력 뒤집기, 입력 돌리기 — 모두 첫 목록과 같아야 한다.
  const again: TodayList[] = [buildToday(patients, engine, nowMs), buildToday([...patients].reverse(), engine, nowMs), buildToday([...patients.slice(37), ...patients.slice(0, 37)], engine, nowMs)];
  const first = JSON.stringify(list);
  const differing = again.filter((l) => JSON.stringify(l) !== first).length;

  // 연락 가능 시간대 위반: 그날 1,440분 모두에서 '지금 보내기'가 시간대 밖에 나오지 않는가(D01 값으로 따로 판정해 대조).
  // 화면 쪽도 잰다: 환자 화면이 그리는 배지(view.messagesFor의 send)가 시간대 밖에 '지금 보내기'를 달면 위반.
  // 엔진만 재면 배지 색·글자를 화면이 따로 정하다 틀려도 0건이 나온다.
  const sampleItems = list.groups.flatMap((g) => g.rows).flatMap((r) => r.items);
  let engineViolations = 0;
  let screenViolations = 0;
  for (let m = 0; m < 1440; m++) {
    const ms = kstInstant(today, "00:00") + m * 60_000;
    const inside = kstMinuteOfDay(ms) >= start && kstMinuteOfDay(ms) < end;
    const t = sendTiming(ms, engine.rules.contactWindow);
    if (t.mode === "now" && !inside) engineViolations++;
    if (t.mode === "scheduled") {
      const at = Date.parse(t.scheduledSendAt);
      const atMin = kstMinuteOfDay(at);
      if (at <= ms || atMin < start || atMin >= end) engineViolations++;
    }
    const shown = messagesFor(sampleItems, engine, ms).map((v) => v.send);
    if (shown.some((b) => b !== null && b.label.startsWith("지금 보내기") !== inside && !b.label.startsWith("보내기 막힘"))) screenViolations++;
  }
  const violations = engineViolations + screenViolations;
  // 오늘 목록의 문구 전부(기준 시각에 만든 문구)
  let total = 0;
  let now = 0;
  let blocked = 0;
  for (const g of list.groups)
    for (const r of g.rows)
      for (const it of r.items) {
        const m = composeMessage({ templateKey: templateKeyFor(it), values: valuesForItem(it, engine.rules, engine.calendar), rules: engine.rules, ad: engine.ad, nowMs });
        total++;
        if (!m.ok || !m.sendable) blocked++;
        else if (m.timing.mode === "now") now++;
      }

  // 변이 기록
  const mut = bundle.mutation;
  const fam = mut.families.map((f) => {
    const ms = mut.mutants.filter((m) => m.family === f.id);
    return { id: f.id, name: f.name, total: ms.length, killed1: ms.filter((m) => m.run1.killed).length, killed2: ms.filter((m) => m.run2.killed).length };
  });

  return {
    expectedStatus: exp._status,
    groups,
    accuracy,
    allChecks,
    mismatches,
    missedOverdue: { missing, total: overduePlanted.length, ids: overduePlanted.map((p) => p.id) },
    planted: { caught: bundle.planted.length - wrong.length, total: bundle.planted.length, wrong },
    determinism: { differing, runs: again.length },
    window: { violations, engineViolations, screenViolations, minutes: 1440, expectedChecks, messages: { total, now, blocked } },
    mutation: {
      run1: { killed: mut.mutants.filter((m) => m.run1.killed).length, total: mut.mutants.length },
      run2: { killed: mut.mutants.filter((m) => m.run2.killed).length, total: mut.mutants.length },
      survivors1: mut.mutants.filter((m) => !m.run1.killed).map((m) => ({ id: m.id, desc: m.desc })),
      survivors2: mut.mutants.filter((m) => !m.run2.killed).map((m) => ({ id: m.id, desc: m.desc })),
      families: fam,
      runs: mut.runs,
    },
    todayCount: rows.size,
  };
}

/** 예정(upcoming) 내원 시점의 '내일 내원' 안내일 = 바로 전 진료일. 안내 시점에는 없다. */
function prevOpenOrNull(p: SchedulePoint, engine: Engine): LocalDate | null {
  if (p.kind === "notice") return null;
  // core/calendar.prevOpenDay를 그대로 쓴다(today.ts가 '내일 내원'을 가를 때 쓰는 것과 같은 함수).
  return prevOpen(p.dueDate, engine);
}

const prevOpen = (d: LocalDate, engine: Engine) => prevOpenDay(d, engine.calendar);
