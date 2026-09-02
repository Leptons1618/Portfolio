/**
 * Text effects — the two the site uses, written here rather than pulled in.
 *
 * `scramble` decodes a string out of noise, glyph by glyph, left to right;
 * `typewrite` types one in with a caret. Both are a few dozen lines on
 * `requestAnimationFrame`, which is why they are not a dependency: the text
 * effect libraries on npm ship a plugin system, a timeline and a build of
 * their own for what is here two functions and a `MutationObserver`-free
 * mount. (`pretext`, which was suggested, is a text *measurement* library —
 * line-breaking arithmetic for canvas — and does no effects at all.)
 *
 * Three rules every effect here keeps:
 *
 *   - **The real text is always in the DOM.** The animated glyphs sit in an
 *     `aria-hidden` span and the final string in a visually-hidden one, so a
 *     screen reader, find-in-page and a copy-paste all see the words and never
 *     the noise. Nothing is communicated by the motion alone.
 *   - **Reduced motion is the plain string.** No frames run; the element is
 *     left exactly as the server rendered it.
 *   - **It fires once, on arrival.** An `IntersectionObserver` starts an effect
 *     when its element is on screen, so a page with six of them does not run
 *     all six on load for a reader looking at the first.
 *
 * Markup contract: `data-fx="scramble"` or `data-fx="type"` on an element
 * whose *text content* is the string. Optional `data-fx-delay` (ms) and
 * `data-fx-speed` (ms per glyph). The element's own children are replaced,
 * so it must contain only text.
 */

const GLYPHS = '!<>-_\\/[]{}—=+*^?#01';

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Build the two-span shell every effect writes into. Returns the visual span. */
function shell(el: HTMLElement, finalText: string): HTMLSpanElement {
  const visual = document.createElement('span');
  visual.setAttribute('aria-hidden', 'true');
  visual.className = 'fx-visual';
  const real = document.createElement('span');
  real.className = 'visually-hidden';
  real.textContent = finalText;
  el.replaceChildren(visual, real);
  return visual;
}

/** Decode `text` out of noise into `el`. Resolves when settled. */
export function scramble(el: HTMLElement, opts: { speed?: number } = {}): Promise<void> {
  const finalText = el.textContent ?? '';
  if (reducedMotion() || !finalText.trim()) return Promise.resolve();
  const speed = opts.speed ?? 28;
  const visual = shell(el, finalText);
  el.dataset.fxState = 'running';

  /* Each glyph resolves at its own moment, staggered left to right with a
     little jitter, so the line settles like a departures board rather than
     a wipe. */
  const settleAt = Array.from(finalText, (_, i) => i * speed + Math.random() * speed * 2 + 120);
  const start = performance.now();

  return new Promise(resolve => {
    const frame = (now: number) => {
      const t = now - start;
      let out = '';
      let done = true;
      for (let i = 0; i < finalText.length; i += 1) {
        const ch = finalText[i];
        if (ch === ' ' || t >= settleAt[i]) out += ch;
        else {
          done = false;
          out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        }
      }
      visual.textContent = out;
      if (done) {
        el.dataset.fxState = 'done';
        resolve();
      } else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

/** Type `el`'s text in, one glyph per tick, with a caret that blinks after. */
export function typewrite(el: HTMLElement, opts: { speed?: number } = {}): Promise<void> {
  const finalText = el.textContent ?? '';
  if (reducedMotion() || !finalText) return Promise.resolve();
  const speed = opts.speed ?? 42;
  const visual = shell(el, finalText);
  const caret = document.createElement('span');
  caret.className = 'fx-caret';
  caret.setAttribute('aria-hidden', 'true');
  el.append(caret);
  el.dataset.fxState = 'running';

  let i = 0;
  let last = 0;
  return new Promise(resolve => {
    const frame = (now: number) => {
      if (now - last >= speed) {
        last = now;
        i += 1;
        visual.textContent = finalText.slice(0, i);
      }
      if (i >= finalText.length) {
        el.dataset.fxState = 'done';
        resolve();
      } else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

/**
 * Wire every `[data-fx]` under `root`. Idempotent: an element already mounted
 * is skipped, so calling this after a view transition costs one query.
 */
export function mountTextFx(root: ParentNode = document): void {
  const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-fx]:not([data-fx-state])'));
  if (!targets.length) return;

  const run = (el: HTMLElement) => {
    const delay = Number(el.dataset.fxDelay ?? 0);
    const speed = el.dataset.fxSpeed ? Number(el.dataset.fxSpeed) : undefined;
    const go = () => {
      if (el.dataset.fx === 'scramble') void scramble(el, { speed });
      else if (el.dataset.fx === 'type') void typewrite(el, { speed });
    };
    if (delay > 0) setTimeout(go, delay);
    else go();
  };

  if (reducedMotion() || !('IntersectionObserver' in window)) {
    /* Nothing to animate — the plain text is already correct. Mark them so a
       second mount does not queue them again. */
    targets.forEach(el => { el.dataset.fxState = 'done'; });
    return;
  }

  const observer = new IntersectionObserver((entries, self) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target as HTMLElement;
      self.unobserve(el);
      /* Claim it before the delay so a re-mount in the gap cannot double it. */
      el.dataset.fxState = 'queued';
      run(el);
    }
  }, { threshold: 0.2 });

  targets.forEach(el => observer.observe(el));
}
