/**
 * IntentIpcHost — deep IntentService + EditorShell + FindBar behind a small IPC interface.
 * All Accept writes go through IntentService.accept only (FindBar.replaceAccept included).
 */
import { EditorShell } from "../editor-shell.js";
import { FindBar } from "../find-bar.js";
import { IntentService } from "../intent-service.js";
import type { IntentServiceOptions } from "../types.js";
import type {
  AcceptIpcResult,
  AcceptRequest,
  ActivateTabRequest,
  ApplyDraftIpcResult,
  ApplyDraftRequest,
  ConfirmCloseRequest,
  CreateBufferRequest,
  CreateBufferResult,
  EditActiveRequest,
  EvokeRequest,
  FindBarParams,
  FindIpcResult,
  FindRequest,
  GetBufferRequest,
  GetBufferResult,
  GetDraftIpcResult,
  GetDraftRequest,
  GetShellStateRequest,
  IpcRequest,
  IpcResponse,
  ListTabsRequest,
  OpenPathRequest,
  PreviewIntentRequest,
  PreviewIntentResult,
  PreviewReplaceIpcResult,
  PreviewReplaceRequest,
  RejectPreviewRequest,
  RejectPreviewResult,
  ReplaceAcceptIpcResult,
  ReplaceAcceptRequest,
  RequestCloseRequest,
  SaveActiveAsRequest,
  SaveActiveRequest,
  SetCloudEnabledRequest,
  SetCloudEnabledResult,
  ShellBufferResult,
  ShellCloseResult,
  ShellStateResult,
  ShellTabsResult,
  UndoIpcResult,
  UndoRequest,
} from "./protocol.js";

export class IntentIpcHost {
  readonly service: IntentService;
  readonly shell: EditorShell;
  readonly findBar: FindBar;

  constructor(options: IntentServiceOptions = {}) {
    this.service = new IntentService(options);
    this.shell = new EditorShell(this.service);
    this.findBar = new FindBar(this.service);
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
  handle(request: PreviewIntentRequest): Promise<IpcResponse<PreviewIntentResult>>;
  handle(request: RejectPreviewRequest): Promise<IpcResponse<RejectPreviewResult>>;
  handle(request: UndoRequest): Promise<IpcResponse<UndoIpcResult>>;
  handle(request: SetCloudEnabledRequest): Promise<IpcResponse<SetCloudEnabledResult>>;
  handle(request: FindRequest): Promise<IpcResponse<FindIpcResult>>;
  handle(request: PreviewReplaceRequest): Promise<IpcResponse<PreviewReplaceIpcResult>>;
  handle(request: ReplaceAcceptRequest): Promise<IpcResponse<ReplaceAcceptIpcResult>>;
  handle(request: ApplyDraftRequest): Promise<IpcResponse<ApplyDraftIpcResult>>;
  handle(request: GetDraftRequest): Promise<IpcResponse<GetDraftIpcResult>>;
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
        case "preview_intent": {
          const bufferId =
            request.params.bufferId ?? this.shell.activeBufferId;
          if (!bufferId) {
            return { ok: false, error: "no active Buffer for Intent preview" };
          }
          const intent = this.service.parse({
            bufferId,
            utterance: request.params.utterance,
            selection: request.params.selection,
            visibleWindow: request.params.visibleWindow,
          });
          const preview = this.service.preview(intent);
          return {
            ok: true,
            result: {
              intent,
              preview,
              buffer: this.service.getBuffer(bufferId),
              tabs: this.shell.listTabs(),
            } satisfies PreviewIntentResult,
          };
        }
        case "reject_preview": {
          this.service.reject(request.params.previewId);
          return {
            ok: true,
            result: { rejected: true } satisfies RejectPreviewResult,
          };
        }
        case "undo": {
          this.service.undo(request.params.undoGroupId);
          const buffer = this.shell.getActiveBuffer();
          return {
            ok: true,
            result: {
              buffer,
              tabs: this.shell.listTabs(),
            } satisfies UndoIpcResult,
          };
        }
        case "set_cloud_enabled": {
          this.service.setCloudEnabled(request.params.enabled);
          return {
            ok: true,
            result: {
              cloudEnabled: this.service.getCloudEnabled(),
            } satisfies SetCloudEnabledResult,
          };
        }
        case "find": {
          const bufferId = this.resolveFindBufferId(request.params);
          if (!bufferId) {
            return { ok: false, error: "no active Buffer for FindBar" };
          }
          const found = this.findBar.find({
            bufferId,
            pattern: request.params.pattern,
            flags: request.params.flags,
            scope: request.params.scope,
          });
          return {
            ok: true,
            result: {
              hits: found.hits,
              count: found.count,
              buffer: this.service.getBuffer(bufferId),
              tabs: this.shell.listTabs(),
            } satisfies FindIpcResult,
          };
        }
        case "preview_replace": {
          const bufferId = this.resolveFindBufferId(request.params);
          if (!bufferId) {
            return { ok: false, error: "no active Buffer for FindBar replace" };
          }
          const preview = this.findBar.previewReplace({
            bufferId,
            pattern: request.params.pattern,
            replacement: request.params.replacement,
            flags: request.params.flags,
            scope: request.params.scope,
          });
          return {
            ok: true,
            result: {
              preview,
              buffer: this.service.getBuffer(bufferId),
              tabs: this.shell.listTabs(),
            } satisfies PreviewReplaceIpcResult,
          };
        }
        case "replace_accept": {
          const bufferId = this.resolveFindBufferId(request.params);
          if (!bufferId) {
            return { ok: false, error: "no active Buffer for FindBar replace" };
          }
          const accept = this.findBar.replaceAccept({
            bufferId,
            pattern: request.params.pattern,
            replacement: request.params.replacement,
            flags: request.params.flags,
            scope: request.params.scope,
          });
          return {
            ok: true,
            result: {
              accept,
              buffer: this.service.getBuffer(bufferId),
              tabs: this.shell.listTabs(),
            } satisfies ReplaceAcceptIpcResult,
          };
        }
        case "apply_draft": {
          const id = this.shell.activeBufferId;
          if (!id) {
            return { ok: false, error: "no active Buffer for FindBar draft" };
          }
          this.findBar.applyDraft(request.params.draft);
          return {
            ok: true,
            result: {
              draft: this.findBar.getDraft(),
              buffer: this.service.getBuffer(id),
              tabs: this.shell.listTabs(),
            } satisfies ApplyDraftIpcResult,
          };
        }
        case "get_draft":
          return {
            ok: true,
            result: { draft: this.findBar.getDraft() } satisfies GetDraftIpcResult,
          };
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

  private resolveFindBufferId(params: FindBarParams): string | null {
    return params.bufferId ?? this.shell.activeBufferId;
  }
}
