# nova

Lightweight AI notepad core (internal).

## Seams

- **WUF-70** — `IntentService` Accept / UndoGroup / Provenance
- **WUF-71** — `EditorShell` evoke / tabs / Path open·save / close prompts
- **WUF-72** — `FindBar` PCRE find / replace-over-Scope → Accept
- **WUF-79** — ten-second Demo (`runTenSecondDemo`) + Windows floors (`runWindowsGates`)
- **WUF-81** — Tauri desktop IPC facade (`IntentIpcHost` / `desktop/`) thin-wrapping IntentService
- **WUF-83** — OS global hotkey (`Ctrl+Alt+N`) → evoke untitled Buffer (tabs kept)

## Offline editor ≠ offline AI (ADR-0003)

| Path | Requirement |
| --- | --- |
| **Offline editor** | Open / edit / FindBar / encoding work with **no** local model and **no** network. |
| **Offline AI / ten-second Demo** | Needs a **preinstalled local model** on the Demo/eval machine (`LocalModelGateway`). Missing model → AI preview fails with install guidance; editor stays usable. |
| **Default installer** | Need **not** ship a large local model. Bundling a huge model is not a product requirement for M2 exit. |

## Scripts

```bash
npm install
npm test
npm run build
npm run notepad            # manual: evoke → paste → save
npm run demo:ten-second    # M2: hotkey → paste → Intent → preview → Accept
npm run gates:windows      # cold start / hotkey / large-file floors (Windows gate target)
npm run desktop:dev        # Tauri window + IPC (Windows verification target)
```

## Desktop (WUF-81)

See `desktop/README.md`. Default develop/verify OS: **Windows**. Tauri commands spawn a Node Intent IPC host so Accept stays on `IntentService.accept` — no alternate write path.
