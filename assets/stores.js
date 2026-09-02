(function () {
  if (window.__CIS_STORES__) return;
  window.__CIS_STORES__ = true;

  const WEEKLY_TARGET = 5;
  const FRESH_DAYS = 14;
  const OVERDUE_DAYS = 30;
  const STORE_TABLE = "crm_stores";
  const ROLE_TABLE = "crm_store_roles";
  const CONTACT_TABLE = "crm_store_contacts";
  const VISIT_TABLE = "crm_store_visits";
  const PLAN_TABLE = "crm_store_visit_plans";

  const state = {
    client: null,
    session: null,
    roles: [],
    profiles: [],
    stores: [],
    storeRoles: [],
    contacts: [],
    visits: [],
    plans: [],
    rollups: [],
    selectedStoreId: "",
    detailOpen: false,
    visible: false,
    loading: false,
    message: "",
    importOpen: false,
    filters: {
      search: "",
      freshness: "all",
      owner: "all"
    },
    weekStart: mondayOf(today())
  };

  onReady(init);

  function init() {
    injectStyles();
    installStoresView();
    state.client = createClient();
    refreshData({ silent: true });
    if (state.client) {
      state.client.auth.onAuthStateChange((_event, session) => {
        state.session = session || null;
        refreshData({ silent: true });
      });
    }
  }

  function createClient() {
    if (window.__CIS_SUPABASE_CLIENT__) return window.__CIS_SUPABASE_CLIENT__;
    const config = window.CIS_CONFIG || {};
    if (!window.supabase || !config.supabaseUrl || !config.supabaseAnonKey) return null;
    return window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }

  function installStoresView() {
    const tabs = document.querySelector(".primary-tabs");
    const workspace = document.getElementById("workspace");
    if (!tabs || !workspace) return;

    if (!document.querySelector("[data-stores-tab]")) {
      const button = document.createElement("button");
      button.className = "tab-button";
      button.type = "button";
      button.dataset.storesTab = "true";
      button.textContent = "Stores";
      button.addEventListener("click", showStoresView);
      const pipelineTab = tabs.querySelector("[data-view-tab='pipeline']");
      pipelineTab ? pipelineTab.after(button) : tabs.appendChild(button);
    }

    if (!document.getElementById("view-stores")) {
      const section = document.createElement("section");
      section.className = "view-panel stores-panel";
      section.id = "view-stores";
      section.hidden = true;
      section.innerHTML = `
        <div class="view-heading">
          <div>
            <p class="eyebrow">Retail coverage</p>
            <h2>Stores</h2>
          </div>
          <div class="stores-heading-actions">
            <p id="stores-count" class="count-label"></p>
            <button class="button secondary" data-stores-refresh type="button">Refresh</button>
          </div>
        </div>
        <div id="stores-view"></div>
      `;
      const reports = document.getElementById("view-reports");
      reports ? reports.before(section) : workspace.appendChild(section);
      section.addEventListener("click", handleStoresClick);
      section.addEventListener("submit", handleStoresSubmit);
      section.addEventListener("input", handleStoresInput);
      section.addEventListener("change", handleStoresChange);
    }

    document.addEventListener("click", (event) => {
      if (event.target.closest("[data-stores-tab]")) return;
      if (event.target.closest("[data-view-tab], [data-access-admin-tab]")) state.visible = false;
    });
  }

  function showStoresView() {
    state.visible = true;
    document.querySelectorAll("[data-view-tab], [data-access-admin-tab], [data-stores-tab]").forEach((button) => {
      const active = button.dataset.storesTab === "true";
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    document.querySelectorAll(".view-panel").forEach((panel) => {
      const active = panel.id === "view-stores";
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
    renderStores();
    refreshData({ silent: true });
  }

  async function refreshData(options = {}) {
    if (!state.client) {
      state.message = "Shared backend is not configured.";
      renderStores();
      return;
    }
    state.loading = !options.silent;
    renderStores();
    try {
      const { data: sessionData, error: sessionError } = await state.client.auth.getSession();
      if (sessionError) throw sessionError;
      state.session = sessionData.session || null;
      if (!state.session) {
        state.loading = false;
        renderStores();
        return;
      }
      await loadAccess();
      await Promise.all([
        loadStoreRoles(),
        loadProfiles(),
        loadStores(),
        loadContacts(),
        loadVisits(),
        loadPlans(),
        loadRollups()
      ]);
      if (!state.selectedStoreId || !state.stores.some((store) => store.id === state.selectedStoreId)) {
        state.selectedStoreId = state.stores[0]?.id || "";
      }
      state.message = "";
    } catch (error) {
      state.message = error.message || "Could not load store data.";
    } finally {
      state.loading = false;
      renderStores();
    }
  }

  async function loadAccess() {
    const userId = state.session.user.id;
    const { data, error } = await state.client
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (error) throw error;
    state.roles = Array.from(new Set((data || []).map((row) => row.role || "rep")));
  }

  async function loadProfiles() {
    const { data, error } = await state.client
      .from("profiles")
      .select("user_id, full_name, email, active")
      .eq("active", true)
      .order("full_name", { ascending: true });
    if (error) throw error;
    state.profiles = data || [];
  }

  async function loadStoreRoles() {
    const { data, error } = await state.client
      .from(ROLE_TABLE)
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) throw error;
    state.storeRoles = data || [];
  }

  async function loadStores() {
    const { data, error } = await state.client
      .from(STORE_TABLE)
      .select("*")
      .order("store_number", { ascending: true });
    if (error) throw error;
    state.stores = (data || []).map(storeFromRow);
  }

  async function loadContacts() {
    const { data, error } = await state.client
      .from(CONTACT_TABLE)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    state.contacts = data || [];
  }

  async function loadVisits() {
    const { data, error } = await state.client
      .from(VISIT_TABLE)
      .select("*")
      .order("visited_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    state.visits = data || [];
  }

  async function loadPlans() {
    const { data, error } = await state.client
      .from(PLAN_TABLE)
      .select("*")
      .eq("week_start", state.weekStart)
      .order("planned_day", { ascending: true });
    if (error) throw error;
    state.plans = data || [];
  }

  async function loadRollups() {
    const { data, error } = await state.client.rpc("crm_store_visit_rollup");
    if (error) throw error;
    state.rollups = data || [];
  }

  function renderStores() {
    const root = document.getElementById("stores-view");
    if (!root) return;
    const count = document.getElementById("stores-count");

    if (!state.client) {
      root.innerHTML = renderEmpty("Shared backend is not configured.");
      if (count) count.textContent = "";
      return;
    }
    if (!state.session) {
      root.innerHTML = renderEmpty("Sign in to use store coverage.");
      if (count) count.textContent = "";
      return;
    }
    if (state.loading) {
      root.innerHTML = renderEmpty("Loading stores...");
      return;
    }

    const stores = filteredStores();
    const selected = stores.find((store) => store.id === state.selectedStoreId) || stores[0] || null;
    if (selected && state.selectedStoreId !== selected.id) state.selectedStoreId = selected.id;
    const metrics = storeMetrics(stores);
    if (count) count.textContent = `${stores.length} ${stores.length === 1 ? "store" : "stores"}`;

    root.innerHTML = `
      ${state.message ? `<p class="stores-alert">${escapeHtml(state.message)}</p>` : ""}
      <div class="store-metrics">
        ${metric("Owned stores", metrics.total)}
        ${metric("Need visit", metrics.needVisit)}
        ${metric("Never visited", metrics.never)}
        ${metric("This week", `${metrics.weekVisits}/${WEEKLY_TARGET}`)}
      </div>
      <section class="store-toolbar" aria-label="Store filters">
        <label>
          Search stores
          <input id="stores-search" value="${escapeHtml(state.filters.search)}" placeholder="Store number, city, contact, territory">
        </label>
        <label>
          Freshness
          <select id="stores-freshness">
            ${option("all", "All stores", state.filters.freshness)}
            ${option("never", "Never visited", state.filters.freshness)}
            ${option("fresh", "Fresh", state.filters.freshness)}
            ${option("stale", "Stale", state.filters.freshness)}
            ${option("overdue", "Overdue", state.filters.freshness)}
          </select>
        </label>
        ${isManagerOrAdmin() ? `
          <label>
            Owner
            <select id="stores-owner">
              ${profileFilterOptions(state.filters.owner)}
            </select>
          </label>
        ` : ""}
        <label>
          Week
          <input id="stores-week-start" type="date" value="${escapeHtml(state.weekStart)}">
        </label>
        <div class="store-toolbar-actions">
          <button class="button primary" data-suggest-week type="button">Suggest Week</button>
          <button class="button secondary" data-export-stores type="button">Export Stores CSV</button>
          ${isAdmin() ? `<button class="button secondary" data-toggle-store-import type="button">${state.importOpen ? "Hide Import" : "Import Stores"}</button>` : ""}
        </div>
      </section>
      ${renderWeekPlanner()}
      ${isAdmin() && state.importOpen ? renderImportPanel() : ""}
      ${selected ? `<button class="store-detail-backdrop ${state.detailOpen ? "is-open" : ""}" data-close-store-detail type="button" aria-label="Close store details"></button>` : ""}
      <div class="stores-layout ${state.detailOpen && selected ? "is-detail-open" : ""}">
        <section class="stores-list" aria-label="Store list">
          <div class="stores-list-head">
            <h3>Stores</h3>
            <strong>${stores.length}</strong>
          </div>
          ${stores.length ? stores.map((store) => renderStoreCard(store, selected?.id === store.id)).join("") : renderEmpty("No stores match the current filters.")}
        </section>
        <section class="store-detail" aria-label="Store details" ${state.detailOpen ? `role="dialog" aria-modal="true"` : ""}>
          ${selected ? renderStoreDetail(selected) : renderEmpty("Select a store to see contacts and visits.")}
        </section>
      </div>
    `;
  }

  function renderWeekPlanner() {
    const plans = weekPlans();
    const planned = plans.filter((plan) => plan.status === "planned").length;
    const visited = plans.filter((plan) => plan.status === "visited").length;
    return `
      <section class="store-week">
        <div class="store-section-heading">
          <div>
            <h3>Week plan</h3>
            <p>${formatDate(state.weekStart)} week - ${visited} visited, ${planned} planned</p>
          </div>
          <strong>${visited}/${WEEKLY_TARGET}</strong>
        </div>
        <div class="week-plan-list">
          ${plans.length ? plans.map(renderPlanItem).join("") : renderEmpty("No stores planned for this week.")}
        </div>
      </section>
    `;
  }

  function renderPlanItem(plan) {
    const store = state.stores.find((item) => item.id === plan.store_id);
    if (!store) return "";
    return `
      <article class="week-plan-item ${escapeHtml(plan.status)}">
        <button class="store-link" data-store-select="${escapeHtml(store.id)}" type="button">
          <strong>#${escapeHtml(store.storeNumber)} ${escapeHtml(store.name)}</strong>
          <span>${escapeHtml(formatStoreLocation(store))}</span>
        </button>
        <span class="status-pill ${plan.status === "visited" ? "upcoming" : "none"}">${escapeHtml(plan.status)}</span>
        <button class="text-button" data-store-log="${escapeHtml(store.id)}" type="button">Log Visit</button>
        <button class="text-button subtle" data-skip-plan="${escapeHtml(plan.id)}" type="button">Skip</button>
      </article>
    `;
  }

  function renderImportPanel() {
    return `
      <section class="store-import">
        <div class="store-section-heading">
          <div>
            <h3>Bulk import</h3>
            <p>Paste CSV data or Home Depot store page links. Store number is the dedupe key, so re-importing updates existing stores.</p>
          </div>
        </div>
        <form id="store-import-form" class="store-form">
          <textarea name="csv" rows="7" placeholder="store_number,name,street,city,state,zip,phone,source_url,territory,assigned_rep_email,tier,latitude,longitude"></textarea>
          <div class="form-actions">
            <button class="button primary" type="submit">Import / Update Stores</button>
            <button class="button secondary" data-clear-store-import type="button">Clear</button>
          </div>
        </form>
        <form id="store-role-form" class="store-role-form">
          <label>
            Add contact role
            <input name="label" placeholder="Assistant Store Manager">
          </label>
          <button class="button secondary" type="submit">Add Role</button>
        </form>
      </section>
    `;
  }

  function renderStoreCard(store, selected) {
    const freshness = freshnessFor(store);
    const missing = missingRoles(store);
    return `
      <article class="store-card ${selected ? "is-selected" : ""} freshness-${freshness.status}">
        <button class="store-main" data-store-select="${escapeHtml(store.id)}" type="button">
          <span class="store-number">#${escapeHtml(store.storeNumber)}</span>
          <strong>${escapeHtml(store.name)}</strong>
          <small>${escapeHtml(formatStoreLocation(store) || "Location missing")}</small>
        </button>
        <dl class="store-facts">
          <div><dt>Freshness</dt><dd><span class="age-pill ${escapeHtml(freshness.status)}">${escapeHtml(freshness.label)}</span></dd></div>
          <div><dt>Rep</dt><dd>${escapeHtml(store.assignedRepName || "Unassigned")}</dd></div>
          <div><dt>Territory</dt><dd>${escapeHtml(store.territory || "No territory")}</dd></div>
          <div><dt>Phone</dt><dd>${escapeHtml(store.phone || "No phone")}</dd></div>
        </dl>
        ${isManagerOrAdmin() ? renderStoreCardAssignment(store) : ""}
        <div class="quick-actions">
          <button class="text-button" data-store-log="${escapeHtml(store.id)}" type="button">Log Visit</button>
          <button class="text-button" data-plan-store="${escapeHtml(store.id)}" type="button">Plan</button>
        </div>
      </article>
    `;
  }

  function renderStoreCardAssignment(store) {
    return `
      <label class="store-card-owner">
        <span>Owner</span>
        <select data-store-owner-select data-store-id="${escapeHtml(store.id)}">
          ${profileOptions(store.assignedTo, true)}
        </select>
      </label>
    `;
  }

  function renderStoreDetail(store) {
    const contacts = contactsFor(store.id);
    const visits = visitsFor(store.id).slice(0, 8);
    const missing = missingRoles(store);
    return `
      <div class="store-detail-heading">
        <div>
          <span class="store-number">#${escapeHtml(store.storeNumber)}</span>
          <h3>${escapeHtml(store.name)}</h3>
          <p>${escapeHtml(formatStoreLocation(store) || "Location missing")}</p>
          ${store.phone ? `<p>${escapeHtml(store.phone)}</p>` : ""}
          ${store.sourceUrl ? `<p><a href="${escapeHtml(store.sourceUrl)}" target="_blank" rel="noopener">Home Depot directory page</a></p>` : ""}
        </div>
        <div class="store-detail-tools">
          <span class="age-pill ${escapeHtml(freshnessFor(store).status)}">${escapeHtml(freshnessFor(store).label)}</span>
          <button class="icon-button store-detail-close" data-close-store-detail type="button" aria-label="Close store details">X</button>
        </div>
      </div>
      ${missing.length ? `<p class="stores-alert">Missing contacts: ${missing.map((role) => escapeHtml(role.label)).join(", ")}</p>` : ""}
      <div class="store-detail-grid">
        <section>
          <div class="store-section-heading"><h3>Contacts</h3></div>
          <div class="contact-grid">
            ${state.storeRoles.filter((role) => role.active).map((role) => renderRoleContact(role, contacts)).join("")}
          </div>
          <form id="store-contact-form" class="store-form">
            <input type="hidden" name="storeId" value="${escapeHtml(store.id)}">
            <div class="form-row">
              <label>
                Role
                <select name="roleCode" required>
                  ${state.storeRoles.filter((role) => role.active).map((role) => `<option value="${escapeHtml(role.code)}">${escapeHtml(role.label)}</option>`).join("")}
                </select>
              </label>
              <label>
                Name
                <input name="fullName" required>
              </label>
            </div>
            <div class="form-row">
              <label>Phone<input name="phone"></label>
              <label>Email<input name="email" type="email"></label>
            </div>
            <label>Notes<textarea name="notes" rows="2"></textarea></label>
            <button class="button secondary" type="submit">Save Contact</button>
          </form>
        </section>
        <section>
          <div class="store-section-heading"><h3>Visit history</h3></div>
          <form id="store-visit-form" class="store-form">
            <input type="hidden" name="storeId" value="${escapeHtml(store.id)}">
            <div class="form-row">
              <label>Date<input name="visitedDate" type="date" value="${today()}" required></label>
              <label>
                Outcome
                <select name="outcome">
                  <option>Visited</option>
                  <option>Staff conversation</option>
                  <option>Left materials</option>
                  <option>Manager unavailable</option>
                  <option>Skipped</option>
                  <option>Not a fit</option>
                </select>
              </label>
            </div>
            <label>Notes<textarea name="notes" rows="3" placeholder="Who you talked to and what happened"></textarea></label>
            <button class="button primary" type="submit">Log Store Visit</button>
          </form>
          <ol class="store-visit-list">
            ${visits.length ? visits.map(renderVisit).join("") : `<li>No visits logged yet.</li>`}
          </ol>
        </section>
      </div>
    `;
  }

  function renderRoleContact(role, contacts) {
    const roleContacts = contacts.filter((contact) => contact.role_code === role.code);
    return `
      <article class="contact-role ${roleContacts.length ? "" : "is-missing"}">
        <strong>${escapeHtml(role.label)}</strong>
        ${roleContacts.length ? roleContacts.map((contact) => `
          <span>${escapeHtml(contact.full_name)}</span>
          <small>${escapeHtml([contact.phone, contact.email].filter(Boolean).join(" | ") || contact.notes || "No contact details")}</small>
        `).join("") : `<span>Missing</span><small>Ask for this role on your next visit.</small>`}
      </article>
    `;
  }

  function renderVisit(visit) {
    const profile = state.profiles.find((item) => item.user_id === visit.user_id);
    return `
      <li>
        <time>${escapeHtml(formatDate(visit.visited_at))}</time>
        <span><strong>${escapeHtml(visit.outcome || "Visited")}</strong> by ${escapeHtml(profileName(profile) || "Rep")}${visit.notes ? ` - ${escapeHtml(visit.notes)}` : ""}</span>
      </li>
    `;
  }

  function handleStoresInput(event) {
    if (event.target.id === "stores-search") {
      state.filters.search = event.target.value;
      renderStores();
    }
  }

  function handleStoresChange(event) {
    const ownerSelect = event.target.closest("[data-store-owner-select]");
    if (ownerSelect) {
      quickAssignStore(ownerSelect.dataset.storeId, ownerSelect.value);
      return;
    }
    if (event.target.id === "stores-freshness") {
      state.filters.freshness = event.target.value;
      renderStores();
    }
    if (event.target.id === "stores-owner") {
      state.filters.owner = event.target.value;
      state.detailOpen = false;
      renderStores();
    }
    if (event.target.id === "stores-week-start") {
      state.weekStart = mondayOf(event.target.value || today());
      refreshData();
    }
  }

  function handleStoresClick(event) {
    if (event.target.closest("[data-close-store-detail]")) {
      state.detailOpen = false;
      renderStores();
      return;
    }
    const select = event.target.closest("[data-store-select]");
    if (select) {
      state.selectedStoreId = select.dataset.storeSelect;
      state.detailOpen = true;
      renderStores();
      return;
    }
    const log = event.target.closest("[data-store-log]");
    if (log) {
      state.selectedStoreId = log.dataset.storeLog;
      state.detailOpen = true;
      renderStores();
      window.requestAnimationFrame(() => document.getElementById("store-visit-form")?.scrollIntoView({ block: "start" }));
      return;
    }
    const plan = event.target.closest("[data-plan-store]");
    if (plan) {
      createPlan(plan.dataset.planStore);
      return;
    }
    if (event.target.closest("[data-suggest-week]")) {
      suggestWeek();
      return;
    }
    if (event.target.closest("[data-stores-refresh]")) {
      refreshData();
      return;
    }
    if (event.target.closest("[data-export-stores]")) {
      exportStores();
      return;
    }
    if (event.target.closest("[data-toggle-store-import]")) {
      state.importOpen = !state.importOpen;
      renderStores();
      return;
    }
    if (event.target.closest("[data-clear-store-import]")) {
      const form = document.getElementById("store-import-form");
      if (form) form.reset();
      return;
    }
    const skip = event.target.closest("[data-skip-plan]");
    if (skip) {
      updatePlanStatus(skip.dataset.skipPlan, "skipped");
    }
  }

  async function handleStoresSubmit(event) {
    if (event.target.id === "store-visit-form") {
      event.preventDefault();
      await logVisit(event.target);
    }
    if (event.target.id === "store-contact-form") {
      event.preventDefault();
      await saveContact(event.target);
    }
    if (event.target.id === "store-import-form") {
      event.preventDefault();
      await importStores(event.target);
    }
    if (event.target.id === "store-role-form") {
      event.preventDefault();
      await addStoreRole(event.target);
    }
  }

  async function createPlan(storeId) {
    const store = state.stores.find((item) => item.id === storeId);
    if (!store || !state.session) return;
    const row = {
      store_id: store.id,
      user_id: state.session.user.id,
      week_start: state.weekStart,
      planned_day: state.weekStart,
      status: "planned"
    };
    const { error } = await state.client.from(PLAN_TABLE).upsert(row, { onConflict: "store_id,user_id,week_start" });
    if (error) return showMessage(error.message || "Could not plan store.");
    await refreshData({ silent: true });
  }

  async function suggestWeek() {
    if (!state.session) return;
    const candidates = suggestionCandidates();
    if (!candidates.length) {
      showMessage("No eligible stores found. Reps need assigned stores with a territory before suggestions are made.");
      return;
    }
    const rows = candidates.slice(0, WEEKLY_TARGET).map((store, index) => ({
      store_id: store.id,
      user_id: state.session.user.id,
      week_start: state.weekStart,
      planned_day: addDays(state.weekStart, Math.min(index, 4)),
      status: "planned"
    }));
    const { error } = await state.client.from(PLAN_TABLE).upsert(rows, { onConflict: "store_id,user_id,week_start" });
    if (error) return showMessage(error.message || "Could not suggest week.");
    await refreshData({ silent: true });
  }

  function suggestionCandidates() {
    const plannedIds = new Set(weekPlans().map((plan) => plan.store_id));
    const owned = state.stores.filter((store) => {
      if (!store.active) return false;
      if (plannedIds.has(store.id)) return false;
      if (isManagerOrAdmin()) return true;
      return store.assignedTo === state.session.user.id;
    });
    if (!isManagerOrAdmin() && !owned.some((store) => store.territory)) return [];
    const scored = owned.map((store) => ({ store, score: storeScore(store) }));
    const top = scored.sort((a, b) => b.score - a.score).slice(0, 20);
    const buckets = new Map();
    top.forEach((item) => {
      const key = item.store.zipCode || `${item.store.city || ""}|${item.store.state || ""}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(item);
    });
    const bestBucket = Array.from(buckets.values()).sort((a, b) => sumScore(b) - sumScore(a))[0] || [];
    const picked = bestBucket.sort((a, b) => b.score - a.score).map((item) => item.store);
    top.forEach((item) => {
      if (!picked.some((store) => store.id === item.store.id)) picked.push(item.store);
    });
    return picked;
  }

  async function updatePlanStatus(planId, status) {
    const { error } = await state.client.from(PLAN_TABLE).update({ status }).eq("id", planId);
    if (error) return showMessage(error.message || "Could not update plan.");
    await refreshData({ silent: true });
  }

  async function logVisit(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    const store = state.stores.find((item) => item.id === data.storeId);
    if (!store || !state.session) return;
    const visitedAt = new Date(`${data.visitedDate || today()}T12:00:00`).toISOString();
    const { data: inserted, error } = await state.client.from(VISIT_TABLE).insert({
      store_id: store.id,
      store_number: store.storeNumber,
      user_id: state.session.user.id,
      visited_at: visitedAt,
      outcome: data.outcome || "Visited",
      notes: String(data.notes || "").trim() || null
    }).select("id").single();
    if (error) return showMessage(error.message || "Could not log visit.");

    await state.client
      .from(PLAN_TABLE)
      .update({ status: "visited", visit_id: inserted.id })
      .eq("store_id", store.id)
      .eq("user_id", state.session.user.id)
      .eq("week_start", mondayOf(data.visitedDate || today()));
    form.reset();
    await refreshData({ silent: true });
  }

  async function saveContact(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    const { error } = await state.client.from(CONTACT_TABLE).insert({
      store_id: data.storeId,
      role_code: data.roleCode,
      full_name: String(data.fullName || "").trim(),
      phone: String(data.phone || "").trim() || null,
      email: String(data.email || "").trim() || null,
      notes: String(data.notes || "").trim() || null,
      updated_by: state.session.user.id
    });
    if (error) return showMessage(error.message || "Could not save contact.");
    form.reset();
    await refreshData({ silent: true });
  }

  async function addStoreRole(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    const label = String(data.label || "").trim();
    if (!label) return;
    const code = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const sortOrder = (state.storeRoles.length + 1) * 10;
    const { error } = await state.client.from(ROLE_TABLE).upsert({
      code,
      label,
      sort_order: sortOrder,
      active: true
    });
    if (error) return showMessage(error.message || "Could not add role.");
    form.reset();
    await refreshData({ silent: true });
  }

  async function importStores(form) {
    const csv = String(new FormData(form).get("csv") || "").trim();
    if (!csv) return;
    const rows = parseStoreImport(csv);
    const stores = rows.map(importRowToStore).filter(Boolean);
    if (!stores.length) return showMessage("No valid store rows found. Store number is required.");
    const { data, error } = await state.client.from(STORE_TABLE).upsert(stores, { onConflict: "store_number" }).select("id, store_number");
    if (error) return showMessage(error.message || "Could not import stores.");

    const visitRows = rowsToHistoricalVisits(rows, data || []);
    if (visitRows.length) {
      await state.client.from(VISIT_TABLE).insert(visitRows);
    }
    form.reset();
    showMessage(`${stores.length} stores imported or updated.`);
    await refreshData({ silent: true });
  }

  function importRowToStore(row) {
    const sourceUrl = getField(row, ["source_url", "home_depot_url", "store_url", "url"]);
    const sourceData = parseHomeDepotStoreUrl(sourceUrl);
    const storeNumber = getStoreNumber(row, sourceData);
    if (!storeNumber) return null;
    const assignedEmail = getField(row, ["assigned_rep_email", "rep_email", "owner_email", "email"]);
    const assignedName = getField(row, ["assigned_rep_name", "rep", "owner", "sales_rep"]);
    const profile = findProfile(assignedEmail || assignedName);
    return {
      store_number: storeNumber,
      retailer: getField(row, ["retailer", "chain"]) || "Home Depot",
      name: getField(row, ["name", "store_name"]) || sourceData.name || `Home Depot #${storeNumber}`,
      street: getField(row, ["street", "address", "street_address"]),
      city: getField(row, ["city"]) || sourceData.city,
      state: getField(row, ["state"]) || sourceData.state,
      zip_code: getField(row, ["zip", "zip_code", "postal_code"]) || sourceData.zipCode,
      phone: getField(row, ["phone", "phone_number", "store_phone"]),
      source_url: sourceUrl || sourceData.sourceUrl,
      latitude: numberOrNull(getField(row, ["latitude", "lat"])),
      longitude: numberOrNull(getField(row, ["longitude", "lng", "lon"])),
      territory: getField(row, ["territory", "market"]),
      assigned_to: profile?.user_id || null,
      assigned_rep_name: profileName(profile) || assignedName || null,
      volume_tier: normalizeTier(getField(row, ["tier", "volume_tier"])),
      annual_volume: numberOrNull(getField(row, ["annual_volume", "volume"])),
      notes: getField(row, ["notes"])
    };
  }

  function rowsToHistoricalVisits(rows, importedStores) {
    if (!state.session) return [];
    return rows.map((row) => {
      const date = getField(row, ["last_visit_date", "visit_date", "visited_at"]);
      if (!date) return null;
      const storeNumber = getStoreNumber(row, parseHomeDepotStoreUrl(getField(row, ["source_url", "home_depot_url", "store_url", "url"])));
      const store = importedStores.find((item) => String(item.store_number) === String(storeNumber));
      if (!store) return null;
      const profile = findProfile(getField(row, ["last_visit_rep_email", "visit_rep_email", "rep_email"]));
      return {
        store_id: store.id,
        store_number: storeNumber,
        user_id: profile?.user_id || state.session.user.id,
        visited_at: new Date(`${date.slice(0, 10)}T12:00:00`).toISOString(),
        outcome: getField(row, ["last_visit_outcome", "outcome"]) || "Imported visit",
        notes: getField(row, ["last_visit_notes", "visit_notes", "notes"]) || null
      };
    }).filter(Boolean);
  }

  function filteredStores() {
    const query = state.filters.search.trim().toLowerCase();
    return state.stores.filter((store) => {
      if (state.filters.freshness !== "all" && freshnessFor(store).status !== state.filters.freshness) return false;
      if (state.filters.owner !== "all" && (state.filters.owner === "unassigned" ? store.assignedTo : store.assignedTo !== state.filters.owner)) return false;
      if (!query) return true;
      const contacts = contactsFor(store.id).map((contact) => contact.full_name).join(" ");
      return [
        store.storeNumber,
        store.name,
        store.city,
        store.state,
        store.zipCode,
        store.phone,
        store.territory,
        store.assignedRepName,
        contacts
      ].join(" ").toLowerCase().includes(query);
    });
  }

  function storeMetrics(stores) {
    const weekStart = new Date(`${state.weekStart}T00:00:00`);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekVisits = state.visits.filter((visit) => {
      const date = new Date(visit.visited_at);
      return date >= weekStart && date < weekEnd && (!isManagerOrAdmin() ? visit.user_id === state.session.user.id : true);
    }).length;
    return {
      total: stores.length,
      never: stores.filter((store) => freshnessFor(store).status === "never").length,
      needVisit: stores.filter((store) => ["never", "stale", "overdue"].includes(freshnessFor(store).status)).length,
      weekVisits
    };
  }

  function storeScore(store) {
    const freshness = freshnessFor(store);
    const age = freshness.days === null ? 120 : Math.min(freshness.days, 120);
    const tier = store.volumeTier === "A" ? 30 : store.volumeTier === "B" ? 15 : 5;
    const missing = missingRoles(store).length * 3;
    return age + tier + missing;
  }

  function sumScore(items) {
    return items.reduce((sum, item) => sum + item.score, 0);
  }

  function freshnessFor(store) {
    const rollup = state.rollups.find((item) => item.store_id === store.id);
    const last = rollup?.last_visit_at || visitsFor(store.id)[0]?.visited_at || "";
    if (!last) return { status: "never", label: "Never visited", days: null };
    const days = daysBetween(last, today());
    if (days <= FRESH_DAYS) return { status: "fresh", label: `${days}d fresh`, days };
    if (days <= OVERDUE_DAYS) return { status: "stale", label: `${days}d stale`, days };
    return { status: "overdue", label: `${days}d overdue`, days };
  }

  function missingRoles(store) {
    const contacts = contactsFor(store.id);
    const present = new Set(contacts.map((contact) => contact.role_code));
    return state.storeRoles.filter((role) => role.active && !present.has(role.code));
  }

  function contactsFor(storeId) {
    return state.contacts.filter((contact) => contact.store_id === storeId);
  }

  function visitsFor(storeId) {
    return state.visits.filter((visit) => visit.store_id === storeId);
  }

  function weekPlans() {
    return state.plans.filter((plan) => isManagerOrAdmin() || plan.user_id === state.session.user.id);
  }

  function storeFromRow(row) {
    return {
      id: row.id,
      storeNumber: row.store_number,
      retailer: row.retailer,
      name: row.name,
      street: row.street,
      city: row.city,
      state: row.state,
      zipCode: row.zip_code,
      phone: row.phone,
      sourceUrl: row.source_url,
      latitude: row.latitude,
      longitude: row.longitude,
      territory: row.territory,
      assignedTo: row.assigned_to,
      assignedRepName: row.assigned_rep_name,
      volumeTier: row.volume_tier,
      annualVolume: row.annual_volume,
      active: row.active,
      notes: row.notes
    };
  }

  function parseStoreImport(text) {
    const firstLine = String(text || "").split(/\r?\n/).find((line) => line.trim()) || "";
    if (looksLikeStoreCsv(firstLine)) return parseCsv(text);
    const directoryRows = parseHomeDepotDirectory(text);
    return directoryRows.length ? directoryRows : parseCsv(text);
  }

  function looksLikeStoreCsv(firstLine) {
    if (!firstLine.includes(",")) return false;
    const headers = splitCsvLine(firstLine).map(normalizeHeader);
    return headers.some((header) => [
      "store_number",
      "source_url",
      "home_depot_url",
      "store_url",
      "assigned_rep_email"
    ].includes(header));
  }

  function parseHomeDepotDirectory(text) {
    const htmlRows = parseHomeDepotHtmlRows(text);
    if (htmlRows.length) return htmlRows;

    const seen = new Set();
    const rows = [];
    const urlRegex = /https?:\/\/(?:www\.)?homedepot\.com\/l\/[^\s"'<)]+/gi;
    for (const match of String(text || "").matchAll(urlRegex)) {
      const sourceUrl = cleanStoreUrl(match[0]);
      const sourceData = parseHomeDepotStoreUrl(sourceUrl);
      if (!sourceData.storeNumber || seen.has(sourceData.storeNumber)) continue;
      seen.add(sourceData.storeNumber);
      rows.push({
        store_number: sourceData.storeNumber,
        name: sourceData.name,
        city: sourceData.city,
        state: sourceData.state,
        zip: sourceData.zipCode,
        source_url: sourceUrl
      });
    }
    return rows;
  }

  function parseHomeDepotHtmlRows(text) {
    const html = String(text || "");
    const linkRegex = /href=["']([^"']*\/l\/[^"']+?\/[A-Z]{2}\/[^"']+?\/\d{5}(?:-\d{4})?\/\d+)(?:[?#][^"']*)?["'][^>]*>([\s\S]*?)<\/a>/gi;
    const matches = [];
    let match = linkRegex.exec(html);
    while (match) {
      const sourceUrl = cleanStoreUrl(match[1]);
      const sourceData = parseHomeDepotStoreUrl(sourceUrl);
      if (sourceData.storeNumber && !matches.some((item) => item.sourceData.storeNumber === sourceData.storeNumber)) {
        matches.push({
          index: match.index,
          sourceUrl,
          sourceData,
          title: htmlToLines(match[2])[0] || sourceData.name
        });
      }
      match = linkRegex.exec(html);
    }

    return matches.map((item, index) => {
      const block = html.slice(item.index, matches[index + 1]?.index || html.length);
      const details = extractDirectoryBlockData(block, item.title);
      return {
        store_number: item.sourceData.storeNumber,
        name: item.title || item.sourceData.name,
        street: details.street,
        city: details.city || item.sourceData.city,
        state: details.state || item.sourceData.state,
        zip: details.zipCode || item.sourceData.zipCode,
        phone: details.phone,
        source_url: item.sourceUrl
      };
    });
  }

  function extractDirectoryBlockData(block, title) {
    const titleText = normalizeSpaces(title).toLowerCase();
    const lines = htmlToLines(block).filter((line) => {
      const lower = line.toLowerCase();
      if (lower === titleText) return false;
      return !/( rentals| home services| garden center| pro desk)$/.test(lower);
    });
    const cityLine = lines.map(parseCityStateZip).find(Boolean);
    const phone = lines.map(parsePhone).find(Boolean) || "";
    const street = lines.find((line) => {
      if (!/\d/.test(line)) return false;
      if (parseCityStateZip(line) || parsePhone(line)) return false;
      return !/^#?\d+$/.test(line);
    }) || "";

    return {
      street,
      city: cityLine?.city || "",
      state: cityLine?.state || "",
      zipCode: cityLine?.zipCode || "",
      phone
    };
  }

  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (!lines.length) return [];
    const header = splitCsvLine(lines[0]).map(normalizeHeader);
    return lines.slice(1).map((line) => {
      const values = splitCsvLine(line);
      return header.reduce((row, key, index) => {
        row[key] = values[index] || "";
        return row;
      }, {});
    });
  }

  function splitCsvLine(line) {
    const cells = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];
      if (char === '"' && quoted && next === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        cells.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    return cells;
  }

  function normalizeHeader(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
  }

  function getField(row, aliases) {
    for (const alias of aliases) {
      const key = normalizeHeader(alias);
      if (row[key]) return String(row[key]).trim();
    }
    return "";
  }

  function getStoreNumber(row, sourceData = {}) {
    return getField(row, ["store_number", "store #", "store#", "store no", "store", "number"]) || sourceData.storeNumber || "";
  }

  function parseHomeDepotStoreUrl(value) {
    const cleaned = cleanStoreUrl(value);
    if (!cleaned) return {};
    const match = cleaned.match(/\/l\/([^/?#]+)\/([a-z]{2})\/([^/?#]+)\/(\d{5}(?:-\d{4})?)\/(\d+)/i);
    if (!match) return {};
    return {
      name: titleFromSlug(match[1]),
      state: match[2].toUpperCase(),
      city: titleFromSlug(match[3]),
      zipCode: match[4].slice(0, 5),
      storeNumber: match[5],
      sourceUrl: cleaned
    };
  }

  function cleanStoreUrl(value) {
    const raw = String(value || "").trim().replace(/&amp;/g, "&").replace(/[),.;]+$/g, "");
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    return `https://www.homedepot.com${raw.startsWith("/") ? "" : "/"}${raw}`;
  }

  function htmlToLines(html) {
    return decodeHtml(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(a|div|h[1-6]|li|p|span)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .split(/\n+/)
      .map(normalizeSpaces)
      .filter(Boolean);
  }

  function decodeHtml(value) {
    return String(value || "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'");
  }

  function normalizeSpaces(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function parseCityStateZip(line) {
    const match = normalizeSpaces(line).match(/^(.+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (!match) return null;
    return { city: match[1], state: match[2], zipCode: match[3].slice(0, 5) };
  }

  function parsePhone(line) {
    const match = normalizeSpaces(line).match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
    if (!match) return "";
    const digits = match[0].replace(/\D/g, "");
    return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : match[0];
  }

  function titleFromSlug(value) {
    const text = decodeURIComponent(String(value || ""))
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    return text.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()).replace(/\bDc\b/g, "DC");
  }

  function findProfile(value) {
    const needle = String(value || "").trim().toLowerCase();
    if (!needle) return null;
    return state.profiles.find((profile) => (
      String(profile.email || "").toLowerCase() === needle ||
      String(profile.full_name || "").toLowerCase() === needle
    )) || null;
  }

  function exportStores() {
    const rows = filteredStores().map((store) => {
      const freshness = freshnessFor(store);
      return {
        "Store Number": store.storeNumber,
        Name: store.name,
        Street: store.street || "",
        City: store.city || "",
        State: store.state || "",
        ZIP: store.zipCode || "",
        Phone: store.phone || "",
        "Source URL": store.sourceUrl || "",
        Territory: store.territory || "",
        Rep: store.assignedRepName || "",
        Tier: store.volumeTier || "",
        Freshness: freshness.label,
        "Missing Roles": missingRoles(store).map((role) => role.label).join("; ")
      };
    });
    downloadCsv(toCsv(rows), `cis-stores-${today()}.csv`);
  }

  function toCsv(rows) {
    if (!rows.length) return "";
    const headers = Object.keys(rows[0]);
    return [
      headers.join(","),
      ...rows.map((row) => headers.map((header) => quoteCsv(row[header])).join(","))
    ].join("\n");
  }

  function quoteCsv(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function downloadCsv(csv, filename) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function showMessage(message) {
    state.message = message;
    renderStores();
    window.setTimeout(() => {
      if (state.message === message) {
        state.message = "";
        renderStores();
      }
    }, 4500);
  }

  function isAdmin() {
    return state.roles.includes("admin");
  }

  function isManagerOrAdmin() {
    return state.roles.includes("admin") || state.roles.includes("manager");
  }

  function profileName(profile) {
    if (!profile) return "";
    return profile.full_name || profile.email || "";
  }

  function formatStoreLocation(store) {
    const cityStateZip = [store.city, [store.state, store.zipCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    return [store.street, cityStateZip].filter(Boolean).join(" | ");
  }

  function metric(label, value) {
    return `<article class="store-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
  }

  function option(value, label, selected) {
    return `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }

  function profileOptions(selected, includeUnassigned = false) {
    const profiles = state.profiles
      .filter((profile) => profile.active || profile.user_id === selected)
      .sort((a, b) => profileName(a).localeCompare(profileName(b)));
    return `${includeUnassigned ? `<option value="" ${!selected ? "selected" : ""}>Unassigned</option>` : ""}${profiles.map((profile) => `<option value="${escapeHtml(profile.user_id)}" ${profile.user_id === selected ? "selected" : ""}>${escapeHtml(profileName(profile))}</option>`).join("")}`;
  }

  function profileFilterOptions(selected) {
    return `<option value="all" ${selected === "all" ? "selected" : ""}>All owners</option><option value="unassigned" ${selected === "unassigned" ? "selected" : ""}>Unassigned</option>${profileOptions(selected, false)}`;
  }

  function renderEmpty(message) {
    return `<p class="empty-state">${escapeHtml(message)}</p>`;
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function mondayOf(value) {
    const date = new Date(`${String(value || today()).slice(0, 10)}T00:00:00`);
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    return date.toISOString().slice(0, 10);
  }

  function addDays(value, days) {
    const date = new Date(`${value}T00:00:00`);
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function daysBetween(start, end) {
    const a = new Date(`${String(start).slice(0, 10)}T00:00:00`);
    const b = new Date(`${String(end).slice(0, 10)}T00:00:00`);
    return Math.max(0, Math.round((b - a) / 86400000));
  }

  function formatDate(value) {
    if (!value) return "";
    const [year, month, day] = String(value).slice(0, 10).split("-");
    return `${Number(month)}/${Number(day)}/${year}`;
  }

  function normalizeTier(value) {
    const tier = String(value || "B").trim().toUpperCase();
    return ["A", "B", "C"].includes(tier) ? tier : "B";
  }

  function numberOrNull(value) {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(String(value).replace(/[$,]/g, ""));
    return Number.isFinite(number) ? number : null;
  }

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
    } else {
      callback();
    }
  }

  function injectStyles() {
    if (document.getElementById("stores-styles")) return;
    const style = document.createElement("style");
    style.id = "stores-styles";
    style.textContent = `
      .stores-heading-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
      .store-metrics{display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:8px}
      .store-metric{display:grid;gap:3px;min-height:68px;padding:11px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel-soft)}
      .store-metric span{color:var(--muted);font-size:.78rem;font-weight:850}
      .store-metric strong{font-size:1.15rem}
      .store-toolbar,.store-import,.store-week{display:grid;gap:10px;padding:12px;border:1px solid var(--line);border-radius:8px;background:#fff}
      .store-toolbar{grid-template-columns:repeat(auto-fit,minmax(150px,1fr));align-items:end}
      .store-toolbar-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
      .stores-layout{display:grid;grid-template-columns:minmax(300px,.9fr) minmax(420px,1.1fr);gap:12px;min-width:0}
      .stores-list,.store-detail{display:grid;align-content:start;gap:10px;min-width:0}
      .stores-list-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 2px}
      .stores-list-head h3{margin:0;font-size:1rem}
      .stores-list-head strong{display:inline-grid;place-items:center;min-width:34px;height:28px;padding:0 8px;border-radius:999px;background:var(--panel-soft);color:var(--muted)}
      .store-card,.contact-role,.week-plan-item{min-width:0;border:1px solid var(--line);border-radius:8px;background:#fff}
      .store-card{display:grid;gap:10px;padding:10px;border-left:4px solid var(--line-strong)}
      .store-card.is-selected{border-color:#ffc77d;box-shadow:0 0 0 2px rgba(255,133,0,.16)}
      .store-card.freshness-fresh{border-left-color:var(--green)}
      .store-card.freshness-stale{border-left-color:#e0a400}
      .store-card.freshness-overdue,.store-card.freshness-never{border-left-color:var(--red)}
      .store-main,.store-link{display:grid;gap:2px;width:100%;padding:0;border:0;background:transparent;color:inherit;text-align:left}
      .store-number{width:max-content;max-width:100%;padding:4px 7px;border-radius:999px;background:var(--orange-soft);color:#8d4a00;font-size:.76rem;font-weight:900}
      .store-main strong,.store-link strong,.store-detail-heading h3{overflow-wrap:anywhere}
      .store-main small,.store-link span,.store-detail-heading p{color:var(--muted)}
      .store-facts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0}
      .store-facts dt{color:var(--quiet);font-size:.7rem;font-weight:900;text-transform:uppercase}
      .store-facts dd{margin:2px 0 0;overflow-wrap:anywhere}
      .store-card-owner{display:grid;gap:4px;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--panel-soft)}
      .store-card-owner span{color:var(--quiet);font-size:.72rem;font-weight:900;text-transform:uppercase}
      .store-card-owner select{min-height:36px;padding:7px 9px;background:#fff}
      .store-detail-backdrop,.store-detail-close{display:none}
      .store-detail{padding:12px;border:1px solid var(--line);border-radius:8px;background:#fff}
      .store-detail-heading,.store-section-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
      .store-detail-heading h3,.store-section-heading h3{margin:0;font-size:1rem}
      .store-section-heading p{margin:3px 0 0;color:var(--muted);font-size:.86rem}
      .store-detail-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
      .store-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;min-width:0}
      .contact-grid{display:grid;gap:8px;margin:10px 0}
      .contact-role{display:grid;gap:3px;padding:9px;background:var(--panel-soft)}
      .contact-role.is-missing{border-color:#ffb2b2;background:var(--red-soft)}
      .contact-role small{color:var(--muted)}
      .store-form,.store-role-form{display:grid;gap:10px;min-width:0}
      .store-admin-setup{display:grid;gap:10px;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--panel-soft)}
      .store-admin-setup .store-form{gap:8px}
      .store-admin-setup input,.store-admin-setup select{min-height:36px;padding:7px 9px}
      .store-admin-setup input[type="checkbox"]{width:18px;min-height:18px;height:18px;padding:0}
      .store-admin-setup .checkbox-row{display:flex;align-items:center;gap:8px}
      .store-admin-setup .button{justify-self:start;min-height:36px;padding:0 12px}
      .store-role-form{grid-template-columns:minmax(220px,1fr) auto;align-items:end;margin-top:10px}
      .store-visit-list{display:grid;gap:8px;margin:12px 0 0;padding-left:20px}
      .store-visit-list li{padding-bottom:8px;border-bottom:1px solid var(--line)}
      .store-visit-list time{display:block;color:var(--muted);font-weight:850}
      .week-plan-list{display:grid;gap:8px}
      .week-plan-item{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;align-items:center;gap:8px;padding:9px}
      .week-plan-item.visited{background:var(--green-soft)}
      .stores-alert{margin:0;padding:10px 12px;border:1px solid #ffc77d;border-radius:8px;background:var(--orange-soft);color:#7a4100;font-weight:800}
      @media(max-width:980px){.store-toolbar,.stores-layout,.store-detail-grid{grid-template-columns:1fr}.store-toolbar-actions{justify-content:stretch}.store-toolbar-actions .button{flex:1 1 150px}.store-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.week-plan-item{grid-template-columns:1fr}}
      @media(max-width:760px){.store-toolbar{position:sticky;top:110px;z-index:22}.store-toolbar-actions{display:grid;grid-template-columns:1fr 1fr}.store-toolbar-actions .button{min-width:0}.stores-layout{display:block}.stores-list{display:grid}.stores-layout .store-detail{display:none}.store-detail-backdrop.is-open{position:fixed;inset:0;z-index:88;display:block;border:0;background:rgba(12,18,24,.52)}.stores-layout.is-detail-open .store-detail{position:fixed;inset:0;z-index:92;display:grid;max-height:none;overflow:auto;padding:12px 12px calc(18px + env(safe-area-inset-bottom));border:0;border-radius:0;box-shadow:none}.stores-layout.is-detail-open .store-detail-heading{position:sticky;top:-12px;z-index:2;margin:-12px -12px 0;padding:12px;border-bottom:1px solid var(--line);background:#fff}.stores-layout.is-detail-open .store-detail-close{display:grid;place-items:center}.store-detail-tools{justify-content:space-between}.store-card-owner{grid-template-columns:72px minmax(0,1fr);align-items:center}.store-card-owner span{font-size:.68rem}.store-card-owner select{width:100%;min-width:0}.store-form .form-row,.store-form .form-row.three{grid-template-columns:1fr}.contact-role{padding:10px}.store-visit-list{padding-left:18px}}
      @media(max-width:560px){.store-metrics,.store-facts{grid-template-columns:1fr}.stores-heading-actions{justify-content:stretch}.store-toolbar-actions{grid-template-columns:1fr}}
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
})();
