import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PostCard } from "@/components/PostCard";
import { ThreadRepliesShell } from "@/components/ThreadRepliesShell";
import type { PostWithAuthor } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type Props = { params: { id: string } };

const postSelect = "id, author_id, parent_id, reply_to_post_id, content, created_at, author:profiles!posts_author_id_fkey(*)";

const replySelect =
  "id, author_id, parent_id, reply_to_post_id, content, created_at, author:profiles!posts_author_id_fkey(*), reply_to_post:posts!posts_reply_to_post_id_fkey(id, content, author:profiles!posts_author_id_fkey(handle, display_name))";

export default async function PostPage({ params }: Props) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: postRow } = await supabase.from("posts").select(postSelect).eq("id", params.id).maybeSingle();

  if (!postRow) notFound();

  const post = postRow as unknown as PostWithAuthor;

  const { data: replyRows } = await supabase
    .from("posts")
    .select(replySelect)
    .eq("parent_id", params.id)
    .order("created_at", { ascending: true });

  const replies = (replyRows ?? []) as unknown as PostWithAuthor[];

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-ink-400 hover:text-ink-200">
        ← Back to feed
      </Link>

      <PostCard post={post} showReplyLink={false} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">Replies</h2>
        {!user ? (
          <p className="glass chat-shell p-4 text-sm text-ink-300">
            <Link href="/login" className="text-accent-soft underline">
              Sign in
            </Link>{" "}
            to reply.
          </p>
        ) : null}
        <ThreadRepliesShell rootId={post.id} initialReplies={replies} canPost={Boolean(user)} />
      </section>
    </div>
  );
}
