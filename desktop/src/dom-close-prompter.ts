/**
 * Desktop ClosePrompter: labeled three-way dialog (Save / Don't save / Cancel).
 * Uses a modeless-friendly Promise over DOM; not window.confirm (binary only).
 */
import type {
  CloseChoice,
  ClosePrompter,
  ClosePrompterTab,
} from "./close-prompter.ts";

export function createDomClosePrompter(root: HTMLElement): ClosePrompter {
  return {
    confirmDirty(tab: ClosePrompterTab): Promise<CloseChoice> {
      return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "close-prompt-overlay";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-labelledby", "close-prompt-title");

        const panel = document.createElement("div");
        panel.className = "close-prompt-panel";

        const title = document.createElement("h2");
        title.id = "close-prompt-title";
        title.textContent = "Save changes?";

        const body = document.createElement("p");
        body.textContent = tab.hasPath
          ? `"${tab.title}" has unsaved changes. Save before closing?`
          : `Untitled Buffer "${tab.title}" has unsaved changes. Save before closing?`;

        const actions = document.createElement("div");
        actions.className = "close-prompt-actions";

        const finish = (choice: CloseChoice) => {
          overlay.remove();
          resolve(choice);
        };

        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.textContent = "Save";
        saveBtn.addEventListener("click", () => finish("save"));

        const discardBtn = document.createElement("button");
        discardBtn.type = "button";
        discardBtn.className = "close-prompt-secondary";
        discardBtn.textContent = "Don't save";
        discardBtn.addEventListener("click", () => finish("discard"));

        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "close-prompt-secondary";
        cancelBtn.textContent = "Cancel";
        cancelBtn.addEventListener("click", () => finish("cancel"));

        actions.append(saveBtn, discardBtn, cancelBtn);
        panel.append(title, body, actions);
        overlay.appendChild(panel);
        root.appendChild(overlay);
        saveBtn.focus();
      });
    },
  };
}
