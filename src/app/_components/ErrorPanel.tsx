/** 볼트 규칙·환자 파일이 깨졌을 때. 기본값으로 목록을 그리지 않고(PRD F2) 무엇이 틀렸는지 그대로 보인다. */
export function ErrorPanel({ errors }: { errors: string[] }) {
  return (
    <div className="card alert" role="alert">
      <h2>규칙이나 데이터를 읽지 못해 멈췄습니다</h2>
      <p>값이 빠지거나 깨지면 기본값을 채우지 않고 전체를 멈춥니다. 아래를 고친 뒤 다시 만드세요.</p>
      <ul>
        {errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
    </div>
  );
}
