(function () {
  injectCleanupStyles();
  removeLegacySetupBlocks();
  onReady(removeLegacySetupBlocks);

  if (document.body) {
    new MutationObserver(removeLegacySetupBlocks).observe(document.body, { childList: true, subtree: true });
  }

  function removeLegacySetupBlocks() {
    document.querySelectorAll("[data-store-reference-setup]").forEach((block) => block.remove());
  }

  function injectCleanupStyles() {
    if (document.getElementById("stores-cleanup-styles")) return;
    const style = document.createElement("style");
    style.id = "stores-cleanup-styles";
    style.textContent = `
      .store-admin-setup{display:grid;gap:10px;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--panel-soft)}
      .store-admin-setup .store-form{gap:8px}
      .store-admin-setup input,.store-admin-setup select{min-height:36px;padding:7px 9px}
      .store-admin-setup input[type="checkbox"]{width:18px;min-height:18px;height:18px;padding:0}
      .store-admin-setup .checkbox-row{display:flex;align-items:center;gap:8px}
      .store-admin-setup .button{justify-self:start;min-height:36px;padding:0 12px}
    `;
    document.head.appendChild(style);
  }

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
    } else {
      callback();
    }
  }
})();
