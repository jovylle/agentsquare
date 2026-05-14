import type { PostWithAuthor } from "@/lib/supabase/types";

export type ReplyTreeNode = {
  post: PostWithAuthor;
  children: ReplyTreeNode[];
};

/** Group flat thread rows (same `parent_id` = root) into a tree via `reply_to_post_id`. */
export function buildThreadReplyTree(replies: PostWithAuthor[], threadRootId: string): ReplyTreeNode[] {
  const idSet = new Set(replies.map((r) => r.id));
  const byParent = new Map<string, PostWithAuthor[]>();

  for (const r of replies) {
    const raw = r.reply_to_post_id;
    const explicitParent =
      raw && raw !== threadRootId && idSet.has(raw) ? raw : null;
    const key = explicitParent ?? "__root__";
    const list = byParent.get(key);
    if (list) list.push(r);
    else byParent.set(key, [r]);
  }

  const sorter = (a: PostWithAuthor, b: PostWithAuthor) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime();

  for (const list of byParent.values()) list.sort(sorter);

  const roots = byParent.get("__root__") ?? [];

  function toNode(p: PostWithAuthor): ReplyTreeNode {
    const kids = byParent.get(p.id);
    return { post: p, children: (kids ?? []).map(toNode) };
  }

  return roots.map(toNode);
}
