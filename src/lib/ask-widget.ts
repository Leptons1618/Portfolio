/**
 * The public assistant's behaviour, loaded lazily — see `AskWidget.astro`.
 *
 * The widget's markup is server-rendered on every public page (cheap HTML that
 * starts hidden), but this module — and the stylesheet below — are fetched only
 * after `/api/ai/status` says the assistant is switched on, and only once the
 * main thread is idle. That keeps ~85KB of CSS and the whole chat client off
 * the critical path of pages the assistant never appears on.
 *
 * Contract: the tiny loader in `AskWidget.astro` checks the status (cached per
 * session), injects the stylesheet via `ensureAskStyles()`, then calls
 * `mountAskWidget(status)` with an enabled status. The launcher unhides inside
 * `mountAskWidget`, so nothing ever appears unwired or unstyled.
 */
import askWidgetCssUrl from '../styles/ask-widget.css?url';
import {
  ago,
  fileTurns,
  forgetChat,
  newChatId,
  readChats,
  readCurrent,
  rememberCurrent,
  titleFor,
  upsertChat,
  writeChats,
  type AskStoredChat,
  type AskStoredTurn,
  type AskStore,
} from './ask-history';

/** What `/api/ai/status` reports: the switch, the greeting, and the limits. */
export interface AskStatus {
  enabled: boolean;
  greeting: string;
  suggestions: string[];
  maxQuestionChars: number;
  /** Questions this visitor has left right now. Absent on an older cached status. */
  remaining?: number;
  /** The per-visitor hourly ceiling `remaining` is measured against. */
  perIpPerHour?: number;
}

/**
 * Inject the widget stylesheet, once. Awaiting it before unhiding is what keeps
 * the launcher from flashing unstyled; the timeout is what keeps a failed
 * stylesheet from stranding the launcher forever.
 */
let askStylesPromise: Promise<void> | null = null;

export function ensureAskStyles(): Promise<void> {
  if (askStylesPromise) return askStylesPromise;
  askStylesPromise = new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = askWidgetCssUrl;
    link.onload = finish;
    link.onerror = finish;
    document.head.append(link);
    window.setTimeout(finish, 2000);
  });
  return askStylesPromise;
}

/**
 * Wire up the server-rendered widget. `status` is already known-enabled —
 * checking it again here would cost the session-cache read for nothing.
 */
