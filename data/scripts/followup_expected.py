"""
다시봄 기대값 계산기 — 앱 엔진(TypeScript)과 따로 만든 독립 계산.

왜 따로 만드나: 엔진이 맞는지 보려면 엔진과 같은 코드로 만든 답을 쓰면 안 된다.
여기서는 볼트 문서(D01 사후관리 연락 규정, V02 진료시간·휴진)의 json과 본문 규칙을
파이썬 datetime으로 다시 옮겨 계산한다. 규칙 해석이 엔진과 다르면 평가에서 드러난다.

결과는 "AI가 계산, 오너 검수 전"이다. 오너가 달력을 보고 확인하기 전까지는 정답이 아니다.

실행: python3 data/scripts/followup_expected.py  (저장소 루트에서)
"""

from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AS_OF = "2026-09-21T09:00:00+09:00"
TODAY = dt.date(2026, 9, 21)
AS_OF_TIME = dt.time(9, 0)

DOW_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DOW_KO = "월화수목금토일"


def load_json_block(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    blocks = re.findall(r"^```json[ \t]*\n(.*?)\n```[ \t]*$", text, flags=re.S | re.M)
    if len(blocks) != 1:
        raise SystemExit(f"{path.name}: json 블록이 {len(blocks)}개")
    return json.loads(blocks[0])


def d(s: str) -> dt.date:
    return dt.date.fromisoformat(s)


def iso(x: dt.date | None) -> str | None:
    return x.isoformat() if x else None


class Rules:
    def __init__(self, root: Path = ROOT):
        self.policy = load_json_block(root / "vault" / "followup-policy.md")
        self.hours = load_json_block(root / "vault" / "hours-location.md")
        self.holidays = {d(h["date"]): h["name"] for h in self.policy["holidays"]}
        cov = self.policy["holidaysCoverage"]
        self.cov_from, self.cov_to = d(cov["from"]), d(cov["to"])
        self.extra = {d(x["date"]): x["reason"] for x in self.hours["extraClosedDates"]}

    # 휴진 이유. 진료일이면 None.
    def closed_reason(self, day: dt.date) -> str | None:
        if self.hours["weekly"][DOW_KEYS[day.weekday()]] is None:
            return "일요일"
        if day in self.holidays:
            return self.holidays[day]
        if day in self.extra:
            return self.extra[day]
        return None

    def in_coverage(self, day: dt.date) -> bool:
        return self.cov_from <= day <= self.cov_to

    def next_open(self, day: dt.date) -> tuple[dt.date, list[dict]]:
        shifts = []
        while (r := self.closed_reason(day)) is not None:
            shifts.append({"from": iso(day), "reason": r})
            day += dt.timedelta(days=1)
        return day, shifts

    def prev_open_before(self, day: dt.date) -> dt.date:
        day -= dt.timedelta(days=1)
        while self.closed_reason(day) is not None:
            day -= dt.timedelta(days=1)
        return day

    def hours_text(self, day: dt.date) -> str | None:
        w = self.hours["weekly"][DOW_KEYS[day.weekday()]]
        return f"{w['open']}~{w['close']}" if w else None


def add_months_clamp(start: dt.date, months: int) -> tuple[dt.date, bool]:
    y, m = divmod(start.month - 1 + months, 12)
    y += start.year
    m += 1
    last = (dt.date(y + (m == 12), m % 12 + 1, 1) - dt.timedelta(days=1)).day
    clamped = start.day > last
    return dt.date(y, m, min(start.day, last)), clamped


def plan_points(rules: Rules, p: dict) -> list[dict]:
    """환자 한 명의 관리 시점(원래 날짜·미룬 날짜·완료 창)."""
    start = d(p["startDate"])
    proc = rules.policy["procedures"]
    pts: list[dict] = []
    if p["procedure"] == "hair-transplant":
        for it in proc["hair-transplant"]:
            clamped = False
            if "offsetDays" in it:
                nominal = start + dt.timedelta(days=it["offsetDays"])
            else:
                nominal, clamped = add_months_clamp(start, it["offsetMonths"])
            pts.append({"key": it["key"], "kind": it["kind"], "nominal": nominal, "clamped": clamped,
                        "earlyDays": it["earlyDays"], "graceDays": it["graceDays"]})
    elif p["procedure"] == "injection":
        inj = proc["injection"]
        for n in range(2, inj["sessions"] + 1):
            nominal = start + dt.timedelta(days=inj["intervalDays"] * (n - 1))
            kind = "photo" if n in inj["photoSessions"] else "visit"
            pts.append({"key": f"{inj['keyPrefix']}{n}", "kind": kind, "nominal": nominal, "clamped": False,
                        "earlyDays": inj["earlyDays"], "graceDays": inj["graceDays"]})
    elif p["procedure"] == "scalp-care":
        sc = proc["scalp-care"]
        visits = [d(v["date"]) for v in p["visits"] if v["kind"] == sc["key"] and d(v["date"]) < TODAY]
        anchor = max([start] + visits)
        nominal = anchor + dt.timedelta(days=sc["intervalDays"])
        horizon, _ = add_months_clamp(start, sc["horizonMonths"])
        if nominal <= horizon:
            pts.append({"key": sc["key"], "kind": sc["kind"], "nominal": nominal, "clamped": False,
                        "earlyDays": sc["earlyDays"], "graceDays": sc["graceDays"], "anchor": anchor})
    else:
        raise SystemExit(f"{p['id']}: 모르는 시술 {p['procedure']}")
    for pt in pts:
        pt["due"], pt["shifts"] = rules.next_open(pt["nominal"])
        pt["windowStart"] = pt["nominal"] - dt.timedelta(days=pt["earlyDays"])
        pt["graceEnd"] = pt["due"] + dt.timedelta(days=pt["graceDays"])
        pt["holidayUnverified"] = not (rules.in_coverage(pt["nominal"]) and rules.in_coverage(pt["due"]))
    return pts


def contact_dates(p: dict) -> list[dt.date]:
    out = []
    for c in p["contacts"]:
        at = dt.datetime.fromisoformat(c["at"])
        if at < dt.datetime.fromisoformat(AS_OF):
            out.append(at.date())
    return sorted(out)


class RedFlag:
    """V11 목록으로 증상 표현을 찾는다. 한창구 redflag.ts를 옮긴 것이 아니라 문서 규칙을 다시 읽은 것."""

    def __init__(self, root: Path = ROOT):
        v = load_json_block(root / "vault" / "redflags.md")
        self.sym = v["symptoms"]
        self.amb = v["ambiguous"]
        self.ctx = v["postopContext"]
        self.pat = [re.compile(x) for x in v["postopContextPatterns"]]
        self.fever = v["feverThresholdCelsius"]

    def hits(self, text: str) -> dict:
        sym = [w for w in self.sym if w in text]
        for m in re.finditer(r"(\d{2}(?:\.\d)?)\s*도", text):
            if float(m.group(1)) >= self.fever:
                sym.append(m.group(0))
        amb = [w for w in self.amb if w in text]
        ctx = [w for w in self.ctx if w in text] + [x.pattern for x in self.pat if x.search(text)]
        return {"symptoms": sym, "ambiguous": amb, "context": ctx,
                "flag": bool(sym) or (bool(amb) and bool(ctx))}


def evaluate(rules: Rules, p: dict, rf: RedFlag) -> dict:
    pol = rules.policy
    pts = plan_points(rules, p)
    visits = [(d(v["date"]), v["kind"]) for v in p["visits"] if d(v["date"]) < TODAY]
    cdates = contact_dates(p)

    # 1) 방문 시점 완료 판정
    for pt in pts:
        if pt["kind"] == "notice":
            continue
        ok = sorted(vd for vd, k in visits if k == pt["key"] and vd >= pt["windowStart"])
        pt["visitDate"] = ok[0] if ok else None
        pt["done"] = bool(ok)
        pt["early"] = bool(ok) and ok[0] < pt["nominal"]
    # 2) 뒤 시점이 완료됐으면 앞 미완료 시점은 건너뜀
    visit_pts = [pt for pt in pts if pt["kind"] != "notice"]
    for i, pt in enumerate(visit_pts):
        pt["skipped"] = (not pt["done"]) and any(q["done"] for q in visit_pts[i + 1:])

    reasons: set[str] = set()
    overdue_pts = []
    for pt in pts:
        if pt["kind"] == "notice":
            sent = [c for c in cdates if c >= pt["due"]]
            if pt["due"] > TODAY:
                pt["status"] = "notice-upcoming"
            elif pt["due"] <= TODAY <= pt["graceEnd"] and not sent:
                pt["status"] = "notice-active"
                reasons.add("care-notice")
            elif sent and sent[0] <= pt["graceEnd"]:
                pt["status"] = "notice-sent"
            else:
                pt["status"] = "notice-missed"
            continue
        if pt["done"]:
            pt["status"] = "done-early" if pt["early"] else "done"
        elif pt["skipped"]:
            pt["status"] = "skipped"
        elif TODAY > pt["graceEnd"]:
            pt["status"] = "overdue"
            pt["overdueSince"] = pt["graceEnd"] + dt.timedelta(days=1)
            overdue_pts.append(pt)
        elif pt["due"] < TODAY:
            pt["status"] = "in-grace"
            if p["procedure"] == "injection":
                rebook_from = pt["due"] + dt.timedelta(days=1)
                if not [c for c in cdates if c >= rebook_from]:
                    reasons.add("injection-rebook")
        elif pt["due"] == TODAY:
            pt["status"] = "due-today"
        else:
            pt["status"] = "upcoming"
            reminder = rules.prev_open_before(pt["due"])
            pt["reminderDay"] = reminder
            if reminder == TODAY and not [c for c in cdates if c >= reminder]:
                reasons.add("upcoming-visit")
                if pt["kind"] == "photo":
                    reasons.add("photo-round")

    overdue = None
    if overdue_pts:
        since = min(pt["overdueSince"] for pt in overdue_pts)
        counted = [c for c in cdates if c >= since]
        attempts = len(counted)
        last = counted[-1] if counted else None
        if attempts >= pol["maxAttempts"]:
            state = "director-review"
            nxt = None
        elif attempts == 0:
            state = "listed"
            nxt = None
        else:
            retry_on = last + dt.timedelta(days=pol["retryIntervalDays"])
            state = "listed" if TODAY >= retry_on else "waiting"
            nxt = retry_on
        if state == "listed":
            reasons.add("overdue")
        worst = min(overdue_pts, key=lambda q: q["due"])
        overdue = {"state": state, "since": iso(since), "attempts": attempts, "lastContact": iso(last),
                   "retryOn": iso(nxt), "points": [q["key"] for q in overdue_pts],
                   "daysPastDue": (TODAY - worst["due"]).days, "pastDueKey": worst["key"]}

    flags = []
    for c in p["contacts"]:
        h = rf.hits(c.get("note", ""))
        if h["flag"]:
            flags.append({"at": c["at"], "symptoms": h["symptoms"], "ambiguous": h["ambiguous"], "context": h["context"]})

    order = pol["reasonOrder"]
    return {
        "points": pts,
        "reasons": [r for r in order if r in reasons],
        "overdue": overdue,
        "medicalReview": flags,
    }


def contact_window_state(t: dt.time, rules: Rules) -> str:
    w = rules.policy["contactWindow"]
    start = dt.time.fromisoformat(w["start"])
    end = dt.time.fromisoformat(w["end"])
    return "send-now" if start <= t < end else "send-later"


def point_json(pt: dict, rules: Rules) -> dict:
    out = {
        "key": pt["key"],
        "kind": pt["kind"],
        "nominal": iso(pt["nominal"]),
        "due": iso(pt["due"]),
        "dueDow": DOW_KO[pt["due"].weekday()],
        "shifted": pt["shifts"],
        "monthEndClamped": pt["clamped"],
        "windowStart": iso(pt["windowStart"]),
        "graceEnd": iso(pt["graceEnd"]),
        "status": pt["status"],
    }
    if pt.get("visitDate"):
        out["visitDate"] = iso(pt["visitDate"])
    if pt.get("reminderDay"):
        out["reminderDay"] = iso(pt["reminderDay"])
    if pt.get("overdueSince"):
        out["overdueSince"] = iso(pt["overdueSince"])
    if pt["holidayUnverified"]:
        out["holidayUnverified"] = True
    return out


def main() -> None:
    rules = Rules()
    rf = RedFlag()
    patients = json.loads((ROOT / "data" / "patients.json").read_text(encoding="utf-8"))
    detail_ids = json.loads((ROOT / "data" / "scripts" / "expected_ids.json").read_text(encoding="utf-8"))

    today_list, director, waiting, medical = [], [], [], []
    detailed = []
    for p in patients:
        ev = evaluate(rules, p, rf)
        if ev["reasons"]:
            today_list.append({"id": p["id"], "reasons": ev["reasons"]})
        if ev["overdue"] and ev["overdue"]["state"] == "director-review":
            director.append(p["id"])
        if ev["overdue"] and ev["overdue"]["state"] == "waiting":
            waiting.append({"id": p["id"], "retryOn": ev["overdue"]["retryOn"]})
        if ev["medicalReview"]:
            medical.append(p["id"])
        if p["id"] in detail_ids:
            detailed.append({
                "id": p["id"],
                "procedure": p["procedure"],
                "startDate": p["startDate"],
                "points": [point_json(pt, rules) for pt in ev["points"]],
                "todayReasons": ev["reasons"],
                "overdue": ev["overdue"],
                "medicalReview": ev["medicalReview"],
            })

    # 직접 해 보기(F10)용 가상 입력: 데이터 환자가 아닌 계산 사례.
    hypo = []
    for hid, start, note in [
        ("H1", "2026-01-31", "1월 31일 기준. 2026-01-31은 토요일(수술 없는 요일)이라 환자 데이터에는 넣지 않고 계산 사례로만 둔다."),
        ("H2", "2027-04-09", "직접 해 보기 입력 예: 6개월이 2027-10-09(한글날, 토) → 10/10(일) → 10/11(대체공휴일) → 10/12로 세 번 미뤄짐. 1년은 2028년이라 공휴일 미확인."),
        ("H3", "2027-08-31", "윤년 월말: 6개월 = 2028-02-29(clamp). 2028년은 공휴일 미확인이라 일요일·추가 휴진만 반영."),
    ]:
        pts = plan_points(rules, {"id": hid, "procedure": "hair-transplant", "startDate": start, "visits": [], "contacts": []})
        hypo.append({"id": hid, "procedure": "hair-transplant", "startDate": start, "note": note,
                     "points": [{"key": pt["key"], "nominal": iso(pt["nominal"]), "due": iso(pt["due"]),
                                 "dueDow": DOW_KO[pt["due"].weekday()], "shifted": pt["shifts"],
                                 "monthEndClamped": pt["clamped"],
                                 **({"holidayUnverified": True} if pt["holidayUnverified"] else {})} for pt in pts]})

    out = {
        "_status": "AI가 계산, 오너 검수 전",
        "_method": "data/README.md '기대값 계산 방법' 참고. data/scripts/followup_expected.py(파이썬 datetime, 앱 엔진 코드 미사용).",
        "asOf": AS_OF,
        "contactWindowAtAsOf": contact_window_state(AS_OF_TIME, rules),
        "contactWindowChecks": [
            {"time": t, "expected": contact_window_state(dt.time.fromisoformat(t), rules)}
            for t in ["08:59", "09:00", "19:59", "20:00", "21:30"]
        ],
        "todayList": today_list,
        "directorReview": director,
        "waitingRetry": waiting,
        "medicalReview": medical,
        "patients": detailed,
        "hypotheticals": hypo,
    }
    (ROOT / "data" / "expected-schedule.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"todayList {len(today_list)}명, 원장 확인 {len(director)}명, 재연락 대기 {len(waiting)}명, 의료진 확인 {len(medical)}명, 상세 {len(detailed)}명")


if __name__ == "__main__":
    main()
