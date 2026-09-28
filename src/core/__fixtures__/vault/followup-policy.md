---
id: D01
title: 사후관리 연락 규정(테스트 픽스처)
type: policy
version: 1
status: approved
effective: 2026-09-01
owner: 원무팀
fictional: true
---

# 사후관리 연락 규정(테스트 픽스처)

테스트용 픽스처다. json 모양은 저장소 루트 vault/의 D01(사후관리 연락 규정)과 같고, 시점 값은 V07(수술 후 관리)·V08(두피 주사)·V09(두피 관리)의 가상 일정과 맞췄다.
규칙 문장(무엇을 완료로 보고, 언제 목록에 올리는지)도 그 D01 본문을 따른다.
공휴일은 **테스트용으로 2026년 9~12월만** 넣었고 확인 기간(holidaysCoverage)도 그만큼으로 좁혔다 —
확인 기간 밖의 날이 '공휴일 미확인'으로 표시되는지 보려고. 공식 출처로 확인한 공휴일 목록은 저장소 루트 vault/의 D01에 있다.

```json
{
  "timezone": "Asia/Seoul",
  "clinicPhone": "02-000-0000",
  "procedures": {
    "hair-transplant": [
      {
        "key": "d1",
        "label": "D+1 내원",
        "offsetDays": 1,
        "kind": "visit",
        "earlyDays": 0,
        "graceDays": 1
      },
      {
        "key": "d3",
        "label": "D+3 머리 감기 시작 안내",
        "offsetDays": 3,
        "kind": "notice",
        "earlyDays": 0,
        "graceDays": 1
      },
      {
        "key": "d7",
        "label": "D+7 내원·경과 사진",
        "offsetDays": 7,
        "kind": "photo",
        "earlyDays": 1,
        "graceDays": 2
      },
      {
        "key": "d14",
        "label": "D+14 안내",
        "offsetDays": 14,
        "kind": "notice",
        "earlyDays": 0,
        "graceDays": 2
      },
      {
        "key": "w4",
        "label": "4주 경과 진료",
        "offsetDays": 28,
        "kind": "visit",
        "earlyDays": 3,
        "graceDays": 7
      },
      {
        "key": "m6",
        "label": "6개월 경과 진료·사진",
        "offsetMonths": 6,
        "kind": "photo",
        "earlyDays": 7,
        "graceDays": 7
      },
      {
        "key": "y1",
        "label": "1년 경과 진료·사진",
        "offsetMonths": 12,
        "kind": "photo",
        "earlyDays": 14,
        "graceDays": 14
      }
    ],
    "injection": {
      "keyPrefix": "inj-",
      "label": "두피 주사",
      "intervalDays": 14,
      "sessions": 10,
      "photoSessions": [
        5,
        10
      ],
      "earlyDays": 3,
      "graceDays": 3
    },
    "scalp-care": {
      "key": "scalp-care",
      "label": "두피 관리 다음 회차 안내",
      "kind": "notice",
      "anchor": "last-visit",
      "intervalDays": 28,
      "earlyDays": 0,
      "graceDays": 3,
      "horizonMonths": 12
    }
  },
  "upcomingNotice": "previous-open-day",
  "retryIntervalDays": 3,
  "maxAttempts": 3,
  "contactResults": [
    "called",
    "no-answer",
    "sms",
    "later"
  ],
  "contactWindow": {
    "start": "09:00",
    "end": "20:00"
  },
  "monthEndRule": "clamp",
  "shiftRule": "next-open-day",
  "reasonOrder": [
    "overdue",
    "upcoming-visit",
    "care-notice",
    "injection-rebook",
    "photo-round"
  ],
  "holidaysCoverage": {
    "from": "2026-09-01",
    "to": "2026-12-31",
    "checkedOn": "2026-09-28"
  },
  "holidays": [
    {
      "date": "2026-09-24",
      "name": "추석 연휴"
    },
    {
      "date": "2026-09-25",
      "name": "추석"
    },
    {
      "date": "2026-09-26",
      "name": "추석 연휴"
    },
    {
      "date": "2026-10-03",
      "name": "개천절"
    },
    {
      "date": "2026-10-05",
      "name": "대체공휴일(개천절)"
    },
    {
      "date": "2026-10-09",
      "name": "한글날"
    },
    {
      "date": "2026-12-25",
      "name": "기독탄신일"
    }
  ],
  "templates": {
    "overdue": "샘플의원입니다. {{date}} 예정이던 진료 일정이 지나 연락드렸습니다. 편하신 날짜로 다시 예약해 주세요. 문의 {{clinicPhone}}",
    "upcoming-visit": "샘플의원입니다. {{date}} 내원 예정입니다. 이날 진료시간은 {{time}}입니다. 변경이 필요하면 {{clinicPhone}}으로 연락 주세요.",
    "photo-round": "샘플의원입니다. {{date}} 내원 때 경과 사진을 찍습니다. 머리는 말린 상태로 스타일링 제품 없이 와 주세요.",
    "injection-rebook": "샘플의원입니다. {{date}} 예정이던 두피 주사 회차 날짜를 다시 잡으려고 연락드렸습니다. 문의 {{clinicPhone}}",
    "care-notice-d3": "샘플의원입니다. {{date}}부터 안내받은 방법으로 머리를 감으셔도 됩니다. 궁금한 점은 {{clinicPhone}}으로 연락 주세요.",
    "care-notice-d14": "샘플의원입니다. 수술 후 2주가 지났습니다. 4주 경과 진료 예약을 확인해 주세요. 문의 {{clinicPhone}}",
    "care-notice-scalp-care": "샘플의원입니다. 지난 두피 관리 뒤 4주가 되어 다음 일정을 안내드립니다. 예약은 {{clinicPhone}}으로 해 주세요."
  }
}
```

가상 의원의 예시 문서이며 실제 의료 지침이 아닙니다.
