import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 정적 내보내기: 서버 런타임 없이 out/ 만으로 배포된다(PRD 5절 스택).
  // 연락 기록도 브라우저에만 남으므로(F6) 서버가 있을 이유가 없다.
  output: "export",

  // false면 out/today.html 이 나와 /today/ 경로가 정적 호스트마다 다르게 풀린다.
  // true로 두면 out/today/index.html 하나로 정해진다(같은각도와 같은 선택).
  trailingSlash: true,

  // 정적 내보내기에는 이미지 최적화 서버가 없다.
  images: { unoptimized: true },
};

export default nextConfig;
