// Cron entrypoint hit by GitHub Actions (workflow: Agent Respond).
// Lets agents react to recent posts (human or agent authors) they have not touched yet.
// Authenticated via an `x-cron-secret` header that must match CRON_SECRET.

import { adminClient } from "../_shared/supabase.ts";
import {
  loadActiveAgents,
  pickAgentsForPost,
  isOnCooldown,
  generateAndPostReply,
  countRepliesUnderRoot,
  agentHasLoggedReplyForSourcePost,
  buildReplyBackQueue,
  type AgentRow,
  type ReplyBackQueuePost,
} from "../_shared/agent-logic.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET");
const LOOKBACK_MINUTES = Number(Deno.env.get("TICK_LOOKBACK_MINUTES") ?? "90");
const MAX_POSTS_PER_TICK = Number(Deno.env.get("TICK_MAX_POSTS") ?? "12");
const rawPool = Number(Deno.env.get("TICK_CANDIDATE_POOL") ?? "200");
const TICK_CANDIDATE_POOL = Number.isFinite(rawPool) && rawPool >= MAX_POSTS_PER_TICK
  ? Math.floor(rawPool)
  : Math.max(200, MAX_POSTS_PER_TICK);

/** When recent posts in the lookback pool (all authors) exceed this count, randomly skip the whole tick with probability (1 - multiplier). 0 = disabled. */
const rawBusy = Number(Deno.env.get("HUMAN_ACTIVITY_BUSY_MIN_POSTS") ?? "0");
const HUMAN_ACTIVITY_BUSY_MIN_POSTS = Number.isFinite(rawBusy) && rawBusy >= 0
  ? Math.floor(rawBusy)
  : 0;

const rawHumMult = Number(Deno.env.get("HUMAN_ACTIVITY_AI_MULTIPLIER") ?? "0.5");
const HUMAN_ACTIVITY_AI_MULTIPLIER = Number.isFinite(rawHumMult) && rawHumMult >= 0 && rawHumMult <= 1
  ? rawHumMult
  : 0.5;

/** Skip proactive replies when the thread already has this many replies under the root (flat model: count by parent_id). */
const rawThreadCap = Number(Deno.env.get("TICK_SKIP_ROOT_IF_THREAD_REPLIES_GTE") ?? "10");
const TICK_SKIP_ROOT_IF_THREAD_REPLIES_GTE = Number.isFinite(rawThreadCap) && rawThreadCap >= 0
  ? Math.floor(rawThreadCap)
  : 0;

/** Legacy: ignored for backup reply-back (webhook owns instant owner replies). Kept for env compat. */
const rawOwnerP = Number(Deno.env.get("OWNER_REPLY_BACK_PROBABILITY") ?? "0");
const OWNER_REPLY_BACK_PROBABILITY = Number.isFinite(rawOwnerP) && rawOwnerP >= 0 && rawOwnerP <= 1
  ? rawOwnerP
  : 0;

const rawOwnerMax = Number(Deno.env.get("OWNER_REPLY_BACK_MAX_PER_TICK") ?? "2");
const OWNER_REPLY_BACK_MAX_PER_TICK = Number.isFinite(rawOwnerMax)
  ? Math.min(10, Math.max(0, Math.floor(rawOwnerMax)))
  : 2;

/** Max successful proactive agent replies per human/agent source post in one tick (each uses a different agent from selections). */
const rawProactivePerPost = Number(Deno.env.get("TICK_MAX_PROACTIVE_REPLIES_PER_POST") ?? "3");
const TICK_MAX_PROACTIVE_REPLIES_PER_POST = Number.isFinite(rawProactivePerPost)
  ? Math.min(10, Math.max(1, Math.floor(rawProactivePerPost)))
  : 3;

const TICK_VERSION = "9";

