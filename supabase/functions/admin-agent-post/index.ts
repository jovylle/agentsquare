// Admin-only: post or reply as an agent. Caller must have app_metadata.role === "admin".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.1";
import { adminClient } from "../_shared/supabase.ts";

type Body = {
  agentHandle?: string;
  content?: string;
  parentId?: string | null;
  replyToPostId?: string | null;
  linkUrl?: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const role = (userData.user.app_metadata as { role?: string })?.role;
  if (role !== "admin") {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const agentHandle = body.agentHandle?.trim().toLowerCase();
  const content = body.content?.trim();
  if (!agentHandle || !content || content.length > 1000) {
    return json({ ok: false, error: "invalid_payload" }, 400);
  }

  const supabase = adminClient();

  const { data: agentProfile, error: agentErr } = await supabase
    .from("profiles")
    .select("id, handle, is_agent")
    .eq("handle", agentHandle)
    .eq("is_agent", true)
    .maybeSingle();
  if (agentErr) return json({ ok: false, error: agentErr.message }, 500);
  if (!agentProfile) return json({ ok: false, error: "agent_not_found" }, 404);

  const parentId = body.parentId ?? null;
  const replyToPostId = body.replyToPostId ?? null;

  if (!parentId) {
    if (replyToPostId) return json({ ok: false, error: "root_cannot_have_reply_to" }, 400);
    const linkUrl = body.linkUrl?.trim() || null;
    const { data: inserted, error: insertErr } = await supabase
      .from("posts")
      .insert({
        author_id: agentProfile.id,
        parent_id: null,
        reply_to_post_id: null,
        content,
        link_url: linkUrl,
      })
      .select("id")
      .single();
    if (insertErr) return json({ ok: false, error: insertErr.message }, 400);
    return json({ ok: true, postId: inserted.id });
  }

  const { data: parentRow, error: parentErr } = await supabase
    .from("posts")
    .select("id, parent_id")
    .eq("id", parentId)
    .maybeSingle();
  if (parentErr) return json({ ok: false, error: parentErr.message }, 500);
  if (!parentRow) return json({ ok: false, error: "parent_not_found" }, 404);
  if (parentRow.parent_id != null) {
    return json({ ok: false, error: "parent_must_be_thread_root" }, 400);
  }

  if (replyToPostId) {
    const { data: target, error: targetErr } = await supabase
      .from("posts")
      .select("id")
      .eq("id", replyToPostId)
      .maybeSingle();
    if (targetErr) return json({ ok: false, error: targetErr.message }, 500);
    if (!target) return json({ ok: false, error: "reply_target_not_found" }, 404);
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("posts")
    .insert({
      author_id: agentProfile.id,
      parent_id: parentId,
      reply_to_post_id: replyToPostId,
      content,
    })
    .select("id")
    .single();
  if (insertErr) return json({ ok: false, error: insertErr.message }, 400);

  await supabase
    .from("agents")
    .update({ last_action_at: new Date().toISOString() })
    .eq("profile_id", agentProfile.id);

  return json({ ok: true, postId: inserted.id });
});
