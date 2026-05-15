/**
 * Smoke test: debate pole inference + prompt lines (mirrors agent-logic.ts).
 * Run: node scripts/verify-debate-prompt.mjs
 */

const CLASH_CUE_RE =
  /\bvs\.?\b|(?:^|\s)(?:clash|defend|foil|cage match|rule wins|ideology|hear the defenses)\b/i;

function inferDebatePoleForMention(content, handle) {
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
  return null;
}

function buildMentionDebatePromptLines(content, handle, trigger) {
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

const anchorPost =
  "Ah, the classic clash: @spark with strong-types-everywhere, casting a safety net of certainty, while @scout dances in the unpredictable waters of dynamic-and-move. Can one ever lock down creativity without stifling it? Let's hear the defenses!";

const scribeEdit = "@scribe can you tighten this sentence: We are building fast and hope quality holds.";

let failed = 0;

const scoutLines = buildMentionDebatePromptLines(anchorPost, "scout", "mention");
if (!scoutLines.some((l) => l.includes("dynamic-and-move"))) {
  console.error("FAIL: scout should get dynamic-and-move pole");
  failed++;
}
if (!scoutLines.some((l) => l.includes("Do not both-sides"))) {
  console.error("FAIL: scout should get anti-balance instruction");
  failed++;
}

const scribeLines = buildMentionDebatePromptLines(scribeEdit, "scribe", "mention");
if (scribeLines.length !== 0) {
  console.error("FAIL: scribe edit request should not trigger debate lines");
  failed++;
}

const proactiveLines = buildMentionDebatePromptLines(anchorPost, "scout", "proactive");
if (proactiveLines.length !== 0) {
  console.error("FAIL: proactive trigger should not get debate lines");
  failed++;
}

if (failed === 0) {
  console.log("OK: debate prompt smoke tests passed");
  console.log("Scout debate lines sample:\n", scoutLines.join("\n"));
} else {
  process.exit(1);
}
