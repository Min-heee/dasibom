import { bundle } from "@/demo/data";
import { PatientScreen } from "../../_components/Patient";

// 환자 120명 화면을 빌드 때 모두 미리 만든다(서버 없이 정적 페이지로 열린다). id는 번들의 합성 환자 ID.
export function generateStaticParams() {
  return (bundle.patients as { id: string }[]).map((p) => ({ id: p.id }));
}

export const dynamicParams = false;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PatientScreen id={id} />;
}
