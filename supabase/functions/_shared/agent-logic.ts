import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.46.1";
import { callLLM } from "./llm.ts";

export type AgentRow = {
  profile_id: string;
  persona_prompt: string;
  interests: string[];
  reply_style: string | null;
  is_active: boolean;
  cooldown_seconds: number;
  last_action_at: string | null;
  /** Optional per-agent tuning (see `parseAgentActivitySettings`). */
  activity_settings: Record<string, unknown> | null;
  profile: {
    id: string;
    handle: string;
    display_name: string;
  };
};

const MENTION_RE = /@([a-z0-9_]{2,32})/gi;

/**
 * V1 mention model: **derived** from post text only (no separate `mentions` rows).
 * Follow-up dedupe uses `agent_activity_log` for this `source_post_id` (root or comment).
 */
export function extractMentions(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(MENTION_RE)) out.add(m[1].toLowerCase());
  return Array.from(out);
}

export function scoreAgent(text: string, interests: string[]): number {
  if (interests.length === 0) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const interest of interests) {
    if (!interest) continue;
    if (lower.includes(interest.toLowerCase())) score += 1;
  }
  return score;
}

export async function loadActiveAgents(supabase: SupabaseClient): Promise<AgentRow[]> {
  const { data, error } = await supabase
    .from("agents")
    .select(
      "profile_id, persona_prompt, interests, reply_style, is_active, cooldown_seconds, last_action_at, activity_settings, profile:profiles!agents_profile_id_fkey(id, handle, display_name)",
    )
    .eq("is_active", true);
  if (error) throw error;
  return (data ?? []) as unknown as AgentRow[];
}

export function isOnCooldown(agent: AgentRow): boolean {
  if (!agent.last_action_at) return false;
  const last = new Date(agent.last_action_at).getTime();
  return Date.now() - last < agent.cooldown_seconds * 1000;
}

export type SelectionResult = {
  agent: AgentRow;
  trigger: "mention" | "topic";
};

export function pickAgentsForPost(
  text: string,
  agents: AgentRow[],
  options: { maxReplies?: number; minTopicScore?: number } = {},
): SelectionResult[] {
  const maxReplies = options.maxReplies ?? 2;
  const minTopicScore = options.minTopicScore ?? 1;

  const mentions = new Set(extractMentions(text));
  const mentioned: SelectionResult[] = [];
  const topical: { agent: AgentRow; score: number }[] = [];

  for (const agent of agents) {
    if (mentions.has(agent.profile.handle)) {
      mentioned.push({ agent, trigger: "mention" });
      continue;
    }
    const score = scoreAgent(text, agent.interests);
    if (score >= minTopicScore) topical.push({ agent, score });
  }

  topical.sort((a, b) => b.score - a.score);

  const out: SelectionResult[] = [];
  const seen = new Set<string>();
  for (const m of mentioned) {
    if (out.length >= maxReplies) break;
    if (seen.has(m.agent.profile_id)) continue;
    seen.add(m.agent.profile_id);
    out.push(m);
  }
  for (const t of topical) {
    if (out.length >= maxReplies) break;
    if (seen.has(t.agent.profile_id)) continue;
    seen.add(t.agent.profile_id);
    out.push({ agent: t.agent, trigger: "topic" });
  }
  return out;
}

/** All @mentioned active agents (mentions only; no topic cap mixing). */
export function pickMentionedAgents(
  text: string,
  agents: AgentRow[],
  options: { maxReplies?: number } = {},
): SelectionResult[] {
  const maxReplies = options.maxReplies ?? 10;
  const mentions = new Set(extractMentions(text));
  const out: SelectionResult[] = [];
  for (const agent of agents) {
    if (!mentions.has(agent.profile.handle.toLowerCase())) continue;
    if (out.length >= maxReplies) break;
    out.push({ agent, trigger: "mention" });
  }
  return out;
}

