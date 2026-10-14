import { invoke } from "@tauri-apps/api/core";

type BufferSnapshot = {
  id: string;
  text: string;
  revision: number;
};

type AcceptIpcResult = {
  accept: { ok: true; undoGroupId: string } | { ok: false; reason: string };
  buffers: BufferSnapshot[];
};

let current: BufferSnapshot | null = null;

function output(el: HTMLElement, value: unknown) {
  el.textContent =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

window.addEventListener("DOMContentLoaded", () => {
  const textEl = document.querySelector<HTMLTextAreaElement>("#buffer-text");
  const createBtn = document.querySelector<HTMLButtonElement>("#create-buffer");
  const acceptBtn = document.querySelector<HTMLButtonElement>("#accept-patch");
  const outEl = document.querySelector<HTMLElement>("#output");
  if (!textEl || !createBtn || !acceptBtn || !outEl) return;

  createBtn.addEventListener("click", async () => {
    try {
      current = await invoke<BufferSnapshot>("create_buffer_cmd", {
        text: textEl.value,
      });
      acceptBtn.disabled = false;
      output(outEl, { created: current });
    } catch (err) {
      output(outEl, String(err));
    }
  });

  acceptBtn.addEventListener("click", async () => {
    if (!current) return;
    const needle = "world";
    const start = current.text.indexOf(needle);
    if (start < 0) {
      output(outEl, `Buffer text does not contain "${needle}"`);
      return;
    }
    const end = start + needle.length;
    try {
      const result = await invoke<AcceptIpcResult>("accept_cmd", {
        patches: [
          {
            bufferId: current.id,
            baseRevision: current.revision,
            edits: [
              {
                start,
                end,
                replacement: "nova",
                before: start > 0 ? current.text.slice(start - 1, start) : "",
                after: "",
              },
            ],
            provenance: { source: "ai", label: "ipc-handcraft" },
            intentId: "wuf-81-smoke",
          },
        ],
      });
      if (result.buffers[0]) current = result.buffers[0];
      output(outEl, result);
    } catch (err) {
      output(outEl, String(err));
    }
  });
});
