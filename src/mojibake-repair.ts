import { IntentService } from "./intent-service.js";
import { reinterpretText } from "./encoding.js";
import type {
  AcceptResult,
  BufferId,
  Patch,
} from "./types.js";

export interface MojibakePreviewInput {
  bufferId: BufferId;
  /** Encoding to re-decode the recovered bytes as (the "true" Encoding). */
  assumedEncoding: string;
  /**
   * Encoding that produced the current mojibake Unicode.
   * Defaults to the Buffer's current Encoding metadata.
   */
  fromEncoding?: string;
}

export interface MojibakeProposal {
  patches: Patch[];
  proposedEncoding: string;
  proposedBom: boolean;
  repairedText: string;
}

/**
 * Deterministic mojibake repair: Encoding reinterpretation + text Patch.
 * Writes only through IntentService.accept (with explicit metadata).
 */
export class MojibakeRepair {
  constructor(private readonly intent: IntentService) {}

  preview(input: MojibakePreviewInput): MojibakeProposal {
    const buf = this.intent.getBuffer(input.bufferId);
    const len = this.intent.len(input.bufferId);
    // Repair rewrites the whole Buffer — pull via slice, not a default snapshot.
    const currentText = this.intent.slice(input.bufferId, 0, len);
    const fromEncoding = input.fromEncoding ?? buf.encoding;
    const repairedText = reinterpretText(
      currentText,
      fromEncoding,
      input.assumedEncoding,
    );

    const patch: Patch = {
      bufferId: buf.id,
      baseRevision: buf.revision,
      edits: [
        {
          start: 0,
          end: len,
          replacement: repairedText,
          before: "",
          after: "",
        },
      ],
      provenance: { source: "encoding", label: "mojibake-repair" },
      // Explicit Encoding only — BOM/EOL stay unless a later Patch asks.
      metadata: { encoding: input.assumedEncoding },
    };

    return {
      patches: [patch],
      proposedEncoding: input.assumedEncoding,
      proposedBom: buf.bom,
      repairedText,
    };
  }

  /** preview then Accept — text + Encoding become consistent in one UndoGroup. */
  previewAccept(input: MojibakePreviewInput): AcceptResult {
    const proposal = this.preview(input);
    return this.intent.accept(proposal.patches);
  }
}
