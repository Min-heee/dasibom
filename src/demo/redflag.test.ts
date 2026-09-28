import { describe, expect, it } from "vitest";
import { checkRedflags } from "@/core/redflag";
import { mustDemo } from "./data";

/**
 * 다시봄에서 고친 곳(어절 경계)만 시험한다. 원본 판정표 시험은 한창구 cbf5034 src/core/redflag.test.ts에 있다.
 * 직원 메모 문체("붓고 열감이 있다고 함")는 한창구가 시험한 환자 문장과 달라, 어절을 넘는 적중이 실제로 나왔다.
 */
// 픽스처 목록은 줄여 둔 것이라, 실제 V11(볼트) 목록으로 본다.
const { redflag } = mustDemo().engine;

describe("checkRedflags — 어절 경계", () => {
  it("'붓고 열감'에서 '고열'이 걸리지 않는다(걸린 말은 메모에 있는 말만)", () => {
    const r = checkRedflags("이식 부위가 붓고 열감이 있다고 해서 간호팀에 전달함", redflag);
    expect(r.matchedSymptoms).not.toContain("고열");
    expect(r.decision).toBe("handover"); // 모호어(붓고·열감) + 수술 후 문맥(이식) → RF-03
    expect(r.ruleIds).toEqual(["RF-03"]);
  });

  it("어절 첫머리에서 시작하면 공백을 넘어도 받는다: '숨 차요' = '숨차'", () => {
    expect(checkRedflags("어제부터 숨 차요", redflag).matchedSymptoms).toContain("숨차");
  });

  it("한 어절 안의 적중은 그대로: '고열이 나요'", () => {
    expect(checkRedflags("고열이 나요", redflag).matchedSymptoms).toContain("고열");
  });
});

/** 한창구 1ab9ed1과 같은 규칙: V11 nonSymptomWords("두피")를 가린 뒤 찾는다. */
describe("checkRedflags — 증상이 아닌 단어(V11 nonSymptomWords)", () => {
  it("직원 메모 '두피가 계속 가렵다고 함'은 '피가 계속'(출혈)으로 의료진 확인이 되지 않는다", () => {
    const r = checkRedflags("수술 후 두피가 계속 가렵다고 함", redflag);
    expect(r.matchedSymptoms).toEqual([]);
    expect(r.decision).toBe("pass");
  });

  it("두피 옆의 진짜 출혈은 그대로 잡는다", () => {
    expect(checkRedflags("이식한 두피에서 피가 계속 난다고 함", redflag)).toMatchObject({ decision: "handover", urgency: "urgent" });
  });
});
