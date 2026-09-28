"""
합성 환자 120명 생성기. 심은 사례(P001~P045)는 손으로 정하고, 나머지(P046~P120)는
시드 고정 난수로 만들되 기준 시각 목록에 걸리지 않는 '조용한' 환자만 남긴다.

왜 조용한 환자만: 심은 사례표(data/README.md)가 오늘 목록의 전부가 되어야 평가에서
"심은 미방문을 모두 잡았나"와 "엉뚱한 환자를 올렸나"를 함께 볼 수 있다.

심은 사례의 의도는 followup_expected.py(독립 계산)로 다시 확인한다. 의도와 계산이 다르면 멈춘다.

실행: python3 data/scripts/generate_patients.py  (저장소 루트에서)
"""

from __future__ import annotations

import datetime as dt
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import followup_expected as fx  # noqa: E402

ROOT = fx.ROOT
TODAY = fx.TODAY
rules = fx.Rules()
rf = fx.RedFlag()

# 2026-09 이전의 실제 공휴일. D01 목록(2026-09~)에는 넣지 않았으므로 엔진은 이 날을 진료일로 본다.
# 그 차이가 결과를 흔들지 않게, 방문·연락·수술일을 이 날에 두지 않는다(생성기 전용 회피 목록).
PRE_COVERAGE_REAL_HOLIDAYS = {fx.d(x) for x in [
    "2025-10-03", "2025-10-05", "2025-10-06", "2025-10-07", "2025-10-08", "2025-10-09", "2025-12-25",
    "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-02", "2026-05-01", "2026-05-05",
    "2026-05-25", "2026-06-03", "2026-07-17", "2026-08-17",
]}

PREFIX = ["봄", "여름", "가을", "겨울", "새벽", "노을", "바람", "들꽃", "은빛", "푸른", "맑은", "고요한"]
NOUN = ["구름", "바다", "숲", "별", "강", "달", "들", "섬", "길", "솔"]


def usable(day: dt.date) -> bool:
    return rules.closed_reason(day) is None and day not in PRE_COVERAGE_REAL_HOLIDAYS and day < TODAY


def D(s: str) -> dt.date:
    return fx.d(s)


def c(day: str, hm: str, result: str, note: str) -> dict:
    assert usable(D(day)), f"연락일이 진료일이 아님: {day}"
    return {"at": f"{day}T{hm}:00+09:00", "result": result, "note": note}


def normal_visits(p: dict, missed: set[str] = frozenset(), early: dict | None = None) -> list[dict]:
    """미룬 날짜가 기준일 전인 방문 시점마다 그날 방문 기록을 만든다(빠진 시점·일찍 온 시점은 따로)."""
    early = early or {}
    out = []
    for pt in fx.plan_points(rules, {**p, "visits": [], "contacts": []}):
        if pt["kind"] == "notice" or pt["key"] in missed:
            continue
        if pt["key"] in early:
            out.append({"date": early[pt["key"]], "kind": pt["key"]})
            continue
        if pt["due"] >= TODAY:
            continue
        day = pt["due"]
        while not usable(day):
            day += dt.timedelta(days=1)
        if day < TODAY:
            out.append({"date": day.isoformat(), "kind": pt["key"]})
    return out


def P(pid, proc, start, *, missed=(), early=None, visits=None, contacts=(), expect, cats, story):
    assert rules.closed_reason(D(start)) is None and D(start) not in PRE_COVERAGE_REAL_HOLIDAYS, f"{pid} 시작일 휴진"
    if proc == "hair-transplant":
        assert D(start).weekday() != 5, f"{pid}: 토요일은 수술하지 않음"
    base = {"id": pid, "procedure": proc, "startDate": start}
    v = visits if visits is not None else normal_visits(base, set(missed), early)
    for x in v:
        assert usable(D(x["date"])), f"{pid} 방문일 휴진: {x}"
    return {**base, "visits": sorted(v, key=lambda x: x["date"]), "contacts": sorted(contacts, key=lambda x: x["at"]),
            "_expect": expect, "_cats": cats, "_story": story}


HT, INJ, SC = "hair-transplant", "injection", "scalp-care"
NA, SMS, CALLED, LATER = "no-answer", "sms", "called", "later"

