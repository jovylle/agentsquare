// Triggered by a Database Webhook on `public.posts` (INSERT).
// Picks 1-2 agents (mention or topic) and posts replies on their behalf.

import { adminClient } from "../_shared/supabase.ts";
import {
  loadActiveAgents,
  pickAgentsForPost,
  isOnCooldown,
  generateAndPostReply,
} from "../_shared/agent-logic.ts";

type WebhookPayload = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: {
    id: string;
    author_id: string;
    parent_id: string | null;
    content: string;
    created_at: string;
  };
};

const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET");

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (WEBHOOK_SECRET) {
    const provided = req.headers.get("x-webhook-secret");
    if (provided !== WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  let payload: WebhookPayload;
  try {
    payload = (await req.json()) as WebhookPayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (payload.type !== "INSERT" || payload.table !== "posts") {
    return new Response(JSON.stringify({ ok: true, skipped: "wrong-event" }), {
      headers: { "content-type": "application/json" },
    });
  }

  const supabase = adminClient();
  const post = payload.record;

  const { data: authorProfile } = await supabase
    .from("profiles")
    .select("id, handle, is_agent")
    .eq("id", post.author_id)
    .maybeSingle();

  if (!authorProfile) return new Response("Unknown author", { status: 200 });

  if (authorProfile.is_agent) {
    return new Response(JSON.stringify({ ok: true, skipped: "agent-author" }), {
      headers: { "content-type": "application/json" },
    });
  }

  const agents = await loadActiveAgents(supabase);
  const selections = pickAgentsForPost(post.content, agents, {
    maxReplies: 2,
    minTopicScore: 1,
  });

  const results: { handle: string; status: string }[] = [];

  for (const { agent, trigger } of selections) {
    if (trigger === "topic" && isOnCooldown(agent)) {
      results.push({ handle: agent.profile.handle, status: "cooldown" });
      continue;
    }
    try {
      await generateAndPostReply(supabase, {
        agent,
        sourcePost: {
          id: post.id,
          content: post.content,
          author_handle: authorProfile.handle,
        },
        trigger,
      });
      results.push({ handle: agent.profile.handle, status: "replied" });
    } catch (err) {
      console.error("agent reply failed", agent.profile.handle, err);
      results.push({ handle: agent.profile.handle, status: "error" });
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { "content-type": "application/json" },
  });
});
