(function () {
  const mobileQuery = window.matchMedia("(max-width: 760px)");
  const filteredViews = new Set(["my work", "pipeline", "reports"]);
  const storeAdmin = {
    client: null,
    session: null,
    roles: [],
    profiles: [],
    stores: new Map(),
    ownerFilter: "all",
    loading: false
  };
  let observer = null;

  onReady(init);

  function init() {
    installShell();
    injectStoreAdminStyles();
    initStoreAdmin();
    syncMobileShell();
    document.addEventListener("click", handleClick, true);
    document.addEventListener("input", scheduleSync, true);
    document.addEventListener("change", scheduleSync, true);
    document.addEventListener("change", handleStoreAdminChange, true);
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

    if (event.target.closest("[data-store-mobile-close]")) {
      event.preventDefault();
      closeStoreDetail();
      return;
    }

    if (event.target.closest("[data-store-select], [data-store-log]")) {
      window.setTimeout(openStoreDetail, 0);
    }

    if (event.target.closest("[data-mobile-filter-close], [data-mobile-filter-backdrop]")) {
      event.preventDefault();
      closeFilters();
      return;
    }

    if (event.target.closest("[data-view-tab], [data-stores-tab], [data-access-admin-tab], #new-lead")) {
      closeFilters();
      if (!event.target.closest("[data-stores-tab]")) closeStoreDetail();
      scheduleSync();
    }
  }

  function handleStoreAdminChange(event) {
    const owner = event.target.closest("[data-store-mobile-owner]");
    if (owner) {
      assignStoreOwner(owner.dataset.storeId, owner.value);
      return;
    }

    const filter = event.target.closest("[data-store-owner-filter]");
    if (filter) {
      storeAdmin.ownerFilter = filter.value;
      applyStoreOwnerFilter();
      return;
    }
  }

  function handleKeydown(event) {
    if (event.key === "Escape") {
      closeFilters();
      closeStoreDetail();
    }
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
    enhanceStoresAndAdmin();
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

  async function initStoreAdmin() {
    const config = window.CIS_CONFIG || {};
    if (!window.supabase || !config.supabaseUrl || !config.supabaseAnonKey) return;
    storeAdmin.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    try {
      const got = await storeAdmin.client.auth.getSession();
      storeAdmin.session = got.data?.session || null;
      await loadStoreAdminData();
    } catch (_error) {
      storeAdmin.session = null;
    }

    storeAdmin.client.auth.onAuthStateChange(async (_event, session) => {
      storeAdmin.session = session || null;
      await loadStoreAdminData();
      enhanceStoresAndAdmin();
    });
  }

  async function loadStoreAdminData() {
    if (!storeAdmin.client || !storeAdmin.session) {
      storeAdmin.roles = [];
      storeAdmin.profiles = [];
      storeAdmin.stores = new Map();
      return;
    }
    if (storeAdmin.loading) return;
    storeAdmin.loading = true;
    try {
      const roleRows = await storeAdmin.client
        .from("user_roles")
        .select("role")
        .eq("user_id", storeAdmin.session.user.id);
      if (roleRows.error) throw roleRows.error;
      storeAdmin.roles = (roleRows.data || []).map((row) => row.role);

      if (!canAssignStores()) {
        storeAdmin.profiles = [];
        storeAdmin.stores = new Map();
        return;
      }

      const [profiles, stores] = await Promise.all([
        storeAdmin.client.from("profiles").select("user_id, full_name, email, active").eq("active", true).order("full_name", { ascending: true }),
        storeAdmin.client.from("crm_stores").select("id, store_number, assigned_to, assigned_rep_name").order("store_number", { ascending: true })
      ]);
      if (profiles.error) throw profiles.error;
      if (stores.error) throw stores.error;
      storeAdmin.profiles = profiles.data || [];
      storeAdmin.stores = new Map((stores.data || []).map((store) => [store.id, store]));
    } catch (_error) {
      storeAdmin.roles = [];
      storeAdmin.profiles = [];
      storeAdmin.stores = new Map();
    } finally {
      storeAdmin.loading = false;
    }
  }

  function enhanceStoresAndAdmin() {
    enhanceStoreDetailSheet();
    enhanceStoreOwnerControls();
    enhanceAdminTables();
  }

  function enhanceStoreDetailSheet() {
    const storesPanel = document.getElementById("view-stores");
    if (!storesPanel || storesPanel.hidden) {
      closeStoreDetail();
      return;
    }

    const list = storesPanel.querySelector(".stores-list");
    if (list && !list.querySelector(".stores-list-head")) {
      list.insertAdjacentHTML("afterbegin", `<div class="stores-list-head"><h3>Stores</h3><strong data-store-visible-count></strong></div>`);
    }
    const count = storesPanel.querySelector("[data-store-visible-count]");
    if (count) count.textContent = String(storesPanel.querySelectorAll(".store-card:not([hidden])").length);

    const detail = storesPanel.querySelector(".store-detail");
    const heading = detail?.querySelector(".store-detail-heading");
    if (heading && !heading.querySelector("[data-store-mobile-close]")) {
      heading.insertAdjacentHTML("beforeend", `<button class="icon-button store-mobile-close" data-store-mobile-close type="button" aria-label="Close store details">X</button>`);
    }

    if (!mobileQuery.matches) closeStoreDetail();
  }

  function enhanceStoreOwnerControls() {
    const storesPanel = document.getElementById("view-stores");
    if (!storesPanel || storesPanel.hidden || !canAssignStores() || !storeAdmin.profiles.length) return;

    const toolbar = storesPanel.querySelector(".store-toolbar");
    if (toolbar && !toolbar.querySelector("[data-store-owner-filter]")) {
      const actions = toolbar.querySelector(".store-toolbar-actions");
      const ownerFilter = document.createElement("label");
      ownerFilter.className = "store-owner-filter";
      ownerFilter.innerHTML = `Owner<select data-store-owner-filter>${ownerFilterOptions()}</select>`;
      actions ? toolbar.insertBefore(ownerFilter, actions) : toolbar.appendChild(ownerFilter);
    }

    storesPanel.querySelectorAll(".store-card").forEach((card) => {
      const storeId = card.querySelector("[data-store-select]")?.dataset.storeSelect;
      if (!storeId) return;
      const store = storeAdmin.stores.get(storeId);
      if (!store) return;
      let field = card.querySelector("[data-store-mobile-owner]");
      if (!field) {
        const label = document.createElement("label");
        label.className = "store-mobile-owner";
        label.innerHTML = `<span>Owner</span><select data-store-mobile-owner data-store-id="${escapeAttr(storeId)}">${ownerSelectOptions(store.assigned_to)}</select>`;
        const facts = card.querySelector(".store-facts");
        facts ? facts.after(label) : card.appendChild(label);
        field = label.querySelector("select");
      }
      field.value = store.assigned_to || "";
      card.dataset.ownerId = store.assigned_to || "unassigned";
    });

    applyStoreOwnerFilter();
  }

  function enhanceAdminTables() {
    document.querySelectorAll(".admin-table-wrap").forEach((wrap) => {
      wrap.classList.add("admin-mobile-card-table");
    });
  }

  async function assignStoreOwner(storeId, ownerId) {
    if (!storeAdmin.client || !canAssignStores()) return;
    const profile = storeAdmin.profiles.find((item) => item.user_id === ownerId);
    const label = profileName(profile);
    const got = await storeAdmin.client
      .from("crm_stores")
      .update({ assigned_to: ownerId || null, assigned_rep_name: label || null })
      .eq("id", storeId);
    if (got.error) {
      showStatus(got.error.message || "Could not assign store.", true);
      return;
    }

    const store = storeAdmin.stores.get(storeId) || { id: storeId };
    store.assigned_to = ownerId || null;
    store.assigned_rep_name = label || null;
    storeAdmin.stores.set(storeId, store);
    updateVisibleStoreOwner(storeId, label || "Unassigned");
    showStatus(ownerId ? `Store assigned to ${label || "rep"}.` : "Store unassigned.");
  }

  function updateVisibleStoreOwner(storeId, label) {
    const card = document.querySelector(`[data-store-select="${cssEscape(storeId)}"]`)?.closest(".store-card");
    if (!card) return;
    card.dataset.ownerId = label === "Unassigned" ? "unassigned" : storeAdmin.stores.get(storeId)?.assigned_to || "unassigned";
    card.querySelectorAll(".store-facts div").forEach((fact) => {
      if (clean(fact.querySelector("dt")?.textContent).toLowerCase() === "rep") {
        const value = fact.querySelector("dd");
        if (value) value.textContent = label;
      }
    });
    applyStoreOwnerFilter();
  }

  function applyStoreOwnerFilter() {
    const storesPanel = document.getElementById("view-stores");
    if (!storesPanel) return;
    const selected = storeAdmin.ownerFilter;
    storesPanel.querySelectorAll(".store-card").forEach((card) => {
      const owner = card.dataset.ownerId || "unassigned";
      card.hidden = selected !== "all" && owner !== selected;
    });
    const count = storesPanel.querySelector("[data-store-visible-count]");
    if (count) count.textContent = String(storesPanel.querySelectorAll(".store-card:not([hidden])").length);
  }

  function openStoreDetail() {
    if (!mobileQuery.matches) return;
    document.body.classList.add("store-detail-sheet-open");
    enhanceStoreDetailSheet();
  }

  function closeStoreDetail() {
    document.body.classList.remove("store-detail-sheet-open");
  }

  function canAssignStores() {
    return storeAdmin.roles.includes("admin") || storeAdmin.roles.includes("manager");
  }

  function ownerFilterOptions() {
    return `<option value="all" ${storeAdmin.ownerFilter === "all" ? "selected" : ""}>All owners</option><option value="unassigned" ${storeAdmin.ownerFilter === "unassigned" ? "selected" : ""}>Unassigned</option>${storeAdmin.profiles.map((profile) => `<option value="${escapeAttr(profile.user_id)}" ${storeAdmin.ownerFilter === profile.user_id ? "selected" : ""}>${escapeHtml(profileName(profile))}</option>`).join("")}`;
  }

  function ownerSelectOptions(selected) {
    return `<option value="" ${!selected ? "selected" : ""}>Unassigned</option>${storeAdmin.profiles.map((profile) => `<option value="${escapeAttr(profile.user_id)}" ${selected === profile.user_id ? "selected" : ""}>${escapeHtml(profileName(profile))}</option>`).join("")}`;
  }

  function profileName(profile) {
    return profile ? profile.full_name || profile.email || "Rep" : "";
  }

  function showStatus(message, bad = false) {
    const box = document.getElementById("app-status");
    if (!box) return;
    box.textContent = message;
    box.classList.add("is-visible");
    box.classList.toggle("is-error", bad);
    window.clearTimeout(showStatus.timer);
    showStatus.timer = window.setTimeout(() => box.classList.remove("is-visible", "is-error"), 3500);
  }

  function injectStoreAdminStyles() {
    if (document.getElementById("mobile-store-admin-styles")) return;
    const style = document.createElement("style");
    style.id = "mobile-store-admin-styles";
    style.textContent = `
      .store-mobile-close{display:none}
      .store-mobile-owner{display:grid;gap:4px;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--panel-soft)}
      .store-mobile-owner span{color:var(--quiet);font-size:.72rem;font-weight:900;text-transform:uppercase}
      .store-mobile-owner select{min-height:36px;padding:7px 9px;background:#fff}
      .stores-list-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 2px}
      .stores-list-head h3{margin:0;font-size:1rem}
      .stores-list-head strong{display:inline-grid;place-items:center;min-width:34px;height:28px;padding:0 8px;border-radius:999px;background:var(--panel-soft);color:var(--muted)}
      @media(max-width:760px){
        body.store-detail-sheet-open{overflow:hidden}
        .stores-panel:not([hidden]) .stores-layout{display:block!important}
        .stores-panel:not([hidden]) .store-detail{display:none!important}
        body.store-detail-sheet-open .stores-panel:not([hidden]) .store-detail{position:fixed;inset:0;z-index:92;display:grid!important;align-content:start;max-height:none;overflow:auto;padding:12px 12px calc(18px + env(safe-area-inset-bottom));border:0;border-radius:0;background:#fff;box-shadow:none}
        body.store-detail-sheet-open .stores-panel:not([hidden]) .store-detail-heading{position:sticky;top:-12px;z-index:2;margin:-12px -12px 0;padding:12px;border-bottom:1px solid var(--line);background:#fff}
        body.store-detail-sheet-open .store-mobile-close{display:grid;place-items:center;margin-left:auto}
        .store-mobile-owner{grid-template-columns:72px minmax(0,1fr);align-items:center}
        .store-mobile-owner select{width:100%;min-width:0}
        .store-owner-filter{order:3}
        .admin-mobile-card-table{max-height:none;overflow:visible}
        .admin-mobile-card-table .admin-table{width:100%;min-width:0;border-collapse:separate;border-spacing:0 10px}
        .admin-mobile-card-table thead{display:none}
        .admin-mobile-card-table tbody,.admin-mobile-card-table tr,.admin-mobile-card-table td{display:block;width:100%}
        .admin-mobile-card-table tr{padding:10px;border:1px solid var(--line);border-radius:8px;background:#fff;box-shadow:var(--shadow)}
        .admin-mobile-card-table td{padding:6px 0;border:0}
        .admin-mobile-card-table input,.admin-mobile-card-table select{width:100%;min-width:0}
        .admin-mobile-card-table td::before{display:block;margin-bottom:3px;color:var(--quiet);font-size:.68rem;font-weight:900;text-transform:uppercase}
        .admin-mobile-card-table td:nth-child(1)::before{content:"Record"}
        .admin-mobile-card-table td:nth-child(2)::before{content:"Details"}
        .admin-mobile-card-table td:nth-child(3)::before{content:"Phone / Sort"}
        .admin-mobile-card-table td:nth-child(4)::before{content:"Role / Status"}
        .admin-mobile-card-table td:nth-child(5)::before{content:"Status / Actions"}
        .admin-mobile-card-table td:nth-child(6)::before{content:"Password"}
        .admin-mobile-card-table td:nth-child(7)::before{content:"Actions"}
      }
    `;
    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return window.CSS.escape(value);
    return String(value || "").replace(/["\\]/g, "\\$&");
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