# expect = (오늘 이유 목록, 예정일 지남 상태 listed|waiting|director-review|None, 의료진 확인 여부)
planted = [
    P("P001", HT, "2026-03-09", missed={"m6"}, contacts=[
        c("2026-09-08", "11:00", SMS, "내원 안내 문자 발송"),
        c("2026-09-17", "10:30", NA, "부재중"),
        c("2026-09-18", "16:10", NA, "받지 않음")],
      expect=(["overdue"], "listed", False), cats=["지남:재연락 간격 지남"],
      story="6개월 경과 진료(9/9) 12일 지남, 부재 2회. 9/8 사전 안내 문자는 지남 전이라 세지 않음. 마지막 연락 9/18+3일=9/21 → 오늘 다시 목록"),
    P("P002", HT, "2026-03-10", missed={"m6"}, contacts=[
        c("2026-09-18", "10:10", NA, "부재중"),
        c("2026-09-19", "11:00", NA, "통화 연결 안 됨")],
      expect=([], "waiting", False), cats=["지남:재연락 간격 전"],
      story="6개월(9/10) 지남, 마지막 연락 9/19 → 9/22부터 다시. 오늘은 목록에 없음"),
    P("P003", HT, "2026-03-04", missed={"m6"}, contacts=[
        c("2026-09-12", "10:40", NA, "부재중"),
        c("2026-09-15", "14:00", NA, "받지 않음"),
        c("2026-09-18", "15:30", SMS, "예약 안내 문자 보냄")],
      expect=([], "director-review", False), cats=["지남:최대 시도 초과→원장 확인"],
      story="6개월(9/4) 지남, 연락 3회 = maxAttempts → 원장 확인"),
    P("P004", HT, "2026-08-10", missed={"w4"},
      expect=(["overdue"], "listed", False), cats=["지남:첫 연락"],
      story="4주(9/7) 유예 7일 끝(9/14), 9/15부터 지남. 연락 없음"),
    P("P005", HT, "2026-09-09", missed={"d7"}, contacts=[
        c("2026-09-12", "10:15", SMS, "머리 감기 안내 문자 발송")],
      expect=(["overdue"], "listed", False), cats=["지남:첫 연락"],
      story="D+7(9/16) 유예 2일 끝(9/18), 9/19부터 지남. 9/12 문자는 D+3 안내라 세지 않음"),
    P("P006", HT, "2025-09-03", missed={"y1"},
      expect=(["overdue"], "listed", False), cats=["지남:첫 연락"],
      story="1년(2026-09-03) 유예 14일 끝(9/17), 9/18부터 지남"),
    P("P007", HT, "2026-08-12", missed={"w4"}, contacts=[
        c("2026-09-17", "14:20", CALLED, "통화함. 이번 주 안에 예약하겠다고 함")],
      expect=(["overdue"], "listed", False), cats=["지남:재연락 간격 지남"],
      story="4주(9/9) 지남. 9/17 통화했지만 오지 않음 → 통화도 1회, 9/20부터 다시"),
    P("P008", INJ, "2026-07-27", missed={"inj-4", "inj-5"}, contacts=[
        c("2026-09-14", "17:00", LATER, "다음 주에 다시 연락 달라고 함")],
      expect=(["overdue"], "listed", False), cats=["지남:재연락 간격 지남"],
      story="주사 4회차(9/7) 유예 3일 끝, 9/11부터 지남. '다음에'(9/14)+3일=9/17. 5회차는 오늘(9/21) 예정이라 목록 이유 아님"),
    P("P009", INJ, "2026-06-29", missed={"inj-5", "inj-6", "inj-7"}, contacts=[
        c("2026-08-28", "10:20", NA, "부재중"),
        c("2026-09-01", "15:40", NA, "받지 않음"),
        c("2026-09-04", "11:10", NA, "부재중")],
      expect=([], "director-review", False), cats=["지남:최대 시도 초과→원장 확인"],
      story="주사 5·6회차 지남(8/28부터), 부재 3회 → 원장 확인"),
    P("P010", HT, "2026-03-12", missed={"m6"},
      expect=(["overdue"], "listed", False), cats=["지남:유예 경계"],
      story="6개월(9/12 토) 유예 끝 9/19, 9/20부터 지남"),
    P("P011", HT, "2026-03-13", missed={"m6"},
      expect=([], None, False), cats=["휴진 밀림", "대조:유예 중"],
      story="6개월 원래 9/13(일) → 9/14로 미룸, 유예 끝 9/21 → 아직 지남 아님. 휴진 무시 변이면 9/21 지남으로 잘못 올라옴"),
    P("P012", HT, "2026-08-13", missed={"w4"}, contacts=[
        c("2026-09-18", "11:20", CALLED, "통화함. 이식 부위가 붓고 열감이 있다고 해서 간호팀에 전달함")],
      expect=(["overdue"], "listed", True), cats=["지남:재연락 간격 지남", "증상 기록→의료진 확인"],
      story="4주(9/10) 지남, 9/18 통화 +3일=9/21. 연락 기록에 '붓고·열감'+'이식' → 의료진 확인"),
    P("P013", INJ, "2026-08-11", missed={"inj-3"},
      expect=(["overdue", "upcoming-visit"], "listed", False), cats=["지남:첫 연락", "내일 내원", "여러 이유"],
      story="주사 3회차(9/8) 지남 + 4회차 내일(9/22)"),
    P("P014", HT, "2026-09-07", missed={"d7"}, contacts=[
        c("2026-09-10", "10:00", SMS, "머리 감기 안내 문자 발송")],
      expect=(["overdue", "care-notice"], "listed", False), cats=["지남:첫 연락", "여러 이유"],
      story="D+7(9/14) 9/17부터 지남 + D+14 안내 오늘(9/21)"),
    P("P015", HT, "2026-07-21", missed={"d7"},
      expect=([], None, False), cats=["대조:뒤 시점 완료로 건너뜀"],
      story="D+7(7/28) 안 왔지만 4주(8/18)에 옴 → D+7은 건너뜀, 목록에 없음"),
    P("P016", HT, "2026-09-16", missed={"d1"},
      expect=(["overdue"], "listed", False), cats=["지남:첫 연락"],
      story="D+1(9/17) 유예 1일 끝 9/18, 9/19부터 지남. D+7(9/23)은 내일이 아님(안내일 9/22)"),
    P("P017", INJ, "2026-08-20", missed={"inj-2", "inj-3"}, contacts=[
        c("2026-09-07", "10:30", NA, "부재중"),
        c("2026-09-10", "13:00", SMS, "예약 안내 문자 보냄")],
      expect=(["overdue"], "listed", False), cats=["지남:재연락 간격 지남"],
      story="주사 2회차(9/3) 9/7부터 지남, 연락 2회(마지막 9/10) → 다시 목록. 3회차(9/17)도 지남"),

    P("P018", HT, "2026-09-15", contacts=[c("2026-09-18", "10:00", SMS, "머리 감기 안내 문자 발송")],
      expect=(["upcoming-visit", "photo-round"], None, False), cats=["내일 내원", "사진 회차", "여러 이유"],
      story="D+7 내일(9/22), 사진 시점"),
    P("P019", HT, "2026-08-25", contacts=[c("2026-09-08", "10:20", SMS, "2주 안내 문자 발송")],
      expect=(["upcoming-visit"], None, False), cats=["내일 내원"],
      story="4주 내일(9/22)"),
    P("P020", HT, "2025-09-22",
      expect=(["upcoming-visit", "photo-round"], None, False), cats=["내일 내원", "사진 회차", "여러 이유"],
      story="1년 내일(2026-09-22), 사진 시점"),
    P("P021", INJ, "2026-09-08",
      expect=(["upcoming-visit"], None, False), cats=["내일 내원"],
      story="주사 2회차 내일(9/22)"),
    P("P022", INJ, "2026-07-28",
      expect=(["upcoming-visit", "photo-round"], None, False), cats=["내일 내원", "사진 회차", "여러 이유"],
      story="주사 5회차 내일(9/22), 사진 회차"),
    P("P023", INJ, "2026-06-16",
      expect=(["upcoming-visit"], None, False), cats=["내일 내원"],
      story="주사 8회차 내일(9/22)"),
    P("P024", HT, "2026-08-25", early={"w4": "2026-09-19"},
      expect=([], None, False), cats=["조금 일찍 방문", "대조"],
      story="4주 예정 9/22, 9/19(3일 전 = earlyDays 경계)에 옴 → 완료, 내일 내원 목록에 없음"),
    P("P025", INJ, "2026-08-25", early={"inj-3": "2026-09-19"},
      expect=([], None, False), cats=["조금 일찍 방문", "대조"],
      story="주사 3회차 예정 9/22, 9/19(3일 전)에 옴 → 완료"),
    P("P026", HT, "2026-09-08", early={"d7": "2026-09-14"}, contacts=[c("2026-09-11", "11:30", SMS, "머리 감기 안내 문자 발송")],
      expect=([], None, False), cats=["조금 일찍 방문", "대조"],
      story="D+7 예정 9/15, 9/14(1일 전)에 옴 → 완료. D+14 안내는 9/22"),

    P("P027", HT, "2026-09-17",
      expect=(["care-notice"], None, False), cats=["휴진 밀림"],
      story="D+3 원래 9/20(일) → 9/21 안내 오늘. D+7 원래 9/24(추석 연휴) → 9/28"),
    P("P028", HT, "2026-08-28", contacts=[c("2026-09-11", "10:40", SMS, "2주 안내 문자 발송")],
      expect=([], None, False), cats=["휴진 밀림"],
      story="4주 원래 9/25(추석) → 9/28, 안내일은 9/23"),
    P("P029", HT, "2026-03-26",
      expect=([], None, False), cats=["휴진 밀림"],
      story="6개월 원래 9/26(추석 연휴, 토) → 9/28"),
    P("P030", INJ, "2026-09-10",
      expect=([], None, False), cats=["휴진 밀림"],
      story="주사 2회차 원래 9/24(추석 연휴) → 9/28"),
    P("P031", HT, "2026-04-03",
      expect=([], None, False), cats=["휴진 밀림"],
      story="6개월 원래 10/3(개천절) → 10/4(일) → 10/5(대체공휴일) → 10/6"),
    P("P032", HT, "2026-04-09",
      expect=([], None, False), cats=["휴진 밀림"],
      story="6개월 원래 10/9(한글날) → 10/10(토)"),
    P("P033", HT, "2026-09-18",
      expect=(["care-notice"], None, False), cats=["휴진 밀림"],
      story="D+3 오늘(9/21) 안내. D+7 원래 9/25 → 9/28, 4주 원래 10/16(내부 교육 휴진) → 10/17"),
    P("P034", HT, "2026-03-20",
      expect=([], None, False), cats=["휴진 밀림", "대조:오늘이 예정일"],
      story="6개월 원래 9/20(일) → 9/21(오늘). 오늘이 예정일이면 목록에 없음(전날 안내)"),
    P("P035", SC, "2026-07-30", visits=[{"date": "2026-08-27", "kind": "scalp-care"}],
      expect=([], None, False), cats=["휴진 밀림"],
      story="두피 관리 다음 안내 원래 9/24(추석 연휴) → 9/28"),

    P("P036", HT, "2026-03-31",
      expect=([], None, False), cats=["월말"],
      story="3/31 수술: 6개월 = 9/30(clamp), 1년 = 2027-03-31"),
    P("P037", HT, "2026-08-31", contacts=[c("2026-09-14", "10:50", SMS, "2주 안내 문자 발송")],
      expect=([], None, False), cats=["월말", "휴진 밀림"],
      story="8/31 수술: 6개월 = 2027-02-28(clamp, 일) → 3/1(3·1절) → 3/2. 4주 = 9/28"),
    P("P038", HT, "2025-10-31",
      expect=([], None, False), cats=["월말"],
      story="10/31 수술: 6개월 = 2026-04-30(clamp, 방문 완료), 1년 = 2026-10-31(토)"),

    P("P039", INJ, "2026-07-24", missed={"inj-5"}, contacts=[
        c("2026-09-17", "15:00", SMS, "문자 회신: 지난번 주사 맞은 뒤 두드러기가 올라왔다고 함. 간호팀 전달")],
      expect=(["injection-rebook"], None, True), cats=["주사 재예약", "증상 기록→의료진 확인"],
      story="주사 5회차(9/18) 안 옴, 유예 3일 안 → 재예약. 9/17 연락 기록에 '두드러기' → 의료진 확인"),
    P("P040", INJ, "2026-08-22", missed={"inj-3"},
      expect=(["injection-rebook"], None, False), cats=["주사 재예약"],
      story="주사 3회차(9/19 토) 안 옴, 유예 안 → 재예약"),
    P("P041", INJ, "2026-08-21", missed={"inj-3"}, contacts=[c("2026-09-19", "10:30", SMS, "예약 안내 문자 보냄")],
      expect=([], None, False), cats=["대조:재예약 연락 이미 함"],
      story="주사 3회차(9/18) 안 옴, 9/19에 연락함 → 목록에 없음"),
    P("P042", SC, "2026-06-29", visits=[{"date": "2026-07-27", "kind": "scalp-care"}, {"date": "2026-08-24", "kind": "scalp-care"}],
      expect=(["care-notice"], None, False), cats=["관리 안내"],
      story="마지막 두피 관리 8/24 + 28일 = 9/21 안내"),
    P("P043", SC, "2026-07-25", visits=[{"date": "2026-08-22", "kind": "scalp-care"}],
      expect=(["care-notice"], None, False), cats=["관리 안내"],
      story="8/22 + 28일 = 9/19, 유예 3일 안(9/22까지)이고 연락 없음"),
    P("P044", SC, "2026-07-25", visits=[{"date": "2026-08-22", "kind": "scalp-care"}],
      contacts=[c("2026-09-19", "11:00", SMS, "다음 관리 일정 안내 문자 보냄")],
      expect=([], None, False), cats=["대조:관리 안내 이미 함"],
      story="9/19 안내 시점에 이미 문자 보냄 → 목록에 없음"),
    P("P045", INJ, "2026-08-07", missed={"inj-3", "inj-4"},
      expect=(["overdue", "injection-rebook"], "listed", False), cats=["지남:첫 연락", "주사 재예약", "여러 이유"],
      story="주사 3회차(9/4) 9/8부터 지남 + 4회차(9/18) 유예 안"),
]


