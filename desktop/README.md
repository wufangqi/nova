# Nova desktop (Tauri)

WUF-81 — Windows-first Tauri shell with IPC thin-wrapping `IntentService`.

## Prerequisites (Windows)

- Node.js 20+
- Rust stable (`rustup`)
- WebView2 (bundled bootstrapper configured in `tauri.conf.json`)

Linux/macOS are best-effort only (ADR-0004).

## Dev (Windows)

From the **nova repo root**:

```bash
npm install
npm run build
npm --prefix desktop install
npm run desktop:dev
```

Smoke in the window:

1. Click **Create Buffer**
2. Click **Accept Patch (world → nova)**
3. Confirm output shows Accept ok and Buffer text `hello nova`

IPC host: Node process running `dist/ipc/cli-host.js` (or `src/ipc/cli-host.ts` via tsx in dev). Override with `NOVA_IPC_HOST`.

## Commands

| Frontend `invoke`     | Host method       | IntentService              |
| --------------------- | ----------------- | -------------------------- |
| `create_buffer_cmd`   | `create_buffer`   | `createBuffer`             |
| `get_buffer_cmd`      | `get_buffer`      | `getBuffer`                |
| `accept_cmd`          | `accept`          | `accept` (sole write path) |
