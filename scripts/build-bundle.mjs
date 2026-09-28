/**
 * 화면이 읽는 번들(src/generated/bundle.json)을 만든다. 정적 내보내기라 브라우저는 파일 시스템을 못 읽으므로,
 * 볼트 원문·합성 환자(화면 번들)와 기대값·심은 사례·변이 기록(평가 번들)을 두 파일로 묶어 빌드에 넣는다.
 *
 * 여기서는 **읽어서 묶기만** 한다. 검증과 계산은 화면이 src/core로 한다(볼트 json이 깨졌으면 화면이 멈추고 이유를 보인다).
 * 번들은 원본에서 늘 다시 만든다(predev·prebuild·pretest·pretypecheck) — 커밋하지 않으므로 원본과 어긋날 일이 없다.
 * 의존성 없이 node 표준 모듈만 쓴다.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const json = (p) => JSON.parse(read(p));

const vaultFiles = readdirSync(join(ROOT, "vault"))
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map((f) => ({ path: `vault/${f}`, raw: read(`vault/${f}`) }));

const expected = json("data/expected-schedule.json");

// 화면 번들: 모든 화면이 내려받는다(볼트 원문·합성 환자, 직접 해 보기용 가상 입력 기대값만).
const bundle = {
  // 시연 기준 시각. src/demo/clock.ts의 DEMO_NOW와 같아야 한다(시험으로 확인).
  asOf: "2026-09-21T09:00:00+09:00",
  vaultFiles,
  patients: json("data/patients.json"),
  hypotheticals: expected.hypotheticals,
};

// 평가 번들: 평가 화면(서버에서만 그림)과 시험만 읽는다. 기대값 전체·심은 사례·변이 기록이 모든 화면의 공유 청크에 실리지 않게 나눈다.
const evalBundle = {
  expected,
  planted: json("data/scripts/planted.json"),
  mutation: json("data/mutation-2026-09-28.json"),
  mutationScreen: json("data/mutation-screen-2026-09-28.json"),
};

mkdirSync(join(ROOT, "src/generated"), { recursive: true });
writeFileSync(join(ROOT, "src/generated/bundle.json"), JSON.stringify(bundle));
writeFileSync(join(ROOT, "src/generated/eval-bundle.json"), JSON.stringify(evalBundle));
console.log(`번들: 볼트 ${vaultFiles.length}편, 환자 ${bundle.patients.length}명 → src/generated/bundle.json (+ eval-bundle.json)`);
