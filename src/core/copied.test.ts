import { describe, expect, it } from "vitest";
import { checkAdExpressions } from "./adcheck";
import { loadEngine } from "./engine";
import { parseVaultFile } from "./vault";
import { fixtureEngine, fixtureFiles, TODAY } from "./__fixtures__/load";

/** 한창구에서 복사한 볼트·광고 검사가 다시봄 볼트에서도 그대로 도는지. 원본 동작 자체의 시험은 한창구에 있다. */

describe("vault — 다시봄 문서 ID", () => {
  const fm = (id: string) => `---\nid: ${id}\ntitle: t\ntype: policy\nversion: 1\nstatus: approved\neffective: 2026-09-01\nowner: 원무팀\nfictional: true\n---\n본문\n`;
  it("V01 꼴과 D01 꼴을 받고, 다른 접두어는 거부한다", () => {
    expect(parseVaultFile("a.md", fm("D01")).ok).toBe(true);
    expect(parseVaultFile("a.md", fm("V02")).ok).toBe(true);
    expect(parseVaultFile("a.md", fm("X01"))).toEqual({ ok: false, path: "a.md", errors: ["id 형식이 틀렸습니다: X01"] });
  });
});

describe("adcheck — V15 픽스처", () => {
  it("금지 표현은 banned, 주의 표현은 warn(공백을 무시하고 찾는다)", () => {
    const { ad } = fixtureEngine();
    expect(checkAdExpressions("효과가 100 % 입니다", ad).hits.map((h) => [h.level, h.matchedText])).toEqual([
      ["warn", "효과"],
      ["banned", "100 %"],
    ]);
    expect(checkAdExpressions("내원 예정입니다", ad).level).toBe("clean");
  });
});

describe("loadEngine — 규칙은 승인 문서 json에서만", () => {
  it("픽스처 볼트로 엔진을 만든다", () => {
    expect(loadEngine(fixtureFiles(), TODAY).ok).toBe(true);
  });

  it("D01이 초안이면 멈춘다(미승인 규칙으로 목록을 만들지 않는다)", () => {
    const files = fixtureFiles().map((f) => (f.path === "followup-policy.md" ? { ...f, raw: f.raw.replace("status: approved", "status: draft") } : f));
    expect(loadEngine(files, TODAY)).toEqual({ ok: false, errors: ["D01: 승인된 문서가 없습니다"] });
  });

  it("D01이 시행 전이면 멈춘다", () => {
    const r = loadEngine(fixtureFiles(), "2026-08-31" as typeof TODAY);
    expect(r).toEqual({ ok: false, errors: ["D01: 승인된 문서가 없습니다"] });
  });

  it("V02가 없거나 D01 json이 깨지면 모든 오류를 모아 멈춘다", () => {
    const files = fixtureFiles()
      .filter((f) => f.path !== "hours-location.md")
      .map((f) => (f.path === "followup-policy.md" ? { ...f, raw: f.raw.replace('"maxAttempts": 3,', '"maxAttempts": 3') } : f));
    const r = loadEngine(files, TODAY);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]).toBe("V02: 승인된 문서가 없습니다");
      expect(r.errors[1]).toMatch(/^D01: json을 읽을 수 없습니다/);
    }
  });
});
