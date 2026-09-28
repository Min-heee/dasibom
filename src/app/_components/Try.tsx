"use client";

/**
 * 직접 해 보기(PRD 3절 13~21초, F10): 수술일·시술을 넣으면 1년 일정이 바로 그려지고, 휴진일에 걸린 시점은 "다음 진료일로 미룸"과 사유를 보인다.
 * 계산은 core/schedule.buildSchedule(demo/view.tryIt). 기대값 표의 가상 입력(H1~H3)과 같은 입력이면 표와 맞는지도 보인다
 * (대조는 평가 화면과 같은 함수 demo/evaluate.checkHypothetical).
 */

import { useMemo, useState } from "react";
import { DEMO_TODAY } from "@/demo/clock";
import { bundle, demo, mustDemo } from "@/demo/data";
import { checkHypothetical } from "@/demo/evaluate";
import { procedureLabel, tryIt } from "@/demo/view";
import { PROCEDURES, type Procedure } from "@/core/patient";
import { ErrorPanel } from "./ErrorPanel";

export const TRY_PRESETS: { label: string; startDate: string; procedure: Procedure }[] = [
  { label: "추석에 걸림 (9/17 수술)", startDate: "2026-09-17", procedure: "hair-transplant" },
  // 1/31 수술은 6개월(7/31)·1년(1/31) 모두 같은 날짜가 있어 월말 규칙이 걸리지 않는다. 보이는 것은 일요일 미룸이다.
  { label: "1월 31일 수술 · 일요일 미룸", startDate: "2026-01-31", procedure: "hair-transplant" },
  { label: "세 번 미룸 (한글날·일요일·대체공휴일)", startDate: "2027-04-09", procedure: "hair-transplant" },
  { label: "윤년 월말 (8/31 → 2/29)", startDate: "2027-08-31", procedure: "hair-transplant" },
  { label: "두피 주사 9/10 시작", startDate: "2026-09-10", procedure: "injection" },
];

export function TryScreen() {
  const d = demo();
  if (!d.ok) return <ErrorPanel errors={d.errors} />;
  return <TryLive />;
}

function TryLive() {
  const { engine } = mustDemo();
  const [start, setStart] = useState(TRY_PRESETS[0].startDate);
  const [proc, setProc] = useState<Procedure>("hair-transplant");
  const r = useMemo(() => tryIt(start, proc, engine, DEMO_TODAY), [start, proc, engine]);
  const hypo = bundle.hypotheticals.find((h) => h.startDate === start && h.procedure === proc);
  const check = useMemo(() => {
    if (!hypo || !r.ok) return null;
    const c = checkHypothetical(hypo, r.points, engine, DEMO_TODAY);
    return { id: hypo.id, ok: c.matched, total: c.total, note: hypo.note };
  }, [hypo, r, engine]);

  return (
    <>
      <p>수술일(두피 주사는 첫 주사일, 두피 관리는 첫 방문일)과 시술을 넣으면 사후관리 연락 규정대로 1년 일정을 바로 계산합니다. 휴진일(일요일·공휴일·추가 휴진)에 걸리면 다음 진료일로 미루고 사유를 남깁니다.</p>
      <div className="card">
        <form className="form-row" onSubmit={(e) => e.preventDefault()}>
          <label>
            시작일
            <input type="date" value={start} min="2025-01-01" max="2028-12-31" onChange={(e) => setStart(e.target.value)} required />
          </label>
          <label>
            시술
            <select value={proc} onChange={(e) => setProc(e.target.value as Procedure)}>
              {PROCEDURES.map((p) => (
                <option key={p} value={p}>
                  {procedureLabel(p)}
                </option>
              ))}
            </select>
          </label>
        </form>
        <fieldset className="chips">
          <legend>예시</legend>
          {TRY_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="chip"
              aria-pressed={start === p.startDate && proc === p.procedure}
              onClick={() => {
                setStart(p.startDate);
                setProc(p.procedure);
              }}
            >
              {p.label}
            </button>
          ))}
        </fieldset>
      </div>

      {!r.ok ? (
        <div className="note warn" role="alert">
          <p>{r.error}</p>
        </div>
      ) : (
        <section className="card" aria-live="polite" aria-labelledby="h-sched">
          <h2 id="h-sched">
            {procedureLabel(proc)} · {start} 시작 · 시점 {r.rows.length}개 · 미룬 시점 {r.rows.filter((x) => x.shifted).length}개
          </h2>
          {check && (
            <p>
              <span className={`badge ${check.ok === check.total ? "green" : "red"}`}>
                기대값 표({check.id}) 대조: {check.ok === check.total ? "같음" : "다름"} {check.ok}/{check.total} · 검수 전
              </span>{" "}
              <span className="small muted">{check.note}</span>
            </p>
          )}
          {r.notes.map((n, i) => (
            <div key={i} className="note">
              <p>{n}</p>
            </div>
          ))}
          <div className="scroll-x">
            <table className="sched">
              <thead>
                <tr>
                  <th scope="col">시점</th>
                  <th scope="col">원래 날짜</th>
                  <th scope="col">잡힌 날짜</th>
                  <th scope="col">표시</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((x) => (
                  <tr key={x.key}>
                    <td className="point">
                      {x.label}
                      <br />
                      <span className="small muted">{x.kindLabel}</span>
                    </td>
                    <td className="date" data-label="원래 날짜">
                      {x.original}
                    </td>
                    <td className="date" data-label="잡힌 날짜">
                      <strong>{x.due}</strong>
                    </td>
                    <td className="marks">
                      <span className="badges">
                        {x.shifted && <span className="badge orange">다음 진료일로 미룸</span>}
                        {x.monthEnd && <span className="badge blue">월말 규칙</span>}
                        {x.sameAngle && <span className="badge blue">사진 회차 · 같은각도</span>}
                        {x.holidayUnknown && <span className="badge gray">공휴일 미확인</span>}
                      </span>
                      {x.shift && <div className="small muted">{x.shift}</div>}
                      {x.monthEnd && <div className="small muted">그달에 같은 날짜가 없어 말일로</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
