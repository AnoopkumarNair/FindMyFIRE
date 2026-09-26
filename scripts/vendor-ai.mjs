// Copies the on-device AI runtime into vendor/ (served next to the app, never from a CDN).
// Exact versions, and each package tarball is checked against the SHA-512 pinned below
// before anything is extracted. `npm run vendor` locally; the deploy workflow runs it too.

import { mkdir, writeFile, rm, readFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "vendor");

// transformers.js bundles the ONNX Runtime JavaScript; the .wasm files must come from the exact
// onnxruntime-web version it was built against (see its package.json).
const PACKAGES = [
  {
    name: "@huggingface/transformers", version: "4.3.0", licence: "Apache-2.0",
    integrity: "sha512-fL1A/WUZwouPrOlYxU5dzIwD2T5J781JiB2jDR8bFe5DwCj0Gfudq+NEXCMno49kQgajHA7xQkrRLJlqG1veEA==",
    files: { "package/dist/transformers.min.js": "transformers/transformers.min.js", "package/LICENSE": "transformers/LICENSE" },
  },
  {
    name: "onnxruntime-web", version: "1.31.0-dev.20260914-8d85527a0", licence: "MIT",
    integrity: "sha512-Iy7rtadoBgxS/LLvDr3QW38DB1PNXRnr0GJMcL0TAt7c9qjgVQl83UlGCVyeAnK2InpmW8Uc3PL8XIuqtDeF6g==",
    files: {
      "package/dist/ort-wasm-simd-threaded.asyncify.mjs": "ort/ort-wasm-simd-threaded.asyncify.mjs",
      "package/dist/ort-wasm-simd-threaded.asyncify.wasm": "ort/ort-wasm-simd-threaded.asyncify.wasm",
      "package/dist/ort-wasm-simd-threaded.mjs": "ort/ort-wasm-simd-threaded.mjs",
      "package/dist/ort-wasm-simd-threaded.wasm": "ort/ort-wasm-simd-threaded.wasm",
    },
  },
];

const tarballUrl = (p) => `https://registry.npmjs.org/${p.name}/-/${p.name.split("/").pop()}-${p.version}.tgz`;

await rm(out, { recursive: true, force: true });
const notes = [];
for (const p of PACKAGES) {
  const res = await fetch(tarballUrl(p));
  if (!res.ok) throw new Error(`${p.name}@${p.version}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = "sha512-" + createHash("sha512").update(buf).digest("base64");
  if (got !== p.integrity) throw new Error(`${p.name}@${p.version}: integrity mismatch\n  expected ${p.integrity}\n  got      ${got}`);
  const dir = join(tmpdir(), `vendor-${p.name.replace(/\W/g, "_")}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  const tgz = join(dir, "pkg.tgz");
  await writeFile(tgz, buf);
  execFileSync("tar", ["xzf", tgz, "-C", dir, ...Object.keys(p.files)]);
  for (const [from, to] of Object.entries(p.files)) {
    await mkdir(join(out, to, ".."), { recursive: true });
    await copyFile(join(dir, from), join(out, to));
  }
  await rm(dir, { recursive: true, force: true });
  notes.push(`${p.name}@${p.version} (${p.licence}) ${p.integrity}`);
  console.log(`✓ ${p.name}@${p.version}`);
}
await writeFile(join(out, "VERSIONS.txt"), notes.join("\n") + "\n");
// ONNX Runtime ships no licence file in its npm package; note it here.
await writeFile(join(out, "ort", "LICENSE.txt"), "ONNX Runtime Web, Copyright (c) Microsoft Corporation. MIT License.\nhttps://github.com/microsoft/onnxruntime/blob/main/LICENSE\n");
console.log(`vendor/ ready (${(await readFile(join(out, "ort/ort-wasm-simd-threaded.asyncify.wasm"))).length >> 20} MB wasm)`);
