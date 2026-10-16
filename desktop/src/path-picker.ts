/**
 * Injectable Path picker for Open / Save As.
 * Desktop wires a native dialog; contracts inject a scripted fake.
 * `null` means the user cancelled — callers must not mutate Buffer.
 */
export interface PathPicker {
  open(): Promise<string | null>;
  saveAs(defaultPath?: string): Promise<string | null>;
}

/** Scripted picker for headless contracts (no OS dialog pixels). */
export function createScriptedPathPicker(opts: {
  openResults?: Array<string | null>;
  saveAsResults?: Array<string | null>;
}): PathPicker & {
  openCalls: number;
  saveAsCalls: number;
  lastSaveAsDefault: string | undefined;
} {
  const openResults = [...(opts.openResults ?? [])];
  const saveAsResults = [...(opts.saveAsResults ?? [])];
  const state = {
    openCalls: 0,
    saveAsCalls: 0,
    lastSaveAsDefault: undefined as string | undefined,
  };
  return {
    get openCalls() {
      return state.openCalls;
    },
    get saveAsCalls() {
      return state.saveAsCalls;
    },
    get lastSaveAsDefault() {
      return state.lastSaveAsDefault;
    },
    async open() {
      state.openCalls += 1;
      if (openResults.length === 0) {
        throw new Error("scripted PathPicker.open: no results left");
      }
      return openResults.shift()!;
    },
    async saveAs(defaultPath?: string) {
      state.saveAsCalls += 1;
      state.lastSaveAsDefault = defaultPath;
      if (saveAsResults.length === 0) {
        throw new Error("scripted PathPicker.saveAs: no results left");
      }
      return saveAsResults.shift()!;
    },
  };
}
