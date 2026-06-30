/**
 * Standalone ticket investigation form (not linked to sidebar notes editor).
 */
(function () {
  const DRAFT_KEY = "moto_ticket_form_draft_v2";

  const SECTIONS = [
    { id: "field-priority", label: "Priority:", multiline: false },
    { id: "field-inc-number", label: "INC Number:", multiline: false },
    { id: "field-agency", label: "Agency:", multiline: false },
    { id: "field-name", label: "Name:", multiline: false },
    { id: "field-state", label: "State:", multiline: false },
    { id: "field-software-version", label: "Software/Firmware Version:", multiline: false },
    { id: "field-deployment-date", label: "Deployment Date:", multiline: false },
    { id: "field-issue-description", label: "Initial Issue Description:", multiline: true },
    { id: "field-ticket-history", label: "Customer Ticket History:", multiline: true },
    { id: "field-incident-context", label: "Incident Context & Background:", multiline: true },
    { id: "field-diagnostic-findings", label: "Diagnostic Findings:", multiline: true },
    { id: "field-kb-utilization", label: "KB Utilization:", multiline: true },
    { id: "field-actions-taken", label: "Actions Taken:", multiline: true },
    { id: "field-next-steps", label: "Next Steps:", multiline: true },
    { id: "field-closure-details", label: "Closure Details:", multiline: true },
  ];

  const statusEl = document.getElementById("tf-status");

  function displayLabel(label) {
    return label.replace(/:+$/, "");
  }

  function renderForm() {
    const form = document.getElementById("ticket-form");
    if (!form) return;
    form.replaceChildren();
    for (const { id, label, multiline } of SECTIONS) {
      const wrap = document.createElement("div");
      wrap.className = "tf-field";
      const lbl = document.createElement("label");
      lbl.htmlFor = id;
      lbl.textContent = displayLabel(label);
      wrap.appendChild(lbl);
      let input;
      if (multiline) {
        input = document.createElement("textarea");
        input.rows = 4;
      } else {
        input = document.createElement("input");
        input.type = "text";
        input.autocomplete = "off";
      }
      input.id = id;
      wrap.appendChild(input);
      form.appendChild(wrap);
    }
  }

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
    const ticket = getValue("field-inc-number").replace(/[^\w-]+/g, "_") || "ticket";
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

  renderForm();

  for (const { id } of SECTIONS) {
    document.getElementById(id)?.addEventListener("input", saveDraft);
  }

  loadDraft();
})();
