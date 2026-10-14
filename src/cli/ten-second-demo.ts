#!/usr/bin/env node
/**
 * Reproducible M2 ten-second Demo (WUF-79).
 * hotkey → new Buffer → paste → Intent → preview → Accept
 * Usage: npm run demo:ten-second
 */
import { runTenSecondDemo } from "../ten-second-demo.js";

const result = runTenSecondDemo({
  pasteText: "hello demo",
  utterance: "make it uppercase",
  selection: { start: 0, end: 5 },
});

if (!result.ok) {
  console.error(`FAIL: ${result.reason}`);
  console.error(`steps=${result.steps.join(" → ")}`);
  process.exit(1);
}

console.log("ok: ten-second Demo");
console.log(`steps=${result.steps.join(" → ")}`);
console.log(`text: ${JSON.stringify(result.textBefore)} → ${JSON.stringify(result.textAfter)}`);
console.log(
  `tabs=${result.tabCount} modelPath=${result.modelPath} outbound=${result.outboundPresent} elapsedMs=${result.elapsedMs.toFixed(1)}`,
);
console.log(
  "note: offline AI uses preinstalled local model on Demo/eval machines; default installer need not ship a large model (ADR-0003).",
);
