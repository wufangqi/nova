/**
 * WUF-81 — Tauri IPC request/response shapes.
 * Thin facade over IntentService; no alternate Accept path.
 */
import type {
  AcceptResult,
  BufferCreateOptions,
  BufferSnapshot,
  Patch,
} from "../types.js";

export type IpcMethod = "create_buffer" | "get_buffer" | "accept";

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

export type IpcRequest = CreateBufferRequest | GetBufferRequest | AcceptRequest;

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
