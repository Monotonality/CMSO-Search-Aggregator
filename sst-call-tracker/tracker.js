/**
 * SST Call Time Tracker — segment live calls by activity (standalone tool).
 */
(function () {
  const THEME_KEY = "sst_call_tracker_theme_v1";
  const SESSION_KEY = "sst_call_tracker_session_v1";

  const ACTIVITIES = [
    { id: "instructing", label: "Instructing customer" },
    { id: "searching", label: "Searching for information" },
    { id: "writing_ticket", label: "Writing ticket information" },
    { id: "copy_paste", label: "Copy / pasting information" },
    { id: "switching_tabs", label: "Switching tabs / apps" },
    { id: "thinking", label: "Thinking / pausing" },
    { id: "asking_help", label: "Asking for help" },
    { id: "waiting_customer", label: "Waiting for customer" },
    { id: "questioning_customer", label: "Questioning customer for details" },
    { id: "on_hold", label: "On hold / queue" },
    { id: "reading_kb", label: "Reading KB / manual" },
    { id: "testing_device", label: "Testing / verifying device" },
    { id: "wrap_up", label: "Wrap-up / closing call" },
  ];

  const themeSelect = document.getElementById("theme-select");
  const sessionLabelInput = document.getElementById("session-label");
  const elapsedDisplay = document.getElementById("elapsed-display");
  const currentActivityLabel = document.getElementById("current-activity-label");
  const activityButtonsEl = document.getElementById("activity-buttons");
  const customActivityInput = document.getElementById("custom-activity-input");
  const btnStart = document.getElementById("btn-start");
  const btnStop = document.getElementById("btn-stop");
  const btnReset = document.getElementById("btn-reset");
  const btnCustom = document.getElementById("btn-custom-activity");
  const btnExport = document.getElementById("btn-export");
  const btnDownloadTxt = document.getElementById("btn-download-txt");
  const btnDownloadCsv = document.getElementById("btn-download-csv");
  const sessionStatus = document.getElementById("session-status");
  const summaryTbody = document.getElementById("summary-tbody");
  const summaryBars = document.getElementById("summary-bars");
  const pieChartWrap = document.getElementById("pie-chart-wrap");
  const pieSlices = document.getElementById("pie-slices");
  const pieLegend = document.getElementById("pie-legend");
  const timelinePanel = document.getElementById("timeline-panel");
  const timelineWrap = document.getElementById("timeline-wrap");
  const timelineTrack = document.getElementById("timeline-track");
  const timelineAxis = document.getElementById("timeline-axis");
  const timelineList = document.getElementById("timeline-list");
  const timelineStartLabel = document.getElementById("timeline-start-label");
  const timelineEndLabel = document.getElementById("timeline-end-label");
  const PIE_COLORS = [
    "#3d8fd4",
    "#e87b35",
    "#3d9a6a",
    "#c9a227",
    "#9b7ddb",
    "#e85d75",
    "#2ec4e8",
    "#84cc16",
    "#f472b6",
    "#a78bfa",
    "#fb923c",
    "#14b8a6",
    "#64748b",
  ];

  let running = false;
  let sessionStartMs = 0;
  let tickTimer = null;
  let currentActivityId = null;
  let currentSegmentStartMs = 0;
  /** @type {{ id: string, label: string, startMs: number, endMs: number | null }[]} */
  let segments = [];

  function formatDuration(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function formatClock(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function now() {
    return Date.now();
  }

  function getActivityLabel(id) {
    const found = ACTIVITIES.find((a) => a.id === id);
    if (found) return found.label;
    if (id && id.startsWith("custom:")) {
      return id.slice(7) || "Custom";
    }
    return id || "Unknown";
  }

  function setStatus(msg, ok) {
    if (!sessionStatus) return;
    sessionStatus.textContent = msg || "";
    sessionStatus.classList.toggle("is-ok", Boolean(ok));
  }

  function applyTheme(pref) {
    let resolved = pref;
    if (pref === "system") {
      resolved = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    document.documentElement.setAttribute("data-theme", resolved);
    try {
      localStorage.setItem(THEME_KEY, pref);
    } catch {
      /* ignore */
    }
  }

  function initTheme() {
    let pref = "dark";
    try {
      const s = localStorage.getItem(THEME_KEY);
      if (s) pref = s;
    } catch {
      /* ignore */
    }
    if (themeSelect) themeSelect.value = pref;
    applyTheme(pref);
    themeSelect?.addEventListener("change", () => applyTheme(themeSelect.value));
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (themeSelect?.value === "system") applyTheme("system");
    });
  }

  function saveSession() {
    try {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          running,
          sessionStartMs,
          currentActivityId,
          currentSegmentStartMs,
          segments,
          label: sessionLabelInput?.value || "",
        })
      );
    } catch {
      /* ignore */
    }
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.segments)) return;
      segments = data.segments;
      sessionStartMs = data.sessionStartMs || 0;
      currentActivityId = data.currentActivityId;
      currentSegmentStartMs = data.currentSegmentStartMs || 0;
      running = Boolean(data.running);
      if (sessionLabelInput && data.label) sessionLabelInput.value = data.label;
      if (running && sessionStartMs) {
        setUiRunning(true);
        startTick();
        updateCurrentLabel();
        highlightActiveButton();
      }
    } catch {
      /* ignore */
    }
  }

  function setUiRunning(isRunning) {
    running = isRunning;
    if (btnStart) {
      btnStart.disabled = isRunning;
      btnStart.textContent = isRunning ? "Session running" : "Start session";
    }
    if (btnStop) btnStop.disabled = !isRunning;
    if (btnReset) btnReset.disabled = isRunning;
    if (customActivityInput) customActivityInput.disabled = !isRunning;
    if (btnCustom) btnCustom.disabled = !isRunning;
    document.querySelectorAll(".ct-activity-btn").forEach((btn) => {
      btn.disabled = !isRunning;
    });
    setExportButtonsEnabled(segments.length > 0);
  }

  function setExportButtonsEnabled(enabled) {
    if (btnExport) btnExport.disabled = !enabled;
    if (btnDownloadTxt) btnDownloadTxt.disabled = !enabled;
    if (btnDownloadCsv) btnDownloadCsv.disabled = !enabled;
  }

  function closeCurrentSegment(endMs) {
    if (!currentActivityId || !currentSegmentStartMs) return;
    const open = segments.find(
      (s) => s.id === currentActivityId && s.endMs == null
    );
    if (open) {
      open.endMs = endMs;
    } else {
      segments.push({
        id: currentActivityId,
        label: getActivityLabel(currentActivityId),
        startMs: currentSegmentStartMs,
        endMs: endMs,
      });
    }
  }

  function markActivity(activityId) {
    if (!running) return;
    const t = now();
    if (currentActivityId && currentActivityId !== activityId) {
      closeCurrentSegment(t);
    }
    if (currentActivityId !== activityId) {
      currentActivityId = activityId;
      currentSegmentStartMs = t;
      segments.push({
        id: activityId,
        label: getActivityLabel(activityId),
        startMs: t,
        endMs: null,
      });
      setStatus(`Marked: ${getActivityLabel(activityId)}`, true);
    }
    updateCurrentLabel();
    highlightActiveButton();
    renderAll();
    saveSession();
  }

  function startSession() {
    const t = now();
    sessionStartMs = t;
    segments = [];
    currentActivityId = null;
    currentSegmentStartMs = 0;
    setUiRunning(true);
    setStatus("Session started. Click an activity when work changes.", true);
    updateElapsed();
    startTick();
    saveSession();
    renderAll();
  }

  function endSession() {
    if (!running) return;
    const t = now();
    closeCurrentSegment(t);
    currentActivityId = null;
    currentSegmentStartMs = 0;
    stopTick();
    setUiRunning(false);
    updateCurrentLabel();
    highlightActiveButton();
    setStatus("Session ended. Review breakdown below.", true);
    saveSession();
    renderAll();
  }

  function resetSession() {
    if (running) return;
    sessionStartMs = 0;
    segments = [];
    currentActivityId = null;
    currentSegmentStartMs = 0;
    if (elapsedDisplay) elapsedDisplay.textContent = "00:00:00";
    if (currentActivityLabel) currentActivityLabel.textContent = "Not started";
    setStatus("Reset.", true);
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    highlightActiveButton();
    renderAll();
    setExportButtonsEnabled(false);
  }

  function startTick() {
    stopTick();
    tickTimer = setInterval(() => {
      updateElapsed();
      renderSummary();
      renderActivityButtonTimes();
    }, 1000);
  }

  function stopTick() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
  }

  function updateElapsed() {
    if (!elapsedDisplay) return;
    if (!sessionStartMs) {
      elapsedDisplay.textContent = "00:00:00";
      return;
    }
    const end = running ? now() : getLastEndMs();
    elapsedDisplay.textContent = formatClock(end - sessionStartMs);
  }

  function getLastEndMs() {
    let max = sessionStartMs;
    for (const s of segments) {
      const end = s.endMs != null ? s.endMs : now();
      if (end > max) max = end;
    }
    return max;
  }

  function getClosedSegments() {
    const t = now();
    return segments
      .filter((s) => s.endMs != null)
      .map((s) => ({
        id: s.id,
        label: s.label || getActivityLabel(s.id),
        durationMs: s.endMs - s.startMs,
      }));
  }

  function getLiveSegmentExtra() {
    if (!running || !currentActivityId || !currentSegmentStartMs) return null;
    return {
      id: currentActivityId,
      label: getActivityLabel(currentActivityId),
      durationMs: now() - currentSegmentStartMs,
    };
  }

  function aggregateByActivity() {
    const totals = new Map();
    for (const s of getClosedSegments()) {
      totals.set(s.id, {
        id: s.id,
        label: s.label,
        durationMs: (totals.get(s.id)?.durationMs || 0) + s.durationMs,
      });
    }
    const live = getLiveSegmentExtra();
    if (live) {
      const prev = totals.get(live.id);
      totals.set(live.id, {
        id: live.id,
        label: live.label,
        durationMs: (prev?.durationMs || 0) + live.durationMs,
      });
    }
    return [...totals.values()].sort((a, b) => b.durationMs - a.durationMs);
  }

  function getTotalTrackedMs() {
    const agg = aggregateByActivity();
    return agg.reduce((sum, a) => sum + a.durationMs, 0);
  }

  function updateCurrentLabel() {
    if (!currentActivityLabel) return;
    if (!running) {
      currentActivityLabel.textContent =
        segments.length > 0 ? "Session ended" : "Not started";
      return;
    }
    currentActivityLabel.textContent = currentActivityId
      ? getActivityLabel(currentActivityId)
      : "Pick an activity";
  }

  function highlightActiveButton() {
    document.querySelectorAll(".ct-activity-btn").forEach((btn) => {
      const id = btn.dataset.activityId;
      btn.classList.toggle("is-active", running && id === currentActivityId);
    });
  }

  function renderActivityButtons() {
    if (!activityButtonsEl) return;
    activityButtonsEl.innerHTML = "";
    for (const act of ACTIVITIES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ct-activity-btn";
      btn.dataset.activityId = act.id;
      btn.disabled = true;
      btn.innerHTML = `${act.label}<span class="ct-activity-time" data-time-for="${act.id}">0:00</span>`;
      btn.addEventListener("click", () => markActivity(act.id));
      activityButtonsEl.appendChild(btn);
    }
  }

  function renderActivityButtonTimes() {
    const totals = aggregateByActivity();
    const byId = new Map(totals.map((t) => [t.id, t.durationMs]));
    document.querySelectorAll(".ct-activity-time").forEach((el) => {
      const id = el.dataset.timeFor;
      const ms = byId.get(id) || 0;
      el.textContent = formatDuration(ms);
    });
  }

  function activityColorIndex(activityId) {
    const i = ACTIVITIES.findIndex((a) => a.id === activityId);
    if (i >= 0) return i;
    if (activityId && activityId.startsWith("custom:")) {
      let h = 0;
      for (let c = 0; c < activityId.length; c += 1) {
        h = (h * 31 + activityId.charCodeAt(c)) | 0;
      }
      return ACTIVITIES.length + (Math.abs(h) % 5);
    }
    return ACTIVITIES.length;
  }

  function colorForActivity(activityId) {
    return PIE_COLORS[activityColorIndex(activityId) % PIE_COLORS.length];
  }

  function formatTimeOfDay(ms) {
    return new Date(ms).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function getTimelineSpan() {
    if (!sessionStartMs) {
      return { start: 0, end: 0, span: 1 };
    }
    let end = sessionStartMs;
    for (const s of segments) {
      const e = s.endMs != null ? s.endMs : running ? now() : s.startMs;
      if (e > end) end = e;
    }
    if (running) end = Math.max(end, now());
    return {
      start: sessionStartMs,
      end,
      span: Math.max(end - sessionStartMs, 1),
    };
  }

  function getOrderedTimelineSegments() {
    return [...segments]
      .map((s) => ({
        ...s,
        label: s.label || getActivityLabel(s.id),
        endMs: s.endMs != null ? s.endMs : running ? now() : s.startMs,
      }))
      .filter((s) => s.endMs > s.startMs)
      .sort((a, b) => a.startMs - b.startMs);
  }

  function renderTimeline() {
    if (!timelinePanel || !timelineWrap || !timelineTrack) return;

    const ordered = getOrderedTimelineSegments();
    if (!sessionStartMs || ordered.length === 0) {
      timelinePanel.hidden = true;
      timelineTrack.innerHTML = "";
      if (timelineList) timelineList.innerHTML = "";
      if (timelineAxis) timelineAxis.innerHTML = "";
      return;
    }

    const { start, end, span } = getTimelineSpan();
    timelinePanel.hidden = false;

    if (timelineStartLabel) {
      timelineStartLabel.textContent = `Start ${formatTimeOfDay(start)}`;
    }
    if (timelineEndLabel) {
      timelineEndLabel.textContent = running
        ? `Now ${formatTimeOfDay(now())}`
        : `End ${formatTimeOfDay(end)}`;
    }

    timelineTrack.innerHTML = "";
    let cursor = start;

    const addSeg = (widthPct, color, className, title, ariaLabel, isLive) => {
      if (widthPct <= 0) return;
      const el = document.createElement("div");
      el.className = `ct-timeline-seg${className ? ` ${className}` : ""}${isLive ? " is-live" : ""}`;
      el.style.width = `${widthPct}%`;
      if (color) el.style.background = color;
      el.title = title;
      el.setAttribute("role", "listitem");
      el.setAttribute("aria-label", ariaLabel);
      timelineTrack.appendChild(el);
    };

    for (const seg of ordered) {
      if (seg.startMs > cursor) {
        const gapPct = ((seg.startMs - cursor) / span) * 100;
        addSeg(
          gapPct,
          "",
          "is-gap",
          "Unmarked time",
          `Unmarked: ${formatDuration(seg.startMs - cursor)}`,
          false
        );
        cursor = seg.startMs;
      }

      const dur = seg.endMs - seg.startMs;
      const widthPct = (dur / span) * 100;
      const color = colorForActivity(seg.id);
      const isLive =
        running &&
        seg.id === currentActivityId &&
        segments.some(
          (s) => s.id === seg.id && s.startMs === seg.startMs && s.endMs == null
        );
      addSeg(
        widthPct,
        color,
        "",
        `${seg.label}\n${formatTimeOfDay(seg.startMs)} to ${formatTimeOfDay(seg.endMs)}\n${formatDuration(dur)}`,
        `${seg.label}: ${formatDuration(dur)}`,
        isLive
      );
      cursor = seg.endMs;
    }

    if (cursor < end) {
      const tailPct = ((end - cursor) / span) * 100;
      addSeg(
        tailPct,
        "",
        "is-gap",
        running ? "Session open" : "Unmarked time",
        running ? "Session in progress" : `Unmarked: ${formatDuration(end - cursor)}`,
        false
      );
    }

    if (timelineAxis) {
      const mid = start + span / 2;
      timelineAxis.innerHTML = `
        <span>0:00</span>
        <span>${formatDuration(span / 2)}</span>
        <span>${formatDuration(span)}</span>`;
      void mid;
    }

    if (timelineList) {
      timelineList.innerHTML = "";
      ordered.forEach((seg) => {
        const dur = seg.endMs - seg.startMs;
        const color = colorForActivity(seg.id);
        const li = document.createElement("li");
        li.innerHTML = `<span class="ct-pie-swatch" style="background:${color}"></span>
          <span class="ct-timeline-list-time">${formatTimeOfDay(seg.startMs)}</span>
          <span class="ct-timeline-list-label" title="${seg.label}">${seg.label}</span>
          <span class="ct-timeline-list-dur">${formatDuration(dur)}</span>`;
        timelineList.appendChild(li);
      });
    }
  }

  function pieSlicePath(startAngle, endAngle, radius) {
    const x1 = radius * Math.cos(startAngle);
    const y1 = radius * Math.sin(startAngle);
    const x2 = radius * Math.cos(endAngle);
    const y2 = radius * Math.sin(endAngle);
    const large = endAngle - startAngle > Math.PI ? 1 : 0;
    return `M 0 0 L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
  }

  function renderPieChart(agg, total) {
    if (!pieChartWrap || !pieSlices || !pieLegend) return;

    if (!agg.length || total <= 0) {
      pieChartWrap.hidden = true;
      pieSlices.innerHTML = "";
      pieLegend.innerHTML = "";
      return;
    }

    pieChartWrap.hidden = false;
    pieSlices.innerHTML = "";
    pieLegend.innerHTML = "";

    const radius = 88;
    let angle = -Math.PI / 2;

    agg.forEach((row) => {
      const slice = (row.durationMs / total) * Math.PI * 2;
      if (slice <= 0) return;
      const end = angle + slice;
      const color = colorForActivity(row.id);
      const pct = ((row.durationMs / total) * 100).toFixed(1);

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pieSlicePath(angle, end, radius));
      path.setAttribute("fill", color);
      path.setAttribute("class", "ct-pie-slice");
      path.setAttribute(
        "aria-label",
        `${row.label}: ${formatDuration(row.durationMs)}, ${pct}%`
      );
      pieSlices.appendChild(path);

      const li = document.createElement("li");
      li.innerHTML = `<span class="ct-pie-swatch" style="background:${color}"></span>
        <span class="ct-pie-legend-label" title="${row.label}">${row.label}</span>
        <span class="ct-pie-legend-pct">${pct}%</span>`;
      pieLegend.appendChild(li);

      angle = end;
    });

    if (agg.length === 1) {
      const row = agg[0];
      const color = colorForActivity(row.id);
      pieSlices.innerHTML = "";
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("r", String(radius));
      circle.setAttribute("fill", color);
      circle.setAttribute("class", "ct-pie-slice");
      circle.setAttribute(
        "aria-label",
        `${row.label}: ${formatDuration(row.durationMs)}, 100%`
      );
      pieSlices.appendChild(circle);
    }
  }

  function renderSummary() {
    const agg = aggregateByActivity();
    const total = getTotalTrackedMs() || 1;

    renderPieChart(agg, total);
    renderTimeline();

    if (summaryBars) {
      summaryBars.innerHTML = "";
      for (const row of agg) {
        const pct = (row.durationMs / total) * 100;
        const div = document.createElement("div");
        div.className = "ct-bar-row";
        div.innerHTML = `
          <span class="ct-bar-label" title="${row.label}">${row.label}</span>
          <div class="ct-bar-track"><div class="ct-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
          <span class="ct-bar-pct">${pct.toFixed(0)}%</span>`;
        summaryBars.appendChild(div);
      }
    }

    if (summaryTbody) {
      summaryTbody.innerHTML = "";
      for (const row of agg) {
        const pct = (row.durationMs / total) * 100;
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${row.label}</td>
          <td>${formatDuration(row.durationMs)}</td>
          <td>${pct.toFixed(1)}%</td>`;
        summaryTbody.appendChild(tr);
      }
    }
  }

  function buildReport() {
    const label = sessionLabelInput?.value?.trim() || "SST call session";
    const agg = aggregateByActivity();
    const total = getTotalTrackedMs();
    const lines = [
      "SST Call Time Tracker Report",
      `Session: ${label}`,
      `Generated: ${new Date().toLocaleString()}`,
      `Total tracked: ${formatDuration(total)}`,
      "",
      "Time by activity:",
    ];
    for (const row of agg) {
      const pct = total ? ((row.durationMs / total) * 100).toFixed(1) : "0";
      lines.push(`  ${row.label}: ${formatDuration(row.durationMs)} (${pct}%)`);
    }
    lines.push("", "Segment log:");
    segments
      .filter((s) => s.endMs != null)
      .forEach((s, i) => {
        lines.push(
          `  ${i + 1}. ${s.label}: ${formatDuration(s.endMs - s.startMs)}`
        );
      });
    if (running && currentActivityId) {
      lines.push(
        `  (in progress) ${getActivityLabel(currentActivityId)} — ${formatDuration(now() - currentSegmentStartMs)}`
      );
    }
    return lines.join("\n");
  }

  function sessionSlug() {
    const label = sessionLabelInput?.value?.trim() || "call-session";
    return label.replace(/[^\w-]+/g, "_").slice(0, 40) || "call-session";
  }

  function fileStamp() {
    return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function csvCell(value) {
    const s = String(value ?? "");
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  function buildCsv() {
    const label = sessionLabelInput?.value?.trim() || "SST call session";
    const agg = aggregateByActivity();
    const total = getTotalTrackedMs();
    const rows = [];

    rows.push("SST Call Time Tracker Export");
    rows.push(["session_label", label].map(csvCell).join(","));
    rows.push(["generated", new Date().toISOString()].map(csvCell).join(","));
    rows.push(
      ["total_tracked_ms", total, "total_tracked_display", formatDuration(total)]
        .map(csvCell)
        .join(",")
    );
    rows.push(["session_running", running ? "yes" : "no"].map(csvCell).join(","));
    rows.push("");

    rows.push(
      ["activity", "duration_ms", "duration_display", "percent"].map(csvCell).join(",")
    );
    for (const row of agg) {
      const pct = total ? ((row.durationMs / total) * 100).toFixed(2) : "0";
      rows.push(
        [row.label, row.durationMs, formatDuration(row.durationMs), pct]
          .map(csvCell)
          .join(",")
      );
    }
    rows.push("");

    rows.push(
      [
        "segment_index",
        "activity",
        "start_iso",
        "end_iso",
        "duration_ms",
        "duration_display",
      ]
        .map(csvCell)
        .join(",")
    );
    let idx = 0;
    for (const s of segments) {
      if (s.endMs == null && !running) continue;
      const endMs = s.endMs != null ? s.endMs : now();
      idx += 1;
      rows.push(
        [
          idx,
          s.label || getActivityLabel(s.id),
          new Date(s.startMs).toISOString(),
          s.endMs != null ? new Date(s.endMs).toISOString() : "",
          endMs - s.startMs,
          formatDuration(endMs - s.startMs),
        ]
          .map(csvCell)
          .join(",")
      );
    }

    return rows.join("\r\n") + "\r\n";
  }

  async function copyReport() {
    const text = buildReport();
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Report copied to clipboard.", true);
    } catch {
      setStatus("Copy failed.", false);
    }
  }

  function downloadReportTxt() {
    const filename = `sst-call-tracker-${sessionSlug()}-${fileStamp()}.txt`;
    downloadFile(filename, buildReport(), "text/plain;charset=utf-8");
    setStatus(`Downloaded ${filename}`, true);
  }

  function downloadReportCsv() {
    const filename = `sst-call-tracker-${sessionSlug()}-${fileStamp()}.csv`;
    downloadFile(filename, buildCsv(), "text/csv;charset=utf-8");
    setStatus(`Downloaded ${filename}`, true);
  }

  function renderAll() {
    updateElapsed();
    renderSummary();
    renderActivityButtonTimes();
    setExportButtonsEnabled(segments.length > 0);
  }

  btnStart?.addEventListener("click", startSession);
  btnStop?.addEventListener("click", endSession);
  btnReset?.addEventListener("click", resetSession);
  btnExport?.addEventListener("click", copyReport);
  btnDownloadTxt?.addEventListener("click", downloadReportTxt);
  btnDownloadCsv?.addEventListener("click", downloadReportCsv);
  btnCustom?.addEventListener("click", () => {
    const name = customActivityInput?.value?.trim();
    if (!name) {
      setStatus("Enter a custom activity name.", false);
      return;
    }
    markActivity(`custom:${name}`);
    if (customActivityInput) customActivityInput.value = "";
  });
  sessionLabelInput?.addEventListener("input", saveSession);

  initTheme();
  renderActivityButtons();
  loadSession();
  renderAll();
})();
