/**
 * IntentIpcHost — deep IntentService + EditorShell + FindBar + ActionService
 * behind a small IPC interface.
 * All Accept writes go through IntentService.accept only (FindBar.replaceAccept included).
 * WUF-86: Explanation anchor resolve + ClipboardSuggestions (default off).
 * WUF-92: Action methods are pure forwards to ActionService (no host-owned semantics).
 * WUF-98/101: slice / line_window / buffer_len / buffer_rev / buffer_line_count;
 * snapshots omit text by default (shell methods included for virtual scroll).
 */
import type { BufferSnapshot } from "../types.js";
import {
  ActionService,
  MemoryActionStore,
  type ActionStore,
} from "../action-service.js";
import { EditorShell } from "../editor-shell.js";
import { FindBar } from "../find-bar.js";
import { IntentService } from "../intent-service.js";
import { ClipboardSuggestions } from "../suggestions.js";
import type { IntentServiceOptions } from "../types.js";
import type {
  AcceptIpcResult,
  AcceptRequest,
  ActivateTabRequest,
  ApplyDraftIpcResult,
  ApplyDraftRequest,
  BufferLenRequest,
  BufferLenResult,
  BufferLineCountRequest,
  BufferLineCountResult,
  BufferRevRequest,
  BufferRevResult,
  ConfirmCloseRequest,
  CreateBufferRequest,
  CreateBufferResult,
  DeleteActionIpcResult,
  DeleteActionRequest,
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
  GetSuggestionsEnabledRequest,
  IpcRequest,
  IpcResponse,
  LineWindowRequest,
  LineWindowResult,
  ListActionsIpcResult,
  ListActionsRequest,
  ListTabsRequest,
  OpenPathRequest,
  PreviewIntentRequest,
  PreviewIntentResult,
  PreviewReplaceIpcResult,
  PreviewReplaceRequest,
  PreviewRunIpcResult,
  PreviewRunRequest,
  RejectPreviewRequest,
  RejectPreviewResult,
  RenameActionIpcResult,
  RenameActionRequest,
  ReplaceAcceptIpcResult,
  ReplaceAcceptRequest,
  RequestCloseRequest,
  ResolveExplanationAnchorRequest,
  ResolveExplanationAnchorResult,
  SaveActiveAsRequest,
  SaveActiveRequest,
  SaveFromRegexDraftIpcResult,
  SaveFromRegexDraftRequest,
  SelectSuggestionRequest,
  SelectSuggestionResult,
  SetCloudEnabledRequest,
  SetCloudEnabledResult,
  SetSuggestionsEnabledRequest,
  ShellBufferResult,
  ShellCloseResult,
  ShellStateResult,
  ShellTabsResult,
  SliceRequest,
  SliceResult,
  SuggestionsEnabledResult,
  SuggestionsForPasteRequest,
  SuggestionsForPasteResult,
  UndoIpcResult,
  UndoRequest,
} from "./protocol.js";

/** Strip full text from snapshots unless the caller opted in. */
export function toIpcSnapshot(
  snap: BufferSnapshot,
  includeText = false,
): BufferSnapshot {
  if (includeText) return snap;
  return {
    id: snap.id,
    revision: snap.revision,
    encoding: snap.encoding,
    eol: snap.eol,
    bom: snap.bom,
  };
}

export interface IntentIpcHostOptions extends IntentServiceOptions {
  /** Injectable Action persistence (tests: MemoryActionStore / temp FileActionStore). */
  actionStore?: ActionStore;
  /** Override Action soft cap (tests). */
  actionSoftCap?: number;
}

export class IntentIpcHost {
  readonly service: IntentService;
  readonly shell: EditorShell;
  readonly findBar: FindBar;
  readonly suggestions: ClipboardSuggestions;
  readonly actions: ActionService;

  constructor(options: IntentIpcHostOptions = {}) {
    this.service = new IntentService(options);
    this.shell = new EditorShell(this.service);
    this.findBar = new FindBar(this.service);
    this.suggestions = new ClipboardSuggestions(this.service);
    this.actions = new ActionService(
      this.service,
      options.actionStore ?? new MemoryActionStore(),
      { softCap: options.actionSoftCap },
    );
  }

