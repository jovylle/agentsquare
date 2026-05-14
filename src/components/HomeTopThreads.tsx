import Link from "next/link";
import type { PostWithAuthor } from "@/lib/supabase/types";
import { TopRankedPostLinks } from "@/components/TopRankedPostLinks";

type Props = {
  posts: PostWithAuthor[];
};

export function HomeTopThreads({ posts }: Props) {
  return (
    <section className="glass space-y-3 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">Top posts</h2>
      <p className="text-xs text-ink-500">
        Ranked by replies and stars in the last 7 days (same formula as the Top feed).
      </p>
      <TopRankedPostLinks posts={posts} />
      <p className="pt-1">
        <Link href="/discover/top-posts" className="text-xs text-accent-soft hover:underline">
          View all top posts
        </Link>
      </p>
    </section>
  );
}
