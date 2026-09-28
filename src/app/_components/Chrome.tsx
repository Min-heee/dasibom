"use client";

/**
 * 모든 화면 위의 띠와 탭. 띠는 스크롤해도 보인다 — 어느 화면을 캡처해도 가상 의원·합성 데이터·기준 시각이 함께 찍히게(PRD F12).
 * 이 브라우저에서 적은 연락 건수도 띠에 보인다(새로 고쳐도 남는지, 막혔는지).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DEMO_NOW_MS } from "@/demo/clock";
import { demo } from "@/demo/data";
import { bandText } from "@/demo/view";
import { useContactLog, useStorageBlocked } from "../_lib/useContactLog";

// short는 휴대폰 폭(600px 이하)에서 쓰는 이름. 320px에서도 네 탭이 가로로 밀지 않고 한 줄에 들어가게.
export const TABS = [
  { href: "/", label: "오늘 목록", short: "오늘" },
  { href: "/try/", label: "직접 해 보기", short: "해 보기" },
  { href: "/rules/", label: "규칙 바꿔 보기", short: "규칙" },
  { href: "/eval/", label: "평가", short: "평가" },
];

/** 세 도구의 관계(PRD 1절). 휴대폰에서도 숨기지 않는다 — 이 줄이 없으면 휴대폰에서는 무슨 도구인지 말하는 문장이 없다. */
export const TOOLS_LINE = [
  { name: "한창구", role: "환자가 먼저 보낸 문의의 답장 초안" },
  { name: "다시봄", role: "병원이 먼저 거는 연락", self: true },
  { name: "같은각도", role: "경과 사진을 같은 조건으로" },
];

export function isActiveTab(href: string, path: string): boolean {
  if (href === "/") return path === "/" || path.startsWith("/patient");
  return path.startsWith(href.replace(/\/$/, ""));
}

function LogCount() {
  const { log, dropped } = useContactLog();
  const blocked = useStorageBlocked();
  return (
    <span className="band-log">
      이 브라우저 연락 기록 {log.applied.length}건
      {blocked && " · 저장이 막혀 새로 고치면 사라집니다"}
      {dropped && " · 저장된 기록이 데이터와 맞지 않아 비웠습니다"}
    </span>
  );
}

export function Chrome() {
  const path = usePathname() ?? "/";
  return (
    <>
      <div className="band" role="note" aria-label="시연 안내">
        <strong>{bandText(DEMO_NOW_MS)}</strong>
        {demo().ok && <LogCount />}
      </div>
      <header className="top">
        <div className="brand">
          <h1>다시봄</h1>
          <small>가상 &lsquo;샘플의원&rsquo;의 사후관리 연락 — 일정은 규칙이 계산하고, 보내는 건 사람이</small>
        </div>
        <p className="tools">
          샘플의원 세 도구 —{" "}
          {TOOLS_LINE.map((t, i) => (
            <span key={t.name}>
              {i > 0 && " · "}
              {t.self ? (
                <strong>
                  {t.name}({t.role})
                </strong>
              ) : (
                `${t.name}(${t.role})`
              )}
            </span>
          ))}
        </p>
        <nav className="tabs" aria-label="화면">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} aria-current={isActiveTab(t.href, path) ? "page" : undefined} aria-label={t.label}>
              <span className="tab-long">{t.label}</span>
              <span className="tab-short" aria-hidden="true">
                {t.short}
              </span>
            </Link>
          ))}
        </nav>
      </header>
    </>
  );
}
