// The assistant as the page sees it: status, the download the user started, and a `generate`
// the answer pipeline can call. The worker does the heavy lifting.

import { variantBytes } from "./download.js";

const KEY = "fmf.assistant";
const manifestUrl = new URL("./models.json", import.meta.url).href;
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const keep = (x) => { try { localStorage.setItem(KEY, JSON.stringify(x)); } catch { /* private mode: resume won't survive a refresh */ } };

// status: unavailable | none | downloading | paused | downloaded | loading | ready | error
const state = { status: "none", done: 0, total: 0, model: null, variant: null, message: "", device: null, stats: null, manifest: null };
const listeners = new Set();
const emit = () => { for (const fn of listeners) fn({ ...state }); };
const set = (patch) => { Object.assign(state, patch); emit(); };

let worker = null, seq = 0;
const pending = new Map();
const loadWaiters = [];

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data: m }) => {
    if (m.type === "progress") {
      // Remember roughly how far it got, so a refresh shows "resuming at 40%" rather than 0%.
      if (m.total && Math.floor((20 * m.done) / m.total) !== Math.floor((20 * state.done) / m.total)) keep({ ...load(), done: m.done });
      set({ status: "downloading", done: m.done, total: m.total });
    }
    else if (m.type === "downloaded") { keep({ ...load(), status: "downloaded" }); set({ status: "downloaded", done: m.bytes, total: m.bytes }); }
    else if (m.type === "paused") { keep({ ...load(), status: "paused" }); set({ status: "paused" }); }
    else if (m.type === "checked") {
      if (m.complete) set({ status: "downloaded" });
      else if (load().status === "downloading") resume();
      else set({ status: "paused" });
    }
    else if (m.type === "loading") set({ status: "loading", message: m.file || "" });
    else if (m.type === "loaded") { set({ status: "ready" }); loadWaiters.splice(0).forEach((w) => w.res()); }
    else if (m.type === "removed") { keep({}); set({ status: "none", done: 0, total: 0 }); }
    else if (m.type === "token") pending.get(m.id)?.onToken?.(m.piece);
    else if (m.type === "done") {
      const p = pending.get(m.id);
      pending.delete(m.id);
      set({ stats: m.stats });
      p?.res(m.text);
    }
    else if (m.type === "error") {
      if (m.id && pending.has(m.id)) { pending.get(m.id).rej(new Error(m.message)); pending.delete(m.id); return; }
      if (m.during === "load") {
        loadWaiters.splice(0).forEach((w) => w.rej(new Error(m.message)));
        set({ status: "error", message: `The AI couldn't start on this device (${m.message}). Plain answers still work.` });
        return;
      }
      set({ status: "error", message: m.integrity ? "A downloaded piece didn't match its checksum, so it was thrown away. Try again." : m.message });
    }
  };
  return worker;
}

/** Which build of a model suits this device: GPU (with or without 16-bit floats), else CPU. */
async function pickVariant(model) {
  try {
    const adapter = await navigator.gpu?.requestAdapter?.();
    if (adapter) {
      const f16 = adapter.features.has("shader-f16");
      for (const v of f16 ? ["webgpu-f16", "webgpu"] : ["webgpu"]) if (model.variants[v]) return { variant: v, device: "GPU" };
    }
  } catch { /* no WebGPU */ }
  return model.variants.wasm ? { variant: "wasm", device: "CPU" } : null;
}

/** Call once at start-up. Resumes a download the user started before a refresh. */
export async function init() {
  try {
    state.manifest = await (await fetch(manifestUrl, { cache: "no-cache" })).json();
  } catch { set({ status: "unavailable", message: "Couldn't read the model list." }); return; }
  const models = state.manifest.models || [];
  if (!models.length) { set({ status: "unavailable", message: "The AI model hasn't been published yet." }); return; }
  const saved = load();
  const model = models.find((m) => m.id === saved.modelId) || models[0];
  const pick = saved.variant && model.variants[saved.variant] ? { variant: saved.variant, device: saved.device } : await pickVariant(model);
  if (!pick) { set({ status: "unavailable", model, message: "This browser can't run the model." }); return; }
  set({ model, variant: pick.variant, device: pick.device, total: variantBytes(model, pick.variant), done: saved.modelId === model.id ? saved.done || 0 : 0 });
  if (saved.modelId === model.id && saved.status) getWorker().postMessage({ type: "check", manifestUrl, modelId: model.id, variant: pick.variant });
  else emit();
}

export const subscribe = (fn) => { listeners.add(fn); fn({ ...state }); return () => listeners.delete(fn); };
export const current = () => ({ ...state });
export const models = () => state.manifest?.models || [];

async function storageOk(bytes) {
  try {
    const { quota, usage } = await navigator.storage.estimate();
    if (quota - usage < bytes * 1.1) return false;
  } catch { /* unknown: try anyway */ }
  try { await navigator.storage.persist?.(); } catch { /* the browser may still keep it */ }
  return true;
}

function resume() {
  keep({ ...load(), modelId: state.model.id, variant: state.variant, device: state.device, status: "downloading" });
  set({ status: "downloading", message: "" });
  getWorker().postMessage({ type: "download", manifestUrl, modelId: state.model.id, variant: state.variant });
}

/** Starts (or resumes) the download the user asked for. */
export async function start(modelId) {
  const model = models().find((m) => m.id === modelId) || state.model;
  const pick = await pickVariant(model);
  if (!pick) { set({ status: "unavailable", message: "This browser can't run the model." }); return; }
  const total = variantBytes(model, pick.variant);
  set({ model, variant: pick.variant, device: pick.device, total });
  if (!(await storageOk(total))) { set({ status: "error", message: "Not enough free storage on this device for the model." }); return; }
  resume();
}

export const pause = () => worker?.postMessage({ type: "pause" });
export const remove = () => getWorker().postMessage({ type: "remove" });

/** Loads the model into memory (once per page load). */
export function ensureLoaded() {
  if (state.status === "ready") return Promise.resolve();
  if (state.status !== "downloaded" && state.status !== "loading") return Promise.reject(new Error("Model not downloaded"));
  return new Promise((res, rej) => {
    loadWaiters.push({ res, rej });
    if (state.status !== "loading") {
      set({ status: "loading", message: "" });
      getWorker().postMessage({ type: "load", manifestUrl, modelId: state.model.id, variant: state.variant });
    }
  });
}

/** The interface answer.js expects. */
export const llm = {
  async generate(messages, { maxTokens = 140, onToken, signal } = {}) {
    await ensureLoaded();
    const id = `g${++seq}`;
    return new Promise((res, rej) => {
      pending.set(id, { res, rej, onToken });
      signal?.addEventListener("abort", () => { worker.postMessage({ type: "stop" }); }, { once: true });
      worker.postMessage({ type: "generate", id, messages, maxTokens });
    });
  },
};

export const usable = () => state.status === "downloaded" || state.status === "loading" || state.status === "ready";
