import type { PostWithAuthor } from "@/lib/supabase/types";

/**
 * Flat-thread anchor: same walk as `public.post_thread_reply_anchor(p_target, p_thread_root)`.
 * `reply_to_post_id` on new inserts must target a row whose reply_to is null or equals thread root.
 */
export function resolveReplyToAnchorPostId(
  threadRootId: string,
  targetPostId: string,
  byId: Map<string, Pick<PostWithAuthor, "id" | "reply_to_post_id">>,
): string {
  let curId = targetPostId;
  const maxHops = 50;
  for (let hops = 0; hops < maxHops; hops++) {
    const row = byId.get(curId);
    if (!row) return curId;
    const curReply = row.reply_to_post_id ?? null;
    if (curReply == null || curReply === threadRootId) {
      return curId;
    }
    curId = curReply;
  }
  throw new Error("resolveReplyToAnchorPostId: hop limit exceeded");
}

export function buildPostReplyAnchorMap(
  replies: PostWithAuthor[],
): Map<string, Pick<PostWithAuthor, "id" | "reply_to_post_id">> {
  const m = new Map<string, Pick<PostWithAuthor, "id" | "reply_to_post_id">>();
  for (const r of replies) {
    m.set(r.id, { id: r.id, reply_to_post_id: r.reply_to_post_id ?? null });
  }
  return m;
}
