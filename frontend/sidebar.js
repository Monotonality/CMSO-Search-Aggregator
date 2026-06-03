/** Pinned sources + session notes (localStorage). */
(function () {
  const STORAGE_PINS = "moto_pinned_sources_v1";
  const STORAGE_NOTES = "moto_session_notes_v1";
  const notesStorage = () => window.sessionStorage;
  const STORAGE_NOTES_TEMPLATE_USED = "moto_notes_template_used_v1";

  const TICKET_NOTES_TEMPLATE = `TICKET ID:

CLIENT NAME:

CLIENT AGENCY:

REASON FOR TICKET:

SUSPECTED SYMPTOMS:

CONTEXT:

ACTIONS TAKEN:

NEXT STEPS:
`;

  const pinnedListEl = document.getElementById("pinned-list");
  const pinnedEmptyEl = document.getElementById("pinned-empty");
  const pinnedCountEl = document.getElementById("pinned-count");
  const notesEditorEl = document.getElementById("notes-editor");
  const notesPreviewEl = document.getElementById("notes-preview");
  const notesTabs = document.querySelectorAll("[data-notes-tab]");

  let pins = [];
  let notesSaveTimer = null;

  function pinKey(item) {
    return (item.doc_id || `${item.source_type || "doc"}:${item.id || item.number || item.title}`).trim();
  }

  function slimPinItem(item) {
    return {
      doc_id: item.doc_id || "",
      id: item.id || "",
      number: item.number || "",
      title: item.title || "",
      snippet: item.snippet || "",
      url: item.url || "",
      permalink: item.permalink || "",
      source_type: item.source_type || "",
      source_label: item.source_label || "",
      filename: item.filename || "",
      page_start: item.page_start ?? null,
      page_end: item.page_end ?? null,
      on_disk: Boolean(item.on_disk),
      tags: Array.isArray(item.tags) ? item.tags.slice(0, 12) : [],
      pinned_at: new Date().toISOString(),
    };
  }

  function loadPins() {
    try {
      const raw = localStorage.getItem(STORAGE_PINS);
      pins = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(pins)) pins = [];
    } catch {
      pins = [];
    }
  }

  function savePins() {
    localStorage.setItem(STORAGE_PINS, JSON.stringify(pins));
  }

  function isPinned(item) {
    const key = pinKey(item);
    return pins.some((p) => p.key === key);
  }

  function togglePin(item) {
    const key = pinKey(item);
    const idx = pins.findIndex((p) => p.key === key);
    if (idx >= 0) {
      pins.splice(idx, 1);
    } else {
      pins.unshift({ key, item: slimPinItem(item) });
      if (pins.length > 40) pins.length = 40;
    }
    savePins();
    renderPinnedList();
    window.dispatchEvent(new CustomEvent("pins-changed"));
    return idx < 0;
  }

  function unpinByKey(key) {
    pins = pins.filter((p) => p.key !== key);
    savePins();
    renderPinnedList();
    window.dispatchEvent(new CustomEvent("pins-changed"));
  }

  function clearAllPins() {
    pins = [];
    savePins();
    renderPinnedList();
    window.dispatchEvent(new CustomEvent("pins-changed"));
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderPinnedList() {
    if (!pinnedListEl) return;

    if (pinnedCountEl) {
      pinnedCountEl.textContent = String(pins.length);
    }

    pinnedListEl.innerHTML = "";

    if (pinnedEmptyEl) {
      pinnedEmptyEl.classList.toggle("hidden", pins.length > 0);
    }

    for (const entry of pins) {
      const item = entry.item || {};
      const row = document.createElement("article");
      row.className = "pinned-item";
      row.dataset.pinKey = entry.key;

      const head = document.createElement("div");
      head.className = "pinned-item-head";

      const badge = document.createElement("span");
      const kb = item.source_type === "kb";
      badge.className = kb ? "source-badge source-badge-kb" : "source-badge source-badge-msi";
      badge.textContent = item.source_label || (kb ? "KB" : "MSI");

      const title = document.createElement("button");
      title.type = "button";
      title.className = "pinned-item-title";
      title.textContent = item.title || item.number || "Untitled";
      title.addEventListener("click", () => {
        const url = item.url || item.permalink;
        if (url) window.open(url, "_blank", "noopener,noreferrer");
      });

      head.append(badge, title);
      row.appendChild(head);

      if (item.snippet) {
        const sn = document.createElement("p");
        sn.className = "pinned-item-snippet";
        sn.textContent = item.snippet;
        row.appendChild(sn);
      }

      const actions = document.createElement("div");
      actions.className = "pinned-item-actions";

      const insertBtn = document.createElement("button");
      insertBtn.type = "button";
      insertBtn.className = "btn btn-ghost btn-sm";
      insertBtn.textContent = "To notes";
      insertBtn.addEventListener("click", () => insertPinIntoNotes(entry));

      const unpinBtn = document.createElement("button");
      unpinBtn.type = "button";
      unpinBtn.className = "btn btn-ghost btn-sm";
      unpinBtn.textContent = "Unpin";
      unpinBtn.addEventListener("click", () => unpinByKey(entry.key));

      actions.append(insertBtn, unpinBtn);
      row.appendChild(actions);
      pinnedListEl.appendChild(row);
    }
  }

  function insertPinIntoNotes(entry) {
    const item = entry.item || {};
    const kb = item.source_type === "kb";
    const label = item.number || item.title || "Source";
    const link = item.url || item.permalink || "";
    const page =
      item.page_start != null
        ? item.page_end && item.page_end !== item.page_start
          ? ` (pp. ${item.page_start}–${item.page_end})`
          : ` (p. ${item.page_start})`
        : "";
    const line = link
      ? `- [${label}${page}](${link}) — ${item.title || ""}`
      : `- **${label}**${page} — ${item.title || ""}`;
    const current = notesEditorEl ? notesEditorEl.value : "";
    const prefix = current.trim() ? "\n" : "";
    if (notesEditorEl) {
      notesEditorEl.value = current + prefix + line + "\n";
      scheduleNotesSave();
      renderNotesPreview();
      setNotesTab("write");
      notesEditorEl.focus();
    }
  }

  function loadNotes() {
    if (!notesEditorEl) return;
    try {
      notesEditorEl.value = notesStorage().getItem(STORAGE_NOTES) || "";
    } catch {
      notesEditorEl.value = "";
    }
    if (notesAreEmpty()) {
      applyTicketTemplate(false);
    } else {
      renderNotesPreview();
      updateTemplateButtonState();
    }
  }

  function focusTicketTemplateStart() {
    if (!notesEditorEl) return;
    const marker = "TICKET ID:\n\n";
    const pos = TICKET_NOTES_TEMPLATE.indexOf(marker);
    const start = pos >= 0 ? pos + marker.length : 0;
    notesEditorEl.focus();
    notesEditorEl.setSelectionRange(start, start);
  }

  function applyTicketTemplate(focusStart = true) {
    if (!notesEditorEl) return false;
    notesEditorEl.value = TICKET_NOTES_TEMPLATE;
    scheduleNotesSave();
    updateTemplateButtonState();
    renderNotesPreview();
    if (focusStart) focusTicketTemplateStart();
    return true;
  }

  function notesAreEmpty() {
    return !notesEditorEl?.value.trim();
  }

  function notesContainTemplate() {
    if (!notesEditorEl) return false;
    const text = notesEditorEl.value;
    return text.includes("TICKET ID:") && text.includes("REASON FOR TICKET:");
  }

  /** Block only when notes already contain the template (empty notes always allow a new ticket). */
  function isTemplateBlocked() {
    if (notesAreEmpty()) return false;
    return notesContainTemplate();
  }

  function clearTemplateUsedFlag() {
    try {
      localStorage.removeItem(STORAGE_NOTES_TEMPLATE_USED);
    } catch {
      /* ignore */
    }
  }

  function updateTemplateButtonState() {
    const btn = document.getElementById("insert-notes-template-btn");
    if (!btn) return;
    if (notesAreEmpty()) clearTemplateUsedFlag();
    const blocked = isTemplateBlocked();
    btn.disabled = blocked;
    btn.setAttribute("aria-disabled", blocked ? "true" : "false");
    btn.title = blocked
      ? "Template already in notes (clear the field or use Clear for a new ticket)"
      : "Insert ticket investigation template";
  }

  async function insertNotesTemplate() {
    if (!notesEditorEl || isTemplateBlocked()) return;

    const hasContent = !notesAreEmpty();
    if (hasContent) {
      const ok = await window.MotoDialog?.confirm({
        title: "Replace notes?",
        message: "Your current notes will be replaced with the ticket template.",
        confirmText: "Replace",
        danger: true,
      });
      if (!ok) return;
    }

    applyTicketTemplate(true);
    setNotesTab("write");
  }

  function scheduleNotesSave() {
    if (!notesEditorEl) return;
    clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(() => {
      try {
        notesStorage().setItem(STORAGE_NOTES, notesEditorEl.value);
      } catch {
        /* ignore quota */
      }
    }, 400);
  }

  function setEditorSelection(start, end) {
    if (!notesEditorEl) return;
    notesEditorEl.focus();
    notesEditorEl.setSelectionRange(start, end);
  }

  function replaceEditorRange(start, end, insert) {
    if (!notesEditorEl) return;
    const val = notesEditorEl.value;
    const newVal = val.slice(0, start) + insert + val.slice(end);
    notesEditorEl.value = newVal;
    scheduleNotesSave();
    return newVal;
  }

  function getLineRange() {
    const el = notesEditorEl;
    const val = el.value;
    let start = el.selectionStart;
    let end = el.selectionEnd;
    while (start > 0 && val[start - 1] !== "\n") start -= 1;
    while (end < val.length && val[end] !== "\n") end += 1;
    return { start, end, block: val.slice(start, end) };
  }

  function wrapSelection(before, after, placeholder) {
    if (!notesEditorEl) return;
    const start = notesEditorEl.selectionStart;
    const end = notesEditorEl.selectionEnd;
    const selected = notesEditorEl.value.slice(start, end);
    const inner = selected || placeholder || "";
    const insert = before + inner + after;
    replaceEditorRange(start, end, insert);
    const selStart = start + before.length;
    const selEnd = selStart + inner.length;
    setEditorSelection(selStart, selEnd);
    maybeRefreshPreview();
  }

  function transformSelectedLines(lineFn) {
    if (!notesEditorEl) return;
    const { start, end, block } = getLineRange();
    const lines = block.split("\n");
    const newBlock = lines.map((line) => lineFn(line)).join("\n");
    replaceEditorRange(start, end, newBlock);
    setEditorSelection(start, start + newBlock.length);
    maybeRefreshPreview();
  }

  function stripHeading(line) {
    return line.replace(/^#{1,6}\s+/, "");
  }

  function applyHeading(level, line) {
    const stripped = stripHeading(line);
    const prefix = "#".repeat(level) + " ";
    if (line.startsWith(prefix)) return stripped;
    return prefix + stripped;
  }

  function toggleLinePrefix(line, prefix, pattern) {
    if (pattern.test(line)) return line.replace(pattern, "");
    return prefix + stripHeading(line);
  }

  function applyNumberedList() {
    if (!notesEditorEl) return;
    const { start, end, block } = getLineRange();
    const lines = block.split("\n");
    const allNumbered = lines.every((line) => line === "" || /^\s*\d+\.\s+/.test(line));
    let n = 1;
    const newLines = allNumbered
      ? lines.map((line) => line.replace(/^(\s*)\d+\.\s+/, "$1"))
      : lines.map((line) => {
          if (!line.trim()) return line;
          const body = stripHeading(
            line.replace(/^(\s*)[-*]\s+/, "$1").replace(/^(\s*)\d+\.\s+/, "$1")
          );
          const out = `${n}. ${body}`;
          n += 1;
          return out;
        });
    const newBlock = newLines.join("\n");
    replaceEditorRange(start, end, newBlock);
    setEditorSelection(start, start + newBlock.length);
    maybeRefreshPreview();
  }

  function applyNotesFormat(action) {
    if (!notesEditorEl) return;

    switch (action) {
      case "bold":
        wrapSelection("**", "**", "bold text");
        break;
      case "italic":
        wrapSelection("*", "*", "italic text");
        break;
      case "code":
        wrapSelection("`", "`", "code");
        break;
      case "h1":
        transformSelectedLines((line) => applyHeading(1, line));
        break;
      case "h2":
        transformSelectedLines((line) => applyHeading(2, line));
        break;
      case "h3":
        transformSelectedLines((line) => applyHeading(3, line));
        break;
      case "bullet":
        transformSelectedLines((line) =>
          toggleLinePrefix(line, "- ", /^(\s*)[-*]\s+/)
        );
        break;
      case "numbered":
        applyNumberedList();
        break;
      case "quote":
        transformSelectedLines((line) => toggleLinePrefix(line, "> ", /^>\s?/));
        break;
      case "link":
        void applyLinkFormat();
        break;
      default:
        break;
    }
  }

  async function applyLinkFormat() {
    if (!notesEditorEl) return;
    const start = notesEditorEl.selectionStart;
    const end = notesEditorEl.selectionEnd;
    const label = notesEditorEl.value.slice(start, end) || "link text";
    const url = await window.MotoDialog?.prompt({
      title: "Insert link",
      message: "Enter the URL for the selected text.",
      label: "URL",
      defaultValue: "https://",
      confirmText: "Insert",
    });
    if (!url) return;
    const insert = `[${label}](${url.trim()})`;
    replaceEditorRange(start, end, insert);
    setEditorSelection(start, start + insert.length);
    maybeRefreshPreview();
  }

  function maybeRefreshPreview() {
    if (!document.getElementById("notes-pane-preview")?.classList.contains("hidden")) {
      renderNotesPreview();
    }
  }

  function initNotesToolbar() {
    const toolbar = document.getElementById("notes-toolbar");
    if (!toolbar) return;

    toolbar.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) e.preventDefault();
    });

    for (const btn of toolbar.querySelectorAll("[data-fmt]")) {
      btn.addEventListener("click", () => applyNotesFormat(btn.dataset.fmt));
    }
  }

  function renderMarkdown(md) {
    let html = escapeHtml(md);
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(
      /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    html = html.replace(/^(?:-|\*) (.+)$/gm, "<li>$1</li>");
    html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
    html = html.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");
    html = html.replace(/\n\n/g, "</p><p>");
    html = `<p>${html}</p>`;
    html = html.replace(/<p><\/p>/g, "");
    html = html.replace(/<p>(<h[123]>)/g, "$1");
    html = html.replace(/(<\/h[123]>)<\/p>/g, "$1");
    html = html.replace(/<p>(<ul>)/g, "$1");
    html = html.replace(/(<\/ul>)<\/p>/g, "$1");
    return html;
  }

  function renderNotesPreview() {
    if (!notesPreviewEl || !notesEditorEl) return;
    const text = notesEditorEl.value.trim();
    if (!text) {
      notesPreviewEl.innerHTML = '<p class="notes-preview-empty">Nothing to preview yet.</p>';
      return;
    }
    notesPreviewEl.innerHTML = renderMarkdown(text);
  }

  function setNotesTab(tab) {
    const editPane = document.getElementById("notes-pane-edit");
    const previewPane = document.getElementById("notes-pane-preview");
    const isWrite = tab === "write";

    for (const btn of notesTabs) {
      const on = btn.dataset.notesTab === tab;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    }

    if (editPane) editPane.classList.toggle("hidden", !isWrite);
    if (previewPane) previewPane.classList.toggle("hidden", tab !== "preview");
    if (tab === "preview") renderNotesPreview();
    else if (isWrite) notesEditorEl?.focus();
  }

  function openNotesPopout() {
    const url = `${window.location.origin}/static/ticket-form.html`;
    const features = "width=560,height=780,scrollbars=yes,resizable=yes";
    const win = window.open(url, "motoTicketForm", features);
    if (!win) {
      window.MotoDialog?.alert?.({
        title: "Popout blocked",
        message: "Allow popups for this site to open the ticket form.",
      });
    }
  }

  function initSidebar() {
    loadPins();
    renderPinnedList();
    loadNotes();

    document.getElementById("clear-pins-btn")?.addEventListener("click", async () => {
      if (!pins.length) return;
      const ok = await window.MotoDialog?.confirm({
        title: "Clear pinned sources?",
        message: "Remove all pinned KB articles and manual pages from this session.",
        confirmText: "Clear all",
        danger: true,
      });
      if (ok) clearAllPins();
    });

    document.getElementById("insert-notes-template-btn")?.addEventListener("click", insertNotesTemplate);

    document.getElementById("popout-notes-btn")?.addEventListener("click", openNotesPopout);

    document.getElementById("clear-notes-btn")?.addEventListener("click", async () => {
      if (!notesEditorEl?.value.trim()) return;
      const ok = await window.MotoDialog?.confirm({
        title: "Clear all notes?",
        message:
          "This removes your session notes. You can insert the ticket template again for a new ticket.",
        confirmText: "Clear notes",
        danger: true,
      });
      if (!ok) return;
      clearTemplateUsedFlag();
      applyTicketTemplate(true);
      setNotesTab("write");
    });

    for (const btn of notesTabs) {
      btn.addEventListener("click", () => setNotesTab(btn.dataset.notesTab));
    }

    notesEditorEl?.addEventListener("input", () => {
      scheduleNotesSave();
      maybeRefreshPreview();
      updateTemplateButtonState();
    });

    initNotesToolbar();
    setNotesTab("write");
  }

  window.MotoSidebar = {
    initSidebar,
    isPinned,
    togglePin,
    renderPinnedList,
    openNotesPopout,
  };
})();
