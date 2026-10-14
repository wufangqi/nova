#!/usr/bin/env node
/**
 * Non-interactive Windows/manual demo: evoke → paste → save.
 * Usage: npm run notepad:demo -- [outPath]
 */
import { resolve } from "node:path";
import { EditorShell } from "../editor-shell.js";

const out =
  process.argv[2] ??
  resolve(process.cwd(), "nova-wuf71-demo.txt");

const shell = new EditorShell();
shell.evokeNewUntitled(); // prior scratch
const prior = shell.activeBufferId!;
shell.handleHotkeyEvoke(); // hotkey again → new untitled, prior kept
if (shell.listTabs().length !== 2 || shell.activeBufferId === prior) {
  console.error("evoke did not keep prior Buffer / activate new one");
  process.exit(1);
}
shell.editActive("pasted clipboard text");
await shell.saveActiveAs(out);
console.log(`ok: evoke → paste → save → ${out}`);
console.log(
  `tabs=${shell.listTabs().length} active=${shell.getTab(shell.activeBufferId!).path}`,
);
