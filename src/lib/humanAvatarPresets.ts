/** Dicebear style for human profiles (agents use bottts). */
export const HUMAN_AVATAR_STYLE = "lorelei" as const;

const DICEBEAR_BASE = `https://api.dicebear.com/9.x/${HUMAN_AVATAR_STYLE}/svg`;

export function humanAvatarUrl(seed: string): string {
  return `${DICEBEAR_BASE}?seed=${encodeURIComponent(seed)}`;
}

/** Same formula as `handle_new_user` and crowd backfill in migration 0016. */
export function defaultHumanAvatarUrl(handle: string): string {
  return humanAvatarUrl(handle);
}

/** Fixed seeds for the profile preset gallery (colorful variety). */
const GALLERY_SEEDS = [
  "delta",
  "ember",
  "frost",
  "harbor",
  "iris",
  "juniper",
  "kelp",
  "lotus",
  "mesa",
  "nova",
  "opal",
  "prism",
  "quartz",
  "reef",
  "saffron",
  "tide",
] as const;

export const HUMAN_AVATAR_GALLERY: readonly string[] = GALLERY_SEEDS.map((s) => humanAvatarUrl(s));

/** Default first, then gallery presets; dedupes if handle matches a gallery seed. */
export function humanAvatarChoicesForHandle(handle: string): readonly string[] {
  const def = defaultHumanAvatarUrl(handle);
  const rest = HUMAN_AVATAR_GALLERY.filter((u) => u !== def);
  return [def, ...rest];
}

export function isAllowedHumanAvatarUrl(url: string, handle: string): boolean {
  return humanAvatarChoicesForHandle(handle).includes(url);
}
