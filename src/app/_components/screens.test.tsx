/**
 * 화면을 서버 렌더로 찍어 본다(renderToStaticMarkup). 뷰 모델 시험은 컴포넌트가 그 값을 **어떻게 그리는지**
 * (순서, 빠진 묶음, 원문 대신 가린 메모)를 잡지 못한다. 이 렌더는 localStorage가 없는 첫 화면(이 브라우저 연락 기록 없음)이다.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EMPTY_LOG } from "@/core/contact";
import { DEMO_NOW_MS } from "@/demo/clock";
import { mustDemo } from "@/demo/data";
import { todayFor } from "@/demo/screen";
import { EvalScreen } from "./Eval";
import { PatientScreen } from "./Patient";
import { RulesScreen } from "./Rules";
import { TodayScreen } from "./Today";
import { TryScreen } from "./Try";
import { Chrome, isActiveTab, TABS } from "./Chrome";

// next/link는 시험 환경에서 trailingSlash 설정을 모르므로 끝 '/'를 떼고 그린다(빌드 결과에는 붙음). 두 모양 다 받는다.
const href = (id: string) => new RegExp(`href="/patient/${id}/?"`);
const at = (html: string, id: string) => html.search(href(id));
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("첫 화면(오늘 목록)", () => {
  const html = renderToStaticMarkup(<TodayScreen />);
  const t = text(html);

  it("묶음은 PRD 3절 순서, 맨 위는 빨간 '예정일 지남', 개수를 글자로", () => {
    const order = ["h-overdue", "h-upcoming-visit", "h-care-notice", "h-injection-rebook", "h-photo-round", "h-clinician", "h-director", "h-waiting"].map((id) => html.indexOf(`id="${id}"`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toMatch(/id="h-overdue"><span class="badge red">예정일 지남<\/span><span class="count">13명<\/span>/);
    expect(t).toContain("9/21(월) 오늘 연락할 환자 25명");
  });

  it("30초 시연 0~6초: 오래 밀린 순(P006·P017 18일) 다음에 P001 6개월 경과 진료 12일 지남, 연락 2회 부재", () => {
    const i = (id: string) => at(html, id);
    expect(i("P006")).toBeGreaterThan(0);
    expect(i("P006")).toBeLessThan(i("P017"));
    expect(i("P017")).toBeLessThan(i("P001"));
    expect(t).toContain("6개월 경과 진료·경과 사진 · 예정일 9/9(수) · 12일 지남");
    expect(t).toContain("연락 2회 · 마지막 9/18(금) 부재");
    expect(html).toMatch(/class="rowlink t-red" href="\/patient\/P001\/?"/);
  });

  it("줄 순서는 뷰 모델(todayFor) 순서 그대로: 묶음 → 의료진 확인 → 원장 확인 → 재연락 대기", () => {
    const { engine, patients } = mustDemo();
    const v = todayFor(patients, engine, EMPTY_LOG, DEMO_NOW_MS);
    // 줄 링크(rowlink)만 순서대로. '다른 묶음 줄에 함께' 링크(inline-hit)는 빼고 본다.
    const rendered = [...html.matchAll(/class="rowlink[^"]*" href="\/patient\/(P\d+)\/?"/g)].map((m) => m[1]);
    const expected = [...v.groups.flatMap((g) => g.rows.map((r) => r.patientId)), ...v.clinician.map((c) => c.patientId), ...v.escalations.map((e) => e.patientId), ...v.waiting.map((w) => w.patientId)];
    expect(rendered).toEqual(expected);
  });

  it("개수 칩 숫자 = 묶음 머리 숫자 = 그 묶음 줄 수 + 다른 묶음 줄에 함께 있는 수", () => {
    const { engine, patients } = mustDemo();
    const v = todayFor(patients, engine, EMPTY_LOG, DEMO_NOW_MS);
    for (const g of v.groups) {
      expect(g.count, g.label).toBe(g.rows.length + g.alsoIn.length);
      expect(t, g.label).toContain(`${g.label}${g.count}명`); // 칩: 배지 글자 뒤에 숫자
      const head = html.slice(html.indexOf(`id="h-${g.reason}"`), html.indexOf("</h2>", html.indexOf(`id="h-${g.reason}"`)));
      expect(text(head), g.label).toContain(`${g.count}명`);
    }
    expect(t).toContain("원장 확인2명");
    expect(t).toContain("사진 회차3명");
    expect(t).toContain("그중 3명은 다른 묶음 줄에 함께");
  });

  it("여러 이유가 있는 줄은 사유 줄을 모두 그린다(P045 지남 + 재예약, P013 지남 + 내일 내원)", () => {
    expect(t).toContain("두피 주사 3회차 · 예정일 9/4(금) · 17일 지남");
    expect(t).toContain("두피 주사 4회차 · 9/18(금) 예정이었음 · 9/21(월)까지 날짜 옮기기");
    const p13 = html.slice(at(html, "P013"), html.indexOf("</a>", at(html, "P013")));
    expect((text(p13).match(/두피 주사 \d회차/g) ?? []).length).toBe(2);
  });

  it("원장 확인·의료진 확인·재연락 대기 묶음이 있고, 원장 확인·대기 환자는 코디네이터 묶음에 없다", () => {
    const coordinator = html.slice(0, html.indexOf('id="g-clinician"'));
    for (const id of ["P003", "P009", "P002"]) expect(coordinator).not.toMatch(href(id));
    const rest = html.slice(html.indexOf('id="g-clinician"'));
    for (const id of ["P012", "P039", "P003", "P009", "P002"]) expect(rest).toMatch(href(id));
    expect(t).toContain("9/22(화)부터 다시 연락");
  });

  it("적신호 '걸린 말'은 메모에 있는 말만(P012: '붓고 열감'에서 '고열'이 나오지 않는다)", () => {
    expect(t).toContain("(걸린 말: 열감, 붓고)");
    expect(t).not.toContain("고열");
  });
});

describe("환자 상세", () => {
  it("P001: 이번 연락 문구(날짜 칸 9/9), 지금 보내기, 연락 결과 버튼 넷, 타임라인 미방문", () => {
    const t = text(renderToStaticMarkup(<PatientScreen id="P001" />));
    expect(t).toContain("여름 달");
    expect(t).toContain("9/9(수)로 안내드린 내원 일정이 지나 연락드립니다");
    expect(t).toContain("지금 보내기 · 연락 가능 시간대 안");
    for (const b of ["통화함", "부재", "문자 보냄", "다음에"]) expect(t).toContain(b);
    expect(t).toContain("미방문 · 예정일 12일 지남");
    expect(t).toContain("미방문 시도로 셈");
  });

  it("P027: 밀린 시점은 원래 날짜와 사유", () => {
    expect(text(renderToStaticMarkup(<PatientScreen id="P027" />))).toContain("원래 9/20(일)에서 미룸 — 9/20 일요일 휴진");
  });

  it("P018: 사진 회차엔 같은각도 안내", () => {
    const t = text(renderToStaticMarkup(<PatientScreen id="P018" />));
    expect(t).toContain("같은각도 · 경과 사진 회차입니다.");
    expect(t).toContain("사진 회차 · 같은각도");
  });

  it("P012: 증상 메모는 의료진 확인 카드로, 문구에는 넣지 않는다", () => {
    const t = text(renderToStaticMarkup(<PatientScreen id="P012" />));
    expect(t).toContain("의료진 확인 필요");
    const msgs = [...renderToStaticMarkup(<PatientScreen id="P012" />).matchAll(/<p class="msg">([^<]*)<\/p>/g)].map((m) => m[1]);
    expect(msgs.length).toBeGreaterThan(0);
    for (const m of msgs) expect(m).not.toMatch(/붓|열감|이식 부위/);
  });

  it("P001을 20:30·08:30에 만들면 '시간 맞춰 보내기'와 보낼 시각, '지금 보내기'는 없다", () => {
    const late = text(renderToStaticMarkup(<PatientScreen id="P001" initialComposeAt="20:30" />));
    expect(late).toContain("시간 맞춰 보내기 · 9/22(화) 09:00에");
    expect(late).not.toContain("지금 보내기");
    const early = text(renderToStaticMarkup(<PatientScreen id="P001" initialComposeAt="08:30" />));
    expect(early).toContain("시간 맞춰 보내기 · 9/21(월) 09:00에");
    expect(early).not.toContain("지금 보내기");
  });

  it("승인 문구는 한국어 이름으로, 코드 키·문서 번호는 보이지 않는다", () => {
    const html = renderToStaticMarkup(<PatientScreen id="P001" />);
    expect(text(html)).toContain("미방문 안내 문구");
    expect(html).not.toMatch(/<code>/);
    expect(text(html)).not.toMatch(/\bV1[125]\b|\(V15\)/);
  });

  it("P003: 원장 확인 배지와 설명", () => {
    const t = text(renderToStaticMarkup(<PatientScreen id="P003" />));
    expect(t).toContain("원장 확인");
    expect(t).toContain("최대 시도까지 연락해도 닿지 않아 코디네이터 목록에서 빠지고 원장 확인 목록에 있습니다.");
  });

  it("P001 타임라인은 날짜 오름차순, 연락 기록은 최근 것이 위", () => {
    const html = renderToStaticMarkup(<PatientScreen id="P001" />);
    const tl = html.slice(html.indexOf('<ol class="timeline">'), html.indexOf("</ol>", html.indexOf('<ol class="timeline">')));
    const whens = [...tl.matchAll(/<span class="when">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(whens[0]).toBe("3/10(화)");
    expect(whens[whens.length - 1]).toBe("2027년 3/9(화)");
    const contacts = [...html.slice(html.indexOf('id="h-rec"')).matchAll(/<span>(\d+\/\d+\([^)]+\) \d\d:\d\d)<\/span>/g)].map((m) => m[1]);
    expect(contacts[0].startsWith("9/18")).toBe(true);
  });

  it("없는 환자", () => {
    expect(text(renderToStaticMarkup(<PatientScreen id="P999" />))).toContain("환자를 찾을 수 없습니다: P999");
  });
});

describe("평가 화면", () => {
  it("기대값 검수 상태를 먼저 밝히고, 기대값에 기대는 지표는 '맞음(검수 전)', 나머지는 기준 충족", () => {
    const t = text(renderToStaticMarkup(<EvalScreen />));
    expect(t).toContain("기대값: AI가 계산, 오너 검수 전.");
    expect(t.match(/맞음\(검수 전\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(t.match(/기준 충족/g)).toHaveLength(2);
    expect(renderToStaticMarkup(<EvalScreen />).match(/class="pass">생존 0</g)).toHaveLength(2); // 코어 변이, 화면 연결 변이
    expect(t).not.toContain("기준 미달");
  });
});

describe("탭과 접근성", () => {
  it("탭 넷(휴대폰 폭 짧은 이름 포함), 환자 상세는 '오늘 목록' 탭", () => {
    expect(TABS.map((x) => [x.label, x.short])).toEqual([
      ["오늘 목록", "오늘"],
      ["직접 해 보기", "해 보기"],
      ["규칙 바꿔 보기", "규칙"],
      ["평가", "평가"],
    ]);
    expect(isActiveTab("/", "/patient/P001/")).toBe(true);
    expect(isActiveTab("/try/", "/try")).toBe(true);
    expect(isActiveTab("/", "/eval/")).toBe(false);
  });

  it("누르는 것(버튼·탭·목록 줄·개수 칩·입력)은 최소 44px", () => {
    const css = readFileSync(fileURLToPath(new URL("../globals.css", import.meta.url)), "utf8");
    for (const sel of ["button,\n.button {", "nav.tabs a {", "a.rowlink {", ".counts a {", "input,\nselect,\ntextarea {", "details > summary {"]) {
      const i = css.indexOf(sel);
      expect(i, sel).toBeGreaterThanOrEqual(0);
      expect(css.slice(i, css.indexOf("}", i)), sel).toMatch(/min-height: 44px/);
    }
  });
});

describe("위 띠와 머리(Chrome)", () => {
  const t = text(renderToStaticMarkup(<Chrome />));
  it("띠: 가상 의원 · 합성 데이터 · 기준 시각 9/21(월) 09:00 (시험 중 시계는 2031년이라, 시계를 읽으면 여기서 어긋난다)", () => {
    expect(t).toContain("가상 의원 · 합성 데이터 · 기준 시각 9/21(월) 09:00");
    expect(t).toContain("이 브라우저 연락 기록 0건");
  });
  it("세 도구의 관계 한 줄 — 휴대폰 폭에서도 숨기지 않는다", () => {
    const html = renderToStaticMarkup(<Chrome />);
    expect(html).toContain('<p class="tools">');
    expect(t).toContain("샘플의원 세 도구 — 한창구(환자가 먼저 보낸 문의의 답장 초안) · 다시봄(병원이 먼저 거는 연락) · 같은각도(경과 사진을 같은 조건으로)");
    const css = readFileSync(fileURLToPath(new URL("../globals.css", import.meta.url)), "utf8");
    const mobile = css.slice(css.indexOf("@media (max-width: 600px)"));
    expect(mobile.slice(0, mobile.indexOf("\n}\n"))).not.toMatch(/\.tools/);
  });
});

describe("직접 해 보기(PRD 3절 13~21초)", () => {
  const html = renderToStaticMarkup(<TryScreen />);
  const t = text(html);
  it("첫 예시 9/17 수술: 미룬 시점 2개(D+3 일요일, D+7 추석), 사유 글자와 원래·잡힌 날짜", () => {
    expect(html.match(/다음 진료일로 미룸/g)).toHaveLength(2);
    expect(t).toContain("미룬 시점 2개");
    expect(t).toContain("9/20 일요일 휴진");
    expect(t).toContain("9/24 공휴일(추석 연휴), 9/25 공휴일(추석), 9/26 공휴일(추석 연휴), 9/27 일요일 휴진");
    const d7 = html.slice(html.indexOf("D+7 내원·경과 사진"), html.indexOf("</tr>", html.indexOf("D+7 내원·경과 사진")));
    const dates = [...d7.matchAll(/data-label="([^"]+)">(?:<strong>)?([^<]+)/g)].map((m) => [m[1], m[2]]);
    expect(dates).toEqual([
      ["원래 날짜", "9/24(목)"],
      ["잡힌 날짜", "9/28(월)"],
    ]);
  });
});

describe("규칙 바꿔 보기(PRD 3절 21~27초)", () => {
  const t = text(renderToStaticMarkup(<RulesScreen />));
  it("처음에는 지금 규칙 그대로: 25명 → 25명 (±0), 원래 값으로 버튼, 창은 오늘부터 30일", () => {
    expect(t).toContain("25명 → 25명 (±0)");
    expect(t).toContain("원래 값으로");
    expect(t).toContain("오늘부터 30일 연락 수");
    expect(t).toContain("9/21(월)");
    expect(t).not.toMatch(/D01|볼트/);
  });
});
