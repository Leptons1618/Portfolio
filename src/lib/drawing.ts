/**
 * Excalidraw on the admin, a plain SVG for readers — decision 82.
 *
 * Decision 25 made a diagram an image file rather than a renderer on every
 * page, and paid for it in one way: the Mermaid source is not kept, so editing
 * a diagram means generating a new one. This keeps the image-file half and
 * removes the cost. Excalidraw can **embed its scene in the SVG it exports**
 * (`exportEmbedScene`), and `loadFromBlob()` reads that scene back out of the
 * same file. So the one file in the `media` table is both what a reader's
 * `<img>` shows and what the editor reopens — no table, no second file, no
 * new media type, and nothing on a public page.
 *
 * ## Loading
 *
 * React, ReactDOM and Excalidraw are several megabytes. They are imported
 * inside `openDrawing()`, and this module is itself only ever reached through
 * a dynamic `import()` — `check:content` fails the build otherwise — so none
 * of it is in the admin bundle until a Draw button is pressed, and none of it
 * can reach a public page. While editing, Excalidraw fetches its fonts from its
 * own CDN; the exported SVG embeds the glyphs it used, so a reader's `<img>`
 * fetches nothing.
 *
 * Excalidraw's stylesheet is imported as a string and put *inside the dialog*,
 * not left as the `<link>` Vite would add to `<head>`: the admin's
 * `ClientRouter` replaces the head on every navigation, Vite never adds a
 * preloaded stylesheet twice, and the second drawing of a session would open
 * unstyled.
 *
 * ## The dialog, and why it is not modal
 *
 * One full-screen `<dialog>` per document, built lazily and rebuilt when a
 * `ClientRouter` swap has taken it out of the body — the arrangement
 * `media-library.ts` uses. It is opened with `show()`, **not** `showModal()`:
 * Excalidraw puts its own dialogs (help, export, the reset confirmation) and
 * its tooltips in containers appended to `<body>`, and anything outside the
 * top layer is drawn beneath a modal and cannot be clicked. So it is a fixed
 * overlay at a z-index under Excalidraw's own modal layer (1000), and the page
 * behind it is made `inert` by hand for as long as it is open. A non-modal
 * dialog also leaves Escape to Excalidraw, which uses it to clear a selection.
 *
 * Cancel works from the moment the dialog appears — a chunk that fails to load
 * must not leave a full-screen overlay nobody can dismiss — and one session at
 * a time: a second Draw press while one is open gets the open one.
 */

import { getToken } from './github';
import { putMedia } from './image-upload';
import { MAX_MEDIA_BYTES } from './media';
import { DRAWING_DIR, drawingName } from './md-edit';

export interface DrawingOptions {
  /** A `/media/images/drawings/*.svg` to reopen. Anything else is ignored. */
  src?: string;
  /** The file stem it is saved under; the same stem overwrites it. */
  name: string;
}

let dialog: HTMLDialogElement | null = null;
let session: Promise<string | null> | null = null;

function build(): HTMLDialogElement {
  const root = document.createElement('dialog');
  root.className = 'drawing';
  root.setAttribute('aria-label', 'Drawing');

  const style = document.createElement('style');
  style.className = 'drawing-style';

  const bar = document.createElement('div');
  bar.className = 'drawing-bar';

  const title = document.createElement('strong');
  title.className = 'drawing-title';
  title.textContent = 'Drawing';

  const status = document.createElement('span');
  status.className = 'drawing-status';
  status.setAttribute('role', 'status');

  /* Mermaid in, shapes out — for the assistant's `/draw-diagram` source, or
     any diagram already written as text, to be tidied by hand rather than
     regenerated. */
  const mermaid = document.createElement('details');
  mermaid.className = 'drawing-mermaid';
  const summary = document.createElement('summary');
  summary.className = 'btn btn-secondary btn-sm';
  summary.textContent = 'From Mermaid';
  const source = document.createElement('textarea');
  source.className = 'input drawing-mermaid-source';
  source.placeholder = 'flowchart LR\n  A[Client] --> B[API]';
  source.spellcheck = false;
  const convert = document.createElement('button');
  convert.type = 'button';
  convert.className = 'btn btn-secondary btn-sm';
  convert.dataset.act = 'convert';
  convert.textContent = 'Add to drawing';
  const pop = document.createElement('div');
  pop.className = 'drawing-mermaid-pop';
  pop.append(source, convert);
  mermaid.append(summary, pop);

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-secondary btn-sm';
  cancel.dataset.act = 'cancel';
  cancel.textContent = 'Cancel';

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn btn-primary btn-sm';
  save.dataset.act = 'save';
  save.textContent = 'Save drawing';

  bar.append(title, status, mermaid, cancel, save);

  const canvas = document.createElement('div');
  canvas.className = 'drawing-canvas';

  root.append(style, bar, canvas);
  document.body.append(root);
  return root;
}

