---
name: portfolio
description: Read and change the content of this portfolio site — projects, case studies, journal entries, the resume, the home page's ordering, uploaded images — through the portfolio_* MCP tools or the `portfolio` CLI. Use when asked to write or edit a journal post or project, publish or unpublish something, hide or retire a project, reorder the home page or the journal, update the resume, upload a hero image, or find out why a save or a daily entry did not happen. Also use before any portfolio_* tool call.
---

# Editing this portfolio

The content is rows in a Cloudflare D1 database, not files in this repository — so
a change is live the moment the write returns, with no build and no deploy in
between. There is nothing to commit afterwards and nothing to wait for. Say so
plainly when reporting a change: "published" means a stranger can read it now.

Two front ends, one boundary. The `portfolio_*` MCP tools are the ones to reach
for in conversation; the `portfolio` CLI does the same things from a shell and has
a few operations the tools deliberately do not (`portfolio provider key`,
`portfolio edit` in `$EDITOR`). Both are clients of `POST /api/content` with the
owner's GitHub token. Neither has a privileged path, so anything refused here is
refused for a reason worth reading rather than a permission worth escalating.

## Read before you write

`portfolio_update` is a **patch**: it writes the fields you pass and leaves every
other column alone. That is what makes it safe to change one thing — and it is
also why you must `portfolio_get` first whenever you are rewriting something whose
current value matters. Never reconstruct a whole row from memory of an earlier
listing; `portfolio_list` does not return fields.

The fields come back with exactly the names a write accepts, so the honest loop is
get → change the keys you mean → update with only those keys.

## The slug is the public URL, and it is permanent

A row's slug is its primary key *and* the last segment of the page's address. So:

- **Never change a slug because a title changed.** There is no rename; a new slug
  is a new row and the old URL becomes a 404 for anyone holding a link. If a title
  edit makes the slug look wrong, the slug stays wrong. Say that rather than
  fixing it.
- **Choose it once, from the title, and confirm it** if there is any ambiguity.
  Lowercase words joined by single hyphens.
- A duplicate slug is refused, not merged. That refusal usually means the thing
  already exists and wants `portfolio_update`.

## Draft, then publish — as two decisions

A journal entry created without a `status` is a **draft**, which is the right
default and should usually be left alone in the same turn. Publishing is a
separate, explicit step, because it is the step that shows the work to strangers.
Write the entry, tell the author it is a draft and where to read it, and let them
say publish.

The three states are `draft`, `published`, `unpublished`. A project has a `hidden`
flag instead.

## Taking something down is reversible; deleting is not

| Want | Do |
| --- | --- |
| Retire a project | `portfolio_update` project, `hidden: true` — off every listing, its page 404s, the row survives |
| Withdraw a post | `portfolio_update` journal, `status: "unpublished"` — the page 404s, the row survives |
| Hide a draft | it already is: a draft never appears in production |
| Actually destroy a row | `portfolio_delete`, which is **off unless the owner enabled it** |

There is no git history holding a copy of this content any more. A deleted row is
gone. Reach for `hidden` and `unpublished` first and offer delete only if the
author asks for it in those words.

Deleting a case study that a project still links to is refused by the database —
clear that project's `caseStudySlug` first, then delete.

## What each kind requires

A missing required field is refused with the field's name, so this is a
convenience rather than a gate — but a create that bounces twice is a bad turn.

- **project** — `title`, `summary`, `category`, `status`, `year`. Optional:
  `tags`, `stack`, `repoUrl` (omit it for a private repository; the page then says
  so rather than linking a 404), `demoUrl`, `caseStudySlug`, `featuredRank`,
  `heroImage`, `highlights`, `hidden`.
  `category` is one of `ml-cv`, `ai-llm`, `full-stack`, `devtools`, `systems`,
  `simulation`, `other`. `status` is one of `active`, `stable`, `wip`, `archived`.
  Both are closed sets; anything else is refused.
- **journal** — `title`, `summary`, `date` (`YYYY-MM-DD`). Optional: `tags`,
  `readTime`, `videoDuration`, `heroImage`, `status`. Plus a markdown `body`.
- **case-study** — `title`, `subtitle`, `problem`, `solution`, `date`. Optional:
  `heroImage`, `heroVideo`, `architectureImage`, `achievements`, `stack`,
  `repoUrl`, `demoUrl`, `readTime`. Plus a markdown `body`.
- **doc** — a singleton holding one JSON document. `portfolio_update` on a doc
  **replaces the whole document**, so always `portfolio_get` it first and send
  back the edited whole.

`summary` is not decoration: it is the card body on the listing and the page's
meta description. Write it as a sentence someone would read, not as a label.

## Bodies are markdown

Write markdown and nothing else. The server renders it and **escapes raw HTML and
unwraps unsafe links on the way in**, so an HTML block will arrive on the page as
visible source text rather than as markup. Fenced code blocks are fine and are
highlighted in the reader's browser — just use ``` with a language.

## The resume has no contact details, and must not gain any

`portfolio_get doc resume` returns the document; the owner's name, email, phone
and address are deliberately **not** in it — they live in `src/lib/site.ts` and
are composed back in on read, so there is exactly one place they are written down.
Never add an identity field to the resume document. Edit `summary`, `experience`,
`skills`, `certifications`, `education`.

## Ordering the home page and the journal

`portfolio_order` writes two hand-picked lists: which projects lead the home
page's Deep dives section, and which posts sit at the top of `/journal`. Call it
with no `slugs` to read the current order before changing it — it also returns
every available slug.

- Pass the **whole** order, first to last. It replaces, it does not merge.
- A **hidden project cannot lead the home page** and is refused. Unhide it first
  or leave it out.
- `automatic: true` clears the hand-picked list and hands ordering back to the
  site's own rule (the projects that have a case study; the posts in date order).

## Images

`portfolio_media` with `action: "upload"` takes a **local file path**, publishes
the bytes and returns a `/media/...` URL to put in a `heroImage`. That URL is
public. Upload only files meant to be published, and prefer paths the author named
in the conversation over ones you found by looking around. `action: "list"` shows
what is already there — reuse an existing image rather than uploading a second
copy of it.

## When something did not happen, read the log

`portfolio_logs` is the site's own record: content writes, uploads, AI runs, and
every daily-journal tick with how it ended. If a daily entry never appeared, or a
save was refused and the reason has scrolled away, that is where the answer is —
`source: "daily"` or `source: "content"`, and `level: "error"` to narrow it.

## Configuration is read-only through the tools

The AI provider rows, the public assistant's settings and the daily journal's
schedule can be **read** freely and are not writable through the MCP server by
default. They decide what the assistant may spend and how often it runs, so
changing one is a decision for the owner at `/admin/ai`, not something to fix in
passing. Report what you see and what you would change; do not try to widen the
gate. Never put an API key in a tool call — `portfolio provider key <slug>` reads
one from stdin, which is the path that exists for it.

## Reporting back

A write returns the live path. Give the author the URL and what state it is in —
"saved as a draft at /journal/thing" is a complete report; "done" is not. If a
write was refused, quote the refusal: those messages are written to name the field
or the link that is in the way.
