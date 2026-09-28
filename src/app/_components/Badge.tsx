import type { Badge as B } from "@/demo/view";

/** 배지는 언제나 글자 + 색. 색만으로 뜻을 전하지 않는다. */
export function Badges({ items }: { items: B[] }) {
  return (
    <span className="badges">
      {items.map((b, i) => (
        <span key={i} className={`badge ${b.tone}`}>
          {b.label}
        </span>
      ))}
    </span>
  );
}
