import { createClient } from "@supabase/supabase-js";
import ws from "ws";

export function createAdminClient(url, serviceKey) {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });
}
