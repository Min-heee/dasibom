import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { localDate, parseInstant } from "../calendar";
import { loadEngine, type Engine } from "../engine";

/**
 * 테스트 전용: 작은 볼트 픽스처를 읽는다.
 * 저장소 루트의 vault/·data/ 는 다른 작업이 쓰는 중이라 테스트가 기대지 않는다(값이 바뀌어도 코어 테스트가 흔들리지 않게).
 */
const DIR = join(fileURLToPath(new URL(".", import.meta.url)), "vault");

export function fixtureFiles(): { path: string; raw: string }[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => ({ path: f, raw: readFileSync(join(DIR, f), "utf8") }));
}

export function fixture(name: string): { path: string; raw: string } {
  return { path: name, raw: readFileSync(join(DIR, name), "utf8") };
}

/** 시연 기준 시각: 2026-09-21(월) 09:00 KST. 그 주 목~토(9/24~26)가 추석 연휴다. */
export const NOW = parseInstant("2026-09-21T09:00:00+09:00");
export const TODAY = localDate("2026-09-21");

export function at(iso: string): number {
  return parseInstant(iso);
}

export function fixtureEngine(): Engine {
  const r = loadEngine(fixtureFiles(), TODAY);
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.engine;
}
