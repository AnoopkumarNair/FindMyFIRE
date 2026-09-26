// The assistant as the page sees it: status, the download the user started, and a `generate`
// the answer pipeline can call. The worker does the heavy lifting.

import { variantBytes } from "./download.js";

const KEY = "fmf.assistant";
const manifestUrl = new URL("./models.json", import.meta.url).href;
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const keep = (x) => { try { localStorage.setItem(KEY, JSON.stringify(x)); } catch { /* private mode: resume won't survive a refresh */ } };

// status: unavailable | none | downloading | paused | downloaded | loading | ready | error
//         | crashed (loading killed the tab last time) | toobig (downloaded, but this device can't hold it)
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
    else if (m.type === "loaded") { keep({ ...load(), loadingSince: null }); set({ status: "ready" }); loadWaiters.splice(0).forEach((w) => w.res()); }
    else if (m.type === "removed") {
      keep({});
      set(tooBigHere(state.total) ? { status: "unavailable", message: TOO_BIG(state.total), done: 0 } : { status: "none", done: 0 });
    }
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
        keep({ ...load(), loadingSince: null });
        loadWaiters.splice(0).forEach((w) => w.rej(new Error(m.message)));
        set({ status: "error", message: `The AI couldn't start on this device (${m.message}). Plain answers still work.` });
        return;
      }
      set({ status: "error", message: m.integrity ? "A downloaded piece didn't match its checksum, so it was thrown away. Try again." : m.message });
    }
  };
  return worker;
}

// A browser tab on a phone can't hold a model this big in memory (a 3.1 GB model crashed an
// Android phone's tab while loading). Bigger models are for laptops and desktops.
export const PHONE_MAX_BYTES = 1.6e9;
/** "phone", "tablet" or "computer", from what the browser says about itself. */
export function deviceKind(nav = navigator) {
  const ua = nav.userAgent || "";
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return "tablet";
  if (nav.userAgentData?.mobile || /iPhone|iPod|Android|Mobile/i.test(ua)) return "phone";
  return "computer";
}
const GB = (bytes) => `${Math.round(bytes / 1e8) / 10} GB`;
const tooBigHere = (bytes) => deviceKind() !== "computer" && bytes > PHONE_MAX_BYTES;
const TOO_BIG = (bytes) => `The AI assistant needs a laptop or desktop: its ${GB(bytes)} model is too big for a phone or tablet browser. Your answers here come straight from your plan, with the same numbers.`;
const NO_GPU = "Your answers come straight from your plan. The optional AI needs a browser with WebGPU, such as a recent Chrome, Edge or Safari on a laptop or desktop.";
const smallest = (model) => Math.min(...Object.keys(model.variants).map((v) => variantBytes(model, v)));

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
  const had = saved.modelId === model.id && saved.status;
  // Phones and tablets first: they get the same message whatever their browser supports.
  if (tooBigHere(smallest(model))) { set({ model, total: smallest(model), status: had ? "toobig" : "unavailable", message: TOO_BIG(smallest(model)) }); return; }
  const pick = saved.variant && model.variants[saved.variant] ? { variant: saved.variant, device: saved.device } : await pickVariant(model);
  if (!pick) { set({ status: "unavailable", model, message: NO_GPU }); return; }
  const total = variantBytes(model, pick.variant);
  set({ model, variant: pick.variant, device: pick.device, total, done: saved.modelId === model.id ? saved.done || 0 : 0 });
  // Loading started last visit and never finished: the tab was killed (out of memory). Don't try again by itself.
  if (had && saved.loadingSince) { set({ status: "crashed", message: "Loading the AI closed this page last time, most likely because this device ran out of memory." }); return; }
  if (had) getWorker().postMessage({ type: "check", manifestUrl, modelId: model.id, variant: pick.variant });
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
  if (!pick) { set({ status: "unavailable", message: NO_GPU }); return; }
  const total = variantBytes(model, pick.variant);
  set({ model, variant: pick.variant, device: pick.device, total });
  if (tooBigHere(total)) { set({ status: "unavailable", message: TOO_BIG(total) }); return; }
  if (!(await storageOk(total))) { set({ status: "error", message: "Not enough free storage on this device for the model." }); return; }
  resume();
}

export const pause = () => worker?.postMessage({ type: "pause" });
export const remove = () => getWorker().postMessage({ type: "remove" });
/** After a crash: let the user try loading once more, knowingly. */
export const retryAfterCrash = () => { keep({ ...load(), loadingSince: null }); set({ status: "downloaded", message: "" }); };

/** Loads the model into memory (once per page load). */
export function ensureLoaded() {
  if (state.status === "ready") return Promise.resolve();
  if (state.status !== "downloaded" && state.status !== "loading") return Promise.reject(new Error("Model not downloaded"));
  return new Promise((res, rej) => {
    loadWaiters.push({ res, rej });
    if (state.status !== "loading") {
      keep({ ...load(), loadingSince: Date.now() }); // cleared when loading ends; still set after a crash
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
