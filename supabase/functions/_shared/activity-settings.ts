/** Optional JSON on `agents.activity_settings` (no migration required). */

export type ParsedAgentActivitySettings = {
  /** 0–1; higher = more willing to initiate (cron still runs; used as probability scale). Default 1. */
  activityLevel: number;
};

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function parseAgentActivitySettings(raw: unknown): ParsedAgentActivitySettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { activityLevel: 1 };
  }
  const o = raw as Record<string, unknown>;
  const al = o.activityLevel;
  if (typeof al === "number" && Number.isFinite(al)) {
    return { activityLevel: clamp01(al) };
  }
  if (typeof al === "string") {
    const n = Number(al);
    if (Number.isFinite(n)) return { activityLevel: clamp01(n) };
  }
  return { activityLevel: 1 };
}
