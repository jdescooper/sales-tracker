(function () {
  const ROLE_LABELS = { rep: "Rep", manager: "Manager", admin: "Admin" };
  const ROLE_ORDER = ["admin", "manager", "rep"];
  const state = {
    client: null,
    session: null,
    roles: [],
    users: [],
    adminLoading: false,
    reportLoading: false,
    reportRows: [],
    reportTimer: 0
  };

  patchSupabaseClient();
  injectStyles();
  onReady(start);

  function patchSupabaseClient() {
    if (!window.supabase || typeof window.supabase.createClient !== "function" || window.supabase.__cisAccessPatched) return;
    const originalCreateClient = window.supabase.createClient.bind(window.supabase);
    const wrapped = new WeakMap();
    window.supabase.createClient = function createCisClient(...args) {
      const client = originalCreateClient(...args);
      if (wrapped.has(client)) return wrapped.get(client);
      const proxy = new Proxy(client, {
        get(target, prop, receiver) {
          if (prop === "from") {
            return (table) => {
              const builder = target.from(table);
              return table === "crm_leads" ? wrapLeadBuilder(target, builder) : builder;
            };
          }
          return Reflect.get(target, prop, receiver);
        }
      });
      wrapped.set(client, proxy);
      return proxy;
    };
    window.supabase.__cisAccessPatched = true;
  }

  function wrapLeadBuilder(client, builder) {
    return new Proxy(builder, {
      get(target, prop, receiver) {
        if (prop === "upsert" || prop === "insert") {
          return async (payload, options) => {
            const patched = await addCurrentOwner(client, payload);
            return target[prop](patched, options);
          };
        }
        return Reflect.get(target, prop, receiver);
      }
    });
  }

  async function addCurrentOwner(client, payload) {
    const userId = await getCurrentUserId(client);
    if (!userId) return payload;
    const patchRow = (row) => {
      if (!row || typeof row !== "object") return row;
      return {
        ...row,
        assigned_to: row.assigned_to || userId,
        updated_by: userId
      };
    };
    return Array.isArray(payload) ? payload.map(patchRow) : patchRow(payload);
  }

  async function getCurrentUserId(client) {
    try {
      const { data } = await client.auth.getSession();
      return data.session?.user?.id || "";
    } catch {
      return "";
    }
  }

  async function start() {
    state.client = createClient();
    if (!state.client) return;
    await refreshAccess();
    state.client.auth.onAuthStateChange((_event, session) => {
      state.session = session || null;
      refreshAccess().catch(() => {});
    });
    installAdminViewWhenReady();
    installReportOverlay();
  }

  function createClient() {
    const config = window.CIS_CONFIG || {};
    if (!window.supabase || !config.supabaseUrl || !config.supabaseAnonKey) return null;
    return window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }

  async function refreshAccess() {
    if (!state.client) return;
    const { data } = await state.client.auth.getSession();
    state.session = data.session || null;
    state.roles = [];
    if (!state.session) return;

    const { data: roles, error } = await state.client
      .from("user_roles")
      .select("role")
      .eq("user_id", state.session.user.id);
    if (error) return;
    state.roles = normalizeRoles((roles || []).map((row) => row.role));
    renderConnectionRole();
    installAdminViewWhenReady();
  }

  function renderConnectionRole() {
    const status = document.querySelector("#connection-panel .connection-status");
    if (!status || !state.session) return;
    const role = ROLE_LABELS[getHighestRole(state.roles)] || "Rep";
    if (!status.textContent.includes(role)) status.textContent = `${status.textContent} | ${role}`;
  }

  function installAdminViewWhenReady() {
    waitForElement(".primary-tabs").then(() => {
      if (!isAdmin()) return;
      installAdminView();
    });
  }

  function installAdminView() {
    const tabs = document.querySelector(".primary-tabs");
    const workspace = document.getElementById("workspace");
    if (!tabs || !workspace || document.querySelector("[data-access-admin-tab]")) return;

    const button = document.createElement("button");
    button.className = "tab-button";
    button.type = "button";
    button.dataset.accessAdminTab = "true";
    button.textContent = "Admin";
    button.addEventListener("click", showAdminView);
    tabs.appendChild(button);

    const section = document.createElement("section");
    section.className = "view-panel access-admin-panel";
    section.id = "view-admin";
    section.hidden = true;
    section.innerHTML = `
      <div class="view-heading">
        <div>
          <p class="eyebrow">User access</p>
          <h2>Admin</h2>
        </div>
        <button class="button secondary" id="access-refresh-users" type="button">Refresh Users</button>
      </div>
      <div id="access-admin-view"></div>
    `;
    workspace.appendChild(section);

    document.getElementById("access-refresh-users").addEventListener("click", () => loadAdminUsers(true));
    section.addEventListener("change", handleAdminChange);
    section.addEventListener("click", handleAdminClick);
    loadAdminUsers(false);
  }

  function showAdminView() {
    document.querySelectorAll("[data-view-tab], [data-access-admin-tab]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.accessAdminTab === "true");
      button.setAttribute("aria-current", button.dataset.accessAdminTab === "true" ? "page" : "false");
    });
    document.querySelectorAll(".view-panel").forEach((panel) => {
      const active = panel.id === "view-admin";
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
    renderAdmin();
  }

  async function loadAdminUsers(showToast) {
    if (!isAdmin()) return;
    state.adminLoading = true;
    renderAdmin();
    try {
      const response = await callAdminUsers({ action: "list" });
      state.users = response.users || [];
      if (showToast) showToastMessage("Users refreshed.", false);
    } catch (error) {
      showToastMessage(error.message || "Could not load users.", true);
    } finally {
      state.adminLoading = false;
      renderAdmin();
    }
  }

  function renderAdmin() {
    const root = document.getElementById("access-admin-view");
    if (!root) return;
    if (state.adminLoading) {
      root.innerHTML = `<p class="empty-state">Loading users...</p>`;
      return;
    }
    const users = state.users || [];
    root.innerHTML = `
      <div class="access-summary">
        ${metric("Users", users.length)}
        ${metric("Active", users.filter((user) => user.active).length)}
        ${metric("Admins", users.filter((user) => normalizeRoles(user.roles).includes("admin")).length)}
        ${metric("Managers", users.filter((user) => normalizeRoles(user.roles).includes("manager")).length)}
      </div>
      <div class="table-wrap access-admin-table" tabindex="0">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Verification</th>
              <th>Last Sign In</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${users.length ? users.map(renderUserRow).join("") : `<tr><td colspan="7">No users found.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderUserRow(user) {
    const role = getHighestRole(user.roles);
    const isSelf = user.userId === state.session?.user?.id;
    return `
      <tr>
        <td><strong>${escapeHtml(user.fullName || user.email || "CRM user")}</strong>${isSelf ? ' <span class="status-pill upcoming">You</span>' : ""}</td>
        <td>${escapeHtml(user.email || "")}</td>
        <td>
          <select data-access-role="${escapeHtml(user.userId)}"${isSelf ? " disabled" : ""}>
            ${ROLE_ORDER.map((option) => `<option value="${option}" ${option === role ? "selected" : ""}>${ROLE_LABELS[option]}</option>`).join("")}
          </select>
        </td>
        <td>
          <label class="access-toggle">
            <input data-access-active="${escapeHtml(user.userId)}" type="checkbox" ${user.active ? "checked" : ""}${isSelf ? " disabled" : ""}>
            <span>${user.active ? "Active" : "Inactive"}</span>
          </label>
        </td>
        <td>${user.emailConfirmed ? "Confirmed" : "Unconfirmed"}</td>
        <td>${escapeHtml(formatDate(user.lastSignInAt) || "-")}</td>
        <td><button class="text-button access-danger" data-access-remove="${escapeHtml(user.userId)}" type="button"${isSelf ? " disabled" : ""}>Remove</button></td>
      </tr>
    `;
  }

  async function handleAdminChange(event) {
    const role = event.target.closest("[data-access-role]");
    if (role) {
      await updateAdminUser(role.dataset.accessRole, { roles: [role.value] });
      return;
    }
    const active = event.target.closest("[data-access-active]");
    if (active) await updateAdminUser(active.dataset.accessActive, { active: active.checked });
  }

  async function handleAdminClick(event) {
    const remove = event.target.closest("[data-access-remove]");
    if (!remove) return;
    const user = state.users.find((item) => item.userId === remove.dataset.accessRemove);
    if (!user) return;
    if (!window.confirm(`Remove ${user.fullName || user.email || "this user"}? If they own CRM history, the profile will be deactivated instead.`)) return;
    state.adminLoading = true;
    renderAdmin();
    try {
      const response = await callAdminUsers({ action: "delete", userId: user.userId });
      state.users = response.users || [];
      showToastMessage(response.message || "User removed.", false);
    } catch (error) {
      showToastMessage(error.message || "User removal failed.", true);
    } finally {
      state.adminLoading = false;
      renderAdmin();
    }
  }

  async function updateAdminUser(userId, patch) {
    const existing = state.users.find((user) => user.userId === userId);
    if (!existing) return;
    state.adminLoading = true;
    renderAdmin();
    try {
      const response = await callAdminUsers({
        action: "update",
        userId,
        fullName: existing.fullName,
        active: patch.active ?? existing.active,
        roles: patch.roles || normalizeRoles(existing.roles)
      });
      state.users = response.users || [];
      showToastMessage(response.message || "User updated.", false);
    } catch (error) {
      showToastMessage(error.message || "User update failed.", true);
    } finally {
      state.adminLoading = false;
      renderAdmin();
    }
  }

  async function callAdminUsers(body) {
    const token = state.session?.access_token || (await state.client.auth.getSession()).data.session?.access_token;
    if (!token) throw new Error("Sign in is required.");
    const { data, error } = await state.client.functions.invoke("admin-users", {
      body,
      headers: { Authorization: `Bearer ${token}` }
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data || {};
  }

  function installReportOverlay() {
    document.addEventListener("click", (event) => {
      if (event.target.closest("[data-view-tab='reports']")) {
        window.setTimeout(renderOrgReport, 120);
      }
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest("#export-report, #report-export-report")) return;
      if (!state.client || !state.session) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      exportOrgReport().catch((error) => showToastMessage(error.message || "Could not export organization report.", true));
    }, true);
    ["search-filter", "rep-filter", "start-filter", "end-filter"].forEach((id) => {
      waitForElement(`#${id}`).then((control) => {
        if (!control) return;
        control.addEventListener("input", () => {
          if (!isReportsVisible()) return;
          window.clearTimeout(state.reportTimer);
          state.reportTimer = window.setTimeout(renderOrgReport, 220);
        });
      });
    });
    waitForElement("#report-view").then(() => {
      if (isReportsVisible()) renderOrgReport();
    });
  }

  async function renderOrgReport() {
    const root = document.getElementById("report-view");
    if (!root || !state.client || !state.session) return;
    state.reportLoading = true;
    root.innerHTML = `<p class="empty-state">Loading organization report...</p>`;
    try {
      const start = document.getElementById("start-filter")?.value || null;
      const end = document.getElementById("end-filter")?.value || null;
      const { data, error } = await state.client.rpc("get_crm_rep_revenue_report", { _start: start, _end: end });
      if (error) throw error;
      state.reportRows = (data || []).map(reportRow);
      const rows = filterReportRows(state.reportRows);
      const totals = totalRows(rows);
      root.innerHTML = `
        <div class="report-summary">
          ${metric("Leads", totals.leadsAssigned)}
          ${metric("Overdue", totals.overdueActions)}
          ${metric("Open potential", money(totals.openPotentialRevenue))}
          ${metric("Won revenue", money(totals.wonRevenue))}
          ${metric("Realized", money(totals.realizedRevenue))}
          ${metric("Win rate", percent(totals.winRate))}
        </div>
        <div class="table-wrap" tabindex="0">
          <table>
            <thead>
              <tr>
                <th>Rep</th>
                <th>Leads</th>
                <th>Overdue</th>
                <th>Due Today</th>
                <th>No Next Action</th>
                <th>Stale</th>
                <th>Quotes</th>
                <th>Quoted $</th>
                <th>Open Potential</th>
                <th>Won Jobs</th>
                <th>Lost Jobs</th>
                <th>Win Rate</th>
                <th>Won $</th>
                <th>Realized $</th>
                <th>Avg Days to Quote</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length ? rows.map(renderReportRow).join("") : `<tr><td colspan="15">No report rows match the current filters.</td></tr>`}
            </tbody>
          </table>
        </div>
      `;
    } catch (error) {
      root.innerHTML = `<p class="empty-state">${escapeHtml(error.message || "Could not load organization report.")}</p>`;
    } finally {
      state.reportLoading = false;
    }
  }

  async function exportOrgReport() {
    if (!state.client || !state.session) throw new Error("Sign in is required.");
    const start = document.getElementById("start-filter")?.value || null;
    const end = document.getElementById("end-filter")?.value || null;
    const { data, error } = await state.client.rpc("get_crm_rep_revenue_report", { _start: start, _end: end });
    if (error) throw error;
    const rows = filterReportRows((data || []).map(reportRow));
    const headers = [
      "Rep", "Leads", "Overdue", "Due Today", "No Next Action", "Stale", "Quotes", "Quoted $",
      "Open Potential", "Won Jobs", "Lost Jobs", "Win Rate", "Won $", "Realized $", "Avg Days to Quote"
    ];
    const lines = [headers, ...rows.map((row) => [
      row.repName,
      row.leadsAssigned,
      row.overdueActions,
      row.dueTodayActions,
      row.noNextAction,
      row.staleLeads,
      row.quotesSent,
      row.totalQuotedRevenue,
      row.openPotentialRevenue,
      row.wonJobs,
      row.lostJobs,
      Math.round(row.winRate * 100) + "%",
      row.wonRevenue,
      row.realizedRevenue,
      row.averageDaysToQuote
    ])];
    downloadCsv(`cis-leadership-report-${new Date().toISOString().slice(0, 10)}.csv`, lines);
    showToastMessage("Leadership report exported.", false);
  }

  function renderReportRow(row) {
    return `
      <tr>
        <td>${escapeHtml(row.repName)}</td>
        <td>${number(row.leadsAssigned)}</td>
        <td>${number(row.overdueActions)}</td>
        <td>${number(row.dueTodayActions)}</td>
        <td>${number(row.noNextAction)}</td>
        <td>${number(row.staleLeads)}</td>
        <td>${number(row.quotesSent)}</td>
        <td>${money(row.totalQuotedRevenue)}</td>
        <td>${money(row.openPotentialRevenue)}</td>
        <td>${number(row.wonJobs)}</td>
        <td>${number(row.lostJobs)}</td>
        <td>${percent(row.winRate)}</td>
        <td>${money(row.wonRevenue)}</td>
        <td>${money(row.realizedRevenue)}</td>
        <td>${number(row.averageDaysToQuote, 1)}</td>
      </tr>
    `;
  }

  function reportRow(row) {
    return {
      repId: row.rep_id || "",
      repName: row.rep_name || "Unassigned",
      leadsAssigned: Number(row.leads_assigned || 0),
      overdueActions: Number(row.overdue_actions || 0),
      dueTodayActions: Number(row.due_today_actions || 0),
      noNextAction: Number(row.no_next_action || 0),
      staleLeads: Number(row.stale_leads || 0),
      quotesSent: Number(row.quotes_sent || 0),
      totalQuotedRevenue: Number(row.total_quoted_revenue || 0),
      openPotentialRevenue: Number(row.open_potential_revenue || 0),
      wonJobs: Number(row.won_jobs || 0),
      lostJobs: Number(row.lost_jobs || 0),
      wonRevenue: Number(row.won_revenue || 0),
      realizedRevenue: Number(row.realized_revenue || 0),
      winRate: Number(row.win_rate || 0),
      averageDaysToQuote: Number(row.average_days_to_quote || 0)
    };
  }

  function filterReportRows(rows) {
    const rep = document.getElementById("rep-filter")?.value || "all";
    const search = String(document.getElementById("search-filter")?.value || "").toLowerCase().trim();
    return rows.filter((row) => {
      if (rep !== "all" && row.repName !== rep) return false;
      if (search && !row.repName.toLowerCase().includes(search)) return false;
      return true;
    });
  }

  function totalRows(rows) {
    const total = rows.reduce((acc, row) => {
      ["leadsAssigned", "overdueActions", "dueTodayActions", "noNextAction", "staleLeads", "quotesSent", "totalQuotedRevenue", "openPotentialRevenue", "wonJobs", "lostJobs", "wonRevenue", "realizedRevenue"].forEach((key) => {
        acc[key] += Number(row[key] || 0);
      });
      return acc;
    }, {
      leadsAssigned: 0, overdueActions: 0, dueTodayActions: 0, noNextAction: 0, staleLeads: 0, quotesSent: 0,
      totalQuotedRevenue: 0, openPotentialRevenue: 0, wonJobs: 0, lostJobs: 0, wonRevenue: 0, realizedRevenue: 0
    });
    const decided = total.wonJobs + total.lostJobs;
    total.winRate = decided ? total.wonJobs / decided : 0;
    return total;
  }

  function isReportsVisible() {
    const reports = document.getElementById("view-reports");
    return reports && !reports.hidden;
  }

  function normalizeRoles(roles) {
    const allowed = new Set(ROLE_ORDER);
    const normalized = Array.isArray(roles) ? roles.filter((role) => allowed.has(role)) : [];
    return normalized.length ? Array.from(new Set(normalized)) : ["rep"];
  }

  function getHighestRole(roles) {
    const normalized = normalizeRoles(roles);
    return ROLE_ORDER.find((role) => normalized.includes(role)) || "rep";
  }

  function isAdmin() {
    return state.roles.includes("admin");
  }

  function metric(label, value) {
    return `<article class="report-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
  }

  function money(value) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function percent(value) {
    return `${Math.round(Number(value || 0) * 100)}%`;
  }

  function number(value, decimals = 0) {
    return new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number(value || 0));
  }

  function downloadCsv(filename, rows) {
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function formatDate(value) {
    if (!value) return "";
    const [year, month, day] = String(value).slice(0, 10).split("-");
    return year && month && day ? `${Number(month)}/${Number(day)}/${year}` : String(value);
  }

  function showToastMessage(message, isError) {
    const toast = document.getElementById("app-status");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle("is-error", Boolean(isError));
    toast.classList.add("is-visible");
    window.clearTimeout(showToastMessage.timeout);
    showToastMessage.timeout = window.setTimeout(() => {
      toast.textContent = "";
      toast.classList.remove("is-visible", "is-error");
    }, 3500);
  }

  function waitForElement(selector, timeout = 12000) {
    const existing = document.querySelector(selector);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const started = Date.now();
      const timer = window.setInterval(() => {
        const node = document.querySelector(selector);
        if (node || Date.now() - started > timeout) {
          window.clearInterval(timer);
          resolve(node);
        }
      }, 80);
    });
  }

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
    } else {
      callback();
    }
  }

  function injectStyles() {
    if (document.getElementById("access-overlay-styles")) return;
    const style = document.createElement("style");
    style.id = "access-overlay-styles";
    style.textContent = `
      .access-summary { display:grid; grid-template-columns:repeat(4,minmax(120px,1fr)); gap:8px; min-width:0; }
      .access-admin-table select { min-width:130px; }
      .access-toggle { display:inline-flex; grid-template-columns:none; align-items:center; gap:8px; font-size:.82rem; font-weight:850; }
      .access-toggle input { width:auto; min-height:auto; }
      .text-button.access-danger { border-color:#ffb2b2; color:var(--red); }
      @media (max-width:760px) { .access-summary { grid-template-columns:1fr 1fr; } }
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
