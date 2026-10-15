/**
 * Stdio JSON-lines IntentService host for the Tauri desktop sidecar.
 * One request JSON per line → one response JSON per line.
 * Requests are serialized so async Path IO cannot interleave responses.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";
import { FileActionStore } from "../action-service.js";
import { IntentIpcHost } from "./host.js";
import type { IpcRequest } from "./protocol.js";

function resolveActionStoreDir(): string {
  if (process.env.NOVA_ACTION_STORE_DIR) {
    return process.env.NOVA_ACTION_STORE_DIR;
  }
  return join(homedir(), ".nova", "actions");
}

const host = new IntentIpcHost({
  cloudEnabled: process.env.NOVA_CLOUD_ENABLED === "1",
  actionStore: new FileActionStore(resolveActionStoreDir()),
});
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
