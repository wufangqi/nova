/**
 * IntentIpcHost — deep IntentService + EditorShell behind a small IPC interface.
 * All Accept writes go through IntentService.accept only.
 */
import { EditorShell } from "../editor-shell.js";
import { IntentService } from "../intent-service.js";
import type { IntentServiceOptions } from "../types.js";
import type {
  AcceptIpcResult,
  AcceptRequest,
  ActivateTabRequest,
  ConfirmCloseRequest,
  CreateBufferRequest,
  CreateBufferResult,
  EditActiveRequest,
  EvokeRequest,
  GetBufferRequest,
  GetBufferResult,
  GetShellStateRequest,
  IpcRequest,
  IpcResponse,
  ListTabsRequest,
  OpenPathRequest,
  RequestCloseRequest,
  SaveActiveAsRequest,
  SaveActiveRequest,
  ShellBufferResult,
  ShellCloseResult,
  ShellStateResult,
  ShellTabsResult,
} from "./protocol.js";

export class IntentIpcHost {
  readonly service: IntentService;
  readonly shell: EditorShell;

  constructor(options: IntentServiceOptions = {}) {
    this.service = new IntentService(options);
    this.shell = new EditorShell(this.service);
  }

  handle(request: CreateBufferRequest): Promise<IpcResponse<CreateBufferResult>>;
  handle(request: GetBufferRequest): Promise<IpcResponse<GetBufferResult>>;
  handle(request: AcceptRequest): Promise<IpcResponse<AcceptIpcResult>>;
  handle(request: EvokeRequest): Promise<IpcResponse<ShellBufferResult>>;
  handle(request: ListTabsRequest): Promise<IpcResponse<ShellTabsResult>>;
  handle(request: ActivateTabRequest): Promise<IpcResponse<ShellBufferResult>>;
  handle(request: EditActiveRequest): Promise<IpcResponse<ShellBufferResult>>;
  handle(request: OpenPathRequest): Promise<IpcResponse<ShellBufferResult>>;
  handle(request: SaveActiveRequest): Promise<IpcResponse<ShellTabsResult>>;
  handle(request: SaveActiveAsRequest): Promise<IpcResponse<ShellTabsResult>>;
  handle(request: RequestCloseRequest): Promise<IpcResponse<ShellCloseResult>>;
  handle(request: ConfirmCloseRequest): Promise<IpcResponse<ShellCloseResult>>;
  handle(request: GetShellStateRequest): Promise<IpcResponse<ShellStateResult>>;
  handle(request: IpcRequest): Promise<IpcResponse<unknown>>;
  async handle(request: IpcRequest): Promise<IpcResponse<unknown>> {
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
        case "evoke": {
          const buffer = this.shell.evokeNewUntitled();
          return {
            ok: true,
            result: { buffer, tabs: this.shell.listTabs() } satisfies ShellBufferResult,
          };
        }
        case "list_tabs":
          return {
            ok: true,
            result: { tabs: this.shell.listTabs() } satisfies ShellTabsResult,
          };
        case "activate_tab": {
          this.shell.activateTab(request.params.id);
          return {
            ok: true,
            result: {
              buffer: this.shell.getActiveBuffer(),
              tabs: this.shell.listTabs(),
            } satisfies ShellBufferResult,
          };
        }
        case "edit_active": {
          const buffer = this.shell.editActive(request.params.text);
          return {
            ok: true,
            result: { buffer, tabs: this.shell.listTabs() } satisfies ShellBufferResult,
          };
        }
        case "open_path": {
          const buffer = await this.shell.openPath(request.params.path);
          return {
            ok: true,
            result: { buffer, tabs: this.shell.listTabs() } satisfies ShellBufferResult,
          };
        }
        case "save_active": {
          await this.shell.saveActive();
          return {
            ok: true,
            result: { tabs: this.shell.listTabs() } satisfies ShellTabsResult,
          };
        }
        case "save_active_as": {
          await this.shell.saveActiveAs(request.params.path);
          return {
            ok: true,
            result: { tabs: this.shell.listTabs() } satisfies ShellTabsResult,
          };
        }
        case "request_close": {
          const close = this.shell.requestClose(request.params.id);
          return {
            ok: true,
            result: { close, tabs: this.shell.listTabs() } satisfies ShellCloseResult,
          };
        }
        case "confirm_close": {
          const close = this.shell.confirmClose(request.params.id);
          return {
            ok: true,
            result: { close, tabs: this.shell.listTabs() } satisfies ShellCloseResult,
          };
        }
        case "get_shell_state": {
          const id = this.shell.activeBufferId;
          return {
            ok: true,
            result: {
              buffer: id ? this.service.getBuffer(id) : null,
              tabs: this.shell.listTabs(),
            } satisfies ShellStateResult,
          };
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
