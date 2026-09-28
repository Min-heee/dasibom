/**
 * 테스트용 작은 환자 묶음. 기준 시각 2026-09-21(월) 09:00 KST에서 각 환자가 무엇을 보여 주려는지 적는다.
 * 기대값은 테스트 파일에 달력을 보고 손으로 센 값으로 둔다(엔진 결과를 복사하지 않는다).
 *
 * 달력 메모(2026): 9/20·9/27 일, 9/24(목)~9/26(토) 추석 연휴, 10/3(토) 개천절, 10/5(월) 대체공휴일, 10/9(금) 한글날, 10/16(금) 내부 교육 휴진.
 */

import { parsePatients, type Patient } from "../patient";

const RAW = [
  // 예정일 지남(재연락 간격 후): 수술 3/9(월) → 6개월 9/9(수), 유예 끝 9/16 → 9/17부터 지남. 9/17 부재 1회 → 9/20부터 다시.
  {
    id: "P101", alias: "가명A", procedure: "hair-transplant", startDate: "2026-03-09",
    visits: [{ date: "2026-03-10", kind: "d1" }, { date: "2026-03-16", kind: "d7" }, { date: "2026-04-06", kind: "w4" }],
    contacts: [{ at: "2026-09-17T10:00:00+09:00", result: "no-answer" }],
  },
  // 예정일 지남(재연락 간격 전): 주사 8/10(월) 시작, 3회차 9/7 놓침(유예 끝 9/10). 9/19(토) 부재 → 9/22부터 다시. 4회차는 오늘(9/21).
  {
    id: "P102", alias: "가명B", procedure: "injection", startDate: "2026-08-10",
    visits: [{ date: "2026-08-24", kind: "inj-2" }],
    contacts: [{ at: "2026-09-19T11:00:00+09:00", result: "no-answer" }],
  },
  // 원장 확인: 수술 3/4(수) → 6개월 9/4, 9/12부터 지남. 9/12·9/15·9/18 세 번 시도.
  {
    id: "P103", alias: "가명C", procedure: "hair-transplant", startDate: "2026-03-04",
    visits: [{ date: "2026-03-05", kind: "d1" }, { date: "2026-03-11", kind: "d7" }, { date: "2026-04-01", kind: "w4" }],
    contacts: [
      { at: "2026-09-12T10:00:00+09:00", result: "no-answer" },
      { at: "2026-09-15T10:00:00+09:00", result: "no-answer" },
      { at: "2026-09-18T15:00:00+09:00", result: "sms", note: "예약 안내 문자" },
    ],
  },
  // 내일 내원 + 사진 회차: 수술 9/15(화) → D+7 = 9/22(화) 사진 회차, 전 진료일 = 오늘.
  {
    id: "P104", alias: "가명D", procedure: "hair-transplant", startDate: "2026-09-15",
    visits: [{ date: "2026-09-16", kind: "d1" }],
    contacts: [],
  },
  // 관리 안내(D+3 = 오늘) + 추석에 걸려 밀리는 D+7(9/25 → 9/28) + 내부 교육 휴진에 걸리는 4주(10/16 → 10/17).
  {
    id: "P105", alias: "가명E", procedure: "hair-transplant", startDate: "2026-09-18",
    visits: [{ date: "2026-09-19", kind: "d1" }],
    contacts: [],
  },
  // 조금 일찍 옴: 주사 9/1 시작, 2회차 9/15인데 9/12(토)에 옴(earlyDays 3 경계).
  {
    id: "P107", alias: "가명G", procedure: "injection", startDate: "2026-09-01",
    visits: [{ date: "2026-09-12", kind: "inj-2" }],
    contacts: [],
  },
  // 늦게 온 D+7(8/24 예정, 8/29 옴)도 완료. 4주 9/14, 유예 끝 9/21 → 오늘은 아직 유예 중.
  {
    id: "P108", alias: "가명H", procedure: "hair-transplant", startDate: "2026-08-17",
    visits: [{ date: "2026-08-18", kind: "d1" }, { date: "2026-08-29", kind: "d7" }],
    contacts: [],
  },
  // 건너뜀: 4주(3/2)는 놓쳤지만 6개월(8/2 일 → 8/3)에 왔다 → 4주 미방문은 연락 대상이 아니다.
  {
    id: "P109", alias: "가명I", procedure: "hair-transplant", startDate: "2026-02-02",
    visits: [{ date: "2026-02-03", kind: "d1" }, { date: "2026-02-09", kind: "d7" }, { date: "2026-08-03", kind: "m6" }],
    contacts: [],
  },
  // 증상 메모: 9/16 메모에 '주사'(문맥) + '부어'·'열감'(모호어) → 의료진 확인. 9/14 메모는 모호어만 있고 문맥이 없어 통과.
  {
    id: "P110", alias: "가명J", procedure: "injection", startDate: "2026-09-07",
    visits: [],
    contacts: [
      { at: "2026-09-10T10:00:00+09:00", result: "called", note: "예약 시간 확인" },
      { at: "2026-09-14T10:00:00+09:00", result: "called", note: "붓기가 좀 있다고 함" },
      { at: "2026-09-16T14:00:00+09:00", result: "called", note: "주사 맞은 자리가 부어 있고 열감이 있다고 함. 보호자 010-1234-5678" },
    ],
  },
  // 여러 이유: 주사 8/11(화) 시작, 3회차 9/8 놓침 + 4회차 9/22 내일 → 예정일 지남·내일 내원 한 줄.
  {
    id: "P111", alias: "가명K", procedure: "injection", startDate: "2026-08-11",
    visits: [{ date: "2026-08-25", kind: "inj-2" }],
    contacts: [],
  },
  // 주사 재예약: 주사 8/21(금) 시작, 3회차 9/18 안 옴, 유예(3일) 끝이 오늘 → 재예약.
  {
    id: "P112", alias: "가명L", procedure: "injection", startDate: "2026-08-21",
    visits: [{ date: "2026-09-04", kind: "inj-2" }],
    contacts: [],
  },
  // 두피 관리 안내: 마지막 두피 관리 8/24 + 28일 = 9/21.
  {
    id: "P113", alias: "가명M", procedure: "scalp-care", startDate: "2026-06-29",
    visits: [{ date: "2026-07-27", kind: "scalp-care" }, { date: "2026-08-24", kind: "scalp-care" }],
    contacts: [],
  },
];

export function fixturePatients(): Patient[] {
  const r = parsePatients(structuredClone(RAW));
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.patients;
}

export function fixturePatient(id: string): Patient {
  const p = fixturePatients().find((x) => x.id === id);
  if (!p) throw new Error(`픽스처 환자 없음: ${id}`);
  return p;
}
