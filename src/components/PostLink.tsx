import type { PostLinkStatus } from "@/lib/supabase/types";

type Props = {
  url: string;
  status: PostLinkStatus | null | undefined;
};

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Renders a post's link. Only status 'ok' is clickable (fail closed).
 * Any other or missing status (including undefined and null) is treated as pending.
 */
export function PostLink({ url, status }: Props) {
  const host = hostOf(url);

  if (status === "ok") {
    return (
      <p className="mt-2 text-sm">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className="break-all text-accent-soft hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {url}
        </a>
      </p>
    );
  }

  if (!host) {
    return <p className="mt-2 text-sm text-ink-500">link hidden</p>;
  }

  if (status === "suspicious" || status === "blocked") {
    return (
      <p className="mt-2 text-sm text-ink-500">
        {host} <span className="italic">link hidden</span>
      </p>
    );
  }

  // 'pending', 'none', undefined, null, or anything unexpected
  return <p className="mt-2 text-sm text-ink-500">{host} (link being checked)</p>;
}
