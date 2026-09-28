"use client";

/**
 * 환자 상세(PRD 3절 6~13초, F6·F7·F8·F11): 이번 연락 문구, 연락 결과 버튼과 다음 연락일, 1년 타임라인, 방문·연락 기록.
 * 그릴 것은 모두 demo/screen.patientFor가 (원본 + 이 브라우저의 연락 기록 + 기준 시각)에서 만든다. 여기서는 그리기만 한다.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatShort, kstInstant } from "@/core/calendar";
import { ATTEMPT_RESULTS, CONTACT_RESULT_LABEL, type Booking, type ContactResult } from "@/core/patient";
import { DEMO_NOW_MS, DEMO_TODAY, formatKstTime } from "@/demo/clock";
import { demo, mustDemo } from "@/demo/data";
import { checkBookingInput, patientFor } from "@/demo/screen";
import type { MessageView } from "@/demo/view";
import { useContactLog } from "../_lib/useContactLog";
import { Badges } from "./Badge";
import { ErrorPanel } from "./ErrorPanel";

/** 문구를 만드는 시각. 기준 시각 외에 시간대 경계 근처 세 시각을 골라, "시간 맞춰 보내기"가 어떻게 붙는지 볼 수 있게 한다. */
export const COMPOSE_TIMES = ["09:00", "08:30", "19:59", "20:30"] as const;
export type ComposeTime = (typeof COMPOSE_TIMES)[number];

/** initialComposeAt은 시험용(시간대 밖 표시를 렌더로 확인). 화면에서는 늘 기준 시각 09:00으로 연다. */
export function PatientScreen({ id, initialComposeAt = "09:00" }: { id: string; initialComposeAt?: ComposeTime }) {
  const d = demo();
  if (!d.ok) return <ErrorPanel errors={d.errors} />;
  if (!d.patients.some((p) => p.id === id)) {
    return (
      <div className="card alert" role="alert">
        <h2>환자를 찾을 수 없습니다: {id}</h2>
        <Link href="/">오늘 목록으로</Link>
      </div>
    );
  }
  return <PatientLive id={id} initialComposeAt={initialComposeAt} />;
}

