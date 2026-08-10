import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

type AppRole = "admin" | "manager" | "rep";

type AdminRequest = {
  action?: "list" | "update" | "delete";
  userId?: string;
  fullName?: string;
  active?: boolean;
  roles?: AppRole[];
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_PUBLIC_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return jsonResponse({ ok: true });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const actor = await requireAdmin(req);
    const body = await readJson(req);

    if (body.action === "list") {
      return jsonResponse({ users: await listUsers() });
    }

    if (body.action === "update") {
      if (!body.userId) return jsonResponse({ error: "Missing user id." }, 400);
      await updateUser(actor.id, body);
      return jsonResponse({ users: await listUsers(), message: "User updated." });
    }

    if (body.action === "delete") {
      if (!body.userId) return jsonResponse({ error: "Missing user id." }, 400);
      const result = await deleteOrDeactivateUser(actor.id, body.userId);
      return jsonResponse({ users: await listUsers(), ...result });
    }

    return jsonResponse({ error: "Unknown admin action." }, 400);
  } catch (error) {
    const status = error instanceof AdminError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Admin action failed.";
    return jsonResponse({ error: message }, status);
  }
});

async function requireAdmin(req: Request) {
  if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new AdminError("Admin function is missing Supabase settings.", 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new AdminError("Sign in is required.", 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) throw new AdminError("Sign in is required.", 401);

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("active")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.active) throw new AdminError("This profile is inactive.", 403);

  const { data: role, error: roleError } = await adminClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (roleError) throw roleError;
  if (!role) throw new AdminError("Admin permission is required.", 403);

  return { id: userData.user.id, email: userData.user.email || "" };
}

async function listUsers() {
  const { data: authData, error: authError } = await adminClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000
  });
  if (authError) throw authError;

  const { data: profiles, error: profilesError } = await adminClient
    .from("profiles")
    .select("user_id, full_name, email, active, created_at, updated_at")
    .order("full_name", { ascending: true });
  if (profilesError) throw profilesError;

  const { data: roles, error: rolesError } = await adminClient
    .from("user_roles")
    .select("user_id, role");
  if (rolesError) throw rolesError;

  const roleMap = new Map<string, AppRole[]>();
  (roles || []).forEach((row) => {
    const values = roleMap.get(row.user_id) || [];
    values.push(row.role as AppRole);
    roleMap.set(row.user_id, values);
  });

  const profileMap = new Map((profiles || []).map((profile) => [profile.user_id, profile]));
  return (authData.users || []).map((user) => {
    const profile = profileMap.get(user.id);
    return {
      userId: user.id,
      email: profile?.email || user.email || "",
      fullName: profile?.full_name || user.user_metadata?.full_name || (user.email || "").split("@")[0],
      active: profile?.active !== false,
      roles: normalizeRoles(roleMap.get(user.id)),
      emailConfirmed: Boolean(user.email_confirmed_at),
      lastSignInAt: user.last_sign_in_at || "",
      createdAt: user.created_at || profile?.created_at || ""
    };
  }).sort((a, b) => String(a.fullName || a.email).localeCompare(String(b.fullName || b.email)));
}

async function updateUser(actorId: string, body: AdminRequest) {
  const userId = String(body.userId || "");
  const roles = normalizeRoles(body.roles);
  if (actorId === userId && !roles.includes("admin")) {
    throw new AdminError("You cannot remove your own admin permission.", 400);
  }

  const { error: profileError } = await adminClient
    .from("profiles")
    .update({
      full_name: String(body.fullName || "").trim() || null,
      active: body.active !== false,
      updated_at: new Date().toISOString()
    })
    .eq("user_id", userId);
  if (profileError) throw profileError;

  const { error: deleteRolesError } = await adminClient
    .from("user_roles")
    .delete()
    .eq("user_id", userId);
  if (deleteRolesError) throw deleteRolesError;

  const { error: insertRolesError } = await adminClient
    .from("user_roles")
    .insert(roles.map((role) => ({ user_id: userId, role })));
  if (insertRolesError) throw insertRolesError;
}

async function deleteOrDeactivateUser(actorId: string, userId: string) {
  if (actorId === userId) throw new AdminError("You cannot delete your own admin account.", 400);

  const { count, error: countError } = await adminClient
    .from("crm_leads")
    .select("id", { count: "exact", head: true })
    .eq("assigned_to", userId);
  if (countError) throw countError;

  if ((count || 0) > 0) {
    const { error: deactivateError } = await adminClient
      .from("profiles")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (deactivateError) throw deactivateError;

    await adminClient.from("user_roles").delete().eq("user_id", userId).neq("role", "rep");
    return { message: "User has assigned leads, so the profile was deactivated instead of deleted." };
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
  if (deleteError) {
    const { error: deactivateError } = await adminClient
      .from("profiles")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (deactivateError) throw deactivateError;

    await adminClient.from("user_roles").delete().eq("user_id", userId).neq("role", "rep");
    return { message: "User has CRM history, so the profile was deactivated instead of deleted." };
  }
  return { message: "User deleted." };
}

function normalizeRoles(input: unknown): AppRole[] {
  const allowed: AppRole[] = ["admin", "manager", "rep"];
  const roles = Array.isArray(input)
    ? input.filter((role): role is AppRole => allowed.includes(role as AppRole))
    : [];
  const unique = Array.from(new Set(roles));
  return unique.length ? unique : ["rep"];
}

async function readJson(req: Request): Promise<AdminRequest> {
  try {
    return await req.json();
  } catch {
    throw new AdminError("Invalid request body.", 400);
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

class AdminError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
