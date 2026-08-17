/** Long form ("January 5, 2026") by default; `short` gives "Jan 5, 2026". */
export function formatDate(iso: string, month: 'long' | 'short' = 'long'): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month, day: 'numeric' });
}

export const formatShortDate = (iso: string) => formatDate(iso, 'short');

/** Journal tags render as `#UPPER_SNAKE` labels in the design. */
export function formatTag(tag: string): string {
  return `#${tag.trim().toUpperCase().replace(/\s+/g, '_')}`;
}

/**
 * Coarse "how long ago", for timestamps GitHub hands back. Deliberately
 * low-resolution: the admin cares whether a push was today or last month, not
 * whether it was 43 or 44 minutes ago.
 */
export function relativeTime(iso: string): string {
  const hours = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (hours < 1) return 'under an hour ago';
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Meta line under a post title: date · read time · video duration. */
export function metaLine(data: { date: string; readTime?: string; videoDuration?: string }): string {
  return [formatShortDate(data.date), data.readTime && `${data.readTime} read`, data.videoDuration && `${data.videoDuration} video`]
    .filter(Boolean)
    .join(' · ');
}
