/**
 * Copy built `dist/` into Tauri resources so Windows installers ship the IPC host.
 * Run after `npm run build` at repo root, before `tauri build`.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const dest = join(root, "desktop/src-tauri/resources/nova-dist");
const binDir = join(root, "desktop/src-tauri/resources/bin");

if (!existsSync(dist)) {
  console.error("dist/ missing — run `npm run build` at the nova repo root first.");
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
mkdirSync(binDir, { recursive: true });
cpSync(dist, dest, { recursive: true });
writeFileSync(
  join(dest, "package.json"),
  `${JSON.stringify({ type: "module", name: "nova-ipc-host", private: true }, null, 2)}\n`,
);

console.log(`prepared Tauri resources: ${dest}`);
if (existsSync(join(binDir, "node.exe"))) {
  console.log("bundled Windows node.exe present under resources/bin/");
} else if (existsSync(join(binDir, "node"))) {
  console.log("bundled node present under resources/bin/");
} else {
  console.log(
    "note: no bundled node in resources/bin/ (dev uses PATH; CI Release adds node.exe)",
  );
}
