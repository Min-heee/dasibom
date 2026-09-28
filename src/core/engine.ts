/**
 * 볼트 문서 → 계산에 쓰는 값 한 묶음(Engine).
 *
 * 규칙은 볼트의 승인 문서 json에서만 읽는다(PRD F2): 진료일(V02), 사후관리 연락 규정(D01), 적신호(V11), 광고 표현(V15).
 * 하나라도 없거나 깨지면 전체를 멈춘다 — 일부 규칙만으로 목록을 만들면 "빠진 규칙 때문에 빠진 환자"가 보이지 않는다.
 * 파일 읽기와 오늘 날짜(asOf)는 호출하는 쪽 몫이다.
 */

import { parseAdConfig, type AdConfig } from "./adcheck";
import { buildCalendar, parseClinicHours, type ClinicCalendar, type LocalDate } from "./calendar";
import { parseRedflagConfig, type RedflagConfig } from "./redflag";
import { parseRules, type Rules } from "./rules";
import { activeJson, loadVault } from "./vault";

export interface Engine {
  rules: Rules;
  calendar: ClinicCalendar;
  redflag: RedflagConfig;
  ad: AdConfig;
}

export type EngineResult = { ok: true; engine: Engine } | { ok: false; errors: string[] };

export const RULES_DOC_ID = "D01";

/** 규칙만 바꾼 엔진. 규칙 바꿔 보기(simulate)에서 공휴일 목록도 바뀐 규칙 쪽 값을 따르도록 달력을 다시 만든다. */
export function withRules(engine: Engine, rules: Rules): Engine {
  return { ...engine, rules, calendar: buildCalendar(engine.calendar, rules.holidays, rules.holidaysCoverage) };
}

export function loadEngine(files: { path: string; raw: string }[], asOf: LocalDate): EngineResult {
  const vault = loadVault(files, { asOf });
  const errors = [...vault.errors];

  const v02 = activeJson(vault, "V02");
  const d01 = activeJson(vault, RULES_DOC_ID);
  const v11 = activeJson(vault, "V11");
  const v15 = activeJson(vault, "V15");
  for (const j of [v02, d01, v11, v15]) if (!j.ok) errors.push(j.error);
  if (!v02.ok || !d01.ok || !v11.ok || !v15.ok) return { ok: false, errors };

  const hours = parseClinicHours(v02.value);
  const rules = parseRules(d01.value);
  const redflag = parseRedflagConfig(v11.value);
  const ad = parseAdConfig(v15.value);
  if (!hours.ok) errors.push(...hours.errors);
  if (!rules.ok) errors.push(...rules.errors.map((e) => `D01: ${e}`));
  if (!redflag.ok) errors.push(`V11: ${redflag.error}`);
  if (!ad.ok) errors.push(ad.error);
  if (errors.length > 0 || !hours.ok || !rules.ok || !redflag.ok || !ad.ok) return { ok: false, errors };

  return {
    ok: true,
    engine: {
      rules: rules.rules,
      calendar: buildCalendar(hours.hours, rules.rules.holidays, rules.rules.holidaysCoverage),
      redflag: redflag.config,
      ad: ad.config,
    },
  };
}
