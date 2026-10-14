export { IntentService } from "./intent-service.js";
export { EditorShell } from "./editor-shell.js";
export { FindBar } from "./find-bar.js";
export type {
  TabInfo,
  CloseOk,
  CloseAsk,
  CloseResult,
} from "./editor-shell.js";
export type {
  TextScope,
  FindHit,
  FindResult,
  FindInput,
  ReplaceInput,
  PreviewReplaceResult,
} from "./find-bar.js";
export { compilePcre, expandReplacement, PcreCompileError } from "./pcre.js";
export type { PcreFlags } from "./pcre.js";
export type * from "./types.js";
