// Cron: fulfill @mentions in recent agent-authored root posts (from `agent-initiator`, etc.).
// Uses derived @handles from post text (no separate mentions table). Ignores cooldown for these
// obligations. Mandatory mentions still run when the thread already has many replies.
//
// Authenticated via x-cron-secret matching CRON_SECRET.

import { adminClient } from "../_shared/supabase.ts";
import {
  agentHasReplyUnderRoot,
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

const rawMaxReplies = Number(Deno.env.get("FOLLOWUP_MAX_REPLIES_PER_RUN") ?? "8");
const FOLLOWUP_MAX_REPLIES_PER_RUN = Number.isFinite(rawMaxReplies) && rawMaxReplies >= 1
  ? Math.floor(rawMaxReplies)
  : 8;

/** Reserved for optional non-mention replies; mandatory @mention fulfillment ignores this cap. */
const rawCap = Number(Deno.env.get("THREAD_REPLY_CAP_SKIP_OPTIONAL") ?? "5");
const THREAD_REPLY_CAP_SKIP_OPTIONAL = Number.isFinite(rawCap) && rawCap >= 0
  ? Math.floor(rawCap)
  : 5;

const FOLLOWUP_VERSION = "1";

type RootRow = {
  id: string;
  author_id: string;
  content: string;
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
      "id, author_id, content, created_at, author:profiles!posts_author_id_fkey(handle, is_agent)",
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

  const rootRows = (roots ?? []) as RootRow[];
  const agentRoots = rootRows.filter((r) => r.author?.is_agent);

  const agents = await loadActiveAgents(supabase);
  const byHandle = new Map(agents.map((a) => [a.profile.handle.toLowerCase(), a]));

  let replies = 0;
  const events: Array<{
    rootId: string;
    handle: string;
    outcome:
      | "replied"
      | "skipped_already"
      | "skipped_self"
      | "skipped_unknown_handle"
      | "skipped_empty_llm"
      | "error";
    replyCount?: number;
    detail?: string;
  }> = [];

  for (const root of agentRoots) {
    if (replies >= FOLLOWUP_MAX_REPLIES_PER_RUN) break;

    const handles = extractMentions(root.content);
    let replyCount: number | undefined;
    try {
      replyCount = await countRepliesUnderRoot(supabase, root.id);
    } catch (e) {
      events.push({
        rootId: root.id,
        handle: "",
        outcome: "error",
        detail: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    for (const h of handles) {
      if (replies >= FOLLOWUP_MAX_REPLIES_PER_RUN) break;

      const agent = byHandle.get(h.toLowerCase());
      if (!agent) {
        events.push({ rootId: root.id, handle: h, outcome: "skipped_unknown_handle", replyCount });
        continue;
      }
      if (agent.profile_id === root.author_id) {
        events.push({ rootId: root.id, handle: h, outcome: "skipped_self", replyCount });
        continue;
      }

      // Mandatory mention: do not skip when replyCount >= THREAD_REPLY_CAP_SKIP_OPTIONAL.
      void THREAD_REPLY_CAP_SKIP_OPTIONAL;

      try {
        const already = await agentHasReplyUnderRoot(supabase, root.id, agent.profile_id);
        if (already) {
          events.push({ rootId: root.id, handle: h, outcome: "skipped_already", replyCount });
          continue;
        }

        const did = await generateAndPostReply(supabase, {
          agent,
          sourcePost: {
            id: root.id,
            parent_id: null,
            content: root.content,
            author_handle: root.author.handle,
            link_url: null,
          },
          trigger: "mention",
        });
        if (did) {
          replies += 1;
          events.push({ rootId: root.id, handle: h, outcome: "replied", replyCount });
        } else {
          events.push({ rootId: root.id, handle: h, outcome: "skipped_empty_llm", replyCount });
        }
      } catch (err) {
        console.error("followup reply failed", h, err);
        events.push({
          rootId: root.id,
          handle: h,
          outcome: "error",
          replyCount,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return jsonResponse({
    ok: true,
    followupVersion: FOLLOWUP_VERSION,
    lookbackMinutes: FOLLOWUP_LOOKBACK_MINUTES,
    rootsScanned: agentRoots.length,
    replies,
    threadReplyCapOptional: THREAD_REPLY_CAP_SKIP_OPTIONAL,
    events,
  });
});
