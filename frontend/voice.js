/**
 * Voice assist: browser speech recognition → Ollama query extraction → automated search.
 * Respects live search mode and source filters from the main search panel.
 */

const VOICE_STORAGE_KEY = "motoVoiceAssistEnabled";
const VOICE_LLM_STORAGE_KEY = "motoVoiceUseLlm";
const VOICE_MODEL_STORAGE_KEY = "motoOllamaModel";
const VOICE_HISTORY_VISIBLE_KEY = "motoVoiceHistoryVisible";
const CHUNK_INTERVAL_MS = 3000;
const MIN_CHUNK_CHARS = 10;
const MIN_SELECTION_CHARS = 3;
const FINAL_FLUSH_DELAY_MS = 900;
const MAX_TRANSCRIPT_HISTORY = 40;
function voiceApi(path, options) {
  if (window.MotoApi?.api) {
    return window.MotoApi.api(path, options);
  }
  const base = window.MotoApi?.base ?? "";
  return fetch(`${base}${path}`, options).then(async (res) => {
    const text = await res.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(res.statusText || "Request failed");
    }
    if (!res.ok) {
      let msg = body.detail || res.statusText;
      if (res.status === 404 && msg === "Not Found") {
        msg =
          "API not found — open http://127.0.0.1:8001/ and restart the backend.";
      }
      throw new Error(typeof msg === "string" ? msg : "Request failed");
    }
    return body;
  });
}

const voiceToggle = document.getElementById("voice-assist-toggle");
const voicePanel = document.getElementById("voice-assist-panel");
const listenBtn = document.getElementById("voice-listen-btn");
const searchNowBtn = document.getElementById("voice-search-now-btn");
const micStatusEl = document.getElementById("voice-mic-status");
const transcriptEl = document.getElementById("voice-transcript");
const voiceStatusEl = document.getElementById("voice-status");
const voiceResultsEl = document.getElementById("voice-results");
const ollamaHintEl = document.getElementById("voice-ollama-hint");
const ollamaRecheckBtn = document.getElementById("voice-ollama-recheck");
const voiceUseLlmCb = document.getElementById("voice-use-llm");
const voiceUseLlmWrap = document.getElementById("voice-use-llm-wrap");
const voiceModelSelect = document.getElementById("voice-ollama-model");
const voiceHistoryToggle = document.getElementById("voice-history-toggle");
const voiceHistoryPanel = document.getElementById("voice-transcript-history");
const voiceHistoryList = document.getElementById("voice-history-list");
const voiceSearchSelectionBtn = document.getElementById("voice-search-selection");

let recognition = null;
const transcriptHistory = [];
let listening = false;
let transcriptBuffer = "";
let interimText = "";
let chunkTimer = null;
let finalFlushTimer = null;
let processing = false;
let lastFlushedSegment = "";
const recentQueries = new Set();

function getSearchOptions() {
  if (window.MotoSearch?.getSearchOptions) {
    return window.MotoSearch.getSearchOptions();
  }
  return { mode: "hybrid", sources: "" };
}

function getUseLlm() {
  if (!voiceUseLlmCb) return false;
  return voiceUseLlmCb.checked && !voiceUseLlmCb.disabled;
}

