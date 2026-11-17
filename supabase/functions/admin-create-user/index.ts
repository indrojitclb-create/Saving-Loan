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
  if (callerError || !caller?.is_active || !["main_admin", "co_admin"].includes(caller.role)) {
    return respond({ error: "আপনার User তৈরি করার অনুমতি নেই।" }, 403);
  }

  let body: any;
  try { body = await req.json(); } catch { return respond({ error: "Invalid request body" }, 400); }
  const full_name = String(body.full_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const allowedRoles = caller.role === "main_admin"
    ? ["main_admin", "co_admin", "area_manager", "branch_manager", "co"]
    : ["co_admin", "area_manager", "branch_manager", "co"];
  const role = String(body.role || "");

  if (!full_name || !email || password.length < 8 || !allowedRoles.includes(role)) {
    return respond({ error: "নাম, সঠিক Email, কমপক্ষে ৮ অক্ষরের Password এবং অনুমোদিত Role দিন।" }, 400);
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name },
  });
  if (createError || !created.user) return respond({ error: createError?.message || "Auth user তৈরি হয়নি।" }, 400);

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id, full_name, role, is_active: true,
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
