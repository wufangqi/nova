#!/usr/bin/env node
/**
 * Scriptable visual ten-second Demo over IntentIpcHost (WUF-87).
 * Usage: npm run demo:visual-ten-second
 */
import { runVisualTenSecondDemo } from "../visual-ten-second-demo.js";

const result = await runVisualTenSecondDemo({
  pasteText: "hello demo",
  utterance: "make it uppercase",
  selection: { start: 0, end: 5 },
});

if (!result.ok) {
  console.error("fail:", result.reason);
  console.error("steps:", result.steps.join(" → "));
  process.exit(1);
}

console.log("ok: visual ten-second Demo (IPC)");
console.log("steps:", result.steps.join(" → "));
console.log("before:", JSON.stringify(result.textBefore));
console.log("after:", JSON.stringify(result.textAfter));
console.log("tabs:", result.tabCount);
console.log("elapsedMs:", result.elapsedMs.toFixed(1));
console.log("diff:\n" + result.diffText);