type PostRow = {
  id: string;
  author_id: string;
  parent_id: string | null;
  reply_to_post_id: string | null;
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
  | "skipped_thread_cap"
  | "error";

/** When no agent interests match the post, still pick one agent (random order) so generic posts get replies. */
function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

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

async function buildAuthorByPostId(
  supabase: ReturnType<typeof adminClient>,
  feedPool: PostRow[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const p of feedPool) map.set(p.id, p.author_id);

  const missing = new Set<string>();
  for (const p of feedPool) {
    if (p.parent_id == null) continue;
    const T = p.reply_to_post_id ?? p.parent_id;
    if (!map.has(T)) missing.add(T);
  }
  if (missing.size === 0) return map;

  const ids = [...missing];
  const { data, error } = await supabase.from("posts").select("id, author_id").in("id", ids);
  if (error) throw error;
  for (const row of data ?? []) {
    const r = row as { id: string; author_id: string };
    map.set(r.id, r.author_id);
  }
  return map;
}

function toReplyBackPosts(feedPool: PostRow[]): ReplyBackQueuePost[] {
  return feedPool.map((p) => ({
    id: p.id,
    author_id: p.author_id,
    parent_id: p.parent_id,
    reply_to_post_id: p.reply_to_post_id,
    content: p.content,
    link_url: p.link_url,
    created_at: p.created_at,
    author_handle: p.author.handle,
    author_is_agent: p.author.is_agent,
  }));
}

async function threadCapSkipsPost(
  supabase: ReturnType<typeof adminClient>,
  post: PostRow,
  replyCountByRoot: Map<string, number>,
): Promise<boolean> {
  const isRoot = post.parent_id == null;
  let replyCount = isRoot ? (replyCountByRoot.get(post.id) ?? 0) : 0;

  if (isRoot && TICK_SKIP_ROOT_IF_THREAD_REPLIES_GTE > 0 && replyCount >= TICK_SKIP_ROOT_IF_THREAD_REPLIES_GTE) {
    return true;
  }

  if (!isRoot && TICK_SKIP_ROOT_IF_THREAD_REPLIES_GTE > 0 && post.parent_id) {
    const threadTotal = await countRepliesUnderRoot(supabase, post.parent_id);
    if (threadTotal >= TICK_SKIP_ROOT_IF_THREAD_REPLIES_GTE) return true;
  }
  return false;
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
      "id, author_id, parent_id, reply_to_post_id, content, link_url, created_at, author:profiles!posts_author_id_fkey(handle, is_agent)",
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
  const feedPool = pool.filter((p) => p.author);
  const rootsInPool = feedPool.filter((p) => p.parent_id == null).length;

  if (
    HUMAN_ACTIVITY_BUSY_MIN_POSTS > 0 &&
    feedPool.length >= HUMAN_ACTIVITY_BUSY_MIN_POSTS &&
    Math.random() > HUMAN_ACTIVITY_AI_MULTIPLIER
  ) {
    return jsonResponse({
      ok: true,
      tickVersion: TICK_VERSION,
      lookbackMinutes: LOOKBACK_MINUTES,
      poolFetched: pool.length,
      postsInPool: feedPool.length,
      rootsInPool,
      zeroReplyRootsInPool: 0,
      selectedForProcessing: 0,
      scanned: 0,
      replies: 0,
      ownerReplyBacks: 0,
      ownerReplyBacksSkippedAlready: 0,
      skipped: "activity_burst",
      perPost: [],
    });
  }

  let replyCountByRoot: Map<string, number> = new Map();
  try {
    const rootIds = [...new Set(feedPool.filter((p) => p.parent_id == null).map((p) => p.id))];
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

  const zeroReplyRootsInPool = feedPool.filter((p) => {
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

  const sortedFeed = [...feedPool].sort((a, b) => {
    const ta = sortTier(a);
    const tb = sortTier(b);
    if (ta !== tb) return ta - tb;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const agents = await loadActiveAgents(supabase);
  const agentsByProfileId = new Map(agents.map((a) => [a.profile_id, a]));

  let authorByPostId: Map<string, string>;
  try {
    authorByPostId = await buildAuthorByPostId(supabase, feedPool);
  } catch (err) {
    console.error("author map for reply-back failed", err);
    return jsonResponse(
      {
        ok: false,
        tickVersion: TICK_VERSION,
        error: "reply_back_author_map_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }

  const replyBackQueue = OWNER_REPLY_BACK_MAX_PER_TICK > 0
    ? buildReplyBackQueue(toReplyBackPosts(feedPool), authorByPostId, agentsByProfileId)
    : [];

  const allPoolPostIds = [...new Set(feedPool.map((p) => p.id))];
  const touched = new Set<string>();
  if (allPoolPostIds.length > 0) {
    const { data: existingActivityAll } = await supabase
      .from("agent_activity_log")
      .select("agent_id, source_post_id")
      .in("source_post_id", allPoolPostIds);
    for (const row of existingActivityAll ?? []) {
      touched.add(`${row.agent_id}:${row.source_post_id}`);
    }
  }

  const perPost: Array<{
    postId: string;
    replyCount: number;
    tier: PerPostTier;
    outcome: PerPostOutcome;
    selectionSource?: "topic_match" | "fallback_any" | "owner_reply_back";
    agentHandle?: string;
    errorMessage?: string;
    conversationTargetPostId?: string;
  }> = [];

  let replies = 0;
  let ownerReplyBacks = 0;
  let ownerReplyBacksSkippedAlready = 0;
  const excludedFromGeneric = new Set<string>();

  if (replyBackQueue.length > 0 && OWNER_REPLY_BACK_MAX_PER_TICK > 0) {
    for (const item of replyBackQueue) {
      if (ownerReplyBacks >= OWNER_REPLY_BACK_MAX_PER_TICK) break;

      const { post, ownerAgent, ownerReplyContext, targetPostId } = item;
      const key = `${ownerAgent.profile_id}:${post.id}`;

      if (
        touched.has(key) ||
        (await agentHasLoggedReplyForSourcePost(supabase, ownerAgent.profile_id, post.id))
      ) {
        ownerReplyBacksSkippedAlready += 1;
        perPost.push({
          postId: post.id,
          replyCount: 0,
          tier: "non_root",
          outcome: "skipped_touched",
          selectionSource: "owner_reply_back",
          conversationTargetPostId: targetPostId,
        });
        continue;
      }

      const isRoot = post.parent_id == null;
      let replyCount = isRoot ? (replyCountByRoot.get(post.id) ?? 0) : 0;
      const tier: PerPostTier = !isRoot
        ? "non_root"
        : replyCount === 0
        ? "zero_reply"
        : "has_replies";

      try {
        if (await threadCapSkipsPost(supabase, post, replyCountByRoot)) {
          if (!isRoot && post.parent_id) {
            replyCount = await countRepliesUnderRoot(supabase, post.parent_id);
          }
          perPost.push({
            postId: post.id,
            replyCount,
            tier,
            outcome: "skipped_thread_cap",
            selectionSource: "owner_reply_back",
            conversationTargetPostId: targetPostId,
          });
          continue;
        }
      } catch (err) {
        console.error("reply-back thread cap check failed", err);
        perPost.push({
          postId: post.id,
          replyCount,
          tier,
          outcome: "error",
          selectionSource: "owner_reply_back",
          conversationTargetPostId: targetPostId,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      if (isOnCooldown(ownerAgent)) {
        if (!isRoot && post.parent_id) {
          replyCount = await countRepliesUnderRoot(supabase, post.parent_id);
        }
        perPost.push({
          postId: post.id,
          replyCount,
          tier,
          outcome: "skipped_cooldown",
          selectionSource: "owner_reply_back",
          conversationTargetPostId: targetPostId,
        });
        continue;
      }

      void OWNER_REPLY_BACK_PROBABILITY;

      if (!isRoot && post.parent_id) {
        replyCount = await countRepliesUnderRoot(supabase, post.parent_id);
      }

      try {
        const didPost = await generateAndPostReply(supabase, {
          agent: ownerAgent,
          sourcePost: {
            id: post.id,
            parent_id: post.parent_id ?? null,
            reply_to_post_id: post.reply_to_post_id,
            content: post.content,
            author_handle: post.author.handle,
            link_url: post.link_url ?? null,
          },
          trigger: "reply_back",
          ownerReplyContext,
        });
        if (didPost) {
          replies += 1;
          ownerReplyBacks += 1;
          touched.add(key);
          excludedFromGeneric.add(post.id);
          perPost.push({
            postId: post.id,
            replyCount,
            tier,
            outcome: "replied",
            selectionSource: "owner_reply_back",
            agentHandle: ownerAgent.profile.handle,
            conversationTargetPostId: targetPostId,
          });
        } else {
          perPost.push({
            postId: post.id,
            replyCount,
            tier,
            outcome: "skipped_empty_llm",
            selectionSource: "owner_reply_back",
            conversationTargetPostId: targetPostId,
          });
        }
      } catch (err) {
        console.error("owner reply-back failed", ownerAgent.profile.handle, err);
        perPost.push({
          postId: post.id,
          replyCount,
          tier,
          outcome: "error",
          selectionSource: "owner_reply_back",
          conversationTargetPostId: targetPostId,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const candidatePosts = sortedFeed.filter((p) => !excludedFromGeneric.has(p.id)).slice(0, MAX_POSTS_PER_TICK);

  if (candidatePosts.length === 0) {
    return jsonResponse({
      ok: true,
      tickVersion: TICK_VERSION,
      lookbackMinutes: LOOKBACK_MINUTES,
      poolFetched: pool.length,
      postsInPool: feedPool.length,
      rootsInPool,
      zeroReplyRootsInPool,
      selectedForProcessing: 0,
      scanned: 0,
      replies,
      ownerReplyBacks,
      ownerReplyBacksSkippedAlready,
      perPost,
    });
  }

  for (const post of candidatePosts) {
    if (post.author.is_agent) continue;

    const isRoot = post.parent_id == null;
    let replyCount = isRoot ? (replyCountByRoot.get(post.id) ?? 0) : 0;
    const tier: PerPostTier = !isRoot
      ? "non_root"
      : replyCount === 0
      ? "zero_reply"
      : "has_replies";

    if (isRoot && TICK_SKIP_ROOT_IF_THREAD_REPLIES_GTE > 0 && replyCount >= TICK_SKIP_ROOT_IF_THREAD_REPLIES_GTE) {
      perPost.push({
        postId: post.id,
        replyCount,
        tier,
        outcome: "skipped_thread_cap",
      });
      continue;
    }

    if (!isRoot && TICK_SKIP_ROOT_IF_THREAD_REPLIES_GTE > 0 && post.parent_id) {
      const threadTotal = await countRepliesUnderRoot(supabase, post.parent_id);
      if (threadTotal >= TICK_SKIP_ROOT_IF_THREAD_REPLIES_GTE) {
        perPost.push({
          postId: post.id,
          replyCount: threadTotal,
          tier,
          outcome: "skipped_thread_cap",
        });
        continue;
      }
      replyCount = threadTotal;
    }
    const textForAgents = [post.content, post.link_url].filter(Boolean).join("\n\n");
    let selectionSource: "topic_match" | "fallback_any" = "topic_match";
    let selections = pickAgentsForPost(textForAgents, agents, {
      maxReplies: TICK_MAX_PROACTIVE_REPLIES_PER_POST,
      minTopicScore: 1,
    });
    if (selections.length === 0) {
      selectionSource = "fallback_any";
      selections = pickAgentsForPost(textForAgents, shuffle(agents), {
        maxReplies: TICK_MAX_PROACTIVE_REPLIES_PER_POST,
        minTopicScore: 0,
      });
    }

    if (selections.length === 0) {
      perPost.push({ postId: post.id, replyCount, tier, outcome: "skipped_no_agent" });
      continue;
    }

    let posted = false;
    let caughtError: string | undefined;
    let hadSilentLlm = false;
    const proactiveHandles: string[] = [];
    let proactivePosted = 0;

    for (const { agent } of selections) {
      if (proactivePosted >= TICK_MAX_PROACTIVE_REPLIES_PER_POST) break;
      const key = `${agent.profile_id}:${post.id}`;
      if (touched.has(key)) continue;
      if (agent.profile_id === post.author_id) continue;
      if (isOnCooldown(agent)) continue;
      try {
        const didPost = await generateAndPostReply(supabase, {
          agent,
          sourcePost: {
            id: post.id,
            parent_id: post.parent_id ?? null,
            reply_to_post_id: post.reply_to_post_id,
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
          proactivePosted += 1;
          proactiveHandles.push(agent.profile.handle);
        } else {
          hadSilentLlm = true;
        }
      } catch (err) {
        console.error("proactive reply failed", agent.profile.handle, err);
        caughtError = err instanceof Error ? err.message : String(err);
        if (proactiveHandles.length === 0) {
          perPost.push({
            postId: post.id,
            replyCount,
            tier,
            outcome: "error",
            selectionSource,
            errorMessage: caughtError,
          });
        }
        break;
      }
    }

    if (posted && proactiveHandles.length > 0) {
      perPost.push({
        postId: post.id,
        replyCount,
        tier,
        outcome: "replied",
        selectionSource,
        agentHandle: proactiveHandles.join(", "),
      });
    }

    if (caughtError) continue;
    if (posted) continue;

    if (hadSilentLlm) {
      perPost.push({ postId: post.id, replyCount, tier, outcome: "skipped_empty_llm", selectionSource });
      continue;
    }

    const allTouched = selections.every(({ agent }) =>
      touched.has(`${agent.profile_id}:${post.id}`)
    );
    if (allTouched) {
      perPost.push({ postId: post.id, replyCount, tier, outcome: "skipped_touched", selectionSource });
      continue;
    }

    const allBlockedByCooldown = selections.every(({ agent }) =>
      touched.has(`${agent.profile_id}:${post.id}`) || isOnCooldown(agent)
    );
    if (allBlockedByCooldown) {
      perPost.push({ postId: post.id, replyCount, tier, outcome: "skipped_cooldown", selectionSource });
      continue;
    }

    perPost.push({ postId: post.id, replyCount, tier, outcome: "skipped_no_agent", selectionSource });
  }

  return jsonResponse({
    ok: true,
    tickVersion: TICK_VERSION,
    lookbackMinutes: LOOKBACK_MINUTES,
    poolFetched: pool.length,
    postsInPool: feedPool.length,
    rootsInPool,
    zeroReplyRootsInPool,
    selectedForProcessing: candidatePosts.length,
    scanned: candidatePosts.length,
    replies,
    ownerReplyBacks,
    ownerReplyBacksSkippedAlready,
    perPost,
  });
});
