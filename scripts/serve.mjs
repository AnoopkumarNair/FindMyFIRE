// Minimal static server for local development: npm run serve → http://localhost:8080
// Supports byte ranges, like the model host, so the AI download can be tried locally.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT) || 8080;
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm", ".png": "image/png", ".woff2": "font/woff2" };

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = join(root, path.endsWith("/") ? path + "index.html" : path);
  if (!file.startsWith(root) || file.includes("node_modules")) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    const headers = { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store",
      "accept-ranges": "bytes", "access-control-allow-origin": "*" };
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
    if (m) {
      const start = Number(m[1]), end = m[2] ? Math.min(Number(m[2]), body.length - 1) : body.length - 1;
      if (start > end) { res.writeHead(416, { "content-range": `bytes */${body.length}` }).end(); return; }
      res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${body.length}` }).end(body.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, headers).end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, () => console.log(`FindMyFIRE on http://localhost:${port}`));
