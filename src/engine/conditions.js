// Evaluates the rules pack's declarative conditions without eval().
// A condition is {all:[...]}, {any:[...]}, {not:{...}} or {ref, op, value}.
// `ref` is a JSON Pointer into the user file, or `$name` for a derived value.

export function getPointer(obj, pointer) {
  if (pointer === "" || pointer === "/") return obj;
  let node = obj;
  for (const raw of pointer.split("/").slice(1)) {
    if (node == null) return undefined;
    node = node[raw.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return node;
}

export function setPointer(obj, pointer, value) {
  const segs = pointer.split("/").slice(1);
  let node = obj;
  for (const seg of segs.slice(0, -1)) {
    if (node[seg] == null || typeof node[seg] !== "object") node[seg] = {};
    node = node[seg];
  }
  const last = segs[segs.length - 1];
  if (value === undefined) delete node[last];
  else node[last] = value;
}

const isEmpty = (v) =>
  v == null || v === "" || (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

export function evaluate(cond, user, derived = {}) {
  if (!cond) return true;
  if (cond.all) return cond.all.every((c) => evaluate(c, user, derived));
  if (cond.any) return cond.any.some((c) => evaluate(c, user, derived));
  if (cond.not) return !evaluate(cond.not, user, derived);

  const v = cond.ref.startsWith("$") ? derived[cond.ref.slice(1)] : getPointer(user, cond.ref);
  const x = cond.value;
  switch (cond.op) {
    case "eq": return v === x;
    // A missing answer is "not equal": lets questions like EPF show before employment is asked.
    case "ne": return v !== x;
    case "gt": return typeof v === "number" && v > x;
    case "gte": return typeof v === "number" && v >= x;
    case "lt": return typeof v === "number" && v < x;
    case "lte": return typeof v === "number" && v <= x;
    case "in": return Array.isArray(x) && x.includes(v);
    case "exists": return v !== undefined && v !== null;
    case "missing": return v === undefined || v === null;
    case "empty": return isEmpty(v);
    case "nonEmpty": return !isEmpty(v);
    case "hasInstrument": return Array.isArray(v) && v.some((h) => h.instrumentId === x);
    case "hasCategory": return Array.isArray(v) && v.some((e) => e.categoryId === x);
    default: throw new Error(`Unknown condition op '${cond.op}'`);
  }
}