/** 이번 연락 문구 묶음. 배지의 글자·색은 view.messagesFor가 정한다(send·ad). */
export function MessageList({ messages }: { messages: MessageView[] }) {
  return (
    <>
      {messages.map((m, i) => (
        <div key={i} className="stack msg-block">
          <div className="row">
            <span className={`badge ${m.tone}`}>{m.reasonLabel}</span>
            <span className="small muted">
              {m.pointLabel} · {m.templateLabel}
            </span>
          </div>
          {m.message.ok ? (
            <>
              <p className="msg">{m.message.text}</p>
              <ul className="slots" aria-label="채운 칸">
                {m.slots.map((s) => (
                  <li key={s.name}>
                    {s.name}: <b>{s.value}</b>
                  </li>
                ))}
              </ul>
              <p className="badges">
                {m.send && <span className={`badge ${m.send.tone} wrap`}>{m.send.label}</span>}
                {m.ad && <span className={`badge ${m.ad.tone}`}>{m.ad.label}</span>}
              </p>
            </>
          ) : (
            <div className="note warn">
              <p>문구를 만들지 않았습니다: {m.message.errors.join(" / ")}</p>
            </div>
          )}
          {m.sameAngle && (
            <div className="note">
              <p>
                <strong>같은각도</strong> · {m.sameAngle}
              </p>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function PatientLive({ id, initialComposeAt }: { id: string; initialComposeAt: ComposeTime }) {
  const { engine } = mustDemo();
  const { base, log, record, undo, reset } = useContactLog();
  const [composeAt, setComposeAt] = useState<ComposeTime>(initialComposeAt);
  const [notice, setNotice] = useState<{ tone: "warn" | "info"; text: string } | null>(null);
  const [bookKey, setBookKey] = useState<string | null>(null);
  const [bookDate, setBookDate] = useState("");
  const composeMs = kstInstant(DEMO_TODAY, composeAt);
  const v = useMemo(() => patientFor(id, base, engine, log, DEMO_NOW_MS, composeMs), [id, base, engine, log, composeMs]);
  if (!v) return null;
  // 고른 시점이 목록에서 사라졌으면(예약·방문으로 상태가 바뀜) 첫 항목으로 돌아간다.
  const bookPoint = v.bookable.find((b) => b.key === bookKey) ?? v.bookable[0];

  const onResult = (r: ContactResult, booking?: Booking) => {
    const res = record(id, r, booking);
    if (res.error) setNotice({ tone: "warn", text: res.error });
    else if (res.replaced) setNotice({ tone: "info", text: `이미 적은 결과를 바꿨습니다: ${CONTACT_RESULT_LABEL[r]}. 같은 시각의 연락은 한 번으로 셉니다.` });
    else setNotice(null);
  };
  const onBook = () => {
    const c = checkBookingInput(bookDate, bookPoint, engine, DEMO_TODAY);
    if (!c.ok) setNotice({ tone: "warn", text: c.error });
    else onResult("booked", { pointKey: bookPoint!.key, date: c.date });
  };

  return (
    <>
      <p className="small">
        <Link className="back" href="/">
          ← 오늘 목록
        </Link>
      </p>
      <div className="card">
        <h2>
          {v.alias} <span className="muted small">가명 · {v.id}</span>
        </h2>
        <p>{v.subtitle}</p>
        {v.badges.length > 0 ? <Badges items={v.badges} /> : <span className="badge gray">오늘 연락할 이유 없음</span>}
        {v.overdueLine && <p className="small muted">{v.overdueLine}</p>}
        {v.optOutLine && <p className="small">{v.optOutLine}</p>}
        {v.nurse.lines.length > 0 && (
          <div className="note warn" role="note">
            <p>
              <strong>간호팀 확인</strong> · 코디네이터 목록에서 빠지고 간호팀 확인 목록에 있습니다({v.nurse.causes.join(", ")}).
            </p>
            <ul>
              {v.nurse.lines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {v.symptoms.length > 0 && (
        <div className="card alert" role="note">
          <h3>의료진 확인 필요 — 연락 기록에 증상 표현</h3>
          <p className="small">직원이 판단하지 않습니다. 적신호 증상 문서의 규칙으로 표시만 하고, 의료진 인계 절차를 따릅니다. 안내 문구에 증상 내용은 넣지 않습니다.</p>
          <ul>
            {v.symptoms.map((s, i) => (
              <li key={i}>
                {s.text} <span className="muted">(걸린 말: {s.words.join(", ")})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="card" aria-labelledby="h-contact">
        <h3 id="h-contact">이번 연락</h3>
        {v.messages.length === 0 ? (
          <p className="muted">{v.noMessage}</p>
        ) : (
          <>
            <fieldset className="chips">
              <legend>
                문구를 만드는 시각 (연락 가능 시간대 {engine.rules.contactWindow.start}~{engine.rules.contactWindow.end}, 끝 시각 불포함)
              </legend>
              {COMPOSE_TIMES.map((t) => (
                <button key={t} type="button" className="chip" aria-pressed={composeAt === t} onClick={() => setComposeAt(t)}>
                  {t}
                  {t === "09:00" ? " (기준 시각)" : ""}
                </button>
              ))}
            </fieldset>
            <MessageList messages={v.messages} />
            <p className="small muted" style={{ marginTop: 8 }}>
              실제로 보내지 않습니다. 문구와 보낼 시각까지만 만들고, 보내는 것은 병원의 발송 도구와 사람입니다.
            </p>
          </>
        )}

        <h3 style={{ marginTop: 12 }}>연락 결과 적기</h3>
        {v.localCount > 0 && <p className="small muted">이 환자에게 이미 {formatKstTime(DEMO_NOW_MS)} 연락을 적었습니다. 다시 누르면 결과를 바꿉니다(쌓이지 않음).</p>}
        <div className="actions" role="group" aria-label="연락 결과">
          {ATTEMPT_RESULTS.filter((r) => r !== "booked").map((r) => (
            <button key={r} type="button" onClick={() => onResult(r)}>
              {CONTACT_RESULT_LABEL[r]}
            </button>
          ))}
          {v.optOutLine ? (
            <button type="button" onClick={() => onResult("opt-in")}>
              {CONTACT_RESULT_LABEL["opt-in"]}
            </button>
          ) : (
            <button type="button" onClick={() => onResult("opt-out")}>
              {CONTACT_RESULT_LABEL["opt-out"]}
            </button>
          )}
        </div>
        {v.bookable.length > 0 && (
          <form
            className="form-row booking"
            aria-label="예약 잡음"
            onSubmit={(e) => {
              e.preventDefault();
              onBook();
            }}
          >
            <label>
              예약할 시점
              <select value={bookPoint?.key ?? ""} onChange={(e) => setBookKey(e.target.value)}>
                {v.bookable.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.label} · {b.state}
                  </option>
                ))}
              </select>
            </label>
            <label>
              예약 날짜
              <input type="date" value={bookDate} min={DEMO_TODAY} onChange={(e) => setBookDate(e.target.value)} required />
            </label>
            <button type="submit">{CONTACT_RESULT_LABEL.booked}</button>
          </form>
        )}
        {notice && (
          <p className={notice.tone === "warn" ? "note warn" : "note"} role={notice.tone === "warn" ? "alert" : "status"}>
            {notice.text}
          </p>
        )}
        {v.after && (
          <div className={`result t-${v.after.tone}`} role="status" aria-live="polite">
            {v.after.lines.map((l, i) => (
              <p key={i}>{i === 0 ? <strong>{l}</strong> : l}</p>
            ))}
          </div>
        )}
        <div className="row">
          <button type="button" onClick={() => undo(id)} disabled={v.localCount === 0}>
            되돌리기{v.localCount > 0 ? ` (이 환자 ${v.localCount}건)` : ""}
          </button>
          <button type="button" onClick={reset} disabled={log.applied.length === 0}>
            초기화 (이 브라우저 기록 {log.applied.length}건 모두)
          </button>
        </div>
        <p className="small muted">연락은 기준 시각 {formatKstTime(DEMO_NOW_MS)}에 한 것으로 이 브라우저에만 적습니다. 합성 데이터 원본은 바뀌지 않습니다.</p>
      </section>

      <section className="card" aria-labelledby="h-tl">
        <h3 id="h-tl">1년 타임라인</h3>
        {v.photoNote && (
          <div className="note">
            <p>
              <strong>같은각도</strong> · {v.photoNote} (연동은 없음)
            </p>
          </div>
        )}
        <div className="strip" aria-hidden="true">
          <div className="axis" />
          {v.timeline.entries.map((e) => (
            <span key={e.key} className={`dot t-${e.tone}`} style={{ left: `${e.pct}%` }} title={`${e.dateText} ${e.label} · ${e.stateLabel}`}>
              {e.tone === "red" ? "!" : e.tone === "green" ? "✓" : ""}
            </span>
          ))}
          <span className={v.timeline.todayPct > 80 ? "today flip" : "today"} style={{ left: `${v.timeline.todayPct}%` }}>
            <span>오늘</span>
          </span>
        </div>
        <div className="strip-ends" aria-hidden="true">
          <span>
            {v.timeline.start.slice(0, 4)}년 {formatShort(v.timeline.start)}
          </span>
          <span>
            {v.timeline.end.slice(0, 4)}년 {formatShort(v.timeline.end)}
          </span>
        </div>
        <ol className="timeline">
          {v.timeline.entries.map((e) => (
            <li key={e.key} className={e.dueDate < DEMO_TODAY ? "past" : undefined}>
              <span className="when">{e.dateText}</span>
              <span className="what">
                <span>{e.label}</span>
                <span className={`badge ${e.tone}`}>{e.stateLabel}</span>
                {e.sameAngle && <span className="badge blue">사진 회차 · 같은각도</span>}
              </span>
              {(e.shift || e.monthEnd || e.holidayUnknown) && (
                <span className="detail">
                  {[e.shift, e.monthEnd ? "월말 규칙: 같은 날짜가 없어 그달 말일로" : null, e.holidayUnknown ? "공휴일 미확인" : null].filter(Boolean).join(" · ")}
                </span>
              )}
            </li>
          ))}
        </ol>
        {v.timeline.holidayFootnote && <p className="small muted">{v.timeline.holidayFootnote}</p>}
        {v.reasonsAtStart && <p className="small muted">기준 시각의 오늘 이유: {v.reasonsAtStart}</p>}
      </section>

      <section className="card" aria-labelledby="h-rec">
        <h3 id="h-rec">방문·연락 기록</h3>
        <h4>방문</h4>
        {v.visits.length === 0 ? (
          <p className="muted">방문 기록 없음</p>
        ) : (
          <ul className="plain contacts">
            {v.visits.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        )}
        <h4>연락</h4>
        {v.contacts.length === 0 ? (
          <p className="muted">연락 기록 없음</p>
        ) : (
          <ul className="plain contacts">
            {v.contacts.map((c, i) => (
              <li key={i}>
                <span className="row">
                  <span>{c.at}</span>
                  <span className="badge gray">{c.result}</span>
                  {c.counted && <span className="badge orange">미방문 시도로 셈</span>}
                  {c.local && <span className="badge blue">이 브라우저에서 적음</span>}
                  {c.symptom && <span className="badge red">의료진 확인</span>}
                </span>
                {c.note && <span className="small muted">메모: {c.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
