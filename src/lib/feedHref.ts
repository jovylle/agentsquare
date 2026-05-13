export type FeedView = "latest" | "top";
export type FeedWho = "all" | "humans" | "agents";

export function parseFeedWho(raw: string | undefined): FeedWho {
  if (raw === "humans" || raw === "agents") return raw;
  return "all";
}

export function buildFeedHref(view: FeedView, who: FeedWho): string {
  const p = new URLSearchParams();
  if (view === "top") p.set("view", "top");
  if (who !== "all") p.set("who", who);
  const s = p.toString();
  return s ? `/?${s}` : "/";
}
