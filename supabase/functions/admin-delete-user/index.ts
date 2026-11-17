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
  if (callerError || !caller?.is_active || caller.role !== "main_admin") {
    return respond({ error: "শুধু Main Admin User Account মুছতে পারবেন।" }, 403);
  }

  let body: any;
  try { body = await req.json(); } catch { return respond({ error: "Invalid request body" }, 400); }
  const targetId = String(body.user_id || "").trim();
  if (!targetId) return respond({ error: "User নির্বাচন করা হয়নি।" }, 400);
  if (targetId === authData.user.id) return respond({ error: "নিজের Main Admin Account মুছে ফেলা যাবে না।" }, 400);

  const { data: target, error: targetError } = await admin.from("profiles")
    .select("id,full_name,login_id,role").eq("id", targetId).maybeSingle();
  if (targetError || !target) return respond({ error: "নির্বাচিত User পাওয়া যায়নি।" }, 404);
  if (target.role === "main_admin") return respond({ error: "Main Admin Account সুরক্ষিত; এটি মুছে ফেলা যাবে না।" }, 403);

  const { error: auditError } = await admin.from("audit_logs").insert({
    actor_id: authData.user.id,
    action: "user_deleted",
    table_name: "profiles",
    record_id: target.id,
    details: { full_name: target.full_name, login_id: target.login_id, role: target.role },
  });
  if (auditError) return respond({ error: "Audit record তৈরি হয়নি; তাই User মুছে ফেলা হয়নি: " + auditError.message }, 500);

  // Preserve historical business and audit records while removing the account.
  const referenceUpdates = await Promise.all([
    admin.from("audit_logs").update({ actor_id: null }).eq("actor_id", targetId),
    admin.from("members").update({ created_by: null }).eq("created_by", targetId),
    admin.from("savings_transactions").update({ created_by: null }).eq("created_by", targetId),
    admin.from("loan_accounts").update({ created_by: null }).eq("created_by", targetId),
    admin.from("loan_transactions").update({ created_by: null }).eq("created_by", targetId),
  ]);
  const failedUpdate = referenceUpdates.find((result) => result.error);
  if (failedUpdate?.error) {
    return respond({ error: "পুরোনো রেকর্ডের User reference নিরাপদ করা যায়নি; Account মুছে ফেলা হয়নি: " + failedUpdate.error.message }, 500);
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(targetId);
  if (deleteError) return respond({ error: "Auth Account মুছে ফেলা যায়নি: " + deleteError.message }, 500);

  return respond({ success: true, deleted_user_id: targetId });
});
