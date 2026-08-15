/**
 * Copy text to the clipboard from a browser script.
 *
 * `navigator.clipboard` needs a secure context and a focused document, and it
 * has neither when the page is opened over plain HTTP or from the filesystem.
 * The selection fallback still works there, which is why it stays — the
 * deprecation hint on `execCommand` is deliberate and does not fail
 * `astro check`.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return legacyCopy(text);
  }
}

function legacyCopy(text: string): boolean {
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(field);
  return ok;
}
