/**
 * 화면이 쓰는 데이터 입구. 번들(scripts/build-bundle.mjs가 원본에서 만든 JSON)을 읽고, 볼트 원문으로 엔진(규칙·달력)을 한 번 만든다.
 * 판단은 모두 src/core의 순수 함수가 한다. 여기서는 묶어서 넘기기만 한다.
 *
 * 볼트 규칙이나 환자 파일이 깨졌으면 조용히 빈 목록을 그리지 않고 오류를 돌려준다(PRD F2: 기본값을 채우지 않는다).
 * 화면은 그 오류를 그대로 보인다.
 */

import raw from "@/generated/bundle.json";
import { loadEngine, type Engine } from "@/core/engine";
import { parsePatients, type Patient } from "@/core/patient";
import { DEMO_NOW, DEMO_TODAY } from "./clock";

export interface ExpectedPoint {
  key: string;
  kind?: string;
  nominal: string;
  /** 허용 범위 안에 진료일이 없으면 null. */
  due: string | null;
  shiftDirection: "none" | "later" | "earlier" | "unresolved";
  shifted: { from: string; reason: string }[];
  monthEndClamped: boolean;
  windowStart?: string;
  graceEnd?: string | null;
  status?: string;
  bookedDate?: string;
  restart?: boolean;
  visitDate?: string;
  reminderDay?: string;
  overdueSince?: string;
  holidayUnverified?: boolean;
}

export interface ExpectedOverdue {
  state: "listed" | "waiting" | "nurse-review";
  since: string;
  attempts: number;
  lastContact: string | null;
  retryOn: string | null;
  points: string[];
  daysPastDue: number;
  nurseCauses: string[];
}

export interface ExpectedPatient {
  id: string;
  procedure: string;
  startDate: string;
  todayReasons: string[];
  overdue: ExpectedOverdue | null;
  nurse: string[];
  optedOut: boolean;
  medicalReview: { at: string }[];
  points: ExpectedPoint[];
}

export interface Expected {
  _status: string;
  asOf: string;
  contactWindowAtAsOf: string;
  contactWindowChecks: { time: string; expected: "send-now" | "send-later" }[];
  todayList: { id: string; reasons: string[] }[];
  nurseReview: { id: string; causes: string[] }[];
  waitingRetry: { id: string; retryOn: string }[];
  medicalReview: string[];
  optedOut: { id: string; held: string[]; heldNurse: string[] }[];
  patients: ExpectedPatient[];
  hypotheticals: Hypothetical[];
}

export interface Planted {
  id: string;
  procedure: string;
  startDate: string;
  cats: string[];
  expectReasons: string[];
  expectOverdue: "listed" | "waiting" | "nurse-review" | "opted-out" | null;
  expectMedicalReview: boolean;
  expectNurse: string[];
  expectOptOut: boolean;
  story: string;
}

export interface MutationRecord {
  _note: string;
  runs: { date: string; label: string; tests: number }[];
  families: { id: string; name: string }[];
  /** run1이 null이면 1차 뒤에 더한 변이다(2차에만 돌림). */
  mutants: { id: string; family: string; desc: string; run1: { killed: boolean; failedTests: number } | null; run2: { killed: boolean; failedTests: number } }[];
}

export type Hypothetical = { id: string; procedure: string; startDate: string; note: string; points: ExpectedPoint[] };

/** 화면 번들(모든 화면이 내려받음). 기대값 전체·심은 사례·변이 기록은 평가 번들(src/demo/evalData.ts)에 따로 있다. */
export interface Bundle {
  asOf: string;
  vaultFiles: { path: string; raw: string }[];
  patients: unknown;
  hypotheticals: Hypothetical[];
}

export interface ScreenMutationRecord {
  _note: string;
  date: string;
  firstRun: { total: number; killed: number; survivors: string[] };
  mutants: { id: string; desc: string; file: string; killed: boolean; by: string[] }[];
}

export interface EvalBundle {
  expected: Expected;
  planted: Planted[];
  mutation: MutationRecord;
  mutationScreen: ScreenMutationRecord;
  /** v0.2.1 규칙(휴진 이동 범위·수신 거부·예약·재시작·명칭) 변이 기록. 코어 기록(mutation)은 v0.2 코드 기준이라 따로 싣는다. */
  mutationRules: MutationRecord;
}

export const bundle = raw as unknown as Bundle;

export type Demo = { ok: true; engine: Engine; patients: Patient[] } | { ok: false; errors: string[] };

let cached: Demo | null = null;

export function demo(): Demo {
  if (cached) return cached;
  const errors: string[] = [];
  // 번들의 기준 시각이 화면 시계와 다르면 기대값·화면이 서로 다른 날을 말한다. 어긋나면 멈춘다.
  if (bundle.asOf !== DEMO_NOW) errors.push(`번들 기준 시각(${bundle.asOf})이 화면 기준 시각(${DEMO_NOW})과 다릅니다`);
  const e = loadEngine(bundle.vaultFiles, DEMO_TODAY);
  if (!e.ok) errors.push(...e.errors);
  const p = parsePatients(bundle.patients);
  if (!p.ok) errors.push(...p.errors);
  cached = errors.length > 0 || !e.ok || !p.ok ? { ok: false, errors } : { ok: true, engine: e.engine, patients: p.patients };
  return cached;
}

/** 화면용: 번들이 깨졌으면 던진다(오류 화면은 ErrorPanel이 demo()로 따로 그린다). */
export function mustDemo(): { engine: Engine; patients: Patient[] } {
  const d = demo();
  if (!d.ok) throw new Error(d.errors.join(" / "));
  return d;
}
