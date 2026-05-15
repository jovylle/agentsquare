#!/usr/bin/env node
/**
 * One-off production backfill: 25 @uft1.com users, 30 roots, 120 comments,
 * plus agent replies + agent_activity_log for mention/topic fulfillment.
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SEED_USER_PASSWORD
 * LLM (recommended): LLM_API_KEY (+ optional LLM_PROVIDER, LLM_BASE_URL, LLM_MODEL)
 *
 * Disable reactive-reply DB webhook before running.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminClient } from "./seed-lib/supabase-admin.mjs";
import { pickAgentsForPost } from "./seed-lib/mentions.mjs";
import { fulfillAgentReply } from "./seed-lib/fulfill.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_BIO = "uft1.com seed member";
const DOMAIN = process.env.SEED_EMAIL_DOMAIN ?? "uft1.com";
const ROOT_COUNT = 30;
const COMMENT_COUNT = 120;
const MAX_AGENTS_PER_POST = 2;
const TOPIC_ROOT_RATE = 0.3;
const DAYS_SPAN = 60;

function loadEnvLocal() {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function parseArgs() {
  return {
    dryRun: process.argv.includes("--dry-run"),
    templatesOnly: process.argv.includes("--templates-only"),
    force: process.argv.includes("--force"),
    resetSeed: process.argv.includes("--reset-seed"),
  };
}

function isUsableLlmKey(key) {
  if (!key || key.length < 20) return false;
  const lower = key.toLowerCase();
  return !lower.includes("your-llm") && lower !== "your-llm-api-key";
}

async function resetSeedPosts(supabase) {
  const { data: seedProfiles, error: profErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("bio", SEED_BIO);
  if (profErr) throw profErr;
  const seedIds = (seedProfiles ?? []).map((p) => p.id);
  if (seedIds.length === 0) {
    console.log("No seed profiles to reset.");
    return;
  }

  const { data: roots, error: rootErr } = await supabase
    .from("posts")
    .select("id")
    .in("author_id", seedIds)
    .is("parent_id", null);
  if (rootErr) throw rootErr;
  const rootIds = (roots ?? []).map((r) => r.id);
  if (rootIds.length === 0) {
    console.log("No seed root posts to reset.");
    return;
  }

  const { data: inThread, error: threadErr } = await supabase
    .from("posts")
    .select("id")
    .in("parent_id", rootIds);
  if (threadErr) throw threadErr;
  const postIds = [...new Set([...rootIds, ...(inThread ?? []).map((p) => p.id)])];

  if (postIds.length > 0) {
    await supabase.from("agent_activity_log").delete().in("source_post_id", postIds);
    await supabase.from("agent_activity_log").delete().in("post_id", postIds);
    await supabase.from("post_reactions").delete().in("post_id", postIds);
  }

  const { error: delErr } = await supabase.from("posts").delete().in("id", rootIds);
  if (delErr) throw delErr;

  console.log(`Reset: removed ${rootIds.length} seed thread(s) and related posts/activity.`);
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function addMinutes(d, mins) {
  return new Date(d.getTime() + mins * 60 * 1000);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function mapPool(items, fn, concurrency = 2) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

async function main() {
  loadEnvLocal();
  const { dryRun, templatesOnly, force, resetSeed } = parseArgs();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const seedPassword = process.env.SEED_USER_PASSWORD;

  if (!url || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (!templatesOnly && !dryRun && !isUsableLlmKey(process.env.LLM_API_KEY)) {
    console.error("Missing or placeholder LLM_API_KEY in .env.local — use --templates-only to skip LLM");
    process.exit(1);
  }

  const supabase = createAdminClient(url, serviceKey);

  const roster = JSON.parse(readFileSync(join(__dirname, "seed-data/roster.json"), "utf8"));
  const pools = JSON.parse(readFileSync(join(__dirname, "seed-data/content-pools.json"), "utf8"));

  if (resetSeed && !dryRun) {
    await resetSeedPosts(supabase);
  }

  const { data: seedProfileRows } = await supabase.from("profiles").select("id").eq("bio", SEED_BIO);
  const seedProfileIds = (seedProfileRows ?? []).map((p) => p.id);

  let existingRootCount = 0;
  if (seedProfileIds.length > 0) {
    const { count } = await supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .in("author_id", seedProfileIds)
      .is("parent_id", null);
    existingRootCount = count ?? 0;
  }

  if (existingRootCount > 0 && !force && !resetSeed) {
    console.error(
      `Seed thread posts already exist (${existingRootCount} roots). Use --reset-seed to replace, or --force to add more.`,
    );
    process.exit(1);
  }

  const rosterEmails = roster.map((p) => `${p.localPart}@${DOMAIN}`.toLowerCase());
  const { data: existingList } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const allExist = rosterEmails.every((email) =>
    existingList?.users?.some((u) => u.email?.toLowerCase() === email),
  );
  if (!seedPassword && !dryRun && !allExist) {
    console.error("Missing SEED_USER_PASSWORD (required when creating new seed users)");
    process.exit(1);
  }

  console.log(
    `Mode: ${dryRun ? "DRY RUN" : "LIVE"} | replies: ${templatesOnly ? "templates" : "LLM"}`,
  );

  const profileByEmail = new Map();
  const existingByEmail = new Map(
    (existingList?.users ?? [])
      .filter((u) => u.email)
      .map((u) => [u.email.toLowerCase(), u]),
  );

  for (const person of roster) {
    const email = `${person.localPart}@${DOMAIN}`;
    const existing = existingByEmail.get(email.toLowerCase());

    if (existing) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("id, handle")
        .eq("user_id", existing.id)
        .maybeSingle();
      if (prof) {
        profileByEmail.set(email, prof);
        if (!dryRun) {
          await supabase
            .from("profiles")
            .update({ display_name: person.displayName, bio: SEED_BIO })
            .eq("id", prof.id);
        }
        console.log(`User exists: ${email} (@${prof.handle})`);
        continue;
      }
    }

    if (dryRun) {
      console.log(`Would create user: ${email}`);
      profileByEmail.set(email, { id: `dry-${person.localPart}`, handle: person.localPart.replace(/\./g, "_") });
      continue;
    }

    const { data: created, error } = await supabase.auth.admin.createUser({
      email,
      password: seedPassword,
      email_confirm: true,
      user_metadata: { display_name: person.displayName },
    });
    if (error) {
      console.error(`createUser failed ${email}:`, error.message);
      process.exit(1);
    }

    const { data: prof } = await supabase
      .from("profiles")
      .select("id, handle")
      .eq("user_id", created.user.id)
      .maybeSingle();
    if (!prof) {
      console.error(`Profile missing after create: ${email}`);
      process.exit(1);
    }
    await supabase
      .from("profiles")
      .update({ display_name: person.displayName, bio: SEED_BIO })
      .eq("id", prof.id);
    profileByEmail.set(email, prof);
    console.log(`Created ${email} (@${prof.handle})`);
    await new Promise((r) => setTimeout(r, 200));
  }

  const humanProfiles = [...profileByEmail.values()];
  if (humanProfiles.length === 0) {
    console.error("No human profiles available");
    process.exit(1);
  }

  const { data: agentRows, error: agentErr } = await supabase
    .from("agents")
    .select(
      "profile_id, persona_prompt, interests, reply_style, is_active, cooldown_seconds, last_action_at, profile:profiles!agents_profile_id_fkey(id, handle, display_name)",
    )
    .eq("is_active", true);
  if (agentErr) throw agentErr;
  const agents = (agentRows ?? []).map((row) => ({
    profile_id: row.profile_id,
    persona_prompt: row.persona_prompt,
    interests: row.interests ?? [],
    reply_style: row.reply_style,
    profile: row.profile,
  }));

  const now = Date.now();
  const roots = shuffle(pools.roots).slice(0, ROOT_COUNT);
  const commentPool = shuffle([...pools.comments, ...pools.comments, ...pools.comments, ...pools.comments]);

  const threads = [];
  for (let i = 0; i < ROOT_COUNT; i++) {
    const author = humanProfiles[i % humanProfiles.length];
    const daysAgo = randomBetween(1, DAYS_SPAN);
    const rootAt = new Date(now - daysAgo * 24 * 60 * 60 * 1000);
    const commentsPerRoot =
      Math.floor(COMMENT_COUNT / ROOT_COUNT) + (i < COMMENT_COUNT % ROOT_COUNT ? 1 : 0);
    threads.push({
      rootTemplate: roots[i],
      author,
      rootAt,
      comments: Array.from({ length: commentsPerRoot }, (_, c) => ({
        template: commentPool[(i * 5 + c) % commentPool.length],
        offsetMins: 30 + c * randomBetween(45, 180),
      })),
    });
  }

  let humanPosts = 0;
  let agentReplies = 0;
  const fulfilledKeys = new Set();

  async function insertHumanPost({ author, content, parentId, replyToPostId, createdAt }) {
    humanPosts++;
    if (dryRun) {
      return {
        id: `dry-post-${humanPosts}`,
        author_id: author.id,
        parent_id: parentId,
        reply_to_post_id: replyToPostId,
        content,
        author_handle: author.handle,
      };
    }
    const { data, error } = await supabase
      .from("posts")
      .insert({
        author_id: author.id,
        parent_id: parentId,
        reply_to_post_id: replyToPostId,
        content,
        created_at: createdAt.toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    return {
      id: data.id,
      author_id: author.id,
      parent_id: parentId,
      reply_to_post_id: replyToPostId,
      content,
      author_handle: author.handle,
    };
  }

  async function fulfillForPost(sourcePost, baseTime) {
    const selections = pickAgentsForPost(sourcePost.content, agents, {
      maxReplies: MAX_AGENTS_PER_POST,
      minTopicScore: 1,
    });

    for (let s = 0; s < selections.length; s++) {
      const { agent, trigger } = selections[s];
      const key = `${agent.profile_id}:${sourcePost.id}`;
      if (fulfilledKeys.has(key)) continue;
      fulfilledKeys.add(key);

      const replyAt = addMinutes(baseTime, 2 + s * randomBetween(3, 12));
      if (dryRun) {
        console.log(`  [dry] ${trigger} @${agent.profile.handle} -> ${sourcePost.id.slice(0, 8)}…`);
        agentReplies++;
        continue;
      }

      await fulfillAgentReply(supabase, {
        agent,
        sourcePost,
        trigger,
        createdAt: replyAt,
        templatesOnly,
        templateReplies: pools.templateReplies,
      });
      agentReplies++;
      console.log(`  ${trigger} @${agent.profile.handle} replied`);
    }
  }

  for (const thread of threads) {
    const rootContent = thread.rootTemplate.content;
    console.log(`\nThread @${thread.author.handle}: ${rootContent.slice(0, 50)}…`);

    const rootPost = await insertHumanPost({
      author: thread.author,
      content: rootContent,
      parentId: null,
      replyToPostId: null,
      createdAt: thread.rootAt,
    });

    await fulfillForPost(rootPost, thread.rootAt);

    if (
      !thread.rootTemplate.mentions &&
      Math.random() < TOPIC_ROOT_RATE
    ) {
      const topicPicks = pickAgentsForPost(rootContent, agents, {
        maxReplies: 1,
        minTopicScore: 1,
      }).filter((p) => p.trigger === "topic");
      for (const { agent } of topicPicks) {
        const key = `${agent.profile_id}:${rootPost.id}`;
        if (fulfilledKeys.has(key)) continue;
        fulfilledKeys.add(key);
        const replyAt = addMinutes(thread.rootAt, randomBetween(20, 90));
        if (!dryRun) {
          await fulfillAgentReply(supabase, {
            agent,
            sourcePost: rootPost,
            trigger: "topic",
            createdAt: replyAt,
            templatesOnly,
            templateReplies: pools.templateReplies,
          });
        }
        agentReplies++;
        console.log(`  topic @${agent.profile.handle}`);
      }
    }

    let lastTime = thread.rootAt;
    for (const c of thread.comments) {
      const author = humanProfiles[Math.floor(Math.random() * humanProfiles.length)];
      const createdAt = addMinutes(thread.rootAt, c.offsetMins);
      lastTime = createdAt;
      const replyTarget = Math.random() < 0.35 ? rootPost.id : rootPost.id;

      const commentPost = await insertHumanPost({
        author,
        content: c.template.content,
        parentId: rootPost.id,
        replyToPostId: replyTarget,
        createdAt,
      });
      await fulfillForPost(commentPost, createdAt);
    }
  }

  if (!dryRun && humanProfiles.length > 1) {
    console.log("\nFollows + reactions…");
    for (const f of humanProfiles) {
      const others = shuffle(humanProfiles.filter((p) => p.id !== f.id)).slice(0, 6);
      const agentSample = shuffle(agents).slice(0, 3);
      for (const t of [...others, ...agentSample.map((a) => ({ id: a.profile.id }))]) {
        await supabase.from("follows").upsert(
          { follower_id: f.id, following_id: t.id },
          { onConflict: "follower_id,following_id", ignoreDuplicates: true },
        );
      }
    }

    const { data: rootPosts } = await supabase
      .from("posts")
      .select("id")
      .in(
        "author_id",
        humanProfiles.map((p) => p.id),
      )
      .is("parent_id", null)
      .limit(ROOT_COUNT);

    for (const p of rootPosts ?? []) {
      const likers = shuffle(humanProfiles).slice(0, 3 + Math.floor(Math.random() * 3));
      for (const liker of likers) {
        await supabase.from("post_reactions").upsert(
          { post_id: p.id, profile_id: liker.id },
          { onConflict: "post_id,profile_id", ignoreDuplicates: true },
        );
      }
    }
  }

  console.log(`\nDone. Human posts: ${humanPosts}, agent replies: ${agentReplies}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
