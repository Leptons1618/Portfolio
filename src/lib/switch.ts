/**
 * The switch that replaces a checkbox on this surface.
 *
 * The projects screens have had one since they were written — a `role="switch"`
 * button with a knob, styled by `.toggle` in `admin.css` — and the AI screen
 * had four native checkboxes doing the same job in a different visual language.
 * Two controls for one idea is the kind of drift that only ever grows, so this
 * makes the button the control everywhere and leaves the checkbox as its value.
 *
 * ## The native input stays, and stays the value
 *
 * Exactly the arrangement `select.ts` uses, for exactly the same reasons. The
 * `<input>` is hidden rather than removed, so every `fields.active.checked`
 * read and write on the AI screen works unchanged and no form loses a field.
 * Reading works because a hidden checkbox still has a `checked`; writing works
 * because the property is overridden on the element — a property assignment
 * fires no event, and `openProviderDialog()` sets four of them at once, so
 * without the override the button would show the previous provider's settings.
 *
 * Without JavaScript nothing is hidden and the checkboxes work as they always
 * did.
 *
 * ## Clicks
 *
 * The markup is `<label><input><span>text</span></label>`, and a label forwards
 * its clicks to the control it labels — which is still what we want for the
 * text. The button therefore stops its own click from bubbling: without that,
 * one press would toggle the input directly *and* be forwarded by the label
 * around it, landing back where it started.
 */

const ENHANCED = 'data-switch';

/** Replace one checkbox with a switch. Idempotent. */
export function enhanceSwitch(input: HTMLInputElement): void {
  if (input.type !== 'checkbox' || input.hasAttribute(ENHANCED)) return;
  input.setAttribute(ENHANCED, '');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toggle';
  button.setAttribute('role', 'switch');
  button.append(document.createElement('span'));

  /* The caption beside it. The button is built here and has no text of its
     own, so the name has to come off the label that wraps them both. */
  const caption = input.closest('label')?.textContent?.trim();
  if (caption) button.setAttribute('aria-label', caption);

  const sync = () => {
    button.setAttribute('aria-checked', String(input.checked));
    button.disabled = input.disabled;
  };

  button.addEventListener('click', event => {
    /* See the header: the label around this would otherwise forward the same
       click to the input and undo the line below. */
    event.preventDefault();
    event.stopPropagation();
    if (input.disabled) return;
    input.checked = !input.checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  /* Everything that is not this button: the label text, and any script that
     dispatches a change rather than assigning the property. */
  input.addEventListener('change', sync);

  /* A property assignment fires nothing, and the screens do assign it. */
  const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
  if (native?.get && native.set) {
    Object.defineProperty(input, 'checked', {
      configurable: true,
      get: () => native.get!.call(input),
      set: (value: boolean) => {
        native.set!.call(input, value);
        sync();
      },
    });
  }

  input.after(button);
  input.classList.add('switch-native');
  sync();
}

/**
 * Enhance every switch on the screen, and keep doing it after each navigation.
 *
 * Same shape as `mountSelects()` and mounted from the same place: idempotent by
 * attribute, so the repeat visits `<ClientRouter />` produces cost one
 * `querySelectorAll`.
 */
export function mountSwitches(): void {
  const run = () => {
    /* Every checkbox, not an opt-in class: the point is that this surface has
       one switch and not two controls that mean the same thing, and an opt-in
       is a thing to forget the next time a field is added. `data-plain` is the
       way out for a checkbox that genuinely wants to be one — a row of them in
       a list, where four switches would read as four settings. */
    document
      .querySelectorAll<HTMLInputElement>(
        `input[type='checkbox']:not([data-plain]):not([${ENHANCED}])`,
      )
      .forEach(enhanceSwitch);
  };

  run();
  document.addEventListener('astro:page-load', run);
}
