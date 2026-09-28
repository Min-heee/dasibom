"use client";

/**
 * 첫 화면: 오늘 연락할 환자(PRD 3절 0~6초, F4). 판단은 core/today.buildToday, 글자는 demo/view.todayView가 만든다.
 * 이 브라우저에서 적은 연락이 있으면 그 연락을 더한 환자 목록으로 다시 계산한다(F6) — 처리한 환자는 목록에서 빠진다.
 * 정적 내보내기에서 미리 그리는 화면은 연락 기록이 없는 첫 화면이다.
 */

import Link from "next/link";
import { useMemo } from "react";
import { DEMO_NOW_MS } from "@/demo/clock";
import { demo, mustDemo } from "@/demo/data";
import { todayFor } from "@/demo/screen";
import type { TodayView } from "@/demo/view";
import { useContactLog } from "../_lib/useContactLog";
import { Badges } from "./Badge";
import { ErrorPanel } from "./ErrorPanel";

export function TodayScreen() {
  const d = demo();
  if (!d.ok) return <ErrorPanel errors={d.errors} />;
  return <TodayLive />;
}

function TodayLive() {
  const { engine } = mustDemo();
  const { base, log } = useContactLog();
  const view = useMemo(() => todayFor(base, engine, log, DEMO_NOW_MS), [base, engine, log]);
  return <TodayList view={view} localCount={log.applied.length} />;
}

