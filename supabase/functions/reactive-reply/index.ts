// Triggered by a Database Webhook on `public.posts` (INSERT).
// Phase 1: all @mentions. Phase 2: owner reply-back (human commenters only).
// Phase 3: capped topic replies on human root posts only.

import { adminClient } from "../_shared/supabase.ts";
import {
  loadActiveAgents,
  pickMentionedAgents,
  pickTopicAgentsForPost,
  isOnCooldown,
  generateAndPostReply,
  agentHasLoggedReplyForSourcePost,
  resolveOwnerReplyBackForInsert,
  isReactiveTopicEligible,
  isReactiveOwnerReplyBackEligible,
  type AgentRow,
} from "../_shared/agent-logic.ts";

type WebhookPayload = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: {
    id: string;
    author_id: string;
    parent_id: string | null;
    reply_to_post_id?: string | null;
    content: string;
    link_url?: string | null;
    created_at: string;
  };
};

const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET");
const REACTIVE_VERSION = "3";

const rawReactiveMax = Number(Deno.env.get("REACTIVE_MAX_REPLIES") ?? "3");
const REACTIVE_MAX_REPLIES = Number.isFinite(rawReactiveMax)
  ? Math.min(10, Math.max(1, Math.floor(rawReactiveMax)))
  : 3;

const rawMentionMax = Number(Deno.env.get("REACTIVE_MAX_MENTION_REPLIES") ?? "10");
const REACTIVE_MAX_MENTION_REPLIES = Number.isFinite(rawMentionMax)
  ? Math.min(10, Math.max(1, Math.floor(rawMentionMax)))
  : 10;

