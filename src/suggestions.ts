import { randomUUID } from "node:crypto";
import type { IntentService } from "./intent-service.js";
import type {
  BufferId,
  PreviewResult,
  Selection,
} from "./types.js";

/** Hard cap — "at most a few" optional next steps on paste. */
export const MAX_SUGGESTIONS = 3;

export interface Suggestion {
  id: string;
  /** Short user-visible label. */
  label: string;
  /** Utterance fed into IntentService.parse / preview. */
  utterance: string;
}

/**
 * Clipboard Suggestions — opt-in paste hints (WUF-78).
 * Default off; selecting one starts Intent/preview and never mutates Buffer.
 */
export class ClipboardSuggestions {
  private enabled = false;
  private readonly intent: IntentService;

  constructor(intent: IntentService) {
    this.intent = intent;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Global switch. Default remains off until explicitly enabled. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** One-shot global silence (same as setEnabled(false)). */
  disable(): void {
    this.enabled = false;
  }

  /**
   * On paste: when enabled, return up to MAX_SUGGESTIONS optional next steps.
   * Does not insert clipboard text or otherwise mutate any Buffer.
   */
  suggestionsForPaste(clipboardText: string): Suggestion[] {
    if (!this.enabled) return [];
    return proposeSuggestions(clipboardText).slice(0, MAX_SUGGESTIONS);
  }

  /**
   * User chose a Suggestion → enter Intent/preview via IntentService.
   * Never writes the Buffer; Accept (or FindBar replace) remains the only write path.
   */
  select(
    suggestion: Suggestion,
    bufferId: BufferId,
    selection?: Selection,
  ): PreviewResult {
    const intent = this.intent.parse({
      bufferId,
      utterance: suggestion.utterance,
      selection,
    });
    return this.intent.preview(intent);
  }
}

/** Deterministic heuristics over pasted text → candidate Suggestions. */
function proposeSuggestions(text: string): Suggestion[] {
  const out: Suggestion[] = [];

  const looksLikeLog =
    /\b(ERROR|WARN|WARNING|FATAL|TRACE|DEBUG)\b/i.test(text) ||
    /^\d{4}-\d{2}-\d{2}[ T]/.test(text.trim());
  if (looksLikeLog) {
    out.push(
      suggestion("Filter error lines", "filter to error lines"),
    );
  }

  const messyWhitespace =
    /[ \t]{2,}/.test(text) || /\n{3,}/.test(text) || /^\s+|\s+$/m.test(text);
  if (messyWhitespace) {
    out.push(
      suggestion("Clean up whitespace", "trim and normalize whitespace"),
    );
  }

  if (/[^\x00-\x7F]/.test(text) && /Ã.|Â.|ä.|å./.test(text)) {
    out.push(suggestion("Repair mojibake", "repair mojibake encoding"));
  }

  // Always offer a safe read-only next step when we still have room.
  if (out.length < MAX_SUGGESTIONS && text.trim().length > 0) {
    out.push(suggestion("Explain this", "explain this text"));
  }

  // Pattern-friendly paste: optional regex draft when it looks structured.
  if (
    out.length < MAX_SUGGESTIONS &&
    (/@[\w.-]+\.\w+/.test(text) || /\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(text))
  ) {
    out.push(
      suggestion("Write a regex", "write a regex for emails or numbers"),
    );
  }

  // Fallback when nothing matched but paste is non-empty.
  if (out.length === 0 && text.trim().length > 0) {
    out.push(suggestion("Explain this", "explain this text"));
    out.push(suggestion("Summarize", "summarize this text"));
  }

  return out;
}

function suggestion(label: string, utterance: string): Suggestion {
  return { id: randomUUID(), label, utterance };
}
