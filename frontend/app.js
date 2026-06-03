const searchForm = document.getElementById("search-form");

const searchInput = document.getElementById("search-input");

const resultsEl = document.getElementById("results");

const searchStatus = document.getElementById("search-status");

function setSearchStatus(message) {
  if (!searchStatus) return;
  const text = message || "";
  searchStatus.textContent = text;
  searchStatus.classList.toggle("hidden", !text);
}

function clearSearchResults() {
  if (resultsEl) resultsEl.innerHTML = "";
  setSearchStatus("");
  lastSearchQuery = "";
}

const searchSourceLabel = document.getElementById("search-source-label");

const headerMeta = document.getElementById("header-meta");

const searchModeGroup = document.getElementById("search-mode-group");

const searchModeHint = document.getElementById("search-mode-hint");

const sourceFilterGroup = document.getElementById("source-filter-group");

const DEFAULT_INFORMATION_SOURCES = [
  { id: "kb", label: "KB", enabled: true, description: "Local M500 knowledge base articles" },
  { id: "msi_library", label: "MSI Library", enabled: true, description: "Manual PDF library" },
  {
    id: "google_chat",
    label: "Google Chat History",
    enabled: false,
    description: "Not connected — coming soon",
  },
  { id: "snow_kb", label: "SnowKB", enabled: false, description: "ServiceNow KB — not connected" },
  {
    id: "google_drive",
    label: "Google Drive",
    enabled: false,
    description: "Not connected — coming soon",
  },
];

let informationSources = DEFAULT_INFORMATION_SOURCES;

const DEFAULT_SEARCH_MODES = [
  {
    id: "hybrid",
    label: "Smart mix",
    description: "Keyword + semantic blend (default)",
  },
  {
    id: "keyword",
    label: "Keyword",
    description: "Full-text match (BM25) — exact terms and tags",
  },
  {
    id: "semantic",
    label: "Semantic",
    description: "Meaning similarity — paraphrases and related wording",
  },
  {
    id: "generic",
    label: "Balanced",
    description: "Equal keyword and semantic weighting",
  },
];

let searchModes = DEFAULT_SEARCH_MODES;

let activeSearchMode = "hybrid";

let lastSearchMode = "hybrid";
let lastSearchQuery = "";



function api(path, options) {
  if (!window.MotoApi?.api) {
    throw new Error("API client not loaded — refresh the page.");
  }
  return window.MotoApi.api(path, options);
}



async function init() {

  try {

    const health = await api("/api/health");

    if (!["CMSO", "M500"].includes(health.product)) {

      searchSourceLabel.textContent =

        "Old server still running — restart uvicorn (see README).";

      return;

    }

    const cfg = await api("/api/config");

    const kb = cfg.kb || {};

    const lib = cfg.msi_library || {};

    const idx = cfg.search_index || {};

    const articles = kb.article_count || 0;

    const manuals = lib.manual_count || 0;

    const indexed = idx.document_count || 0;



    headerMeta.textContent =

      indexed > 0

        ? `${indexed} indexed docs · ${articles} articles · ${manuals} manuals`

        : "Index building… refresh in a moment";



    searchSourceLabel.textContent = idx.ready

      ? `Expand results or open links when available`

      : "Run scripts/rebuild_index.py to build the search index";

    if (Array.isArray(cfg.search_modes) && cfg.search_modes.length) {
      searchModes = cfg.search_modes;
    }
    if (Array.isArray(cfg.information_sources) && cfg.information_sources.length) {
      informationSources = cfg.information_sources;
    }
    setupSearchModes();
    setupSourceFilters();

  } catch (err) {

    const hint = window.MotoApi?.base
      ? `Backend expected at ${window.MotoApi.base}`
      : "Start uvicorn on port 8001";
    headerMeta.textContent = `Could not load config — ${err.message || "offline"}. ${hint}.`;
    searchSourceLabel.textContent =
      "Open http://127.0.0.1:8001/ (not Live Preview / file://)";

    setupSearchModes();
    setupSourceFilters();

  }

  if (window.MotoSidebar) {
    window.MotoSidebar.initSidebar();
    window.addEventListener("pins-changed", () => refreshPinButtons());
  }

  setSearchStatus("");

  searchInput.addEventListener("input", () => {
    if (!searchInput.value.trim()) clearSearchResults();
  });

  searchInput.focus();

}



