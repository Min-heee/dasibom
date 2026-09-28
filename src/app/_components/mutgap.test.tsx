import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TryScreen } from "./Try";

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("변이 시험 빈틈 — 직접 해 보기 날짜 미정(C9)", () => {
  it("9/18 수술: D+7 줄에 '허용 범위 안에 진료일 없음 → 간호팀 확인' 배지와 각주", () => {
    const html = renderToStaticMarkup(<TryScreen initialStart="2026-09-18" />);
    const d7 = html.slice(html.indexOf("D+7 내원·경과 사진"), html.indexOf("</tr>", html.indexOf("D+7 내원·경과 사진")));
    expect(text(d7)).toContain("허용 범위 안에 진료일 없음 → 간호팀 확인");
    expect(text(html)).toContain("날짜 미정인 시점은 허용 범위 안에 진료일이 없어");
  });
});
