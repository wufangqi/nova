/**
 * IntentIpcHost — deep IntentService behind a small IPC interface.
 * All Accept writes go through IntentService.accept only.
 */
import { IntentService } from "../intent-service.js";
import type { IntentServiceOptions } from "../types.js";
import type {
  AcceptIpcResult,
  AcceptRequest,
  CreateBufferRequest,
  CreateBufferResult,
  GetBufferRequest,
  GetBufferResult,
  IpcRequest,
  IpcResponse,
} from "./protocol.js";

export class IntentIpcHost {
  readonly service: IntentService;

  constructor(options: IntentServiceOptions = {}) {
    this.service = new IntentService(options);
  }

  handle(request: CreateBufferRequest): IpcResponse<CreateBufferResult>;
  handle(request: GetBufferRequest): IpcResponse<GetBufferResult>;
  handle(request: AcceptRequest): IpcResponse<AcceptIpcResult>;
  handle(request: IpcRequest): IpcResponse<unknown>;
  handle(request: IpcRequest): IpcResponse<unknown> {
    try {
      switch (request.method) {
        case "create_buffer": {
          const { text = "", ...options } = request.params;
          return { ok: true, result: this.service.createBuffer(text, options) };
        }
        case "get_buffer":
          return {
            ok: true,
            result: this.service.getBuffer(request.params.id),
          };
        case "accept": {
          const accept = this.service.accept(request.params.patches);
          const ids = [
            ...new Set(request.params.patches.map((p) => p.bufferId)),
          ];
          const buffers = ids.map((id) => this.service.getBuffer(id));
          return { ok: true, result: { accept, buffers } satisfies AcceptIpcResult };
        }
        default: {
          const _exhaustive: never = request;
          return { ok: false, error: `unknown method: ${String(_exhaustive)}` };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }
}
