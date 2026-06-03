# Demo talk track — M500 Configured / Disconnected (VideoManager EX)

**Scenario:** M500 in-car system shows **Configured / Disconnected** in VideoManager EX (VMEX). Likely Windows Firewall blocking device ports.

**Setup before you speak:** Open http://127.0.0.1:8001/ · Search mode **Smart mix** · Sources **KB** + **MSI Library** · Voice assist optional.

---

## 1. Symptom-style search (manual — how an SST types it)

**Say to audience:**

> “An SST rarely searches by KB number first. They describe what they see on screen.”

**Type or paste into the main search box:**

```text
M500 configured disconnected VideoManager EX
```

**Alternative SST phrasings (pick one if the first is thin):**

```text
M500 shows configured disconnected in Video Manager EX
```

```text
in-car M500 will not connect to VMEX firewall
```

**Say:**

> “Smart mix blends keyword match on terms like *configured*, *disconnected*, and *VideoManager*, with semantic similarity for paraphrases. We’re not doing a literal ticket search.”

**Expected:** **KB0058926** (VMEX firewall) near the **top** of results.

---

## 2. Voice assist (optional — same symptom)

**Say:**

> “In the field they might dictate the issue while driving the call.”

**Enable Voice assist → Start listening. Read this naturally (pause ~1 second between sentences):**

```text
I've got an M500 on the in-car network showing configured disconnected in Video Manager EX.
The server team says VMEX is up but the dock still won't connect.
Customer is asking about firewall ports for the M500 and SVX.
```

**Or highlight in transcript / history:**

```text
configured disconnected VideoManager EX
```

→ Click **Search highlighted**.

**Expected:** Automated search runs with a query like *M500 configured disconnected VideoManager EX* or *VMEX firewall* · **KB0058926** appears in the scrollable voice results.

---

## 3. KB number lookup (precision path)

**Say:**

> “When they already have the article from ServiceNow, keyword mode is fastest.”

**Switch Search mode to Keyword · Search:**

```text
KB0058926
```

**Expected:** **KB0058926** is the top hit (direct KB boost + title match).

Switch back to **Smart mix** for the rest of the demo.

---

## 4. Expand KB0058926 — ports for M500 / SVX

**Say:**

> “Expand in place so we don’t leave the troubleshooting workspace.”

1. On **KB0058926** — *Mobile Video: How to check and configure firewall exceptions for VideoManager EX (VMEX)* — click **Expand**.

**Call out in the expanded body:**

| Port | Use |
|------|-----|
| **9080** | VideoManager UI / API / sites (browser, REST) |
| **9081** | Access-control key devices (VT/VB/V500 family) |
| **9082** | **Client certificate devices — M500, M500E, SVX, V700** |

**Say (closing line):**

> “For this M500 configured/disconnected symptom, the fix path is inbound Windows Firewall rules on **9080–9082**, with **9082** specifically called out for M500 and SVX certificate auth. Optional ONStream ports **554** and **8101** only if streaming is enabled.”

**Optional pin:** Pin KB0058926 to the right sidebar for the ticket notes.

---

## 30-second elevator version

> “SST searches *M500 configured disconnected VideoManager EX* on Smart mix. KB0058926 ranks first — VMEX firewall. Expand shows TCP **9080**, **9081**, and **9082**; M500 and SVX use **9082**. That’s the story from symptom to resolution without opening ten tabs.”

---

## Troubleshooting the demo

| Problem | Check |
|---------|--------|
| KB0058926 not first | Rebuild index: `python scripts/rebuild_index.py` · Restart backend |
| No results | Sources: KB enabled · Index ready in header |
| Voice empty | Ollama off → rule-based still works · **Search now** after speaking |
