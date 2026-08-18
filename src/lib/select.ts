/**
 * A dropdown that belongs to this design system.
 *
 * A `<select>` cannot be styled past its closed state. `appearance: none` and a
 * hand-drawn caret get the *field* to match the surface — that much is in
 * `global.css` and still runs — but the list it opens is drawn by the operating
 * system: system fonts, system colours, system corner radius, no transition,
 * and on Windows a scrollbar and a highlight that belong to a different decade
 * than the rest of this page. There is no CSS for the inside of a popup.
 *
 * So the popup is ours. This replaces the closed field with a `role="combobox"`
 * button and renders the options as a `role="listbox"` we control completely —
 * which is what buys the type, the accent, the check mark on the selected row
 * and the open/close animation.
 *
 * ## The native element stays
 *
 * It is not removed, it is hidden — and it remains the source of truth. Every
 * screen on this surface reads and writes `select.value` directly
 * (`fillProject()`, the import prefill, every Revert), and none of them should
 * have to know this module exists. Reading works unchanged because a hidden
 * `<select>` still has a value; writing works because the setter is overridden
 * on the element, the same hook `image-upload.ts` uses and for the same reason:
 * a property assignment fires no event, so nothing else would ever repaint the
 * button. Options added at runtime — `resolveCaseStudy()` inserts one — arrive
 * through a `MutationObserver` rather than a call anyone has to remember.
 *
 * Without JavaScript the native select is simply never hidden, and the page
 * works exactly as it did.
 *
 * ## Accessibility
 *
 * The button carries `role="combobox"`, `aria-expanded` and `aria-controls`;
 * the popup carries `role="listbox"` and its rows `role="option"` with
 * `aria-selected`. **Focus never leaves the button** — the active row is named
 * by `aria-activedescendant`, which is the pattern that keeps a screen reader
 * announcing the combobox and its current option rather than losing the
 * relationship on the way into a popover. Keyboard behaviour matches a native
 * select closely enough to be muscle memory: arrows, Home/End, Enter, Escape,
 * and type-ahead.
 *
 * ## Why the popup is a popover
 *
 * It has to escape two containers that would otherwise clip it: `.modal-body`,
 * which scrolls, and `<dialog>`, which renders in the top layer where no
 * `z-index` reaches. `popover` puts it in that same layer. Position is computed
 * from the button's rect on open and kept in step while scrolling, because a
 * popover is not anchored to anything by itself.
 */

const ENHANCED = 'data-enhanced';

/**
 * The class that displays the popup, in both the promoted and the fallback
 * path. It is a class rather than the `hidden` attribute because `hidden` is
 * honoured by an author rule (Tailwind's preflight ships `[hidden] { display:
 * none }`) that `showPopover()` has no way to lift — it promotes the element to
 * the top layer and clears the *UA* rule, and nothing in the algorithm removes
 * the attribute. A popover opened while still carrying it is in the top layer
 * and painting nothing.
 */
const SHOWN = 'is-shown';

/** How long the leave transition in `admin.css` runs. */
const CLOSE_MS = 130;

let idCounter = 0;

interface Enhanced {
  select: HTMLSelectElement;
  button: HTMLButtonElement;
  label: HTMLElement;
  menu: HTMLElement;
  /** The row the keyboard is on, which is not the same as the one chosen. */
  active: number;
}

/** The one open dropdown, if any. Only one can be open at a time. */
let open: Enhanced | null = null;

const optionsOf = (select: HTMLSelectElement) => Array.from(select.options);

/* ---------------------------------------------------------------- position */

/**
 * Put the menu under its button — or over it, when under would run off screen.
 *
 * `position: fixed` against the viewport rather than absolute against an
 * offset parent, because the offset parent is frequently a scrolling dialog
 * body and the menu is in the top layer, which has no offset parent at all.
 */
function place(instance: Enhanced) {
  const { button, menu } = instance;
  const rect = button.getBoundingClientRect();
  const gap = 4;

  menu.style.minWidth = `${rect.width}px`;
  menu.style.left = `${rect.left}px`;

  /* Clear the cap left by the last open before measuring, or the second open
     measures the first one's clamp and never grows back. */
  menu.style.maxHeight = '';

  /* Measure before deciding: the menu is already shown but transparent, so it
     has a height and nothing has been painted with it in the wrong place. */
  const height = menu.offsetHeight;
  const below = window.innerHeight - rect.bottom - gap;
  const above = rect.top - gap;
  const flip = height > below && above > below;

  menu.dataset.placement = flip ? 'above' : 'below';
  menu.style.top = flip ? `${Math.max(gap, rect.top - height - gap)}px` : `${rect.bottom + gap}px`;
  menu.style.maxHeight = `${Math.max(120, (flip ? above : below) - gap)}px`;
}

