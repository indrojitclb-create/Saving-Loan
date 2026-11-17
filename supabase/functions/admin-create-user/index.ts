import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return respond({ error: "Server configuration missing" }, 500);

  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return respond({ error: "Login required" }, 401);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const token = authorization.slice(7);
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return respond({ error: "Invalid login session" }, 401);

  const { data: caller, error: callerError } = await admin.from("profiles")
    .select("role,is_active").eq("id", authData.user.id).single();
  if (callerError || !caller?.is_active) {
    return respond({ error: "আপনার User তৈরি করার অনুমতি নেই।" }, 403);
  }

  let assistantCanCreateUsers = false;
  if (caller.role === "assistant_admin") {
    const { data: permission } = await admin.from("profile_permissions")
      .select("can_create").eq("profile_id", authData.user.id)
      .eq("module_key", "users").maybeSingle();
    assistantCanCreateUsers = permission?.can_create === true;
  }
  if (!["main_admin", "co_admin"].includes(caller.role) && !assistantCanCreateUsers) {
    return respond({ error: "আপনার User তৈরি করার অনুমতি নেই।" }, 403);
  }

  let body: any;
  try { body = await req.json(); } catch { return respond({ error: "Invalid request body" }, 400); }
  const full_name = String(body.full_name || "").trim();
  const login_id = String(body.login_id || "").trim().toUpperCase();
  const suppliedEmail = String(body.email || "").trim().toLowerCase();
  const email = suppliedEmail || `uid-${crypto.randomUUID()}@login.savingloan.invalid`;
  const password = String(body.password || "");
  const allowedRoles = caller.role === "main_admin"
    ? ["main_admin", "co_admin", "assistant_admin", "area_manager", "branch_manager", "co"]
    : caller.role === "co_admin"
      ? ["assistant_admin", "area_manager", "branch_manager", "co"]
      : ["area_manager", "branch_manager", "co"];
  const role = String(body.role || "");

  if (!full_name || !/^[A-Z0-9._-]{3,40}$/.test(login_id) || (suppliedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(suppliedEmail)) || password.length < 8 || !allowedRoles.includes(role)) {
    return respond({ error: "নাম, ৩-৪০ অক্ষরের সঠিক Login ID, কমপক্ষে ৮ অক্ষরের Password এবং অনুমোদিত Role দিন। Email ঐচ্ছিক।" }, 400);
  }
  const { data: existingLogin, error: loginLookupError } = await admin.from("profiles")
    .select("id").ilike("login_id", login_id).maybeSingle();
  if (loginLookupError) return respond({ error: "Login ID যাচাই করা যায়নি: " + loginLookupError.message }, 400);
  if (existingLogin) return respond({ error: "এই Login ID আগে থেকেই ব্যবহৃত হচ্ছে।" }, 409);

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name },
  });
  if (createError || !created.user) return respond({ error: createError?.message || "Auth user তৈরি হয়নি।" }, 400);

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id, full_name, login_id, role, is_active: true,
    branch_id: body.branch_id || null,
    employee_id: body.employee_id || null,
    area_name: body.area_name || null,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return respond({ error: "Profile তৈরি হয়নি: " + profileError.message }, 400);
  }

  return respond({ success: true, user_id: created.user.id });
});
