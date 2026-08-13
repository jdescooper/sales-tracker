(function () {
  const STORE_TABLE = "crm_stores";
  const REFERENCE_URL = "assets/home-depot-reference-stores.csv?v=20260813-2";

  const state = {
    client: null,
    session: null,
    roles: [],
    profiles: [],
    setupStoreNumber: "",
    busy: false
  };

  onReady(init);

  function init() {
    state.client = createClient();
    if (!state.client) return;
    refreshAccess();
    state.client.auth.onAuthStateChange((_event, session) => {
      state.session = session || null;
      refreshAccess();
    });
    const observer = new MutationObserver(syncButton);
    observer.observe(document.body, { childList: true, subtree: true });
    syncButton();
  }

  function createClient() {
    const config = window.CIS_CONFIG || {};
    if (!window.supabase || !config.supabaseUrl || !config.supabaseAnonKey) return null;
    return window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }

  async function refreshAccess() {
    const { data } = await state.client.auth.getSession();
    state.session = data?.session || null;
    state.roles = [];
    if (state.session) {
      const { data: roles } = await state.client
        .from("user_roles")
        .select("role")
        .eq("user_id", state.session.user.id);
      state.roles = (roles || []).map((row) => row.role);
      if (isAdmin()) await loadProfiles();
    }
    syncButton();
  }

  async function loadProfiles() {
    const { data } = await state.client
      .from("profiles")
      .select("user_id, full_name, email, active")
      .eq("active", true)
      .order("full_name", { ascending: true });
    state.profiles = data || [];
  }

  function syncButton() {
    const toolbar = document.querySelector("#view-stores .store-toolbar-actions");
    if (toolbar && isAdmin() && !toolbar.querySelector("[data-load-home-depot-reference]")) {
      const button = document.createElement("button");
      button.className = "button secondary";
      button.type = "button";
      button.dataset.loadHomeDepotReference = "true";
      button.textContent = "Load Home Depot Reference";
      button.addEventListener("click", loadReference);
      const importButton = toolbar.querySelector("[data-toggle-store-import]");
      importButton ? toolbar.insertBefore(button, importButton) : toolbar.appendChild(button);
    }
    syncSetupForm();
  }

  async function loadReference() {
    if (state.busy) return;
    state.busy = true;
    setStatus("Loading Home Depot reference stores...");
    try {
      const response = await fetch(REFERENCE_URL, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load the Home Depot reference file.");
      const rows = parseCsv(await response.text());
      const stores = rows.map(rowToStore).filter(Boolean);
      if (!stores.length) throw new Error("The Home Depot reference file did not contain valid stores.");
      const { error } = await state.client.from(STORE_TABLE).upsert(stores, { onConflict: "store_number" });
      if (error) throw error;
      setStatus(`${stores.length} Home Depot reference stores loaded.`);
      document.querySelector("[data-stores-refresh]")?.click();
    } catch (error) {
      setStatus(error.message || "Could not load Home Depot reference stores.");
    } finally {
      state.busy = false;
    }
  }

  function rowToStore(row) {
    const storeNumber = field(row, ["store_number", "store", "number"]);
    if (!storeNumber) return null;
    return {
      store_number: storeNumber,
      retailer: "Home Depot",
      name: field(row, ["name", "store_name"]) || `Home Depot #${storeNumber}`,
      street: field(row, ["street", "street_address", "address"]),
      city: field(row, ["city"]),
      state: field(row, ["state"]),
      zip_code: field(row, ["zip", "zip_code", "postal_code"]),
      phone: field(row, ["phone", "store_phone"]),
      pro_desk_phone: field(row, ["pro_desk_phone", "prodesk_phone", "pro_service_desk_phone"]),
      rental_phone: field(row, ["rental_phone", "rental_center_phone"]),
      source_url: field(row, ["source_url", "home_depot_url", "store_url", "url"]),
      territory: field(row, ["territory", "market"]),
      volume_tier: normalizeTier(field(row, ["tier", "volume_tier"])),
      annual_volume: numberOrNull(field(row, ["annual_volume", "volume"])),
      latitude: numberOrNull(field(row, ["latitude", "lat"])),
      longitude: numberOrNull(field(row, ["longitude", "lng", "lon"])),
      active: true
    };
  }

  async function syncSetupForm() {
    if (!isAdmin()) return;
    const detail = document.querySelector("#view-stores .store-detail");
    const storeNumber = selectedStoreNumber(detail);
    const existing = detail?.querySelector("[data-store-reference-setup]");
    if (!detail || !storeNumber || (state.setupStoreNumber === storeNumber && existing)) return;
    state.setupStoreNumber = storeNumber;
    existing?.remove();
    const { data: store } = await state.client
      .from(STORE_TABLE)
      .select("id, store_number, territory, assigned_to, volume_tier, active")
      .eq("store_number", storeNumber)
      .maybeSingle();
    if (!store) return;
    const form = document.createElement("section");
    form.className = "store-admin-setup";
    form.dataset.storeReferenceSetup = "true";
    form.innerHTML = renderSetupForm(store);
    form.addEventListener("submit", saveSetup);
    const anchor = detail.querySelector(".store-detail-grid");
    anchor ? detail.insertBefore(form, anchor) : detail.appendChild(form);
  }

  function selectedStoreNumber(detail) {
    const text = detail?.querySelector(".store-number")?.textContent || "";
    return text.replace("#", "").trim();
  }

  function renderSetupForm(store) {
    return `
      <div class="store-section-heading">
        <div>
          <h3>Store setup</h3>
          <p>Assign this Home Depot reference store to a rep or territory.</p>
        </div>
      </div>
      <form class="store-form" data-store-reference-setup-form>
        <input type="hidden" name="storeId" value="${escapeHtml(store.id)}">
        <div class="form-row">
          <label>
            Owner
            <select name="assignedTo">
              <option value="">Unassigned</option>
              ${state.profiles.map((profile) => `<option value="${escapeHtml(profile.user_id)}" ${profile.user_id === store.assigned_to ? "selected" : ""}>${escapeHtml(profileName(profile))}</option>`).join("")}
            </select>
          </label>
          <label>Territory<input name="territory" value="${escapeHtml(store.territory || "")}"></label>
        </div>
        <div class="form-row three">
          <label>
            Tier
            <select name="volumeTier">
              ${["A", "B", "C"].map((tier) => `<option value="${tier}" ${tier === store.volume_tier ? "selected" : ""}>${tier}</option>`).join("")}
            </select>
          </label>
          <label class="checkbox-row"><input name="active" type="checkbox" ${store.active ? "checked" : ""}> Active</label>
          <button class="button secondary" type="submit">Save Setup</button>
        </div>
      </form>
    `;
  }

  async function saveSetup(event) {
    event.preventDefault();
    const form = event.target;
    const data = Object.fromEntries(new FormData(form).entries());
    const profile = state.profiles.find((item) => item.user_id === data.assignedTo);
    const { error } = await state.client.from(STORE_TABLE).update({
      assigned_to: data.assignedTo || null,
      assigned_rep_name: profileName(profile) || null,
      territory: String(data.territory || "").trim() || null,
      volume_tier: normalizeTier(data.volumeTier),
      active: data.active === "on"
    }).eq("id", data.storeId);
    if (error) return setStatus(error.message || "Could not save store setup.");
    state.setupStoreNumber = "";
    setStatus("Store setup saved.");
    document.querySelector("[data-stores-refresh]")?.click();
  }

  function parseCsv(text) {
    const lines = String(text || "").split(/\r?\n/).filter((line) => line.trim());
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

  function field(row, aliases) {
    for (const alias of aliases) {
      const value = row[normalizeHeader(alias)];
      if (value) return String(value).trim();
    }
    return "";
  }

  function normalizeHeader(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
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

  function isAdmin() {
    return state.roles.includes("admin");
  }

  function profileName(profile) {
    return profile?.full_name || profile?.email || "";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function setStatus(message) {
    const status = document.getElementById("app-status");
    if (status) status.textContent = message;
  }

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
    } else {
      callback();
    }
  }
})();