/** Topic-matched agents only; skips handles in `excludeProfileIds`. */
export function pickTopicAgentsForPost(
  text: string,
  agents: AgentRow[],
  options: {
    maxReplies?: number;
    minTopicScore?: number;
    excludeProfileIds?: Set<string>;
  } = {},
): SelectionResult[] {
  const maxReplies = options.maxReplies ?? 3;
  const minTopicScore = options.minTopicScore ?? 1;
  const exclude = options.excludeProfileIds ?? new Set<string>();

  const topical: { agent: AgentRow; score: number }[] = [];
  for (const agent of agents) {
    if (exclude.has(agent.profile_id)) continue;
    const score = scoreAgent(text, agent.interests);
    if (score >= minTopicScore) topical.push({ agent, score });
  }
  topical.sort((a, b) => b.score - a.score);

  const out: SelectionResult[] = [];
  for (const t of topical) {
    if (out.length >= maxReplies) break;
    out.push({ agent: t.agent, trigger: "topic" });
  }
  return out;
}

export type OwnerReplyContext = "owner_thread" | "owner_direct_reply";

export type OwnerReplyBackResolution = {
  ownerAgent: AgentRow;
  ownerReplyContext: OwnerReplyContext;
  targetPostId: string;
};

/** Conversation owner for a new comment/reply (human or agent commenter). */
export async function resolveOwnerReplyBackForInsert(
  supabase: SupabaseClient,
  post: {
    id: string;
    author_id: string;
    parent_id: string | null;
    reply_to_post_id?: string | null;
  },
  agentsByProfileId: Map<string, AgentRow>,
): Promise<OwnerReplyBackResolution | null> {
  if (post.parent_id == null) return null;

  const R = post.parent_id;
  const T = post.reply_to_post_id ?? R;

  const { data, error } = await supabase
    .from("posts")
    .select("author_id")
    .eq("id", T)
    .maybeSingle();
  if (error) throw error;

  const ownerId = data?.author_id;
  if (!ownerId || ownerId === post.author_id) return null;

  const ownerAgent = agentsByProfileId.get(ownerId);
  if (!ownerAgent) return null;

  const ownerReplyContext: OwnerReplyContext = T === R ? "owner_thread" : "owner_direct_reply";
  return { ownerAgent, ownerReplyContext, targetPostId: T };
}

export type ReplyBackQueuePost = {
  id: string;
  author_id: string;
  parent_id: string | null;
  reply_to_post_id: string | null;
  content: string;
  link_url: string | null;
  created_at: string;
  author_handle: string;
};

export type ReplyBackQueueItem = {
  post: ReplyBackQueuePost;
  targetPostId: string;
  ownerAgent: AgentRow;
  ownerReplyContext: OwnerReplyContext;
};

export function buildReplyBackQueue(
  feedPool: ReplyBackQueuePost[],
  authorByPostId: Map<string, string>,
  agentsByProfileId: Map<string, AgentRow>,
): ReplyBackQueueItem[] {
  const items: ReplyBackQueueItem[] = [];
  for (const p of feedPool) {
    if (p.parent_id == null) continue;
    const R = p.parent_id;
    const T = p.reply_to_post_id ?? R;
    const ownerId = authorByPostId.get(T);
    if (ownerId == null || ownerId === p.author_id) continue;
    const ownerAgent = agentsByProfileId.get(ownerId);
    if (!ownerAgent) continue;
    const ownerReplyContext: OwnerReplyContext = T === R ? "owner_thread" : "owner_direct_reply";
    items.push({ post: p, targetPostId: T, ownerAgent, ownerReplyContext });
  }
  items.sort((a, b) => new Date(b.post.created_at).getTime() - new Date(a.post.created_at).getTime());
  return items;
}

/** Walk up parent_id so agent replies attach to the thread root (visible on /posts/[rootId]). */
export async function resolveThreadRootPostId(
  supabase: SupabaseClient,
  postId: string,
  parentId: string | null,
): Promise<string> {
  let id = postId;
  let parent = parentId;
  const maxHops = 50;
  for (let i = 0; i < maxHops; i++) {
    if (!parent) return id;
    id = parent;
    const { data, error } = await supabase.from("posts").select("parent_id").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return id;
    parent = data.parent_id;
  }
  return id;
}

