import { vi } from "vitest";

/**
 * 시험 중 시계를 기준 시각(2026-09-21)과 먼 날로 고정한다. 코어·화면이 시계를 몰래 읽으면(`+new Date` 같은 우회형 포함)
 * 기준 시각으로 손으로 센 기대값이 모두 어긋나 시험이 실패한다. 실제 날짜로 두면 "오늘이 우연히 9/21 근처"일 때 통과할 수 있다.
 * Date만 가짜로 두고 setTimeout 등은 그대로 둔다(vitest 자체 동작에 손대지 않게).
 */
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2031-01-01T03:00:00Z"));
