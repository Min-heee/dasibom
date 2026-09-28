/**
 * 평가(PRD 6절, 3절 27~30초). 지표는 모두 번들에서 계산한다(demo/evaluate) — 변이 검사만 브라우저에서 돌릴 수 없어 기록을 싣는다.
 * 기준은 PRD에 미리 적은 그대로이고, 못 미쳐도 그대로 싣는다. 기대값이 오너 검수 전이라는 것도 숨기지 않는다.
 * 훅이 없어 빌드 때 한 번 그린다.
 */

import Link from "next/link";
import { DEMO_NOW_MS } from "@/demo/clock";
import { demo } from "@/demo/data";
import { evalBundle as bundle } from "@/demo/evalData";
import { evaluateBundle } from "@/demo/evaluate";
import { patientHref } from "@/demo/view";
import { ErrorPanel } from "./ErrorPanel";

/** reviewed=false: 기대값이 오너 검수 전이라 '맞음'이 곧 '기준 충족'은 아니다(PRD 6·7절). */
function Verdict({ pass, reviewed = true }: { pass: boolean; reviewed?: boolean }) {
  if (!pass) return <span className="fail">기준 미달</span>;
  return reviewed ? <span className="pass">기준 충족</span> : <span className="pass">맞음(검수 전)</span>;
}

