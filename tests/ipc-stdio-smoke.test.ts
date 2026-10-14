/**
 * WUF-81: stdio JSON-lines host used by the Tauri sidecar bridge.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hostTs = path.join(root, "src/ipc/cli-host.ts");

function ask(request: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", hostTs], {
      cwd: root,
      stdio: ["pipe", "pipe", "inherit"],
      shell: process.platform === "win32",
    });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
      if (out.includes("\n")) {
        child.kill();
        try {
          resolve(JSON.parse(out.trim().split("\n")[0]!));
        } catch (err) {
          reject(err);
        }
      }
    });
    child.on("error", reject);
    child.stdin.write(JSON.stringify(request) + "\n");
    child.stdin.end();
  });
}

describe("IPC stdio host smoke", () => {
  it("create_buffer then accept over stdio", async () => {
    const created = (await ask({
      method: "create_buffer",
      params: { text: "hello world" },
    })) as { ok: true; result: { id: string; revision: number; text: string } };
    assert.equal(created.ok, true);
    assert.equal(created.result.text, "hello world");

    // Second request needs a long-lived process — use IntentIpcHost unit tests
    // for multi-call; this smoke only proves the stdio entrypoint answers.
    assert.equal(typeof created.result.id, "string");
  });
});