function setupSearchModes() {

  if (!searchModeGroup) return;

  searchModeGroup.innerHTML = "";

  for (const mode of searchModes) {

    const btn = document.createElement("button");

    btn.type = "button";

    btn.className = "search-mode-btn";

    btn.dataset.mode = mode.id;

    btn.textContent = mode.label || mode.id;

    btn.setAttribute("aria-pressed", mode.id === activeSearchMode ? "true" : "false");

    if (mode.id === activeSearchMode) {

      btn.classList.add("is-active");

    }

    btn.title = mode.description || "";

    btn.addEventListener("click", () => setSearchMode(mode.id));

    searchModeGroup.appendChild(btn);

  }

  updateSearchModeHint();

}



function setSearchMode(modeId) {

  activeSearchMode = modeId;

  for (const btn of searchModeGroup.querySelectorAll(".search-mode-btn")) {

    const on = btn.dataset.mode === modeId;

    btn.classList.toggle("is-active", on);

    btn.setAttribute("aria-pressed", on ? "true" : "false");

  }

  updateSearchModeHint();

}



function updateSearchModeHint() {

  if (!searchModeHint) return;

  const mode = searchModes.find((m) => m.id === activeSearchMode);

  searchModeHint.textContent = mode?.description || "";

}



function getSelectedSearchMode() {

  return activeSearchMode || "hybrid";

}



function setupSourceFilters() {

  if (!sourceFilterGroup) return;

  sourceFilterGroup.innerHTML = "";

  for (const src of informationSources) {

    const label = document.createElement("label");

    label.className = "source-filter-item";

    if (!src.enabled) {

      label.classList.add("is-disabled");

    }

    if (src.id === "snow_kb") {

      label.classList.add("source-filter-snow");

    }

    label.title = src.description || "";

    const input = document.createElement("input");

    input.type = "checkbox";

    input.name = "source";

    input.value = src.id;

    input.checked = Boolean(src.enabled);

    input.disabled = !src.enabled;

    if (input.checked) {

      label.classList.add("is-checked");

    }

    if (src.enabled) {

      input.addEventListener("change", () => {

        label.classList.toggle("is-checked", input.checked);

      });

    }

    const text = document.createElement("span");

    text.textContent = src.label || src.id;

    label.append(input, text);

    sourceFilterGroup.appendChild(label);

  }

}



function getSelectedSourcesParam() {

  if (!sourceFilterGroup) return "";

  const ids = [];

  for (const input of sourceFilterGroup.querySelectorAll(
    'input[type="checkbox"]:checked:not(:disabled)'
  )) {

    ids.push(input.value);

  }

  if (!ids.length) {
    for (const input of sourceFilterGroup.querySelectorAll(
      'input[type="checkbox"]:not(:disabled)'
    )) {
      ids.push(input.value);
    }
  }

  return ids.join(",");

}



searchForm.addEventListener("submit", async (e) => {

  e.preventDefault();

  const q = searchInput.value.trim();

  if (!q) return;

  const sources = getSelectedSourcesParam();

  resultsEl.innerHTML = "";

  setSearchStatus("Searching…");



  try {

    const mode = getSelectedSearchMode();

    const params = new URLSearchParams({ q, mode, sources });

    const data = await api(`/api/search?${params}`);

    lastSearchMode = data.search_mode || mode;
    lastSearchQuery = q;

    const modeLabel = data.search_mode_label || mode;

    const total = data.count || 0;

    setSearchStatus(

      total === 0

        ? `No matches for “${q}” (${modeLabel}). Try another mode or different words.`

        : `${total} match${total === 1 ? "" : "es"} · ${modeLabel} · ${data.article_count || 0} KB · ${data.manual_count || 0} MSI`

    );



    const results =

      data.results ||

      [...(data.articles || []), ...(data.manuals || [])].sort(

        (a, b) => (b.score || 0) - (a.score || 0)

      );



    for (const item of results) {

      resultsEl.appendChild(renderCard(item));

    }

    refreshPinButtons();

  } catch (err) {

    setSearchStatus(err.message);

  }

});



function refreshPinButtons(scopeEl) {

  if (!window.MotoSidebar) return;

  const root = scopeEl || resultsEl;

  if (!root) return;

  for (const card of root.querySelectorAll(".result-card")) {

    const raw = card.dataset.resultJson;

    if (!raw) continue;

    try {

      const item = JSON.parse(raw);

      const btn = card.querySelector(".btn-pin");

      if (btn) updatePinButton(btn, item);

      card.classList.toggle("is-pinned", window.MotoSidebar.isPinned(item));

    } catch {

      /* ignore */
    }

  }

}



