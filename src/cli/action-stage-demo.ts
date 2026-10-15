#!/usr/bin/env node
/**
 * Reproducible M3 Action Stage exit Demo (WUF-94).
 * hotkey → RegexDraft Intent → save → reload → preview_run → Accept
 * Usage: npm run demo:action-stage
 */
import { runActionStageDemo } from "../action-stage-demo.js";

const result = runActionStageDemo({
  pasteText: "red fox red hen",
  utterance: "regex s/red/blue/g",
  runText: "red fox red hen",
  selection: { start: 0, end: 8 },
});

if (!result.ok) {
  console.error(`FAIL: ${result.reason}`);
  console.error(`steps=${result.steps.join(" → ")}`);
  process.exit(1);
}

console.log("ok: Action Stage exit Demo");
console.log(`steps=${result.steps.join(" → ")}`);
console.log(
  `action=${result.actionId} displayName=${JSON.stringify(result.displayName)}`,
);
console.log(
  `text: ${JSON.stringify(result.textBeforeRun)} → ${JSON.stringify(result.textAfterAccept)}`,
);
console.log(
  `outbound=${result.outboundPresent} provenance=${result.provenanceSource} retentionMetricRequired=${result.retentionMetricRequired} elapsedMs=${result.elapsedMs.toFixed(1)}`,
);