export function EvalScreen() {
  const d = demo();
  if (!d.ok) return <ErrorPanel errors={d.errors} />;
  const e = evaluateBundle(bundle, d.engine, d.patients, DEMO_NOW_MS);
  const survivors2 = e.mutation.survivors2.length;
  const screenKilled = bundle.mutationScreen.mutants.filter((m) => m.killed).length;
  const screenSurvivors = bundle.mutationScreen.mutants.length - screenKilled;

  return (
    <>
      <div className="note warn">
        <p>
          <strong>기대값: {e.expectedStatus}.</strong> 기대값 표는 파이썬 계산기가 앱 엔진 코드를 쓰지 않고 병원 규정 문서의 규칙을 다시 읽어 계산했습니다. 데이터·기대값·엔진을 같은 도구(Claude Code)로 만든 편향이 있어,
          오너가 달력으로 검수하기 전까지 정답이 아닙니다. 합성 데이터 기준입니다.
        </p>
      </div>

      <section className="card" aria-labelledby="h-metrics">
        <h2 id="h-metrics">PRD 6절 지표</h2>
        <div className="scroll-x">
          <table className="metrics">
            <thead>
              <tr>
                <th scope="col">지표</th>
                <th scope="col">분자 / 분모</th>
                <th scope="col">기준</th>
                <th scope="col">결과</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>일정 계산 정확도 (시점 날짜·상태, 직접 해 보기 가상 입력)</td>
                <td className="num">
                  {e.accuracy.matched} / {e.accuracy.total}
                </td>
                <td>전부</td>
                <td>
                  <Verdict pass={e.accuracy.matched === e.accuracy.total} reviewed={false} />
                </td>
              </tr>
              <tr>
                <td>기대값 대조 전체 (일정 + 오늘 목록·세 목록·미방문 연락·시간대)</td>
                <td className="num">
                  {e.allChecks.matched} / {e.allChecks.total}
                </td>
                <td>전부</td>
                <td>
                  <Verdict pass={e.allChecks.matched === e.allChecks.total} reviewed={false} />
                </td>
              </tr>
              <tr>
                <td>미방문 누락 (제자리에 오지 않은 심은 미방문)</td>
                <td className="num">
                  {e.missedOverdue.missing.length} / {e.missedOverdue.total}
                </td>
                <td>0건</td>
                <td>
                  <Verdict pass={e.missedOverdue.missing.length === 0} reviewed={false} />
                </td>
              </tr>
              <tr>
                <td>결정성 (같은 기준 시각으로 다시 만든 목록이 다름)</td>
                <td className="num">
                  {e.determinism.differing} / {e.determinism.runs}
                </td>
                <td>0건</td>
                <td>
                  <Verdict pass={e.determinism.differing === 0} />
                </td>
              </tr>
              <tr>
                <td>연락 가능 시간대 위반 (시간대 밖인데 &lsquo;지금 보내기&rsquo;)</td>
                <td className="num">
                  {e.window.violations} / {String(e.window.minutes).replace(/\B(?=(\d{3})+$)/g, ",")}분
                </td>
                <td>0건</td>
                <td>
                  <Verdict pass={e.window.violations === 0} />
                </td>
              </tr>
              <tr>
                <td>테스트가 결함을 잡는지 (코어에 심은 변이를 잡은 비율)</td>
                <td className="num">
                  {e.mutation.run2.killed} / {e.mutation.run2.total}
                  <br />
                  <span className="small muted">
                    1차 {e.mutation.run1.killed} / {e.mutation.run1.total}
                  </span>
                </td>
                <td>살아남은 변이도 싣는다</td>
                <td>{survivors2 === 0 ? <span className="pass">생존 0</span> : <span className="fail">생존 {survivors2}</span>}</td>
              </tr>
              <tr>
                <td>테스트가 결함을 잡는지 (화면 연결에 심은 변이)</td>
                <td className="num">
                  {screenKilled} / {bundle.mutationScreen.mutants.length}
                  <br />
                  <span className="small muted">
                    1차 {bundle.mutationScreen.firstRun.killed} / {bundle.mutationScreen.firstRun.total}
                  </span>
                </td>
                <td>살아남은 변이도 싣는다</td>
                <td>{screenSurvivors === 0 ? <span className="pass">생존 0</span> : <span className="fail">생존 {screenSurvivors}</span>}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small muted">
          결정성은 같은 입력으로 한 번 더, 환자 순서를 뒤집어서, 환자 순서를 돌려서 세 번 다시 만들어 첫 목록과 글자 그대로 비교했습니다. 시간대 위반은 기준일 하루 1,440분마다 문구를 만들어 연락 규정의 시간대(
          {d.engine.rules.contactWindow.start}~{d.engine.rules.contactWindow.end}, 끝 불포함)와 따로 대조했습니다. 엔진 판정(예약 시각이 시간대 안이고 만든 시각 뒤인지)과 환자 화면이 그리는 보내기 배지를
          둘 다 셉니다(엔진 {e.window.engineViolations} · 화면 {e.window.screenViolations}). 오늘 목록 문구 {e.window.messages.total}개 중 기준 시각 09:00에 &lsquo;지금 보내기&rsquo; {e.window.messages.now}개, 막힘{" "}
          {e.window.messages.blocked}개. 기대값은 오너 검수 전이라 기대값에 기대는 지표는 &lsquo;맞음(검수 전)&rsquo;으로 적었습니다.
        </p>
      </section>

      <section className="card" aria-labelledby="h-groups">
        <h2 id="h-groups">기대값 대조</h2>
        <div className="scroll-x">
          <table className="metrics">
            <thead>
              <tr>
                <th scope="col">대조</th>
                <th scope="col">맞음 / 전체</th>
              </tr>
            </thead>
            <tbody>
              {e.groups.map((g) => (
                <tr key={g.id}>
                  <td>{g.label}</td>
                  <td className="num">
                    {g.matched} / {g.total} {g.matched === g.total ? <span className="badge green">같음</span> : <span className="badge red">다름 {g.total - g.matched}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">시점은 날짜·미룬 사유·월말 규칙·상태·방문일 같은 항목을 모두 비교해, 모두 같을 때만 맞음으로 셉니다.</p>
        <details className="dev">
          <summary>개발자용 기록: 비교한 항목</summary>
          <p className="small muted">
            원래 날짜·미룬 날짜·미룬 날 목록·월말 clamp·공휴일 미확인·완료 인정 시작일(내원 시점만)·유예 끝·상태·방문일·지남 시작일·내일 내원 안내일. 안내 시점의 &lsquo;안내함 / 기록 없음&rsquo; 구분은 연락
            규정에 정의가 없어 표시용 해석(미룬 날짜 뒤 첫 연락이 유예 안)으로 맞췄습니다.
          </p>
        </details>
        <h3>틀린 사례</h3>
        {e.mismatches.length === 0 ? (
          <p>없습니다.</p>
        ) : (
          <div className="scroll-x">
            <table className="metrics">
              <thead>
                <tr>
                  <th scope="col">대조</th>
                  <th scope="col">대상</th>
                  <th scope="col">필드</th>
                  <th scope="col">기대</th>
                  <th scope="col">엔진</th>
                </tr>
              </thead>
              <tbody>
                {e.mismatches.map((m, i) => (
                  <tr key={i}>
                    <td>{m.group}</td>
                    <td>{m.target}</td>
                    <td>{m.field}</td>
                    <td>{m.expected}</td>
                    <td>{m.actual}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="h-planted">
        <h2 id="h-planted">심은 사례</h2>
        <p>
          심은 사례 <span className="num">{e.planted.caught}</span> / {e.planted.total}건을 의도대로 잡았습니다(오늘 이유·미방문 자리·의료진 확인이 모두 의도와 같을 때). 심은 미방문 {e.missedOverdue.total}건:{" "}
          {e.missedOverdue.ids.map((id, i) => (
            <span key={id}>
              {i > 0 && " "}
              <Link className="inline-hit" href={patientHref(id)}>
                {id}
              </Link>
            </span>
          ))}
          .
        </p>
        {e.planted.wrong.length > 0 && (
          <ul>
            {e.planted.wrong.map((w) => (
              <li key={w.id}>
                <Link className="inline-hit" href={patientHref(w.id)}>
                  {w.id}
                </Link>{" "}
                {w.story} — {w.problems.join(" / ")}
              </li>
            ))}
          </ul>
        )}
        <p className="small muted">심은 사례 목록과 의도는 data/README.md와 data/scripts/planted.json에 있습니다. 대조군(목록에 오면 틀린 환자) 8명도 여기에 들어 있습니다.</p>
      </section>

      <section className="card" aria-labelledby="h-mut">
        <h2 id="h-mut">변이 검사 기록</h2>
        <p>
          코드에 일부러 결함(변이)을 심고 시험이 그것을 잡는지 봤습니다. 2차에서 {e.mutation.run2.killed} / {e.mutation.run2.total}개를 잡았고, 살아남은 변이는 {survivors2}개입니다.
        </p>
        <details className="dev">
          <summary>개발자용 기록: 변이 계열과 1차 생존 변이</summary>
        <p className="small">
          {bundle.mutation._note} {e.mutation.runs.map((r) => `${r.label}: 시험 ${r.tests}개`).join(" · ")}.
        </p>
        <div className="scroll-x">
          <table className="metrics">
            <thead>
              <tr>
                <th scope="col">변이 계열</th>
                <th scope="col">1차 잡힘</th>
                <th scope="col">2차 잡힘</th>
              </tr>
            </thead>
            <tbody>
              {e.mutation.families.map((f) => (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td className="num">
                    {f.killed1} / {f.total}
                  </td>
                  <td className="num">
                    {f.killed2} / {f.total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>1차에서 살아남은 변이 {e.mutation.survivors1.length}개</h3>
        <ul>
          {e.mutation.survivors1.map((m) => (
            <li key={m.id}>
              {m.id} {m.desc}
            </li>
          ))}
        </ul>
        <p className="small muted">
          목록 안 정렬 6개, 규칙 파서 누락값 2개, 연락일 계산 1개였습니다. 각각을 잡는 시험(기대 순서는 손으로 정함)을 더한 뒤 2차에서 생존 {survivors2}개입니다.
        </p>
        </details>
      </section>

      <section className="card" aria-labelledby="h-known">
        <h2 id="h-known">대조로는 잡히지 않는 것 (오너 판단 필요)</h2>
        <ul>
          <li>
            <strong>휴진일 이동 방향.</strong> 이 데모는 휴진일에 걸린 시점을 늘 다음 진료일로 미룹니다. 그런데 수술 후 관리 문서는 D+7 내원을 D+6~D+9 안에서만 옮기게 하고, 주사 프로그램 문서는
            예정일 앞뒤 3일까지만 직원이 옮기게 합니다. 9/17 수술 환자의 D+7(9/24 추석)은 9/28로 미뤄져 D+11이 되고(창 밖, 창 안의 진료일은 9/23 하나), 9/24 주사 회차는 9/28로 +4일이 됩니다. 창 안에서
            당길지, 간호팀 확인으로 보낼지 정해야 합니다(직접 해 보기의 첫 예시가 이 경우입니다).
          </li>
          <li>
            사후관리 연락 규정의 문장끼리 부딪힙니다. &ldquo;미룬 날짜가 바로 오늘인 시점은 오늘 목록에 올리지 않습니다&rdquo;를 글자 그대로 읽으면 안내 시점도 빠지지만, 관리 안내 규칙은 &ldquo;미룬 날짜부터&rdquo;라고 씁니다.
            엔진·기대값 모두 앞 문장을 내원·사진 시점에만 적용해 <Link className="inline-hit" href={patientHref("P027")}>P027</Link>·<Link className="inline-hit" href={patientHref("P033")}>P033</Link>·<Link className="inline-hit" href={patientHref("P042")}>P042</Link>가 오늘 관리 안내에 오릅니다.
            문장에 &ldquo;내원·사진 시점은&rdquo;을 넣어 고정할지 정해야 합니다.
          </li>
          <li>data/README.md 계산 방법 5단계의 내일 내원 조건(&ldquo;그날 이후 연락이 없으면&rdquo;)은 연락 규정 본문에 없습니다. 지금 데이터에는 9/21 연락이 없어 결과가 같습니다.</li>
          <li>
            다시 연락할 날(마지막 연락 + 재연락 간격)이 휴진일이면 화면의 &lsquo;다음 연락&rsquo;은 다음 진료일로 미뤄 보입니다. 목록 판정은 규정 문장 그대로의 날짜로 하지만, 이 &lsquo;미뤄 보이기&rsquo;는 규정에 적혀
            있지 않습니다. 원장 확인 환자에게 다른 이유(내일 내원 등)가 함께 걸리는 경우도 데이터에 없어 시험되지 않았습니다.
          </li>
          <li>
            한 환자에게 성격이 다른 문자가 두 통 만들어지는 경우가 있습니다: 미방문 + 내일 내원(<Link className="inline-hit" href={patientHref("P013")}>P013</Link>), 미방문 + 주사 날짜 다시 잡기(
            <Link className="inline-hit" href={patientHref("P045")}>P045</Link>). 미방문 문구는 시점이 여럿이어도 가장 이른 것 하나로 줄였지만, 두 통을 한 통으로 합칠지(어떤 문구로)는 병원이 정할 일입니다.
          </li>
        </ul>
      </section>

      <section className="card" aria-labelledby="h-adopt">
        <h2 id="h-adopt">병원 도입 지표 (실제로 쓴다면 볼 것, 여기서는 재지 않음)</h2>
        <ul>
          <li>예정일 지남 환자 수의 추이</li>
          <li>연락 뒤 재방문율</li>
          <li>연락 한 건 처리 시간</li>
          <li>&lsquo;원장 확인&rsquo;으로 넘어간 환자 수</li>
        </ul>
      </section>
    </>
  );
}
