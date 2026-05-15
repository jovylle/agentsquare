const MENTION_RE = /@([a-z0-9_]{2,32})/gi;

const CLASH_CUE_RE =
  /\bvs\.?\b|(?:^|\s)(?:clash|defend|foil|cage match|rule wins|ideology|hear the defenses)\b/i;

export function extractMentions(text) {
  const out = new Set();
  for (const m of text.matchAll(MENTION_RE)) out.add(m[1].toLowerCase());
  return Array.from(out);
}

export function scoreAgent(text, interests) {
  if (!interests?.length) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const interest of interests) {
    if (!interest) continue;
    if (lower.includes(String(interest).toLowerCase())) score += 1;
  }
  return score;
}

export function pickAgentsForPost(text, agents, options = {}) {
  const maxReplies = options.maxReplies ?? 2;
  const minTopicScore = options.minTopicScore ?? 1;

  const mentions = new Set(extractMentions(text));
  const mentioned = [];
  const topical = [];

  for (const agent of agents) {
    if (mentions.has(agent.profile.handle)) {
      mentioned.push({ agent, trigger: "mention" });
      continue;
    }
    const s = scoreAgent(text, agent.interests);
    if (s >= minTopicScore) topical.push({ agent, score: s });
  }

  topical.sort((a, b) => b.score - a.score);

  const out = [];
  const seen = new Set();
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

export function inferDebatePoleForMention(content, handle) {
  const mentionRe = /@([a-z0-9_]{2,32})/gi;
  const mentions = [];
  for (const m of content.matchAll(mentionRe)) {
    mentions.push({
      handle: m[1].toLowerCase(),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  const mineIdx = mentions.findIndex((m) => m.handle === handle.toLowerCase());
  if (mineIdx === -1) return null;

  const mine = mentions[mineIdx];
  const segStart = mine.end;
  const segEnd = mineIdx + 1 < mentions.length ? mentions[mineIdx + 1].start : content.length;
  const segment = content.slice(segStart, segEnd);

  const poleRe = /\b([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\b/gi;
  const polesInSegment = [];
  for (const m of segment.matchAll(poleRe)) {
    const p = m[1];
    if (!polesInSegment.some((x) => x.toLowerCase() === p.toLowerCase())) polesInSegment.push(p);
  }
  if (polesInSegment.length >= 1) return polesInSegment[0];

  const before = content.slice(Math.max(0, mine.start - 72), mine.end);
  const polesBefore = [];
  for (const m of before.matchAll(poleRe)) {
    const p = m[1];
    if (!polesBefore.some((x) => x.toLowerCase() === p.toLowerCase())) polesBefore.push(p);
  }
  if (polesBefore.length === 1) return polesBefore[0];
  return null;
}

export function buildMentionDebatePromptLines(content, handle, trigger) {
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
