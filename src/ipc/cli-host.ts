/**
 * Stdio JSON-lines IntentService host for the Tauri desktop sidecar.
 * One request JSON per line → one response JSON per line.
 * Requests are serialized so async Path IO cannot interleave responses.
 */
import readline from "node:readline";
import { IntentIpcHost } from "./host.js";
import type { IpcRequest } from "./protocol.js";

const host = new IntentIpcHost();
const rl = readline.createInterface({ input: process.stdin, terminal: false });

let queue: Promise<void> = Promise.resolve();

rl.on("line", (line) => {
  queue = queue.then(async () => {
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
    const response = await host.handle(request);
    process.stdout.write(JSON.stringify(response) + "\n");
  });
});