export function TodayList({ view, localCount }: { view: TodayView; localCount: number }) {
  return (
    <>
      <div className="intro">
        <p>
          <strong>
            {view.dateLabel} 오늘 연락할 환자 <span className="num">{view.total}</span>명
          </strong>{" "}
          — 위에서부터 처리합니다. 한 환자가 여러 이유에 걸리면 가장 앞선 묶음에 한 줄로 합쳤습니다(개수는 그 이유가 있는 환자 수).
          <span className="wide-only"> 문구는 병원이 승인한 안내문에 날짜만 채우고, 보내는 것은 사람입니다.</span>
        </p>
        <p className="small muted">처음이면 맨 위 환자를 열어 보세요: 이번 연락 문구와 연락 결과 버튼이 있습니다.</p>
        {localCount > 0 && <p className="small muted">이 브라우저에서 적은 연락 {localCount}건을 반영한 목록입니다. 환자 화면에서 되돌리거나 초기화할 수 있습니다.</p>}
      </div>

      <ul className="counts" aria-label="묶음별 개수">
        {view.groups.map((g) => (
          <li key={g.reason}>
            <a href={`#g-${g.reason}`}>
              <span className={`badge ${g.tone}`}>{g.label}</span>
              <span className="num">{g.count}</span>명
            </a>
          </li>
        ))}
        <li>
          <a href="#g-clinician">
            <span className="badge red">의료진 확인</span>
            <span className="num">{view.clinician.length}</span>명
          </a>
        </li>
        <li>
          <a href="#g-nurse">
            <span className="badge orange">간호팀 확인</span>
            <span className="num">{view.nurse.length}</span>명
          </a>
        </li>
        <li>
          <a href="#g-waiting">
            <span className="badge gray">재연락 대기</span>
            <span className="num">{view.waiting.length}</span>명
          </a>
        </li>
        <li>
          <a href="#g-optout">
            <span className="badge gray">수신 거부</span>
            <span className="num">{view.optedOut.length}</span>명
          </a>
        </li>
      </ul>

      {view.groups.map((g) => (
        <section key={g.reason} className="group" id={`g-${g.reason}`} aria-labelledby={`h-${g.reason}`}>
          <h2 className="group-head" id={`h-${g.reason}`}>
            <span className={`badge ${g.tone}`}>{g.label}</span>
            <span className="count">
              {g.count}명{g.alsoIn.length > 0 && ` · 그중 ${g.alsoIn.length}명은 다른 묶음 줄에 함께`}
            </span>
          </h2>
          {g.alsoIn.length > 0 && (
            <p className="small also-in">
              다른 묶음 줄에 함께:{" "}
              {g.alsoIn.map((a, i) => (
                <span key={a.patientId}>
                  {i > 0 && " · "}
                  <Link className="inline-hit" href={a.href}>
                    {a.alias} ({a.patientId})
                  </Link>{" "}
                  <span className="muted">{a.inLabel} 줄</span>
                </span>
              ))}
            </p>
          )}
          {g.rows.length === 0 ? (
            g.alsoIn.length === 0 && <p className="empty">오늘은 없습니다.</p>
          ) : (
            <ul className="rows">
              {g.rows.map((r) => (
                <li key={r.patientId}>
                  <Link className={`rowlink t-${g.tone}`} href={r.href}>
                    <span className="rowhead">
                      <span className="who">{r.alias}</span>
                      <span className="id">
                        {r.patientId} · {r.procedure}
                      </span>
                      <Badges items={r.badges} />
                    </span>
                    <ul className="lines">
                      {r.lines.map((l, i) => (
                        <li key={i}>{l}</li>
                      ))}
                    </ul>
                    {r.attempts && <span className="attempts">{r.attempts}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <section className="group" id="g-clinician" aria-labelledby="h-clinician">
        <h2 className="group-head" id="h-clinician">
          <span className="badge red">의료진 확인</span>
          <span className="count">{view.clinician.length}명 · 연락 기록에 증상 표현</span>
        </h2>
        <p className="small muted">직원이 판단하지 않습니다. 한창구와 같은 적신호 증상 문서의 규칙으로 표시만 하고, 의료진 인계 절차를 따릅니다.</p>
        {view.clinician.length === 0 ? (
          <p className="empty">없습니다.</p>
        ) : (
          <ul className="rows">
            {view.clinician.map((c) => (
              <li key={c.patientId}>
                <Link className="rowlink t-red" href={c.href}>
                  <span className="rowhead">
                    <span className="who">{c.alias}</span>
                    <span className="id">
                      {c.patientId} · {c.procedure}
                    </span>
                    {c.inList && <span className="badge gray">오늘 목록에도 있음</span>}
                    {c.optedOut && <span className="badge gray">수신 거부</span>}
                  </span>
                  <ul className="lines">
                    {c.notes.map((n, i) => (
                      <li key={i}>
                        {n.at} 메모: {n.text} <span className="muted">(걸린 말: {n.words.join(", ")})</span>
                      </li>
                    ))}
                  </ul>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="group" id="g-nurse" aria-labelledby="h-nurse">
        <h2 className="group-head" id="h-nurse">
          <span className="badge orange">간호팀 확인</span>
          <span className="count">{view.nurse.length}명 · 코디네이터 연락으로 풀 수 없음</span>
        </h2>
        <p className="small muted">최대 시도까지 연락해도 오지 않은 환자, 14일 넘게 빠진 주사 회차(의료진 진료 뒤 재시작), 휴진을 피할 허용 범위 안에 진료일이 없는 시점입니다. 문구를 만들지 않습니다.</p>
        {view.nurse.length === 0 ? (
          <p className="empty">없습니다.</p>
        ) : (
          <ul className="rows">
            {view.nurse.map((n) => (
              <li key={n.patientId}>
                <Link className="rowlink t-orange" href={n.href}>
                  <span className="rowhead">
                    <span className="who">{n.alias}</span>
                    <span className="id">
                      {n.patientId} · {n.procedure}
                    </span>
                    {n.causes.map((c) => (
                      <span key={c} className="badge orange">
                        {c}
                      </span>
                    ))}
                    {n.symptom && <span className="badge red">의료진 확인</span>}
                    {n.inList && <span className="badge gray">오늘 목록에도 있음</span>}
                  </span>
                  <ul className="lines">
                    {n.lines.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                  {n.attempts && <span className="attempts">{n.attempts}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="group" id="g-waiting" aria-labelledby="h-waiting">
        <h2 className="group-head" id="h-waiting">
          <span className="badge gray">재연락 대기</span>
          <span className="count">{view.waiting.length}명 · 미방문이지만 재연락 간격 전</span>
        </h2>
        {view.waiting.length === 0 ? (
          <p className="empty">없습니다.</p>
        ) : (
          <ul className="rows">
            {view.waiting.map((w) => (
              <li key={w.patientId}>
                <Link className="rowlink t-gray" href={w.href}>
                  <span className="rowhead">
                    <span className="who">{w.alias}</span>
                    <span className="id">
                      {w.patientId} · {w.procedure}
                    </span>
                  </span>
                  <span className="attempts">
                    {w.next} · {w.attempts}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="group" id="g-optout" aria-labelledby="h-optout">
        <h2 className="group-head" id="h-optout">
          <span className="badge gray">수신 거부</span>
          <span className="count">{view.optedOut.length}명 · 연락 원치 않음</span>
        </h2>
        <p className="small muted">위의 모든 연락 목록에서 뺐습니다. 빠진 환자가 보이지 않게 되지 않도록, 무엇이 걸려 있었는지만 적습니다. 환자 화면에서 되돌릴 수 있습니다.</p>
        {view.optedOut.length === 0 ? (
          <p className="empty">없습니다.</p>
        ) : (
          <ul className="rows">
            {view.optedOut.map((o) => (
              <li key={o.patientId}>
                <Link className="rowlink t-gray" href={o.href}>
                  <span className="rowhead">
                    <span className="who">{o.alias}</span>
                    <span className="id">
                      {o.patientId} · {o.procedure}
                    </span>
                    <span className="badge gray">수신 거부</span>
                  </span>
                  <ul className="lines">
                    <li>{o.since}</li>
                    {o.held && <li>{o.held}</li>}
                  </ul>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
