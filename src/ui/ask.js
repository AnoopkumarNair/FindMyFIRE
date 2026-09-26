// "Ask about your plan": questions in, answers built from the plan engine. Works at once with
// plain answers; the optional on-device AI adds your-own-words questions and conversational
// replies, with every number checked before it's shown.

import { h } from "./dom.js";
import { age1 } from "./format.js";
import { answer } from "../assistant/answer.js";
import * as ai from "../assistant/client.js";

const thread = [];            // this visit's questions and answers (never saved)
let statusEl = null;          // the status line currently on screen
let running = null;           // AbortController of the answer being written
const MB = (b) => `${Math.round(b / 1e6)} MB`;
const pctOf = (s) => (s.total ? Math.floor((100 * s.done) / s.total) : 0);

// One chip in the header while the model downloads, so progress is visible on every page.
const chip = h("a", { href: "#/results", class: "ai-chip", hidden: true, "aria-live": "polite" });
export const aiChip = () => chip;

ai.subscribe((s) => {
  chip.hidden = s.status !== "downloading" && s.status !== "loading";
  chip.replaceChildren(h("span", { class: "spark", "aria-hidden": "true" }, "✦"),
    s.status === "loading" ? "Loading AI" : `AI ${pctOf(s)}%`);
  chip.setAttribute("aria-label", s.status === "loading" ? "Loading the AI model" : `Downloading the AI model: ${pctOf(s)}%`);
  if (statusEl?.isConnected) statusEl.replaceWith(statusEl = engineStatus(s));
});

function engineStatus(s, opts = statusOpts) {
  const size = s.total ? MB(s.total) : "";
  const label = s.model ? `${s.model.label} model` : "";
  const btn = (text, onClick, cls = "btn small ghost") => h("button", { type: "button", class: cls, onClick }, text);
  let body;
  switch (s.status) {
    case "unavailable":
      body = [h("span", { class: "muted" }, `Plain answers from your plan. ${s.message || ""}`)];
      break;
    case "none":
      body = [h("span", {}, h("strong", {}, "Want to ask in your own words? "), `Add the on-device AI, in beta (${size}, one-time).`),
        btn("Add AI", () => opts.confirmDownload(s), "btn small primary")];
      break;
    case "downloading": {
      const fill = h("span", { class: "fill" });
      fill.style.width = `${pctOf(s)}%`;
      body = [h("div", { class: "ai-dl" },
        h("span", {}, `Downloading the AI model: ${pctOf(s)}% (${MB(s.done)} of ${size}). Keep using the app; a refresh picks up where it left off.`),
        h("span", { class: "bar", role: "progressbar", "aria-valuenow": pctOf(s), "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": "Download progress" }, fill)),
        btn("Pause", ai.pause)];
      break;
    }
    case "paused":
      body = [h("span", {}, `AI download paused at ${pctOf(s)}%.`), btn("Resume", () => ai.start(s.model.id), "btn small primary"), btn("Remove", ai.remove)];
      break;
    case "loading":
      body = [h("span", {}, "Loading the AI into memory. This takes a few seconds, once per visit…")];
      break;
    case "downloaded":
    case "ready":
      body = [h("span", {}, h("span", { class: "spark", "aria-hidden": "true" }, "✦ "), `On-device AI on (beta) · ${label} · runs on this device's ${s.device}`),
        btn(`Remove (frees ${size})`, () => opts.confirmRemove(s))];
      break;
    case "error":
      body = [h("span", { class: "warn-text" }, s.message || "Something went wrong."), s.model ? btn("Try again", () => ai.start(s.model.id), "btn small primary") : null];
      break;
    default:
      body = [];
  }
  return h("div", { class: "ai-status" }, ...body);
}
let statusOpts = null;

