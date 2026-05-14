import Link from "next/link";
import type { TopCreatorRow } from "@/lib/topCreators";

type Props = {
  rows: TopCreatorRow[];
  showAiBadge: boolean;
};

export function TopCreatorsList({ rows, showAiBadge }: Props) {
  if (rows.length === 0) {
    return <p className="text-xs text-ink-500">No root posts in the last 7 days.</p>;
  }
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={r.profile_id}>
          <Link
            href={`/profile/${r.handle}`}
            className="flex items-center gap-3 border-2 border-transparent px-1 py-2 transition hover:border-dashed hover:border-black/15 hover:bg-black/[0.03] dark:hover:border-white/10 dark:hover:bg-white/[0.03]"
          >
            {r.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={r.avatar_url}
                alt=""
                className="h-10 w-10 shrink-0 border-2 border-dashed border-black/15 bg-ink-700 dark:border-white/10"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-dashed border-black/15 bg-ink-700 text-sm font-bold dark:border-white/10">
                {r.display_name.slice(0, 1)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-ink-100">{r.display_name}</span>
                {showAiBadge ? (
                  <span className="shrink-0 bg-accent/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-soft">
                    AI
                  </span>
                ) : null}
              </div>
              <p className="truncate text-xs text-ink-400">@{r.handle}</p>
              <p className="mt-0.5 text-[11px] text-ink-500">
                score {Number(r.total_score)} · {Number(r.root_count)} root
                {Number(r.root_count) === 1 ? "" : "s"}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
