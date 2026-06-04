/**
 * Tech Notes Form — paste any label:value notes, edit as form, export plain text.
 * Standalone tool (not part of CMSO Signal).
 */
(function () {
  const DRAFT_KEY = "tech_notes_form_draft_v1";
  const THEME_KEY = "tech_notes_form_theme_v1";
  const THEME_OPTIONS = ["dark", "light", "system", "ocean", "warm"];

  const themeSelect = document.getElementById("theme-select");

  const pasteInput = document.getElementById("paste-input");
  const fieldsContainer = document.getElementById("fields-container");
  const exportPreview = document.getElementById("export-preview");
  const exportStyle = document.getElementById("export-style");
  const exportBlankLine = document.getElementById("export-blank-line");
  const parseStatus = document.getElementById("parse-status");
  const exportStatus = document.getElementById("export-status");
  const templateStatus = document.getElementById("template-status");
  const templatesList = document.getElementById("templates-list");

  const NOTE_TEMPLATES = [
    {
      id: "standard",
      title: "Standard ticket",
      description: "Same-line labels, full investigation flow",
      text: `TICKET ID: INC0012345
CLIENT NAME: John Doe
CLIENT AGENCY: Fallburn PD
CALLBACK NUMBER: 555-0100
REASON FOR TICKET: M500 configured disconnected in VideoManager EX
SUSPECTED SYMPTOMS: In-car unit will not connect to VMEX after dock reboot
CONTEXT: Customer rebooted dock twice. Server team says VMEX is up.
ACTIONS TAKEN: Reviewed firewall KB. Walked customer through port check.
NEXT STEPS: Follow up if issue returns after overnight power cycle
RESOLUTION: (empty)`,
    },
    {
      id: "alt-labels",
      title: "Alternate field names",
      description: "Customer / Precinct style labels",
      text: `Customer Name: Jane Smith
Precinct: 142A
Location: OK
Device: M500
Serial Number: (empty)
Issue: No transmit on primary channel
Notes: Customer hears tone but radio does not key
Status: In progress`,
    },
    {
      id: "block",
      title: "Block layout",
      description: "Label on one line, value on the next",
      text: `TICKET ID:

INC0098765

CLIENT NAME:

Metro Fire District

CLIENT AGENCY:

North County

REASON FOR TICKET:

Invalid serial number on boot

ACTIONS TAKEN:

Confirmed asset tag matches RMA unit
Re-flashed per KB article
Unit boots normally after flash

NEXT STEPS:

Close ticket if stable 24 hours`,
    },
    {
      id: "quick",
      title: "Quick call",
      description: "Short fields for fast documentation",
      text: `Client Name: (empty)
Client Agency: State PD Demo
Ticket ID: (empty)
Problem: APX portable not charging on multi-bay
Tried: Different cable and bay, same result
KB Used: (empty)
Outcome: RMA recommended`,
    },
    {
      id: "blank",
      title: "Blank starter",
      description: "Empty fields ready to fill in",
      text: `TICKET ID:
CLIENT NAME:
CLIENT AGENCY:
REASON FOR TICKET:
SUSPECTED SYMPTOMS:
CONTEXT:
ACTIONS TAKEN:
NEXT STEPS:`,
    },
    {
      id: "rma",
      title: "RMA / hardware",
      description: "Return and replacement tracking",
      text: `TICKET ID:
CLIENT NAME:
CLIENT AGENCY:
DEVICE MODEL:
SERIAL NUMBER:
ASSET TAG:
FAILURE DESCRIPTION:
TROUBLESHOOTING PERFORMED:
KB ARTICLES USED:
RMA AUTHORIZED: (empty)
SHIPPING TRACKING: (empty)
NOTES:`,
    },
  ];

  /** @type {{ id: string, label: string, value: string, multiline: boolean }[]} */
  let fields = [];

  function uid() {
    return `f_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function resolveTheme(pref) {
    if (pref === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    return THEME_OPTIONS.includes(pref) ? pref : "dark";
  }

  function applyTheme(pref) {
    const choice = THEME_OPTIONS.includes(pref) ? pref : "dark";
    const resolved = resolveTheme(choice);
    document.documentElement.setAttribute("data-theme", resolved);
    document.documentElement.setAttribute("data-theme-pref", choice);
    if (themeSelect && themeSelect.value !== choice) {
      themeSelect.value = choice;
    }
    try {
      localStorage.setItem(THEME_KEY, choice);
    } catch {
      /* ignore */
    }
  }

  function previewSnippet(text, maxLines = 4) {
    const lines = text.trim().split("\n");
    const slice = lines.slice(0, maxLines).join("\n");
    if (lines.length > maxLines) return slice + "\n...";
    return slice;
  }

  async function copyTemplateText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;left:-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        document.body.removeChild(ta);
        return true;
      } catch {
        document.body.removeChild(ta);
        return false;
      }
    }
  }

  function useTemplate(text, andParse) {
    if (pasteInput) {
      pasteInput.value = text;
      pasteInput.focus();
    }
    if (andParse) {
      parseFromPaste(true);
      setStatus(templateStatus, "Template loaded and parsed.", "is-ok");
    } else {
      setStatus(templateStatus, "Template loaded into import box.", "is-ok");
    }
  }

  function renderTemplates() {
    if (!templatesList) return;
    templatesList.innerHTML = "";

    for (const tmpl of NOTE_TEMPLATES) {
      const card = document.createElement("article");
      card.className = "nf-template-card";

      const head = document.createElement("div");
      head.className = "nf-template-card-head";
      const titles = document.createElement("div");
      const h4 = document.createElement("h4");
      h4.className = "nf-template-card-title";
      h4.textContent = tmpl.title;
      const desc = document.createElement("p");
      desc.className = "nf-template-card-desc";
      desc.textContent = tmpl.description;
      titles.appendChild(h4);
      titles.appendChild(desc);
      head.appendChild(titles);

      const pre = document.createElement("pre");
      pre.className = "nf-template-preview";
      pre.textContent = previewSnippet(tmpl.text);

      const actions = document.createElement("div");
      actions.className = "nf-template-actions";

      const btnCopy = document.createElement("button");
      btnCopy.type = "button";
      btnCopy.className = "nf-btn nf-btn-secondary";
      btnCopy.textContent = "Copy";
      btnCopy.addEventListener("click", async () => {
        const ok = await copyTemplateText(tmpl.text);
        setStatus(
          templateStatus,
          ok ? `Copied "${tmpl.title}" to clipboard.` : "Copy failed.",
          ok ? "is-ok" : "is-error"
        );
      });

      const btnUse = document.createElement("button");
      btnUse.type = "button";
      btnUse.className = "nf-btn nf-btn-secondary";
      btnUse.textContent = "Load";
      btnUse.addEventListener("click", () => useTemplate(tmpl.text, false));

      const btnParse = document.createElement("button");
      btnParse.type = "button";
      btnParse.className = "nf-btn nf-btn-primary";
      btnParse.textContent = "Load & parse";
      btnParse.addEventListener("click", () => useTemplate(tmpl.text, true));

      actions.appendChild(btnCopy);
      actions.appendChild(btnUse);
      actions.appendChild(btnParse);

      card.appendChild(head);
      card.appendChild(pre);
      card.appendChild(actions);
      templatesList.appendChild(card);
    }
  }

  function initTheme() {
    let pref = "dark";
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved && THEME_OPTIONS.includes(saved)) pref = saved;
    } catch {
      /* ignore */
    }
    applyTheme(pref);
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        const current = document.documentElement.getAttribute("data-theme-pref");
        if (current === "system") applyTheme("system");
      });
    themeSelect?.addEventListener("change", () => {
      applyTheme(themeSelect.value);
    });
  }

  function setStatus(el, msg, kind) {
    if (!el) return;
    el.textContent = msg || "";
    el.classList.remove("is-ok", "is-error");
    if (kind) el.classList.add(kind);
  }

  function normalizeEmptyToken(value) {
    const v = value.trim();
    if (/^\(empty\)$/i.test(v) || /^n\/a$/i.test(v) || /^—$/.test(v)) {
      return "";
    }
    return value;
  }

  /**
   * Line looks like a field label (ends with colon, reasonable length).
   * @param {string} line
   */
  function looksLikeLabelLine(line) {
    const trimmed = line.trim();
    if (!trimmed.includes(":")) return false;
    const idx = trimmed.indexOf(":");
    const label = trimmed.slice(0, idx).trim();
    if (!label || label.length > 72) return false;
    if (/^https?:\/\//i.test(label)) return false;
    if (/^\d{1,2}:\d{2}/.test(label)) return false;
    return /^[\w\s./\-_()#&'+]+$/i.test(label);
  }

  /**
   * @param {string} text
   * @returns {{ label: string, value: string, multiline: boolean }[]}
   */
  function parseNotesText(text) {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const raw = lines[i];
      const trimmed = raw.trim();

      if (!trimmed) {
        i += 1;
        continue;
      }

      if (!looksLikeLabelLine(trimmed)) {
        i += 1;
        continue;
      }

      const colonIdx = trimmed.indexOf(":");
      const label = trimmed.slice(0, colonIdx).trim();
      let rest = trimmed.slice(colonIdx + 1).trim();
      rest = normalizeEmptyToken(rest);

      let value = rest;
      let multiline = false;

      if (!value) {
        const valueLines = [];
        let j = i + 1;
        while (j < lines.length) {
          const nextTrim = lines[j].trim();
          if (nextTrim && looksLikeLabelLine(lines[j])) break;
          if (nextTrim || valueLines.length > 0) {
            valueLines.push(lines[j]);
          }
          j += 1;
        }
        if (valueLines.length > 0) {
          value = valueLines.join("\n").trim();
          multiline = value.includes("\n") || valueLines.length > 1;
          i = j - 1;
        }
      } else if (value.length > 80) {
        multiline = true;
      }

      out.push({
        label,
        value: normalizeEmptyToken(value),
        multiline: multiline || value.includes("\n"),
      });
      i += 1;
    }

    if (out.length === 0 && text.trim()) {
      out.push({
        label: "Notes",
        value: text.trim(),
        multiline: true,
      });
    }

    return out;
  }

  function slugLabel(label) {
    return label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function mergeParsed(parsed, replace) {
    if (replace) {
      fields = parsed.map((p) => ({
        id: uid(),
        label: p.label,
        value: p.value,
        multiline: p.multiline,
      }));
      return;
    }
    const existing = new Set(
      fields.map((f) => slugLabel(f.label))
    );
    for (const p of parsed) {
      const key = slugLabel(p.label);
      const found = fields.find((f) => slugLabel(f.label) === key);
      if (found) {
        found.value = p.value;
        found.multiline = p.multiline || found.multiline;
      } else if (!existing.has(key)) {
        fields.push({
          id: uid(),
          label: p.label,
          value: p.value,
          multiline: p.multiline,
        });
        existing.add(key);
      }
    }
  }

  function saveDraft() {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          fields,
          exportStyle: exportStyle?.value,
          blankLine: exportBlankLine?.checked,
        })
      );
    } catch {
      /* ignore */
    }
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.fields)) {
        fields = data.fields;
      }
      if (exportStyle && data.exportStyle) {
        exportStyle.value = data.exportStyle;
      }
      if (exportBlankLine && typeof data.blankLine === "boolean") {
        exportBlankLine.checked = data.blankLine;
      }
    } catch {
      /* ignore */
    }
  }

  function formatLabelForExport(label, style) {
    const clean = label.replace(/:+\s*$/, "").trim();
    if (style === "upper-block") {
      return clean.toUpperCase() + ":";
    }
    return clean + ":";
  }

  function fieldsToPlainText(fieldList, style, blankBetween) {
    const sep = blankBetween ? "\n\n" : "\n";
    const chunks = fieldList.map((f) => {
      const label = formatLabelForExport(f.label, style);
      const val = f.value || "";
      if (style === "same-line") {
        if (!val) return `${label} (empty)`;
        if (val.includes("\n")) {
          return `${label}\n${val}`;
        }
        return `${label} ${val}`;
      }
      if (!val) {
        return `${label}\n(empty)`;
      }
      return `${label}\n${val}`;
    });
    return chunks.join(sep).trimEnd() + "\n";
  }

  function refreshExportPreview() {
    const text = fieldsToPlainText(
      fields,
      exportStyle?.value || "same-line",
      exportBlankLine?.checked !== false
    );
    if (exportPreview) exportPreview.value = text;
    return text;
  }

  function renderFields() {
    if (!fieldsContainer) return;
    fieldsContainer.innerHTML = "";

    for (const field of fields) {
      const wrap = document.createElement("div");
      wrap.className = "nf-field";
      wrap.dataset.id = field.id;

      const head = document.createElement("div");
      head.className = "nf-field-head";

      const labelInput = document.createElement("input");
      labelInput.type = "text";
      labelInput.className = "nf-field-label-input";
      labelInput.value = field.label;
      labelInput.setAttribute("aria-label", "Field label");
      labelInput.addEventListener("input", () => {
        field.label = labelInput.value;
        saveDraft();
        refreshExportPreview();
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "nf-btn-icon";
      removeBtn.title = "Remove field";
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", () => {
        fields = fields.filter((f) => f.id !== field.id);
        renderFields();
        saveDraft();
        refreshExportPreview();
      });

      head.appendChild(labelInput);
      head.appendChild(removeBtn);

      const useTextarea =
        field.multiline || (field.value && field.value.length > 100);
      const input = document.createElement(useTextarea ? "textarea" : "input");
      input.className = "nf-field-input" + (useTextarea ? " textarea" : "");
      if (useTextarea) {
        input.rows = Math.min(8, Math.max(3, field.value.split("\n").length + 1));
      } else {
        input.type = "text";
      }
      input.value = field.value;
      input.setAttribute("aria-label", field.label);
      input.addEventListener("input", () => {
        field.value = input.value;
        if (input instanceof HTMLTextAreaElement) field.multiline = true;
        saveDraft();
        refreshExportPreview();
      });

      const meta = document.createElement("div");
      meta.className = "nf-field-meta";
      meta.textContent = useTextarea ? "Multi-line field" : "Single line";

      wrap.appendChild(head);
      wrap.appendChild(input);
      wrap.appendChild(meta);
      fieldsContainer.appendChild(wrap);
    }

    refreshExportPreview();
  }

  function parseFromPaste(replace) {
    const text = pasteInput?.value || "";
    if (!text.trim()) {
      setStatus(parseStatus, "Paste some notes first.", "is-error");
      return;
    }
    const parsed = parseNotesText(text);
    if (parsed.length === 0) {
      setStatus(parseStatus, "No fields detected. Try Label: value lines.", "is-error");
      return;
    }
    mergeParsed(parsed, replace);
    renderFields();
    saveDraft();
    setStatus(
      parseStatus,
      `Parsed ${parsed.length} field${parsed.length === 1 ? "" : "s"}.`,
      "is-ok"
    );
  }

  function newNote() {
    fields = [
      { id: uid(), label: "Client Name", value: "", multiline: false },
      { id: uid(), label: "Client Agency", value: "", multiline: false },
      { id: uid(), label: "Reason for ticket", value: "", multiline: true },
      { id: uid(), label: "Actions taken", value: "", multiline: true },
    ];
    if (pasteInput) pasteInput.value = "";
    renderFields();
    saveDraft();
    setStatus(parseStatus, "New note template ready.", "is-ok");
  }

  async function copyExport() {
    const text = refreshExportPreview();
    try {
      await navigator.clipboard.writeText(text);
      setStatus(exportStatus, "Copied to clipboard.", "is-ok");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;left:-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setStatus(exportStatus, "Copied to clipboard.", "is-ok");
      } catch {
        setStatus(exportStatus, "Copy failed.", "is-error");
      }
      document.body.removeChild(ta);
    }
  }

  function downloadExport() {
    const text = refreshExportPreview();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const first = fields[0]?.value?.slice(0, 24).replace(/[^\w-]+/g, "_") || "notes";
    const filename = `tech-notes-${first}-${stamp}.txt`;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(exportStatus, `Downloaded ${filename}`, "is-ok");
  }

  document.getElementById("btn-parse")?.addEventListener("click", () => {
    parseFromPaste(true);
  });
  document.getElementById("btn-append-parse")?.addEventListener("click", () => {
    parseFromPaste(false);
  });
  document.getElementById("btn-new-note")?.addEventListener("click", newNote);
  document.getElementById("btn-add-field")?.addEventListener("click", () => {
    fields.push({
      id: uid(),
      label: "New field",
      value: "",
      multiline: false,
    });
    renderFields();
    saveDraft();
  });
  document.getElementById("btn-copy")?.addEventListener("click", copyExport);
  document.getElementById("btn-download")?.addEventListener("click", downloadExport);
  document.getElementById("btn-refresh-export")?.addEventListener("click", () => {
    refreshExportPreview();
    setStatus(exportStatus, "Preview updated.", "is-ok");
  });
  exportStyle?.addEventListener("change", () => {
    saveDraft();
    refreshExportPreview();
  });
  exportBlankLine?.addEventListener("change", () => {
    saveDraft();
    refreshExportPreview();
  });

  initTheme();
  renderTemplates();
  loadDraft();
  if (fields.length > 0) {
    renderFields();
  } else {
    refreshExportPreview();
  }
})();
