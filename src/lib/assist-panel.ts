/**
 * The writing assistant's conversation: the log, the composer, and the history.
 *
 * `AssistPanel.astro` is the shell. This fills it, and it is shared by both
 * authoring screens for the same reason the shell is — the two of them carried
 * a near-identical panel each and drifted apart one fix at a time.
 *
 * ## What this owns, and what it does not
 *
 * It owns everything that is the same on both screens: how a message looks, how
 * a command is typed, how a reply streams into a bubble, and where a
 * conversation is stored. It owns **none** of what a result does — inserting a
 * title, replacing a selection, writing five fields as they arrive — because
 * that is the one thing the two screens genuinely differ on. A page hands this
 * a `run()` and gets back a `Turn` to write into.
 *
 * So the split is: this module knows about *conversation*, the page knows about
 * *its own fields*, and `assist-tasks.ts` knows about the twelve jobs. Nothing
 * here has an opinion about what a task does, and nothing in a page has an
 * opinion about what a message looks like.
 *
 * ## Nothing rendered here is parsed as markup
 *
 * Every message body is `textContent`. The one exception is `turn.preview()`,
 * which takes SVG that Mermaid generated under `securityLevel: 'strict'` — the
 * same exception, with the same reasoning, as the panel it replaces. A model's
 * output is text, and a panel that rendered it as HTML would be a stored
 * cross-site scripting hole whose payload the owner asked a third party to
 * write.
 *
 * ## Storage is best-effort, deliberately
 *
 * A conversation is written to D1 a message at a time while a reply streams.
 * Every one of those writes can fail — the token expired, the tab is offline —
 * and none of them may take the run down with it. The reply is on screen and in
 * the editor whether or not the row was written, so a failed save is a line in
 * the log and nothing else. Losing the transcript of a good answer is a small
 * loss; discarding a good answer because its transcript would not save is a
 * large one.
 */

import { setLabel, toast } from './admin';
import {
  appendMessage,
  compactChat,
  createChat,
  deleteChat,
  listChats,
  loadChat,
  loadOverview,
  runAssist,
  type ChatSummary,
  type ToolFrame,
} from './ai-store';
import { ASSIST_MENU, parseCommand, pickTask, type AssistMenuItem, type AssistScreen } from './assist-tasks';

/* ---------- what a page drives ---------- */

/** One assistant reply, as it arrives. Handed to the page by `begin()`. */
export interface AssistTurn {
  /** A chunk of the model's deliberation. Never the answer. */
  thinking(chunk: string): void;
  /**
   * A lookup the model asked for, and later its outcome.
   *
   * Rendered as a row above the answer — the tool's name, what it was given and
   * how long it took — because a lookup is *work the reader paid for* and a
   * panel that hides it is a panel where an answer takes four seconds for no
   * visible reason. Matched to the earlier row by `id`.
   */
  tool(frame: ToolFrame): void;
  /** The answer *so far*, whole rather than as a delta. */
  answer(text: string): void;
  /**
   * A line of progress for a task writing straight into the editor.
   *
   * A live task has nothing to show here — its output is going where the
   * author is already looking — so the bubble carries the progress instead of
   * a copy of the text.
   */
  status(text: string): void;
  /** Chips the author applies one at a time. Hides the action row's Insert. */
  options(items: { label: string; apply: () => void }[]): void;
  /** Buttons under the message: Insert, Copy, Try again, Undo. */
  actions(items: { label: string; run: () => void; primary?: boolean }[]): void;
  /** Rendered SVG, for the diagram task. Mermaid's own output, nothing else. */
  preview(svg: string): void;
  /** The panel's own voice, under the message. Stored as a `note` row. */
  note(text: string, tone?: 'info' | 'error'): void;
  /** Finish the turn and store it. `text` is what is remembered as the answer. */
  end(text: string): void;
}

export interface AssistPanelConfig {
  surface: AssistScreen;
  /** Which post or project this conversation is about. May be empty. */
  docSlug: () => string;
  /** Run a command, or plain conversation when `item` is null. */
  run: (item: AssistMenuItem | null, instruction: string) => void | Promise<void>;
  /** Abort whatever is running. */
  stop: () => void;
  /**
   * Why this command cannot run yet, as the sentence to show.
   *
   * The instruction is passed because half the reasons depend on it — a task
   * that needs a topic is blocked by an empty one — and because the panel has
   * no business knowing which those are.
   */
  blocked?: (item: AssistMenuItem, instruction: string) => string | null;
}

/** What the toolbar was set to when a run started. Passed straight to the route. */
export interface AssistRunOptions {
  model?: string;
  effort?: string;
  tools?: boolean;
}

export interface AssistPanel {
  /** Show the panel. With a command, types it into the composer, ready to send. */
  open(command?: string): void;
  /** Send a line as though it had been typed. Used by the per-field buttons. */
  send(line: string): void;
  close(): void;
  isOpen(): boolean;
  /** Start an assistant turn in the log. */
  begin(label: string, task: string | null): AssistTurn;
  /** The panel's own voice, as its own message. */
  say(text: string, tone?: 'info' | 'error'): void;
  /** The conversation so far, for the tasks that want it. */
  history(): { role: 'user' | 'assistant'; content: string }[];
  /** What the toolbar is set to. Read at the start of every run, never cached. */
  runOptions(): AssistRunOptions;
  /** Toggle the Stop button and the composer's disabled state. */
  running(on: boolean): void;
}

/* ---------- the module ---------- */

