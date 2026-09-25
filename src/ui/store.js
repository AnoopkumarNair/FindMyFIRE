// Where the plan lives: a working copy in this browser (autosave) and a JSON file the user
// saves and opens themselves. Nothing is ever sent over the network.

const KEY = "findmyfire.working.v1";

export function loadWorking() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveWorking(user) {
  try {
    localStorage.setItem(KEY, JSON.stringify(user));
    return true;
  } catch {
    return false;
  }
}

export function clearWorking() {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

export function newUserFile(pack, appVersion) {
  const now = new Date().toISOString();
  return {
    $schema: "https://fire-in.local/schemas/user-file.schema.json",
    schemaVersion: 1,
    app: { rulesPack: pack.packId, rulesPackVersion: pack.packVersion, appVersion },
    createdAt: now,
    updatedAt: now,
    provenance: {},
    profile: { birthYearMonth: "" },
    plan: {},
    quick: {},
    sectionsDone: [],
  };
}

/** Light structural check for files opened from disk (full validation runs in `npm test`). */
export function checkUserFile(u) {
  if (!u || typeof u !== "object") return "This isn't a plan file.";
  if (u.schemaVersion !== 1) return `Unsupported file version (${u.schemaVersion ?? "none"}).`;
  if (!u.app?.rulesPack || !u.profile || !u.plan || !u.quick) return "The file is missing required sections.";
  return null;
}

export function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

// ---- optional passphrase encryption (AES-GCM, key from PBKDF2-SHA256) ----
const ENC_FORMAT = "findmyfire-encrypted";
const ITERATIONS = 310000;
const b64 = (buf) => {
  let s = "";
  for (const byte of new Uint8Array(buf)) s += String.fromCharCode(byte);
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, base,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encrypt(text, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
  return JSON.stringify({ format: ENC_FORMAT, v: 1, kdf: "PBKDF2-SHA256", iterations: ITERATIONS,
    salt: b64(salt), iv: b64(iv), ciphertext: b64(data) }, null, 1);
}

export const isEncrypted = (obj) => obj?.format === ENC_FORMAT;

export async function decrypt(envelope, passphrase) {
  const key = await deriveKey(passphrase, unb64(envelope.salt), envelope.iterations);
  const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(envelope.iv) }, key, unb64(envelope.ciphertext));
  return new TextDecoder().decode(data);
}
