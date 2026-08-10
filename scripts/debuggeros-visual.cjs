// DebuggerOS visual sensor (v48-adaptive-sensors)
// Managed by the setup-build-check edge function. Edit at your own risk.
const { chromium } = require("playwright");

const APP_URL = process.env.APP_URL || "http://localhost:8080";
const PAGE_PATH = process.env.PAGE_PATH || "/";
const BEGIN = "===DEBUGGEROS_VISUAL_BEGIN===";
const END = "===DEBUGGEROS_VISUAL_END===";

function emitEmpty(reason) {
  console.log("DEBUGGEROS_VISUAL_SKIPPED=" + reason);
  console.log(BEGIN);
  console.log("");
  console.log(END);
}

(async () => {
  let browser;
  try {
    const target = APP_URL.replace(/\/$/, "") + (PAGE_PATH.startsWith("/") ? PAGE_PATH : "/" + PAGE_PATH);
    console.log("DEBUGGEROS_VISUAL_URL=" + target);

    // Sanity: hit the URL over HTTP first so we log a clear status before Playwright.
    try {
      const http = require("http");
      const u = new URL(target);
      await new Promise((resolve) => {
        const req = http.get({ hostname: u.hostname, port: u.port, path: u.pathname, timeout: 5000 }, (res) => {
          console.log("DEBUGGEROS_VISUAL_HTTP_STATUS=" + res.statusCode);
          let n = 0; res.on("data", (c) => { n += c.length; }); res.on("end", () => { console.log("DEBUGGEROS_VISUAL_HTTP_BYTES=" + n); resolve(); });
        });
        req.on("error", (e) => { console.log("DEBUGGEROS_VISUAL_HTTP_ERR=" + String(e && e.message || e).slice(0, 200)); resolve(); });
        req.on("timeout", () => { console.log("DEBUGGEROS_VISUAL_HTTP_ERR=timeout"); req.destroy(); resolve(); });
      });
    } catch (e) {
      console.log("DEBUGGEROS_VISUAL_HTTP_THREW=" + String(e && e.message || e).slice(0, 200));
    }

    browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on("console", (msg) => { try { console.log("DEBUGGEROS_VISUAL_PAGE_CONSOLE=" + String(msg.type()) + ":" + String(msg.text()).slice(0, 300)); } catch (_) {} });
    page.on("pageerror", (e) => { console.log("DEBUGGEROS_VISUAL_PAGE_ERR=" + String(e && e.message || e).slice(0, 300)); });

    let navStatus = "?";
    try {
      const resp = await page.goto(target, { waitUntil: "load", timeout: 30000 });
      navStatus = resp ? String(resp.status()) : "no-response";
    } catch (e) {
      console.log("DEBUGGEROS_VISUAL_NAV_ERR=" + String(e && e.message || e).slice(0, 200));
    }
    console.log("DEBUGGEROS_VISUAL_NAV_STATUS=" + navStatus);
    console.log("DEBUGGEROS_VISUAL_PAGE_URL=" + page.url());

    await new Promise((r) => setTimeout(r, 2500));
    try { await page.waitForLoadState("networkidle", { timeout: 5000 }); } catch (_) {}
    await new Promise((r) => setTimeout(r, 800));

    let bodyLen = 0;
    try { bodyLen = await page.evaluate(() => (document.body && document.body.innerText || "").length); } catch (_) {}
    console.log("DEBUGGEROS_VISUAL_BODY_TEXT_LEN=" + bodyLen);

    // Hide DebuggerOS widget so it is not captured in the screenshot.
    try {
      await page.addStyleTag({ content: '[id^="__dbgos"],[class^="__dbgos"],[class*=" __dbgos"],[id^="debuggeros"],[class*="debuggeros"],[data-debuggeros]{display:none !important;visibility:hidden !important;opacity:0 !important;}' });
      await page.evaluate(() => {
        const sel = '[id^="__dbgos"],[class^="__dbgos"],[class*=" __dbgos"],[id^="debuggeros"],[class*="debuggeros"],[data-debuggeros]';
        document.querySelectorAll(sel).forEach((el) => { el.style.display = 'none'; });
        // Also hide the injected widget style tag's siblings: fixed-position roots the widget appends.
        document.querySelectorAll('script[src*="debuggeros-widget"]').forEach((s) => {
          let n = s.parentElement;
          if (n) n.querySelectorAll('div[style*="position: fixed"]').forEach((d) => { d.style.display = 'none'; });
        });
      });
    } catch (_) {}

    // Cap height so base64 reliably fits in the GitHub Actions log.
    const MAX_H = 4000;
    let docH = 800;
    try { docH = await page.evaluate(() => Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement ? document.documentElement.scrollHeight : 0)); } catch (_) {}
    const clipH = Math.min(docH || 800, MAX_H);
    console.log("DEBUGGEROS_VISUAL_DOC_H=" + docH + " CLIP_H=" + clipH);
    const buf = await page.screenshot({ type: "jpeg", quality: 40, clip: { x: 0, y: 0, width: 1100, height: clipH } });
    const b64 = Buffer.from(buf).toString("base64");
    console.log("DEBUGGEROS_VISUAL_JPEG_BYTES=" + buf.length);
    console.log("DEBUGGEROS_VISUAL_B64_BYTES=" + b64.length);

    // Chunk to keep any per-line log processing happy.
    const CHUNK = 4000;
    const chunks = Math.ceil(b64.length / CHUNK);
    console.log("DEBUGGEROS_VISUAL_CHUNKS=" + chunks);
    console.log(BEGIN);
    for (let i = 0; i < b64.length; i += CHUNK) process.stdout.write(b64.slice(i, i + CHUNK) + "\n");
    console.log(END);
    console.log("DEBUGGEROS_VISUAL_DONE=1");
    process.exit(0);
  } catch (e) {
    emitEmpty("threw:" + String(e && e.message || e).slice(0, 200).replace(/\s+/g, " "));
    process.exit(0);
  } finally {
    try { if (browser) await browser.close(); } catch (_) {}
  }
})();
