import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PostCard } from "@/components/PostCard";
import { ThreadRepliesShell } from "@/components/ThreadRepliesShell";
import { mergeOnePostEngagement, type RpcEngagementRow } from "@/lib/postEngagement";
import type { PostWithAuthor, ReplyToPostPreview } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type Props = { params: { id: string } };

const postSelect = "id, author_id, parent_id, reply_to_post_id, content, created_at, author:profiles!posts_author_id_fkey(*)";

/** Avoid nested `posts→posts→profiles` embeds: PostgREST often errors (PGRST…) and returns no rows silently. */
const replySelectBase =
  "id, author_id, parent_id, reply_to_post_id, content, created_at, author:profiles!posts_author_id_fkey(*)";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseRpcUuid(data: unknown): string | null {
  if (typeof data === "string" && UUID_RE.test(data)) return data;
  return null;
}

async function attachReplyToPreviews(
  supabase: ReturnType<typeof createClient>,
  replies: PostWithAuthor[],
): Promise<PostWithAuthor[]> {
  const ids = [
    ...new Set(replies.map((r) => r.reply_to_post_id).filter((x): x is string => Boolean(x))),
  ];
  if (ids.length === 0) return replies;

  const { data: rows, error } = await supabase
    .from("posts")
    .select("id, content, author:profiles!posts_author_id_fkey(handle, display_name)")
    .in("id", ids);
  if (error || !rows?.length) return replies;

  type PreviewRow = { id: string; content: string; author: { handle: string; display_name: string } | { handle: string; display_name: string }[] };
  const typed = rows as unknown as PreviewRow[];
  const map = new Map<string, ReplyToPostPreview>();
  for (const r of typed) {
    const author = Array.isArray(r.author) ? r.author[0] : r.author;
    if (!author) continue;
    map.set(r.id, { id: r.id, content: r.content, author });
  }

  return replies.map((r) => {
    const tid = r.reply_to_post_id;
    if (!tid) return r;
    const preview = map.get(tid);
    return preview ? { ...r, reply_to_post: preview } : r;
  });
}

export default async function PostPage({ params }: Props) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let viewerProfileId: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    viewerProfileId = profile?.id ?? null;
  }

  const { data: postRow } = await supabase.from("posts").select(postSelect).eq("id", params.id).maybeSingle();

  if (!postRow) notFound();

  const post = postRow as unknown as PostWithAuthor;

  // Prefer DB thread root (walks parent_id) so a bad parent_id on a row cannot
  // point the reply list at the wrong parent_id filter.
  const { data: rootRpc, error: rootRpcError } = await supabase.rpc("post_thread_root", { p_id: post.id });
  const parsedRoot = parseRpcUuid(rootRpc);
  const threadRootId =
    !rootRpcError && parsedRoot ? parsedRoot : (post.parent_id ?? post.id);

  // Engagement counts direct children (parent_id = that post). Flat-thread
  // replies use parent_id = thread root, but legacy / edge rows can still hang
  // off the focal post — load both so the list matches the "N replies" line.
  const byId = new Map<string, PostWithAuthor>();
  const { data: siblingRows, error: siblingErr } = await supabase
    .from("posts")
    .select(replySelectBase)
    .eq("parent_id", threadRootId)
    .neq("id", post.id)
    .order("created_at", { ascending: true });
  if (siblingErr) {
    console.error("[posts/[id]] load sibling replies", siblingErr.message, siblingErr);
  }
  for (const row of (siblingRows ?? []) as unknown as PostWithAuthor[]) {
    byId.set(row.id, row);
  }
  if (post.id !== threadRootId) {
    const { data: underFocalRows, error: underErr } = await supabase
      .from("posts")
      .select(replySelectBase)
      .eq("parent_id", post.id)
      .order("created_at", { ascending: true });
    if (underErr) {
      console.error("[posts/[id]] load nested replies", underErr.message, underErr);
    }
    for (const row of (underFocalRows ?? []) as unknown as PostWithAuthor[]) {
      byId.set(row.id, row);
    }
  }
  let replies = Array.from(byId.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  replies = await attachReplyToPreviews(supabase, replies);

  const allIds = [post.id, ...replies.map((r) => r.id)];
  const engMap = new Map<string, RpcEngagementRow>();
  if (allIds.length > 0) {
    const { data: engRows } = await supabase.rpc("post_engagement_for_posts", {
      p_post_ids: allIds,
      p_viewer_profile_id: viewerProfileId,
    });
    for (const row of (engRows ?? []) as RpcEngagementRow[]) {
      engMap.set(row.post_id, row);
    }
  }

  const postWithEng = mergeOnePostEngagement(post, engMap);
  const repliesWithEng = replies.map((r) => mergeOnePostEngagement(r, engMap));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/" className="text-sm text-ink-400 hover:text-ink-200">
        ← Back to feed
      </Link>

      <PostCard post={postWithEng} showReplyLink={false} viewerProfileId={viewerProfileId} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">Replies</h2>
        {!user ? (
          <p className="glass p-4 text-sm text-ink-300">
            <Link href="/login" className="text-accent-soft underline">
              Sign in
            </Link>{" "}
            to reply.
          </p>
        ) : null}
        <ThreadRepliesShell
          rootId={threadRootId}
          initialReplies={repliesWithEng}
          canPost={Boolean(user)}
          viewerProfileId={viewerProfileId}
        />
      </section>
    </div>
  );
}
