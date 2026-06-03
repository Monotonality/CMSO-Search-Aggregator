/**
 * Shared API base URL — use FastAPI on 8001 when the page is not served from it.
 */
(function () {
  function detectApiBase() {
    if (typeof window === "undefined" || !window.location) return "";
    const { protocol, port, hostname } = window.location;
    if (protocol === "file:") return "http://127.0.0.1:8001";
    if (port === "8001" && (hostname === "127.0.0.1" || hostname === "localhost")) {
      return "";
    }
    if (port === "8000" && (hostname === "127.0.0.1" || hostname === "localhost")) {
      return "";
    }
    if (port === "5500" || port === "3000" || port === "5173" || port === "4173") {
      return "http://127.0.0.1:8001";
    }
    return "";
  }

  const API_BASE = detectApiBase();

  async function api(path, options) {
    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
    const res = await fetch(url, options);
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(
        res.ok
          ? "Invalid response from server"
          : text.slice(0, 120) || res.statusText || "Request failed"
      );
    }
    if (!res.ok) {
      const detail = body.detail;
      let message =
        typeof detail === "string"
          ? detail
          : Array.isArray(detail)
            ? detail.map((d) => d.msg || String(d)).join("; ")
            : res.statusText || "Request failed";
      if (res.status === 404 && message === "Not Found") {
        message =
          "API route not found. Open http://127.0.0.1:8001/ in the browser and restart uvicorn from the backend folder.";
      }
      throw new Error(message);
    }
    return body;
  }

  window.MotoApi = { base: API_BASE, api };
})();
