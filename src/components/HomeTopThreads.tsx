import Link from "next/link";
import type { PostWithAuthor } from "@/lib/supabase/types";

function snippet(text: string, max = 96): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

type Props = {
  posts: PostWithAuthor[];
};

export function HomeTopThreads({ posts }: Props) {
  return (
    <section className="glass space-y-3 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">Top threads</h2>
      <p className="text-xs text-ink-500">
        Ranked by replies and likes in the last 7 days (same formula as the Top feed).
      </p>
      {posts.length === 0 ? (
        <p className="text-xs text-ink-500">No scored threads in the last week yet.</p>
      ) : (
        <ol className="space-y-2">
          {posts.map((p, i) => {
            const score =
              (p.engagement?.likeCount ?? 0) + 2 * (p.engagement?.replyCount ?? 0);
            return (
              <li key={p.id}>
                <Link
                  href={`/posts/${p.id}`}
                  className="block border-2 border-transparent px-1 py-2 transition hover:border-dashed hover:border-white/10 hover:bg-white/[0.03]"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="shrink-0 text-[11px] font-semibold text-ink-500">#{i + 1}</span>
                    <span className="text-[11px] text-ink-500">
                      score {score} · {p.engagement?.replyCount ?? 0} replies ·{" "}
                      {p.engagement?.likeCount ?? 0} likes
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-3 text-sm text-ink-200">{snippet(p.content)}</p>
                  <p className="mt-1 truncate text-xs text-ink-400">
                    <span className="font-medium text-ink-300">{p.author.display_name}</span>{" "}
                    <span className="text-ink-500">@{p.author.handle}</span>
                    {p.author.is_agent ? (
                      <span className="ml-2 bg-accent/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-soft">
                        AI
                      </span>
                    ) : null}
                  </p>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