/** A number that changes whenever any element does — enough to know "edited". */
const versionOf = (elements: readonly { version: number }[]) =>
  elements.reduce((sum, element) => sum + element.version, 0);

/**
 * Open the editor. Resolves with the saved drawing's `/media/…` URL, or
 * `null` when the author cancelled or the editor could not load. A second
 * call while one is open returns the open one.
 */
export function openDrawing(options: DrawingOptions): Promise<string | null> {
  session ??= run(options).finally(() => {
    session = null;
  });
  return session;
}

async function run(options: DrawingOptions): Promise<string | null> {
  if (!dialog?.isConnected) dialog = build();
  const host = dialog;
  const status = host.querySelector<HTMLElement>('.drawing-status')!;
  const canvas = host.querySelector<HTMLElement>('.drawing-canvas')!;
  const buttons = host.querySelectorAll<HTMLButtonElement>('.drawing-bar button');
  const say = (text: string, tone: 'info' | 'error' = 'info') => {
    status.textContent = text;
    status.dataset.tone = tone;
  };

  /* Only a drawing is reopened: the field this came from is free text, and
     what it names is fetched. */
  const src = options.src && drawingName(options.src) ? options.src.trim() : undefined;

  /* Everything behind the overlay leaves the focus order and the pointer's
     reach; Excalidraw's own containers, appended later, are not touched. */
  const frozen = [...document.body.children].filter(
    (node): node is HTMLElement => node instanceof HTMLElement && node !== host && !node.inert,
  );
  frozen.forEach(node => (node.inert = true));

  say('Loading the editor…');
  canvas.replaceChildren();
  buttons.forEach(button => (button.disabled = false));
  host.show();

  type Api = {
    getSceneElements(): readonly { version: number }[];
    getAppState(): Record<string, unknown>;
    getFiles(): Record<string, unknown>;
    updateScene(scene: { elements: readonly unknown[] }): void;
    addFiles(files: unknown[]): void;
    scrollToContent(target?: readonly unknown[], options?: { fitToContent?: boolean }): void;
  };
  let api: Api | null = null;
  let unmount: (() => void) | null = null;
  let baseline = 0;
  let current = 0;
  let saving = false;

  return new Promise<string | null>(resolve => {
    let settled = false;
    const finish = (url: string | null) => {
      if (settled) return;
      settled = true;
      host.removeEventListener('click', onClick);
      unmount?.();
      canvas.replaceChildren();
      host.close();
      frozen.forEach(node => (node.inert = false));
      resolve(url);
    };

    async function onClick(event: MouseEvent) {
      const act = (event.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (!act || saving) return;

      if (act === 'cancel') {
        if (current !== baseline && !confirm('Discard the changes to this drawing?')) return;
        finish(null);
        return;
      }
      if (!api) return;
      const editor = api;

      if (act === 'convert') {
        const field = host.querySelector<HTMLTextAreaElement>('.drawing-mermaid-source')!;
        if (!field.value.trim()) return;
        try {
          const [{ parseMermaidToExcalidraw }, { convertToExcalidrawElements }] = await Promise.all([
            import('@excalidraw/mermaid-to-excalidraw'),
            import('@excalidraw/excalidraw'),
          ]);
          const parsed = await parseMermaidToExcalidraw(field.value);
          const added = convertToExcalidrawElements(parsed.elements);
          editor.updateScene({ elements: [...editor.getSceneElements(), ...added] });
          if (parsed.files) editor.addFiles(Object.values(parsed.files));
          editor.scrollToContent(added, { fitToContent: true });
          host.querySelector<HTMLDetailsElement>('.drawing-mermaid')!.open = false;
          say('Converted — the shapes are yours to move now.');
        } catch (error) {
          say(`That Mermaid will not convert: ${error instanceof Error ? error.message.split('\n')[0] : error}`, 'error');
        }
        return;
      }

      if (act === 'save') {
        const elements = editor.getSceneElements();
        if (!elements.length) {
          say('There is nothing drawn to save.', 'error');
          return;
        }
        if (!getToken()) {
          say('Saving writes to the site, so it needs a session. Sign in from the rail.', 'error');
          return;
        }
        /* Both buttons wait for the write: a Cancel pressed mid-upload would
           report "discarded" while the bytes went on to replace the drawing. */
        saving = true;
        buttons.forEach(button => (button.disabled = true));
        say('Saving…');
        try {
          const { exportToSvg } = await import('@excalidraw/excalidraw');
          const svg = await exportToSvg({
            elements: elements as Parameters<typeof exportToSvg>[0]['elements'],
            files: editor.getFiles() as Parameters<typeof exportToSvg>[0]['files'],
            appState: {
              ...(editor.getAppState() as Parameters<typeof exportToSvg>[0]['appState']),
              exportEmbedScene: true,
              exportBackground: true,
              viewBackgroundColor: '#ffffff',
              exportWithDarkMode: false,
            },
            exportPadding: 16,
          });
          const text = new XMLSerializer().serializeToString(svg);
          const bytes = new Blob([text]).size;
          if (bytes > MAX_MEDIA_BYTES) {
            say(
              `This drawing is ${(bytes / 1024 / 1024).toFixed(1)} MB with its scene embedded — over the ` +
                `${(MAX_MEDIA_BYTES / 1024 / 1024).toFixed(1)} MB limit. A pasted photo is the usual cause; remove it or shrink it.`,
              'error',
            );
            return;
          }
          const file = new File([text], `${options.name}.svg`, { type: 'image/svg+xml' });
          finish(await putMedia(file, DRAWING_DIR, options.name));
        } catch (error) {
          say(error instanceof Error ? error.message : 'Saving failed.', 'error');
        } finally {
          saving = false;
          buttons.forEach(button => (button.disabled = false));
        }
      }
    }

    /* Listening before anything loads, so Cancel works while it does. */
    host.addEventListener('click', onClick);

    void (async () => {
      try {
        const [React, ReactDOM, excalidraw, css] = await Promise.all([
          import('react'),
          import('react-dom/client'),
          import('@excalidraw/excalidraw'),
          import('@excalidraw/excalidraw/index.css?inline'),
        ]);
        if (settled) return;
        host.querySelector('.drawing-style')!.textContent = css.default;

        /* Reopening: the scene is inside the SVG. An image this editor did not
           export carries none, and the author gets a blank canvas and a
           sentence saying why. */
        let initial: Awaited<ReturnType<typeof excalidraw.loadFromBlob>> | null = null;
        if (src) {
          try {
            const response = await fetch(src, { cache: 'no-store' });
            if (!response.ok) throw new Error(`${response.status}`);
            initial = await excalidraw.loadFromBlob(await response.blob(), null, null);
          } catch {
            say('That image carries no drawing to reopen — this is a new one, saved over it.', 'error');
          }
        }
        if (settled) return;

        baseline = current = initial?.elements ? versionOf(initial.elements) : 0;
        const root = ReactDOM.createRoot(canvas);
        unmount = () => root.unmount();
        root.render(
          React.createElement(excalidraw.Excalidraw, {
            excalidrawAPI: ready => {
              api = ready as unknown as Api;
            },
            initialData: initial
              ? { elements: initial.elements, files: initial.files, appState: { viewBackgroundColor: '#ffffff' }, scrollToContent: true }
              : { appState: { viewBackgroundColor: '#ffffff' } },
            onChange: elements => {
              current = versionOf(elements);
            },
          }),
        );
        if (!src) say('');
        else if (initial) say('Editing the saved drawing — saving replaces it everywhere it is shown.');
      } catch (error) {
        /* A chunk that would not load: say so, and leave Cancel as the way out
           rather than a dead full-screen overlay. */
        say(`The editor did not load: ${error instanceof Error ? error.message : error}. Cancel and try again.`, 'error');
      }
    })();
  });
}