  handle(request: CreateBufferRequest): Promise<IpcResponse<CreateBufferResult>>;
  handle(request: GetBufferRequest): Promise<IpcResponse<GetBufferResult>>;
  handle(request: SliceRequest): Promise<IpcResponse<SliceResult>>;
  handle(request: LineWindowRequest): Promise<IpcResponse<LineWindowResult>>;
  handle(request: BufferLenRequest): Promise<IpcResponse<BufferLenResult>>;
  handle(request: BufferRevRequest): Promise<IpcResponse<BufferRevResult>>;
  handle(
    request: BufferLineCountRequest,
  ): Promise<IpcResponse<BufferLineCountResult>>;
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
  handle(
    request: ResolveExplanationAnchorRequest,
  ): Promise<IpcResponse<ResolveExplanationAnchorResult>>;
  handle(
    request: GetSuggestionsEnabledRequest,
  ): Promise<IpcResponse<SuggestionsEnabledResult>>;
  handle(
    request: SetSuggestionsEnabledRequest,
  ): Promise<IpcResponse<SuggestionsEnabledResult>>;
  handle(
    request: SuggestionsForPasteRequest,
  ): Promise<IpcResponse<SuggestionsForPasteResult>>;
  handle(
    request: SelectSuggestionRequest,
  ): Promise<IpcResponse<SelectSuggestionResult>>;
  handle(request: FindRequest): Promise<IpcResponse<FindIpcResult>>;
  handle(request: PreviewReplaceRequest): Promise<IpcResponse<PreviewReplaceIpcResult>>;
  handle(request: ReplaceAcceptRequest): Promise<IpcResponse<ReplaceAcceptIpcResult>>;
  handle(request: ApplyDraftRequest): Promise<IpcResponse<ApplyDraftIpcResult>>;
  handle(request: GetDraftRequest): Promise<IpcResponse<GetDraftIpcResult>>;
  handle(
    request: SaveFromRegexDraftRequest,
  ): Promise<IpcResponse<SaveFromRegexDraftIpcResult>>;
  handle(request: ListActionsRequest): Promise<IpcResponse<ListActionsIpcResult>>;
  handle(
    request: RenameActionRequest,
  ): Promise<IpcResponse<RenameActionIpcResult>>;
  handle(
    request: DeleteActionRequest,
  ): Promise<IpcResponse<DeleteActionIpcResult>>;
  handle(request: PreviewRunRequest): Promise<IpcResponse<PreviewRunIpcResult>>;
  handle(request: IpcRequest): Promise<IpcResponse<unknown>>;
  async handle(request: IpcRequest): Promise<IpcResponse<unknown>> {
    try {
      switch (request.method) {
        case "create_buffer": {
          const { text = "", includeText = false, ...options } = request.params;
          const snap = this.service.createBuffer(text, options);
          return {
            ok: true,
            result: toIpcSnapshot(snap, includeText),
          };
        }
        case "get_buffer":
          return {
            ok: true,
            result: toIpcSnapshot(
              this.service.getBuffer(request.params.id),
              request.params.includeText === true,
            ),
          };
        case "slice":
          return {
            ok: true,
            result: {
              text: this.service.slice(
                request.params.id,
                request.params.start,
                request.params.end,
              ),
            } satisfies SliceResult,
          };
        case "line_window":
          return {
            ok: true,
            result: this.service.lineWindow(
              request.params.id,
              request.params.lineStart,
              request.params.lineCount,
            ) satisfies LineWindowResult,
          };
        case "buffer_len":
          return {
            ok: true,
            result: {
              len: this.service.len(request.params.id),
            } satisfies BufferLenResult,
          };
        case "buffer_rev":
          return {
            ok: true,
            result: {
              rev: this.service.rev(request.params.id),
            } satisfies BufferRevResult,
          };
        case "buffer_line_count":
          return {
            ok: true,
            result: {
              lineCount: this.service.lineCount(request.params.id),
            } satisfies BufferLineCountResult,
          };
        case "accept": {
          const accept = this.service.accept(request.params.patches);
          const ids = [
            ...new Set(request.params.patches.map((p) => p.bufferId)),
          ];
          const buffers = ids.map((id) =>
            toIpcSnapshot(this.service.getBuffer(id), false),
          );
          return { ok: true, result: { accept, buffers } satisfies AcceptIpcResult };
        }
        case "evoke": {
          const buffer = this.shell.evokeNewUntitled();
          return {
            ok: true,
            result: {
              buffer: toIpcSnapshot(buffer, false),
              tabs: this.shell.listTabs(),
            } satisfies ShellBufferResult,
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
              buffer: toIpcSnapshot(this.shell.getActiveBuffer(), false),
              tabs: this.shell.listTabs(),
            } satisfies ShellBufferResult,
          };
        }
        case "edit_active": {
          const params = request.params;
          const isSpan =
            typeof params.start === "number" &&
            typeof params.end === "number" &&
            typeof params.replacement === "string";
          if (!isSpan && typeof params.text !== "string") {
            return {
              ok: false,
              error: "edit_active requires text or start/end/replacement",
            };
          }
          const buffer = isSpan
            ? this.shell.editActiveRange(
                params.start!,
                params.end!,
                params.replacement!,
              )
            : this.shell.editActive(params.text!);
          return {
            ok: true,
            result: {
              buffer: toIpcSnapshot(buffer, false),
              tabs: this.shell.listTabs(),
            } satisfies ShellBufferResult,
          };
        }
        case "open_path": {
          const buffer = await this.shell.openPath(request.params.path);
          return {
            ok: true,
            result: {
              buffer: toIpcSnapshot(buffer, false),
              tabs: this.shell.listTabs(),
            } satisfies ShellBufferResult,
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
              buffer: id
                ? toIpcSnapshot(this.service.getBuffer(id), false)
                : null,
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
          return {
            ok: true,
            result: {
              buffer: toIpcSnapshot(this.shell.getActiveBuffer(), false),
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
        case "resolve_explanation_anchor": {
          const bufferId =
            request.params.bufferId ?? this.shell.activeBufferId;
          if (!bufferId) {
            return {
              ok: false,
              error: "no active Buffer for Explanation anchor resolve",
            };
          }
          const resolve = this.service.resolveExplanationAnchor(
            bufferId,
            request.params.anchor,
          );
          return {
            ok: true,
            result: {
              resolve,
              buffer: this.service.getBuffer(bufferId),
              tabs: this.shell.listTabs(),
            } satisfies ResolveExplanationAnchorResult,
          };
        }
        case "get_suggestions_enabled":
          return {
            ok: true,
            result: {
              enabled: this.suggestions.isEnabled(),
            } satisfies SuggestionsEnabledResult,
          };
        case "set_suggestions_enabled": {
          this.suggestions.setEnabled(request.params.enabled);
          return {
            ok: true,
            result: {
              enabled: this.suggestions.isEnabled(),
            } satisfies SuggestionsEnabledResult,
          };
        }
        case "suggestions_for_paste":
          return {
            ok: true,
            result: {
              suggestions: this.suggestions.suggestionsForPaste(
                request.params.clipboardText,
              ),
            } satisfies SuggestionsForPasteResult,
          };
        case "select_suggestion": {
          const bufferId =
            request.params.bufferId ?? this.shell.activeBufferId;
          if (!bufferId) {
            return {
              ok: false,
              error: "no active Buffer for Suggestion select",
            };
          }
          const preview = this.suggestions.select(
            request.params.suggestion,
            bufferId,
            request.params.selection,
          );
          return {
            ok: true,
            result: {
              preview,
              buffer: this.service.getBuffer(bufferId),
              tabs: this.shell.listTabs(),
              utterance: request.params.suggestion.utterance,
            } satisfies SelectSuggestionResult,
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
        case "save_from_regex_draft":
          return {
            ok: true,
            result: this.actions.saveFromRegexDraft({
              previewId: request.params.previewId,
              displayName: request.params.displayName,
            }) satisfies SaveFromRegexDraftIpcResult,
          };
        case "list_actions":
          return {
            ok: true,
            result: {
              actions: this.actions.list(),
            } satisfies ListActionsIpcResult,
          };
        case "rename_action":
          return {
            ok: true,
            result: this.actions.rename(
              request.params.id,
              request.params.displayName,
            ) satisfies RenameActionIpcResult,
          };
        case "delete_action":
          return {
            ok: true,
            result: this.actions.delete(
              request.params.id,
            ) satisfies DeleteActionIpcResult,
          };
        case "preview_run": {
          const bufferId =
            request.params.bufferId ?? this.shell.activeBufferId;
          if (!bufferId) {
            return { ok: false, error: "no active Buffer for Action preview_run" };
          }
          const run = this.actions.previewRun({
            actionId: request.params.actionId,
            bufferId,
            selection: request.params.selection,
          });
          return {
            ok: true,
            result: {
              run,
              buffer: this.service.getBuffer(bufferId),
              tabs: this.shell.listTabs(),
            } satisfies PreviewRunIpcResult,
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

  private resolveFindBufferId(params: FindBarParams): string | null {
    return params.bufferId ?? this.shell.activeBufferId;
  }
}
