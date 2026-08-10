// DebuggerOS runtime sensor (v48-adaptive-sensors)
// Managed by the setup-build-check edge function. Edit at your own risk.
const { chromium } = require("playwright");

const APP_URL = process.env.APP_URL || "http://localhost:5173";
const NOISE = [
  "vite/client",
  "ws://",
  "wss://",
  "[vite]",
  "hot module replacement",
  "/@vite/",
  "/@react-refresh",
  "/@fs/",
  "/@id/",
  "?import&",
  ".map",
  "sockjs-node",
  "__vite_ping",
  "hmr",
];

function isNoise(text) {
  const t = String(text || "").toLowerCase();
  return NOISE.some((n) => t.includes(n.toLowerCase()));
}

function classifyFailure(reason) {
  const r = String(reason || "").toLowerCase();
  if (r.includes("cors")) return "CORS";
  if (r.includes("timed") || r.includes("timeout")) return "timeout";
  if (r.includes("aborted")) return "aborted";
  if (r.includes("name_not_resolved") || r.includes("dns")) return "dns";
  if (r.includes("refused")) return "refused";
  return "failed";
}

(async () => {
  const errors = [];
  const counts = { net: 0, consoleErr: 0, pageErr: 0 };
  let lastPageErr = null;
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (isNoise(text)) return;
      const loc = msg.location() || {};
      counts.consoleErr++;
      errors.push({
        type: "console-error",
        text: String(text).slice(0, 1000),
        url: loc.url || null,
        line: typeof loc.lineNumber === "number" ? loc.lineNumber + 1 : null,
        column: typeof loc.columnNumber === "number" ? loc.columnNumber + 1 : null,
      });
    });

    page.on("pageerror", (err) => {
      const text = String(err && (err.message || err)).slice(0, 1000);
      if (isNoise(text)) return;
      counts.pageErr++;
      lastPageErr = {
        text,
        stack: err && err.stack ? String(err.stack).slice(0, 4000) : null,
      };
      errors.push({
        type: "uncaught-exception",
        text,
        stack: lastPageErr.stack,
      });
    });

    page.on("response", (res) => {
      try {
        const status = res.status();
        if (status < 400) return;
        const url = res.url();
        if (isNoise(url)) return;
        const req = res.request();
        const method = req.method();
        const rtype = req.resourceType();
        if (rtype === "image" || rtype === "font" || rtype === "media") return;
        counts.net++;
        errors.push({
          type: "network-error",
          text: method + " " + url + " -> " + status,
          url: String(url).slice(0, 500),
          status,
          method,
        });
      } catch (_) { /* ignore */ }
    });

    page.on("request", () => { /* counted via response/requestfailed */ });

    page.on("requestfailed", (req) => {
      const url = req.url();
      if (isNoise(url)) return;
      const failure = req.failure();
      const rawReason = failure ? failure.errorText : "request failed";
      const reason = classifyFailure(rawReason);
      counts.net++;
      errors.push({
        type: "network-failed",
        text: req.method() + " " + url + " (" + rawReason + ")",
        url: String(url).slice(0, 500),
        method: req.method(),
        reason,
      });
    });

    try {
      await page.goto(APP_URL, { waitUntil: "load", timeout: 30000 });
    } catch (navErr) {
      errors.push({
        type: "navigation-failure",
        text: String(navErr && (navErr.message || navErr)).slice(0, 500),
      });
    }

    // Let hydration + initial data fetches settle so network errors surface.
    await new Promise((r) => setTimeout(r, 5000));
    try {
      await page.waitForLoadState("networkidle", { timeout: 5000 });
    } catch (_) { /* ok if still busy */ }

    // DOM health check: give the app a touch more time, then inspect the root.
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const dom = await page.evaluate(() => {
        const root =
          document.getElementById("root") ||
          document.getElementById("app") ||
          document.getElementById("__next") ||
          document.body;
        const rootId = (root && root.id) || "body";
        const textLength = ((root && root.innerText) || "").trim().length;
        const elementCount = root ? root.querySelectorAll("*").length : 0;
        const bodyTextLength = (document.body.innerText || "").trim().length;
        const isBlank = textLength === 0 && elementCount <= 1 && bodyTextLength === 0;
        return { rootId, textLength, elementCount, bodyTextLength, isBlank };
      });
      if (dom.isBlank) {
        errors.push({
          type: "dom-blank",
          text: "App rendered blank/empty — root has no visible content",
          rootId: dom.rootId,
          textLength: dom.textLength,
          elementCount: dom.elementCount,
        });
      } else {
        errors.push({
          type: "dom-health",
          status: "ok",
          text: "dom rendered",
          rootId: dom.rootId,
          textLength: dom.textLength,
          elementCount: dom.elementCount,
        });
      }
    } catch (domErr) {
      errors.push({
        type: "dom-health",
        status: "check-failed",
        text: String(domErr && (domErr.message || domErr)).slice(0, 300),
      });
    }

    // Interaction slice: click a bounded set of visible interactive elements
    // and flag ones with ZERO observable reaction (dead) or that throw.
    try {
      const candidates = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll(
          'button, a[href], [role="button"], [onclick]'
        ));
        const out = [];
        for (const el of nodes) {
          if (out.length >= 12) break;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const visible =
            rect.width > 0 && rect.height > 0 &&
            style.visibility !== "hidden" && style.display !== "none";
          const disabled =
            el.hasAttribute("disabled") ||
            el.getAttribute("aria-disabled") === "true";
          if (!visible || disabled) continue;
          const tag = el.tagName.toLowerCase();
          const label = (
            el.innerText || el.getAttribute("aria-label") ||
            el.getAttribute("title") || el.getAttribute("href") || ""
          ).trim().replace(/\s+/g, " ").slice(0, 60);
          const id = "dbg-int-" + out.length;
          el.setAttribute("data-dbg-int", id);
          out.push({ id, tag, label });
        }
        return out;
      });

      const deadline = Date.now() + 20000;
      for (const c of candidates) {
        if (Date.now() > deadline) break;
        const baseline = await page.evaluate(() => ({
          url: location.href,
          text: (document.body.innerText || "").length,
          count: document.querySelectorAll("*").length,
        })).catch(() => null);
        if (!baseline) break;
        const netBefore = counts.net;
        const consoleBefore = counts.consoleErr;
        const pageErrBefore = counts.pageErr;
        let clickThrew = null;
        try {
          await page.evaluate((id) => {
            const el = document.querySelector('[data-dbg-int="' + id + '"]');
            if (el && typeof el.click === "function") el.click();
          }, c.id);
        } catch (e) {
          clickThrew = String(e && (e.message || e)).slice(0, 300);
        }
        await new Promise((r) => setTimeout(r, 700));
        const after = await page.evaluate(() => ({
          url: location.href,
          text: (document.body.innerText || "").length,
          count: document.querySelectorAll("*").length,
        })).catch(() => null);

        const navigated = !!after && after.url !== baseline.url;
        const domChanged = !!after && (
          after.text !== baseline.text || after.count !== baseline.count
        );
        const netChanged = counts.net > netBefore;
        const consoleChanged = counts.consoleErr > consoleBefore;
        const pageErrChanged = counts.pageErr > pageErrBefore;
        const changed = navigated || domChanged || netChanged || consoleChanged || pageErrChanged;

        if (pageErrChanged && lastPageErr) {
          errors.push({
            type: "interaction-error",
            text: 'click on "' + c.label + '" (' + c.tag + ") threw: " + lastPageErr.text,
            stack: lastPageErr.stack,
            selector: c.tag,
            label: c.label,
          });
        } else if (clickThrew) {
          errors.push({
            type: "interaction-error",
            text: 'click on "' + c.label + '" (' + c.tag + ") threw: " + clickThrew,
            selector: c.tag,
            label: c.label,
          });
        }

        if (!changed) {
          errors.push({
            type: "dead-interaction",
            text: 'clicked "' + c.label + '" (' + c.tag + "), no observable effect",
            selector: c.tag,
            label: c.label,
          });
        }

        if (navigated) {
          try { await page.goto(APP_URL, { waitUntil: "load", timeout: 10000 }); } catch (_) { /* ignore */ }
          break;
        }
      }
    } catch (intErr) {
      errors.push({
        type: "interaction-check-failed",
        text: String(intErr && (intErr.message || intErr)).slice(0, 300),
      });
    }

  } catch (crashErr) {
    errors.push({
      type: "runtime-sensor-crash",
      text: String(crashErr && (crashErr.message || crashErr)).slice(0, 500),
    });
  } finally {
    try { if (browser) await browser.close(); } catch (_) { /* ignore */ }
  }

  const interactionErrors = errors.filter((e) => e.type === "interaction-error").length;
  const deadInteractions = errors.filter((e) => e.type === "dead-interaction").length;

  console.log("===DEBUGGEROS_RUNTIME_BEGIN===");
  try {
    console.log(JSON.stringify(errors));
  } catch (_) {
    console.log("[]");
  }
  console.log("===DEBUGGEROS_RUNTIME_END===");
  console.log("DEBUGGEROS_RUNTIME_ERROR_COUNT=" + errors.length);
  console.log("DEBUGGEROS_RUNTIME_INTERACTION_ERROR_COUNT=" + interactionErrors);
  console.log("DEBUGGEROS_RUNTIME_DEAD_INTERACTION_COUNT=" + deadInteractions);
  process.exit(0);
})();
