export {
  createUntitled,
  openPath as openBufferCorePath,
  save as saveBufferCore,
  len as bufferCoreLen,
  rev as bufferCoreRev,
  lineCount as bufferCoreLineCount,
  slice as bufferCoreSlice,
  lineWindow as bufferCoreLineWindow,
  replaceRange as bufferCoreReplaceRange,
  dropBuffer,
} from "./buffer-core.js";
export type { LineWindow } from "./buffer-core.js";
export { IntentService } from "./intent-service.js";
export {
  ActionService,
  MemoryActionStore,
  FileActionStore,
  ACTION_SOFT_CAP,
} from "./action-service.js";
export type { ActionStore, ActionServiceOptions } from "./action-service.js";
export { IntentIpcHost } from "./ipc/host.js";
export type {
  IpcMethod,
  IpcRequest,
  IpcResponse,
  AcceptIpcResult,
} from "./ipc/protocol.js";
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
export {
  GLOBAL_HOTKEY_ACCELERATOR,
  HOTKEY_EVOKE_EVENT,
  onGlobalHotkeyPressed,
} from "./global-hotkey.js";
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
export { runActionStageDemo } from "./action-stage-demo.js";
export type {
  ActionStageDemoOptions,
  ActionStageDemoResult,
} from "./action-stage-demo.js";
export { runVisualTenSecondDemo } from "./visual-ten-second-demo.js";
export type {
  VisualTenSecondDemoOptions,
  VisualTenSecondDemoResult,
} from "./visual-ten-second-demo.js";
export {
  runWindowsGates,
  ensure100MbFixture,
  assertPackagedNativeLayout,
  evaluateTyping100MbGate,
  evaluateScroll100MbGate,
  LARGE_FILE_CHARS,
  FIXTURE_100MB_BYTES,
  COLD_START_MAX_MS,
  HOTKEY_EVOKE_MAX_MS,
  LARGE_FILE_MAX_MS,
  OPEN_100MB_EDITABLE_MAX_MS,
  TYPING_100MB_MAX_MS,
  SCROLL_100MB_MAX_MS,
} from "./windows-gates.js";
export type {
  GateResult,
  GateName,
  WindowsGatesReport,
} from "./windows-gates.js";
export {
  resolveNativeAddonPath,
  nativeAddonSearchDirs,
} from "./buffer-core.js";
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
