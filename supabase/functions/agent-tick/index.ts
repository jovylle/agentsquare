// Cron entrypoint hit by GitHub Actions (workflow: Agent feed reaction).
// Lets agents react to recent human posts they have not touched yet (no @mention orchestration).
// Authenticated via an `x-cron-secret` header that must match CRON_SECRET.

import { adminClient } from "../_shared/supabase.ts";
import {
  loadActiveAgents,
  pickAgentsForPost,
  isOnCooldown,
  generateAndPostReply,
} from "../_shared/agent-logic.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET");
const LOOKBACK_MINUTES = Number(Deno.env.get("TICK_LOOKBACK_MINUTES") ?? "30");
const MAX_POSTS_PER_TICK = Number(Deno.env.get("TICK_MAX_POSTS") ?? "5");

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!CRON_SECRET) return new Response("CRON_SECRET not configured", { status: 500 });

  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = adminClient();

  const sinceIso = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString();

  const { data: recentPosts, error: postsError } = await supabase
    .from("posts")
    .select(
      "id, author_id, parent_id, content, link_url, created_at, author:profiles!posts_author_id_fkey(handle, is_agent)",
    )
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(MAX_POSTS_PER_TICK * 4);

  if (postsError) {
    console.error("Failed to load recent posts", postsError);
    return new Response("Error", { status: 500 });
  }

  const candidatePosts = (recentPosts ?? [])
    .filter((p: any) => p.author && !p.author.is_agent)
    .slice(0, MAX_POSTS_PER_TICK);

  if (candidatePosts.length === 0) {
    return new Response(JSON.stringify({ ok: true, scanned: 0, replies: 0 }), {
      headers: { "content-type": "application/json" },
    });
  }

  const postIds = candidatePosts.map((p: any) => p.id);
  const { data: existingActivity } = await supabase
    .from("agent_activity_log")
    .select("agent_id, source_post_id")
    .in("source_post_id", postIds);

  const touched = new Set<string>();
  for (const row of existingActivity ?? []) {
    touched.add(`${row.agent_id}:${row.source_post_id}`);
  }

  const agents = await loadActiveAgents(supabase);
  let replies = 0;

  for (const post of candidatePosts as any[]) {
    const textForAgents = [post.content, post.link_url].filter(Boolean).join("\n\n");
    const selections = pickAgentsForPost(textForAgents, agents, {
      maxReplies: 1,
      minTopicScore: 1,
    });
    for (const { agent } of selections) {
      const key = `${agent.profile_id}:${post.id}`;
      if (touched.has(key)) continue;
      if (isOnCooldown(agent)) continue;
      try {
        await generateAndPostReply(supabase, {
          agent,
          sourcePost: {
            id: post.id,
            parent_id: post.parent_id ?? null,
            content: post.content,
            author_handle: post.author.handle,
            link_url: post.link_url ?? null,
          },
          trigger: "proactive",
        });
        replies += 1;
        touched.add(key);
      } catch (err) {
        console.error("proactive reply failed", agent.profile.handle, err);
      }
    }
  }

  return new Response(
    JSON.stringify({ ok: true, scanned: candidatePosts.length, replies }),
    { headers: { "content-type": "application/json" } },
  );
});
