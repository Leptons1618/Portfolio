-- The authoring assistant's conversations.
--
-- The panel used to be stateless: twelve buttons, one run, and whatever it said
-- was gone the moment the dialog closed. That is fine for "suggest five titles"
-- and wrong for everything a conversation is good at — the reply three
-- exchanges ago that named the right structure, the outline that was almost
-- right, the question that was worth asking again a week later.
--
-- Two tables rather than one JSON blob per chat, which is the opposite of the
-- choice made for the resume and the assistant's settings. The reason is that
-- these rows are *appended to*, one message at a time, while a response is
-- streaming. A JSON column would mean read-modify-write on every message, which
-- is a lost message the first time two tabs are open, and a whole transcript
-- rewritten for every sentence.
--
-- Nothing here is public. `/api/ai/chats` is behind `requireOwner()`, no page
-- outside `/admin` reads either table, and the public assistant does not write
-- to them at all — its conversations live in the visitor's tab and nowhere
-- else, which is decision 23's arrangement and is not changed by this.

CREATE TABLE IF NOT EXISTS ai_chats (
  -- A random id from the browser rather than an autoincrement, so the client
  -- can open a conversation and start streaming into it without waiting for a
  -- round trip to learn what to call it. Opaque: nothing derives meaning from
  -- it and nothing displays it.
  id          TEXT PRIMARY KEY,
  -- Which editor it belongs to. The two surfaces have different commands and
  -- different fields, so a project chat listed in the journal editor would
  -- offer history that cannot be continued there.
  surface     TEXT NOT NULL CHECK (surface IN ('journal', 'project')),
  -- The post or project the conversation is about. Nullable, and deliberately
  -- *not* a foreign key: a chat about a draft that was abandoned is still worth
  -- reading, and a conversation begun on `journal/new` has no slug yet at all.
  doc_slug    TEXT,
  -- The first line of the first message, trimmed. Editable later; it is a
  -- label, not an identity.
  title       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  -- Ordering for the history list, and what a compaction touches.
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ai_chats_recent ON ai_chats(surface, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id     TEXT NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE,
  -- `note` is the panel's own voice — "stopped", "nothing was written", the
  -- sentence after a failed run. It is stored because a transcript that drops
  -- it reads as though a command simply produced nothing, and it is a separate
  -- role because it must never be sent back to a model as an assistant turn.
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'note')),
  content     TEXT NOT NULL,
  -- The model's deliberation, kept beside the answer rather than mixed into it
  -- — the same separation the wire protocol makes and for the same reason.
  -- NULL for every message that is not an answer, and for models that do not
  -- deliberate.
  thinking    TEXT,
  -- Which command produced this turn, or NULL for plain conversation. Read only
  -- for the label on the message; the task table is the authority on what a
  -- command does, and a name here that no longer exists is a caption, not a
  -- broken lookup.
  task        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every read of this table is "the messages of one chat, in order".
CREATE INDEX IF NOT EXISTS ai_messages_chat ON ai_messages(chat_id, id);
