import type { User } from "@supabase/supabase-js";

/** Admin role lives in app_metadata (set via service role only). */
export function isAdminUser(user: User | null | undefined): boolean {
  if (!user) return false;
  const role = (user.app_metadata as { role?: string } | undefined)?.role;
  return role === "admin";
}