export function mountAskWidget(status: AskStatus): void {
  /* No `onAdminPage` here: public pages are plain MPA, so this module is
     evaluated once per document load and there is no persisted DOM to guard
     against. */
  const mounted = document.getElementById('ask-root');
  if (mounted) {
    /* Aliased to a definitely-non-null const: the hoisted function declarations
       below close over it, and TypeScript will not carry a narrowing into a
       hoisted declaration — it has to assume the function could be called
       before the check ran. */
    const root: HTMLElement = mounted;
    const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

    const launcher = $<HTMLButtonElement>('ask-launcher');
    const panel = $('ask-panel');
    const log = $('ask-log');
    const form = $<HTMLFormElement>('ask-form');
    const input = $<HTMLTextAreaElement>('ask-input');
    const send = $<HTMLButtonElement>('ask-send');
    const suggestions = $('ask-suggestions');
    const leftNote = document.getElementById('ask-left');

    /**
     * How many questions are left, counted down locally as they are spent.
     *
     * Seeded from `/api/ai/status` and decremented here rather than re-fetched
     * per answer: the number only ever moves one way within a session, and a
     * request to find out how many requests remain is a poor trade. It can
     * drift low if the same visitor is asking from two tabs, which is the safe
     * direction — the limiter is the authority and refuses with its own copy.
     *
     * Hidden entirely while unknown, and while there is plenty left: a counter
     * on every question reads as a meter running down, which is not the
     * feeling a portfolio wants. It appears at five.
     */
    let left = typeof status.remaining === 'number' ? status.remaining : null;

    function drawLeft(): void {
      if (!leftNote) return;
      if (left === null || left > 5) {
        leftNote.hidden = true;
        return;
      }
      leftNote.hidden = false;
      leftNote.textContent =
        left <= 0
          ? ' You have used your questions for this hour.'
          : ` ${left} question${left === 1 ? '' : 's'} left this hour.`;
    }
    const grip = $<HTMLButtonElement>('ask-grip');

    const SIZE_KEY = 'om-ask-size';

    /* — rendering —

       Every node here is created and filled with `textContent`. The one place
       that would be tempting to shortcut is the answer, which arrives as
       markdown-ish prose from a model — and that is precisely the string that
       must never reach a parser. */

    type Role = 'user' | 'assistant';

    function bubble(role: Role): HTMLElement {
      const wrap = document.createElement('div');
      wrap.className = 'ask-turn';
      wrap.dataset.role = role;
      const body = document.createElement('div');
      body.className = 'ask-bubble';
      wrap.append(body);
      log.append(wrap);
      log.scrollTop = log.scrollHeight;
      return body;
    }

    /**
     * A deliberately small markdown pass: paragraphs, bullets, bold, code, and
     * links **only to this site**.
     *
     * The link restriction is the interesting rule. The model is instructed to
     * cite pages by path, and a path is safe to turn into an anchor. An
     * absolute URL is not — a model that has been talked into emitting one
     * would otherwise get a clickable link out of this site, rendered in the
     * site's own chrome, which is a phishing primitive rather than a feature.
     * So anything that is not a same-origin path stays as text.
     */
    function renderAnswer(target: HTMLElement, text: string) {
      target.replaceChildren();

      for (const block of text.split(/\n{2,}/)) {
        const trimmed = block.trim();
        if (!trimmed) continue;

        if (/^[-*]\s/m.test(trimmed)) {
          const ul = document.createElement('ul');
          for (const line of trimmed.split('\n')) {
            const item = line.replace(/^\s*[-*]\s+/, '').trim();
            if (!item) continue;
            const li = document.createElement('li');
            inline(li, item);
            ul.append(li);
          }
          target.append(ul);
          continue;
        }

        const p = document.createElement('p');
        inline(p, trimmed.replace(/\n/g, ' '));
        target.append(p);
      }
    }

    /** Bold, inline code, and site-relative links — as elements, never markup. */
    function inline(parent: HTMLElement, text: string) {
      const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((\/[^)\s]*)\)|(\/(?:projects|case-studies|journal|about|resume)\/?[a-z0-9-]*)/g;
      let last = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) {
          parent.append(document.createTextNode(text.slice(last, match.index)));
        }
        if (match[1] !== undefined) {
          const strong = document.createElement('strong');
          strong.textContent = match[1];
          parent.append(strong);
        } else if (match[2] !== undefined) {
          const code = document.createElement('code');
          code.textContent = match[2];
          parent.append(code);
        } else if (match[3] !== undefined && match[4] !== undefined) {
          const a = document.createElement('a');
          /* Assigning `href` with a value that begins `/` cannot become another
             scheme; the regex above is what guarantees it begins `/`. */
          a.href = match[4];
          a.textContent = match[3];
          parent.append(a);
        } else if (match[5] !== undefined) {
          const a = document.createElement('a');
          a.href = match[5];
          a.textContent = match[5];
          parent.append(a);
        }
        last = pattern.lastIndex;
      }

      if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
    }

    function note(text: string, tone: 'info' | 'error' = 'info', retry?: () => void) {
      const p = document.createElement('p');
      p.className = 'ask-note';
      p.dataset.tone = tone;

      const words = document.createElement('span');
      words.textContent = text;
      p.append(words);

      /* `ask()` empties the field before it sends, so a failure used to leave a
         red sentence and nothing to act on — the question was gone and the only
         way back was to remember it and retype it. */
      if (retry) {
        const again = document.createElement('button');
        again.type = 'button';
        again.className = 'ask-retry';
        again.textContent = 'Try again';
        again.addEventListener('click', () => {
          p.remove();
          retry();
        });
        p.append(again);
      }

      log.append(p);
      log.scrollTop = log.scrollHeight;
    }

    /**
     * The wait, as a labelled row rather than an ellipsis.
     *
     * Two states share this element and the label is the whole difference:
     * WAITING means the request is out and nothing has come back, THINKING
     * means `{"thinking":…}` frames are arriving and the delay is the model
     * deliberating rather than the network.
     *
     * What it is thinking goes into the disclosure below, never into the
     * answer — see the header of `src/lib/ai.ts`. This row only says which
     * kind of wait a reader is looking at.
     */
    function waiting(label: string): HTMLElement {
      const wrap = document.createElement('div');
      wrap.className = 'ask-wait';

      const text = document.createElement('span');
      text.className = 'ask-wait-label';
      text.textContent = label;

      const dots = document.createElement('span');
      dots.className = 'ask-dots';
      dots.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 3; i += 1) dots.append(document.createElement('i'));

      wrap.append(text, dots);
      return wrap;
    }

    /**
     * The model's deliberation, behind a disclosure above the answer.
     *
     * Reasoning used to be dropped at the Worker and the panel showed the word
     * THINKING and nothing else. It is forwarded now, in its own
     * `{"thinking":…}` frame, and it lands **here** — a closed `<details>`
     * above the answer, never in the prose. That is the whole arrangement: the
     * answer is what the bubble says, and the thinking is something a reader
     * can open if they want to know how it got there.
     *
     * `<details>` rather than a button and a class, because the disclosure, the
     * keyboard behaviour and the closed content leaving the focus order are all
     * the element's job. Created on the first thinking frame — a model that does
     * not deliberate leaves no empty box behind.
     *
     * It opens itself while the thinking is the only thing happening, and
     * `settleThought()` closes it again when the answer starts. A model that
     * deliberates for twenty seconds behind a closed box is indistinguishable
     * from one that has hung, and "nothing is happening" is the single most
     * common reading of a stream that has not produced a word yet. A reader who
     * touches the disclosure pins it: `data-pinned` is set on the first click
     * and nothing programmatic moves it after that.
     */
    function thoughtBox(target: HTMLElement): HTMLElement {
      const existing = target.querySelector<HTMLElement>('.ask-think-body');
      if (existing) return existing;

      const box = document.createElement('details');
      box.className = 'ask-think';
      box.open = true;

      const summary = document.createElement('summary');
      summary.className = 'ask-think-summary';
      summary.textContent = 'Thinking';
      /* On the summary rather than the `toggle` event, which also fires for the
         two assignments above and below and would pin the box against itself. */
      summary.addEventListener('click', () => {
        box.dataset.pinned = '';
      });
      box.append(summary);

      const body = document.createElement('div');
      body.className = 'ask-think-body';
      box.append(body);

      /* Above the answer, and before anything already in the bubble — the wait
         row and the answer are both appended, so a first thinking frame that
         arrives after them still reads top to bottom. */
      target.prepend(box);
      return body;
    }

    /**
     * Close the disclosure and label it, once the thinking is no longer the news.
     *
     * Called when the first token of the answer arrives and again when the
     * stream ends, because a reply that is *only* thinking never reaches the
     * first case and would otherwise be left with a live-looking box.
     *
     * A reader who opened or closed it themselves has pinned it, and this does
     * not argue with them.
     */
    function settleThought(target: HTMLElement, thinking: string): void {
      const box = target.querySelector<HTMLDetailsElement>('.ask-think');
      if (!box) return;
      const summary = box.querySelector('.ask-think-summary');
      if (summary) summary.textContent = `Thinking · ${thinking.length.toLocaleString()} characters`;
      if (!('pinned' in box.dataset)) box.open = false;
    }

    /** One lookup, as `/api/ai/chat` reports it. Two frames per call, by `id`. */
    interface ToolFrame {
      id: string;
      name: string;
      args?: Record<string, unknown>;
      status: 'running' | 'done' | 'error';
      detail?: string;
    }

    /**
     * The tool names, in words a visitor reads rather than function names.
     *
     * A public panel is not a terminal: `read_post` is precise and `Reading
     * post` is what a person understands, and the mapping costs one object. An
     * unmapped name falls through verbatim, which is the right failure for a
     * tool added to the table and not to this list.
     */
    const LOOKUP_LABELS: Record<string, string> = {
      search_content: 'Searching',
      read_post: 'Reading post',
      read_project: 'Reading project',
      read_case_study: 'Reading case study',
      read_resume: 'Reading background',
    };

    /**
     * What the assistant looked up, as a line per lookup.
     *
     * The answer is generated from an *index* of this site plus whatever the
     * model fetches while writing — `/api/ai/chat` explains why. That makes a
     * lookup the visible half of the wait: four seconds of silence with nothing
     * on screen reads as a broken widget, and four seconds with `read_post ·
     * thundering-herd` on screen reads as the thing working.
     *
     * It is also the honest disclosure. This panel already tells a reader it is
     * a language model reading published pages; showing *which* pages it read
     * for this answer is that sentence made specific, and it is the one thing a
     * reader can check the answer against.
     *
     * Every row is `textContent`. The tool's name comes from this repository,
     * but its arguments are a model's own JSON.
     */
    function toolRow(target: HTMLElement, frame: ToolFrame): void {
      let trail = target.querySelector<HTMLElement>('.ask-tools');
      if (!trail) {
        trail = document.createElement('div');
        trail.className = 'ask-tools';
        /* Under the thinking disclosure and above everything else, which is the
           order things happened in. `thoughtBox` prepends, so appending after a
           prepend puts this second. */
        const think = target.querySelector('.ask-think');
        if (think) think.after(trail);
        else target.prepend(trail);
      }

      let row = trail.querySelector<HTMLElement>(`[data-call="${CSS.escape(frame.id)}"]`);
      if (!row) {
        row = document.createElement('div');
        row.className = 'ask-tool';
        row.dataset.call = frame.id;

        const name = document.createElement('span');
        name.className = 'ask-tool-name';
        name.textContent = LOOKUP_LABELS[frame.name] ?? frame.name;

        const args = document.createElement('span');
        args.className = 'ask-tool-args';

        const state = document.createElement('span');
        state.className = 'ask-tool-state';

        row.append(name, args, state);
        trail.append(row);
      }

      row.dataset.status = frame.status;

      if (frame.args) {
        const args = row.querySelector('.ask-tool-args');
        /* The values only. A visitor does not need to read `slug:` — they need
           to see *which post*, and the tool's own name already said what kind
           of thing it is. */
        if (args) args.textContent = Object.values(frame.args).filter(v => typeof v === 'string').join(' · ');
      }

      const state = row.querySelector('.ask-tool-state');
      if (state) state.textContent = frame.status === 'running' ? 'reading…' : (frame.detail ?? '');
    }

    /**
     * The pages an answer named, as links under it.
     *
     * The corpus gives every entry a `- Page: /projects/x` line and rule 7 of
     * the scope prompt asks for the path to be quoted, so a grounded answer
     * already says where it came from — this only lifts those paths out of the
     * prose and puts them where a reader can act on them.
     *
     * The pattern is anchored on a leading slash and a closed set of section
     * names, which is what makes assigning `href` safe: it cannot produce
     * another scheme, the same guarantee `inline()` above relies on. An answer
     * naming no page gets no row rather than an empty one.
     */
    const CITED = /\/(?:projects|case-studies|journal|about|resume)(?:\/[a-z0-9-]+)?/g;

    function citations(target: HTMLElement, text: string) {
      const paths = [...new Set(text.match(CITED) ?? [])].slice(0, 5);
      if (!paths.length) return;

      const row = document.createElement('div');
      row.className = 'ask-cites';

      const label = document.createElement('span');
      label.className = 'ask-cites-label';
      label.textContent = paths.length === 1 ? 'Page' : 'Pages';
      row.append(label);

      for (const path of paths) {
        const link = document.createElement('a');
        link.href = path;
        link.className = 'ask-cite';
        link.textContent = path;
        row.append(link);
      }

      target.append(row);
    }

    /* — browser history —

       Past conversations, kept in this browser and nowhere else — the shape
       and the caps live in `src/lib/ask-history.ts`, which is also where the
       tests pin them. What stays here is the shelf itself: `localStorage`
       where the browser allows it, a `Map` for the page where it does not.
       Referencing `localStorage` can itself throw where storage is blocked,
       so even the reference sits behind the guard. */

    const memory = new Map<string, string>();
    const memoryStore: AskStore = {
      getItem: key => memory.get(key) ?? null,
      setItem: (key, value) => {
        memory.set(key, value);
      },
      removeItem: key => {
        memory.delete(key);
      },
    };
    let store: AskStore = memoryStore;
    try {
      void localStorage.length;
      store = localStorage;
    } catch {
      /* Memory-only for the page. Nothing else changes. */
    }

    /* — conversation —

       The live transcript, posted with every question. Filed per conversation
       in the store above once an exchange completes, so threads survive pages
       and reloads. The server holds no text at all — the rate-limit table
       counts requests against a salted hash. */
    const history: { role: Role; content: string }[] = [];
    let chatId: string | null = null;
    let busy = false;
    let inFlight: AbortController | null = null;
    /* Which `ask()` run the in-flight request belongs to. Switching threads
       aborts it, and the abort's own catch must then stand down rather than
       popping a turn off the transcript just loaded — see `showTranscript`. */
    let askSeq = 0;
    /* Whether the visitor stopped the answer or the panel closed under it. Both
       arrive as the same `AbortError` and they want opposite outcomes: a
       deliberate stop keeps what was written, a closed panel throws it away. */
    let stopped = false;

    async function ask(question: string) {
      if (busy || !question.trim()) return;
      busy = true;
      stopped = false;
      askSeq += 1;
      const seq = askSeq;
      /* Not `disabled`: while an answer streams this button is the Stop
          control, so it has to stay pressable. `data-busy` swaps which of its
          two inlined icons paints — cross-fading, not toggling — and names
          the button for what a press will now do. */
      send.dataset.busy = '';
      send.setAttribute('aria-label', 'Stop');

      history.push({ role: 'user', content: question });
      bubble('user').textContent = question;
      suggestions.hidden = true;

      /* Spent on the way out, matching `charge()` — which counts before the
         model is called and does not refund a failed one. A local count that
         only decremented on success would drift *above* the server's and
         promise questions the limiter has already taken. */
      if (left !== null) left = Math.max(0, left - 1);
      drawLeft();

      const target = bubble('assistant');
      target.dataset.state = 'waiting';
      /* Three children, in this order: the thinking disclosure (added by
         `thoughtBox` if the model deliberates), the wait row, and the answer.
         `renderAnswer` replaces the children of the *answer* element rather
         than of the bubble, which is what lets a disclosure survive every
         repaint of a streaming reply. */
      const wait = waiting('Waiting');
      const answerEl = document.createElement('div');
      answerEl.className = 'ask-answer';
      target.replaceChildren(wait, answerEl);

      inFlight = new AbortController();
      let answer = '';
      let thinking = '';
      /* From the `done` frame's `stopReason`. `length` means the answer ran
         into the site's output ceiling rather than finishing — which reads as
         a model that stopped mid-sentence for no reason, and is the one
         failure here a visitor can do something about by asking for less. */
      let truncated = false;

      try {
        const response = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history }),
          signal: inFlight.signal,
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? 'The assistant could not answer.');
        }
        if (!response.body) throw new Error('The assistant returned nothing.');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          /* The tail is almost always a half-received JSON object; keeping it
             for the next chunk is the difference between smooth text and a
             model that appears to stutter. */
          buffer = lines.pop() ?? '';

          for (const raw of lines) {
            if (!raw.trim()) continue;
            let frame: {
              delta?: string;
              thinking?: string;
              tool?: ToolFrame;
              error?: string;
              done?: boolean;
              stopReason?: string;
            };
            try {
              frame = JSON.parse(raw);
            } catch {
              continue;
            }
            if (frame.error) throw new Error(frame.error);
            /* The model is deliberating. It goes into the disclosure as it
               arrives, and the wait row says which kind of wait this is — but
               only while the answer is still empty, because a model that thinks
               again mid-sentence must not relabel a reply already on screen. */
            if (frame.thinking) {
              thinking += frame.thinking;
              const thoughts = thoughtBox(target);
              thoughts.textContent = thinking;
              /* Pinned to the bottom, like the log itself. A disclosure that
                 shows the first two lines of a growing wall of text is a box
                 that stopped updating, as far as anyone watching can tell. */
              thoughts.scrollTop = thoughts.scrollHeight;
              if (!answer) {
                target.dataset.state = 'thinking';
                const label = wait.querySelector('.ask-wait-label');
                if (label) label.textContent = 'Thinking';
              }
            }
            /* A lookup. It gets its own row above the answer and relabels the
               wait, because "Reading post" is a far better account of a
               four-second pause than three animated dots. */
            if (frame.tool) {
              toolRow(target, frame.tool);
              if (!answer) {
                target.dataset.state = 'looking';
                const label = wait.querySelector('.ask-wait-label');
                if (label) label.textContent = 'Looking things up';
                /* The model stopped deliberating the moment it decided to
                   fetch something; leaving the box open would have it claim to
                   still be thinking underneath a list of lookups. */
                settleThought(target, thinking);
              }
            }
            if (frame.delta) {
              answer += frame.delta;
              target.dataset.state = 'streaming';
              wait.remove();
              /* The answer is the thing to read now. The thinking stays, one
                 click away, with the summary saying how much of it there is. */
              settleThought(target, thinking);
              renderAnswer(answerEl, answer);
              log.scrollTop = log.scrollHeight;
            }
            if (frame.done) truncated = frame.stopReason === 'length';
          }
        }

        wait.remove();
        settleThought(target, thinking);

        /* Deliberately not the editor's version of this message: a visitor is
           owed "it did not work, try again", not a note about which model the
           owner configured and what its token ceiling is.

           Unless it *did* say something, to itself. A model that narrated its
           whole way through the budget without answering used to print that
           narration as the answer; now it is in the disclosure, and the honest
           report is that there is no answer and where the words went. The
           bubbles stay so the thinking is still readable, but the turn is
           dropped from `history` — there was no answer for a follow-up to
           follow. */
        if (!answer.trim()) {
          if (!thinking.trim()) throw new Error('The assistant had nothing to say. Please try again.');
          target.dataset.state = 'done';
          history.pop();
          note(
            'The model spent the whole answer thinking and never wrote one. Open Thinking to read what it worked through, or ask again.',
            'error',
            () => void ask(question),
          );
          return;
        }

        target.dataset.state = 'done';
        citations(target, answer);
        history.push({ role: 'assistant', content: answer });
        persistChat();
        /* After the citations, so it reads as a footnote on the answer rather
           than as part of it. A note rather than a toast: it qualifies what is
           on screen, and it has to stay beside it. */
        if (truncated) {
          note('That answer hit the length limit and stopped early — ask for a narrower slice of it and it will fit.');
        }
      } catch (error) {
        /* Left for another thread while this was out — its transcript has
           already been replaced, so there is nothing to settle. `finally`
           below still runs, which is harmless: the new thread set the same
           flags on its way in. */
        if (seq !== askSeq) return;
        if (error instanceof DOMException && error.name === 'AbortError') {
          if (stopped && answer.trim()) {
            /* Stopped on purpose, with something already on screen. Keeping it
               is the entire point of a Stop button — the visitor read as much
               as they wanted and said so. It goes into `history` too, or the
               follow-up would be answered against a turn the model does not
               know it gave. */
            target.dataset.state = 'done';
            wait.remove();
            renderAnswer(answerEl, answer);
            citations(target, answer);
            history.push({ role: 'assistant', content: answer });
            persistChat();
          } else {
            /* The panel closed under it, or nothing had arrived yet. The
               half-written bubble goes, and so does the question — leaving it
               would make the next one a follow-up to a turn with no answer. */
            target.closest('.ask-turn')?.remove();
            history.pop();
          }
        } else {
          target.closest('.ask-turn')?.remove();
          /* Drop the question too, so a retry is not counted as a follow-up to
             a turn that never got an answer — `ask()` pushes it again. */
          history.pop();
          note(error instanceof Error ? error.message : 'Something went wrong.', 'error', () => {
            void ask(question);
          });
        }
      } finally {
        busy = false;
        delete send.dataset.busy;
        send.setAttribute('aria-label', 'Send');
        inFlight = null;
        input.focus();
      }
    }

    /* — panel — */

    /** The greeting and the starter chips. Drawn on open, and again on New chat. */
    function drawIntro(status: AskStatus) {
      note(status.greeting);
      drawLeft();
      suggestions.replaceChildren();
      if (!status.suggestions.length) return;
      suggestions.hidden = false;
      for (const text of status.suggestions) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'ask-chip';
        chip.textContent = text;
        chip.addEventListener('click', () => {
          input.value = '';
          void ask(text);
        });
        suggestions.append(chip);
      }
    }

    /**
     * File the live transcript under the current conversation.
     *
     * Once per completed exchange — a finished answer, or a stopped one the
     * visitor kept — never mid-stream and never for a turn that produced
     * nothing. A conversation is created on its first answer, so the store
     * never fills with questions that went nowhere. The title is the first
     * question unless the thread already had a name.
     */
    function persistChat(): void {
      if (!history.length) return;
      if (!chatId) {
        chatId = newChatId();
        rememberCurrent(store, chatId);
      }
      const chats = readChats(store);
      const title = titleFor(history, chats.find(chat => chat.id === chatId)?.title);
      writeChats(
        store,
        upsertChat(chats, { id: chatId, title, updatedAt: Date.now(), turns: fileTurns(history) }),
      );
      if (!historyView.hidden) paintHistory();
    }

    /** Draw turns as finished bubbles — the restore path, so no wait rows, no
        thinking boxes, no retry notes. Citations recompute from the text,
        which is where they came from the first time. */
    function drawTranscript(turns: AskStoredTurn[]): void {
      log.replaceChildren();
      for (const turn of turns) {
        if (turn.role === 'user') {
          bubble('user').textContent = turn.content;
        } else {
          const target = bubble('assistant');
          target.dataset.state = 'done';
          const answerEl = document.createElement('div');
          answerEl.className = 'ask-answer';
          renderAnswer(answerEl, turn.content);
          target.append(answerEl);
          citations(target, turn.content);
        }
      }
      log.scrollTop = log.scrollHeight;
    }

    /**
     * Show a stored conversation, or a fresh one for `null`.
     *
     * The transcript is the *only* thing that carries a follow-up's meaning —
     * `history` is what gets posted, and it grows until the thread is left. So
     * a visitor who has finished one subject and wants to ask about another is
     * paying for the first one on every question, and getting answers coloured
     * by it. Switching is one press, and it is the same press that undoes a
     * conversation that has gone somewhere unhelpful.
     *
     * A switch aborts whatever is streaming: the in-flight turn belongs to the
     * thread being left. Bumping `askSeq` first is what keeps its catch from
     * popping a turn off the transcript just loaded.
     */
    function showTranscript(chat: AskStoredChat | null, status: AskStatus): void {
      inFlight?.abort();
      askSeq += 1;
      busy = false;
      delete send.dataset.busy;
      send.setAttribute('aria-label', 'Send');
      inFlight = null;
      history.length = 0;
      input.value = '';
      input.style.height = '';
      log.replaceChildren();
      if (chat && chat.turns.length) {
        chatId = chat.id;
        rememberCurrent(store, chat.id);
        for (const turn of chat.turns) history.push({ role: turn.role, content: turn.content });
        drawTranscript(chat.turns);
        suggestions.hidden = true;
      } else {
        chatId = null;
        rememberCurrent(store, null);
        drawIntro(status);
      }
      historyView.hidden = true;
      input.focus();
    }

    /* — history view —

       The list behind the header's history button: every stored thread with
       its age and length, the current one marked, each selectable and each
       deletable on its own two-click confirm. Repainted on open and after
       every store write made while it is showing. */

    const historyView = $('ask-history-view');
    const historyList = $('ask-history-list');

    function paintHistory(): void {
      historyList.replaceChildren();
      const chats = readChats(store);
      if (!chats.length) {
        const empty = document.createElement('p');
        empty.className = 'ask-history-empty';
        empty.textContent = 'Nothing yet. Whatever you ask is kept here, in this browser only.';
        historyList.append(empty);
        return;
      }

      let armed: HTMLButtonElement | null = null;
      let disarm: number | undefined;

      for (const chat of chats) {
        const row = document.createElement('div');
        row.className = 'ask-history-row';
        if (chat.id === chatId) row.dataset.current = '';

        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'ask-history-open';
        open.setAttribute('aria-label', `Open conversation: ${chat.title}`);
        const name = document.createElement('span');
        name.className = 'ask-history-name';
        name.textContent = chat.title;
        const meta = document.createElement('span');
        meta.className = 'ask-history-meta';
        meta.textContent =
          [ago(chat.updatedAt), `${chat.turns.length} message${chat.turns.length === 1 ? '' : 's'}`]
            .filter(Boolean)
            .join(' · ');
        open.append(name, meta);
        open.addEventListener('click', () => showTranscript(chat, status));

        /* Two-click confirm, the shape every other delete on this site uses.
           Arming one row disarms nothing else; the timer puts the label back
           if the second press never comes. */
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'ask-history-delete';
        remove.textContent = 'Delete';
        remove.setAttribute('aria-label', `Delete conversation: ${chat.title}`);
        remove.addEventListener('click', () => {
          if (armed !== remove) {
            armed = remove;
            remove.textContent = 'Confirm';
            remove.dataset.armed = '';
            window.clearTimeout(disarm);
            disarm = window.setTimeout(() => {
              if (armed === remove) {
                armed = null;
                remove.textContent = 'Delete';
                delete remove.dataset.armed;
              }
            }, 4000);
            return;
          }
          window.clearTimeout(disarm);
          armed = null;
          writeChats(store, forgetChat(readChats(store), chat.id));
          if (chat.id === chatId) showTranscript(null, status);
          else paintHistory();
        });

        row.append(open, remove);
        historyList.append(row);
      }
    }

    let opened = false;
    /* The close animation's timer, so a re-open during the 150ms exit can
       cancel it instead of being hidden mid-entrance. */
    let hideTimer: number | undefined;

    const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

    function openPanel(status: AskStatus) {
      clearTimeout(hideTimer);
      panel.hidden = false;
      panel.classList.remove('is-closing');
      /* A frame between the display change and the open class, or the browser
         sees both in one style update and never transitions — the same beat
         `.select-menu`'s `.is-open` waits for. */
      requestAnimationFrame(() => {
        requestAnimationFrame(() => panel.classList.add('is-open'));
      });
      launcher.setAttribute('aria-expanded', 'true');
      root.dataset.open = '1';

      if (!opened) {
        opened = true;
        /* Back to the thread left open — across pages and reloads, since
           public navigation rebuilds this widget every time — or the
           greeting when there is none. */
        const previous = readCurrent(store);
        const found = previous && readChats(store).find(chat => chat.id === previous);
        if (found && found.turns.length) showTranscript(found, status);
        else drawIntro(status);
      }
      input.focus();
    }

    function closePanel() {
      const hide = () => {
        panel.hidden = true;
        panel.classList.remove('is-open', 'is-closing');
        /* Revealing the launcher only now, not at the top of `closePanel`:
           the root is a flex column with the launcher above the panel, so an
           early reveal puts the button on top of the still-visible panel and
           drops it into place when the panel leaves. */
        delete root.dataset.open;
      };
      if (REDUCED_MOTION.matches) {
        hide();
      } else {
        panel.classList.remove('is-open');
        panel.classList.add('is-closing');
        /* The CSS exit is 150ms; hiding on its clock rather than waiting for
           an event keeps the two from drifting apart. */
        hideTimer = window.setTimeout(hide, 150);
      }
      launcher.setAttribute('aria-expanded', 'false');
      /* An answer nobody will read is an answer nobody should pay for — the
         server's stream `cancel()` releases the upstream reader, which is what
         actually stops the tokens. */
      inFlight?.abort();
      launcher.focus();
    }

    /* — size —

       Two custom properties on the root rather than inline width and height on
       the panel, and that is not a style preference: the phone breakpoint below
       has to be able to win. An inline `style` beats any stylesheet rule, so a
       panel resized on a desktop and then reloaded on a narrow window would
       ignore the full-screen rule entirely and hang off the side. A custom
       property is only an *input* to a declaration, so the media query can
       override the declaration that reads it.

       Persisted in `localStorage`, not `sessionStorage`: public pages are plain
       MPA, so every navigation rebuilds this widget. A size that did not
       survive that would be a control that resets itself on the next click. */
    const MIN_W = 320;
    const MIN_H = 320;

    /** Whatever the window can actually hold right now. */
    const roomW = () => Math.max(MIN_W, window.innerWidth - 32);
    const roomH = () => Math.max(MIN_H, window.innerHeight - 48);

    /** Set the size. Cheap enough to call on every frame of a drag. */
    function applySize(width: number, height: number) {
      const w = Math.round(Math.min(Math.max(width, MIN_W), roomW()));
      const h = Math.round(Math.min(Math.max(height, MIN_H), roomH()));
      root.style.setProperty('--ask-w', `${w}px`);
      root.style.setProperty('--ask-h', `${h}px`);
    }

    /* Separate from `applySize` because a drag calls that on every pointer
       move, and `localStorage.setItem` is synchronous — persisting there would
       be a disk write per frame for a value only the last one of which
       matters. Called when a gesture ends. */
    function rememberSize() {
      try {
        const box = panel.getBoundingClientRect();
        localStorage.setItem(SIZE_KEY, `${Math.round(box.width)},${Math.round(box.height)}`);
      } catch {
        /* Private browsing. The panel still resizes, it just forgets. */
      }
    }

    /** Whether this visitor has ever chosen a size. Nothing is stored until they do. */
    const hasCustomSize = () => root.style.getPropertyValue('--ask-w') !== '';

    function restoreSize() {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(SIZE_KEY);
      } catch {
        /* As above. */
      }
      if (!stored) return;
      const [w, h] = stored.split(',').map(Number);
      if (Number.isFinite(w) && Number.isFinite(h)) applySize(w, h);
    }

    function wireResize() {
      /* Pointer events rather than mouse ones, so the grip works under a finger
         and a stylus. Capture is what keeps the drag alive when the pointer
         leaves the 16px handle, which at any real speed it does immediately. */
      grip.addEventListener('pointerdown', event => {
        event.preventDefault();
        const startX = event.clientX;
        const startY = event.clientY;
        const box = panel.getBoundingClientRect();
        grip.setPointerCapture(event.pointerId);
        root.dataset.resizing = '1';

        /* The panel is anchored bottom-right, so dragging the top-left corner
           *up and left* is what makes it bigger — hence start minus current. */
        const move = (e: PointerEvent) =>
          applySize(box.width + (startX - e.clientX), box.height + (startY - e.clientY));

        const stop = () => {
          delete root.dataset.resizing;
          rememberSize();
          grip.removeEventListener('pointermove', move);
          grip.removeEventListener('pointerup', stop);
          grip.removeEventListener('pointercancel', stop);
        };

        grip.addEventListener('pointermove', move);
        grip.addEventListener('pointerup', stop);
        grip.addEventListener('pointercancel', stop);
      });

      /* A drag-only handle is unreachable without a pointing device, and this
         one is a `<button>` precisely so it does not have to be. */
      grip.addEventListener('keydown', event => {
        const step = event.shiftKey ? 64 : 16;
        const by = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[
          event.key
        ];
        if (!by) return;
        event.preventDefault();
        const box = panel.getBoundingClientRect();
        applySize(box.width + by[0], box.height + by[1]);
        rememberSize();
      });

      /* A window narrowed after the fact must not leave the panel wider than
         it — `applySize` re-clamps against the room there is now.

         Only for a visitor who has actually resized something. Running this
         unconditionally would write the *default* size into the custom
         properties the first time anyone turned their phone sideways, pinning
         the panel to a number nobody chose and one that no later change to the
         default could ever move. */
      window.addEventListener('resize', () => {
        if (panel.hidden || !hasCustomSize()) return;
        const box = panel.getBoundingClientRect();
        applySize(box.width, box.height);
      });
    }


      root.hidden = false;
      input.maxLength = status.maxQuestionChars;
      restoreSize();
      wireResize();

      launcher.addEventListener('click', () => {
        if (panel.hidden) openPanel(status);
        else closePanel();
      });

      /* The launcher is fixed to a corner the footer's link row also claims.
         While the two rectangles intersect, lift the launcher above the
         collision zone; settle back once they part. rAF-throttled because
         scroll fires faster than any of this needs to run. The panel is not
         lifted: it opens over content by design, and it hides its own
         launcher while open. */
      const footer = document.querySelector('footer.site-footer');
      if (footer) {
        let ticking = false;
        const syncLift = () => {
          ticking = false;
          if (panel.hidden) {
            const f = footer.getBoundingClientRect();
            const l = launcher.getBoundingClientRect();
            /* `l` includes whatever lift a previous pass wrote — undo it
               before deciding anything. Deciding on the *lifted* rect is what
               made the launcher flicker over the footer: settled 8px above the
               footer's top rule, it no longer overlapped the footer, so the
               next scroll frame dropped it back into the overlap and the frame
               after lifted it again — a strobe for as long as the scroll
               lasted. The resting rect makes the decision a pure function of
               where the footer is, so a scroll at a fixed offset converges on
               one state instead of oscillating between two. */
            const applied = parseFloat(root.style.getPropertyValue('--ask-lift')) || 0;
            const restBottom = l.bottom + applied;
            const restTop = l.top - applied;
            const overlaps =
              l.left < f.right && l.right > f.left && restBottom > f.top && restTop < f.bottom;
            root.style.setProperty(
              '--ask-lift',
              overlaps ? `${Math.ceil(restBottom - Math.max(f.top, 0)) + 8}px` : '0px'
            );
          }
        };
        const requestSync = () => {
          if (!ticking) {
            ticking = true;
            requestAnimationFrame(syncLift);
          }
        };
        syncLift();
        window.addEventListener('scroll', requestSync, { passive: true });
        window.addEventListener('resize', requestSync);
        /* Opening and closing the panel changes which control is showing. */
        panel.addEventListener('transitionend', syncLift);
      }
      $<HTMLButtonElement>('ask-close').addEventListener('click', closePanel);
      $<HTMLButtonElement>('ask-history').addEventListener('click', () => {
        if (historyView.hidden) {
          paintHistory();
          historyView.hidden = false;
        } else {
          historyView.hidden = true;
          input.focus();
        }
      });
      $('ask-history-close').addEventListener('click', () => {
        historyView.hidden = true;
        input.focus();
      });

      document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || panel.hidden) return;
        /* The history list is the topmost thing while it is showing; Escape
           steps back to the thread before it ever closes the panel. */
        if (!historyView.hidden) {
          historyView.hidden = true;
          return;
        }
        closePanel();
      });

      form.addEventListener('submit', event => {
        event.preventDefault();
        /* While an answer is streaming the send button *is* the stop button, so
           submitting the form stops it — which also makes Enter stop it, the
           convention every chat box follows. `stopped` is what tells the catch
           in `ask()` to keep what was written rather than discard it. */
        if (busy) {
          stopped = true;
          inFlight?.abort();
          return;
        }
        const question = input.value.trim();
        input.value = '';
        input.style.height = '';
        void ask(question);
      });

      /* Enter sends, Shift+Enter is a newline — the convention every chat box
         follows, and the reason the field is a textarea rather than an input. */
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          form.requestSubmit();
        }
      });

      /* Grow with the question, up to a point. Reset first: without it the
         field can only ever get taller. */
      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
      });
  }
}
