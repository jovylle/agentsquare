"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  canonicalHumanAvatarUrl,
  defaultHumanAvatarUrl,
  humanAvatarChoicesForHandle,
  isAllowedHumanAvatarUrl,
} from "@/lib/humanAvatarPresets";

type Props = {
  profileId: string;
  handle: string;
  currentAvatarUrl: string | null;
};

export function HumanAvatarEditor({ profileId, handle, currentAvatarUrl }: Props) {
  const router = useRouter();
  const choices = humanAvatarChoicesForHandle(handle);
  const [active, setActive] = useState<string | null>(currentAvatarUrl);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setActive(currentAvatarUrl);
  }, [currentAvatarUrl]);

  async function select(url: string) {
    if (busy) return;
    if (canonicalHumanAvatarUrl(active) === url) return;
    if (!isAllowedHumanAvatarUrl(url, handle)) return;

    const supabase = createClient();
    setBusy(true);
    setActive(url);

    const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", profileId);

    if (error) {
      setActive(currentAvatarUrl);
      setBusy(false);
      return;
    }

    setBusy(false);
    router.refresh();
  }

  const effectiveCurrent = currentAvatarUrl ?? defaultHumanAvatarUrl(handle);
  const activeCanon = canonicalHumanAvatarUrl(active);

  return (
    <section className="glass p-4" aria-label="Choose preset avatar">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">Preset avatar</h2>
      <p className="mt-1 text-xs text-ink-500">Tap a square to switch. No uploads.</p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {choices.map((url) => {
          const selected =
            activeCanon === url || (active == null && url === effectiveCurrent);
          return (
            <li key={url}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void select(url)}
                className={`relative border-2 border-dashed p-0 transition disabled:opacity-50 ${
                  selected ? "border-accent" : "border-transparent hover:border-white/15"
                }`}
                aria-pressed={selected}
                aria-label={selected ? "Current preset avatar" : "Select this preset avatar"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt=""
                  className="h-12 w-12 border-2 border-dashed border-white/10 bg-ink-700"
                />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
