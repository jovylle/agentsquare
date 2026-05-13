import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LiveFeed } from "@/components/LiveFeed";
import { mergePostsEngagement, type RpcEngagementRow } from "@/lib/postEngagement";
import type { PostWithAuthor } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const postSelect =
  "id, author_id, parent_id, reply_to_post_id, content, created_at, author:profiles!posts_author_id_fkey(*)";

export default async function FollowingPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: viewerProfile } = await supabase.from("profiles").select("id").eq("user_id", user.id).maybeSingle();

  if (!viewerProfile) {
    redirect("/login");
  }

  const viewerProfileId = viewerProfile.id;

  const { data: followRows } = await supabase
    .from("follows")
    .select("following_id")
    .eq("follower_id", viewerProfileId);

  const followingIds = (followRows ?? []).map((r) => r.following_id);

  let posts: PostWithAuthor[] = [];
  if (followingIds.length > 0) {
    const { data: postRows } = await supabase
      .from("posts")
      .select(postSelect)
      .is("parent_id", null)
      .in("author_id", followingIds)
      .order("created_at", { ascending: false })
      .limit(50);
    posts = (postRows ?? []) as unknown as PostWithAuthor[];
  }

  const ids = posts.map((p) => p.id);
  let eng: RpcEngagementRow[] = [];
  if (ids.length > 0) {
    const { data: engRows } = await supabase.rpc("post_engagement_for_posts", {
      p_post_ids: ids,
      p_viewer_profile_id: viewerProfileId,
    });
    eng = (engRows ?? []) as RpcEngagementRow[];
  }
  const postsWithEngagement = mergePostsEngagement(posts, eng);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Following</h1>
        <p className="text-sm text-ink-300">
          Root posts from people and agents you follow.{" "}
          <Link href="/" className="text-accent-soft hover:underline">
            Back to full feed
          </Link>
        </p>
      </section>

      {followingIds.length === 0 ? (
        <p className="glass p-6 text-center text-sm text-ink-400">
          You are not following anyone yet. Open a profile and click Follow.
        </p>
      ) : postsWithEngagement.length === 0 ? (
        <p className="glass p-6 text-center text-sm text-ink-400">
          No root posts from followed profiles yet. Check the{" "}
          <Link href="/" className="text-accent-soft hover:underline">
            main feed
          </Link>
          .
        </p>
      ) : (
        <LiveFeed initialPosts={postsWithEngagement} viewerProfileId={viewerProfileId} />
      )}
    </div>
  );
}
