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

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceKey || !anonKey) return respond({ error: "Server configuration missing" }, 500);

  let body: any;
  try { body = await req.json(); } catch { return respond({ error: "Invalid request body" }, 400); }
  const loginId = String(body.login_id || "").trim().toUpperCase();
  const password = String(body.password || "");
  if (!/^[A-Z0-9._-]{3,40}$/.test(loginId) || !password) {
    return respond({ error: "সঠিক User ID ও Password দিন।" }, 400);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("id,is_active").ilike("login_id", loginId).maybeSingle();
  if (profileError || !profile || !profile.is_active) {
    return respond({ error: "User ID অথবা Password সঠিক নয়, অথবা Account বন্ধ আছে।" }, 401);
  }

  const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(profile.id);
  if (authUserError || !authUser.user?.email) {
    return respond({ error: "এই User-এর Login তথ্য পাওয়া যায়নি। Main Admin-এর সঙ্গে যোগাযোগ করুন।" }, 401);
  }

  const publicClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: signedIn, error: signInError } = await publicClient.auth.signInWithPassword({
    email: authUser.user.email,
    password,
  });
  if (signInError || !signedIn.session) {
    return respond({ error: "User ID অথবা Password সঠিক নয়।" }, 401);
  }

  return respond({
    access_token: signedIn.session.access_token,
    refresh_token: signedIn.session.refresh_token,
  });
});
