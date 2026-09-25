// Form controls. Each returns an element; `onChange(value)` fires with a parsed value
// (numbers as numbers, percents as fractions, empty as undefined).
import { h, uid } from "./dom.js";
import { words } from "./format.js";

const num = (s) => (s === "" || s == null ? undefined : Number(s));

export function control(type, value, onChange, opts = {}) {
  const id = opts.id || uid();
  const common = { id, "aria-describedby": opts.describedBy, autofocus: opts.autofocus };
  switch (type) {
    case "currency": {
      const hint = h("span", { class: "words" }, words(value));
      const input = h("input", { ...common, type: "number", inputmode: "numeric", min: 0, step: "any",
        value: value ?? "", placeholder: opts.placeholder ?? "0",
        onInput: (e) => { hint.textContent = words(num(e.target.value)); },
        onChange: (e) => onChange(num(e.target.value)) });
      return h("span", { class: "money" }, h("span", { class: "prefix" }, "₹"), input, hint);
    }
    case "integer":
    case "number":
      return h("input", { ...common, type: "number", inputmode: type === "integer" ? "numeric" : "decimal",
        step: type === "integer" ? 1 : "any", min: opts.min, max: opts.max, value: value ?? "",
        placeholder: opts.placeholder ?? "", class: "short",
        onChange: (e) => onChange(type === "integer" && e.target.value !== "" ? Math.round(num(e.target.value)) : num(e.target.value)) });
    case "percent":
      return h("span", { class: "pct" },
        h("input", { ...common, type: "number", inputmode: "decimal", step: opts.step ? opts.step * 100 : 0.5,
          min: opts.min != null ? opts.min * 100 : undefined, max: opts.max != null ? opts.max * 100 : undefined,
          value: value == null ? "" : +(value * 100).toFixed(4), placeholder: opts.placeholder ?? "", class: "short",
          onChange: (e) => { const v = num(e.target.value); onChange(v == null ? undefined : v / 100); } }),
        h("span", { class: "suffix" }, "%"));
    case "text":
      return h("input", { ...common, type: "text", value: value ?? "", placeholder: opts.placeholder ?? "",
        onChange: (e) => onChange(e.target.value.trim() || undefined) });
    case "yearMonth":
    case "month":
      return h("input", { ...common, type: "month", value: value ?? "", min: opts.min, max: opts.max,
        onChange: (e) => onChange(e.target.value || undefined) });
    case "date":
      return h("input", { ...common, type: "date", value: value ?? "", onChange: (e) => onChange(e.target.value || undefined) });
    case "boolean":
      return h("span", { class: "seg", role: "radiogroup" },
        ...[[true, "Yes"], [false, "No"]].map(([v, label]) =>
          h("button", { type: "button", class: ["seg-btn", value === v && "on"], "aria-pressed": String(value === v),
            onClick: (e) => { pressOnly(e.currentTarget); onChange(v); } }, label)));
    case "select":
      return h("select", { ...common, onChange: (e) => onChange(e.target.value || undefined) },
        opts.placeholder !== false ? h("option", { value: "" }, opts.placeholder || "Choose…") : null,
        ...(opts.groups
          ? opts.groups.map((g) => h("optgroup", { label: g.label },
              ...g.options.map((o) => h("option", { value: o.value, selected: o.value === value }, o.label))))
          : opts.options.map((o) => h("option", { value: o.value, selected: o.value === value }, o.label))));
    case "multiselect": {
      const set = new Set(value || []);
      const chips = opts.options.map((o) =>
        h("button", { type: "button", class: "chip", "data-value": o.value,
          onClick: () => {
            if (set.has(o.value)) set.delete(o.value);
            else {
              if (opts.exclusive?.includes(o.value)) set.clear();
              else opts.exclusive?.forEach((x) => set.delete(x));
              set.add(o.value);
            }
            paint();
            onChange([...set]);
          } }, o.label));
      const paint = () => chips.forEach((c) => {
        const on = set.has(c.dataset.value);
        c.classList.toggle("on", on);
        c.setAttribute("aria-pressed", String(on));
      });
      paint();
      return h("span", { class: "chips", role: "group", "aria-label": "Choose all that apply" }, ...chips);
    }
    case "source":
      return h("select", { ...common, class: "source", title: "How sure are you of this number?",
        onChange: (e) => onChange(e.target.value) },
        ...[["exact", "Exact"], ["estimate", "Estimate"], ["default", "Guess"]].map(([v, l]) =>
          h("option", { value: v, selected: (value || "estimate") === v }, l)));
    default:
      throw new Error(`Unknown control type ${type}`);
  }
}

function pressOnly(btn) {
  for (const b of btn.parentElement.children) { b.classList.remove("on"); b.setAttribute("aria-pressed", "false"); }
  btn.classList.add("on");
  btn.setAttribute("aria-pressed", "true");
}

/** Label + control + optional help text. */
export function field(label, type, value, onChange, opts = {}) {
  const id = uid();
  const helpId = opts.help ? uid("h") : undefined;
  return h("div", { class: ["field", opts.wide && "wide"] },
    h("label", { for: type === "boolean" || type === "multiselect" ? undefined : id }, label),
    control(type, value, onChange, { ...opts, id, describedBy: helpId }),
    opts.help ? h("small", { id: helpId, class: "help" }, opts.help) : null);
}
