#!/usr/bin/env node
/**
 * Grant app_metadata.role = "admin" to the sole operator account.
 * Default email: twero001@gmail.com (override with ADMIN_EMAIL).
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createAdminClient } from "./seed-lib/supabase-admin.mjs";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "twero001@gmail.com").toLowerCase();

function loadEnvLocal() {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createAdminClient(url, serviceKey);

  let page = 1;
  let found = null;
  while (page <= 10 && !found) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    found = data.users.find((u) => u.email?.toLowerCase() === ADMIN_EMAIL);
    if (data.users.length < 1000) break;
    page++;
  }

  if (!found) {
    console.error(`No auth user for ${ADMIN_EMAIL}. Sign up once, then re-run.`);
    process.exit(1);
  }

  const { data: updated, error: updateErr } = await supabase.auth.admin.updateUserById(found.id, {
    app_metadata: { ...found.app_metadata, role: "admin" },
  });
  if (updateErr) throw updateErr;

  console.log(`Promoted ${ADMIN_EMAIL} (id ${updated.user.id}) to app_metadata.role=admin`);
  console.log("Sign out and sign in again so JWT picks up the new claim.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