function updatePinButton(btn, item) {

  const pinned = window.MotoSidebar.isPinned(item);

  btn.textContent = pinned ? "Unpin" : "Pin";

  btn.setAttribute("aria-pressed", pinned ? "true" : "false");

  btn.classList.toggle("is-pinned", pinned);

}



function sectionHeading(text) {

  const h = document.createElement("h2");

  h.className = "results-section";

  h.textContent = text;

  return h;

}



function createSimilarityMeter(similarity) {

  if (typeof similarity !== "number" || Number.isNaN(similarity)) {

    return null;

  }

  const pct = Math.round(Math.max(0, Math.min(1, similarity)) * 100);

  const wrap = document.createElement("div");

  wrap.className = "result-similarity";



  const label = document.createElement("span");

  label.className = "result-similarity-label";

  label.textContent = `${pct}% similar`;



  const track = document.createElement("div");

  track.className = "result-similarity-track";

  track.setAttribute("role", "meter");

  track.setAttribute("aria-valuenow", String(pct));

  track.setAttribute("aria-valuemin", "0");

  track.setAttribute("aria-valuemax", "100");

  track.setAttribute("aria-label", `Similarity ${pct} percent`);



  const fill = document.createElement("div");

  fill.className = "result-similarity-fill";

  fill.style.width = `${pct}%`;



  track.appendChild(fill);

  wrap.append(label, track);

  return wrap;

}



function formatScores(item) {

  const parts = [];

  if (typeof item.score === "number") {

    parts.push(`rank ${item.score.toFixed(2)}`);

  }

  if (lastSearchMode !== "semantic" && typeof item.fts_score === "number" && item.fts_score > 0) {

    parts.push(`text ${item.fts_score.toFixed(2)}`);

  }

  if (lastSearchMode === "semantic" && typeof item.vector_score === "number" && item.vector_score > 0) {

    parts.push(`semantic ${item.vector_score.toFixed(2)}`);

  }

  return parts.join(" · ");

}



function openLink(url) {

  if (url) {

    window.open(url, "_blank", "noopener,noreferrer");

  }

}



function isKbItem(item) {

  return item.source_type === "kb" || item.source === "m500-kb";

}



function createSourceBadge(item) {

  const kb = isKbItem(item);

  const badge = document.createElement("span");

  badge.className = kb ? "source-badge source-badge-kb" : "source-badge source-badge-msi";

  badge.textContent = item.source_label || (kb ? "KB" : "MSI Library");

  return badge;

}



function createTagList(tags) {

  const list = Array.isArray(tags) ? tags.filter(Boolean) : [];

  if (!list.length) {

    return null;

  }

  const wrap = document.createElement("div");

  wrap.className = "result-tags";

  for (const tag of list) {

    const chip = document.createElement("span");

    chip.className = "tag-chip";

    chip.textContent = tag;

    wrap.appendChild(chip);

  }

  return wrap;

}



function buildMetaParts(item) {

  const kb = isKbItem(item);

  const parts = [];

  if (kb && item.number) {

    parts.push(item.number);

  }

  if (item.product) {

    parts.push(item.product);

  }

  if (!kb) {

    if (item.is_chunk) {

      if (item.page_start) {

        parts.push(

          item.page_end && item.page_end !== item.page_start

            ? `pp. ${item.page_start}–${item.page_end}`

            : `p. ${item.page_start}`

        );

      } else if (item.chunk_index != null) {

        parts.push(`section ${item.chunk_index + 1}`);

      }

    }

    if (item.on_disk) {

      parts.push("PDF on disk");

    } else if (item.filename) {

      parts.push(`add ${item.filename} to msi-library/`);

    }

  }

  const scores = formatScores(item);

  if (scores) {

    parts.push(scores);

  }

  return parts;

}



