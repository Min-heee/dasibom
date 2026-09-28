import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * PRD F3: 엔진은 시계를 직접 읽지 않는다(기준 시각은 인자). 코드 리뷰로만 지키면 언젠가 한 줄이 샌다.
 * src/core·src/demo·src/app 아래 모든 파일(테스트·픽스처 제외)에 시계를 읽는 호출이 없는지 글자로 확인한다.
 * 화면(src/app)까지 보는 이유: 띠나 규칙 바꿔 보기가 Date()를 읽어도 시험·타입·빌드가 모두 통과한 적이 있다(적대 검토 S6a·S6b).
 *
 * 글자 검사는 우회형(`+new Date`, `const D = Date; D.now()`)을 다 잡지 못한다. 그래서 두 겹으로 둔다:
 * 1) 여기서 우회형까지 넓게 막고, 2) vitest.setup.ts가 시험 중 시계를 먼 날(2031년)로 고정해
 *    시계를 읽는 코드가 있으면 9/21 기준 기대값이 모두 어긋나게 한다(동작 검사).
 */
const SRC = fileURLToPath(new URL("..", import.meta.url));
const ROOTS = ["core", "demo", "app"].map((d) => join(SRC, d));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "__fixtures__" ? [] : walk(p);
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}

const CLOCK_PATTERNS: [RegExp, string][] = [
  [/Date\.now\b/, "Date.now"],
  [/new\s+Date\s*\(\s*\)/, "new Date()"],
  [/new\s+Date\b(?!\s*\()/, "인자 없는 new Date"],
  [/[=:(,]\s*Date\s*[;,)]/, "Date 별칭"],
  [/\bDate\s*\[/, "Date[...]"],
  // new 없이 부른 Date()는 지금 시각 글자를 돌려준다. new Date(ms)는 막지 않는다.
  [/(?<!new\s+)(?<![.\w])Date\s*\(/, "Date()"],
  [/\b(globalThis|window|self)\s*\.\s*Date\b/, "globalThis.Date"],
  [/performance\.now\b/, "performance.now"],
  [/Math\.random\b/, "Math.random"],
];

describe("코어·화면은 시계를 읽지 않는다", () => {
  const files = ROOTS.flatMap(walk).map((p) => relative(SRC, p));

  it("검사할 파일이 있다(경로가 틀려 0개를 검사하고 통과하지 않게)", () => {
    expect(files.some((f) => f.startsWith("app/"))).toBe(true);
    expect(files.some((f) => f.startsWith("demo/"))).toBe(true);
  });

  it.each(files)("%s", (f) => {
    const src = readFileSync(join(SRC, f), "utf8");
    for (const [re, name] of CLOCK_PATTERNS) expect(re.test(src), `${f}: ${name}`).toBe(false);
  });

  it("검사식이 우회형을 실제로 잡는다", () => {
    const hit = (s: string) => CLOCK_PATTERNS.some(([re]) => re.test(s));
    for (const s of ["Date.now()", "const f = Date.now;", "new Date()", "+new Date;", "kstDateOf(+new Date)", "const D = Date;", "Date['now']()", "Math.random()", "bandText(Date.parse(Date()))", "globalThis.Date.now()", "Reflect.construct(Date, [])"]) expect(hit(s), s).toBe(true);
    for (const s of ["new Date(ms + KST_OFFSET_MS)", "Date.UTC(y, m - 1, day)", "Date.parse(s)", "type LocalDate = string"]) expect(hit(s), s).toBe(false);
  });

  it("시험 중 시계는 2031년으로 고정돼 있다(vitest.setup.ts) — 시계를 읽는 코드는 기대값에서 어긋난다", () => {
    expect(new Date().getUTCFullYear()).toBe(2031);
  });
});
