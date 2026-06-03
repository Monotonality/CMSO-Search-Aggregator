/** In-page confirm / prompt dialogs (replaces window.confirm & window.prompt). */
(function () {
  const dialogEl = document.getElementById("app-dialog");
  const titleEl = document.getElementById("app-dialog-title");
  const messageEl = document.getElementById("app-dialog-message");
  const fieldEl = document.getElementById("app-dialog-field");
  const labelEl = document.getElementById("app-dialog-label");
  const inputEl = document.getElementById("app-dialog-input");
  const cancelBtn = document.getElementById("app-dialog-cancel");
  const confirmBtn = document.getElementById("app-dialog-confirm");
  const backdropEl = dialogEl?.querySelector(".app-dialog-backdrop");

  let resolvePending = null;
  let mode = "confirm";

  function close(result) {
    if (!dialogEl) return;
    dialogEl.classList.add("hidden");
    document.body.classList.remove("dialog-open");
    const resolve = resolvePending;
    resolvePending = null;
    mode = "confirm";
    if (fieldEl) fieldEl.classList.add("hidden");
    if (inputEl) inputEl.value = "";
    if (resolve) resolve(result);
  }

  function onConfirm() {
    if (mode === "prompt") {
      const value = inputEl?.value.trim() ?? "";
      close(value || null);
      return;
    }
    close(true);
  }

  function onCancel() {
    close(mode === "prompt" ? null : false);
  }

  function onKeydown(e) {
    if (dialogEl?.classList.contains("hidden")) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
    if (e.key === "Enter" && mode === "prompt" && document.activeElement === inputEl) {
      e.preventDefault();
      onConfirm();
    }
  }

  function open(options) {
    if (!dialogEl || !titleEl || !messageEl || !cancelBtn || !confirmBtn) {
      return Promise.resolve(options.mode === "prompt" ? null : false);
    }

    return new Promise((resolve) => {
      resolvePending = resolve;
      mode = options.mode === "prompt" ? "prompt" : "confirm";

      titleEl.textContent = options.title || (mode === "prompt" ? "Input" : "Confirm");
      messageEl.textContent = options.message || "";
      messageEl.classList.toggle("hidden", !options.message);

      cancelBtn.textContent = options.cancelText || "Cancel";
      confirmBtn.textContent = options.confirmText || (mode === "prompt" ? "OK" : "Confirm");

      confirmBtn.classList.toggle("btn-danger", Boolean(options.danger));
      confirmBtn.classList.toggle("btn-primary", !options.danger);

      if (mode === "prompt" && fieldEl && labelEl && inputEl) {
        fieldEl.classList.remove("hidden");
        labelEl.textContent = options.label || "Value";
        inputEl.type = options.inputType || "text";
        inputEl.placeholder = options.placeholder || "";
        inputEl.value = options.defaultValue ?? "";
      } else if (fieldEl) {
        fieldEl.classList.add("hidden");
      }

      dialogEl.classList.remove("hidden");
      document.body.classList.add("dialog-open");

      if (mode === "prompt" && inputEl) {
        inputEl.focus();
        inputEl.select();
      } else {
        confirmBtn.focus();
      }
    });
  }

  cancelBtn?.addEventListener("click", onCancel);
  confirmBtn?.addEventListener("click", onConfirm);
  backdropEl?.addEventListener("click", onCancel);
  document.addEventListener("keydown", onKeydown);

  window.MotoDialog = {
    confirm(options = {}) {
      return open({ ...options, mode: "confirm" });
    },
    prompt(options = {}) {
      return open({ ...options, mode: "prompt" });
    },
  };
})();
