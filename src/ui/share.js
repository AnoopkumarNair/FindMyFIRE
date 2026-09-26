// Shareable result card, drawn on a canvas on this device. Only what the user ticks goes on it,
// and nothing is uploaded: the image is handed to the phone's share sheet or downloaded.
import { h } from "./dom.js";
import { inrShort, age1 } from "./format.js";

const W = 1080, H = 1350;
// Whatever address the app is served from (github.io today, a custom domain later).
const SITE = (location.host + location.pathname).replace(/\/(index\.html)?$/, "") || "FindMyFIRE";

async function fontsReady() {
  try {
    await Promise.all([
      document.fonts.load('800 200px "Bricolage Grotesque"'),
      document.fonts.load('600 40px "Plus Jakarta Sans"'),
    ]);
  } catch { /* fall back to system fonts */ }
}

export async function drawCard(canvas, r, { showTarget, showAmounts }) {
  await fontsReady();
  canvas.width = W; canvas.height = H;
  const x = canvas.getContext("2d");
  const display = '"Bricolage Grotesque", system-ui, sans-serif', body = '"Plus Jakarta Sans", system-ui, sans-serif';

  // Night-to-dawn sky
  const sky = x.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#161447"); sky.addColorStop(0.55, "#3b2f8f"); sky.addColorStop(0.82, "#e0724b"); sky.addColorStop(1, "#f7b64a");
  x.fillStyle = sky; x.fillRect(0, 0, W, H);
  // Stars (fixed pattern, so every card looks the same for the same result)
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  x.fillStyle = "rgba(255,255,255,0.8)";
  for (let i = 0; i < 70; i++) { x.globalAlpha = 0.25 + rnd() * 0.6; x.beginPath(); x.arc(rnd() * W, rnd() * H * 0.5, 1 + rnd() * 2.2, 0, 7); x.fill(); }
  x.globalAlpha = 1;
  // Sun rising behind the horizon, with a halo
  const sunY = H - 250;
  const halo = x.createRadialGradient(W / 2, sunY, 60, W / 2, sunY, 520);
  halo.addColorStop(0, "rgba(255,214,120,0.55)"); halo.addColorStop(1, "rgba(255,214,120,0)");
  x.fillStyle = halo; x.fillRect(0, 0, W, H);
  x.fillStyle = "#ffd36e"; x.beginPath(); x.arc(W / 2, sunY, 170, Math.PI, 0); x.fill();
  // Hills
  x.fillStyle = "#1e1a5a";
  x.beginPath(); x.moveTo(0, H - 250); x.bezierCurveTo(260, H - 330, 520, H - 190, 760, H - 260); x.bezierCurveTo(900, H - 300, 1000, H - 270, W, H - 290); x.lineTo(W, H); x.lineTo(0, H); x.fill();
  x.fillStyle = "#12103a";
  x.beginPath(); x.moveTo(0, H - 150); x.bezierCurveTo(300, H - 230, 640, H - 110, W, H - 190); x.lineTo(W, H); x.lineTo(0, H); x.fill();

  // Text
  x.textAlign = "left"; x.fillStyle = "#ffffff";
  x.font = `700 44px ${display}`;
  x.fillText("FindMy", 90, 140);
  const fm = x.measureText("FindMy").width;
  x.fillStyle = "#ffd36e"; x.fillText("FIRE", 90 + fm, 140);

  x.fillStyle = "rgba(255,255,255,0.85)"; x.font = `600 48px ${body}`;
  x.fillText("I could make work optional at", 90, 330);
  x.fillStyle = "#ffffff"; x.font = `800 300px ${display}`;
  const age = r.earliestAge == null ? "—" : String(Math.round(r.earliestAge));
  x.fillText(age, 78, 620);
  const aw = x.measureText(age).width;
  x.font = `700 64px ${display}`; x.fillStyle = "#ffd36e";
  x.fillText("years old", 100 + aw, 610);

  x.font = `600 40px ${body}`; x.fillStyle = "rgba(255,255,255,0.92)";
  const lines = [];
  if (r.chance?.likelyAge != null) lines.push(`3 in 4 chance by ${Math.round(r.chance.likelyAge)} · 9 in 10 by ${r.chance.confidentAge == null ? "—" : Math.round(r.chance.confidentAge)}`);
  if (showTarget) lines.push(r.target.gap >= 0 ? `On track for my target of ${r.target.age}` : `Working towards ${r.target.age}`);
  if (showAmounts) lines.push(`Corpus needed: ${inrShort(r.target.required)} · on track for ${inrShort(r.target.projected)}`);
  lines.forEach((t, i) => x.fillText(t, 90, 720 + i * 62));

  x.font = `600 34px ${body}`; x.fillStyle = "rgba(255,255,255,0.9)";
  x.textAlign = "center";
  x.fillText("Planned privately · nothing leaves your device", W / 2, H - 92);
  x.font = `700 34px ${body}`; x.fillStyle = "#ffd36e";
  x.fillText(SITE, W / 2, H - 46);
  return canvas;
}

const toBlob = (canvas) => new Promise((res) => canvas.toBlob(res, "image/png"));

/** Dialog with a live preview, two tick-boxes, and Share / Download. */
export function openShareDialog(r) {
  const opts = { showTarget: true, showAmounts: false };
  const canvas = document.createElement("canvas");
  const img = h("img", { class: "share-preview", alt: `Share card: could make work optional at ${age1(r.earliestAge)}` });
  const redraw = async () => { await drawCard(canvas, r, opts); img.src = canvas.toDataURL("image/png"); };
  const box = (key, label) => h("label", { class: "check" },
    h("input", { type: "checkbox", checked: opts[key], onChange: (e) => { opts[key] = e.target.checked; redraw(); } }), label);
  const status = h("p", { class: "small muted", role: "status" });
  const dlg = h("dialog", { class: "dialog share" });
  const close = () => { dlg.close(); dlg.remove(); };
  const share = async () => {
    const blob = await toBlob(canvas);
    const file = new File([blob], "my-fire-age.png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], text: "When can work become optional? I checked on FindMyFIRE.", url: `https://${SITE}/` }); return; }
      catch (e) { if (e.name === "AbortError") return; }
    }
    download(blob);
  };
  const download = (blob) => {
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: "my-fire-age.png" });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = "Saved as my-fire-age.png.";
  };
  dlg.append(
    h("h2", {}, "Share your FIRE age"),
    h("p", { class: "small muted" }, "The picture is made on your device. Only what you tick below goes on it."),
    img,
    h("div", { class: "checks" }, box("showTarget", "Show my target age"), box("showAmounts", "Show amounts (₹)")),
    status,
    h("div", { class: "dialog-actions" },
      h("button", { type: "button", class: "btn ghost", onClick: close }, "Close"),
      h("button", { type: "button", class: "btn", onClick: async () => download(await toBlob(canvas)) }, "Download"),
      h("button", { type: "button", class: "btn primary", onClick: share }, "Share")));
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  document.body.append(dlg);
  dlg.showModal();
  redraw();
}
