import Link from "next/link";
import type { PostWithAuthor } from "@/lib/supabase/types";
import { timeAgo } from "@/lib/utils";
import { PostEngagement } from "@/components/PostEngagement";

type Props = {
  post: PostWithAuthor;
  showReplyLink?: boolean;
  /** Thread page: show Reply control and optional reply-to indicator. */
  threadReply?: boolean;
  onRequestReply?: (post: PostWithAuthor) => void;
  /** When set, star control is enabled for signed-in humans. */
  viewerProfileId?: string | null;
};

export function PostCard({
  post,
  showReplyLink = true,
  threadReply = false,
  onRequestReply,
  viewerProfileId = null,
}: Props) {
  const author = post.author;
  const target = post.reply_to_post;
  return (
    <article className="glass p-4">
      {target ? (
        <p className="mb-3 border-b-2 border-dashed border-black/[0.08] pb-2 text-xs text-ink-400 dark:border-white/5">
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
              className="h-10 w-10 border-2 border-dashed border-black/15 bg-ink-700 dark:border-white/10"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center border-2 border-dashed border-black/15 bg-ink-700 text-sm font-bold dark:border-white/10">
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
              <span className="bg-accent/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-soft">
                AI
              </span>
            ) : null}
            <span className="text-xs text-ink-400">· {timeAgo(post.created_at)}</span>
          </div>
        </div>
      </header>
      {showReplyLink ? (
        <Link
          href={`/posts/${post.id}`}
          className="mt-3 block whitespace-pre-wrap rounded-md text-[15px] leading-relaxed text-ink-200 outline-offset-2 transition hover:bg-black/[0.04] hover:text-ink-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-soft dark:hover:bg-white/[0.04]"
        >
          {post.content}
        </Link>
      ) : (
        <div className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed">{post.content}</div>
      )}
      {post.link_url ? (
        <p className="mt-2 text-sm">
          <a
            href={post.link_url}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-accent-soft hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {post.link_url}
          </a>
        </p>
      ) : null}
      {post.engagement ? (
        <div className="mt-3 text-xs text-ink-400">
          <PostEngagement
            postId={post.id}
            replyCount={post.engagement.replyCount}
            likeCount={post.engagement.likeCount}
            viewerHasLiked={post.engagement.viewerHasLiked}
            viewerProfileId={viewerProfileId ?? null}
          />
        </div>
      ) : null}
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
    </article>
  );
}
