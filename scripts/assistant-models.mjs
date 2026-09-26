// Fetches an on-device model from Hugging Face at a pinned commit, and writes its manifest entry:
// every file split into 8 MB pieces, each with its SHA-256. The browser checks each piece against
// this entry, so what users run is exactly what was reviewed here.
//
//   node scripts/assistant-models.mjs fetch --repo onnx-community/Qwen3-0.6B-ONNX --id qwen3-0.6b \
//        --label Lite --name "Qwen3 0.6B" --out models-dev
//   node scripts/assistant-models.mjs merge models-dev/qwen3-0.6b.entry.json   # into src/assistant/models.json

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST = join(root, "src/assistant/models.json");
const HF = "https://huggingface.co";

// Which ONNX build each browser variant uses, best first.
const VARIANTS = {
  "webgpu-f16": { device: "webgpu", dtypes: ["q4f16"] },
  webgpu: { device: "webgpu", dtypes: ["q4", "int8"] },
  wasm: { device: "wasm", dtypes: ["q4", "int8", "quantized"] },
};
const CONFIG_FILES = /^(config\.json|generation_config\.json|tokenizer\.json|tokenizer_config\.json|special_tokens_map\.json|chat_template\.jinja|chat_template\.json)$/;

function args() {
  const a = process.argv.slice(2), o = { _: [] };
  for (let i = 0; i < a.length; i++) a[i].startsWith("--") ? (o[a[i].slice(2)] = a[++i]) : o._.push(a[i]);
  return o;
}

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

async function fetchModel(o) {
  const chunkSize = JSON.parse(await readFile(MANIFEST, "utf8")).chunkSize;
  const info = await json(`${HF}/api/models/${o.repo}`);
  const sha = o.revision || info.sha;
  const tree = await json(`${HF}/api/models/${o.repo}/tree/${sha}?recursive=true`);
  const paths = tree.filter((x) => x.type === "file").map((x) => x.path);
  const license = info.cardData?.license || info.tags?.find((t) => t.startsWith("license:"))?.slice(8) || "see model card";
  if (info.gated) throw new Error(`${o.repo} is gated; pick an openly licensed model`);

  const common = paths.filter((p) => CONFIG_FILES.test(p));
  const onnxFor = (dtype) => {
    const base = `onnx/model_${dtype}.onnx`;
    return paths.includes(base) ? [base, ...paths.filter((p) => p.startsWith(`${base}_data`)).sort()] : null;
  };
  const variants = {}, wanted = new Set(common);
  for (const [name, v] of Object.entries(VARIANTS)) {
    const dtype = v.dtypes.find((d) => onnxFor(d));
    if (!dtype) continue;
    variants[name] = { dtype, device: v.device, files: [...common, ...onnxFor(dtype)] };
    onnxFor(dtype).forEach((p) => wanted.add(p));
  }
  if (!Object.keys(variants).length) throw new Error(`${o.repo}: no q4f16/q4 ONNX files found`);

  // Files live under <id>/<commit>/, so a published URL never changes content.
  const modelPath = `${o.id}/${sha.slice(0, 7)}`;
  const out = join(o.out, modelPath), meta = {};
  for (const p of wanted) {
    const res = await fetch(`${HF}/${o.repo}/resolve/${sha}/${p}`);
    if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const lfs = tree.find((x) => x.path === p)?.lfs?.oid;
    if (lfs && createHash("sha256").update(buf).digest("hex") !== lfs) throw new Error(`${p}: doesn't match Hugging Face's own checksum`);
    await mkdir(dirname(join(out, p)), { recursive: true });
    await writeFile(join(out, p), buf);
    const pieces = [];
    for (let i = 0; i * chunkSize < buf.length || i === 0; i++) pieces.push(createHash("sha256").update(buf.subarray(i * chunkSize, (i + 1) * chunkSize)).digest("hex"));
    meta[p] = { path: p, size: buf.length, sha256: pieces };
    console.log(`  ${p}  ${(buf.length / 1e6).toFixed(1)} MB  ${pieces.length} piece(s)`);
  }
  for (const v of Object.values(variants)) v.files = v.files.map((p) => meta[p]);

  const entry = {
    id: o.id, label: o.label || o.id, name: o.name || o.repo, path: modelPath,
    repo: o.repo, revision: sha, license,
    chat: /qwen3/i.test(o.repo) ? { enable_thinking: false } : {},
    variants,
  };
  await writeFile(join(o.out, `${o.id}.entry.json`), JSON.stringify(entry, null, 2));
  for (const [n, v] of Object.entries(variants))
    console.log(`${n}: ${v.dtype}, ${(v.files.reduce((s, f) => s + f.size, 0) / 1e6).toFixed(0)} MB`);
  return entry;
}

async function merge(file) {
  const entry = JSON.parse(await readFile(file, "utf8"));
  const m = JSON.parse(await readFile(MANIFEST, "utf8"));
  m.models = [...m.models.filter((x) => x.id !== entry.id), entry];
  await writeFile(MANIFEST, JSON.stringify(m, null, 2) + "\n");
  console.log(`models.json now lists: ${m.models.map((x) => x.id).join(", ")}`);
}

const o = args();
if (o._[0] === "fetch") await fetchModel(o);
else if (o._[0] === "merge") await merge(o._[1]);
else { console.error("usage: fetch --repo R --id ID [--label L --name N --revision SHA --out DIR] | merge FILE"); process.exit(1); }
