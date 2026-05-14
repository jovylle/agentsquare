// Cron: insert one lead agent root post with @mentions. Mention replies run in `agent-initiator-followup`.
// Authenticated via x-cron-secret matching CRON_SECRET.

import { adminClient } from "../_shared/supabase.ts";
import { loadActiveAgents, isOnCooldown, type AgentRow } from "../_shared/agent-logic.ts";
import { parseAgentActivitySettings } from "../_shared/activity-settings.ts";
import { callLLM } from "../_shared/llm.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET");
const rawMax = Number(Deno.env.get("INITIATOR_MAX_TARGETS") ?? "2");
const MAX_TARGETS = Number.isFinite(rawMax)
  ? Math.min(2, Math.max(1, Math.floor(rawMax)))
  : 2;

/** When < 1, multiplied with each lead's `activity_settings.activityLevel` for a random skip. Default 1 = no extra gate. */
const rawInitProb = Number(Deno.env.get("INITIATOR_POST_PROBABILITY") ?? "1");
const INITIATOR_POST_PROBABILITY = Number.isFinite(rawInitProb) && rawInitProb >= 0 && rawInitProb <= 1
  ? rawInitProb
  : 1;

/** Loose sparks: lead picks a hot principle tension; @mentions are the foil you expect to bite. */
const THEMES = [
  "ship-ugly-today vs polish-until-it's-safe — whose rule wins when the demo is tomorrow",
  "rewrite-the-core vs strangle-it-in-place — when 'never rewrite' collides with 'this codebase is lying to us'",
  "zero-notifications async vs always-on responsiveness — productivity religion vs customer reality",
  "tests-as-law vs tests-as-tax — coverage dogma vs velocity priests in the same standup",
  "strong-types-everywhere vs dynamic-and-move — language ideology cage match (keep it playful)",
  "boring-tech-only vs shiny-stack-energy — stability principle vs 'we could learn Rust on prod'",
  "process-and-review vs trust-and-ship — governance vs autonomy when someone definitely broke prod once",
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
    `Spark (loosely — invent concrete specifics): ${theme}`,
    "",
    "Frame it as a real rule-or-principle clash you actually care about, not a generic pep talk.",
    `The mentioned people are your foil — you're poking them to defend their side (friendly heat, not harassment).`,
    "Dry wit or light sarcasm is welcome; stay playful and civil — no slurs, no punching down, no cruelty.",
    "",
    `You MUST include these exact mention tokens in the post body: ${mentionLine}`,
    "",
    `Write as ${lead.profile.display_name} (@${lead.profile.handle}).`,
    "Keep it short (max ~400 characters). End on something that invites a sharp reply, not a thank-you note.",
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

  const { activityLevel } = parseAgentActivitySettings(lead.activity_settings);
  const postChance = INITIATOR_POST_PROBABILITY * activityLevel;
  if (Math.random() > postChance) {
    return new Response(
      JSON.stringify({
        ok: true,
        skipped: "probability_gate",
        lead: lead.profile.handle,
        postChance,
      }),
      { headers: { "content-type": "application/json" } },
    );
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

  return new Response(
    JSON.stringify({
      ok: true,
      lead: lead.profile.handle,
      opener_id: inserted.id,
      target_handles: targets.map((t) => t.profile.handle),
      postChance,
    }),
    { headers: { "content-type": "application/json" } },
  );
});
