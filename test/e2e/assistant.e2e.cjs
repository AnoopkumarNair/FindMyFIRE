// Browser run of the whole assistant with a real model served locally: download, refresh
// mid-way, resume, load, answer. Needs Playwright and a model in models-dev/ (see the
// "Publish AI model" workflow). Headless Chromium has no GPU, so this is the CPU path.
//
//   node test/e2e/assistant.e2e.cjs models-dev/qwen3-0.6b.entry.json out-dir
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const { readFileSync, mkdirSync } = require("node:fs");
const path = require("node:path");

const [entryFile, outDir = "e2e-out"] = process.argv.slice(2);
const entry = JSON.parse(readFileSync(entryFile, "utf8"));
const root = path.join(__dirname, "../..");
mkdirSync(outDir, { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(root, "src/assistant/models.json"), "utf8"));
manifest.base = "http://localhost:8080/models-dev/";
manifest.models = [entry];

(async () => {
  const server = spawn("node", ["scripts/serve.mjs"], { cwd: root, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route("**/src/assistant/models.json*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(manifest) }));
  // Slow the model host down a little so the refresh lands mid-download.
  await ctx.route("**/models-dev/**", async (r) => { await new Promise((x) => setTimeout(x, 120)); r.continue(); });
  const page = await ctx.newPage();
  const log = [];
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && log.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => log.push(`pageerror: ${e.message}`));
  const status = () => page.textContent(".ai-status");
  const pct = async () => Number(((await status()).match(/(\d+)%/) || [])[1] || 0);
  const result = { ok: false };
  try {
    await page.goto("http://localhost:8080/#/");
    await page.click("nav .menu summary");
    await page.click("text=Load an example plan");
    await page.waitForSelector(".ask .ai-status button");
    await page.click(".ask .ai-status button:has-text('Add AI')");
    await page.click("dialog button:has-text('Download')");
    await page.waitForFunction(() => /(\d+)%/.test(document.querySelector(".ai-status")?.textContent || "") && +RegExp.$1 >= 25, null, { timeout: 300000 });
    const before = await pct();
    await page.reload();
    await page.waitForSelector(".ask");
    await page.waitForFunction(() => /Downloading|On-device AI on/.test(document.querySelector(".ai-status")?.textContent || ""), null, { timeout: 60000 });
    const after = await pct();
    result.resume = { before, after };
    await page.waitForSelector(".ai-status:has-text('On-device AI on')", { timeout: 600000 });
    for (const q of ["How likely is it to work?", "honestly, is quitting at 50 realistic for me?"]) {
      const t0 = Date.now();
      const n = await page.locator(".ask-turn").count();
      await page.fill(".ask-form input", q);
      await page.press(".ask-form input", "Enter");
      await page.waitForFunction((k) => document.querySelectorAll(".ask-turn .ask-a:not(.pending)").length > k, n, { timeout: 600000 });
      const last = page.locator(".ask-turn").last();
      result[q] = { seconds: (Date.now() - t0) / 1000, model: await last.locator(".checked").count() > 0, text: (await last.locator(".ask-a").textContent()).slice(0, 400) };
    }
    result.finalStatus = await status();
    await page.locator(".ask").screenshot({ path: path.join(outDir, "assistant.png") });
    result.ok = result.resume.after >= result.resume.before - 1;
  } catch (e) {
    result.error = String(e.message || e);
    await page.screenshot({ path: path.join(outDir, "failure.png") }).catch(() => {});
    result.status = await status().catch(() => null);
  }
  result.console = log.slice(0, 30);
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  server.kill();
  process.exit(result.ok ? 0 : 1);
})();
