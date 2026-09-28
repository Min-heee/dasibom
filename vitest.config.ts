import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * 코어(src/core)는 DOM도 시계도 쓰지 않는 순수 함수다(PRD F3 — 기준 시각은 인자).
 * 화면은 판단을 src/demo의 순수 함수로 빼서 시험하고, 첫 화면은 renderToStaticMarkup으로 글자를 확인한다.
 * 그래서 테스트 환경은 node 하나로 충분하고 jsdom 의존성을 두지 않는다.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
  },
  // tsconfig의 jsx: "preserve"(Next용)를 시험에서는 React 자동 런타임으로 바꾼다(첫 화면 렌더 시험).
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
