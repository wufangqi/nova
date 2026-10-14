#!/usr/bin/env node
/**
 * Windows M2 capability floors (WUF-79 / ADR-0004).
 * cold start · hotkey evoke · large-file Scope sample
 * Usage: npm run gates:windows
 */
import { runWindowsGates } from "../windows-gates.js";

const report = runWindowsGates();
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
console.log("ok: Windows gates (cold_start / hotkey_evoke / large_file)");
