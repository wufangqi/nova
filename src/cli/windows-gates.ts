#!/usr/bin/env node
/**
 * Windows capability floors (WUF-79 / WUF-102 / ADR-0004).
 * cold start · hotkey · large-file Scope · 100MB open/type/scroll · native load
 * Usage: npm run gates:windows
 */
import { runWindowsGates } from "../windows-gates.js";

const report = await runWindowsGates();
for (const g of report.gates) {
  const mark = g.ok ? "PASS" : "FAIL";
  console.log(
    `${mark} ${g.name}: ${g.elapsedMs.toFixed(1)}ms — ${g.detail}`,
  );
}

if (!report.ok) {
  console.error("Windows gates failed");
  process.exit(1);
}
console.log(
  "ok: Windows gates (cold_start / hotkey_evoke / large_file / open_100mb_editable / typing_100mb / scroll_100mb / native_addon_load)",
);