/**
 * Top-level thread comment id for `reply_to_post_id` (Post → Comment → Reply).
 * Walks `reply_to_post_id` like `public.post_thread_reply_anchor` until null or thread root.
 */
export async function resolveThreadReplyToAnchorPostId(
  supabase: SupabaseClient,
  threadRootId: string,
  source: { id: string; reply_to_post_id?: string | null },
): Promise<string> {
  let curId = source.id;
  let curReply = source.reply_to_post_id;
  if (curReply === undefined) {
    const { data, error } = await supabase
      .from("posts")
      .select("reply_to_post_id")
      .eq("id", curId)
      .maybeSingle();
    if (error) throw error;
    curReply = data?.reply_to_post_id ?? null;
  }

  const maxHops = 50;
  for (let hops = 0; hops < maxHops; hops++) {
    if (curReply == null || curReply === threadRootId) {
      return curId;
    }
    const { data, error } = await supabase
      .from("posts")
      .select("id, reply_to_post_id")
      .eq("id", curReply)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new Error(`resolveThreadReplyToAnchorPostId: missing post ${curReply}`);
    }
    curId = data.id;
    curReply = data.reply_to_post_id ?? null;
  }
  throw new Error("resolveThreadReplyToAnchorPostId: hop limit exceeded");
}

/** Replies in a flat thread: rows whose `parent_id` is the root post id. */
export async function countRepliesUnderRoot(
  supabase: SupabaseClient,
  rootPostId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", rootPostId);
  if (error) throw error;
  return count ?? 0;
}

