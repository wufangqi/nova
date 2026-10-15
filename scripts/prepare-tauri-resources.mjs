/**
 * Copy built `dist/` + native Buffer core into Tauri resources so Windows
 * installers ship the IPC host and the napi `.node` addon.
 * Run after `npm run build` at repo root, before `tauri build`.
 *
 * Layout (matches buffer-core resolve from nova-dist/):
 *   resources/nova-dist/          ← compiled JS IPC host
 *   resources/native/buffer-core/ ← *.node addon
 *   resources/bin/                ← optional portable node.exe (CI)
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const dest = join(root, "desktop/src-tauri/resources/nova-dist");
const binDir = join(root, "desktop/src-tauri/resources/bin");
const nativeSrc = join(root, "native/buffer-core");
const nativeDest = join(root, "desktop/src-tauri/resources/native/buffer-core");

if (!existsSync(dist)) {
  console.error("dist/ missing — run `npm run build` at the nova repo root first.");
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
rmSync(nativeDest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
mkdirSync(binDir, { recursive: true });
mkdirSync(nativeDest, { recursive: true });
cpSync(dist, dest, { recursive: true });
writeFileSync(
  join(dest, "package.json"),
  `${JSON.stringify({ type: "module", name: "nova-ipc-host", private: true }, null, 2)}\n`,
);

const addonFiles = existsSync(nativeSrc)
  ? readdirSync(nativeSrc).filter((name) => name.endsWith(".node"))
  : [];
if (addonFiles.length === 0) {
  console.error(
    "no *.node under native/buffer-core — run `npm run build:native` first.",
  );
  process.exit(1);
}
for (const name of addonFiles) {
  copyFileSync(join(nativeSrc, name), join(nativeDest, name));
}

console.log(`prepared Tauri resources: ${dest}`);
console.log(`prepared native core: ${nativeDest} (${addonFiles.join(", ")})`);
if (existsSync(join(binDir, "node.exe"))) {
  console.log("bundled Windows node.exe present under resources/bin/");
} else if (existsSync(join(binDir, "node"))) {
  console.log("bundled node present under resources/bin/");
} else {
  console.log(
    "note: no bundled node in resources/bin/ (dev uses PATH; CI Release adds node.exe)",
  );
}
