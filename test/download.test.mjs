// The model downloader: pieces are verified, stored, resumed after an interruption, and a
// tampered piece is never stored.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { download, isComplete, storedFile, pieceKey, variantBytes } from "../src/assistant/download.js";

const CHUNK = 1024;
const files = { "config.json": Buffer.from('{"model_type":"qwen3"}'), "onnx/model.onnx_data": randomBytes(CHUNK * 3 + 100) };
const sha = (b) => createHash("sha256").update(b).digest("hex");
const entry = (path) => {
  const b = files[path], out = [];
  for (let i = 0; i * CHUNK < b.length; i++) out.push(sha(b.subarray(i * CHUNK, (i + 1) * CHUNK)));
  return { path, size: b.length, sha256: out };
};
const model = { id: "tiny", path: "tiny", variants: { wasm: { dtype: "q4", device: "wasm", files: Object.keys(files).map(entry) } } };
const manifest = { base: "https://models.example/", chunkSize: CHUNK, models: [model] };

class MemCache {
  constructor() { this.m = new Map(); }
  async match(k) { const b = this.m.get(String(k)); return b ? new Response(b) : undefined; }
  async put(k, res) { this.m.set(String(k), new Uint8Array(await res.arrayBuffer())); }
}

function server({ tamper = null, ignoreRange = false, failAfter = Infinity } = {}) {
  const log = [];
  const fetch = async (url, { headers = {} } = {}) => {
    const path = url.replace("https://models.example/tiny/", "");
    if (log.length >= failAfter) throw new TypeError("network down");
    log.push(`${path} ${headers.Range || "all"}`);
    let body = files[path];
    if (!body) return new Response("no", { status: 404 });
    const m = /bytes=(\d+)-(\d+)/.exec(headers.Range || "");
    if (m && !ignoreRange) {
      body = Buffer.from(body.subarray(+m[1], +m[2] + 1));
      if (tamper && tamper(path, +m[1])) body[0] ^= 0xff;
      return new Response(body, { status: 206 });
    }
    return new Response(body, { status: 200 });
  };
  return { fetch, log };
}

test("downloads every piece, verified, and joins them back exactly", async () => {
  const cache = new MemCache(), s = server(), seen = [];
  await download({ manifest, model, variant: "wasm", cache, fetch: s.fetch, onProgress: (p) => seen.push(p.done) });
  assert.equal(seen.at(-1), variantBytes(model, "wasm"));
  assert.ok(await isComplete({ model, variant: "wasm", cache }));
  const res = await storedFile({ model, variant: "wasm", path: "onnx/model.onnx_data", cache });
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), files["onnx/model.onnx_data"]);
  assert.equal(s.log.filter((l) => l.startsWith("onnx")).length, 4, "one request per piece");
});

test("an interrupted download resumes without fetching finished pieces again", async () => {
  const cache = new MemCache();
  const first = server({ failAfter: 2 });
  await assert.rejects(download({ manifest, model, variant: "wasm", cache, fetch: first.fetch, retries: 0, concurrency: 1 }));
  const stored = cache.m.size;
  assert.ok(stored >= 1 && stored < 5);
  const second = server();
  let firstReport = null;
  await download({ manifest, model, variant: "wasm", cache, fetch: second.fetch, onProgress: (p) => { firstReport ??= p; } });
  assert.ok(firstReport.fromCache > 0, "resumed from stored pieces");
  assert.equal(second.log.length, 5 - stored, "only the missing pieces were fetched");
  assert.ok(await isComplete({ model, variant: "wasm", cache }));
});

test("a piece that fails its checksum is never stored", async () => {
  const cache = new MemCache();
  const s = server({ tamper: (path, start) => path.startsWith("onnx") && start === CHUNK });
  await assert.rejects(download({ manifest, model, variant: "wasm", cache, fetch: s.fetch, retries: 1 }), /integrity/);
  assert.equal(await cache.match(pieceKey("tiny", model.variants.wasm.files[1], 1)), undefined);
  assert.equal(await isComplete({ model, variant: "wasm", cache }), false);
});

test("a host that ignores byte ranges is refused rather than downloading the whole file per piece", async () => {
  const cache = new MemCache();
  await assert.rejects(download({ manifest, model, variant: "wasm", cache, fetch: server({ ignoreRange: true }).fetch, retries: 0 }), /HTTP 200/);
});