type PhaseResult = { handle: string; status: string };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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
    return jsonResponse({ ok: true, reactiveVersion: REACTIVE_VERSION, skipped: "wrong-event" });
  }

  const supabase = adminClient();
  const post = payload.record;

  const { data: authorProfile } = await supabase
    .from("profiles")
    .select("id, handle, is_agent")
    .eq("id", post.author_id)
    .maybeSingle();

  if (!authorProfile) {
    return jsonResponse({ ok: true, reactiveVersion: REACTIVE_VERSION, skipped: "unknown_author" });
  }

  const agents = await loadActiveAgents(supabase);
  const agentsByProfileId = new Map<string, AgentRow>(
    agents.map((a) => [a.profile_id, a]),
  );
  const textForAgents = [post.content, post.link_url].filter(Boolean).join("\n\n");
  const handledProfileIds = new Set<string>();

  const mentionResults: PhaseResult[] = [];
  const ownerResults: PhaseResult[] = [];
  const topicResults: PhaseResult[] = [];

  const sourcePost = {
    id: post.id,
    parent_id: post.parent_id ?? null,
    reply_to_post_id: post.reply_to_post_id ?? null,
    content: post.content,
    author_handle: authorProfile.handle,
    link_url: post.link_url ?? null,
  };

  // Phase 1: mandatory @mentions
  const mentionSelections = pickMentionedAgents(textForAgents, agents, {
    maxReplies: REACTIVE_MAX_MENTION_REPLIES,
  });

  for (const { agent } of mentionSelections) {
    if (agent.profile_id === post.author_id) {
      mentionResults.push({ handle: agent.profile.handle, status: "skipped_self_author" });
      continue;
    }
    if (await agentHasLoggedReplyForSourcePost(supabase, agent.profile_id, post.id)) {
      mentionResults.push({ handle: agent.profile.handle, status: "skipped_already" });
      handledProfileIds.add(agent.profile_id);
      continue;
    }
    try {
      const didPost = await generateAndPostReply(supabase, {
        agent,
        sourcePost,
        trigger: "mention",
      });
      if (didPost) {
        mentionResults.push({ handle: agent.profile.handle, status: "replied" });
        handledProfileIds.add(agent.profile_id);
      } else {
        mentionResults.push({ handle: agent.profile.handle, status: "skipped_empty_llm" });
      }
    } catch (err) {
      console.error("mention reply failed", agent.profile.handle, err);
      mentionResults.push({ handle: agent.profile.handle, status: "error" });
    }
  }

  // Phase 2: owner reply-back (human commenter → agent owner of target post)
  if (isReactiveOwnerReplyBackEligible(post, authorProfile)) {
    try {
      const owner = await resolveOwnerReplyBackForInsert(
        supabase,
        {
          id: post.id,
          author_id: post.author_id,
          parent_id: post.parent_id,
          reply_to_post_id: post.reply_to_post_id,
        },
        agentsByProfileId,
      );

      if (!owner) {
        ownerResults.push({ handle: "", status: "skipped_no_owner_agent" });
      } else {
        const { ownerAgent, ownerReplyContext } = owner;
        if (handledProfileIds.has(ownerAgent.profile_id)) {
          ownerResults.push({ handle: ownerAgent.profile.handle, status: "skipped_already_handled" });
        } else if (await agentHasLoggedReplyForSourcePost(supabase, ownerAgent.profile_id, post.id)) {
          ownerResults.push({ handle: ownerAgent.profile.handle, status: "skipped_already" });
          handledProfileIds.add(ownerAgent.profile_id);
        } else {
          try {
            const didPost = await generateAndPostReply(supabase, {
              agent: ownerAgent,
              sourcePost,
              trigger: "reply_back",
              ownerReplyContext,
            });
            if (didPost) {
              ownerResults.push({ handle: ownerAgent.profile.handle, status: "replied" });
              handledProfileIds.add(ownerAgent.profile_id);
            } else {
              ownerResults.push({ handle: ownerAgent.profile.handle, status: "skipped_empty_llm" });
            }
          } catch (err) {
            console.error("owner reply-back failed", ownerAgent.profile.handle, err);
            ownerResults.push({ handle: ownerAgent.profile.handle, status: "error" });
          }
        }
      }
    } catch (err) {
      console.error("owner reply-back resolve failed", err);
      ownerResults.push({ handle: "", status: "error_resolve" });
    }
  }

  // Phase 3: optional topic replies on human roots only (avoids agent-on-agent cascades)
  if (!isReactiveTopicEligible(post, authorProfile)) {
    topicResults.push({ handle: "", status: "skipped_not_eligible" });
  } else {
  const topicSelections = pickTopicAgentsForPost(textForAgents, agents, {
    maxReplies: REACTIVE_MAX_REPLIES,
    minTopicScore: 1,
    excludeProfileIds: handledProfileIds,
  });

  for (const { agent } of topicSelections) {
    if (agent.profile_id === post.author_id) {
      topicResults.push({ handle: agent.profile.handle, status: "skipped_self_author" });
      continue;
    }
    if (handledProfileIds.has(agent.profile_id)) {
      topicResults.push({ handle: agent.profile.handle, status: "skipped_already_handled" });
      continue;
    }
    if (await agentHasLoggedReplyForSourcePost(supabase, agent.profile_id, post.id)) {
      topicResults.push({ handle: agent.profile.handle, status: "skipped_already" });
      continue;
    }
    if (isOnCooldown(agent)) {
      topicResults.push({ handle: agent.profile.handle, status: "cooldown" });
      continue;
    }
    try {
      const didPost = await generateAndPostReply(supabase, {
        agent,
        sourcePost,
        trigger: "topic",
      });
      if (didPost) {
        topicResults.push({ handle: agent.profile.handle, status: "replied" });
        handledProfileIds.add(agent.profile_id);
      } else {
        topicResults.push({ handle: agent.profile.handle, status: "skipped_empty_llm" });
      }
    } catch (err) {
      console.error("topic reply failed", agent.profile.handle, err);
      topicResults.push({ handle: agent.profile.handle, status: "error" });
    }
  }
  }

  return jsonResponse({
    ok: true,
    reactiveVersion: REACTIVE_VERSION,
    postId: post.id,
    mentions: mentionResults,
    owner_reply_back: ownerResults,
    topic: topicResults,
  });
});