function answerBlock(entry, opts) {
  const a = entry.answer;
  if (!a) {
    // The facts arrive at once; the AI's wording streams in above them.
    const b = entry.base;
    return h("div", { class: "ask-a pending" },
      b ? h("h3", {}, b.title) : null,
      entry.sentences?.length ? h("p", {}, entry.sentences.join(" ")) : null,
      h("p", { class: "writing" }, h("span", { class: "spark", "aria-hidden": "true" }, "✦ "), entry.note || (b ? "The AI is putting this into words…" : "Working it out…"),
        h("button", { type: "button", class: "btn small ghost", onClick: () => running?.abort() }, "Stop")),
      b ? h("ul", { class: "facts muted" }, ...b.facts.map((f) => h("li", {}, f))) : null);
  }
  const facts = h("ul", { class: "facts" }, ...a.facts.map((f) => h("li", {}, f)));
  const c = a.card;
  let cardEl = null;
  if (c?.type === "whatif") {
    const B = c.before, A = c.after, u = (x) => (x == null ? "—" : age1(x));
    const row = (k, b, x) => h("tr", {}, h("th", { scope: "row" }, k), h("td", { class: "num" }, b), h("td", { class: "num strong" }, x));
    const can = opts.canApply(c.changes);
    cardEl = h("div", { class: "whatif" },
      h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", { scope: "col" }, "Now"), h("th", { scope: "col" }, "With the change"))),
        h("tbody", {},
          row("Earliest FIRE age", u(B.earliestAge), u(A.earliestAge)),
          row(`Chance it lasts, stopping at ${A.targetAge}`, `${Math.round(B.chance * 100)}%`, `${Math.round(A.chance * 100)}%`),
          row("Age for a 9 in 10 chance", u(B.confidentAge), u(A.confidentAge))))),
      can ? h("button", { type: "button", class: "btn small primary", onClick: (e) => { e.target.disabled = true; opts.apply(c.changes); } }, "Apply this to my plan")
        : h("p", { class: "muted small" }, "To keep this, change it in your plan's sections."));
  }
  return h("div", { class: "ask-a", "data-mode": a.mode, "data-problem": a.problem?.why || null },
    h("h3", {}, a.title),
    a.mode === "model"
      ? [h("p", {}, a.text.join(" ")),
        h("p", { class: "checked" }, "✓ Every number checked against your plan"),
        h("details", { class: "source" }, h("summary", {}, "The numbers behind this"), facts)]
      : [facts, a.problem && a.problem.why !== "stopped" ? h("p", { class: "muted small" }, /^(unknown number|banned)/.test(a.problem.why)
        ? "The AI's wording didn't pass the number check, so here are the plain facts."
        : "The AI couldn't answer this time, so here are the plain facts.") : null],
    cardEl,
    a.followUps?.length ? h("div", { class: "chips follow" }, ...a.followUps.map((q) => h("button", { type: "button", class: "chip", onClick: () => ask(q, opts) }, q))) : null,
    entry.stats ? h("p", { class: "muted tiny" }, `Written by the on-device AI in ${(entry.stats.ms / 1000).toFixed(1)} s.`) : null);
}

let threadEl = null;
function drawThread(opts) {
  if (!threadEl?.isConnected) return;
  const fresh = thread.some((e) => !e.drawn);
  threadEl.replaceChildren(...thread.slice(-6).map((e) => h("div", { class: ["ask-turn", !e.drawn && "new"] }, h("p", { class: "ask-q" }, e.q), answerBlock(e, opts))));
  for (const e of thread) e.drawn = true;
  if (fresh) threadEl.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function ask(q, opts) {
  q = q.trim();
  if (!q || running) return;
  const entry = { q, answer: null, sentences: [] };
  thread.push(entry);
  const useAi = ai.usable();
  if (useAi && ai.current().status !== "ready") entry.note = "Loading the AI (first question only)…";
  drawThread(opts);
  running = new AbortController();
  try {
    entry.answer = await answer(q, opts.getCtx(), {
      llm: useAi ? ai.llm : null, signal: running.signal,
      onFacts: (b) => { entry.base = b; entry.note = null; drawThread(opts); },
      onUpdate: ({ sentences }) => { entry.sentences = sentences; drawThread(opts); },
    });
    if (entry.answer.mode === "model") entry.stats = ai.current().stats;
  } catch (e) {
    entry.answer = { title: "Something went wrong", facts: [String(e?.message || e)], followUps: [] };
  } finally {
    running = null;
    drawThread(opts);
  }
}

/**
 * The card on the results page.
 * opts: { getCtx, canApply(changes), apply(changes), confirmDownload(state), confirmRemove(state) }
 */
export function askCard(opts) {
  statusOpts = opts;
  const r = opts.getCtx().result;
  const input = h("input", { type: "text", enterkeyhint: "send", maxlength: 200, autocomplete: "off",
    placeholder: "e.g. What if I invest ₹10k more a month?", "aria-label": "Your question" });
  const form = h("form", { class: "ask-form", onSubmit: (e) => { e.preventDefault(); const q = input.value; input.value = ""; ask(q, opts); } },
    input, h("button", { type: "submit", class: "btn primary" }, "Ask"));
  const soon = Math.max(Math.ceil(r.inputs.age) + 1, r.target.age - 3);
  const starters = ["Why this age?", "Will my money last?", "What if I invest ₹10k more a month?", `What would it take to stop at ${soon}?`, "How does the money come out after FIRE?"];
  threadEl = h("div", { class: "ask-thread", "aria-live": "polite" });
  statusEl = engineStatus(ai.current(), opts);
  const el = h("section", { class: "card ask", id: "ask" },
    h("h2", {}, "Ask about your plan"),
    h("p", { class: "muted small" }, "Answers use the same calculations as this page. What you type stays on this device."),
    form,
    h("div", { class: "chips starters" }, ...starters.map((q) => h("button", { type: "button", class: "chip", onClick: () => ask(q, opts) }, q))),
    threadEl,
    statusEl);
  queueMicrotask(() => drawThread(opts));
  return el;
}