/* ------------------------------------------------------------------ opening */

function closeMenu(instance: Enhanced, focusButton = false) {
  if (open !== instance) return;
  open = null;

  instance.menu.classList.remove('is-open');
  instance.menu.classList.add('is-closing');
  instance.button.setAttribute('aria-expanded', 'false');
  instance.button.removeAttribute('aria-activedescendant');

  /* The popover is hidden after the transition rather than with it, so the
     leave animation is visible. A timeout rather than `transitionend`, which
     never fires under `prefers-reduced-motion: reduce`. */
  window.setTimeout(() => {
    instance.menu.classList.remove('is-closing');
    /* `.is-shown` is what actually displays this — see `openMenu`. Dropping it
       is therefore the close, and `hidePopover()` only has to give the top
       layer back. `:popover-open` is a syntax error where the feature is
       unsupported and `matches()` throws on one, so the whole pair is guarded
       rather than only the call. */
    instance.menu.classList.remove(SHOWN);
    try {
      if (instance.menu.matches(':popover-open')) instance.menu.hidePopover();
    } catch {
      /* Unsupported, or already hidden. The class above did the work. */
    }
  }, CLOSE_MS);

  if (focusButton) instance.button.focus();
}

function openMenu(instance: Enhanced) {
  if (open === instance) return;
  if (open) closeMenu(open);
  open = instance;

  renderOptions(instance);

  /* Top layer where it is available; a plain fixed element where it is not.
     The fallback is only wrong inside a `<dialog>`, which is where `popover`
     is supported anyway.

     **`showPopover()` is promotion, not display.** What hides a popover is the
     UA rule `[popover]:not(:popover-open) { display: none }`, and a *UA* rule
     is outranked by any author `display` whatever its specificity — the same
     cascade fact `.modal[open]` in `admin.css` is written the way it is for.
     So the display state has to be an author class this code controls in both
     directions, or the promotion happens to an element another author rule is
     still holding at `display: none` and the list opens invisibly. */
  try {
    instance.menu.showPopover?.();
  } catch {
    /* Unsupported, or already showing. `.is-shown` below is what paints it. */
  }
  instance.menu.classList.add(SHOWN);

  instance.button.setAttribute('aria-expanded', 'true');
  instance.active = Math.max(0, instance.select.selectedIndex);
  place(instance);
  markActive(instance, instance.active, 'instant');

  /* One frame with the entry state committed, then the class that animates off
     it — the same two-step the toasts use. */
  requestAnimationFrame(() => instance.menu.classList.add('is-open'));
}

/* ------------------------------------------------------------------- render */

