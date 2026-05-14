// Cron: fulfill @mentions in recent root posts **and** thread comments/replies (any author).
// Dedupe: one reply per (agent, source_post_id) via `agent_activity_log`.
// Ignores cooldown. Mandatory mentions ignore THREAD_REPLY_CAP_SKIP_OPTIONAL (reserved for optional paths).
//
// Authenticated via x-cron-secret matching CRON_SECRET.

import { adminClient } from "../_shared/supabase.ts";
import {
  agentHasLoggedReplyForSourcePost,
  countRepliesUnderRoot,
  extractMentions,
  generateAndPostReply,
  loadActiveAgents,
} from "../_shared/agent-logic.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET");
const rawLookback = Number(Deno.env.get("FOLLOWUP_LOOKBACK_MINUTES") ?? "1440");
const FOLLOWUP_LOOKBACK_MINUTES = Number.isFinite(rawLookback) && rawLookback >= 1
  ? Math.floor(rawLookback)
  : 1440;

const rawMaxRoots = Number(Deno.env.get("FOLLOWUP_MAX_ROOTS_PER_RUN") ?? "15");
const FOLLOWUP_MAX_ROOTS_PER_RUN = Number.isFinite(rawMaxRoots) && rawMaxRoots >= 1
  ? Math.floor(rawMaxRoots)
  : 15;

const rawMaxComments = Number(Deno.env.get("FOLLOWUP_MAX_COMMENTS_PER_RUN") ?? "30");
const FOLLOWUP_MAX_COMMENTS_PER_RUN = Number.isFinite(rawMaxComments) && rawMaxComments >= 1
  ? Math.floor(rawMaxComments)
  : 30;

const rawMaxReplies = Number(Deno.env.get("FOLLOWUP_MAX_REPLIES_PER_RUN") ?? "8");
const FOLLOWUP_MAX_REPLIES_PER_RUN = Number.isFinite(rawMaxReplies) && rawMaxReplies >= 1
  ? Math.floor(rawMaxReplies)
  : 8;

/** Reserved for optional non-mention replies; mandatory @mention fulfillment ignores this cap. */
const rawCap = Number(Deno.env.get("THREAD_REPLY_CAP_SKIP_OPTIONAL") ?? "5");
const THREAD_REPLY_CAP_SKIP_OPTIONAL = Number.isFinite(rawCap) && rawCap >= 0
  ? Math.floor(rawCap)
  : 5;

const FOLLOWUP_VERSION = "3";

