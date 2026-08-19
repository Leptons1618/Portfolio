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
  runAssist,
  type ChatSummary,
} from './ai-store';
import { ASSIST_MENU, parseCommand, type AssistMenuItem } from './assist-tasks';

/* ---------- what a page drives ---------- */

/** One assistant reply, as it arrives. Handed to the page by `begin()`. */
export interface AssistTurn {
  /** A chunk of the model's deliberation. Never the answer. */
  thinking(chunk: string): void;
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
  surface: 'journal' | 'project';
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
     and is therefore not in `ASSIST_MENU` at all — this is the twelve. */
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

    const body = el('div', 'asx-msg-body');
    const preview = el('div', 'asx-preview');
    preview.hidden = true;
    const options = el('div', 'asx-options');
    options.hidden = true;
    const actions = el('div', 'asx-msg-actions');
    actions.hidden = true;
    const note = el('p', 'asx-msg-note');
    note.hidden = true;

    root.append(think, body, preview, options, actions, note);
    log.append(root);
    follow();

    return { root, think, thinkBody, thinkSummary, body, preview, options, actions, note };
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

    if (unknown) {
      say(`There is no /${unknown} here. Type / to see what there is.`, 'error');
      return;
    }
    if (task) {
      const why = config.blocked?.(task, instruction);
      if (why) {
        say(why, 'error');
        return;
      }
    }

    /* The author's line goes in the log verbatim, command and all. A command
       rewritten into its label would make the transcript disagree with what was
       typed, and re-running from history is the main thing a transcript is for. */
    const user = bubble('user');
    user.body.textContent = line;
    turns.push({ role: 'user', content: line });
    void remember('user', line, { task: task?.command });

    input.value = '';
    closeMenu();
    void config.run(task, instruction || (task ? '' : line));
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
        },
        undefined,
        turns,
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

  /* ---------- opening and closing ---------- */

  function open(command?: string) {
    if (!dialog.open) dialog.show();
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
    running,
  };
}
