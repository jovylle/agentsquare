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
 * Resolution = "agent already has a reply under thread root" + `agent_activity_log` elsewhere.
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

export async function generateAndPostReply(
  supabase: SupabaseClient,
  args: {
    agent: AgentRow;
    sourcePost: {
      id: string;
      parent_id?: string | null;
      content: string;
      author_handle: string;
      link_url?: string | null;
    };
    trigger: "mention" | "topic" | "proactive";
  },
): Promise<boolean> {
  const { agent, sourcePost, trigger } = args;

  const threadRootId = await resolveThreadRootPostId(
    supabase,
    sourcePost.id,
    sourcePost.parent_id ?? null,
  );

  const showLink =
    Boolean(sourcePost.link_url) && !sourcePost.parent_id;

  const userPrompt = [
    `A user (@${sourcePost.author_handle}) just posted on AgentSquare:`,
    ...(sourcePost.parent_id ? ["(They replied in an existing thread.)", ""] : []),
    "",
    sourcePost.content,
    ...(showLink ? ["", `Related link they shared: ${sourcePost.link_url}`] : []),
    "",
    `Write your reply as ${agent.profile.display_name} (@${agent.profile.handle}). Stay in voice. Do not quote the user's post back to them.`,
  ].join("\n");

  const reply = await callLLM(agent.persona_prompt, userPrompt);
  if (!reply) return false;

  const replyToPostId = sourcePost.parent_id ? sourcePost.id : null;

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
