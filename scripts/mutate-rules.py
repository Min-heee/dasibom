#!/usr/bin/env python3
"""
v0.2.1 규칙 변이 검사(2026-09-28). 휴진 이동 범위(A·B·C), 수신 거부(D), 예약 잡음(E), 주사 재시작 14일 경계(F),
볼트 명칭(G), 예약과 재시작(H)에 결함을 심고 시험이 잡는지 본다. 변이마다 한 곳(또는 짝지은 몇 곳)을 글자로 바꾸고
npx vitest run에서 실패한 시험이 하나라도 있으면 '잡힘'.

저장소를 건드리지 않도록 임시 폴더에 복사해서 돌린다(node_modules는 링크). 저장소 루트에서:
    python3 scripts/mutate-rules.py            # 결과를 표로 출력(몇십 분 걸림)
    python3 scripts/mutate-rules.py F1 H1      # 고른 변이만
    python3 scripts/mutate-rules.py --json     # 변이마다 잡힘·실패한 시험 수를 json으로
기록은 data/mutation-rules-2026-09-28.json. 코어(v0.2)는 data/mutation-2026-09-28.json, 화면 연결은 scripts/mutate-screen.py.
"""
import json, os, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAL, SCH, ST, TD, PT, RU, VW, SC, SIM = ("src/core/calendar.ts", "src/core/schedule.ts", "src/core/status.ts", "src/core/today.ts", "src/core/patient.ts",
  "src/core/rules.ts", "src/demo/view.ts", "src/demo/screen.ts", "src/demo/sim.ts")