def check_planted(p: dict) -> None:
    ev = fx.evaluate(rules, p, rf)
    reasons, state, med = p["_expect"]
    got_state = ev["overdue"]["state"] if ev["overdue"] else None
    problems = []
    if ev["reasons"] != reasons:
        problems.append(f"이유 {ev['reasons']} != 의도 {reasons}")
    if got_state != state:
        problems.append(f"지남 상태 {got_state} != 의도 {state}")
    if bool(ev["medicalReview"]) != med:
        problems.append(f"의료진 확인 {bool(ev['medicalReview'])} != 의도 {med}")
    if problems:
        raise SystemExit(f"{p['id']}: " + "; ".join(problems))


def rand_day(rng: random.Random, lo: str, hi: str, *, no_sat=False) -> dt.date:
    a, b = D(lo), D(hi)
    while True:
        x = a + dt.timedelta(days=rng.randrange((b - a).days + 1))
        if usable(x) and not (no_sat and x.weekday() == 5):
            return x


NEUTRAL = {
    SMS: ["내원 안내 문자 발송", "예약 안내 문자 보냄"],
    CALLED: ["통화함. 예약 날짜 확인", "통화함. 예약 시간 확인"],
}


def filler(rng: random.Random, pid: str, proc: str) -> dict:
    for _ in range(500):
        if proc == HT:
            start = rand_day(rng, "2025-09-25", "2026-09-12", no_sat=True)
        elif proc == INJ:
            start = rand_day(rng, "2026-03-02", "2026-09-14")
        else:
            start = rand_day(rng, "2026-01-05", "2026-09-10")
        base = {"id": pid, "procedure": proc, "startDate": start.isoformat()}
        contacts = []
        if proc == SC:
            visits, cur = [], start
            gap = rng.choice([21, 24, 28, 28, 30, 35])
            while True:
                nxt = cur + dt.timedelta(days=gap + rng.randrange(-3, 4))
                while nxt < TODAY and not usable(nxt):
                    nxt += dt.timedelta(days=1)
                if nxt >= TODAY - dt.timedelta(days=rng.choice([1, 3, 10])):
                    break
                visits.append({"date": nxt.isoformat(), "kind": "scalp-care"})
                cur = nxt
        else:
            visits = []
            for pt in fx.plan_points(rules, {**base, "visits": [], "contacts": []}):
                if pt["kind"] == "notice" or pt["due"] >= TODAY:
                    continue
                shift = rng.choice([0, 0, 0, 0, -1, 1, 2]) if pt["earlyDays"] or pt["graceDays"] > 1 else 0
                day = max(pt["due"] + dt.timedelta(days=shift), pt["windowStart"])
                while not usable(day) and day < TODAY:
                    day += dt.timedelta(days=1)
                if day >= TODAY:
                    continue
                visits.append({"date": day.isoformat(), "kind": pt["key"]})
                if rng.random() < 0.3:
                    rem = rules.prev_open_before(pt["due"])
                    if usable(rem):
                        res = rng.choice([SMS, SMS, CALLED])
                        contacts.append({"at": f"{rem.isoformat()}T{rng.randrange(10, 19):02d}:{rng.choice(['00', '10', '20', '30', '40', '50'])}:00+09:00",
                                         "result": res, "note": rng.choice(NEUTRAL[res])})
        p = {**base, "visits": sorted(visits, key=lambda x: x["date"]), "contacts": sorted(contacts, key=lambda x: x["at"])}
        ev = fx.evaluate(rules, p, rf)
        if not ev["reasons"] and not ev["overdue"] and not ev["medicalReview"]:
            return p
    raise SystemExit(f"{pid}: 조용한 환자를 만들지 못함")


