import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Chrome } from "./_components/Chrome";
import "./globals.css";

export const metadata: Metadata = {
  title: "다시봄",
  description: "가상 의원 · 합성 데이터. 사후관리 일정은 규칙으로 계산하고, 연락은 사람이 합니다.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <Chrome />
        <main>{children}</main>
      </body>
    </html>
  );
}
