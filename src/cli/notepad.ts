#!/usr/bin/env node
/**
 * Minimal notepad shell for manual "evoke → paste → save" on Windows (and elsewhere).
 * Commands: evoke | tabs | switch <n> | paste <text…> | save <path> | open <path> | close | quit | help
 */
import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { EditorShell } from "../editor-shell.js";

const shell = new EditorShell();
shell.evokeNewUntitled();

function printTabs(): void {
  const tabs = shell.listTabs();
  if (!tabs.length) {
    console.log("(no open Buffers)");
    return;
  }
  for (let i = 0; i < tabs.length; i++) {
    const t = tabs[i]!;
    const mark = t.active ? ">" : " ";
    console.log(`${mark} [${i}] ${t.title}${t.path ? `  ${t.path}` : ""}`);
  }
}

function help(): void {
  console.log(`Nova notepad shell (WUF-71)
  evoke              global-hotkey evoke: new untitled Buffer (keeps others)
  tabs               list Buffer tabs
  switch <n>         activate tab by index
  paste <text>       set active Buffer text (simulates paste)
  open <path>        open Path into a Buffer
  save <path>        save active Buffer to Path (saveAs if untitled)
  close              request-close active (asks if dirty untitled)
  discard            confirm discard after close asked
  quit               exit
  help               this text`);
}

help();
printTabs();

const rl = createInterface({
  input,
  output,
  terminal: Boolean(input.isTTY),
});

let pendingDiscard: string | null = null;

async function handle(lineRaw: string): Promise<boolean> {
  const line = lineRaw.trim();
  if (!line) return true;
  const [cmd, ...rest] = line.split(/\s+/);
  const arg = rest.join(" ");

  switch (cmd) {
    case "help":
      help();
      break;
    case "evoke":
      shell.handleHotkeyEvoke();
      console.log("evoked new untitled Buffer");
      printTabs();
      break;
    case "tabs":
      printTabs();
      break;
    case "switch": {
      const n = Number(rest[0]);
      const tab = shell.listTabs()[n];
      if (!tab) throw new Error(`no tab ${n}`);
      shell.activateTab(tab.bufferId);
      printTabs();
      break;
    }
    case "paste":
      if (!arg) throw new Error("usage: paste <text>");
      shell.editActive(arg);
      console.log(`active text length=${arg.length}`);
      break;
    case "open":
      if (!arg) throw new Error("usage: open <path>");
      await shell.openPath(arg);
      printTabs();
      break;
    case "save": {
      if (!arg) throw new Error("usage: save <path>");
      const tab = shell.getTab(shell.activeBufferId!);
      if (tab.untitled || tab.path !== arg) {
        await shell.saveActiveAs(arg);
      } else {
        await shell.saveActive();
      }
      console.log(`saved → ${arg}`);
      printTabs();
      break;
    }
    case "close": {
      const id = shell.activeBufferId;
      if (!id) {
        console.log("nothing to close");
        break;
      }
      const r = shell.requestClose(id);
      if (r.ok) {
        pendingDiscard = null;
        console.log("closed");
        printTabs();
      } else {
        pendingDiscard = id;
        console.log(
          `needs confirm (${r.reason}). Type 'discard' to close without saving.`,
        );
      }
      break;
    }
    case "discard": {
      if (!pendingDiscard) {
        console.log("nothing pending");
        break;
      }
      shell.confirmClose(pendingDiscard);
      pendingDiscard = null;
      console.log("discarded");
      printTabs();
      break;
    }
    case "quit":
    case "exit":
      return false;
    default:
      console.log(`unknown command: ${cmd} (try help)`);
  }
  return true;
}

async function main(): Promise<void> {
  for await (const line of rl) {
    try {
      const cont = await handle(line);
      if (!cont) break;
    } catch (e) {
      console.error(String(e));
    }
  }
}

main().finally(() => {
  rl.close();
});
