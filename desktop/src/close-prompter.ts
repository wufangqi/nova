/**
 * Injectable three-way close confirm for dirty tabs.
 * Desktop wires a labeled dialog; contracts inject a scripted fake.
 * Choices: save | discard | cancel — cancel must not mutate the Buffer.
 */

export type CloseChoice = "save" | "discard" | "cancel";

export type ClosePrompterTab = {
  title: string;
  hasPath: boolean;
};

export interface ClosePrompter {
  confirmDirty(tab: ClosePrompterTab): Promise<CloseChoice>;
}

/** Scripted prompter for headless contracts (no GUI dialog pixels). */
export function createScriptedClosePrompter(opts: {
  choices?: CloseChoice[];
}): ClosePrompter & {
  confirmDirtyCalls: number;
  lastTab: ClosePrompterTab | undefined;
} {
  const choices = [...(opts.choices ?? [])];
  const state = {
    confirmDirtyCalls: 0,
    lastTab: undefined as ClosePrompterTab | undefined,
  };
  return {
    get confirmDirtyCalls() {
      return state.confirmDirtyCalls;
    },
    get lastTab() {
      return state.lastTab;
    },
    async confirmDirty(tab) {
      state.confirmDirtyCalls += 1;
      state.lastTab = { ...tab };
      if (choices.length === 0) {
        throw new Error("scripted ClosePrompter.confirmDirty: no choices left");
      }
      return choices.shift()!;
    },
  };
}
