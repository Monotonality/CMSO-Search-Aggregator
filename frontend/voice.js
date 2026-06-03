/**
 * Voice assist: browser speech recognition → Ollama query extraction → automated search.
 * Respects live search mode and source filters from the main search panel.
 */

const VOICE_STORAGE_KEY = "motoVoiceAssistEnabled";
const VOICE_LLM_STORAGE_KEY = "motoVoiceUseLlm";
const CHUNK_INTERVAL_MS = 3000;
const MIN_CHUNK_CHARS = 10;
const FINAL_FLUSH_DELAY_MS = 900;
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

let recognition = null;
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

function syncUseLlmCheckbox(ready, modelPulled) {
  if (!voiceUseLlmCb) return;
  const canUseOllama = ready && modelPulled !== false;

  voiceUseLlmCb.disabled = !canUseOllama;
  if (voiceUseLlmWrap) {
    voiceUseLlmWrap.classList.toggle("is-disabled", !canUseOllama);
    voiceUseLlmWrap.title = canUseOllama
      ? ""
      : "Ollama is not ready. Model pulls are blocked on many corporate networks — use rule-based extraction instead.";
  }

  const pref = loadUseLlmPreference();
  if (pref !== null) {
    voiceUseLlmCb.checked = pref && canUseOllama;
  } else {
    voiceUseLlmCb.checked = canUseOllama;
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

  await processSegment(toSend);
}

async function processSegment(segment) {
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
      if (recentQueries.has(qKey)) continue;
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
}

async function refreshOllamaHint() {
  if (!ollamaHintEl) return;
  if (ollamaRecheckBtn) ollamaRecheckBtn.disabled = true;
  try {
    const data = await voiceApi("/api/voice/status");
    const corpBlockNote =
      "Model downloads use cloudflarestorage.com — often blocked on corporate Wi‑Fi. " +
      "Use rule-based extraction (checkbox off), phone hotspot to pull tinyllama, " +
      "or copy %USERPROFILE%\\.ollama\\models from a home PC.";

    if (data.llm_disabled) {
      ollamaHintEl.textContent =
        data.hint || "LLM disabled — rule-based query extraction only.";
      ollamaHintEl.classList.add("is-warn");
      syncUseLlmCheckbox(false, false);
      if (ollamaRecheckBtn) ollamaRecheckBtn.classList.add("hidden");
    } else if (data.available && data.model_pulled !== false) {
      ollamaHintEl.textContent = `Local LLM: ${data.model} (Ollama at ${data.base_url || "localhost"})`;
      ollamaHintEl.classList.remove("is-warn");
      syncUseLlmCheckbox(true, true);
      if (ollamaRecheckBtn) ollamaRecheckBtn.classList.add("hidden");
    } else if (data.available && data.model_pulled === false) {
      ollamaHintEl.textContent =
        (data.hint || `Pull failed? Try: ollama pull ${data.model}`) +
        " " +
        corpBlockNote;
      ollamaHintEl.classList.add("is-warn");
      syncUseLlmCheckbox(true, false);
      if (ollamaRecheckBtn) ollamaRecheckBtn.classList.remove("hidden");
    } else {
      ollamaHintEl.textContent = `Ollama not reachable. ${corpBlockNote}`;
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
  await flushTranscriptChunk(true);
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

  if (enabled) refreshOllamaHint();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initVoiceAssist);
} else {
  initVoiceAssist();
}
