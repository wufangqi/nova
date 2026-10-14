export { IntentService } from "./intent-service.js";
export {
  buildExplanation,
  isExplainUtterance,
  resolveAnchor,
} from "./explanation.js";
export {
  buildRegexDraft,
  isRegexDraftUtterance,
  flagsFromDraft,
  draftFlagsString,
} from "./regex-draft.js";
export {
  LocalModelGateway,
  validateModelPatchOutput,
} from "./model-gateway.js";
export type {
  ModelGateway,
  ModelTransformRequest,
  ModelTransformRaw,
  ValidateResult,
} from "./model-gateway.js";
export { EditorShell } from "./editor-shell.js";
export { FindBar } from "./find-bar.js";
export { MojibakeRepair } from "./mojibake-repair.js";
export {
  ClipboardSuggestions,
  MAX_SUGGESTIONS,
} from "./suggestions.js";
export type { Suggestion } from "./suggestions.js";
export { runTenSecondDemo } from "./ten-second-demo.js";
export type {
  TenSecondDemoOptions,
  TenSecondDemoResult,
} from "./ten-second-demo.js";
export {
  runWindowsGates,
  LARGE_FILE_CHARS,
  COLD_START_MAX_MS,
  HOTKEY_EVOKE_MAX_MS,
  LARGE_FILE_MAX_MS,
} from "./windows-gates.js";
export type { GateResult, WindowsGatesReport } from "./windows-gates.js";
export {
  decodeBytes,
  encodeText,
  detectBom,
  detectEol,
  reinterpretText,
  applyEol,
  toLogicalNewlines,
} from "./encoding.js";
export type { EncodingLabel, DecodedFile, EncodeOptions } from "./encoding.js";
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
export type {
  MojibakePreviewInput,
  MojibakeProposal,
} from "./mojibake-repair.js";
export { compilePcre, expandReplacement, PcreCompileError } from "./pcre.js";
export type { PcreFlags } from "./pcre.js";
export type * from "./types.js";
