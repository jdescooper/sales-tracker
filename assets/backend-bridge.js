(function () {
  const STORAGE_KEY = "cis-lead-crm-v3";
  const BACKUP_KEY = "cis-lead-crm-pre-backend-import-v1";
  const STORAGE_VERSION = 3;
  const config = window.CIS_CONFIG || {};
  const hasClient = window.supabase && config.supabaseUrl && config.supabaseAnonKey;
  const client = hasClient ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey) : null;
  const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
  const originalRemoveItem = window.localStorage.removeItem.bind(window.localStorage);
  const state = { session: null, loading: false, syncTimer: 0, suppressSync: false, backupCount: 0 };

  injectStyles();
  init();

  async function init() {
    ensurePanel();
    if (!client) {
      renderPanel("local", "Local browser data only", "Supabase is not configured for this deployment.");
      loadApp();
      return;
    }

    patchStorageSync();
    renderPanel("pending", "Checking shared backend", "Looking for an active sign-in.");

    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      state.session = data.session || null;
      client.auth.onAuthStateChange((event, session) => {
        state.session = session || null;
        if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
        if (["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED", "PASSWORD_RECOVERY"].includes(event)) {
          window.location.reload();
        }
      });

      if (!state.session) {
        renderSignIn("Sign in to use shared team data.");
        loadApp();
        return;
      }

      const localBackup = backupLocalLeads();
      state.backupCount = localBackup.length;
      await ensureProfile();
      await loadRemoteLeads();
      renderConnected();
      loadApp();
    } catch (error) {
      renderPanel("error", "Shared backend issue", error.message || "Could not connect to Supabase.");
      loadApp();
    }
  }

  function ensurePanel() {
    let panel = document.getElementById("connection-panel");
    if (panel) return panel;
    const workspace = document.getElementById("workspace");
    panel = document.createElement("section");
    panel.id = "connection-panel";
    panel.className = "connection-panel";
    panel.setAttribute("aria-label", "Data connection");
    workspace.insertBefore(panel, workspace.firstElementChild);
    return panel;
  }

  function injectStyles() {
    if (document.getElementById("backend-bridge-styles")) return;
    const style = document.createElement("style");
    style.id = "backend-bridge-styles";
    style.textContent = `
      .connection-panel { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 12px; border:1px solid var(--line); border-radius:8px; background:#fff; box-shadow:var(--shadow); }
      .connection-copy { display:flex; align-items:center; gap:10px; min-width:0; }
      .connection-copy strong,.connection-copy p { margin:0; }
      .connection-copy strong { display:block; font-size:.92rem; }
      .connection-copy p,.connection-status { color:var(--muted); font-size:.82rem; font-weight:750; }
      .connection-dot { flex:0 0 auto; width:10px; height:10px; border-radius:50%; background:var(--quiet); box-shadow:0 0 0 4px #eef2f5; }
      .connection-dot.online { background:var(--green); box-shadow:0 0 0 4px var(--green-soft); }
      .connection-dot.pending { background:var(--orange); box-shadow:0 0 0 4px var(--orange-soft); }
      .connection-dot.error { background:var(--red); box-shadow:0 0 0 4px var(--red-soft); }
      .connection-actions,.auth-actions { display:flex; align-items:center; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
      .auth-form { display:grid; grid-template-columns:minmax(170px,1fr) minmax(150px,1fr) auto; align-items:end; gap:8px; min-width:min(100%,620px); }
      .connection-panel .button.ghost { border-color:var(--line-strong); background:#fff; color:var(--ink); }
      @media (max-width:1180px) { .connection-panel { align-items:stretch; flex-direction:column; } .connection-actions { justify-content:flex-start; } .auth-form { width:100%; } }
      @media (max-width:760px) { .auth-form { grid-template-columns:1fr; } .auth-actions { justify-content:stretch; } .auth-actions .button { flex:1 1 120px; } }
    `;
    document.head.appendChild(style);
  }

  function renderPanel(kind, title, message, actions = "") {
    const panel = ensurePanel();
    panel.innerHTML = `
      <div class="connection-copy">
        <span class="connection-dot ${kind}" aria-hidden="true"></span>
        <div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div>
      </div>
      ${actions}
    `;
  }

  function renderSignIn(message) {
    const panel = ensurePanel();
    panel.innerHTML = `
      <div class="connection-copy">
        <span class="connection-dot pending" aria-hidden="true"></span>
        <div><strong>Shared backend ready</strong><p>${escapeHtml(message)}</p></div>
      </div>
      <form class="auth-form" id="bridge-auth-form">
        <label><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
        <label><span>Password</span><input name="password" type="password" autocomplete="current-password" minlength="6" required></label>
        <div class="auth-actions">
          <button class="button primary" name="mode" value="signin" type="submit">Sign In</button>
          <button class="button secondary" name="mode" value="signup" type="submit">Create User</button>
        </div>
      </form>
    `;
    document.getElementById("bridge-auth-form").addEventListener("submit", handleAuthSubmit);
  }

  function renderConnected(message = "Team data is shared.") {
    const importButton = state.backupCount ? `<button class="button secondary" id="bridge-import-local" type="button">Import Local Data</button>` : "";
    renderPanel("online", "Shared backend connected", state.session.user.email || message, `
      <div class="connection-actions">
        <span class="connection-status">${escapeHtml(message)}</span>
        ${importButton}
        <button class="button secondary" id="bridge-refresh" type="button">Refresh</button>
        <button class="button ghost" id="bridge-signout" type="button">Sign Out</button>
      </div>
    `);
    document.getElementById("bridge-refresh")?.addEventListener("click", () => window.location.reload());
    document.getElementById("bridge-signout")?.addEventListener("click", signOut);
    document.getElementById("bridge-import-local")?.addEventListener("click", importLocalData);
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const email = String(data.email || "").trim();
    const password = String(data.password || "");
    if (!email || !password) return;
    renderSignIn(data.mode === "signup" ? "Creating user..." : "Signing in...");
    try {
      const response = data.mode === "signup"
        ? await client.auth.signUp({ email, password })
        : await client.auth.signInWithPassword({ email, password });
      if (response.error) throw response.error;
      if (response.data.session) {
        window.location.reload();
      } else {
        renderSignIn("User created. If email confirmation is enabled, confirm the email and then sign in.");
      }
    } catch (error) {
      renderSignIn(error.message || "Sign-in failed.");
    }
  }

  async function signOut() {
    await client.auth.signOut();
    window.location.reload();
  }

  async function ensureProfile() {
    const user = state.session && state.session.user;
    if (!user) return;
    await client.from("profiles").upsert({
      user_id: user.id,
      email: user.email || "",
      full_name: user.user_metadata?.full_name || (user.email || "CRM user").split("@")[0]
    }, { onConflict: "user_id" });
  }

  async function loadRemoteLeads() {
    const { data, error } = await client.from("crm_leads").select("*").order("updated_at", { ascending: false });
    if (error) throw error;
    writeStorage((data || []).map(leadFromRow), "shared");
  }

  function patchStorageSync() {
    if (window.__CIS_STORAGE_PATCHED__) return;
    window.__CIS_STORAGE_PATCHED__ = true;
    window.localStorage.setItem = function (key, value) {
      originalSetItem(key, value);
      if (key === STORAGE_KEY && state.session && !state.suppressSync) queueSync(value);
    };
  }

  function queueSync(value) {
    window.clearTimeout(state.syncTimer);
    state.syncTimer = window.setTimeout(() => syncStorageValue(value), 450);
  }

  async function syncStorageValue(value) {
    if (!state.session) return;
    try {
      const parsed = JSON.parse(value || "{}");
      const leads = Array.isArray(parsed.leads) ? parsed.leads : [];
      const rows = leads.map(leadToRow).filter(Boolean);
      if (!rows.length) return;
      const { error } = await client.from("crm_leads").upsert(rows, { onConflict: "external_lead_id" });
      if (error) throw error;
      renderConnected("Shared backend saved.");
    } catch (error) {
      renderPanel("error", "Shared save failed", error.message || "A local copy was kept in this browser.");
    }
  }

  function backupLocalLeads() {
    const existing = readStorage();
    if (!existing.leads.length || existing.source === "shared") return [];
    originalSetItem(BACKUP_KEY, JSON.stringify({ version: STORAGE_VERSION, backedUpAt: new Date().toISOString(), leads: existing.leads }));
    return existing.leads;
  }

  async function importLocalData() {
    const backup = readJson(BACKUP_KEY);
    const leads = Array.isArray(backup?.leads) ? backup.leads : [];
    if (!leads.length) return;
    const current = readStorage().leads;
    const merged = mergeLeads(current, leads);
    writeStorage(merged, "shared");
    await syncStorageValue(JSON.stringify({ version: STORAGE_VERSION, source: "shared", leads: merged }));
    originalRemoveItem(BACKUP_KEY);
    window.location.reload();
  }

  function readStorage() {
    const payload = readJson(STORAGE_KEY) || {};
    return { source: payload.source || "local", leads: Array.isArray(payload.leads) ? payload.leads : [] };
  }

  function readJson(key) {
    try { return JSON.parse(window.localStorage.getItem(key) || "null"); } catch { return null; }
  }

  function writeStorage(leads, source) {
    state.suppressSync = true;
    originalSetItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, source, updatedAt: new Date().toISOString(), leads }));
    state.suppressSync = false;
  }

  function mergeLeads(primary, imported) {
    const map = new Map();
    primary.concat(imported).forEach((lead) => {
      const key = lead.externalLeadId ? `mwo:${String(lead.externalLeadId).toLowerCase()}` : `id:${lead.id}`;
      const existing = map.get(key);
      if (!existing || String(lead.lastActivityAt || lead.dateReceived || "") >= String(existing.lastActivityAt || existing.dateReceived || "")) map.set(key, lead);
    });
    return Array.from(map.values());
  }

  function leadToRow(lead) {
    if (!lead || !lead.externalLeadId) return null;
    const row = {
      external_lead_id: text(lead.externalLeadId),
      source: text(lead.source) || "HDSC",
      job_path: text(lead.jobPath) || "SFI",
      customer_name: text(lead.customerName) || "Unnamed customer",
      contact_phone: nullable(lead.contactPhone),
      contact_email: nullable(lead.contactEmail),
      customer_phone: nullable(lead.contactPhone),
      customer_email: nullable(lead.contactEmail),
      store_number: nullable(lead.storeNumber),
      product_type: nullable(lead.productType),
      job_address: nullable(lead.address),
      job_street: nullable(lead.street || lead.address),
      job_city: nullable(lead.city),
      job_state: nullable(lead.state),
      job_zip: nullable(lead.zipCode),
      assigned_rep_name: text(lead.repName) || "Unassigned",
      stage_id: text(lead.stageId) || "intake_measure_prep",
      stage_entered_at: dateOrToday(lead.stageEnteredAt || lead.dateReceived),
      date_received: dateOrToday(lead.dateReceived),
      next_action: nullable(lead.nextAction),
      next_action_due: nullableDate(lead.nextActionDue),
      last_activity_at: nullableDate(lead.lastActivityAt || lead.dateReceived),
      expected_close_date: nullableDate(lead.expectedCloseDate),
      priority: text(lead.priority) || "normal",
      measure_scheduled_date: nullableDate(lead.measureScheduledDate),
      measure_completed_date: nullableDate(lead.measureCompletedDate),
      quote_amount: numberOrNull(lead.quoteAmount),
      quote_sent_date: nullableDate(lead.quoteSentDate),
      sold_date: nullableDate(lead.soldDate),
      payment_status: text(lead.paymentStatus) || "Not requested",
      install_scheduled_date: nullableDate(lead.installScheduledDate),
      lost_date: nullableDate(lead.lostDate),
      lost_reason: nullable(lead.lostReason),
      closed_date: nullableDate(lead.closedDate),
      realized_revenue: numberOrNull(lead.realizedRevenue),
      notes: nullable(lead.notes),
      activity_log: Array.isArray(lead.activityLog) ? lead.activityLog : [],
      archived_at: nullableDate(lead.archivedAt),
      updated_by: state.session.user.id
    };
    if (isUuid(lead.id)) row.id = lead.id;
    return row;
  }

  function leadFromRow(row) {
    return {
      id: row.id,
      externalLeadId: row.external_lead_id,
      source: row.source,
      jobPath: row.job_path,
      customerName: row.customer_name,
      repName: row.assigned_rep_name || "Unassigned",
      contactPhone: row.contact_phone || row.customer_phone || "",
      contactEmail: row.contact_email || row.customer_email || "",
      street: row.job_street || "",
      city: row.job_city || "",
      state: row.job_state || "",
      zipCode: row.job_zip || "",
      address: row.job_address || "",
      storeNumber: row.store_number || "",
      productType: row.product_type || "",
      stageId: row.stage_id,
      stageEnteredAt: row.stage_entered_at,
      dateReceived: row.date_received,
      nextAction: row.next_action || "",
      nextActionDue: row.next_action_due || "",
      lastActivityAt: row.last_activity_at || row.date_received,
      expectedCloseDate: row.expected_close_date || "",
      priority: row.priority || "normal",
      measureScheduledDate: row.measure_scheduled_date || "",
      measureCompletedDate: row.measure_completed_date || "",
      quoteAmount: Number(row.quote_amount || 0),
      quoteSentDate: row.quote_sent_date || "",
      soldDate: row.sold_date || "",
      paymentStatus: row.payment_status || "Not requested",
      installScheduledDate: row.install_scheduled_date || "",
      lostDate: row.lost_date || "",
      lostReason: row.lost_reason || "",
      closedDate: row.closed_date || "",
      realizedRevenue: Number(row.realized_revenue || 0),
      notes: row.notes || "",
      activityLog: Array.isArray(row.activity_log) ? row.activity_log : [],
      archivedAt: row.archived_at || ""
    };
  }

  function loadApp() {
    if (window.__CIS_APP_LOADING__) return;
    window.__CIS_APP_LOADING__ = true;
    const script = document.createElement("script");
    script.src = "assets/app.js";
    document.body.appendChild(script);
  }

  function text(value) { return String(value || "").trim(); }
  function nullable(value) { const next = text(value); return next || null; }
  function nullableDate(value) { const next = text(value).slice(0, 10); return next || null; }
  function dateOrToday(value) { return nullableDate(value) || new Date().toISOString().slice(0, 10); }
  function numberOrNull(value) { const number = Number(value || 0); return Number.isFinite(number) && number > 0 ? number : null; }
  function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "")); }
  function escapeHtml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
})();
