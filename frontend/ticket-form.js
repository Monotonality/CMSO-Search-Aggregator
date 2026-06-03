/**
 * Standalone ticket investigation form (not linked to sidebar notes editor).
 */
(function () {
  const DRAFT_KEY = "moto_ticket_form_draft_v1";

  const SECTIONS = [
    { id: "field-ticket-id", label: "TICKET ID:" },
    { id: "field-client-name", label: "CLIENT NAME:" },
    { id: "field-client-agency", label: "CLIENT AGENCY:" },
    { id: "field-reason", label: "REASON FOR TICKET:" },
    { id: "field-symptoms", label: "SUSPECTED SYMPTOMS:" },
    { id: "field-context", label: "CONTEXT:" },
    { id: "field-actions", label: "ACTIONS TAKEN:" },
    { id: "field-next", label: "NEXT STEPS:" },
  ];

  const statusEl = document.getElementById("tf-status");

  function setStatus(msg, kind) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.classList.remove("is-ok", "is-error");
    if (kind) statusEl.classList.add(kind);
  }

  function getValue(id) {
    const el = document.getElementById(id);
    return el ? String(el.value || "").trim() : "";
  }

  function buildText() {
    const parts = [];
    for (const { id, label } of SECTIONS) {
      parts.push(label, "", getValue(id), "");
    }
    return parts.join("\n").trimEnd() + "\n";
  }

  function saveDraft() {
    const draft = {};
    for (const { id } of SECTIONS) {
      draft[id] = getValue(id);
    }
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }

  function loadDraft() {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      for (const { id } of SECTIONS) {
        const el = document.getElementById(id);
        if (el && draft[id] != null) el.value = draft[id];
      }
    } catch {
      /* ignore */
    }
  }

  function downloadTxt() {
    const text = buildText();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const ticket = getValue("field-ticket-id").replace(/[^\w-]+/g, "_") || "ticket";
    const filename = `ticket-notes-${ticket}-${stamp}.txt`;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Downloaded ${filename}`, "is-ok");
    return filename;
  }

  async function copyText() {
    const text = buildText();
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied to clipboard.", "is-ok");
      return;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;left:-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setStatus("Copied to clipboard.", "is-ok");
      } catch {
        setStatus("Copy failed — use Download .txt", "is-error");
      }
      document.body.removeChild(ta);
    }
  }

  document.getElementById("tf-copy")?.addEventListener("click", copyText);
  document.getElementById("tf-download")?.addEventListener("click", downloadTxt);
  document.getElementById("tf-close")?.addEventListener("click", () => {
    saveDraft();
    window.close();
  });

  for (const { id } of SECTIONS) {
    document.getElementById(id)?.addEventListener("input", saveDraft);
  }

  loadDraft();
})();
