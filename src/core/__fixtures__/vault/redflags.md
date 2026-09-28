---
id: V11
title: 적신호 증상 목록(테스트 픽스처)
type: policy
version: 1
status: approved
effective: 2026-07-01
owner: 간호팀
fictional: true
---

# 적신호 증상 목록(테스트 픽스처)

테스트용으로 줄인 목록이다. 실제 목록은 저장소 루트 vault/의 V11(한창구 볼트에서 복사)에 있다.

```json
{
  "symptoms": ["고름", "숨이 차", "고열"],
  "postopContext": ["수술", "주사"],
  "postopContextPatterns": [],
  "feverThresholdCelsius": 38,
  "ambiguous": ["붓기", "부어", "열감", "아파"],
  "nonSymptomWords": ["두피"]
}
```

가상 의원의 예시 문서이며 실제 의료 지침이 아닙니다.
