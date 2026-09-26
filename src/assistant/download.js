// Downloads a model in fixed-size pieces, checks each piece against the SHA-256 in the app's
// own manifest, and keeps it in browser storage. A refresh, a dropped connection or closing
// the tab loses at most the pieces in flight: the next run skips every piece already stored.
//
// Pure logic with its dependencies passed in (fetch, a Cache-like store, SHA-256), so the same
// code runs in the browser worker and in Node tests.

export const CACHE_NAME = "fmf-assistant-v1";

/**
 * The storage key of piece `i` of a file, including the piece's own hash: a republished model
 * can never be assembled from a mix of old and new pieces. Any https URL works as a Cache API key.
 */
export const pieceKey = (modelId, file, i) => `https://fmf-model.invalid/${modelId}/${file.path}?piece=${i}&sha256=${file.sha256[i]}`;

export const variantFiles = (model, variant) => model.variants[variant]?.files || [];
export const variantBytes = (model, variant) => variantFiles(model, variant).reduce((s, f) => s + f.size, 0);

export async function sha256Hex(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

function pieces(file, chunkSize) {
  const out = [];
  for (let i = 0; i < file.sha256.length; i++) {
    const start = i * chunkSize, end = Math.min(file.size, start + chunkSize) - 1;
    out.push({ i, start, end, length: end - start + 1, sha256: file.sha256[i] });
  }
  return out;
}

const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); rej(signal.reason ?? new Error("aborted")); }, { once: true });
});

/**
 * Makes sure every piece of a model variant is stored and verified.
 * onProgress({ done, total, fromCache }) is called as bytes are verified (done/total in bytes).
 */
export async function download({ manifest, model, variant, cache, fetch, onProgress = () => {}, signal, concurrency = 3, retries = 4 }) {
  const chunkSize = manifest.chunkSize;
  const base = new URL(`${model.path}/`, manifest.base).href;
  const files = variantFiles(model, variant);
  if (!files.length) throw new Error(`No files for ${model.id} (${variant})`);
  const total = files.reduce((s, f) => s + f.size, 0);
  let done = 0, fromCache = 0;
  const jobs = [];
  for (const f of files) for (const p of pieces(f, chunkSize)) jobs.push({ f, p });

  // Pieces already stored count straight away (a resume).
  const todo = [];
  for (const j of jobs) {
    if (await cache.match(pieceKey(model.id, j.f, j.p.i))) { done += j.p.length; fromCache += j.p.length; }
    else todo.push(j);
  }
  onProgress({ done, total, fromCache });

  async function one({ f, p }) {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      try {
        const whole = f.sha256.length === 1;
        const res = await fetch(base + f.path, { signal, headers: whole ? {} : { Range: `bytes=${p.start}-${p.end}` } });
        if (!(res.status === 206 || (res.status === 200 && whole))) throw new Error(`HTTP ${res.status} for ${f.path}`);
        const buf = await res.arrayBuffer();
        if (buf.byteLength !== p.length) throw new Error(`${f.path} piece ${p.i}: got ${buf.byteLength} bytes, expected ${p.length}`);
        const hash = await sha256Hex(buf);
        if (hash !== p.sha256) throw Object.assign(new Error(`${f.path} piece ${p.i} failed its integrity check`), { integrity: true });
        await cache.put(pieceKey(model.id, f, p.i), new Response(buf, { headers: { "content-type": "application/octet-stream" } }));
        done += p.length;
        onProgress({ done, total, fromCache });
        return;
      } catch (e) {
        if (signal?.aborted) throw signal.reason ?? e;
        if (attempt >= retries) throw e;
        await sleep(Math.min(16000, 1000 * 2 ** attempt), signal);
      }
    }
  }

  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, todo.length) }, async () => {
    while (next < todo.length) await one(todo[next++]);
  });
  await Promise.all(workers);
  return { total, fromCache };
}

/** True when every piece of the variant is stored. */
export async function isComplete({ model, variant, cache }) {
  for (const f of variantFiles(model, variant))
    for (let i = 0; i < f.sha256.length; i++)
      if (!(await cache.match(pieceKey(model.id, f, i)))) return false;
  return variantFiles(model, variant).length > 0;
}

/** A stored file as one Response, joined from its pieces (a Blob, so nothing is copied twice). */
export async function storedFile({ model, variant, path, cache }) {
  const f = variantFiles(model, variant).find((x) => x.path === path);
  if (!f) return null;
  const parts = [];
  for (let i = 0; i < f.sha256.length; i++) {
    const r = await cache.match(pieceKey(model.id, f, i));
    if (!r) return null;
    parts.push(await r.blob());
  }
  return new Response(new Blob(parts), { status: 200, headers: { "content-length": String(f.size), "content-type": "application/octet-stream" } });
}

/** Deletes stored pieces the manifest no longer lists (an older model or revision). */
export async function prune({ manifest, cache }) {
  const keep = new Set();
  for (const m of manifest.models) for (const v of Object.values(m.variants))
    for (const f of v.files) f.sha256.forEach((_, i) => keep.add(pieceKey(m.id, f, i)));
  for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
}