function renderCard(item) {

  const card = document.createElement("article");

  card.className = "result-card";

  if (window.MotoSidebar?.isPinned(item)) {

    card.classList.add("is-pinned");

  }

  try {

    card.dataset.resultJson = JSON.stringify({
      doc_id: item.doc_id,
      id: item.id,
      number: item.number,
      title: item.title,
      snippet: item.snippet,
      url: item.url,
      permalink: item.permalink,
      source_type: item.source_type,
      source_label: item.source_label,
      filename: item.filename,
      page_start: item.page_start,
      page_end: item.page_end,
      on_disk: item.on_disk,
      tags: item.tags,
    });

  } catch {

    /* ignore */
  }

  const kb = isKbItem(item);



  const titleText = item.title || item.id || item.number || "Untitled";

  const linkUrl = kb

    ? item.url || item.permalink || null

    : item.on_disk

      ? item.url || null

      : null;

  const externalPermalink =

    kb && item.permalink && item.permalink !== item.url ? item.permalink : null;



  const header = document.createElement("div");

  header.className = "result-header";



  const titleEl = document.createElement("button");

  titleEl.type = "button";

  titleEl.className = "result-title-btn";

  if (lastSearchMode === "keyword" && lastSearchQuery) {
    titleEl.innerHTML = highlightKeywordMatches(titleText, lastSearchQuery);
  } else {
    titleEl.textContent = titleText;
  }

  titleEl.addEventListener("click", () => toggleExpand(card, item));

  header.appendChild(titleEl);



  const actions = document.createElement("div");

  actions.className = "result-actions";



  const expandBtn = document.createElement("button");

  expandBtn.type = "button";

  expandBtn.className = "btn btn-ghost btn-sm btn-expand";

  expandBtn.textContent = "Expand";

  expandBtn.addEventListener("click", () => toggleExpand(card, item));

  actions.appendChild(expandBtn);



  if (window.MotoSidebar) {

    const pinBtn = document.createElement("button");

    pinBtn.type = "button";

    pinBtn.className = "btn btn-ghost btn-sm btn-pin";

    updatePinButton(pinBtn, item);

    pinBtn.addEventListener("click", (e) => {

      e.stopPropagation();

      window.MotoSidebar.togglePin(item);

      updatePinButton(pinBtn, item);

      card.classList.toggle("is-pinned", window.MotoSidebar.isPinned(item));

    });

    actions.appendChild(pinBtn);

  }



  if (linkUrl) {

    const openBtn = document.createElement("button");

    openBtn.type = "button";

    openBtn.className = "btn btn-ghost btn-sm";

    openBtn.textContent = kb ? "Open KB" : item.on_disk ? "Open PDF" : "Open link";

    openBtn.addEventListener("click", () => openLink(linkUrl));

    actions.appendChild(openBtn);

  }



  if (externalPermalink) {

    const permBtn = document.createElement("button");

    permBtn.type = "button";

    permBtn.className = "btn btn-ghost btn-sm";

    permBtn.textContent = "Permalink";

    permBtn.addEventListener("click", () => openLink(externalPermalink));

    actions.appendChild(permBtn);

  }



  header.appendChild(actions);

  card.appendChild(header);



  const metaRow = document.createElement("div");

  metaRow.className = "result-meta-row";

  metaRow.appendChild(createSourceBadge(item));

  const metaParts = buildMetaParts(item);

  if (metaParts.length) {

    const meta = document.createElement("span");

    meta.className = "result-meta";

    meta.textContent = metaParts.join(" · ");

    metaRow.appendChild(meta);

  }

  card.appendChild(metaRow);



  const tagList = createTagList(item.tags);

  if (tagList) {

    card.appendChild(tagList);

  }



  if (lastSearchMode !== "keyword") {

    const similarityMeter = createSimilarityMeter(item.similarity);

    if (similarityMeter) {

      card.appendChild(similarityMeter);

    }

  }



  if (item.snippet) {

    const snippet = document.createElement("p");

    snippet.className = "result-snippet";

    if (lastSearchMode === "keyword" && lastSearchQuery) {
      snippet.innerHTML = highlightKeywordMatches(item.snippet, lastSearchQuery);
    } else {
      snippet.textContent = item.snippet;
    }

    card.appendChild(snippet);

  }



  const detail = document.createElement("div");

  detail.className = "result-detail hidden";

  detail.setAttribute("role", "region");

  detail.setAttribute("aria-label", "Full content");

  card.appendChild(detail);



  return card;

}



