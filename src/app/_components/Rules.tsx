"use client";

/**
 * 규칙 바꿔 보기(PRD 3절 21~27초, F9): 규칙 값 하나를 바꾸면 오늘 목록과 오늘부터 30일 일자별 연락 수가 어떻게 달라지는지.
 * 계산은 core/simulate 하나. 볼트 원본은 바뀌지 않고, 바뀐 값도 D01을 읽을 때와 같은 검증을 거친다(깨진 값이면 계산하지 않고 이유를 보인다).
 * 이 화면은 규칙 차이만 보려고 이 브라우저에서 적은 연락은 넣지 않고 합성 데이터 원본으로 계산한다(화면에도 적는다).
 *
 * 계산 한 번이 수백 ms라 슬라이더를 끄는 동안에는 계산하지 않고, **손을 뗄 때**(또는 입력칸에 값을 넣을 때) 한 번 한다.
 * 계산할 값은 {규칙, 값} 한 쌍으로 들고 있는다 — 따로 들면 규칙을 바꾼 순간 '새 규칙 + 이전 값'으로 한 번 더 계산해
 * 쓸 수 없는 값의 경고가 잠깐 뜬다.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { checkDay, formatShort, type LocalDate } from "@/core/calendar";
import { simulate } from "@/core/simulate";
import { REASON_LABEL, type Reason } from "@/core/today";
import { DEMO_NOW_MS } from "@/demo/clock";
import { demo, mustDemo } from "@/demo/data";
import { forecastBars, parseSimValue, SIM_OPTIONS, simOption } from "@/demo/sim";
import { patientHref } from "@/demo/view";
import { useContactLog } from "../_lib/useContactLog";
import { ErrorPanel } from "./ErrorPanel";

export function RulesScreen() {
  const d = demo();
  if (!d.ok) return <ErrorPanel errors={d.errors} />;
  return <RulesLive />;
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0");
const reasons = (rs: Reason[]) => rs.map((r) => REASON_LABEL[r]).join(", ");

function RulesLive() {
  const { engine, patients } = mustDemo();
  const { log } = useContactLog();
  const [optId, setOptId] = useState("grace-m6");
  const opt = simOption(optId);
  const current = opt.current(engine.rules);
  const [raw, setRaw] = useState(String(current));
  const value = parseSimValue(raw, opt);
  const [committed, setCommitted] = useState<{ optId: string; value: number | null }>({ optId, value: current });
  const commit = (v: number | null) => setCommitted({ optId: opt.id, value: v });
  const pending = committed.optId !== opt.id || committed.value !== value;
  const alias = useMemo(() => new Map(patients.map((p) => [p.id, p.alias])), [patients]);

  const result = useMemo(() => (committed.value === null ? null : simulate(patients, engine, DEMO_NOW_MS, simOption(committed.optId).change(committed.value))), [committed, patients, engine]);
  const bars = useMemo(() => (result?.ok ? forecastBars(result.forecast, (d) => !checkDay(d as LocalDate, engine.calendar).open) : []), [result, engine]);

  const choose = (id: string) => {
    const o = simOption(id);
    const v = o.current(engine.rules);
    setOptId(o.id);
    setRaw(String(v));
    setCommitted({ optId: o.id, value: v });
  };
  const typed = (s: string) => {
    setRaw(s);
    commit(parseSimValue(s, opt));
  };

  return (
    <>
      <p>
        규칙 값 <strong>하나</strong>를 바꾸면 오늘(9/21) 목록과 오늘부터 30일(10/20까지)의 일자별 연락 수가 어떻게 달라지는지 봅니다. 병원 규정 문서(사후관리 연락 규정)의 원본은 바뀌지 않습니다.
      </p>
      {log.applied.length > 0 && (
        <p className="small muted">이 화면은 이 브라우저에서 적은 연락 {log.applied.length}건을 빼고 합성 데이터 원본으로 비교합니다(첫 화면 숫자와 다를 수 있습니다).</p>
      )}
      <div className="card">
        <div className="form-row">
          <label>
            바꿀 규칙
            <select value={opt.id} onChange={(e) => choose(e.target.value)}>
              {SIM_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            값({opt.unit}, {opt.min}~{opt.max})
            <input type="number" inputMode="numeric" min={opt.min} max={opt.max} step={1} value={raw} onChange={(e) => typed(e.target.value)} />
          </label>
        </div>
        <label style={{ display: "block", marginTop: 8 }}>
          <span className="sr-only">{opt.label} 슬라이더</span>
          <input
            type="range"
            min={opt.min}
            max={opt.max}
            step={1}
            value={value ?? current}
            onChange={(e) => setRaw(e.target.value)}
            onPointerUp={(e) => commit(parseSimValue(e.currentTarget.value, opt))}
            onKeyUp={(e) => commit(parseSimValue(e.currentTarget.value, opt))}
            onBlur={(e) => commit(parseSimValue(e.currentTarget.value, opt))}
            aria-valuetext={`${value ?? current}${opt.unit}`}
          />
        </label>
        <p className="small muted">
          {opt.hint}. 지금 규칙: <strong>{current}{opt.unit}</strong> → 바꾼 값: <strong>{value === null ? "—" : `${value}${opt.unit}`}</strong>{" "}
          <button type="button" className="link" onClick={() => typed(String(current))} disabled={value === current}>
            원래 값으로
          </button>
        </p>
        {pending && value !== null && <p className="small muted">슬라이더에서 손을 떼면 계산합니다.</p>}
      </div>

      {value === null ? (
        <div className="note warn" role="alert">
          <p>
            {opt.min}~{opt.max} 사이의 정수를 넣어 주세요.
          </p>
        </div>
      ) : !result ? null : !result.ok ? (
        <div className="note warn" role="alert">
          <p>이 값은 규칙 검증을 통과하지 못해 계산하지 않았습니다: {result.errors.join(" / ")}</p>
        </div>
      ) : (
        <>
          <section className={pending ? "card stale" : "card"} aria-live="polite" aria-labelledby="h-diff">
            <h2 id="h-diff">오늘 목록</h2>
            <p>
              <span className="big">{result.today.beforeCount}</span>명 → <span className="big">{result.today.afterCount}</span>명{" "}
              <strong>({signed(result.today.afterCount - result.today.beforeCount)})</strong>
              <span className="muted"> · 원장 확인 {result.today.escalationsBefore}명 → {result.today.escalationsAfter}명</span>
            </p>
            {result.today.added.length + result.today.removed.length + result.today.changed.length === 0 ? (
              <p className="muted">오늘 목록은 달라지지 않습니다.</p>
            ) : (
              <ul className="plain contacts">
                {result.today.added.map((id) => {
                  const row = result.after.groups.flatMap((g) => g.rows).find((r) => r.patientId === id)!;
                  return (
                    <li key={`a${id}`}>
                      <span className="badge green">새로 오름</span> <Link className="inline-hit" href={patientHref(id)}>{alias.get(id)} ({id})</Link> · {reasons(row.reasons)}
                    </li>
                  );
                })}
                {result.today.removed.map((id) => {
                  const row = result.before.groups.flatMap((g) => g.rows).find((r) => r.patientId === id)!;
                  return (
                    <li key={`r${id}`}>
                      <span className="badge gray">빠짐</span> <Link className="inline-hit" href={patientHref(id)}>{alias.get(id)} ({id})</Link> · 전에는 {reasons(row.reasons)}
                    </li>
                  );
                })}
                {result.today.changed.map((c) => (
                  <li key={`c${c.patientId}`}>
                    <span className="badge orange">이유 바뀜</span> <Link className="inline-hit" href={patientHref(c.patientId)}>{alias.get(c.patientId)} ({c.patientId})</Link> · {reasons(c.before)} → {reasons(c.after)}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card" aria-labelledby="h-fc">
            <h2 id="h-fc">오늘부터 30일 연락 수</h2>
            <p>
              합계 <span className="num">{result.forecastTotal.before}</span>건 → <span className="num">{result.forecastTotal.after}</span>건{" "}
              <strong>({signed(result.forecastTotal.after - result.forecastTotal.before)})</strong> · 달라진 날 {bars.filter((b) => b.delta !== 0).length}일
            </p>
            {result.firstContact.length > 0 && (
              <p className="small">
                첫 연락이 달라진 환자 {result.firstContact.length}명:{" "}
                {result.firstContact.slice(0, 6).map((c, i) => (
                  <span key={c.patientId}>
                    {i > 0 && " · "}
                    {c.patientId} {c.before ? formatShort(c.before) : "없음"} → {c.after ? formatShort(c.after) : "없음"}
                  </span>
                ))}
                {result.firstContact.length > 6 && ` 외 ${result.firstContact.length - 6}명`}
                <span className="muted"> (건수가 같아도 연락이 앞당겨지거나 늦춰질 수 있습니다)</span>
              </p>
            )}
            <div className="legend" aria-hidden="true">
              <span>
                <i className="before" />
                지금 규칙
              </span>
              <span>
                <i className="after" />
                바꾼 규칙
              </span>
              <span>노란 줄 = 달라진 날</span>
            </div>
            <ol className="bars">
              {bars.map((b) => (
                <li key={b.date} className={[b.closed ? "closed" : "", b.delta !== 0 ? "changed" : ""].join(" ").trim() || undefined}>
                  <span className="date">{formatShort(b.date as LocalDate)}</span>
                  {b.closed ? (
                    <span className="small">휴진 · 연락 없음</span>
                  ) : (
                    <span className="pair">
                      <span className="bar before">
                        <i style={{ width: `${b.beforePct}%` }} />
                        <span>
                          <span className="sr-only">지금 규칙 </span>
                          {b.before}
                        </span>
                      </span>
                      <span className="bar after">
                        <i style={{ width: `${b.afterPct}%` }} />
                        <span>
                          <span className="sr-only">바꾼 규칙 </span>
                          {b.after}
                        </span>
                      </span>
                    </span>
                  )}
                  <span className="delta">{b.closed ? "" : b.delta === 0 ? "같음" : signed(b.delta)}</span>
                </li>
              ))}
            </ol>
            <details>
              <summary>이 예측의 가정</summary>
              <ul>
                {result.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
              <p className="small muted">실제 연락 수가 아니라, 규칙 값에 따른 차이를 보려는 모형입니다.</p>
            </details>
          </section>
        </>
      )}
    </>
  );
}
