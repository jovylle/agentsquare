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
const rawPool = Number(Deno.env.get("TICK_CANDIDATE_POOL") ?? "200");
const TICK_CANDIDATE_POOL = Number.isFinite(rawPool) && rawPool >= MAX_POSTS_PER_TICK
  ? Math.floor(rawPool)
  : Math.max(200, MAX_POSTS_PER_TICK);

const TICK_VERSION = "1";

type PostRow = {
  id: string;
  author_id: string;
  parent_id: string | null;
  content: string;
  link_url: string | null;
  created_at: string;
  author: { handle: string; is_agent: boolean };
};

type PerPostTier = "zero_reply" | "has_replies" | "non_root";
type PerPostOutcome =
  | "replied"
  | "skipped_no_agent"
  | "skipped_touched"
  | "skipped_cooldown"
  | "skipped_empty_llm"
  | "error";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function replyCountsByRootId(
  supabase: ReturnType<typeof adminClient>,
  rootIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (rootIds.length === 0) return counts;

  const { data, error } = await supabase
    .from("posts")
    .select("parent_id")
    .in("parent_id", rootIds);

  if (error) throw error;
  for (const row of data ?? []) {
    const pid = (row as { parent_id: string }).parent_id;
    counts.set(pid, (counts.get(pid) ?? 0) + 1);
  }
  return counts;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!CRON_SECRET) {
    return jsonResponse({ ok: false, tickVersion: TICK_VERSION, error: "cron_secret_not_configured" }, 500);
  }

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
    .limit(TICK_CANDIDATE_POOL);

  if (postsError) {
    console.error("Failed to load recent posts", postsError);
    return jsonResponse(
      {
        ok: false,
        tickVersion: TICK_VERSION,
        error: "posts_load_failed",
        detail: postsError.message,
      },
      500,
    );
  }

  const pool = (recentPosts ?? []) as PostRow[];
  const humanPool = pool.filter((p) => p.author && !p.author.is_agent);
  const humanRootsInPool = humanPool.filter((p) => p.parent_id == null).length;

  let replyCountByRoot: Map<string, number> = new Map();
  try {
    const rootIds = [...new Set(humanPool.filter((p) => p.parent_id == null).map((p) => p.id))];
    replyCountByRoot = await replyCountsByRootId(supabase, rootIds);
  } catch (err) {
    console.error("reply count batch failed", err);
    return jsonResponse(
      {
        ok: false,
        tickVersion: TICK_VERSION,
        error: "reply_counts_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }

  const zeroReplyRootsInPool = humanPool.filter((p) => {
    if (p.parent_id != null) return false;
    return (replyCountByRoot.get(p.id) ?? 0) === 0;
  }).length;

  function sortTier(p: PostRow): number {
    if (p.parent_id == null) {
      const rc = replyCountByRoot.get(p.id) ?? 0;
      return rc === 0 ? 0 : 1;
    }
    return 2;
  }

  const sortedHumans = [...humanPool].sort((a, b) => {
    const ta = sortTier(a);
    const tb = sortTier(b);
    if (ta !== tb) return ta - tb;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const candidatePosts = sortedHumans.slice(0, MAX_POSTS_PER_TICK);

  if (candidatePosts.length === 0) {
    return jsonResponse({
      ok: true,
      tickVersion: TICK_VERSION,
      lookbackMinutes: LOOKBACK_MINUTES,
      poolFetched: pool.length,
      humanInPool: humanPool.length,
      humanRootsInPool,
      zeroReplyRootsInPool,
      selectedForProcessing: 0,
      scanned: 0,
      replies: 0,
      perPost: [],
    });
  }

  const postIds = candidatePosts.map((p) => p.id);
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

  const perPost: Array<{
    postId: string;
    replyCount: number;
    tier: PerPostTier;
    outcome: PerPostOutcome;
    agentHandle?: string;
    errorMessage?: string;
  }> = [];

  for (const post of candidatePosts) {
    const isRoot = post.parent_id == null;
    const replyCount = isRoot ? (replyCountByRoot.get(post.id) ?? 0) : 0;
    const tier: PerPostTier = !isRoot
      ? "non_root"
      : replyCount === 0
      ? "zero_reply"
      : "has_replies";

    const textForAgents = [post.content, post.link_url].filter(Boolean).join("\n\n");
    const selections = pickAgentsForPost(textForAgents, agents, {
      maxReplies: 1,
      minTopicScore: 1,
    });

    if (selections.length === 0) {
      perPost.push({ postId: post.id, replyCount, tier, outcome: "skipped_no_agent" });
      continue;
    }

    let posted = false;
    let caughtError: string | undefined;
    let hadSilentLlm = false;

    for (const { agent } of selections) {
      const key = `${agent.profile_id}:${post.id}`;
      if (touched.has(key)) continue;
      if (isOnCooldown(agent)) continue;
      try {
        const didPost = await generateAndPostReply(supabase, {
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
        if (didPost) {
          replies += 1;
          touched.add(key);
          posted = true;
          perPost.push({
            postId: post.id,
            replyCount,
            tier,
            outcome: "replied",
            agentHandle: agent.profile.handle,
          });
          break;
        }
        hadSilentLlm = true;
      } catch (err) {
        console.error("proactive reply failed", agent.profile.handle, err);
        caughtError = err instanceof Error ? err.message : String(err);
        perPost.push({
          postId: post.id,
          replyCount,
          tier,
          outcome: "error",
          errorMessage: caughtError,
        });
        break;
      }
    }

    if (posted || caughtError) continue;

    if (hadSilentLlm) {
      perPost.push({ postId: post.id, replyCount, tier, outcome: "skipped_empty_llm" });
      continue;
    }

    const allTouched = selections.every(({ agent }) =>
      touched.has(`${agent.profile_id}:${post.id}`)
    );
    if (allTouched) {
      perPost.push({ postId: post.id, replyCount, tier, outcome: "skipped_touched" });
      continue;
    }

    const allBlockedByCooldown = selections.every(({ agent }) =>
      touched.has(`${agent.profile_id}:${post.id}`) || isOnCooldown(agent)
    );
    if (allBlockedByCooldown) {
      perPost.push({ postId: post.id, replyCount, tier, outcome: "skipped_cooldown" });
      continue;
    }

    perPost.push({ postId: post.id, replyCount, tier, outcome: "skipped_no_agent" });
  }

  return jsonResponse({
    ok: true,
    tickVersion: TICK_VERSION,
    lookbackMinutes: LOOKBACK_MINUTES,
    poolFetched: pool.length,
    humanInPool: humanPool.length,
    humanRootsInPool,
    zeroReplyRootsInPool,
    selectedForProcessing: candidatePosts.length,
    scanned: candidatePosts.length,
    replies,
    perPost,
  });
});
