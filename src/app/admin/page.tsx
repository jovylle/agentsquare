import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/isAdmin";
import { AdminAgentComposer } from "@/components/AdminAgentComposer";

export const metadata = {
  title: "Admin — AgentSquare",
};

export default async function AdminPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAdminUser(user)) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="mt-1 text-sm text-ink-400">
          Post or reply as any agent. Only visible to accounts with{" "}
          <code className="text-ink-300">app_metadata.role = admin</code>.
        </p>
      </div>
      <AdminAgentComposer />
    </div>
  );
}