def main() -> None:
    rng = random.Random(20260921)
    aliases = [f"{a} {b}" for a in PREFIX for b in NOUN]
    rng.shuffle(aliases)

    for p in planted:
        check_planted(p)

    kinds = [HT] * 20 + [INJ] * 27 + [SC] * 28
    rng.shuffle(kinds)
    fillers = [filler(rng, f"P{i:03d}", k) for i, k in zip(range(46, 121), kinds)]

    out = []
    for i, p in enumerate(planted + fillers):
        rec = {"id": p["id"], "alias": aliases[i], "procedure": p["procedure"], "startDate": p["startDate"],
               "visits": p["visits"], "contacts": p["contacts"]}
        out.append(rec)
    assert len(out) == 120 and len({p["id"] for p in out}) == 120

    # 중립 메모에 증상 표현이 섞이지 않았는지(심은 2건만 걸려야 한다).
    flagged = [p["id"] for p in out if fx.evaluate(rules, p, rf)["medicalReview"]]
    assert flagged == ["P012", "P039"], flagged
    # 엔진이 모든 환자를 '수술 후 문맥'으로 볼 수도 있으므로 모호 표현도 중립 메모에 없어야 한다.
    for p in out:
        for cc in p["contacts"]:
            h = rf.hits(cc["note"])
            if p["id"] not in ("P012", "P039"):
                assert not h["ambiguous"] and not h["symptoms"], (p["id"], cc["note"])

    (ROOT / "data" / "patients.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    detail = [p["id"] for p in planted] + ["P046", "P060", "P080", "P100", "P120"]
    (ROOT / "data" / "scripts" / "expected_ids.json").write_text(json.dumps(detail) + "\n", encoding="utf-8")
    (ROOT / "data" / "scripts" / "planted.json").write_text(json.dumps(
        [{"id": p["id"], "procedure": p["procedure"], "startDate": p["startDate"], "cats": p["_cats"],
          "expectReasons": p["_expect"][0], "expectOverdue": p["_expect"][1], "expectMedicalReview": p["_expect"][2],
          "story": p["_story"]} for p in planted], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    from collections import Counter
    print("환자", len(out), Counter(p["procedure"] for p in out))


if __name__ == "__main__":
    main()
