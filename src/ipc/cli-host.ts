/**
 * Stdio JSON-lines IntentService host for the Tauri desktop sidecar.
 * One request JSON per line → one response JSON per line.
 */
import readline from "node:readline";
import { IntentIpcHost } from "./host.js";
import type { IpcRequest } from "./protocol.js";

const host = new IntentIpcHost();
const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request: IpcRequest;
  try {
    request = JSON.parse(trimmed) as IpcRequest;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(
      JSON.stringify({ ok: false, error: `invalid json: ${message}` }) + "\n",
    );
    return;
  }
  const response = host.handle(request);
  process.stdout.write(JSON.stringify(response) + "\n");
});