function renderOptions(instance: Enhanced) {
  const { select, menu } = instance;

  menu.replaceChildren(
    ...optionsOf(select).map((option, index) => {
      const row = document.createElement('div');
      row.className = 'select-option';
      row.id = `${menu.id}-o${index}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === select.selectedIndex));
      if (option.disabled) row.setAttribute('aria-disabled', 'true');

      const tick = document.createElement('span');
      tick.className = 'select-tick';
      tick.setAttribute('aria-hidden', 'true');
      tick.textContent = index === select.selectedIndex ? '✓' : '';

      const text = document.createElement('span');
      text.className = 'select-option-text';
      /* Option labels come from the database — a case study's title — so they
         are set as text and never parsed as markup. */
      text.textContent = option.textContent ?? option.value;

      row.append(tick, text);

      /* `mousedown`, not `click`: the button keeps focus, and a click would
         land after the blur handler has already closed the menu. */
      row.addEventListener('mousedown', event => {
        event.preventDefault();
        if (option.disabled) return;
        choose(instance, index);
      });
      row.addEventListener('mousemove', () => markActive(instance, index, 'instant'));

      return row;
    }),
  );
}

function rows(instance: Enhanced) {
  return Array.from(instance.menu.querySelectorAll<HTMLElement>('.select-option'));
}

function markActive(instance: Enhanced, index: number, scroll: ScrollBehavior | 'instant' = 'smooth') {
  const all = rows(instance);
  if (!all.length) return;
  instance.active = Math.max(0, Math.min(index, all.length - 1));

  all.forEach((row, i) => {
    if (i === instance.active) row.dataset.active = 'true';
    else delete row.dataset.active;
  });

  const row = all[instance.active];
  instance.button.setAttribute('aria-activedescendant', row.id);
  row.scrollIntoView({ block: 'nearest', behavior: scroll === 'instant' ? 'auto' : scroll });
}

/** Paint the closed button from whatever the native select currently says. */
function syncLabel(instance: Enhanced) {
  const option = instance.select.selectedOptions[0];
  instance.label.textContent = option ? (option.textContent ?? option.value) : '';
  /* An empty choice — "— none —" — is a placeholder rather than a value, and
     should read like one. */
  instance.button.dataset.empty = option && option.value ? 'false' : 'true';
}

function choose(instance: Enhanced, index: number) {
  const option = instance.select.options[index];
  if (!option || option.disabled) return;

  const changed = instance.select.selectedIndex !== index;
  instance.select.selectedIndex = index;
  syncLabel(instance);
  closeMenu(instance, true);

  /* Assigning `selectedIndex` fires nothing, and page code listens for
     `change` — `cs-pick` links a case study on it. Dispatched only on a real
     change, so re-picking what was already picked is not a write. */
  if (changed) instance.select.dispatchEvent(new Event('change', { bubbles: true }));
}

/* ----------------------------------------------------------------- keyboard */

/** Jump to the next option starting with what was typed. */
let typed = '';
let typedAt = 0;

function typeahead(instance: Enhanced, key: string) {
  const now = Date.now();
  typed = now - typedAt > 700 ? key : typed + key;
  typedAt = now;

  const all = optionsOf(instance.select);
  const from = instance.active + (typed.length === 1 ? 1 : 0);
  for (let step = 0; step < all.length; step += 1) {
    const index = (from + step) % all.length;
    const text = (all[index].textContent ?? '').trim().toLowerCase();
    if (text.startsWith(typed.toLowerCase())) {
      if (open === instance) markActive(instance, index);
      else choose(instance, index);
      return;
    }
  }
}

function onKeydown(instance: Enhanced, event: KeyboardEvent) {
  const isOpen = open === instance;
  const count = instance.select.options.length;

  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      if (!isOpen) {
        /* Closed, arrows move the value itself — what a native select does,
           and what someone who has used one expects. `alt` opens instead. */
        if (event.altKey) return openMenu(instance);
        return choose(instance, Math.max(0, Math.min(instance.select.selectedIndex + step, count - 1)));
      }
      return markActive(instance, instance.active + step);
    }
    case 'Home':
    case 'End': {
      if (!isOpen) return;
      event.preventDefault();
      return markActive(instance, event.key === 'Home' ? 0 : count - 1);
    }
    case 'PageDown':
    case 'PageUp': {
      if (!isOpen) return;
      event.preventDefault();
      return markActive(instance, instance.active + (event.key === 'PageDown' ? 5 : -5));
    }
    case 'Enter':
    case ' ': {
      event.preventDefault();
      if (!isOpen) return openMenu(instance);
      return choose(instance, instance.active);
    }
    case 'Escape': {
      if (!isOpen) return;
      event.preventDefault();
      /* Escape abandons: the value is whatever it was before opening. */
      return closeMenu(instance, true);
    }
    case 'Tab': {
      /* Let focus move on, but do not leave a popup behind it. */
      if (isOpen) closeMenu(instance);
      return;
    }
    default: {
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        typeahead(instance, event.key);
      }
    }
  }
}

/* ------------------------------------------------------------------- mount */

export function enhanceSelect(select: HTMLSelectElement): void {
  if (select.hasAttribute(ENHANCED)) return;
  select.setAttribute(ENHANCED, '');

  idCounter += 1;
  const id = `select-${idCounter}`;

  const wrap = document.createElement('div');
  wrap.className = 'select';
  /* `.is-auto` means "sized by the content, not the column" — the case-study
     picker sits in a row of buttons. The native element is about to be hidden,
     so the intent has to move to the wrapper or that control goes full width. */
  if (select.classList.contains('is-auto')) wrap.classList.add('select-auto');
  select.after(wrap);

  const button = document.createElement('button');
  button.type = 'button';
  /* `.input` too, so it inherits the field's border, ground, radius and focus
     ring rather than restating four tokens that would then drift. */
  button.className = 'input select-button';
  button.setAttribute('role', 'combobox');
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', id);

  /* The label the field already had, so the button is announced as the same
     control the `<label for>` pointed at. */
  const labelled = select.id ? document.querySelector(`label[for="${CSS.escape(select.id)}"]`) : null;
  if (labelled) {
    if (!labelled.id) labelled.id = `${id}-label`;
    button.setAttribute('aria-labelledby', labelled.id);
    /* Clicking the label should still open this, and it no longer can reach
       the native element it names. */
    labelled.addEventListener('click', event => {
      event.preventDefault();
      button.focus();
      openMenu(instance);
    });
  } else if (select.getAttribute('aria-label')) {
    button.setAttribute('aria-label', select.getAttribute('aria-label')!);
  }

  const label = document.createElement('span');
  label.className = 'select-value';

  const caret = document.createElement('span');
  caret.className = 'select-caret';
  caret.setAttribute('aria-hidden', 'true');

  button.append(label, caret);

  const menu = document.createElement('div');
  menu.className = 'select-menu';
  menu.id = id;
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('popover', 'manual');

  wrap.append(select, button);
  document.body.appendChild(menu);

  /* Hidden rather than removed: it is still the value, and `display: none`
     does not stop `select.value` from working. `aria-hidden` and `tabindex`
     keep it from being announced or focused twice. */
  select.classList.add('select-native');
  select.setAttribute('aria-hidden', 'true');
  select.tabIndex = -1;

  const instance: Enhanced = { select, button, label, menu, active: 0 };

  button.addEventListener('click', () => {
    if (open === instance) closeMenu(instance, true);
    else openMenu(instance);
  });
  button.addEventListener('keydown', event => onKeydown(instance, event));
  button.addEventListener('blur', () => {
    /* The rows use `mousedown`, so a click on one has already chosen by the
       time this runs — anything else that took focus means "go away". */
    if (open === instance) closeMenu(instance);
  });

  /**
   * Follow the native element, whoever moved it.
   *
   * `fillProject()`, the import prefill and every Revert assign `.value`
   * directly, and a property assignment fires no event — so without this the
   * button would go on showing the previous choice while the form had already
   * been reverted, which is worse than showing nothing.
   */
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!;
  Object.defineProperty(select, 'value', {
    configurable: true,
    get() {
      return descriptor.get!.call(select);
    },
    set(next: string) {
      descriptor.set!.call(select, next);
      syncLabel(instance);
    },
  });

  select.addEventListener('change', () => syncLabel(instance));

  /* Options are not static: `resolveCaseStudy()` inserts one after scaffolding,
     and `disabled` is toggled while a save is in flight. Observing is what
     keeps this working without every caller having to know to tell us. */
  new MutationObserver(() => {
    syncLabel(instance);
    button.disabled = select.disabled;
    if (open === instance) renderOptions(instance);
  }).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });

  button.disabled = select.disabled;
  syncLabel(instance);
}

/**
 * Enhance every select on the screen, and keep doing it after each navigation.
 *
 * Idempotent by attribute, so the repeat visits `<ClientRouter />` produces
 * cost one `querySelectorAll`. Called from `AdminLayout` rather than per page:
 * there is nothing page-specific about a dropdown.
 */
export function mountSelects(): void {
  const run = () => {
    document.querySelectorAll<HTMLSelectElement>(`select.input:not([${ENHANCED}])`).forEach(enhanceSelect);
  };

  run();
  document.addEventListener('astro:page-load', run);

  /* A navigation replaces the body, taking every menu appended to it — and the
     selects that come back are new elements without the attribute, so they are
     enhanced again above. This only has to drop the stale reference. */
  document.addEventListener('astro:before-swap', () => {
    if (open) closeMenu(open);
    document.querySelectorAll('.select-menu').forEach(menu => menu.remove());
  });

  /* The menu is positioned against the viewport, so anything that moves the
     button underneath it has to be followed. Passive and capturing: scrolls
     inside a dialog body do not bubble. */
  const follow = () => {
    if (open) place(open);
  };
  window.addEventListener('scroll', follow, { passive: true, capture: true });
  window.addEventListener('resize', follow, { passive: true });

  /* Clicking anywhere that is not this dropdown closes it. The button's own
     `blur` covers keyboard and most pointer cases; this covers a click on
     something that takes no focus at all. */
  document.addEventListener('pointerdown', event => {
    if (!open) return;
    const target = event.target as Node;
    if (!open.menu.contains(target) && !open.button.contains(target)) closeMenu(open);
  });
}