TDX, PTX, TRY = "src/app/_components/Today.tsx", "src/app/_components/Patient.tsx", "src/app/_components/Try.tsx"
LOOP_AFTER = "  for (let i = 1; i <= window.after; i++) {\n    const cur = addDays(d, i);\n    if (look(cur)) return { date: cur, direction: \"later\", skipped, holidayUnknown: unknown };\n  }\n"
LOOP_BEFORE = "  for (let i = 1; i <= window.before; i++) {\n    const cur = addDays(d, -i);\n    if (look(cur)) return { date: cur, direction: \"earlier\", skipped, holidayUnknown: unknown };\n  }\n"
RESTART = "diffDays(s.point.dueDate ?? s.point.originalDate, today) > s.point.restartAfterDays"
M = [
 # A 범위 무시하고 항상 다음 진료일
 ("A1", "범위 무시: 모든 시점을 다음 진료일로(shiftToOpenDay)", [(SCH, "    if (p.window) {\n      const w", "    if (false && p.window) {\n      const w")]),
 ("A2", "범위 뒤 경계 무시: after 대신 31일까지 미룸(앞당김·날짜 미정 사라짐)", [(CAL, "i <= window.after;", "i <= 31;")]),
 ("A3", "뒤 경계 off-by-one: after 날 제외(i < after)", [(CAL, "i <= window.after;", "i < window.after;")]),
 ("A4", "뒤 경계 off-by-one: after+1일까지", [(CAL, "i <= window.after;", "i <= window.after + 1;")]),
 ("A5", "앞 경계 off-by-one: before 날 제외(i < before)", [(CAL, "i <= window.before;", "i < window.before;")]),
 ("A6", "앞 경계 off-by-one: before+1일까지", [(CAL, "i <= window.before;", "i <= window.before + 1;")]),
 ("A7", "화면 허용 범위 끝을 after+1로 표시(windowRange)", [(SCH, "to: addDays(p.originalDate, p.window.after)", "to: addDays(p.originalDate, p.window.after + 1)")]),
 # B 앞당김 금지 / 순서
 ("B1", "앞당김 금지(before 루프 제거)", [(CAL, "i <= window.before;", "i <= 0;")]),
 ("B2", "앞당김을 먼저 보고 미룸은 나중(순서 뒤집기)", [(CAL, LOOP_AFTER + LOOP_BEFORE, LOOP_BEFORE + LOOP_AFTER)]),
 ("B3", "앞당길 때 가장 먼 날부터", [(CAL, "const cur = addDays(d, -i);", "const cur = addDays(d, -(window.before + 1 - i));")]),
 ("B4", "앞당김 방향을 later로 표시", [(CAL, "direction: \"earlier\"", "direction: \"later\"")]),
 ("B5", "규칙 검사: before > earlyDays 허용", [(RU, "before > earlyDays) {", "before > earlyDays + 99) {")]),
 ("B6", "목록 배지 '허용 범위 안 앞당김' 누락", [(VW, "if (pulled) out.push", "if (false && pulled) out.push")]),
 ("B7", "목록 줄 앞당김 문구를 '미룸'으로", [(VW, "return ` (원래 ${fs(p.originalDate)}, 허용 범위 안에서 앞당김)`;", "return ` (원래 ${fs(p.originalDate)}, 휴진으로 미룸)`;")]),
 ("B8", "타임라인 앞당김 설명 → 미룸 설명으로(case earlier 제거)", [(VW, "    case \"earlier\":\n      return `원래 ${fs(p.originalDate)}에서 앞당김", "    case \"earlier-x\" as string:\n      return `원래 ${fs(p.originalDate)}에서 앞당김")]),
 # C 범위 없음(날짜 미정) 표시 누락
 ("C1", "날짜 미정 시점을 간호팀 확인에 안 올림", [(TD, "for (const s of statuses) if (s.state === \"unscheduled\") nurse.push", "for (const s of statuses) if (false && s.state === \"unscheduled\") nurse.push")]),
 ("C2", "날짜 미정 대신 범위 밖 다음 진료일로 채움", [(SCH, "return { ...p, dueDate: w.date, shift: w.direction", "return { ...p, dueDate: w.date ?? shiftToOpenDay(p.originalDate, cal).date, shift: w.direction")]),
 ("C3", "shiftNote 날짜 미정에서 '→ 간호팀 확인' 빠짐", [(VW, "안에 진료일 없음(${describeShift(p)}) → 간호팀 확인`", "안에 진료일 없음(${describeShift(p)})`")]),
 ("C4", "타임라인 상태 '날짜 미정 · … → 간호팀 확인' → '날짜 미정'", [(VW, "label: \"날짜 미정 · 허용 범위 안에 진료일 없음 → 간호팀 확인\"", "label: \"날짜 미정\"")]),
 ("C5", "허용 범위 글자 표시 안 함(windowText null)", [(VW, "return r && p.window ?", "return false && r && p.window ?")]),
 ("C6", "직접 해 보기 날짜 미정 각주 누락", [(VW, "if (points.some((p) => p.shift === \"unresolved\")) notes.push(", "if (false) notes.push(")]),
 ("C7", "뒤 시점 완료 시 날짜 미정도 건너뜀 처리 안 함", [(ST, "(s.state === \"missed\" || s.state === \"unscheduled\") && laterDone", "s.state === \"missed\" && laterDone")]),
 ("C8", "간호팀 확인 줄(no-open-day)에서 허용 범위 빠짐", [(VW, "· 허용 범위 ${windowText(n.point!)} 안에 진료일 없음 → 간호팀 확인`", "· 안에 진료일 없음 → 간호팀 확인`")]),
 ("C9", "직접 해 보기 표 '허용 범위 안에 진료일 없음' 배지 누락", [(TRY, "{x.direction === \"unresolved\" && <span", "{false && x.direction === \"unresolved\" && <span")]),
 ("C10", "환자 화면 설명에서 no-open-day 문장 누락", [(SC, "(baseNurse.includes(\"no-open-day\") ?", "(false && baseNurse.includes(\"no-open-day\") ?")]),
 ("C11", "예약이 날짜 미정을 못 풂(unscheduled를 booking보다 먼저)", [(ST, "    if (booking) {\n      if (booking.date >= today)", "    if (p.dueDate === null && !visit) return { ...base, state: \"unscheduled\", graceEnd: null, date: null };\n    if (booking) {\n      if (booking.date >= today)")]),
 # D 수신 거부 무시
 ("D1", "수신 거부 무시(optOutOf 안 봄)", [(TD, "const opt = optOutOf(before);", "const opt = null as ReturnType<typeof optOutOf>;")]),
 ("D2", "수신 거부 풀기 무시(opt-in이 안 되돌림)", [(ST, "if (c.result === \"opt-out\" || c.result === \"opt-in\") last = c;", "if (c.result === \"opt-out\") last = c;")]),
 ("D3", "기준 시각 뒤의 수신 거부까지 봄", [(TD, "const opt = optOutOf(before);", "const opt = optOutOf(patient.contacts);")]),
 ("D4", "수신 거부여도 오늘 목록 항목 유지", [(TD, "items: [], nurse: [], optOut:", "items, nurse: [], optOut:")]),
 ("D5", "수신 거부여도 간호팀 확인 유지", [(TD, "items: [], nurse: [], optOut:", "items: [], nurse, optOut:")]),
 ("D6", "수신 거부여도 재연락 대기에 오름(continue 제거)", [(TD, "      });\n      continue;\n    }", "      });\n    }")]),
 ("D7", "수신 거부 환자를 의료진 확인에서도 뺌", [(TD, "if (day.symptoms.length > 0) clinicianReview.push", "if (day.symptoms.length > 0 && !day.optOut) clinicianReview.push")]),
 ("D8", "수신 거부·풀기를 '연락함'으로 셈(isAttempt 거르기 제거)", [(TD, "const contacts = before.filter(isAttempt);", "const contacts = before; void isAttempt;")]),
 ("D9", "수신 거부·풀기를 연락 시도로 셈", [(PT, "[\"called\", \"no-answer\", \"sms\", \"later\", \"booked\"] as const satisfies", "[\"called\", \"no-answer\", \"sms\", \"later\", \"booked\", \"opt-out\", \"opt-in\"] as const satisfies")]),
 ("D10", "수신 거부 줄의 held.waiting 항상 false", [(TD, "waiting: day.overdue?.action === \"waiting\" },", "waiting: false },")]),
 ("D11", "수신 거부 줄의 held.reasons 비움", [(TD, "held: { reasons: order.filter((r) => held.heldItems.some((i) => i.reason === r)),", "held: { reasons: [] as Reason[],")]),
 ("D12", "수신 거부 줄의 held.nurse 비움", [(TD, "nurse: held.heldNurse.map((n) => n.cause),", "nurse: [] as NurseCause[],")]),
 ("D13", "환자 화면 수신 거부 배지 누락", [(SC, "if (day.optOut) badges.push({ label: \"수신 거부\"", "if (false && day.optOut) badges.push({ label: \"수신 거부\"")]),
 ("D14", "연락 적은 뒤 결과 설명: 수신 거부 분기 제거", [(VW, "if (lastRec?.result === \"opt-out\") {", "if (false && lastRec?.result === \"opt-out\") {")]),
 # E 예약 날짜 지나도 계속 제외
 ("E1", "예약 날짜 지나도 계속 booked", [(ST, "if (booking.date >= today) return { ...base, state: \"booked\"", "if (true) return { ...base, state: \"booked\"")]),
 ("E2", "예약 다음 날까지 booked(하루 늦게 지남)", [(ST, "if (booking.date >= today) return { ...base, state: \"booked\"", "if (booking.date >= addDays(today, -1)) return { ...base, state: \"booked\"")]),
 ("E3", "예약 당일부터 지남(booking.date > today)", [(ST, "if (booking.date >= today) return { ...base, state: \"booked\"", "if (booking.date > today) return { ...base, state: \"booked\"")]),
 ("E4", "예약 지난 뒤 지남에 유예를 붙임", [(ST, "overdueSince: addDays(booking.date, 1)", "overdueSince: addDays(booking.date, 1 + p.graceDays)")]),
 ("E5", "예약 지난 뒤 원래 예정일 기준으로 되돌아감", [(ST, "    if (booking) {\n      if (booking.date >= today)", "    if (booking && booking.date >= today) {\n      if (booking.date >= today)")]),
 ("E6", "같은 시점 예약 여러 번이면 첫 예약 사용", [(ST, "m.set(c.booking.pointKey, c.booking);", "{ if (!m.has(c.booking.pointKey)) m.set(c.booking.pointKey, c.booking); }")]),
 ("E7", "기준 시각 뒤 예약까지 봄", [(TD, "evaluatePoints(schedule, patient.visits, today, before)", "evaluatePoints(schedule, patient.visits, today, patient.contacts)")]),
 ("E8", "예약 날짜 전날 '내일 내원' 안내 안 함", [(TD, "(s.state === \"upcoming\" || s.state === \"booked\")", "s.state === \"upcoming\"")]),
 ("E9", "재시작을 예약 날짜에서 셈", [(ST, RESTART, "diffDays(s.date ?? s.point.originalDate, today) > s.point.restartAfterDays")]),
 ("E10", "'예약일 지남' 배지를 '예약 잡음'으로", [(VW, "booked.reason === \"overdue\" ?", "false ?")]),
 ("E11", "규정보다 이른 예약 날 방문을 완료로 안 봄", [(ST, "booking && booking.date < nominalStart ? booking.date : nominalStart", "nominalStart")]),
 # F 14일 경계
 ("F1", "재시작 14일째부터(>=)", [(ST, RESTART, "diffDays(s.point.dueDate ?? s.point.originalDate, today) >= s.point.restartAfterDays")]),
 ("F2", "재시작 16일째부터(> +1)", [(ST, RESTART, "diffDays(s.point.dueDate ?? s.point.originalDate, today) > s.point.restartAfterDays + 1")]),
 ("F3", "재시작을 원래 날짜에서 셈", [(ST, RESTART, "diffDays(s.point.originalDate, today) > s.point.restartAfterDays")]),
 ("F4", "재시작을 지남이 된 날에서 셈", [(ST, RESTART, "diffDays(s.overdueSince!, today) > s.point.restartAfterDays")]),
 ("F5", "뒤 회차 재시작 전(on-hold) 처리 안 함", [(ST, "for (let i = first + 1; i < out.length; i++) {", "for (let i = out.length; i < out.length; i++) {")]),
 ("F6", "완료된 뒤 회차도 on-hold", [(ST, "s.state !== \"done\" && s.state !== \"skipped\"", "s.state !== \"skipped\"")]),
 ("F7", "재시작 회차를 간호팀으로 안 보냄", [(ST, "statuses.some((s) => s.restart) ?", "false ?"), (TD, "if (restart) nurse.push(", "if (false && restart) nurse.push(")]),
 ("F8", "규칙 검사: restartAfterDays == graceDays 허용", [(RU, "restartAfterDays <= graceDays) {", "restartAfterDays < graceDays) {")]),
 ("F9", "타임라인 재시작 일수를 원래 날짜에서 셈", [(VW, "label: `미방문 · 예정일에서 ${diffDays(s.point.dueDate ?? s.point.originalDate, today)}일", "label: `미방문 · 예정일에서 ${diffDays(s.point.originalDate, today)}일")]),
 ("F10", "간호팀 줄 재시작 일수 +1", [(VW, "에서 ${diffDays(due, today)}일 빠짐", "에서 ${diffDays(due, today) + 1}일 빠짐")]),
 ("F11", "재시작을 첫 회차가 아닌 마지막 해당 회차에", [(ST, "const first = out.findIndex(", "const first = out.findLastIndex(")]),
 # G 명칭 매핑 누락
 ("G1", "근거 문서 이름 매핑에서 V07 누락", [(VW, "{ V07: \"수술 후 관리 문서\", V08:", "{ V08:")]),
 ("G2", "근거 문서 이름 매핑에서 V08 누락", [(VW, ", V08: \"두피 주사 프로그램 문서\" }", " }")]),
 ("G3", "간호팀 까닭 no-open-day 라벨 누락(키 그대로)", [(TD, "\"no-open-day\": \"허용 범위 안에 진료일 없음\",", "\"no-open-day\": \"no-open-day\",")]),
 ("G4", "간호팀 까닭 injection-restart 라벨 → 원장 확인", [(TD, "\"injection-restart\": \"의료진 진료 뒤 재시작\",", "\"injection-restart\": \"원장 확인\",")]),
 ("G5", "간호팀 까닭 max-attempts 라벨 누락", [(TD, "\"max-attempts\": \"최대 시도까지 닿지 않음\",", "\"max-attempts\": \"max-attempts\",")]),
 ("G6", "연락 결과 opt-out 라벨 누락", [(PT, "\"opt-out\": \"연락 원치 않음\",", "\"opt-out\": \"opt-out\",")]),
 ("G7", "연락 결과 opt-in 라벨 누락", [(PT, "\"opt-in\": \"수신 거부 풀기\",", "\"opt-in\": \"opt-in\",")]),
 ("G8", "연락 결과 booked 라벨 누락", [(PT, "booked: \"예약 잡음\",", "booked: \"booked\",")]),
 ("G9", "오늘 화면 간호팀 확인 제목 → 원장 확인(2곳)", [(TDX, "<span className=\"badge orange\">간호팀 확인</span>", "<span className=\"badge orange\">원장 확인</span>", "all")]),
 ("G10", "환자 화면 간호팀 확인 → 원장 확인", [(PTX, "<strong>간호팀 확인</strong>", "<strong>원장 확인</strong>")]),
 ("G11", "환자 배지 '간호팀 확인 · ' → '원장 확인 · '", [(SC, "label: `간호팀 확인 · ${NURSE_CAUSE_LABEL[c]}`", "label: `원장 확인 · ${NURSE_CAUSE_LABEL[c]}`")]),
 ("G12", "규칙 바꿔 보기 힌트 문서 이름 → V07", [(SIM, "수술 후 관리 문서의 D+9", "V07의 D+9")]),
 ("G13", "간호팀 줄 재시작 '— 간호팀 확인' → '— 원장 확인'", [(VW, "→ 의료진 진료 뒤 재시작 — 간호팀 확인${booked}", "→ 의료진 진료 뒤 재시작 — 원장 확인${booked}")]),
 ("G14", "수신 거부 held 간호팀 라벨 → 원장 확인", [(VW, "`간호팀 확인(${NURSE_CAUSE_LABEL[c]})`", "`원장 확인(${NURSE_CAUSE_LABEL[c]})`")]),
 # H 예약과 재시작(독립 대조 뒤 추가: 14일 넘게 지난 뒤 앞날로 잡은 예약이 재시작을 가리던 결함)
 ("H1", "앞으로 잡힌 예약 회차를 재시작에서 뺌(고치기 전 동작)", [(ST, '(s.state === "missed" || s.state === "booked") && s.point.restartAfterDays', 's.state === "missed" && s.point.restartAfterDays')]),
 ("H2", "간호팀 줄에서 '예약 … 있음' 누락", [(VW, ': ` (예약 ${fs(b.date)} 있음)`', ': ""')]),
 ("H3", "타임라인에서 예약 잡은 재시작 회차를 파란 '예약 잡음'으로만", [(VW, "      if (s.restart) return { label: `예약 잡음 · ", "      if (false && s.restart) return { label: `예약 잡음 · ")]),
 ("H4", "간호팀 확인 정렬: 미방문 연락 상태 없는 재시작을 날짜 미정 뒤로", [(TD, 'r.items.some((i) => i.cause !== "no-open-day") ? 0 : 1', 'r.overdue && r.overdue.action === "nurse" ? 0 : 1')]),
]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    as_json = "--json" in sys.argv
    tmp = tempfile.mkdtemp(prefix="dasibom-mutr-")
    repo = os.path.join(tmp, "repo")
    shutil.copytree(ROOT, repo, ignore=shutil.ignore_patterns(".git", ".next", "out", "node_modules", "*.tsbuildinfo"))
    os.symlink(os.path.join(ROOT, "node_modules"), os.path.join(repo, "node_modules"))
    subprocess.run("npm run bundle", cwd=repo, shell=True, capture_output=True)
    res = []
    try:
        for mid, desc, edits in M:
            if args and mid not in args:
                continue
            orig = {}
            ok = True
            for e in edits:
                f, old, new = e[0], e[1], e[2]
                p = os.path.join(repo, f)
                cur = open(p, encoding="utf8").read()
                orig.setdefault(p, cur)
                n = cur.count(old)
                # 대상 글자가 없거나(코드가 바뀜) 여럿이면(어느 곳인지 모름) 변이를 심지 않고 알린다 — 조용히 '살아남음'이 되지 않게.
                if n == 0 or (n != 1 and not (len(e) > 3)):
                    ok = False
                    break
                open(p, "w", encoding="utf8").write(cur.replace(old, new))
            row = {"id": mid, "desc": desc}
            if ok:
                out = os.path.join(tmp, mid + ".json")
                subprocess.run(f"npx vitest run --reporter=json --outputFile={out}", cwd=repo, shell=True, capture_output=True)
                try:
                    j = json.load(open(out))
                    row.update(killed=j["numFailedTests"] > 0 or j["numFailedTestSuites"] > 0, failedTests=j["numFailedTests"], tests=j["numTotalTests"])
                except (OSError, ValueError, KeyError):
                    # 결과 파일이 없으면 시험이 돌지 못한 것(문법 오류 등) — 잡힌 것으로 본다.
                    row.update(killed=True, failedTests=None, tests=None)
            else:
                row.update(error="대상 글자를 찾지 못함")
            for p, s in orig.items():
                open(p, "w", encoding="utf8").write(s)
            res.append(row)
            if not as_json:
                print(mid, "잡힘" if row.get("killed") else ("오류 " + row["error"] if "error" in row else "살아남음"), row.get("failedTests"), desc, flush=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if as_json:
        print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