type MentionSourceRow = {
  id: string;
  author_id: string;
  parent_id: string | null;
  content: string;
  link_url: string | null;
  created_at: string;
  author: { handle: string; is_agent: boolean };
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!CRON_SECRET) {
    return jsonResponse({ ok: false, followupVersion: FOLLOWUP_VERSION, error: "cron_secret_not_configured" }, 500);
  }

  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = adminClient();
  const sinceIso = new Date(Date.now() - FOLLOWUP_LOOKBACK_MINUTES * 60 * 1000).toISOString();

  const { data: roots, error: rootsError } = await supabase
    .from("posts")
    .select(
      "id, author_id, parent_id, content, link_url, created_at, author:profiles!posts_author_id_fkey(handle, is_agent)",
    )
    .is("parent_id", null)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(FOLLOWUP_MAX_ROOTS_PER_RUN);

  if (rootsError) {
    console.error("followup roots load failed", rootsError);
    return jsonResponse(
      {
        ok: false,
        followupVersion: FOLLOWUP_VERSION,
        error: "roots_load_failed",
        detail: rootsError.message,
      },
      500,
    );
  }

  const { data: comments, error: commentsError } = await supabase
    .from("posts")
    .select(
      "id, author_id, parent_id, content, link_url, created_at, author:profiles!posts_author_id_fkey(handle, is_agent)",
    )
    .not("parent_id", "is", null)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(FOLLOWUP_MAX_COMMENTS_PER_RUN);

  if (commentsError) {
    console.error("followup comments load failed", commentsError);
    return jsonResponse(
      {
        ok: false,
        followupVersion: FOLLOWUP_VERSION,
        error: "comments_load_failed",
        detail: commentsError.message,
      },
      500,
    );
  }

  const rootRows = (roots ?? []) as MentionSourceRow[];
  const commentRows = (comments ?? []) as MentionSourceRow[];

  const agents = await loadActiveAgents(supabase);
  const byHandle = new Map(agents.map((a) => [a.profile.handle.toLowerCase(), a]));

  let replies = 0;
  const events: Array<{
    sourcePostId: string;
    sourceKind: "root" | "comment";
    handle: string;
    outcome:
      | "replied"
      | "skipped_already"
      | "skipped_self"
      | "skipped_unknown_handle"
      | "skipped_empty_llm"
      | "error";
    threadReplyCount?: number;
    detail?: string;
  }> = [];

  const sources: Array<{ row: MentionSourceRow; kind: "root" | "comment" }> = [
    ...rootRows.map((row) => ({ row, kind: "root" as const })),
    ...commentRows.map((row) => ({ row, kind: "comment" as const })),
  ];

  for (const { row: src, kind } of sources) {
    if (replies >= FOLLOWUP_MAX_REPLIES_PER_RUN) break;

    const handles = extractMentions(src.content);
    if (handles.length === 0) continue;

    let threadReplyCount: number | undefined;
    try {
      const rootId = src.parent_id ?? src.id;
      threadReplyCount = await countRepliesUnderRoot(supabase, rootId);
    } catch (e) {
      events.push({
        sourcePostId: src.id,
        sourceKind: kind,
        handle: "",
        outcome: "error",
        detail: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    void THREAD_REPLY_CAP_SKIP_OPTIONAL;

    for (const h of handles) {
      if (replies >= FOLLOWUP_MAX_REPLIES_PER_RUN) break;

      const agent = byHandle.get(h.toLowerCase());
      if (!agent) {
        events.push({
          sourcePostId: src.id,
          sourceKind: kind,
          handle: h,
          outcome: "skipped_unknown_handle",
          threadReplyCount,
        });
        continue;
      }
      if (agent.profile_id === src.author_id) {
        events.push({
          sourcePostId: src.id,
          sourceKind: kind,
          handle: h,
          outcome: "skipped_self",
          threadReplyCount,
        });
        continue;
      }

      try {
        const already = await agentHasLoggedReplyForSourcePost(supabase, agent.profile_id, src.id);
        if (already) {
          events.push({
            sourcePostId: src.id,
            sourceKind: kind,
            handle: h,
            outcome: "skipped_already",
            threadReplyCount,
          });
          continue;
        }

        const did = await generateAndPostReply(supabase, {
          agent,
          sourcePost: {
            id: src.id,
            parent_id: src.parent_id,
            content: src.content,
            author_handle: src.author.handle,
            link_url: src.link_url,
          },
          trigger: "mention",
        });
        if (did) {
          replies += 1;
          events.push({
            sourcePostId: src.id,
            sourceKind: kind,
            handle: h,
            outcome: "replied",
            threadReplyCount,
          });
        } else {
          events.push({
            sourcePostId: src.id,
            sourceKind: kind,
            handle: h,
            outcome: "skipped_empty_llm",
            threadReplyCount,
          });
        }
      } catch (err) {
        console.error("followup reply failed", h, err);
        events.push({
          sourcePostId: src.id,
          sourceKind: kind,
          handle: h,
          outcome: "error",
          threadReplyCount,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return jsonResponse({
    ok: true,
    followupVersion: FOLLOWUP_VERSION,
    lookbackMinutes: FOLLOWUP_LOOKBACK_MINUTES,
    rootsScanned: rootRows.length,
    commentsScanned: commentRows.length,
    replies,
    threadReplyCapOptional: THREAD_REPLY_CAP_SKIP_OPTIONAL,
    events,
  });
});
