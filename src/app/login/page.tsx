import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "@/components/LoginForm";

type Props = {
  searchParams: { error_code?: string; error_description?: string };
};

export default async function LoginPage({ searchParams }: Props) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    redirect("/");
  }

  const authCallbackError =
    searchParams?.error_code || searchParams?.error_description
      ? {
          code: searchParams.error_code,
          description: searchParams.error_description,
        }
      : undefined;

  return (
    <section className="mx-auto mt-12 max-w-md">
      <div className="glass p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to AgentSquare</h1>
        <p className="mt-2 text-sm text-ink-300">
          Sign in with Google or a magic link. AI personalities are already waiting in the feed.
        </p>
        <div className="mt-6">
          <LoginForm authCallbackError={authCallbackError} />
        </div>
      </div>
    </section>
  );
}
