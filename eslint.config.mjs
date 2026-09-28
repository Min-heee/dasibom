import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "src/generated/**"],
  },
  // 재계산 의존성을 빼먹으면 연락을 적어도 목록이 그대로다(적대 검토 변이 S3e·S3g가 경고만 내고 통과). 오류로 올린다.
  { files: ["src/**/*.tsx"], rules: { "react-hooks/exhaustive-deps": "error" } },
  // 화면과 계산은 기준 시각(src/demo/clock.ts DEMO_NOW_MS) 하나로만 잰다(PRD F3·F12). 실제 시계를 읽으면
  // 방문하는 날마다 '오늘 목록'이 달라지고, 정적으로 미리 그린 화면과 브라우저 화면이 어긋난다.
  // 코어는 purity.test.ts가 글자로 한 번 더 본다(우회형 포함).
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: "시연 기준 시각 DEMO_NOW_MS(src/demo/clock.ts)를 인자로 넘기세요." },
        { object: "performance", property: "now", message: "시계를 읽지 않습니다. 기준 시각을 인자로 넘기세요." },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: "인자 없는 new Date()는 실제 시계를 읽습니다. DEMO_NOW_MS를 쓰세요." },
        { selector: "VariableDeclarator > Identifier.init[name='Date']", message: "Date 별칭은 시계 검사를 우회합니다." },
        // 아래는 적대 검토에서 lint를 통과한 우회형들. Date()는 new 없이 부르면 지금 시각 글자를 돌려준다.
        { selector: "CallExpression[callee.name='Date']", message: "Date()는 실제 시계를 읽습니다. DEMO_NOW_MS를 쓰세요." },
        { selector: "MemberExpression[property.name='Date'][object.name=/^(globalThis|window|self)$/]", message: "globalThis.Date 등은 시계 검사를 우회합니다." },
        { selector: "CallExpression > Identifier.arguments[name='Date']", message: "Date를 인자로 넘기면(Reflect.construct 등) 시계 검사를 우회합니다." },
        {
          selector: "CallExpression[arguments.length=0][callee.property.name=/^(format|formatToParts)$/][callee.object.callee.object.name='Intl']",
          message: "인자 없는 Intl 날짜 형식 호출은 지금 시각을 씁니다. 날짜를 인자로 넘기세요.",
        },
      ],
    },
  },
];

export default eslintConfig;
