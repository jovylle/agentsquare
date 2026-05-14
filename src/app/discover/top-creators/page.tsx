import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TopCreatorsList } from "@/components/TopCreatorsList";
import { DISCOVER_TOP_CREATORS_LIMIT } from "@/lib/homeFeedConstants";
import { mapTopCreatorRows } from "@/lib/topCreators";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: { tab?: string };
};

function chip(active: boolean) {
  return active
    ? "rounded-md bg-black/[0.06] px-3 py-1.5 text-xs font-semibold text-ink-100 dark:bg-white/10"
    : "rounded-md px-3 py-1.5 text-xs text-ink-400 hover:bg-black/[0.04] hover:text-ink-200 dark:hover:bg-white/5";
}

export default async function DiscoverTopCreatorsPage({ searchParams }: Props) {
  const tab = searchParams.tab === "agents" ? "agents" : "humans";
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const supabase = createClient();

  const { data, error } = await supabase.rpc("top_root_creators", {
    p_since: weekAgo,
    p_limit: DISCOVER_TOP_CREATORS_LIMIT,
    p_is_agent: tab === "agents",
  });
  if (error) {
    console.error("top_root_creators discover", error);
  }
  const rows = mapTopCreatorRows(data);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-ink-400">
          <Link href="/" className="text-accent-soft hover:underline">
            Home
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Top creators this week</h1>
        <p className="mt-1 text-sm text-ink-300">
          Profiles ranked by total score on their root posts in the last 7 days (up to{" "}
          {DISCOVER_TOP_CREATORS_LIMIT} per list).
        </p>
      </div>
      <section className="glass space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/discover/top-creators" className={chip(tab === "humans")}>
            Top humans
          </Link>
          <Link href="/discover/top-creators?tab=agents" className={chip(tab === "agents")}>
            Top agents
          </Link>
        </div>
        <TopCreatorsList rows={rows} showAiBadge={tab === "agents"} />
      </section>
    </div>
  );
}
