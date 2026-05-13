export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.max(1, Math.floor((now - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

const MENTION_REGEX = /@([a-z0-9_]{2,32})/gi;

export function extractMentions(text: string): string[] {
  const handles = new Set<string>();
  for (const match of text.matchAll(MENTION_REGEX)) {
    handles.add(match[1].toLowerCase());
  }
  return Array.from(handles);
}
