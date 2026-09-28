/**
 * 규칙 바꿔 보기(PRD F9)에서 고를 수 있는 규칙 값. 값 하나만 바꾼다 — 둘 이상을 한꺼번에 바꾸면 어느 값 때문에 목록이 달라졌는지 가를 수 없다.
 * 지금 값은 볼트 D01에서 읽는다(여기에 숫자를 적지 않는다). 계산은 core/simulate가 하고, 볼트 원본은 바뀌지 않는다.
 */

import type { Rules } from "@/core/rules";
import type { RuleChange } from "@/core/simulate";
import type { DailyCount } from "@/core/simulate";

export interface SimOption {
  id: string;
  label: string;
  unit: "일" | "회" | "개월";
  min: number;
  max: number;
  hint: string;
  change: (value: number) => RuleChange;
  current: (rules: Rules) => number;
}

function fixedPoint(rules: Rules, key: string) {
  const r = rules.procedures["hair-transplant"];
  const p = r.type === "fixed" ? r.points.find((x) => x.key === key) : undefined;
  if (!p) throw new Error(`D01 모발이식에 시점 ${key}가 없습니다`);
  return p;
}

function series(rules: Rules) {
  const r = rules.procedures.injection;
  if (r.type !== "series") throw new Error("D01 두피 주사가 회차 규칙이 아닙니다");
  return r;
}

export const SIM_OPTIONS: SimOption[] = [
  {
    id: "grace-m6",
    label: "미방문 유예 — 6개월 경과 진료",
    unit: "일",
    min: 0,
    max: 21,
    hint: "6개월 경과 진료 예정일 뒤 며칠까지 기다렸다가 '예정일 지남'으로 볼지",
    change: (value) => ({ field: "graceDays", procedure: "hair-transplant", key: "m6", value }),
    current: (r) => fixedPoint(r, "m6").graceDays,
  },
  {
    id: "grace-w4",
    label: "미방문 유예 — 4주 진료",
    unit: "일",
    min: 0,
    max: 21,
    hint: "4주 경과 진료 예정일 뒤 며칠까지 기다릴지",
    change: (value) => ({ field: "graceDays", procedure: "hair-transplant", key: "w4", value }),
    current: (r) => fixedPoint(r, "w4").graceDays,
  },
  {
    id: "grace-inj",
    label: "미방문 유예 — 두피 주사 회차",
    unit: "일",
    min: 0,
    max: 10,
    hint: "주사 회차 예정일 뒤 며칠까지 '재예약'으로 두고, 그 뒤 '예정일 지남'으로 볼지",
    change: (value) => ({ field: "graceDays", procedure: "injection", key: "*", value }),
    current: (r) => series(r).graceDays,
  },
  {
    id: "retry",
    label: "재연락 간격",
    unit: "일",
    min: 1,
    max: 14,
    hint: "미방문 환자에게 연락한 뒤 며칠 지나 다시 목록에 올릴지",
    change: (value) => ({ field: "retryIntervalDays", value }),
    current: (r) => r.retryIntervalDays,
  },
  {
    id: "max-attempts",
    label: "최대 시도",
    unit: "회",
    min: 1,
    max: 8,
    hint: "미방문 연락을 몇 번까지 하고 원장 확인으로 넘길지",
    change: (value) => ({ field: "maxAttempts", value }),
    current: (r) => r.maxAttempts,
  },
  {
    id: "m6-months",
    label: "6개월 경과 진료의 개월 수",
    unit: "개월",
    // 1개월은 4주(28일) 시점과 날짜가 겹치거나 앞서는 수술일이 있어 쓸 수 없다(시점 순서 검사), 12개월은 1년 경과 진료와 겹친다.
    min: 2,
    max: 11,
    hint: "수술 몇 개월 뒤를 경과 진료로 볼지(월말 규칙 그대로)",
    change: (value) => ({ field: "offsetMonths", procedure: "hair-transplant", key: "m6", value }),
    current: (r) => {
      const p = fixedPoint(r, "m6");
      if (p.offset.unit !== "months") throw new Error("D01 6개월 경과 진료가 개월 단위가 아닙니다");
      return p.offset.n;
    },
  },
];

export function simOption(id: string): SimOption {
  return SIM_OPTIONS.find((o) => o.id === id) ?? SIM_OPTIONS[0];
}

/** 입력칸의 글자 → 정수 값. 범위 밖·정수 아님은 null(계산하지 않고 알린다). */
export function parseSimValue(raw: string, o: SimOption): number | null {
  if (!/^-?\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= o.min && n <= o.max ? n : null;
}

export interface ForecastBar {
  date: string;
  before: number;
  after: number;
  delta: number;
  closed: boolean;
  /** 막대 길이(0~100). 두 쪽 중 가장 큰 날을 100으로. */
  beforePct: number;
  afterPct: number;
}

/** 30일 막대. 휴진일(모두 0이고 달력상 휴진)은 closed로 표시해 '0건'과 '쉬는 날'을 구분한다. */
export function forecastBars(rows: { date: string; before: number; after: number }[], closed: (date: string) => boolean): ForecastBar[] {
  const max = Math.max(1, ...rows.flatMap((r) => [r.before, r.after]));
  return rows.map((r) => ({
    date: r.date,
    before: r.before,
    after: r.after,
    delta: r.after - r.before,
    closed: closed(r.date),
    beforePct: (r.before / max) * 100,
    afterPct: (r.after / max) * 100,
  }));
}

export type { DailyCount };
