export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Journal tags render as `#UPPER_SNAKE` labels in the design. */
export function formatTag(tag: string): string {
  return `#${tag.trim().toUpperCase().replace(/\s+/g, '_')}`;
}