function loadUseLlmPreference() {
  try {
    const stored = sessionStorage.getItem(VOICE_LLM_STORAGE_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    /* ignore */
  }
  return null;
}

function saveUseLlmPreference(on) {
  try {
    sessionStorage.setItem(VOICE_LLM_STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function getSelectedOllamaModel() {
  const fromSelect = voiceModelSelect?.value?.trim();
  if (fromSelect) return fromSelect;
  try {
    return sessionStorage.getItem(VOICE_MODEL_STORAGE_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

function saveOllamaModel(name) {
  try {
    if (name) sessionStorage.setItem(VOICE_MODEL_STORAGE_KEY, name);
    else sessionStorage.removeItem(VOICE_MODEL_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function populateOllamaModelSelect(models, configured, suggested, compliantModels) {
  if (!voiceModelSelect) return;
  const prev = getSelectedOllamaModel() || configured || "";
  voiceModelSelect.innerHTML = "";
  const compliant = Array.isArray(compliantModels) ? compliantModels : [];
  const names =
    compliant.length > 0
      ? [...compliant]
      : Array.isArray(models)
        ? [...models]
        : [];
  if (configured && !names.includes(configured)) {
    names.unshift(configured);
  }
  if (suggested && !names.includes(suggested)) {
    names.unshift(suggested);
  }
  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    voiceModelSelect.appendChild(opt);
  }
  const pick =
    (prev && names.includes(prev) && prev) ||
    (suggested && names.includes(suggested) && suggested) ||
    (configured && names.includes(configured) && configured) ||
    names[0] ||
    "";
  if (pick) {
    voiceModelSelect.value = pick;
    saveOllamaModel(pick);
  }
}

function syncUseLlmCheckbox(available, modelReady) {
  if (!voiceUseLlmCb) return;
  const canUseOllama = Boolean(available);

  voiceUseLlmCb.disabled = !canUseOllama;
  if (voiceUseLlmWrap) {
    voiceUseLlmWrap.classList.toggle("is-disabled", !canUseOllama);
    voiceUseLlmWrap.title = canUseOllama
      ? modelReady
        ? ""
        : "Ollama is up; pick your model from the list (must match `ollama list` exactly)."
      : "Start Ollama first (ollama serve or Ollama app).";
  }

  const pref = loadUseLlmPreference();
  if (pref !== null) {
    voiceUseLlmCb.checked = pref && canUseOllama;
  } else {
    voiceUseLlmCb.checked = canUseOllama && modelReady;
  }
}

function setVoicePanelVisible(on) {
  if (!voicePanel) return;
  voicePanel.classList.toggle("hidden", !on);
  voicePanel.hidden = !on;
  if (voiceToggle) voiceToggle.checked = on;
  try {
    sessionStorage.setItem(VOICE_STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  if (!on) {
    stopListening();
    setVoiceStatus("");
  }
}

function setMicStatus(text, listeningNow) {
  if (micStatusEl) {
    micStatusEl.textContent = text;
    micStatusEl.classList.toggle("is-listening", Boolean(listeningNow));
  }
}

function setVoiceStatus(msg, isError) {
  if (!voiceStatusEl) return;
  voiceStatusEl.textContent = msg || "";
  voiceStatusEl.classList.toggle("is-error", Boolean(isError));
  voiceStatusEl.classList.toggle("is-visible", Boolean(msg));
}

function updateTranscriptDisplay() {
  if (!transcriptEl) return;
  const full = (transcriptBuffer + " " + interimText).trim();
  transcriptEl.textContent = full || "Speak to describe the issue…";
}

function isHistoryVisible() {
  return voiceHistoryPanel && !voiceHistoryPanel.hidden;
}

function setHistoryVisible(on) {
  if (!voiceHistoryPanel || !voiceHistoryToggle) return;
  voiceHistoryPanel.classList.toggle("hidden", !on);
  voiceHistoryPanel.hidden = !on;
  voiceHistoryToggle.setAttribute("aria-expanded", on ? "true" : "false");
  voiceHistoryToggle.textContent = on ? "Hide history" : "Show history";
  try {
    sessionStorage.setItem(VOICE_HISTORY_VISIBLE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  if (on) renderTranscriptHistory();
}

function loadHistoryVisiblePreference() {
  try {
    return sessionStorage.getItem(VOICE_HISTORY_VISIBLE_KEY) === "1";
  } catch {
    return false;
  }
}

function recordTranscriptHistory(text, source = "auto") {
  const trimmed = String(text || "").trim();
  if (trimmed.length < MIN_CHUNK_CHARS) return;
  if (transcriptHistory.length && transcriptHistory[0].text === trimmed) return;
  transcriptHistory.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: trimmed,
    source,
    at: new Date().toLocaleTimeString(),
  });
  if (transcriptHistory.length > MAX_TRANSCRIPT_HISTORY) {
    transcriptHistory.length = MAX_TRANSCRIPT_HISTORY;
  }
  if (isHistoryVisible()) renderTranscriptHistory();
}

function renderTranscriptHistory() {
  if (!voiceHistoryList) return;
  voiceHistoryList.innerHTML = "";
  if (!transcriptHistory.length) {
    const empty = document.createElement("li");
    empty.className = "voice-history-empty";
    empty.textContent =
      "No past segments yet — they appear here after auto-search or Search now.";
    voiceHistoryList.appendChild(empty);
    return;
  }
  for (const entry of transcriptHistory) {
    const li = document.createElement("li");
    li.className = "voice-history-item";
    li.dataset.historyId = entry.id;

    const meta = document.createElement("div");
    meta.className = "voice-history-meta";
    const time = document.createElement("span");
    time.textContent = entry.at;
    const src = document.createElement("span");
    src.textContent = entry.source === "selection" ? "highlighted" : "auto";
    meta.append(time, src);

    const text = document.createElement("p");
    text.className = "voice-history-text";
    text.textContent = entry.text;

    li.append(meta, text);
    li.addEventListener("click", () => onHistoryItemClick(entry));
    voiceHistoryList.appendChild(li);
  }
}

function getSelectionInVoicePanel() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return "";
  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const el =
    node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!el || !voicePanel?.contains(el)) return "";
  return sel.toString().trim();
}

function updateSearchSelectionButton() {
  if (!voiceSearchSelectionBtn) return;
  const text = getSelectionInVoicePanel();
  const ok = text.length >= MIN_SELECTION_CHARS;
  voiceSearchSelectionBtn.disabled = !ok;
  voiceSearchSelectionBtn.classList.toggle("hidden", !ok);
  if (ok) {
    const preview =
      text.length > 48 ? `${text.slice(0, 48)}…` : text;
    voiceSearchSelectionBtn.title = `Search: ${preview}`;
  }
}

async function searchFromTranscript(text, options = {}) {
  const segment = String(text || "").trim();
  const minLen = options.fromSelection ? MIN_SELECTION_CHARS : MIN_CHUNK_CHARS;
  if (segment.length < minLen) {
    setVoiceStatus(
      `Highlight at least ${minLen} characters to search.`,
      true
    );
    return;
  }
  if (options.recordHistory !== false) {
    recordTranscriptHistory(
      segment,
      options.fromSelection ? "selection" : "manual"
    );
  }
  await processSegment(segment, {
    skipDedupe: Boolean(options.skipDedupe),
    fromSelection: Boolean(options.fromSelection),
  });
}

function onHistoryItemClick(entry) {
  const sel = getSelectionInVoicePanel();
  if (sel.length >= MIN_SELECTION_CHARS) return;
  for (const item of voiceHistoryList?.querySelectorAll(".voice-history-item") ||
    []) {
    item.classList.toggle("is-active", item.dataset.historyId === entry.id);
  }
  searchFromTranscript(entry.text, { skipDedupe: true, recordHistory: false });
}

async function onSearchSelectionClick() {
  const text = getSelectionInVoicePanel();
  if (text.length < MIN_SELECTION_CHARS) return;
  await searchFromTranscript(text, {
    fromSelection: true,
    skipDedupe: true,
    recordHistory: true,
  });
}

function speechSupported() {
  return Boolean(
    window.SpeechRecognition || window.webkitSpeechRecognition
  );
}

function createRecognition() {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";
  rec.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const piece = event.results[i][0]?.transcript || "";
      if (event.results[i].isFinal) {
        transcriptBuffer += (transcriptBuffer ? " " : "") + piece.trim();
        scheduleFlushAfterFinal();
      } else {
        interim += piece;
      }
    }
    interimText = interim.trim();
    updateTranscriptDisplay();
  };
  rec.onerror = (event) => {
    const code = event.error || "unknown";
    if (code === "no-speech" || code === "aborted") return;
    setVoiceStatus(`Speech recognition: ${code}`, true);
    if (code === "not-allowed") stopListening();
  };
  rec.onend = () => {
    if (listening) {
      try {
        recognition.start();
      } catch {
        stopListening();
      }
    }
  };
  return rec;
}

function startChunkTimer() {
  clearInterval(chunkTimer);
  chunkTimer = setInterval(() => flushTranscriptChunk(false), CHUNK_INTERVAL_MS);
}

function stopChunkTimer() {
  clearInterval(chunkTimer);
  chunkTimer = null;
}

function clearFinalFlushTimer() {
  clearTimeout(finalFlushTimer);
  finalFlushTimer = null;
}

function scheduleFlushAfterFinal() {
  clearFinalFlushTimer();
  finalFlushTimer = setTimeout(() => {
    flushTranscriptChunk(true);
  }, FINAL_FLUSH_DELAY_MS);
}

function currentTranscriptSegment() {
  return (transcriptBuffer + " " + interimText).trim();
}

async function flushTranscriptChunk(force) {
  const segment = currentTranscriptSegment();
  if (!segment || segment.length < MIN_CHUNK_CHARS) return;
  if (!force && segment === lastFlushedSegment) return;

  const toSend = segment;
  transcriptBuffer = "";
  interimText = "";
  lastFlushedSegment = toSend;
  updateTranscriptDisplay();
  recordTranscriptHistory(toSend, "auto");

  await processSegment(toSend);
}

async function processSegment(segment, options = {}) {
  if (processing || !segment || segment.length < MIN_CHUNK_CHARS) return;
  processing = true;
  setVoiceStatus("Extracting search queries…");

  const { mode, sources } = getSearchOptions();

  try {
    const data = await voiceApi("/api/voice/process-segment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript_segment: segment,
        mode,
        sources,
        max_queries: 2,
        limit_per_query: 8,
        use_llm: getUseLlm(),
        ollama_model: getSelectedOllamaModel() || undefined,
      }),
    });
    const bundles = data.bundles || [];
    const queries = data.queries || [];

    if (!queries.length) {
      setVoiceStatus(
        `No search queries extracted. Try "Search now" or say a product and symptom (e.g. M500 no power).`,
        true
      );
      return;
    }

    if (!window.MotoSearch?.renderCard) {
      setVoiceStatus("Search UI not ready — refresh the page.", true);
      return;
    }

    const src =
      data.intent_source === "ollama"
        ? "Ollama"
        : data.intent_source === "heuristic"
          ? "rule-based"
          : data.intent_source;
    let status = `Ran ${bundles.length} search(es) (${src}).`;
    if (data.ollama_error) {
      status += " Ollama call failed — used rule-based extraction.";
    }
    setVoiceStatus(status);

    let shown = 0;
    for (const bundle of bundles) {
      const qKey = bundle.query.toLowerCase();
      if (!options.skipDedupe && recentQueries.has(qKey)) continue;
      recentQueries.add(qKey);
      shown += 1;
      if (recentQueries.size > 40) {
        const first = recentQueries.values().next().value;
        recentQueries.delete(first);
      }
      prependVoiceBundle(bundle, data.search_mode_label);
    }
    if (!shown && bundles.length) {
      setVoiceStatus("Results already shown for that query — say something new or click Search now.");
    }
  } catch (e) {
    setVoiceStatus(e.message || "Voice search failed.", true);
  } finally {
    processing = false;
  }
}

function prependVoiceBundle(bundle, modeLabel) {
  if (!voiceResultsEl || !window.MotoSearch?.renderCard) return;

  const wrap = document.createElement("div");
  wrap.className = "voice-bundle";

  const head = document.createElement("div");
  head.className = "voice-bundle-head";
  const title = document.createElement("h3");
  title.className = "voice-bundle-query";
  title.textContent = bundle.query;
  head.appendChild(title);

  const meta = document.createElement("p");
  meta.className = "voice-bundle-meta";
  const parts = [];
  if (modeLabel) parts.push(modeLabel);
  parts.push(
    `${bundle.count || 0} result${bundle.count === 1 ? "" : "s"}`
  );
  meta.textContent = parts.join(" · ");
  head.appendChild(meta);
  wrap.appendChild(head);

  const list = document.createElement("div");
  list.className = "voice-bundle-results results";

  const results = bundle.results || [];
  if (!results.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No matches for this query with current filters.";
    list.appendChild(empty);
  } else {
    for (const item of results) {
      list.appendChild(window.MotoSearch.renderCard(item));
    }
    window.MotoSearch.refreshPinButtons(list);
  }

  wrap.appendChild(list);
  voiceResultsEl.prepend(wrap);
  const scrollEl = voiceResultsEl.closest(".voice-results-scroll");
  if (scrollEl) scrollEl.scrollTop = 0;
}

async function refreshOllamaHint() {
  if (!ollamaHintEl) return;
  if (ollamaRecheckBtn) ollamaRecheckBtn.disabled = true;
  try {
    const selected = getSelectedOllamaModel();
    const q = selected ? `?model=${encodeURIComponent(selected)}` : "";
    const data = await voiceApi(`/api/voice/status${q}`);
    const ready = data.model_ready === true || data.model_ready === "true";

    populateOllamaModelSelect(
      data.models || [],
      data.model,
      data.suggested_model,
      data.compliant_models
    );

    const hackathonNotice = document.getElementById("voice-hackathon-notice");
    if (hackathonNotice) {
      hackathonNotice.hidden = false;
    }

    const compliance = data.model_compliance;
    if (compliance && compliance.ok === false && Array.isArray(compliance.reasons)) {
      ollamaHintEl.textContent = compliance.reasons.join(" ");
      ollamaHintEl.classList.add("is-warn");
      syncUseLlmCheckbox(Boolean(data.available), false);
      if (ollamaRecheckBtn) ollamaRecheckBtn.classList.remove("hidden");
      return;
    }

    if (data.llm_disabled) {
      ollamaHintEl.textContent =
        data.hint || "LLM disabled — rule-based query extraction only.";
      ollamaHintEl.classList.add("is-warn");
      syncUseLlmCheckbox(false, false);
      if (ollamaRecheckBtn) ollamaRecheckBtn.classList.add("hidden");
    } else if (data.available && ready) {
      const active = getSelectedOllamaModel() || data.model;
      ollamaHintEl.textContent = `Ollama ready — model: ${active} (${data.base_url || "localhost"})`;
      ollamaHintEl.classList.remove("is-warn");
      saveUseLlmPreference(true);
      syncUseLlmCheckbox(true, true);
      if (voiceUseLlmCb) voiceUseLlmCb.checked = true;
      if (ollamaRecheckBtn) ollamaRecheckBtn.classList.add("hidden");
    } else if (data.available) {
      ollamaHintEl.textContent =
        data.hint ||
        `Ollama is up. Pick the exact name from \`ollama list\` in the dropdown, then enable query extraction.`;
      ollamaHintEl.classList.add("is-warn");
      syncUseLlmCheckbox(true, false);
      if (ollamaRecheckBtn) ollamaRecheckBtn.classList.remove("hidden");
    } else {
      ollamaHintEl.textContent =
        data.hint || "Ollama not reachable — start Ollama, then Recheck.";
      ollamaHintEl.classList.add("is-warn");
      syncUseLlmCheckbox(false, false);
      if (ollamaRecheckBtn) ollamaRecheckBtn.classList.remove("hidden");
    }
  } catch {
    ollamaHintEl.textContent =
      "Could not reach the app API — is the backend running on port 8001?";
    ollamaHintEl.classList.add("is-warn");
    if (ollamaRecheckBtn) ollamaRecheckBtn.classList.remove("hidden");
  } finally {
    if (ollamaRecheckBtn) ollamaRecheckBtn.disabled = false;
  }
}

function startListening() {
  if (!speechSupported()) {
    setVoiceStatus(
      "Speech recognition is not supported in this browser (try Chrome or Edge).",
      true
    );
    return;
  }
  if (!recognition) recognition = createRecognition();
  if (!recognition) return;

  listening = true;
  transcriptBuffer = "";
  interimText = "";
  lastFlushedSegment = "";
  clearFinalFlushTimer();
  updateTranscriptDisplay();
  setMicStatus("Listening…", true);
  if (listenBtn) listenBtn.textContent = "Stop listening";
  const modeNote = getUseLlm()
    ? "Ollama enabled for queries."
    : "Rule-based query extraction (no Ollama).";
  setVoiceStatus(`Listening — ${modeNote} Change search mode or sources anytime.`);

  try {
    recognition.start();
  } catch {
  }
  startChunkTimer();
}

async function stopListening() {
  listening = false;
  stopChunkTimer();
  clearFinalFlushTimer();
  if (recognition) {
    try {
      recognition.stop();
    } catch {
      /* ignore */
    }
  }
  await flushTranscriptChunk(true);
  setMicStatus("Off", false);
  if (listenBtn) listenBtn.textContent = "Start listening";
}

async function onSearchNowClick() {
  clearFinalFlushTimer();
  const segment = currentTranscriptSegment();
  if (!segment || segment.length < MIN_CHUNK_CHARS) {
    setVoiceStatus("Say or type more in the transcript first (e.g. M500 no power).", true);
    return;
  }
  lastFlushedSegment = "";
  recordTranscriptHistory(segment, "manual");
  await processSegment(segment, { skipDedupe: true });
}

function onListenClick() {
  if (listening) stopListening();
  else startListening();
}

function initVoiceAssist() {
  let enabled = false;
  try {
    enabled = sessionStorage.getItem(VOICE_STORAGE_KEY) === "1";
  } catch {
    enabled = false;
  }

  setVoicePanelVisible(enabled);

  if (voiceToggle) {
    voiceToggle.addEventListener("change", () => {
      setVoicePanelVisible(voiceToggle.checked);
      if (voiceToggle.checked) refreshOllamaHint();
    });
  }

  if (listenBtn) {
    listenBtn.addEventListener("click", onListenClick);
  }

  if (searchNowBtn) {
    searchNowBtn.addEventListener("click", () => onSearchNowClick());
  }

  if (ollamaRecheckBtn) {
    ollamaRecheckBtn.addEventListener("click", () => refreshOllamaHint());
  }

  if (voiceUseLlmCb) {
    voiceUseLlmCb.addEventListener("change", () => {
      saveUseLlmPreference(voiceUseLlmCb.checked);
    });
  }

  if (voiceModelSelect) {
    voiceModelSelect.addEventListener("change", () => {
      saveOllamaModel(voiceModelSelect.value);
      refreshOllamaHint();
    });
  }

  if (voiceHistoryToggle) {
    setHistoryVisible(loadHistoryVisiblePreference());
    voiceHistoryToggle.addEventListener("click", () => {
      setHistoryVisible(!isHistoryVisible());
    });
  }

  if (voiceSearchSelectionBtn) {
    voiceSearchSelectionBtn.addEventListener("click", onSearchSelectionClick);
  }

  document.addEventListener("selectionchange", updateSearchSelectionButton);

  if (enabled) refreshOllamaHint();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initVoiceAssist);
} else {
  initVoiceAssist();
}
