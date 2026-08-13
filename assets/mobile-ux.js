(function () {
  const mobileQuery = window.matchMedia("(max-width: 760px)");
  const filteredViews = new Set(["my work", "pipeline", "reports"]);
  let observer = null;

  onReady(init);

  function init() {
    installShell();
    syncMobileShell();
    document.addEventListener("click", handleClick, true);
    document.addEventListener("input", scheduleSync, true);
    document.addEventListener("change", scheduleSync, true);
    document.addEventListener("keydown", handleKeydown);
    mobileQuery.addEventListener("change", syncMobileShell);

    if (document.body) {
      observer = new MutationObserver(scheduleSync);
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden", "aria-current"] });
    }
  }

  function installShell() {
    const workspace = document.getElementById("workspace");
    const tabs = document.querySelector(".primary-tabs");
    if (!workspace || !tabs) return;

    if (!document.querySelector("[data-mobile-context-bar]")) {
      const bar = document.createElement("div");
      bar.className = "mobile-context-bar";
      bar.dataset.mobileContextBar = "true";
      bar.innerHTML = `
        <div class="mobile-current-view">
          <span>Current view</span>
          <strong data-mobile-view-label>Workspace</strong>
        </div>
        <button class="mobile-filter-toggle" data-mobile-filter-toggle type="button" aria-expanded="false">Filters</button>
      `;
      tabs.after(bar);
    }

    if (!document.querySelector("[data-mobile-filter-backdrop]")) {
      const backdrop = document.createElement("button");
      backdrop.className = "mobile-filter-backdrop";
      backdrop.dataset.mobileFilterBackdrop = "true";
      backdrop.type = "button";
      backdrop.setAttribute("aria-label", "Close filters");
      document.body.appendChild(backdrop);
    }

    const filterPanel = document.querySelector(".filter-panel");
    if (filterPanel && !filterPanel.querySelector("[data-mobile-filter-close]")) {
      filterPanel.insertAdjacentHTML("afterbegin", `
        <div class="mobile-filter-heading">
          <strong>Filters</strong>
          <button class="mobile-filter-close" data-mobile-filter-close type="button">Done</button>
        </div>
      `);
    }
  }

  function handleClick(event) {
    if (event.target.closest("[data-mobile-filter-toggle]")) {
      event.preventDefault();
      toggleFilters();
      return;
    }

    if (event.target.closest("[data-mobile-filter-close], [data-mobile-filter-backdrop]")) {
      event.preventDefault();
      closeFilters();
      return;
    }

    if (event.target.closest("[data-view-tab], [data-stores-tab], [data-access-admin-tab], #new-lead")) {
      closeFilters();
      scheduleSync();
    }
  }

  function handleKeydown(event) {
    if (event.key === "Escape") closeFilters();
  }

  function toggleFilters() {
    if (!mobileQuery.matches || isFilterlessView()) return;
    document.body.classList.toggle("mobile-filters-open");
    syncMobileShell();
  }

  function closeFilters() {
    document.body.classList.remove("mobile-filters-open");
    syncMobileShell();
  }

  function scheduleSync() {
    window.requestAnimationFrame(syncMobileShell);
  }

  function syncMobileShell() {
    installShell();
    document.body.classList.toggle("has-mobile-ux", mobileQuery.matches);
    if (!mobileQuery.matches || isFilterlessView()) {
      document.body.classList.remove("mobile-filters-open");
    }

    const label = document.querySelector("[data-mobile-view-label]");
    if (label) label.textContent = activeViewLabel();

    const context = document.querySelector("[data-mobile-context-bar]");
    if (context) context.classList.toggle("is-filterless", isFilterlessView());

    const toggle = document.querySelector("[data-mobile-filter-toggle]");
    if (toggle) {
      const count = activeFilterCount();
      toggle.textContent = count ? `Filters ${count}` : "Filters";
      toggle.setAttribute("aria-expanded", String(document.body.classList.contains("mobile-filters-open")));
    }
  }

  function activeViewLabel() {
    const active = document.querySelector(".primary-tabs .is-active");
    return clean(active?.textContent) || "Workspace";
  }

  function isFilterlessView() {
    return !filteredViews.has(activeViewLabel().toLowerCase());
  }

  function activeFilterCount() {
    let count = 0;
    document.querySelectorAll(".filter-panel input, .filter-panel select").forEach((field) => {
      if (field.closest("[data-mobile-filter-close]")) return;
      const value = clean(field.value);
      if (!value || value === "all") return;
      count += 1;
    });
    return count;
  }

  function clean(value) {
    return String(value || "").trim();
  }

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
    } else {
      callback();
    }
  }
})();
