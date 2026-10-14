/**
 * WUF-81/82/84/85 — Tauri IPC request/response shapes.
 * Thin facade over IntentService + EditorShell + FindBar; no alternate Accept path.
 */
import type {
  AcceptResult,
  BufferCreateOptions,
  BufferSnapshot,
  Intent,
  Patch,
  PreviewId,
  PreviewResult,
  RegexDraft,
  Selection,
  UndoGroupId,
  VisibleWindow,
} from "../types.js";
import type { CloseResult, TabInfo } from "../editor-shell.js";
import type {
  FindHit,
  PreviewReplaceResult,
  TextScope,
} from "../find-bar.js";
import type { PcreFlags } from "../pcre.js";

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
  | "find"
  | "preview_replace"
  | "replace_accept"
  | "apply_draft"
  | "get_draft";

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

/** Shared FindBar params — omit fields to use the loaded draft / active Buffer. */
export type FindBarParams = {
  bufferId?: string;
  pattern?: string;
  replacement?: string;
  flags?: PcreFlags;
  scope?: TextScope;
};

export type FindRequest = {
  method: "find";
  params: FindBarParams;
};

export type PreviewReplaceRequest = {
  method: "preview_replace";
  params: FindBarParams;
};

export type ReplaceAcceptRequest = {
  method: "replace_accept";
  params: FindBarParams;
};

export type ApplyDraftRequest = {
  method: "apply_draft";
  params: { draft: RegexDraft };
};

export type GetDraftRequest = {
  method: "get_draft";
  params: Record<string, never> | {};
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
  | FindRequest
  | PreviewReplaceRequest
  | ReplaceAcceptRequest
  | ApplyDraftRequest
  | GetDraftRequest;

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

export type FindIpcResult = {
  hits: FindHit[];
  count: number;
  buffer: BufferSnapshot;
  tabs: TabInfo[];
};

export type PreviewReplaceIpcResult = {
  preview: PreviewReplaceResult;
  buffer: BufferSnapshot;
  tabs: TabInfo[];
};

export type ReplaceAcceptIpcResult = {
  accept: AcceptResult;
  buffer: BufferSnapshot;
  tabs: TabInfo[];
};

export type ApplyDraftIpcResult = {
  draft: RegexDraft;
  buffer: BufferSnapshot;
  tabs: TabInfo[];
};

export type GetDraftIpcResult = {
  draft: RegexDraft;
};
