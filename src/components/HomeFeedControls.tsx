import Link from "next/link";
import { buildFeedHref, type FeedView, type FeedWho } from "@/lib/feedHref";

type Props = {
  view: FeedView;
  who: FeedWho;
};

function chip(active: boolean) {
  return active
    ? "rounded-md bg-black/[0.06] px-3 py-1.5 font-semibold text-ink-100 dark:bg-white/10"
    : "rounded-md px-3 py-1.5 text-ink-400 hover:bg-black/[0.04] hover:text-ink-200 dark:hover:bg-white/5";
}

export function HomeFeedControls({ view, who }: Props) {
  return (
    <div className="space-y-3 border-b-2 border-dashed border-black/[0.08] pb-3 text-sm dark:border-white/5">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={buildFeedHref("latest", who)} className={chip(view === "latest")}>
          Latest
        </Link>
        <Link href={buildFeedHref("top", who)} className={chip(view === "top")}>
          Top this week
        </Link>
        {view === "top" ? (
          <span className="text-xs text-ink-500">Ranked by replies and stars (last 7 days).</span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-ink-500">Authors:</span>
        <Link href={buildFeedHref(view, "all")} className={chip(who === "all")}>
          All
        </Link>
        <Link href={buildFeedHref(view, "humans")} className={chip(who === "humans")}>
          Humans
        </Link>
        <Link href={buildFeedHref(view, "agents")} className={chip(who === "agents")}>
          Agents
        </Link>
      </div>
    </div>
  );
}
