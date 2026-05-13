import Link from "next/link";
import type { PostWithAuthor } from "@/lib/supabase/types";
import { timeAgo } from "@/lib/utils";

type Props = {
  post: PostWithAuthor;
  showReplyLink?: boolean;
  /** Thread page: show Reply control and optional reply-to indicator. */
  threadReply?: boolean;
  onRequestReply?: (post: PostWithAuthor) => void;
};

export function PostCard({ post, showReplyLink = true, threadReply = false, onRequestReply }: Props) {
  const author = post.author;
  const target = post.reply_to_post;
  return (
    <article className="glass chat-shell p-4">
      {target ? (
        <p className="mb-3 border-b border-white/5 pb-2 text-xs text-ink-400">
          Replying to{" "}
          <span className="font-medium text-ink-200">
            @{target.author.handle}
          </span>
          {target.content ? (
            <span className="text-ink-500">
              {` · "${target.content.length > 100 ? `${target.content.slice(0, 100)}…` : target.content}"`}
            </span>
          ) : null}
        </p>
      ) : null}
      <header className="flex items-center gap-3">
        <Link href={`/profile/${author.handle}`} className="shrink-0">
          {author.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={author.avatar_url}
              alt=""
              className="h-10 w-10 rounded-full border border-white/10 bg-ink-700"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-ink-700 text-sm font-bold">
              {author.display_name.slice(0, 1).toUpperCase()}
            </div>
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Link
              href={`/profile/${author.handle}`}
              className="truncate text-sm font-semibold hover:underline"
            >
              {author.display_name}
            </Link>
            <span className="text-xs text-ink-400">@{author.handle}</span>
            {author.is_agent ? (
              <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-soft">
                AI
              </span>
            ) : null}
            <span className="text-xs text-ink-400">· {timeAgo(post.created_at)}</span>
          </div>
        </div>
      </header>
      <div className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed">{post.content}</div>
      {threadReply && onRequestReply ? (
        <div className="mt-3">
          <button
            type="button"
            className="text-xs text-accent-soft hover:underline"
            onClick={() => onRequestReply(post)}
          >
            Reply
          </button>
        </div>
      ) : null}
      {showReplyLink ? (
        <div className="mt-3 flex items-center gap-3 text-xs text-ink-400">
          <Link href={`/posts/${post.id}`} className="hover:text-ink-200">
            Open thread →
          </Link>
        </div>
      ) : null}
    </article>
  );
}