function resolveDocId(item) {
  if (item.doc_id) return item.doc_id;
  const num = (item.number || "").trim();
  if (/^KB\d{6,8}$/i.test(num)) return `article:${num.toUpperCase()}`;
  if (/^KB\d{6,8}$/i.test(String(item.id || ""))) {
    return `article:${String(item.id).toUpperCase()}`;
  }
  if (item.doc_type === "manual" || item.source_type === "msi_library") {
    const mid = item.id || item.number;
    if (mid) return `manual:${mid}`;
  }
  return `${item.doc_type || "article"}:${item.number || item.id}`;
}

async function toggleExpand(card, item) {

  const detail = card.querySelector(".result-detail");

  const expandBtn = card.querySelector(".btn-expand");

  const isExpanded = card.classList.contains("is-expanded");



  if (isExpanded) {

    card.classList.remove("is-expanded");

    detail.classList.add("hidden");

    if (expandBtn) expandBtn.textContent = "Expand";

    return;

  }



  if (!card.dataset.loaded) {

    detail.classList.remove("hidden");

    detail.innerHTML = '<p class="result-detail-loading">Loading…</p>';

    card.classList.add("is-expanded");

    if (expandBtn) expandBtn.textContent = "Collapse";



    try {

      const docId = resolveDocId(item);

      const full = await api(`/api/document/${encodeURIComponent(docId)}`);

      detail.innerHTML = renderDetail(full);

      card.dataset.loaded = "1";

    } catch (err) {

      detail.innerHTML = `<p class="result-detail-error">${escapeHtml(err.message)}</p>`;

    }

    return;

  }



  card.classList.add("is-expanded");

  detail.classList.remove("hidden");

  if (expandBtn) expandBtn.textContent = "Collapse";

}



function renderDetail(full) {

  const parts = [];



  if (full.summary) {

    parts.push(`<p class="result-detail-summary"><strong>Summary</strong> ${escapeHtml(full.summary)}</p>`);

  }



  if (full.tags && full.tags.length) {

    parts.push(

      `<p class="result-detail-tags"><strong>Tags</strong> ${escapeHtml(full.tags.join(", "))}</p>`

    );

  }



  const body = full.body || "";

  if (body) {

    parts.push(`<div class="result-detail-body">${escapeHtml(body)}</div>`);

  } else {

    parts.push('<p class="result-detail-empty">No full text available.</p>');

  }



  const links = [];

  if (full.url) {

    const label =
      full.doc_type === "article"
        ? "Open KB"
        : full.on_disk
          ? "Open PDF"
          : "Open";

    links.push(

      `<a href="${escapeHtml(full.url)}" target="_blank" rel="noopener noreferrer">${label}</a>`

    );

  }

  if (
    full.doc_type === "article" &&
    full.permalink &&
    full.permalink !== full.url
  ) {

    links.push(

      `<a href="${escapeHtml(full.permalink)}" target="_blank" rel="noopener noreferrer">Permalink</a>`

    );

  }

  if (links.length) {

    parts.push(`<p class="result-detail-links">${links.join(" · ")}</p>`);

  }



  return parts.join("");

}



function escapeHtml(str) {

  return String(str)

    .replace(/&/g, "&amp;")

    .replace(/</g, "&lt;")

    .replace(/>/g, "&gt;")

    .replace(/"/g, "&quot;");

}



function escapeRegExp(str) {

  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

}



function keywordHighlightTerms(query) {

  const tokens = String(query).match(/[\w][\w-]*/gu) || [];

  const seen = new Set();

  const terms = [];

  for (const token of tokens) {

    const key = token.toLowerCase();

    if (token.length < 2 || seen.has(key)) continue;

    seen.add(key);

    terms.push(token);

  }

  return terms.sort((a, b) => b.length - a.length);

}



function highlightKeywordMatches(text, query) {

  const raw = String(text ?? "");

  const terms = keywordHighlightTerms(query);

  if (!terms.length) return escapeHtml(raw);

  const pattern = terms.map((t) => escapeRegExp(t)).join("|");

  const re = new RegExp(`(${pattern})`, "gi");

  const parts = raw.split(re);

  return parts

    .map((part, index) => {

      if (!part) return "";

      if (index % 2 === 1) {

        return `<mark class="search-hit">${escapeHtml(part)}</mark>`;

      }

      return escapeHtml(part);

    })

    .join("");

}



window.MotoSearch = {
  renderCard,
  refreshPinButtons,
  getSearchOptions() {
    return {
      mode: getSelectedSearchMode(),
      sources: getSelectedSourcesParam(),
    };
  },
};

init();

