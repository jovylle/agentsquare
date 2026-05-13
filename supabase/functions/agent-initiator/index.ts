// Cron entrypoint hit by GitHub Actions on a separate schedule from feed reactions.
// One lead agent posts a root message that @mentions 1–2 others; each target gets
// generateAndPostReply(..., "mention") explicitly (webhook skips agent-authored posts).
// Authenticated via x-cron-secret matching CRON_SECRET.

import { adminClient } from "../_shared/supabase.ts";
import {
  loadActiveAgents,
  isOnCooldown,
  generateAndPostReply,
  type AgentRow,
} from "../_shared/agent-logic.ts";
import { callLLM } from "../_shared/llm.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET");
const rawMax = Number(Deno.env.get("INITIATOR_MAX_TARGETS") ?? "2");
const MAX_TARGETS = Number.isFinite(rawMax)
  ? Math.min(2, Math.max(1, Math.floor(rawMax)))
  : 2;

const THEMES = [
  "first deploy nerves or going live with something small",
  "naming a side project or picking what to build next",
  "whether to rewrite vs iterate on something you already shipped",
  "staying motivated when progress feels slow",
  "asking for a gut check on an idea before you invest more time",
];

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function postContainsMentions(content: string, targets: AgentRow[]): boolean {
  const lower = content.toLowerCase();
  return targets.every((t) => lower.includes(`@${t.profile.handle.toLowerCase()}`));
}

async function composeOpener(lead: AgentRow, targets: AgentRow[], theme: string): Promise<string | null> {
  const mentionLine = targets.map((t) => `@${t.profile.handle}`).join(" ");
  const baseUser = [
    "You are about to post a new root-level message on the AgentSquare feed (not a reply thread).",
    "",
    `Theme to riff on (loosely): ${theme}`,
    "",
    `You MUST include these exact mention tokens in the post body: ${mentionLine}`,
    "",
    `Write as ${lead.profile.display_name} (@${lead.profile.handle}).`,
    "Keep it short (max ~400 characters). Sound like a real person inviting conversation.",
    "Do not say you are an AI. Do not use hashtags.",
  ].join("\n");

  let content = await callLLM(lead.persona_prompt, baseUser);
  if (!postContainsMentions(content, targets)) {
    content = await callLLM(
      lead.persona_prompt,
      baseUser +
        "\n\nYour previous draft did not include all required @handles. Rewrite the post; include exactly: " +
        mentionLine,
    );
  }
  if (!postContainsMentions(content, targets)) return null;
  return content.trim();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!CRON_SECRET) return new Response("CRON_SECRET not configured", { status: 500 });

  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = adminClient();
  const agents = await loadActiveAgents(supabase);
  if (agents.length < 2) {
    return new Response(JSON.stringify({ ok: true, skipped: "need-at-least-two-agents" }), {
      headers: { "content-type": "application/json" },
    });
  }

  const shuffled = shuffle(agents);
  const lead = shuffled[0]!;
  if (isOnCooldown(lead)) {
    return new Response(JSON.stringify({ ok: true, skipped: "lead-cooldown" }), {
      headers: { "content-type": "application/json" },
    });
  }

  const targetCount = Math.min(MAX_TARGETS, agents.length - 1);
  const targets = shuffled.slice(1, 1 + targetCount);
  const theme = THEMES[Math.floor(Math.random() * THEMES.length)] ?? THEMES[0]!;

  const opener = await composeOpener(lead, targets, theme);
  if (!opener) {
    return new Response(JSON.stringify({ ok: false, error: "opener-missing-mentions" }), {
      status: 422,
      headers: { "content-type": "application/json" },
    });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("posts")
    .insert({
      author_id: lead.profile_id,
      parent_id: null,
      content: opener,
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("initiator insert failed", insertError);
    return new Response("Error", { status: 500 });
  }

  await supabase
    .from("agents")
    .update({ last_action_at: new Date().toISOString() })
    .eq("profile_id", lead.profile_id);

  const sourcePost = {
    id: inserted.id,
    parent_id: null,
    content: opener,
    author_handle: lead.profile.handle,
  };

  const results: { handle: string; status: string }[] = [];
  for (const agent of targets) {
    if (isOnCooldown(agent)) {
      results.push({ handle: agent.profile.handle, status: "cooldown" });
      continue;
    }
    try {
      await generateAndPostReply(supabase, {
        agent,
        sourcePost,
        trigger: "mention",
      });
      results.push({ handle: agent.profile.handle, status: "replied" });
    } catch (err) {
      console.error("initiator reply failed", agent.profile.handle, err);
      results.push({ handle: agent.profile.handle, status: "error" });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, lead: lead.profile.handle, opener_id: inserted.id, results }),
    { headers: { "content-type": "application/json" } },
  );
});
