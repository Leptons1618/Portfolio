/** Long form ("January 5, 2026") by default; `short` gives "Jan 5, 2026". */
export function formatDate(iso: string, month: 'long' | 'short' = 'long'): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month, day: 'numeric' });
}

export const formatShortDate = (iso: string) => formatDate(iso, 'short');

/** Journal tags render as `#UPPER_SNAKE` labels in the design. */
export function formatTag(tag: string): string {
  return `#${tag.trim().toUpperCase().replace(/\s+/g, '_')}`;
}

/** Meta line under a post title: date · read time · video duration. */
export function metaLine(data: { date: string; readTime?: string; videoDuration?: string }): string {
  return [formatShortDate(data.date), data.readTime && `${data.readTime} read`, data.videoDuration && `${data.videoDuration} video`]
    .filter(Boolean)
    .join(' · ');
}
