// Runs off the main thread: downloads the model, loads it, and writes replies token by token.
//
// Network: this worker may reach only this site and the model host named in the manifest.
// Every other request is refused here, whatever the libraries inside try to do. The model
// runtime itself never touches the network: its files come from verified local storage.

import { CACHE_NAME, download, isComplete, storedFile, variantBytes, prune } from "./download.js";

const MODEL_HOST = "https://fmf-model.invalid/";
const HF_CDN = ["https://cdn-lfs.hf.co", "https://cdn-lfs-us-1.hf.co", "https://cas-bridge.xethub.hf.co"];
const VENDOR = new URL("../../vendor/", import.meta.url).href;
let manifest = null, allowedOrigins = [self.location.origin];

const realFetch = self.fetch.bind(self);
self.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, self.location.href);
  if (!allowedOrigins.includes(url.origin)) return Promise.reject(new TypeError(`Blocked request to ${url.origin}`));
  return realFetch(input, init);
};

const post = (msg) => self.postMessage(msg);
let job = null;            // the running download, if any
let T = null, loaded = null, stopper = null;

async function getManifest(url) {
  if (!manifest) {
    manifest = await (await fetch(url, { cache: "no-store" })).json();
    // This site, plus the hosts the model list names (our own host, or Hugging Face for models
    // served from their publisher's repo). Hugging Face answers from its CDN via a redirect.
    const hosts = [manifest.base, ...manifest.models.map((m) => m.base).filter(Boolean)].map((u) => new URL(u, self.location.href).origin);
    if (hosts.some((h) => h === "https://huggingface.co")) hosts.push(...HF_CDN);
    allowedOrigins = [...new Set([self.location.origin, ...hosts])];
  }
  return manifest;
}
const modelOf = (id) => manifest.models.find((m) => m.id === id);

async function startDownload({ manifestUrl, modelId, variant }) {
  await getManifest(manifestUrl);
  const model = modelOf(modelId);
  if (!model) throw new Error(`Unknown model ${modelId}`);
  if (job) job.abort();
  const ctrl = new AbortController();
  job = ctrl;
  const cache = await caches.open(CACHE_NAME);
  let last = 0;
  try {
    await download({
      manifest, model, variant, cache, fetch: self.fetch, signal: ctrl.signal,
      onProgress: ({ done, total }) => {
        const now = Date.now();
        if (now - last > 250 || done === total) { last = now; post({ type: "progress", done, total }); }
      },
    });
    await prune({ manifest, cache }).catch(() => {});
    post({ type: "downloaded", modelId, variant, bytes: variantBytes(model, variant) });
  } finally {
    if (job === ctrl) job = null;
  }
}

async function check({ manifestUrl, modelId, variant }) {
  await getManifest(manifestUrl);
  const model = modelOf(modelId);
  const cache = await caches.open(CACHE_NAME);
  post({ type: "checked", complete: !!model && await isComplete({ model, variant, cache }) });
}

async function load({ manifestUrl, modelId, variant }) {
  await getManifest(manifestUrl);
  const model = modelOf(modelId), v = model.variants[variant];
  if (loaded?.key === `${modelId}/${variant}`) { post({ type: "loaded" }); return; }
  const cache = await caches.open(CACHE_NAME);
  if (!T) {
    try { T = await import(`${VENDOR}transformers/transformers.min.js`); }
    catch { throw new Error("this site was published without the AI runtime files; the site owner needs to redeploy it"); }
  }
  const E = T.env;
  E.allowLocalModels = false;
  E.allowRemoteModels = true;
  E.useBrowserCache = false;
  E.useWasmCache = false;
  E.remoteHost = MODEL_HOST;
  E.remotePathTemplate = "{model}/";
  E.fetch = async (url, init) => {
    const u = String(url);
    if (!u.startsWith(MODEL_HOST)) return self.fetch(url, init);
    const path = decodeURIComponent(u.slice(MODEL_HOST.length + model.id.length + 1));
    return (await storedFile({ model, variant, path, cache })) || new Response("Not found", { status: 404 });
  };
  const onnx = E.backends.onnx;
  // The asyncify build runs both GPU and CPU; Safari before 26 (no WebGPU) needs the plain build.
  const oldSafari = v.device === "wasm" && /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const wasm = `${VENDOR}ort/ort-wasm-simd-threaded${oldSafari ? "" : ".asyncify"}`;
  onnx.wasm.wasmPaths = { mjs: `${wasm}.mjs`, wasm: `${wasm}.wasm` };
  onnx.wasm.numThreads = 1; // threads need cross-origin isolation, which static hosting can't give
  onnx.wasm.proxy = false;

  const t0 = performance.now();
  const progress_callback = (p) => { if (p.status === "progress" || p.status === "progress_total") post({ type: "loading", file: p.file, progress: p.progress }); };
  const tokenizer = await T.AutoTokenizer.from_pretrained(model.id, { progress_callback });
  const lm = await T.AutoModelForCausalLM.from_pretrained(model.id, { dtype: v.dtype, device: v.device, progress_callback });
  loaded = { key: `${modelId}/${variant}`, tokenizer, lm, chat: model.chat || {} };
  // One tiny run compiles the GPU shaders now rather than on the first question.
  await generate({ id: "warmup", messages: [{ role: "user", content: "Hi" }], maxTokens: 1, quiet: true });
  post({ type: "loaded", ms: Math.round(performance.now() - t0) });
}

async function generate({ id, messages, maxTokens = 140, quiet = false }) {
  if (!loaded) throw new Error("Model not loaded");
  const { tokenizer, lm, chat } = loaded;
  const inputs = tokenizer.apply_chat_template(messages, { add_generation_prompt: true, return_dict: true, ...chat });
  let text = "", tokens = 0, first = null;
  const t0 = performance.now();
  const streamer = new T.TextStreamer(tokenizer, {
    skip_prompt: true, skip_special_tokens: true,
    callback_function: (piece) => {
      tokens++;
      if (first == null) first = performance.now() - t0;
      text += piece;
      if (!quiet) post({ type: "token", id, piece });
    },
  });
  stopper = new T.InterruptableStoppingCriteria();
  await lm.generate({ ...inputs, max_new_tokens: maxTokens, do_sample: false, repetition_penalty: 1.1, streamer, stopping_criteria: stopper });
  stopper = null;
  const ms = performance.now() - t0;
  if (!quiet) post({ type: "done", id, text, stats: { tokens, ms: Math.round(ms), firstMs: Math.round(first ?? ms), promptTokens: inputs.input_ids.dims.at(-1) } });
}

async function remove() {
  job?.abort();
  loaded = null;
  await caches.delete(CACHE_NAME);
  post({ type: "removed" });
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "download") await startDownload(data);
    else if (data.type === "pause") { job?.abort(); post({ type: "paused" }); }
    else if (data.type === "check") await check(data);
    else if (data.type === "load") await load(data);
    else if (data.type === "generate") await generate(data);
    else if (data.type === "stop") stopper?.interrupt();
    else if (data.type === "remove") await remove();
  } catch (e) {
    if (data.type === "download" && e?.name === "AbortError") return;
    post({ type: "error", id: data.id, during: data.type, message: String(e?.message || e), integrity: !!e?.integrity });
  }
};
