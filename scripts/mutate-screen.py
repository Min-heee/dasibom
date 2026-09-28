#!/usr/bin/env python3
"""
화면 연결 변이 검사(적대 검토 뒤 2026-09-28). 화면 판단을 src/demo로 옮긴 뒤, "연락을 적었는데 화면이 그대로" 같은 결함을
시험이 잡는지 본다. 변이마다 한 곳을 글자로 바꾸고 시험·타입 검사·lint 중 하나라도 실패하면 '잡힘'.

저장소를 건드리지 않도록 임시 폴더에 복사해서 돌린다(node_modules는 링크). 저장소 루트에서:
    python3 scripts/mutate-screen.py            # 결과를 표로 출력
    python3 scripts/mutate-screen.py --json     # data/mutation-screen-2026-09-28.json 모양으로 출력
코어 변이 검사 기록은 data/mutation-2026-09-28.json(평가 화면에 실림)에 따로 있다.
"""
import json, os, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

M=[
 ("U1","첫 화면이 연락 기록을 무시(todayFor가 원본만)","src/demo/screen.ts","todayView(buildToday(currentPatients(base, log), engine, nowMs))","todayView(buildToday([...base], engine, nowMs))"),
 ("U2","환자 화면 상태를 연락 전 원본으로","src/demo/screen.ts","const day = evaluatePatient(current, engine, nowMs);","const day = evaluatePatient(basePatient, engine, nowMs);"),
 ("U3","연락 뒤 결과를 원본 환자로 계산","src/demo/screen.ts","afterContact(current, engine, nowMs)","afterContact(basePatient, engine, nowMs)"),
 ("U4","보내기 배지를 늘 초록 '지금 보내기'로","src/demo/view.ts",'return { label: timingText(m.timing), tone: m.timing.mode === "now" ? "green" : "orange" };','return { label: "지금 보내기 · 연락 가능 시간대 안", tone: "green" };'),
 ("U5","문구 만드는 시각 칩 무시(늘 09:00)","src/app/_components/Patient.tsx","const composeMs = kstInstant(DEMO_TODAY, composeAt);",'const composeMs = kstInstant(DEMO_TODAY, "09:00");'),
 ("U6","직접 해 보기 '다음 진료일로 미룸' 배지 제거","src/app/_components/Try.tsx",'{x.shifted && <span className="badge orange">다음 진료일로 미룸</span>}',"{null}"),
 ("U7","직접 해 보기 원래 날짜 칸에 잡힌 날짜","src/app/_components/Try.tsx","{x.original}","{x.due}"),
 ("U8","띠가 실제 시계를 읽음","src/app/_components/Chrome.tsx","{bandText(DEMO_NOW_MS)}","{bandText(Date.parse(Date()))}"),
 ("U9","규칙 바꿔 보기가 실제 시계를 읽음","src/app/_components/Rules.tsx","simulate(patients, engine, DEMO_NOW_MS, simOption(committed.optId)","simulate(patients, engine, Date.parse(Date()), simOption(committed.optId)"),
 ("U10","목록 줄에 첫 사유 줄만","src/app/_components/Today.tsx","{r.lines.map((l, i) => (","{r.lines.slice(0, 1).map((l, i) => ("),
 ("U11","묶음 개수를 줄 수로(사진 회차 0명)","src/demo/view.ts","count: allRows.filter((r) => r.reasons.includes(g.reason)).length,","count: g.rows.length,"),
 ("U12","저장값 모양 검사 제거","src/demo/storage.ts","      if (!isDemoEntry(a)) return drop;\n",""),
 ("U13","같은 환자 다시 누르면 쌓임(바꾸지 않음)","src/demo/storage.ts","const already = log.applied.some((a) => a.patientId === patientId && a.contact.at === DEMO_NOW);","const already = false;"),
 ("U14","적신호: 어절 넘는 적중 허용(원본 동작)","src/core/redflag.ts","if (!crosses || n.wordStart.has(i)) return true;","return true;"),
 ("U15","30일 예측 창을 내일부터","src/core/simulate.ts","  for (let i = 0; i < days; i++) {","  for (let i = 1; i <= days; i++) {"),
 ("U16","미방문 문자 한 통 줄이기 제거","src/demo/view.ts","      if (overdueDone) continue;\n",""),
 ("U17","원장 확인 설명 문장 제거","src/app/_components/Patient.tsx",'{v.badges.some((b) => b.label === "원장 확인") && <p className="small">최대 시도까지 연락해도 닿지 않아 코디네이터 목록에서 빠지고 원장 확인 목록에 있습니다.</p>}',"{null}"),
 ("U18","세 도구 줄 숨김(hidden)","src/app/_components/Chrome.tsx",'<p className="tools">','<p className="tools" hidden>'),
 ("U19","휴대폰 폭에서 세 도구 줄 숨김(CSS)","src/app/globals.css","  nav.tabs .tab-long {\n    display: none;\n  }","  nav.tabs .tab-long {\n    display: none;\n  }\n  .top .tools {\n    display: none;\n  }"),
]


def sh(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True).returncode


def main():
    tmp = tempfile.mkdtemp(prefix="dasibom-mut-")
    repo = os.path.join(tmp, "repo")
    shutil.copytree(ROOT, repo, ignore=shutil.ignore_patterns(".git", ".next", "out", "node_modules", "*.tsbuildinfo"))
    os.symlink(os.path.join(ROOT, "node_modules"), os.path.join(repo, "node_modules"))
    if sh("node scripts/build-bundle.mjs", repo) != 0 or sh("npx vitest run", repo) != 0:
        sys.exit("변이 전 시험이 이미 실패합니다")
    res = []
    try:
        for mid, desc, f, a, b in M:
            p = os.path.join(repo, f)
            s = open(p, encoding="utf8").read()
            if s.count(a) != 1:
                sys.exit(f"{mid}: 바꿀 글자를 한 곳에서 찾지 못했습니다({f})")
            open(p, "w", encoding="utf8").write(s.replace(a, b))
            t = sh("npx vitest run", repo) != 0
            tc = sh("npx tsc --noEmit", repo) != 0
            li = sh("npx eslint", repo) != 0
            res.append({"id": mid, "desc": desc, "file": f, "killed": t or tc or li, "by": [k for k, v in (("test", t), ("typecheck", tc), ("lint", li)) if v]})
            open(p, "w", encoding="utf8").write(s)
            print(f"{mid} {'잡힘' if res[-1]['killed'] else '살아남음'} {'·'.join(res[-1]['by'])} — {desc}", file=sys.stderr, flush=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if "--json" in sys.argv:
        print(json.dumps(res, ensure_ascii=False, indent=1))
    killed = sum(r["killed"] for r in res)
    print(f"잡힘 {killed} / {len(res)}", file=sys.stderr)


if __name__ == "__main__":
    main()