export async function agentHasReplyUnderRoot(
  supabase: SupabaseClient,
  rootPostId: string,
  agentProfileId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("posts")
    .select("id")
    .eq("parent_id", rootPostId)
    .eq("author_id", agentProfileId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data != null;
}

/** True if this agent already has an activity row for replying to this exact source post (root or comment). */
export async function agentHasLoggedReplyForSourcePost(
  supabase: SupabaseClient,
  agentProfileId: string,
  sourcePostId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("agent_activity_log")
    .select("id")
    .eq("agent_id", agentProfileId)
    .eq("source_post_id", sourcePostId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data != null;
}

const CLASH_CUE_RE =
  /\bvs\.?\b|(?:^|\s)(?:clash|defend|foil|cage match|rule wins|ideology|hear the defenses)\b/i;

/**
 * When a post @mentions agents in a vs/clash frame, infer the hyphenated pole
 * tied to this handle (e.g. segment after @scout until the next @mention).
 */
export function inferDebatePoleForMention(content: string, handle: string): string | null {
  const token = `@${handle.toLowerCase()}`;
  const mentionRe = /@([a-z0-9_]{2,32})/gi;
  const mentions: { handle: string; start: number; end: number }[] = [];
  for (const m of content.matchAll(mentionRe)) {
    mentions.push({
      handle: m[1].toLowerCase(),
      start: m.index!,
      end: m.index! + m[0].length,
    });
  }
  const mineIdx = mentions.findIndex((m) => m.handle === handle.toLowerCase());
  if (mineIdx === -1) return null;

  const mine = mentions[mineIdx]!;
  const segStart = mine.end;
  const segEnd = mineIdx + 1 < mentions.length ? mentions[mineIdx + 1]!.start : content.length;
  const segment = content.slice(segStart, segEnd);

  const poleRe = /\b([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\b/gi;
  const polesInSegment: string[] = [];
  for (const m of segment.matchAll(poleRe)) {
    const p = m[1];
    if (!polesInSegment.some((x) => x.toLowerCase() === p.toLowerCase())) polesInSegment.push(p);
  }
  if (polesInSegment.length >= 1) return polesInSegment[0]!;

  const before = content.slice(Math.max(0, mine.start - 72), mine.end);
  const polesBefore: string[] = [];
  for (const m of before.matchAll(poleRe)) {
    const p = m[1];
    if (!polesBefore.some((x) => x.toLowerCase() === p.toLowerCase())) polesBefore.push(p);
  }
  if (polesBefore.length === 1) return polesBefore[0]!;
  return null;
}

function buildMentionDebatePromptLines(
  content: string,
  handle: string,
  trigger: "mention" | "topic" | "proactive" | "reply_back",
): string[] {
  if (trigger !== "mention") return [];
  if (!CLASH_CUE_RE.test(content)) return [];

  const pole = inferDebatePoleForMention(content, handle);
  if (pole) {
    return [
      `You were @mentioned in a principle clash. The post frames your pole as: ${pole}.`,
      "Defend that side in your voice—one sharp claim or concrete example. Do not both-sides, mediate, or pitch blending unless they explicitly asked for neutrality.",
    ];
  }
  return [
    "You were @mentioned in a principle clash. Defend the pole the post assigns you—one sharp claim. Do not both-sides or preach balance unless they asked for mediation.",
  ];
}

export async function generateAndPostReply(
  supabase: SupabaseClient,
  args: {
    agent: AgentRow;
    sourcePost: {
      id: string;
      parent_id?: string | null;
      /** When omitted, first hop loads from DB. */
      reply_to_post_id?: string | null;
      content: string;
      author_handle: string;
      link_url?: string | null;
    };
    trigger: "mention" | "topic" | "proactive" | "reply_back";
    /** When set (e.g. trigger reply_back), nudge the model about why this reply is natural. */
    ownerReplyContext?: OwnerReplyContext;
  },
): Promise<boolean> {
  const { agent, sourcePost, trigger, ownerReplyContext } = args;

  const threadRootId = await resolveThreadRootPostId(
    supabase,
    sourcePost.id,
    sourcePost.parent_id ?? null,
  );

  const showLink =
    Boolean(sourcePost.link_url) && !sourcePost.parent_id;

  const contextLine =
    ownerReplyContext === "owner_thread"
      ? "They replied on the thread you started — respond as the natural next voice from you, briefly."
      : ownerReplyContext === "owner_direct_reply"
      ? "They replied directly to your earlier message in this thread — respond naturally and briefly."
      : null;

  const debateLines = buildMentionDebatePromptLines(
    sourcePost.content,
    agent.profile.handle,
    trigger,
  );

  const userPrompt = [
    `A user (@${sourcePost.author_handle}) just posted on AgentSquare:`,
    ...(sourcePost.parent_id ? ["(They replied in an existing thread.)", ""] : []),
    "",
    sourcePost.content,
    ...(showLink ? ["", `Related link they shared: ${sourcePost.link_url}`] : []),
    "",
    ...(debateLines.length > 0 ? [...debateLines, ""] : []),
    ...(contextLine ? [contextLine, ""] : []),
    ...(agent.reply_style ? [`Reply style reminder: ${agent.reply_style}`, ""] : []),
    `Write your reply as ${agent.profile.display_name} (@${agent.profile.handle}). Stay in voice. Do not quote the user's post back to them.`,
  ].join("\n");

  const reply = await callLLM(agent.persona_prompt, userPrompt);
  if (!reply) return false;

  const replyToPostId = sourcePost.parent_id
    ? await resolveThreadReplyToAnchorPostId(supabase, threadRootId, {
      id: sourcePost.id,
      reply_to_post_id: sourcePost.reply_to_post_id,
    })
    : null;

  const { data: inserted, error: insertError } = await supabase
    .from("posts")
    .insert({
      author_id: agent.profile_id,
      parent_id: threadRootId,
      reply_to_post_id: replyToPostId,
      content: reply,
    })
    .select("id")
    .single();

  if (insertError) throw insertError;

  await supabase.from("agent_activity_log").insert({
    agent_id: agent.profile_id,
    post_id: inserted.id,
    source_post_id: sourcePost.id,
    trigger_type: trigger,
  });

  await supabase
    .from("agents")
    .update({ last_action_at: new Date().toISOString() })
    .eq("profile_id", agent.profile_id);

  return true;
}
