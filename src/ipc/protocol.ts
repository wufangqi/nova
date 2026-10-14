/**
 * WUF-81/82/84 — Tauri IPC request/response shapes.
 * Thin facade over IntentService + EditorShell; no alternate Accept path.
 */
import type {
  AcceptResult,
  AnchorResolveResult,
  BufferCreateOptions,
  BufferSnapshot,
  ExplanationAnchor,
  Intent,
  Patch,
  PreviewId,
  PreviewResult,
  Selection,
  UndoGroupId,
  VisibleWindow,
} from "../types.js";
import type { CloseResult, TabInfo } from "../editor-shell.js";
import type { Suggestion } from "../suggestions.js";

export type IpcMethod =
  | "create_buffer"
  | "get_buffer"
  | "accept"
  | "evoke"
  | "list_tabs"
  | "activate_tab"
  | "edit_active"
  | "open_path"
  | "save_active"
  | "save_active_as"
  | "request_close"
  | "confirm_close"
  | "get_shell_state"
  | "preview_intent"
  | "reject_preview"
  | "undo"
  | "set_cloud_enabled"
  | "resolve_explanation_anchor"
  | "get_suggestions_enabled"
  | "set_suggestions_enabled"
  | "suggestions_for_paste"
  | "select_suggestion";

export type CreateBufferRequest = {
  method: "create_buffer";
  params: { text?: string } & BufferCreateOptions;
};

export type GetBufferRequest = {
  method: "get_buffer";
  params: { id: string };
};

export type AcceptRequest = {
  method: "accept";
  params: { patches: Patch[] };
};

export type EvokeRequest = {
  method: "evoke";
  params: Record<string, never> | {};
};

export type ListTabsRequest = {
  method: "list_tabs";
  params: Record<string, never> | {};
};

export type ActivateTabRequest = {
  method: "activate_tab";
  params: { id: string };
};

export type EditActiveRequest = {
  method: "edit_active";
  params: { text: string };
};

export type OpenPathRequest = {
  method: "open_path";
  params: { path: string };
};

export type SaveActiveRequest = {
  method: "save_active";
  params: Record<string, never> | {};
};

export type SaveActiveAsRequest = {
  method: "save_active_as";
  params: { path: string };
};

export type RequestCloseRequest = {
  method: "request_close";
  params: { id: string };
};

export type ConfirmCloseRequest = {
  method: "confirm_close";
  params: { id: string };
};

export type GetShellStateRequest = {
  method: "get_shell_state";
  params: Record<string, never> | {};
};

export type PreviewIntentRequest = {
  method: "preview_intent";
  params: {
    utterance: string;
    /** Defaults to the shell's active Buffer. */
    bufferId?: string;
    selection?: Selection;
    visibleWindow?: VisibleWindow;
  };
};

export type RejectPreviewRequest = {
  method: "reject_preview";
  params: { previewId: PreviewId };
};

export type UndoRequest = {
  method: "undo";
  params: { undoGroupId: UndoGroupId };
};

export type SetCloudEnabledRequest = {
  method: "set_cloud_enabled";
  params: { enabled: boolean };
};

export type ResolveExplanationAnchorRequest = {
  method: "resolve_explanation_anchor";
  params: {
    anchor: ExplanationAnchor;
    /** Defaults to the shell's active Buffer. */
    bufferId?: string;
  };
};

export type GetSuggestionsEnabledRequest = {
  method: "get_suggestions_enabled";
  params: Record<string, never> | {};
};

export type SetSuggestionsEnabledRequest = {
  method: "set_suggestions_enabled";
  params: { enabled: boolean };
};

export type SuggestionsForPasteRequest = {
  method: "suggestions_for_paste";
  params: { clipboardText: string };
};

export type SelectSuggestionRequest = {
  method: "select_suggestion";
  params: {
    suggestion: Suggestion;
    /** Defaults to the shell's active Buffer. */
    bufferId?: string;
    selection?: Selection;
  };
};

export type IpcRequest =
  | CreateBufferRequest
  | GetBufferRequest
  | AcceptRequest
  | EvokeRequest
  | ListTabsRequest
  | ActivateTabRequest
  | EditActiveRequest
  | OpenPathRequest
  | SaveActiveRequest
  | SaveActiveAsRequest
  | RequestCloseRequest
  | ConfirmCloseRequest
  | GetShellStateRequest
  | PreviewIntentRequest
  | RejectPreviewRequest
  | UndoRequest
  | SetCloudEnabledRequest
  | ResolveExplanationAnchorRequest
  | GetSuggestionsEnabledRequest
  | SetSuggestionsEnabledRequest
  | SuggestionsForPasteRequest
  | SelectSuggestionRequest;

export type IpcOk<T> = { ok: true; result: T };
export type IpcErr = { ok: false; error: string };
export type IpcResponse<T> = IpcOk<T> | IpcErr;

export type CreateBufferResult = BufferSnapshot;
export type GetBufferResult = BufferSnapshot;
export type AcceptIpcResult = {
  accept: AcceptResult;
  /** Buffer snapshots after Accept attempt (same ids as patches). */
  buffers: BufferSnapshot[];
};

export type ShellStateResult = {
  buffer: BufferSnapshot | null;
  tabs: TabInfo[];
};

export type ShellBufferResult = {
  buffer: BufferSnapshot;
  tabs: TabInfo[];
};

export type ShellTabsResult = {
  tabs: TabInfo[];
};

export type ShellCloseResult = {
  close: CloseResult;
  tabs: TabInfo[];
};

export type PreviewIntentResult = {
  intent: Intent;
  preview: PreviewResult;
  buffer: BufferSnapshot;
  tabs: TabInfo[];
};

export type RejectPreviewResult = {
  rejected: true;
};

export type UndoIpcResult = {
  buffer: BufferSnapshot;
  tabs: TabInfo[];
};

export type SetCloudEnabledResult = {
  cloudEnabled: boolean;
};

export type ResolveExplanationAnchorResult = {
  resolve: AnchorResolveResult;
  buffer: BufferSnapshot;
  tabs: TabInfo[];
};

export type SuggestionsEnabledResult = {
  enabled: boolean;
};

export type SuggestionsForPasteResult = {
  suggestions: Suggestion[];
};

export type SelectSuggestionResult = {
  preview: PreviewResult;
  buffer: BufferSnapshot;
  tabs: TabInfo[];
  /** Utterance that entered Intent/preview (from the Suggestion). */
  utterance: string;
};
