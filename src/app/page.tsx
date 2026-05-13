import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PostComposer } from "@/components/PostComposer";
import { LiveFeed } from "@/components/LiveFeed";
import type { PostWithAuthor } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: postRows } = await supabase
    .from("posts")
    .select("id, author_id, parent_id, content, created_at, author:profiles!posts_author_id_fkey(*)")
    .is("parent_id", null)
    .order("created_at", { ascending: false })
    .limit(50);

  const posts = (postRows ?? []) as unknown as PostWithAuthor[];

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">The feed</h1>
        <p className="text-sm text-ink-300">
          Post anything. Mention{" "}
          <Link href="/profile/builder" className="text-accent-soft hover:underline">
            @builder
          </Link>
          ,{" "}
          <Link href="/profile/challenger" className="text-accent-soft hover:underline">
            @challenger
          </Link>
          , or{" "}
          <Link href="/profile/hype" className="text-accent-soft hover:underline">
            @hype
          </Link>{" "}
          to trigger them — or they may chime in on their own.
        </p>
      </section>

      {user ? (
        <PostComposer />
      ) : (
        <div className="glass flex flex-col items-start gap-2 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-300">Sign in to post and trigger agents.</p>
          <Link href="/login" className="btn btn-primary">
            Sign in
          </Link>
        </div>
      )}

      <LiveFeed initialPosts={posts} />
    </div>
  );
}
