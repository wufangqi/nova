/**
 * WUF-81/82 — Tauri IPC request/response shapes.
 * Thin facade over IntentService + EditorShell; no alternate Accept path.
 */
import type {
  AcceptResult,
  BufferCreateOptions,
  BufferSnapshot,
  Patch,
} from "../types.js";
import type { CloseResult, TabInfo } from "../editor-shell.js";

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
  | "get_shell_state";

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
  | GetShellStateRequest;

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