/** What a bubble holds, so `begin()` can hand pieces of it back to the page. */
interface Bubble {
  root: HTMLElement;
  think: HTMLDetailsElement;
  thinkBody: HTMLElement;
  thinkSummary: HTMLElement;
  tools: HTMLElement;
  body: HTMLElement;
  preview: HTMLElement;
  options: HTMLElement;
  actions: HTMLElement;
  note: HTMLElement;
}

const el = <T extends HTMLElement>(tag: string, className: string): T => {
  const node = document.createElement(tag) as T;
  node.className = className;
  return node;
};

/** `2 minutes ago`, `yesterday`, `12 Mar`. Short enough for a 200px column. */
function ago(iso: string): string {
  const then = Date.parse(`${iso.replace(' ', 'T')}Z`);
  if (!Number.isFinite(then)) return '';
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function mountAssistPanel(config: AssistPanelConfig): AssistPanel {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

  const dialog = $<HTMLDialogElement>('assist-dialog');
  const log = $('assist-log');
  const input = $<HTMLTextAreaElement>('assist-input');
  const menu = $('assist-menu');
  const sendBtn = $<HTMLButtonElement>('assist-send');
  const stopBtn = $<HTMLButtonElement>('assist-stop');
  const sessions = $('assist-sessions');
  const sessionList = $('assist-session-list');

  /* The commands this surface offers. `both` is `chat`, which has no command
     and is therefore not in `ASSIST_MENU` at all. */
  const commands = ASSIST_MENU.filter(item => item.surface === config.surface);

  /* ---------- the log ---------- */

  /* Pinned to the bottom while the reader is at the bottom. Scrolling up to
     re-read something must not be undone by the next token arriving, which is
     the single most annoying behaviour a streaming log can have. */
  let stick = true;
  log.addEventListener('scroll', () => {
    stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  });
  const follow = () => {
    if (stick) log.scrollTop = log.scrollHeight;
  };

  function bubble(role: 'user' | 'assistant' | 'note', caption = ''): Bubble {
    const root = el('div', 'asx-msg');
    root.dataset.role = role;

    if (caption) {
      const head = el('div', 'asx-msg-head');
      head.textContent = caption;
      root.append(head);
    }

    const think = el<HTMLDetailsElement>('details', 'asx-think');
    think.hidden = true;
    const thinkSummary = el('summary', 'asx-think-summary');
    thinkSummary.textContent = 'Thinking';
    /* Touching it pins it, and after that nothing programmatic moves it. On the
       summary rather than `toggle`, which also fires for the assignments below
       and would pin the box against itself on the first frame. */
    thinkSummary.addEventListener('click', () => {
      think.dataset.pinned = '';
    });
    const thinkBody = el('pre', 'asx-think-body');
    think.append(thinkSummary, thinkBody);

    /* Above the answer rather than behind a disclosure like thinking, because
       a lookup is not deliberation — it is the reason the answer says what it
       says, and it is the one thing on screen that tells the reader *why* a
       claim about a post is trustworthy. */
    const tools = el('div', 'asx-tools');
    tools.hidden = true;

    const body = el('div', 'asx-msg-body');
    const preview = el('div', 'asx-preview');
    preview.hidden = true;
    const options = el('div', 'asx-options');
    options.hidden = true;
    const actions = el('div', 'asx-msg-actions');
    actions.hidden = true;
    const note = el('p', 'asx-msg-note');
    note.hidden = true;

    root.append(think, tools, body, preview, options, actions, note);
    log.append(root);
    follow();

    return { root, think, thinkBody, thinkSummary, tools, body, preview, options, actions, note };
  }

  /**
   * One lookup, as a row in the message it belongs to.
   *
   * Written to read like a terminal: the tool's name in mono, its argument
   * beside it, a state dot, and the time it took once it is over. Everything is
   * `textContent` — a tool's name comes from this repository, but its arguments
   * are a model's own JSON and its detail line quotes a slug that the model
   * chose.
   *
   * Updated in place rather than appended twice, which is what `id` is for. A
   * row that stayed `running` for ever would be the most common visible bug in
   * a panel like this, so an unmatched `done` creates its own row rather than
   * being dropped.
   */
  function toolRow(host: HTMLElement, frame: ToolFrame) {
    host.hidden = false;

    let row = host.querySelector<HTMLElement>(`[data-call="${CSS.escape(frame.id)}"]`);
    if (!row) {
      row = el('div', 'asx-tool-row');
      row.dataset.call = frame.id;

      const name = el('span', 'asx-tool-name');
      name.textContent = frame.name;
      const args = el('span', 'asx-tool-args');
      const state = el('span', 'asx-tool-state');
      row.append(name, args, state);
      host.append(row);
    }

    row.dataset.status = frame.status;

    if (frame.args && Object.keys(frame.args).length) {
      const args = row.querySelector<HTMLElement>('.asx-tool-args');
      if (args) {
        args.textContent = Object.entries(frame.args)
          .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
          .join(', ');
      }
    }

    const state = row.querySelector<HTMLElement>('.asx-tool-state');
    if (state) {
      state.textContent =
        frame.status === 'running'
          ? 'looking…'
          : [frame.detail, frame.ms === undefined ? '' : `${frame.ms} ms`].filter(Boolean).join(' · ');
    }

    follow();
  }

  /* ---------- storage ---------- */

  let chatId: string | null = null;
  /** The transcript as the panel knows it, for `history()` and for compaction. */
  let turns: { role: 'user' | 'assistant'; content: string }[] = [];

  /**
   * The create, once, however many messages race to be the first.
   *
   * `submit()` stores the author's line and the run stores the reply, and
   * neither awaits the other — so on the first exchange in a new conversation
   * both reach `ensureChat` before either has finished creating one. Holding
   * the in-flight promise is what stops that being two conversations, each with
   * half of the same exchange in it.
   */
  let creating: Promise<string | null> | null = null;

  /**
   * Appends, in the order they were made.
   *
   * `ai_messages.id` is an autoincrement, so the transcript's order is the
   * order the inserts *complete* in. Two fire-and-forget writes issued a
   * millisecond apart can complete either way round, which reads back as the
   * assistant answering before it was asked. One promise chain is the whole
   * fix; the failure of one link must not break the next, so the rejection
   * handler is the same function as the success one.
   */
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(job: () => Promise<T>): Promise<unknown> => {
    queue = queue.then(job, job);
    return queue;
  };

  const newId = () =>
    /* Lowercase hex and hyphens, which is what the route's `^[a-z0-9-]{6,64}$`
       accepts. `randomUUID` needs a secure context; every admin screen is one,
       and the fallback is only there so a plain-HTTP preview does not break. */
    (crypto.randomUUID?.() ?? `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)
      .toLowerCase();

  function ensureChat(firstLine: string): Promise<string | null> {
    if (chatId) return Promise.resolve(chatId);
    if (creating) return creating;

    const id = newId();
    creating = createChat(
      id,
      config.surface,
      config.docSlug(),
      firstLine.slice(0, 80) || 'New conversation',
    )
      .then(() => {
        chatId = id;
        return id;
      })
      .catch(error => {
        /* The conversation carries on unsaved. Said once, not once per
           message. `creating` is left set so the failure is not retried on
           every message of a conversation that is not going to save. */
        saveFailed(error);
        return null;
      });
    return creating;
  }

  let warned = false;
  function saveFailed(error: unknown) {
    if (warned) return;
    warned = true;
    const text = error instanceof Error ? error.message : 'Could not save this conversation.';
    say(`${text} The conversation still works; it is just not being saved.`, 'error');
  }

  function remember(
    role: 'user' | 'assistant' | 'note',
    content: string,
    extra: { thinking?: string; task?: string } = {},
  ): Promise<unknown> {
    if (!content.trim() && !extra.thinking?.trim()) return Promise.resolve();

    return enqueue(async () => {
      /* Only the author starts a conversation. A note is the panel's own voice
         — "there is no /foo here", "could not save" — and one of those creating
         a conversation would fill the history with rows nobody said anything
         in, titled with an error message. */
      const id = chatId ?? (role === 'user' ? await ensureChat(content) : null);
      if (!id) return;
      try {
        await appendMessage(id, { role, content, ...extra });
      } catch (error) {
        saveFailed(error);
      }
    });
  }

  /* ---------- the panel's own voice ---------- */

  function say(text: string, tone: 'info' | 'error' = 'info') {
    const note = bubble('note');
    note.root.dataset.tone = tone;
    note.body.textContent = text;
    void remember('note', text);
  }

  /* ---------- an assistant turn ---------- */

  function begin(label: string, task: string | null): AssistTurn {
    const view = bubble('assistant', task ? `/${task}` : label);
    /* `data-live` for the run's duration: the stylesheet hangs the streaming
       caret and the live rule off it, and `end()` takes it away. State for
       CSS, nothing reads it back. */
    view.root.dataset.live = '';
    let thinking = '';
    let answered = false;
    /* The first status is the placeholder a run sets before it has asked for
       anything; every later one is progress, which means the answer has begun.
       Counting them is what lets a live task — whose output goes into the
       editor and never into this bubble — close its thinking box at the same
       moment a panel task does. */
    let statuses = 0;

    const settleThinking = () => {
      if (!thinking) return;
      view.thinkSummary.textContent = `Thinking · ${thinking.length.toLocaleString()} characters`;
      if (!('pinned' in view.think.dataset)) view.think.open = false;
    };

    return {
      thinking(chunk) {
        thinking += chunk;
        view.think.hidden = false;
        /* Open while it is the only thing happening. A model deliberating for
           twenty seconds behind a closed box is indistinguishable from one that
           has hung, and that is how it gets read every time. */
        if (!('pinned' in view.think.dataset)) view.think.open = true;
        view.thinkSummary.textContent = 'Thinking…';
        view.thinkBody.textContent = thinking;
        view.thinkBody.scrollTop = view.thinkBody.scrollHeight;
        follow();
      },

      tool(frame) {
        /* A model that has decided to look something up has stopped
           deliberating, so the thinking box settles here too — otherwise it
           stays open above a list of lookups, claiming to still be thinking. */
        if (frame.status === 'running' && !answered) settleThinking();
        toolRow(view.tools, frame);
      },

      answer(text) {
        if (!answered) {
          answered = true;
          settleThinking();
        }
        view.body.dataset.kind = 'answer';
        view.body.textContent = text;
        follow();
      },

      status(text) {
        statuses += 1;
        if (statuses > 1 && !answered) {
          answered = true;
          settleThinking();
        }
        view.body.dataset.kind = 'status';
        view.body.textContent = text;
        follow();
      },

      options(items) {
        view.options.replaceChildren();
        view.options.hidden = !items.length;
        for (const item of items) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'asx-option';
          chip.textContent = item.label;
          chip.addEventListener('click', () => {
            item.apply();
            /* Marked rather than removed: the author needs to see what they
               have already taken, and a list that shortens under the cursor is
               how the wrong one gets clicked. */
            chip.dataset.used = '';
          });
          view.options.append(chip);
        }
        follow();
      },

      actions(items) {
        view.actions.replaceChildren();
        view.actions.hidden = !items.length;
        for (const item of items) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = `btn ${item.primary ? 'btn-primary' : 'btn-secondary'} btn-sm`;
          button.textContent = item.label;
          button.addEventListener('click', () => item.run());
          view.actions.append(button);
        }
        follow();
      },

      preview(svg) {
        view.preview.hidden = false;
        /* The one `innerHTML` here, and the same one the old panel had: this is
           Mermaid's render output, produced under `securityLevel: 'strict'`
           with `htmlLabels: false`, which is what makes every label a text node
           rather than markup. See `src/lib/diagram.ts`. */
        view.preview.innerHTML = svg;
        follow();
      },

      note(text, tone = 'info') {
        view.note.hidden = false;
        view.note.dataset.tone = tone;
        view.note.textContent = text;
        follow();
        void remember('note', text);
      },

      end(text) {
        settleThinking();
        delete view.root.dataset.live;
        if (text.trim()) turns.push({ role: 'assistant', content: text });
        void remember('assistant', text || view.body.textContent || '', {
          thinking,
          task: task ?? undefined,
        });
        follow();
      },
    };
  }

  /* ---------- the composer ---------- */

  function running(on: boolean) {
    stopBtn.hidden = !on;
    sendBtn.disabled = on;
    input.disabled = on;
  }

  /* The command list, filtered by whatever has been typed after the slash.
     `active` is an index into `shown` rather than a DOM lookup, so the arrow
     keys work the same whether the list was opened by typing or by `/`. */
  let shown: AssistMenuItem[] = [];
  let active = 0;

  function closeMenu() {
    menu.hidden = true;
    shown = [];
  }

  function paintMenu() {
    const value = input.value;
    /* Only while the whole composer is one unfinished command. A slash inside a
       sentence — "the a/b test" — is not a command, and a command that already
       has an argument is being written, not chosen. */
    const match = /^\/(\S*)$/.exec(value);
    if (!match) return closeMenu();

    const needle = match[1].toLowerCase();
    shown = commands.filter(
      item => item.command.includes(needle) || item.label.toLowerCase().includes(needle),
    );
    if (!shown.length) return closeMenu();

    active = Math.min(active, shown.length - 1);
    menu.replaceChildren();
    shown.forEach((item, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'asx-menu-row';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === active));
      if (index === active) row.dataset.active = '';

      const name = el('span', 'asx-menu-command');
      name.textContent = `/${item.command}`;
      const hint = el('span', 'asx-menu-hint');
      hint.textContent = item.hint;
      row.append(name, hint);

      /* `mousedown`, not `click`: the composer loses focus on mousedown and the
         blur handler below closes the list before a click would ever land. */
      row.addEventListener('mousedown', event => {
        event.preventDefault();
        choose(index);
      });
      menu.append(row);
    });
    menu.hidden = false;
  }

  function choose(index: number) {
    const item = shown[index];
    if (!item) return;
    /* A trailing space, because every command that takes a steer takes it right
       here and the alternative is the author deleting the caret's own position. */
    input.value = `/${item.command} `;
    closeMenu();
    input.focus();
  }

  function submit() {
    const line = input.value.trim();
    if (!line) return;

    const { task, instruction, unknown } = parseCommand(line);

    /* An exact command runs exactly as typed. Everything else — a slash that
       names nothing, and plain prose — gets one pass through the router
       first: "update the case study" is how a request is spoken, and
       `/write-case-study` is what it resolves to. Whatever the router cannot
       place stays what it would have been. */
    if (task) return dispatch(task, instruction || '', line);

    /* The router sees everything that was typed — a mistyped slash word is
       often the command's own name ("write-case-study" without its slash),
       and the words after it are often the rest of the request. */
    const routed = pickTask(line, config.surface);

    if (routed) return dispatch(routed, instruction || line, line);

    if (unknown !== null) {
      say(`There is no /${unknown} here. Type / to see what there is.`, 'error');
      return;
    }

    /* Conversation: the line is the message and the message is the line. */
    dispatch(null, line, line);
  }

  /**
   * Log the author's line and hand a job to the page.
   *
   * One door for every send, typed command and routed request alike, because
   * all three are the same transaction: the words go into the log verbatim,
   * the composer empties, the page runs. A request the router *placed* gets a
   * small mono caption naming the command it became — the transcript has to
   * agree with what was said while still saying what will happen.
   */
  function dispatch(item: AssistMenuItem | null, instruction: string, typed: string) {
    const why = item ? config.blocked?.(item, instruction) : null;
    if (why) {
      say(why, 'error');
      return;
    }

    const user = bubble('user', item && !typed.startsWith(`/${item.command}`) ? `/${item.command}` : '');
    user.body.textContent = typed;
    turns.push({ role: 'user', content: typed });
    void remember('user', typed, { task: item?.command });

    input.value = '';
    closeMenu();
    void config.run(item, instruction);
  }

  input.addEventListener('input', () => {
    /* Typing narrows the list, so the highlight goes back to the top. Keeping
       it where it was means Enter runs whatever happens to be third in a list
       the author has not looked at since it changed. */
    active = 0;
    paintMenu();
  });
  input.addEventListener('blur', () => {
    /* After the menu's own `mousedown` has had its turn. */
    setTimeout(closeMenu, 0);
  });

  input.addEventListener('keydown', event => {
    if (!menu.hidden && shown.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        active = (active + (event.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length;
        paintMenu();
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        choose(active);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        /* The dialog's own Escape handler closes the panel. With the command
           list open, Escape means "not that list" and must not also mean "not
           this panel" — so this one stops there. */
        event.stopPropagation();
        closeMenu();
        return;
      }
    }

    /* Enter sends, Shift+Enter is a newline — the arrangement every chat
       composer has, and the opposite of the topic box this replaced, where
       Enter was a newline and Cmd+Enter sent. A two-sentence steer is still one
       Shift away. */
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });

  sendBtn.addEventListener('click', submit);
  stopBtn.addEventListener('click', () => config.stop());

  /* ---------- the history drawer ---------- */

  async function paintSessions() {
    sessionList.replaceChildren();
    const loading = el('p', 'admin-note');
    loading.textContent = 'Reading…';
    sessionList.append(loading);

    let chats: ChatSummary[] = [];
    try {
      chats = (await listChats(config.surface)).chats;
    } catch (error) {
      loading.textContent = error instanceof Error ? error.message : 'Could not read the history.';
      return;
    }

    sessionList.replaceChildren();
    if (!chats.length) {
      const empty = el('p', 'admin-note');
      empty.textContent = 'Nothing yet. Whatever you ask is kept here.';
      sessionList.append(empty);
      return;
    }

    for (const chat of chats) {
      const row = el('div', 'asx-session');
      if (chat.id === chatId) row.dataset.current = '';

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'asx-session-open';
      const title = el('span', 'asx-session-title');
      title.textContent = chat.title;
      const meta = el('span', 'asx-session-meta');
      meta.textContent = [ago(chat.updated_at), `${chat.messages} message${chat.messages === 1 ? '' : 's'}`, chat.doc_slug]
        .filter(Boolean)
        .join(' · ');
      openBtn.append(title, meta);
      openBtn.addEventListener('click', () => void restore(chat.id));

      /* Two-click confirm, the same shape every other delete on this surface
         uses. `setLabel` rather than `textContent` so an icon added here later
         is not silently deleted by the arming step. */
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-ghost btn-sm asx-session-delete';
      remove.textContent = 'Delete';
      let armed = false;
      remove.addEventListener('click', async () => {
        if (!armed) {
          armed = true;
          setLabel(remove, 'Confirm');
          setTimeout(() => {
            armed = false;
            setLabel(remove, null);
          }, 4000);
          return;
        }
        try {
          await deleteChat(chat.id);
          if (chat.id === chatId) startNew();
          toast('Conversation deleted.', { tone: 'success' });
          await paintSessions();
        } catch (error) {
          toast(error instanceof Error ? error.message : 'Could not delete it.', { tone: 'error' });
        }
      });

      row.append(openBtn, remove);
      sessionList.append(row);
    }
  }

  async function restore(id: string) {
    try {
      const { chat, messages } = await loadChat(id);
      chatId = chat.id;
      creating = null;
      turns = [];
      log.replaceChildren();

      for (const message of messages) {
        if (message.role === 'note') {
          const note = bubble('note');
          note.body.textContent = message.content;
          continue;
        }
        const view = bubble(message.role, message.role === 'assistant' && message.task ? `/${message.task}` : '');
        view.body.textContent = message.content;
        if (message.thinking) {
          view.think.hidden = false;
          view.thinkBody.textContent = message.thinking;
          view.thinkSummary.textContent = `Thinking · ${message.thinking.length.toLocaleString()} characters`;
        }
        turns.push({ role: message.role, content: message.content });
      }

      stick = true;
      follow();
      await paintSessions();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not open that conversation.', {
        tone: 'error',
      });
    }
  }

  function startNew() {
    chatId = null;
    creating = null;
    warned = false;
    turns = [];
    log.replaceChildren();
    greet();
  }

  function greet() {
    const hello = bubble('note');
    hello.body.textContent =
      'Ask about the draft, or type / for a command. Commands write into the editor; nothing is saved until you press Save.';
  }

  $<HTMLButtonElement>('assist-new').addEventListener('click', () => {
    startNew();
    input.focus();
  });

  const historyBtn = $<HTMLButtonElement>('assist-history');
  historyBtn.addEventListener('click', () => {
    const showing = sessions.hidden;
    sessions.hidden = !showing;
    historyBtn.setAttribute('aria-pressed', String(showing));
    if (showing) void paintSessions();
  });

  /* ---------- compaction ---------- */

  $<HTMLButtonElement>('assist-compact').addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement;
    if (!chatId || turns.length < 2) {
      toast('There is nothing to compact yet.', { tone: 'info' });
      return;
    }

    const turn = begin('Compacting', null);
    running(true);
    button.disabled = true;
    let summary = '';
    try {
      let live = '';
      summary = await runAssist(
        'chat',
        {},
        'Summarise everything in this conversation that would matter if we picked it up again tomorrow: what is being written, what was decided, what was rejected and why, and anything still open. Write it as notes, not as prose. Do not greet me and do not offer to continue.',
        {
          onDelta: chunk => {
            live += chunk;
            turn.answer(live);
          },
          onThinking: chunk => turn.thinking(chunk),
          onTool: frame => turn.tool(frame),
        },
        undefined,
        turns,
        /* Summarising a conversation is a function of the conversation. Nothing
           in it needs looking up, and a lookup here would be tokens spent
           reading a post to compress a chat about a different one. */
        { ...readRunOptions(), tools: false },
      );
      if (!summary.trim()) throw new Error('The model returned an empty summary.');

      await compactChat(chatId, summary);
      turn.end(summary);
      /* Reloaded rather than patched in place: the transcript on screen has to
         become the one that will be sent next time, and the authority on that
         is the row, not this function's idea of what it just wrote. */
      await restore(chatId);
      toast('Conversation compacted.', { tone: 'success' });
    } catch (error) {
      turn.note(
        error instanceof Error ? error.message : 'Could not compact this conversation.',
        'error',
      );
      turn.end(summary);
    } finally {
      running(false);
      button.disabled = false;
    }
  });

  /* ---------- the toolbar ---------- */

  /**
   * Model, effort and lookups, remembered per browser rather than per row.
   *
   * These are *this author's preference while working*, not configuration: the
   * provider row is the configuration, and it is what an unset control falls
   * back to. Storing them in `localStorage` rather than in D1 is the same
   * judgement the sidebar's collapsed state gets — a write per dropdown change
   * would be a row updated a dozen times an afternoon to record which of two
   * models somebody is trying.
   */
  const RUN_KEY = 'om-assist-run';

  const modelPick = $<HTMLSelectElement>('assist-model');
  const effortPick = $<HTMLSelectElement>('assist-effort');
  const toolsPick = $<HTMLSelectElement>('assist-tools');

  function readRunOptions(): AssistRunOptions {
    return {
      model: modelPick.value || undefined,
      effort: effortPick.value || undefined,
      /* Only ever sent as `false`. `true` is the default and the server may
         still have tools off for the provider, so claiming them on would be a
         request asserting something the row decides. */
      tools: toolsPick.value === 'off' ? false : undefined,
    };
  }

  function rememberRunOptions() {
    try {
      localStorage.setItem(
        RUN_KEY,
        JSON.stringify({ model: modelPick.value, effort: effortPick.value, tools: toolsPick.value }),
      );
    } catch {
      /* Private browsing. The controls work, they just forget. */
    }
  }

  /**
   * Fill the model list from the provider rows, once per panel.
   *
   * Over the network because that is the only place these live — `/admin/*` is
   * public HTML and a server-rendered model list would be a page that had
   * queried `ai_providers`, which is the one table this surface never renders
   * from. Failure is silent: the list keeps its single "Default" entry, which
   * is what every run did before this control existed.
   */
  async function fillModels() {
    let saved: { model?: string; effort?: string; tools?: string } = {};
    try {
      saved = JSON.parse(localStorage.getItem(RUN_KEY) ?? '{}');
    } catch {
      /* As above. */
    }
    if (saved.effort) effortPick.value = saved.effort;
    if (saved.tools) toolsPick.value = saved.tools;

    try {
      const { providers } = await loadOverview();
      for (const provider of providers) {
        if (!provider.active) continue;
        /* The writing model first where there is one, because this panel is the
           writing assistant and `assist` is the role its calls run under. */
        const models = [provider.assistModel || provider.model, ...provider.fallbackModels].filter(
          (model, index, all): model is string => Boolean(model) && all.indexOf(model) === index,
        );
        for (const [index, model] of models.entries()) {
          const option = document.createElement('option');
          option.value = model;
          option.textContent =
            providers.length > 1 ? `${provider.label} · ${model}` : model;
          if (index === 0) option.textContent += ' (default)';
          modelPick.append(option);
        }
      }
      if (saved.model) modelPick.value = saved.model;
      /* A model that is no longer configured leaves the select on nothing at
         all, which reads as an empty control. Falling back to Default is both
         the honest state and what the server would do with it anyway. */
      if (saved.model && modelPick.value !== saved.model) modelPick.value = '';
    } catch {
      /* Signed out, or the endpoint refused. Default is still a valid choice. */
    }
  }

  for (const control of [modelPick, effortPick, toolsPick]) {
    control.addEventListener('change', rememberRunOptions);
  }

  /* ---------- size ---------- */

  /**
   * The same control the public widget has, and the same reasoning for it.
   *
   * Two custom properties on the dialog rather than inline `width`/`height`,
   * because the narrow-screen rules in `admin.css` have to be able to win: an
   * inline style beats any stylesheet rule, so a panel resized on a desktop and
   * reopened on a laptop would ignore them and hang off the edge. A custom
   * property is only an *input* to a declaration, so a media query can override
   * the declaration that reads it.
   */
  const SIZE_KEY = 'om-assist-size';
  const MIN_W = 360;
  const MIN_H = 320;

  const grip = $<HTMLButtonElement>('assist-grip');

  const roomW = () => Math.max(MIN_W, window.innerWidth - 32);
  const roomH = () => Math.max(MIN_H, window.innerHeight - 48);

  function applySize(width: number, height: number) {
    const w = Math.round(Math.min(Math.max(width, MIN_W), roomW()));
    const h = Math.round(Math.min(Math.max(height, MIN_H), roomH()));
    dialog.style.setProperty('--asx-w', `${w}px`);
    dialog.style.setProperty('--asx-h', `${h}px`);
  }

  /* Separate from `applySize`, which runs on every frame of a drag:
     `localStorage.setItem` is synchronous, and persisting there would be a disk
     write per frame for a value only the last of which matters. */
  function rememberSize() {
    try {
      const box = dialog.getBoundingClientRect();
      localStorage.setItem(SIZE_KEY, `${Math.round(box.width)},${Math.round(box.height)}`);
    } catch {
      /* As above. */
    }
  }

  function restoreSize() {
    try {
      const stored = localStorage.getItem(SIZE_KEY);
      if (!stored) return;
      const [w, h] = stored.split(',').map(Number);
      if (Number.isFinite(w) && Number.isFinite(h)) applySize(w, h);
    } catch {
      /* As above. */
    }
  }

  /* Docked left, the panel's *left* edge is the fixed one, so the handle sits on
     the other corner and the horizontal delta runs the other way. Every other
     placement is anchored bottom-right, floating included. */
  const growX = (delta: number) => (dialog.dataset.dock === 'left' ? -delta : delta);

  grip.addEventListener('pointerdown', event => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const box = dialog.getBoundingClientRect();
    grip.setPointerCapture(event.pointerId);
    dialog.dataset.resizing = '1';

    /* Anchored bottom-right, so dragging the top-left corner *up and left* is
       what makes it bigger — hence start minus current. */
    const move = (e: PointerEvent) =>
      applySize(box.width + growX(startX - e.clientX), box.height + (startY - e.clientY));

    const stop = () => {
      delete dialog.dataset.resizing;
      rememberSize();
      syncPageRoom();
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', stop);
      grip.removeEventListener('pointercancel', stop);
    };

    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', stop);
    grip.addEventListener('pointercancel', stop);
  });

  /* A drag-only handle is unreachable without a pointing device, and this one
     is a `<button>` precisely so it does not have to be. */
  grip.addEventListener('keydown', event => {
    const step = event.shiftKey ? 64 : 16;
    const by = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[
      event.key
    ];
    if (!by) return;
    event.preventDefault();
    /* Stopped here as well as prevented: the composer's own keydown handler is
       on the dialog's subtree and Escape/Enter aside, an arrow key reaching it
       would move a caret that is not where the author is looking. */
    event.stopPropagation();
    const box = dialog.getBoundingClientRect();
    applySize(box.width + growX(by[0]), box.height + by[1]);
    rememberSize();
    syncPageRoom();
  });

  /* A window narrowed after the fact must not leave the panel wider than it.
     Only for a panel that has actually been resized — running this
     unconditionally would write the *default* size into the custom properties
     the first time anyone rotated a tablet, pinning it to a number nobody
     chose and one no later change to the default could move. */
  window.addEventListener('resize', () => {
    if (!dialog.open || !dialog.style.getPropertyValue('--asx-w')) return;
    const box = dialog.getBoundingClientRect();
    applySize(box.width, box.height);
    syncPageRoom();
  });

  restoreSize();

  /* ---------- where it sits ---------- */

  /**
   * Docked right, docked left, or wherever it was dragged to.
   *
   * The panel writes into fields it also has to sit beside, and which side that
   * is differs by screen. Two docks and a free position cover it without a
   * layout mode of their own: every placement is anchored *bottom-right* except
   * the left dock, so the size handle keeps one meaning and a drag only ever
   * writes two offsets.
   *
   * Same storage reasoning as the size above — `localStorage`, written on
   * pointer-up rather than once per frame.
   */
  const PLACE_KEY = 'om-assist-place';
  type Dock = 'left' | 'right' | 'float';

  const head = dialog.querySelector<HTMLElement>('[data-drag]')!;
  const dockToggle = $<HTMLButtonElement>('assist-dock-toggle');

  function markDock(dock: Dock) {
    dialog.dataset.dock = dock;
    /* The icon itself is what CSS swaps off `data-dock`; the labels say where
       a click goes *next*, which is the one thing the picture cannot. */
    const label =
      dock === 'left'
        ? 'Move the panel to the right edge'
        : dock === 'right'
          ? 'Move the panel to the left edge'
          : 'Dock the panel to an edge';
    dockToggle.title = label;
    dockToggle.setAttribute('aria-label', label);
    syncPageRoom();
  }

  /* ---------- the page makes room ----------

     A docked panel used to sit on top of whatever the page had at that edge.
     While it is open *and* pinned to a side, its state goes onto `<body>`
     (`data-asx-dock`) and its outer width into the `--asx-dock-w` custom
     property, which the content column reads as padding on that side — the
     page narrows instead of being covered. Dragged free, closed, or below
     the wide-screen breakpoint, nothing is reserved.

     Written per *event* rather than per frame — dock changes, resize stops,
     opens, closes — through one rAF-coalesced writer, because a drag across
     the header fires dozens of `markDock`-shaped events and the measurement
     is a layout read. */
  function syncPageRoom() {
    requestAnimationFrame(() => {
      const dock = dialog.dataset.dock;
      if (!dialog.open || (dock !== 'left' && dock !== 'right')) {
        delete document.body.dataset.asxDock;
        return;
      }
      document.body.dataset.asxDock = dock;
      /* The panel plus the gap it floats off the edge by. */
      const box = dialog.getBoundingClientRect();
      document.body.style.setProperty('--asx-dock-w', `${Math.round(box.width + 16)}px`);
    });
  }

  /** Offsets from the right and bottom edges, clamped to leave the panel on screen. */
  function applyFloat(right: number, bottom: number) {
    const box = dialog.getBoundingClientRect();
    const x = Math.round(Math.min(Math.max(right, 0), Math.max(0, window.innerWidth - box.width)));
    const y = Math.round(Math.min(Math.max(bottom, 0), Math.max(0, window.innerHeight - box.height)));
    dialog.style.setProperty('--asx-right', x + 'px');
    dialog.style.setProperty('--asx-bottom', y + 'px');
  }

  function rememberPlace() {
    try {
      const box = dialog.getBoundingClientRect();
      const right = Math.round(window.innerWidth - box.right);
      const bottom = Math.round(window.innerHeight - box.bottom);
      localStorage.setItem(PLACE_KEY, (dialog.dataset.dock ?? 'right') + ',' + right + ',' + bottom);
    } catch {
      /* As above: a browser with storage denied still gets a working panel. */
    }
  }

  function restorePlace() {
    try {
      const [dock, right, bottom] = (localStorage.getItem(PLACE_KEY) ?? '').split(',');
      if (dock !== 'left' && dock !== 'right' && dock !== 'float') return;
      markDock(dock);
      if (dock === 'float' && Number.isFinite(Number(right)) && Number.isFinite(Number(bottom))) {
        applyFloat(Number(right), Number(bottom));
      }
    } catch {
      /* As above. */
    }
  }

  /* One button through all three placements: right → left → free → right.
     Floating counts as a first-class stop now rather than something a drag
     produces and a click dissolves — a panel dragged into the middle of the
     page is a placement worth keeping, and the icon says so. */
  const NEXT_DOCK: Record<Dock, Dock> = { right: 'left', left: 'float', float: 'right' };

  dockToggle.addEventListener('click', () => {
    markDock(NEXT_DOCK[(dialog.dataset.dock as Dock) ?? 'right']);
    if (dialog.dataset.dock === 'float' && !dialog.style.getPropertyValue('--asx-right')) {
      /* Onto free from a click: keep it where it already is rather than
         snapping to stored offsets from some previous float. */
      const box = dialog.getBoundingClientRect();
      applyFloat(window.innerWidth - box.right, window.innerHeight - box.bottom);
    }
    rememberPlace();
  });

  /* Dragging the header is what produces the third placement. There is no
     "float" button because the only useful free position is the one the pointer
     chose; the buttons in the header keep their own click. */
  head.addEventListener('pointerdown', event => {
    if ((event.target as HTMLElement).closest('button, .asx-head-actions')) return;
    event.preventDefault();
    const box = dialog.getBoundingClientRect();
    const startRight = window.innerWidth - box.right;
    const startBottom = window.innerHeight - box.bottom;
    const startX = event.clientX;
    const startY = event.clientY;
    head.setPointerCapture(event.pointerId);
    dialog.dataset.dragging = '1';

    /* Undocked on the first *movement*, not on the press: a stray click on the
       title would otherwise send a left-docked panel across the window, since
       the float's stored offsets are measured from the other two edges. */
    let moved = false;
    const move = (e: PointerEvent) => {
      if (!moved) {
        moved = true;
        markDock('float');
      }
      applyFloat(startRight - (e.clientX - startX), startBottom - (e.clientY - startY));
    };

    const stop = () => {
      delete dialog.dataset.dragging;
      if (moved) rememberPlace();
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', stop);
      head.removeEventListener('pointercancel', stop);
    };

    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', stop);
    head.addEventListener('pointercancel', stop);
  });

  /* A window narrowed after the fact must not leave a floating panel off the
     side of it — the same rule, and the same "only if it was moved" guard, as
     the size handler above. */
  window.addEventListener('resize', () => {
    if (!dialog.open || dialog.dataset.dock !== 'float') return;
    const box = dialog.getBoundingClientRect();
    applyFloat(window.innerWidth - box.right, window.innerHeight - box.bottom);
  });

  /* A position is stored in window coordinates and restored into whatever
     window it is next opened in, which may be a smaller one. The clamp in
     `applyFloat` cannot run at mount — a closed `<dialog>` measures zero — so
     it runs once the panel is actually on screen. */
  function settleFloat() {
    if (dialog.dataset.dock !== 'float') return;
    const box = dialog.getBoundingClientRect();
    applyFloat(window.innerWidth - box.right, window.innerHeight - box.bottom);
  }

  restorePlace();

  /* ---------- opening and closing ---------- */

  /* The model list costs a request, and an editor session that never opens the
     assistant should not pay for it. Deferred to the first open rather than run
     at mount: the panel is mounted on every load of both authoring screens, and
     it is used on a fraction of them. */
  let modelsFilled = false;

  function open(command?: string) {
    if (!modelsFilled) {
      modelsFilled = true;
      void fillModels();
    }
    if (!dialog.open) {
      /* `show()` normally: the editor behind the panel stays visible and
         usable, because watching the fields fill is the point. The exception is
         a screen that raises the assistant from inside a modal `<dialog>` — the
         import form on `/admin/projects` — where the modal is in the top layer
         and no `z-index` reaches over it. Joining it there is the only way up,
         and the panel's transparent `::backdrop` means nothing dims. */
      if (document.querySelector('dialog[open]:modal')) dialog.showModal();
      else dialog.show();
      settleFloat();
      /* After the dialog has its box: this is what reserves the page column
         for a docked placement, including one restored from storage. */
      syncPageRoom();
    }
    if (command) {
      input.value = `/${command} `;
      closeMenu();
    }
    input.focus();
  }

  function send(line: string) {
    input.value = line;
    submit();
  }

  $<HTMLButtonElement>('assist-close').addEventListener('click', () => dialog.close());

  /* Escape is a modal dialog's for free and a non-modal one's to wire. Scoped
     to focus being inside the panel, so Escape in the editor is still the
     editor's. */
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    /* Except while the command list is open, where Escape closes that — the
       keydown handler on the composer has already stopped those. */
    event.preventDefault();
    dialog.close();
  });

  /* A run still in flight is abandoned rather than left billing in the
     background with nobody watching. Anything already written into the fields
     stays there — closing the panel is not an undo. */
  dialog.addEventListener('close', () => {
    config.stop();
    running(false);
    /* The reserved column goes with the panel. */
    delete document.body.dataset.asxDock;
  });

  greet();

  return {
    open,
    send,
    close: () => dialog.close(),
    isOpen: () => dialog.open,
    begin,
    say,
    history: () => turns.slice(),
    runOptions: readRunOptions,
    running,
  };
}
