/**
 * 평가 번들(기대값 표 전체·심은 사례·변이 기록). 평가 화면은 서버 컴포넌트라 빌드 때만 이 파일을 읽는다.
 * 화면 번들(data.ts)과 나눈 이유: 클라이언트 컴포넌트가 data.ts를 부르므로, 한 파일이면 평가용 자료(약 130KB)가
 * 모든 화면의 공유 청크에 실려 내려간다.
 */

import raw from "@/generated/eval-bundle.json";
import type { EvalBundle } from "./data";

export const evalBundle = raw as unknown as EvalBundle;
