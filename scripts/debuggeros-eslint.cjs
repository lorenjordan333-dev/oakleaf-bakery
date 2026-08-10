// DebuggerOS ESLint sensor (v48-adaptive-sensors)
// Managed by the setup-build-check edge function. Edit at your own risk.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BEGIN = "===DEBUGGEROS_ESLINT_BEGIN===";
const END = "===DEBUGGEROS_ESLINT_END===";

function has(mod) { try { require.resolve(mod); return true; } catch (_) { return false; } }
function ensure(mod) {
  if (has(mod)) return true;
  const r = spawnSync("npm", ["install", "--no-save", "--no-audit", "--no-fund", "--silent", mod], { stdio: "inherit" });
  return r.status === 0 && has(mod);
}

function emit(findings, extra) {
  console.log(BEGIN);
  try { console.log(JSON.stringify(findings)); } catch (_) { console.log("[]"); }
  console.log(END);
  for (const k of Object.keys(extra || {})) console.log(k + "=" + extra[k]);
}

try {
  const okEslint = ensure("eslint");
  const okHooks = ensure("eslint-plugin-react-hooks");
  if (!okEslint || !okHooks) {
    emit([], { DEBUGGEROS_ESLINT_EXIT: 0, DEBUGGEROS_ESLINT_SKIPPED: "install-failed" });
    process.exit(0);
  }
  const hasTsParser = has("@typescript-eslint/parser");

  const cfgPath = path.join(process.cwd(), ".debuggeros-eslint.config.cjs");
  const cfg =
    (hasTsParser ? 'const tsParser = require("@typescript-eslint/parser");\n' : "") +
    'const reactHooks = require("eslint-plugin-react-hooks");\n' +
    'const IGNORES = ["node_modules/**","dist/**","build/**",".next/**",".output/**",".vinxi/**","scripts/debuggeros-*.cjs","**/*.d.ts"];\n' +
    'const RULES = { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" };\n' +
    'module.exports = [\n' +
    (hasTsParser
      ? '  { files: ["**/*.{ts,tsx}"], ignores: IGNORES, languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } } }, plugins: { "react-hooks": reactHooks }, rules: RULES },\n'
      : "") +
    '  { files: ["**/*.{js,jsx,mjs,cjs}"], ignores: IGNORES, languageOptions: { parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } } }, plugins: { "react-hooks": reactHooks }, rules: RULES },\n' +
    '];\n';
  fs.writeFileSync(cfgPath, cfg);

  const target = fs.existsSync("src") ? "src" : ".";
  const args = ["--yes", "eslint", "--no-config-lookup", "--config", cfgPath, "--format", "json", "--no-error-on-unmatched-pattern", target];
  const res = spawnSync("npx", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const raw = String(res.stdout || "[]");
  let parsed = [];
  try { parsed = JSON.parse(raw); } catch (_) { parsed = []; }

  const findings = [];
  let errorCount = 0, warnCount = 0;
  for (const f of parsed) {
    const filePath = String(f && f.filePath || "");
    if (!filePath) continue;
    const rel = path.relative(process.cwd(), filePath).replace(/\\\\/g, "/");
    const msgs = Array.isArray(f.messages) ? f.messages : [];
    const kept = [];
    for (const m of msgs) {
      const rule = String(m && m.ruleId || "");
      if (!rule.startsWith("react-hooks/")) continue;
      kept.push({
        ruleId: rule,
        message: String(m.message || "").slice(0, 500),
        line: Number(m.line) || 0,
        column: Number(m.column) || 0,
        severity: Number(m.severity) || 1,
      });
      if (m && m.severity === 2) errorCount++; else warnCount++;
    }
    if (kept.length) findings.push({ filePath: rel, messages: kept });
  }

  emit(findings, {
    DEBUGGEROS_ESLINT_EXIT: res.status == null ? 0 : res.status,
    DEBUGGEROS_ESLINT_JSON_BYTES: Buffer.byteLength(raw),
    DEBUGGEROS_ESLINT_ERROR_COUNT: errorCount,
    DEBUGGEROS_ESLINT_WARNING_COUNT: warnCount,
    DEBUGGEROS_ESLINT_TS_PARSER: hasTsParser ? "yes" : "no",
  });
  try { fs.unlinkSync(cfgPath); } catch (_) {}
  process.exit(0);
} catch (e) {
  emit([], {
    DEBUGGEROS_ESLINT_EXIT: 1,
    DEBUGGEROS_ESLINT_SKIPPED: "threw:" + String(e && e.message || e).slice(0, 200).replace(/\s+/g, " "),
  });
  process.exit(0);
}
