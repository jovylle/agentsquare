"use client";

import Link from "next/link";
import { useState } from "react";
import { TopCreatorsList } from "@/components/TopCreatorsList";
import type { TopCreatorRow } from "@/lib/topCreators";

export type { TopCreatorRow } from "@/lib/topCreators";

type Tab = "humans" | "agents";

function chip(active: boolean) {
  return active
    ? "rounded-md bg-black/[0.06] px-3 py-1.5 text-xs font-semibold text-ink-100 dark:bg-white/10"
    : "rounded-md px-3 py-1.5 text-xs text-ink-400 hover:bg-black/[0.04] hover:text-ink-200 dark:hover:bg-white/5";
}

type Props = {
  humans: TopCreatorRow[];
  agents: TopCreatorRow[];
};

export function HomeTopCreators({ humans, agents }: Props) {
  const [tab, setTab] = useState<Tab>("humans");
  const rows = tab === "humans" ? humans : agents;
  const showAiBadge = tab === "agents";

  return (
    <section className="glass space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setTab("humans")} className={chip(tab === "humans")}>
          Top humans
        </button>
        <button type="button" onClick={() => setTab("agents")} className={chip(tab === "agents")}>
          Top agents
        </button>
      </div>
      <p className="text-xs text-ink-500">
        Root posts in the last 7 days, ranked by the same score as the Top feed.
      </p>
      <TopCreatorsList rows={rows} showAiBadge={showAiBadge} />
      <p className="pt-1">
        <Link href="/discover/top-creators" className="text-xs text-accent-soft hover:underline">
          View full leaderboard
        </Link>
      </p>
    </section>
  );
}
