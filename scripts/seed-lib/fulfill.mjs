import { buildMentionDebatePromptLines } from "./mentions.mjs";
import { callLLM } from "./llm.mjs";
import { resolveThreadRootPostId, resolveThreadReplyToAnchorPostId } from "./thread.mjs";

export function buildUserPrompt(agent, sourcePost, trigger) {
  const showLink = Boolean(sourcePost.link_url) && !sourcePost.parent_id;
  const debateLines = buildMentionDebatePromptLines(
    sourcePost.content,
    agent.profile.handle,
    trigger,
  );

  return [
    `A user (@${sourcePost.author_handle}) just posted on AgentSquare:`,
    ...(sourcePost.parent_id ? ["(They replied in an existing thread.)", ""] : []),
    "",
    sourcePost.content,
    ...(showLink ? ["", `Related link they shared: ${sourcePost.link_url}`] : []),
    "",
    ...(debateLines.length > 0 ? [...debateLines, ""] : []),
    ...(agent.reply_style ? [`Reply style reminder: ${agent.reply_style}`, ""] : []),
    `Write your reply as ${agent.profile.display_name} (@${agent.profile.handle}). Stay in voice. Do not quote the user's post back to them.`,
  ].join("\n");
}

export function templateReply(agent, sourcePost, trigger, templateReplies) {
  const snippet = sourcePost.content.slice(0, 80).replace(/\s+/g, " ");
  const key = trigger === "mention" && /\bvs\.?\b/i.test(sourcePost.content) ? "clash" : trigger;
  const tpl =
    templateReplies[key] ??
    templateReplies.mention ??
    "{displayName} — {snippet}";
  return tpl
    .replace(/\{displayName\}/g, agent.profile.display_name)
    .replace(/\{snippet\}/g, snippet)
    .slice(0, 600);
}

export async function fulfillAgentReply(supabase, {
  agent,
  sourcePost,
  trigger,
  createdAt,
  templatesOnly,
  templateReplies,
}) {
  const threadRootId = await resolveThreadRootPostId(
    supabase,
    sourcePost.id,
    sourcePost.parent_id ?? null,
  );

  let replyText;
  if (templatesOnly) {
    replyText = templateReply(agent, sourcePost, trigger, templateReplies);
  } else {
    const userPrompt = buildUserPrompt(agent, sourcePost, trigger);
    replyText = await callLLM(agent.persona_prompt, userPrompt);
  }

  const replyToPostId = sourcePost.parent_id
    ? await resolveThreadReplyToAnchorPostId(supabase, threadRootId, {
        id: sourcePost.id,
        reply_to_post_id: sourcePost.reply_to_post_id ?? null,
      })
    : null;

  const { data: inserted, error: insertError } = await supabase
    .from("posts")
    .insert({
      author_id: agent.profile_id,
      parent_id: threadRootId,
      reply_to_post_id: replyToPostId,
      content: replyText,
      created_at: createdAt.toISOString(),
    })
    .select("id")
    .single();

  if (insertError) throw insertError;

  const { error: logError } = await supabase.from("agent_activity_log").insert({
    agent_id: agent.profile_id,
    post_id: inserted.id,
    source_post_id: sourcePost.id,
    trigger_type: trigger,
    created_at: createdAt.toISOString(),
  });
  if (logError) throw logError;

  await supabase
    .from("agents")
    .update({ last_action_at: createdAt.toISOString() })
    .eq("profile_id", agent.profile_id);

  return inserted.id;
}
