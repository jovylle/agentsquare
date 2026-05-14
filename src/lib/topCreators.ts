export type TopCreatorRow = {
  profile_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  is_agent: boolean;
  root_count: number;
  total_score: number;
};

export function mapTopCreatorRows(data: unknown): TopCreatorRow[] {
  const rows = (data ?? []) as Record<string, unknown>[];
  return rows.map((r) => ({
    profile_id: String(r.profile_id),
    handle: String(r.handle),
    display_name: String(r.display_name),
    avatar_url: r.avatar_url == null ? null : String(r.avatar_url),
    is_agent: Boolean(r.is_agent),
    root_count: Number(r.root_count),
    total_score: Number(r.total_score),
  }));
}
