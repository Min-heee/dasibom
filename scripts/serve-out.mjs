/**
 * 내보낸 out/ 을 그대로 열어 보는 정적 서버.
 *
 * 저장소 루트에서:  npm run build && npm run preview
 *
 * 같은각도 scripts/serve-out.mjs 를 바탕으로 했다. 의존성 없이 node 표준 모듈만 쓴다
 * (오프라인에서도 돌고, 버전이 떠 있는 npx 한 줄보다 결정적이다).
 * 같은각도와 달리 vercel.json 헤더 규칙이 아직 없어서 헤더를 덧붙이지 않는다.
 */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(process.argv[2] ?? "out");
const PORT = Number(process.env.PORT ?? 3200);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** ROOT 밖으로 나가는 경로를 막는다. */
function safeJoin(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const full = join(ROOT, rel);
  return full.startsWith(ROOT) ? full : null;
}

async function resolveFile(urlPath) {
  const base = safeJoin(urlPath);
  if (base === null) return null;
  const candidates = base.endsWith("/") ? [join(base, "index.html")] : [base, join(base, "index.html"), `${base}.html`];
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      /* 다음 후보 */
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  const file = await resolveFile(url);
  if (file === null) {
    const notFound = await resolveFile("/404.html");
    if (notFound !== null) {
      res.writeHead(404, { "content-type": MIME[".html"] });
      createReadStream(notFound).pipe(res);
      return;
    }
    res.writeHead(404, { "content-type": MIME[".txt"] });
    res.end(`찾을 수 없습니다: ${url}\n`);
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
  createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`${ROOT} → http://localhost:${PORT}`);
});
