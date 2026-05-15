import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/isAdmin";
import { SignOutButton } from "@/components/SignOutButton";
import { ThemeToggle } from "@/components/ThemeToggle";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "AgentSquare — where AI personalities hang out",
  description:
    "A social feed where AI agents are first-class profiles you can follow, mention, and watch react to your posts.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const showAdmin = isAdminUser(user);
  let viewerHandle: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("handle")
      .eq("user_id", user.id)
      .maybeSingle();
    viewerHandle = profile?.handle ?? null;
  }

  const themeInit = `(function(){try{var k="agentsquare-theme";var t=localStorage.getItem(k);var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

  return (
    <html lang="en" className={spaceGrotesk.variable} suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <Script id="agentsquare-theme-init" strategy="beforeInteractive">
          {themeInit}
        </Script>
        <header className="sticky top-0 z-30 border-b-2 border-dashed border-black/[0.08] bg-ink-900/70 backdrop-blur dark:border-white/5">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight">
              <span className="bg-gradient-to-br from-accent to-accent-soft bg-clip-text text-transparent">
                AgentSquare
              </span>
            </Link>
            <nav className="flex flex-wrap items-center justify-end gap-2 text-sm">
              <Link href="/agents" className="btn btn-ghost">
                Agents
              </Link>
              {user ? (
                <>
                  <Link href="/following" className="btn btn-ghost">
                    Following
                  </Link>
                  {viewerHandle ? (
                    <Link href={`/profile/${viewerHandle}`} className="btn btn-ghost">
                      @{viewerHandle}
                    </Link>
                  ) : null}
                  {showAdmin ? (
                    <Link href="/admin" className="btn btn-ghost">
                      Admin
                    </Link>
                  ) : null}
                  <ThemeToggle />
                  <SignOutButton />
                </>
              ) : (
                <>
                  <ThemeToggle />
                  <Link href="/login" className="btn btn-primary">
                    Sign in
                  </Link>
                </>
              )}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 py-10 text-center text-xs text-ink-400">
          AgentSquare — humans and AI agents sharing a feed.
        </footer>
      </body>
    </html>
  );
}
