# Changelog

Notable changes to the site and its authoring surface, newest first. Dates
rather than versions: this is a continuously deployed static site, and a push
to `main` is the release.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
`docs/DECISIONS.md` explains *why* for anything structural;
`docs/FEATURES.md` tracks what exists and what does not.

---

## Unreleased

### Fixed

- **A model's chain-of-thought reached readers, and got written into posts.**
  Both assistants forwarded whatever a provider put in `delta.content`, which on
  a reasoning model is the model talking to itself before it answers. The public
  chat replied to "what has he built with computer vision?" with *"Here's a
  thinking process: 1. Analyze User Input…"*; the journal editor was worse,
  because `parseDocument` had a fallback treating an unrecognised response as
  body text and a model that deliberates never writes `TITLE:` — so the
  deliberation was committed to the post and rendered in the preview pane.

  Three fixes, none of them sufficient alone: `reasoning: { exclude: true }` on
  the request where the router takes it, a stateful `<think>`-family stripper in
  the SSE re-encoder, and a rule in both prompts. **No frame leaving the Worker
  carries thought text** — the most a client learns is `{"status":"thinking"}`,
  so no future UI change can reintroduce this by choosing to display a field.
  `parseDocument` reports `recognised: false` and the editor routes that
  response to the panel with Copy and Try again. Decision 29.

- **The whole chat transcript was unstyled in production.** `AskWidget.astro`
  builds every turn, bubble, note and chip in script, and styled them with bare
  class selectors — which Astro compiles to `.ask-bubble[data-astro-cid-…]`, an
  attribute script-created nodes never carry. No right-aligned question block,
  no rule down the answer's edge, no chips; the panel *around* it was styled,
  which is what made it hard to spot. Every such rule now hangs off the
  server-rendered `.ask-log` / `.ask-suggestions` through `:global()`. Decision
  30.

- **A generation cut off by its token ceiling looked like a short answer.** The
  `done` frame carries `stopReason`, and the editor says so.

### Added

- **Stop, Try again and citations in the public chat.** The send button becomes
  a stop button while an answer streams (both icons are in the markup — swapping
  them in script would write over an inlined `astro-icon` SVG), and stopping
  deliberately *keeps* what was written where closing the panel discards it. A
  failed question offers Try again instead of leaving a red sentence and an
  empty field. Answers name pages by path already, so those paths are lifted out
  and listed under the answer as links.

- **A real waiting state.** WAITING while the request is out, THINKING once the
  server reports the model is deliberating — the difference between a stalled
  request and one worth waiting for, with no thought text shown in either.

### Changed

- **The writing assistant's ten tasks are three groups** — Write, Refine,
  Suggest — declared on the task rather than decided by the editor. Ten buttons
  in a flat column is a menu read end to end every time; what an author knows
  before opening the panel is whether they want something made, something
  changed, or options to pick from.

- **Suggested titles and tags are pickable chips.** Insert used to take the
  first suggestion and leave the rest to be copied by hand. Each chip applies one
  thing, the panel stays open, and a used chip is marked rather than removed.
  Tags also gained an "Add all".

- **The assistant panel no longer sits over the field it is writing into.** It
  is `position: fixed` bottom-right by design, so the editor's right-hand column
  gets room to scroll clear of it while the panel is open.


### Fixed

- **GitHub sign-in failed with "Token exchange failed (404)", because the Worker
  URL had no scheme.** `PUBLIC_GITHUB_OAUTH_WORKER` was `anishgiri.dev`, and
  that value is interpolated into ``fetch(`${WORKER_ORIGIN}/token`)`` — so a
  bare host is a *relative* URL, and a sign-in from `/admin/` requested
  `https://anishgiri.dev/admin/anishgiri.dev/token`. The token Worker was never
  contacted. It reached production through a manual `npm run deploy`, which
  built from the local `.env` and overwrote a correct CI build whose repository
  variable had the full `https://…workers.dev` origin all along.

  Three changes so it cannot recur silently: `check-content.mjs` refuses a
  scheme-less value at build time (and now reads `.env`, so it sees the value
  locally as well as in CI); `github.ts` treats one as unset, which drops the
  admin into the ungated export-only mode it already handles instead of
  offering a sign-in button that cannot work; and **`npm run deploy` now runs
  `npm run check` first**, matching what CI already did — a manual deploy
  skipping the gate is how this shipped.

- **Dropdowns and the chat panel were invisible, and the cause was one line of
  Tailwind preflight.** `[hidden] { display: none }` carries no weight, so it
  lost to every later author rule that sets `display` — `.btn`, and any
  component-scoped rule, which Astro compiles with a `data-astro-cid` and so one
  specificity step higher. Three things were broken by it:

  - **Every dropdown on the admin opened into the top layer and painted
    nothing.** `select.ts` set `hidden` on the popup and called `showPopover()`
    to open it — and `showPopover()` promotes an element and clears the *UA*
    rule, it does not remove an attribute. Confirmed in Chrome: with `hidden`
    on an open popup, `:popover-open` is `true` and `display` is `none`. The
    popup is now driven by an `.is-shown` class in both directions and depends
    on no spec detail about attributes.
  - **The public chat launcher appeared on every page whether or not the
    assistant was configured, and did nothing when pressed** — because the
    branch that unhides it is the branch that binds its click handler.
  - **The sidebar's Sign out button showed to signed-out visitors.**

  Fixed once, in `global.css`, with the `!important` correction Tailwind 4 ships
  for the same reason — decision 26.

### Added

- **Write a whole journal post from a topic, into every field, live.** The new
  `compose` task fills title, summary, tags, read time and body from one
  sentence, streaming into the fields in that order so the form is visibly
  filling in before the body starts. A task now declares `live` and writes
  straight into the editor, or does not and keeps the panel and its Insert
  button; that one field is the whole rule. Every live run is undoable in one
  press, Stop leaves what arrived, and `revise` rewrites a whole draft to an
  instruction the same way — decision 28.

- **The writing assistant is a docked panel rather than a modal.** A backdrop
  over the editor was fine when everything landed in a box behind Insert, and
  wrong the moment a task writes into the fields — the editor is the thing being
  watched. Escape-to-close is re-added in script; the top layer is deliberately
  not, so select popovers and toasts still appear over it. The selection is also
  read at run time now, so text can be selected with the panel already open.

- **Per-field assist buttons.** Title, summary, tags and the body toolbar each
  carry `data-assist-task`, which opens the panel *and* runs that field's task
  in one press.

- **The public assistant refuses obvious misuse before calling a provider.**
  `screenQuestion()` recognises the unmistakable shapes — "write me a python
  script", "ignore your instructions", translate, arithmetic, weather, general
  knowledge — deterministically, instantly and for free. It is explicitly a
  supplement and not the scope defence: the guarantees remain the budget and the
  corpus. Precision over recall throughout, so "what has he written in Python?"
  and "show me the code from his projects" are still answered; seventeen such
  questions are a test. A refusal is charged to the caller's hour but not to the
  site's daily budget, and is delivered as an ordinary answer rather than an
  error — decision 27.


- **An AI assistant, in two halves that share one credential and nothing else.**

  **On the public site**, a launcher in the corner of every page opens a panel
  that answers questions about the owner — projects, writing, background. It
  answers *only* from what the site has published: `buildCorpus()` builds its
  reference from visible projects, case studies, published posts and the
  resume, and re-applies those visibility filters on what it is handed rather
  than trusting the route that fetched them. A hidden project or a draft post
  cannot be extracted by any prompt, because it is never in the context. Email,
  phone and address are not in there either.

  **In the journal editor**, an Assist panel with ten tasks: write the whole
  post, draft an outline, expand or tighten the selection, write the summary,
  revise the draft, suggest titles, suggest tags, draw a diagram, describe the
  hero image. Some write into the fields as they stream and some land beside an
  Insert button — but none of them writes a row, and Save is still the only
  thing that does.

  **Ships off.** `migrations/0004_ai.sql` seeds `enabled: false` and no key, so
  a fresh database has an assistant that is configured, documented, and not
  answering anyone.

- **`/admin/ai` — providers, keys, limits and the public switch.** Any endpoint
  speaking the OpenAI chat-completions shape: OpenRouter, OpenAI, Groq,
  Together, DeepSeek, a local server. Each row is a base URL, a model, an
  optional separate model for the writing assistant, a key, an `active` flag and
  a priority — and more than one active row is a *fallback*, walked when the
  first refuses or times out, so a vendor having an afternoon is not a visitor
  seeing an error.

  **The key is write-only from that screen.** It is stored in `ai_providers` so
  that adding a provider needs no deploy, and the listing returns a fingerprint
  (`sk-o…cdef`) and never the key itself. The field renders empty with that
  fingerprint as its placeholder, and a blank field is *omitted* from the save
  rather than written — otherwise editing a provider's model would silently
  delete its credential and the failure would surface later, to a visitor.
  Removing a key is a separate button. Decision 22 argues the trade against a
  Worker secret rather than assuming it.

  A **Test** button sends one eight-token completion, deliberately a real
  inference call rather than `GET /models` — that succeeds on several providers
  with a key that is not entitled to infer, which is a green tick in front of a
  broken assistant.

- **A budget, not a prompt, is what guards the public endpoint.**
  `POST /api/ai/chat` is the first route on this site that is unauthenticated
  *and* spends money, and decision 23 is explicit about which of its three
  defences actually hold. Per-visitor hourly and site-wide daily counters in a
  new `ai_rate` table, charged before the model is called and not refunded on
  failure — the failure being defended against is a loop, and a loop that errors
  upstream is still a loop. The increment is a single
  `INSERT … ON CONFLICT DO UPDATE … RETURNING`, so two simultaneous requests
  cannot both read 14 and both write 15. IPs are hashed with a daily salt, so
  the table is a counter and never a log. Question length, conversation depth
  and answer length are all capped, and `clampSettings()` re-caps every number
  on read so the settings form cannot lift its own ceiling.

- **Diagrams as SVG files, not a parser on every page.** The assistant writes
  Mermaid, the admin renders it in the browser, and the SVG goes into the
  existing `media` table — `image/svg+xml` was already an accepted upload type,
  so this needed no new route, no new validator and no new limit. The post then
  references a normal image at a `/media/…` path. Mermaid is dynamically
  imported and admin-only: `npm run build` confirms a public page's only script
  is the 4 KB chat widget. Decision 25 has the two rejected alternatives and why
  `securityLevel: 'strict'` is load-bearing rather than a default.

- **`npm run check:ai`** — 35 assertions on the parts of this that would fail
  silently: that an API key cannot reach the admin listing (checked against the
  *serialised* payload, because that is what leaves the Worker), that a hidden
  project and a draft post are dropped from the corpus whatever the caller
  passes in, that contact details are not in it, that the settings form cannot
  raise its own limits, that `enabled` is `=== true` and never merely truthy,
  that a `system` role cannot be smuggled in through the history, and that the
  assist task list is closed. It deliberately does *not* assert that the scope
  prompt makes a model refuse an off-topic question — that is a property of a
  third party's weights, not of this code.

  It needs `scripts/ts-resolve.mjs`, a small resolve hook that lets plain Node
  follow this repo's extensionless imports. The alternatives were changing a
  compiler setting to suit a test, or giving the tests their own copies of the
  modules.

### Changed

- **`ai_providers` writes go through `POST /api/content`**, against the same
  tested column allowlist in `content-schema.ts` as every other table. There is
  one write endpoint on this site and it has one test; this feature did not add
  a second. `GET /api/ai/providers` exists only because the *read* carries an
  invariant a generic endpoint cannot — the key must never be on the wire.

- **The assistant's settings are a second `documents` singleton**
  (`ai-assistant`), not a table. One JSON row read by two endpoints and written
  whole by one screen — the same shape, and the same reasoning, as the resume.

- **`src/lib/diagram.ts` takes the GitHub token as a parameter** rather than
  importing `github.ts`, which reads `import.meta.env` at module scope and would
  make the file unloadable outside a bundler. Its pure half is what `check:ai`
  tests.

- **`docs/FEATURES.md`'s checks table was stale** from the D1 migration — it
  described `npm run build` as running Zod validation and listed a
  `check:frontmatter` command that no longer exists. Corrected while adding the
  `check:ai` row.

### Fixed

- **A theme token cannot be read back as a colour, and the diagram exporter was
  about to prove it.** `getComputedStyle(root).getPropertyValue('--color-divider')`
  returns the literal string `color-mix(in srgb, #201e1d 40%, transparent)` — an
  unregistered custom property computes to its token sequence with `var()`
  substituted and nothing else evaluated, and half this site's tokens are
  `color-mix()`. Baked into a `fill` on a file served as `image/svg+xml`, that
  renders as black or as nothing. `standalone()` now assigns the token to
  `color` on a throwaway element and reads `color` back, which forces the
  resolution to a real `rgb(…)`.

- **`--color-border` does not exist in this design system.** The chat widget was
  written against it, which would have silently discarded every `border`
  declaration in the panel — a bare `var()` on an undefined token is invalid at
  computed-value time and throws away the whole declaration. It is
  `--color-divider`, the same trap `--space-5` set in the admin sheet.

### Changed

- **"Save Draft" saves a draft.** It wrote `localStorage` and nothing else,
  which made it the one button on this surface whose label was untrue: the
  schema has a `draft` status, the entries list has a Draft filter, and pressing
  it put an entry in neither. It is **Save as draft** now — it forces the status
  and writes the row, so a draft is a draft on every screen that has an opinion
  about drafts. Creating a post also navigates to `/admin/journal/<slug>`
  afterwards, because which post is open is the route (decision 13) and staying
  on the new-entry screen meant a second press was a duplicate-slug refusal.

- **The browser snapshot is offered, not applied.** It is a crash guard — the
  saved state of a post has been its row since content moved to D1 — but it was
  restored on sight, so every visit to `/admin/journal/new` opened last week's
  abandoned paragraph already in the fields, with one line of grey mono
  explaining why and no way to clear it short of the dashboard's Clear Local
  Drafts. It autosaves as you type and surfaces as a bar with **Restore** and
  **Discard**; nothing reaches the form until one of them is pressed, and a
  snapshot identical to what is already on screen is not offered at all.

- **Every screen that still described a commit, a build or a deploy was
  rewritten.** The D1 migration below made "commits a deletion of
  `src/content/journal/<slug>.md`", "it joins the grid at the next build" and
  "Loaded from the last build" wrong on nine screens; the delete confirms were
  the worst of them, because they promised a git history that no longer holds a
  copy of anything. Delete copy now says the row does not come back and points
  at the reversible control — hide, or unpublish — that does the job people
  usually mean. `canWriteContent()` has asked GitHub *who the token belongs to*
  since decision 19, so the banners that read "read-only on `owner/repo`" and
  told the owner to set Contents to read and write were naming the wrong fix
  entirely.

- **Content moved to Cloudflare D1, and publishing stopped waiting for a build.**
  Saving a project, a post, a case study or the resume used to be a commit, a
  GitHub Actions run and about two minutes before a reader saw it. It is now a
  write to a database the pages read per request, so a change is live when the
  request returns. The site still deploys as a build — but only when the *code*
  changes, which is what a deploy was always supposed to be for.

  The public pages are untouched. `src/lib/content.ts` was already the only
  module that queried collections, so it is the only module whose implementation
  changed; every ordering and filtering rule inside it is the code that was
  there before, unedited. Hosting moves from GitHub Pages to Cloudflare Workers,
  and `output` stays `'static'` — /about, the admin's static screens and the 404
  are still files served without waking the Worker. See decision 18.

- **The schema became the validation, and it now runs earlier.** The Zod schemas
  and the relational half of `check-content.mjs` were build-time gates: a bad
  `caseStudySlug` or a category outside the enum failed CI, minutes after the
  mistake. They are CHECK constraints, NOT NULLs and a FOREIGN KEY in
  `migrations/0001_init.sql`, so the database refuses the write when the author
  presses save.

- **The GitHub App is read-only.** Nothing writes to the repository any more, so
  the App dropped from Contents:write to Contents:read (needed only by the
  import screen) plus Metadata:read. Getting there meant moving the last three
  writers: images now go to D1 as BLOBs served by `/media/[...path]`, the resume
  is a row in `documents`, and settings was already export-only. No new
  credential was introduced — `POST /api/content` presents the caller's existing
  GitHub token to GitHub and admits only the owner. See decision 19.

- **The admin says "live now" instead of "after the next build",** because that
  is now true, and links the page rather than the commit.

### Added

- **A media library.** `src/lib/media-library.ts` — a `<dialog>` showing
  everything in the `media` table, read from a new owner-only `GET /api/media`,
  shared by every image field on the page and reached from a **Browse library**
  button beside each one. Until now the only way to reference an image that had
  already been uploaded was to remember its path and retype it, which is exactly
  how a field comes to point at bytes written under a slightly different name.
  Thumbnails are the real `/media/…` URLs, so the grid doubles as a check: a
  tile that renders is a path that works, and a tile that does not says so in
  place instead of letting the path be chosen. Selection is two steps —
  highlight, then confirm — because in a grid of same-sized tiles a single click
  that both chose and closed would make overwriting the current image the
  easiest accident available. The listing never selects `bytes`.

- **Toasts.** `toast()` in `src/lib/admin.ts` is the surface's transient
  feedback channel, rendered into a `transition:persist`ed host in
  `AdminLayout`. Every write already reported into a message line beside the
  control that started it, and those lines stay — but the control is frequently
  in a dialog that closes, below the fold, or on a row that has scrolled away,
  and a save that reported somewhere nobody was looking reported nothing. A save
  opens one `pending` toast and `update()`s it with the outcome, so a save is
  one toast rather than three. The host is a **manual popover**, because half
  the writes here start inside a `<dialog>` and a native dialog renders in the
  top layer where no `z-index` reaches; re-showing it per toast keeps the stack
  above whatever was promoted last. Where `popover` is unsupported it falls back
  to a fixed-position element, which is the behaviour that was there before.

- **Busy states and skeletons.** `setBusy()` puts a turning ring and a verb on
  the button that started a request; `setLabel()` is the same machinery for the
  two-click delete confirms. Both **move the button's children aside** rather
  than writing `textContent` over them — every button here carries an SVG
  `astro-icon` inlined at build, and the old `textContent` swaps deleted those
  glyphs permanently the first time a delete was armed. `.skeleton` is the
  loading shape for a list that arrives over the network.

- `src/pages/api/content.ts` and `src/pages/api/media.ts` — the write endpoints,
  both gated by `src/lib/authorize.ts`.
- `src/lib/content-schema.ts` — the column allowlist a write must pass through,
  and `npm run check:schema` (17 assertions) proving it refuses what it should:
  unknown fields, snake_case column names, inherited object properties, SQL
  fragments as keys, and any upload path that tries to climb out of its
  directory.
- `src/pages/sitemap.xml.ts` — replaces `@astrojs/sitemap`, which enumerated
  build-time routes and would have shipped a sitemap with every project, post
  and case study missing.
- `migrations/` and `npm run seed:d1`, `db:migrate`, `db:migrate:local`.

### Removed

- `@astrojs/sitemap`, and the commit path from `src/lib/github.ts` (`commitFile`,
  `deleteFile`, `readFile`, `rawUrl`) — 142 lines that no longer had a caller.
- `src/lib/frontmatter.ts` and its self-test: with no files to patch in place,
  the in-place frontmatter patcher has nothing to do.

### Fixed

- **Focus mode left a third of the screen blank.** `.is-focus` hid the sidebar
  and the metadata column and stopped there — which left the *grid* untouched:
  still two tracks, the second now empty, so the writing surface kept two thirds
  of the width and the rest was empty paper. Hiding a column is not removing it.
  One track now, capped to a reading measure and centred, with the header capped
  to match so the toolbar does not float off to the right of what it belongs to.

- **The dropdown was the operating system's.** `appearance: none` and a
  hand-drawn caret got the closed *field* to match the surface, but the list it
  opened was drawn by the platform — system fonts, system colours, system corner
  radius, no transition — on a design system with zero radius and a hand-set
  accent. `src/lib/select.ts` replaces the popup with a `role="combobox"` button
  and a `role="listbox"` this system owns: accent highlight, a check on the
  chosen row, an animated caret and an open/close transition, arrow keys,
  Home/End, type-ahead and Escape. The native `<select>` stays in the DOM and
  stays the value, so every `select.value` read and write on the surface is
  unchanged; the popup renders as a popover so it can escape a scrolling
  `.modal-body` and a `<dialog>`'s top layer. Without JavaScript the native
  element is never hidden and the forms work exactly as before.

- **Uploaded images were never actually served.** `/media/[...path]` declared the
  BLOB column as `ArrayBuffer` in the type parameter of `first<…>()`, which is
  an *assertion* — it changes what TypeScript believes and converts nothing. D1
  returns a BLOB as a `number[]`, because its wire format is JSON and JSON has
  no binary type, so `new Response(theArray)` did what `Response` does with any
  non-body object and stringified it. Every image on the site was served as
  `200 OK`, `Content-Type: image/jpeg`, with a body reading
  `255,216,255,224,0,16,74,70,73,70,…`. The bytes were in the database the whole
  time and the URL was correct; on screen it was an upload control reporting
  "Nothing loads from that path" about a path that was perfectly good.

  Nothing could have caught it by type — the type was the bug. `mediaBytes()`
  in `src/lib/media.ts` is the runtime conversion, the column is now typed
  `unknown` at the query so the answer cannot be asserted again, and
  `npm run check:schema` pins every shape a driver might return plus the refusal
  of anything that is not bytes.

- **A blank required field answered in SQLite.** Saving a post with an empty
  summary produced `D1_ERROR: NOT NULL constraint failed: journal.summary:
  SQLITE_CONSTRAINT` — correct, useless, and it reads as a broken site rather
  than as an empty field twenty pixels from the button. `explainConstraint()` in
  `content-schema.ts` turns a refusal back into the field's own name, using the
  same map `bind()` uses in the other direction; the journal editor and the case
  study form now check their NOT NULL columns before the round trip and focus
  the offending field. Problem and solution were missing from the case study's
  checks entirely, which is how an emptied one reached D1.

- **The admin stopped reporting a working navigation as a SCREEN FAULT.**
  Astro's `ClientRouter` drives every admin navigation through
  `document.startViewTransition()`, and when a second navigation begins before
  the first has finished the browser abandons the running transition and rejects
  its `finished` promise — `InvalidStateError: Transition was aborted because of
  invalid state`. The router attaches only a `.finally()` to that promise, and
  `.finally()` on a rejected promise returns a rejected promise, so nothing
  handled it and the error boundary painted a full-width alarm over a screen
  that had just navigated perfectly well. `isTransitionAbort()` filters it, and
  is deliberately narrow: the name has to be one of the three a view transition
  uses *and* the message has to name a transition, so an aborted `fetch` still
  reports. The route progress bar picked up the same class of bug — a navigation
  aborted before preparation finished never reached `astro:page-load`, so the
  bar crawled across the top of a page that had already arrived; it now also
  clears on `astro:after-swap`, and restarts its animation per navigation
  instead of staying parked at 92% from the last one.

- **The import dialog stopped resizing while it loaded.** Sized by its content,
  it opened as a head and a foot with a two-line gap between them and then
  snapped to full height a second later as twenty repositories landed —
  everything in the foot moving several hundred pixels while it was being read,
  and the search field jumping out from under the pointer already on it.
  `.modal-fixed` decides the height before the fetch, and skeleton rows give the
  *inside* of the body the same treatment.

- **Selects look like they belong to the site.** A `<select class="input">`
  inherited the border and the type and then drew the platform's own control on
  top: a rounded chevron in a grey well, on a system with zero corner radius.
  `appearance: none` plus a caret built from two hard-stop gradients — not an
  SVG data URI, which cannot read a custom property and would therefore be a hex
  code that survives every theme switch unchanged.

- **The image upload control is a control.** The 16/9 frame was a `<div>` that
  accepted a drop, so the largest and most obviously clickable thing on it did
  nothing when clicked and the only working affordance was the small button
  underneath. It is a `<button>` now — click, Enter and Space all open the
  picker — capped in height so a full-width panel does not get a 400px empty
  rectangle above every image field, and its empty state says what to do, how
  else to do it and what will be accepted rather than only the first of those. A
  spinner over the frame says which field is waiting while bytes are in flight.

- The image upload size cap was `2 * 1024 * 1024` against D1's documented
  2,000,000-byte BLOB limit, leaving a 97 KB window where the client check
  passed and the database then refused the write with an opaque constraint
  error. Caught by the new schema self-test before it shipped.

### Previously unreleased

### Added

- **Images upload from the admin, and the field shows what it points at.**
  `src/lib/image-upload.ts` attaches a drop target, a file picker and a preview
  to the five path fields that already existed — a project's hero, a case
  study's hero and architecture diagram, the import form's hero, and a journal
  post's featured image. Pick or drop a file and it is committed to
  `public/images/<collection>/<slug>-<field>.<ext>`, with the field filled in
  with the path it now answers to. Before this the admin could write every
  frontmatter field except the one naming a file it had no way to put in the
  repository, so an image meant leaving, committing by hand, and coming back to
  retype the path from memory.
  - The upload commits on pick rather than with the form: an orphaned image in
    `public/` is harmless, a frontmatter path to a file that was never written
    fails `npm run check`.
  - The preview falls back to `raw.githubusercontent.com` when this origin has
    not rebuilt with the file yet — always the case in `npm run dev`, and true
    in production for the minutes between the commit and the deploy.
  - Refuses anything that is not a PNG, JPEG, WebP, AVIF, GIF or SVG, and
    anything over 5 MB, with a sentence rather than a failed request.
  - The journal editor's hand-rolled thumbnail is gone; it was this control
    minus the upload, on one of the five fields.
- **Every "fix your permissions" link now lands on GitHub's repository picker.**
  `grantAccessUrl()` in `src/lib/github.ts` replaces four hard-coded copies of
  `github.com/settings/installations`, which was the wrong page in the state it
  mattered in: signing in **authorises** the App, installing it is what grants
  repository access, and an account that has only done the first has an empty
  "Installed GitHub Apps" list and gets dropped on "Authorized GitHub Apps" —
  a tab with a Revoke button and no repository picker anywhere on it. The new
  link resolves to the installation's own page when the session knows its id,
  `/apps/<slug>/installations/new` when `PUBLIC_GITHUB_APP_SLUG` is set, and the
  Apps you own otherwise. Decision 17.
- **`PUBLIC_GITHUB_APP_SLUG`**, a third public build variable
  (`OAUTH_APP_SLUG` in Actions). Optional and link-building only: with it,
  "Repository access" opens the picker in one click. It cannot be derived from
  the client ID — that mapping needs a JWT signed with the App's private key,
  which nothing in this system holds.
- **Secondary buttons have depth.** `--shadow-sm` at rest, `--shadow-md` under
  the pointer, flat while pressed — the same material and the same tokens the
  cards use, so a button beside a card stops reading as a hole in the page.
  Written once on `.btn-secondary` against theme tokens, which is why Blueprint
  inherits all three steps in its hard-offset idiom and could **drop** its own
  `box-shadow` line rather than gain one.
- **Tablists stick to the top of the viewport.** Every panel behind one is
  longer than a screen — a project's whole frontmatter, a post's body, three
  sections of resume — so switching halves meant scrolling back up to a control
  that had left the screen, which is the one thing a tablist exists to make
  cheap. The header above scrolls away normally and the bar stops at the top.
  `position: sticky` on `.tab-bar` and nothing else: no scroll listener, no
  stuck-state class.
- **The resume editor's sections collapse.** Summary, Experience and Skills are
  `<details>` now, so the disclosure, the keyboard behaviour and a closed
  section's inputs leaving the focus order are all the element's job. Each
  header carries the count a closed section still owes you — characters,
  entries, groups and skills.
- **A session that cannot commit says so before you click anything.** The
  projects manifest's pill goes `checking access…` and then either
  `commits enabled` or `read-only on <owner>/<repo>`, and the footnote under
  the grid explains the two fixes. `canWriteContent()` in `src/lib/github.ts`
  is the check — decision 16.
- **A loading indicator for client-routed navigation.** `#route-progress` in
  `AdminLayout` — a 2px accent bar, `transition:persist` so it is one node for
  the session, shown on `astro:before-preparation` and hidden on
  `astro:page-load`. Navigating to a prerendered project page was a dead click
  for as long as the fetch took. Indeterminate on purpose: there is no number to
  report, so it eases toward the edge and never arrives.
- **The favicon is the portrait**, cropped to the head — the same face the hero
  and the about page show, so a pinned tab is recognisably this person rather
  than a monogram. `public/favicon.svg` is gone.
- **Identity is a screen again, at `/admin/settings`**, and the fifth entry in
  the rail. It was demoted to a dialog on the rule that a destination should be
  something that writes; decision 14 takes that back. The rule was sorting on
  the wrong axis — a modal has no URL, does not survive a reload, loses six
  fields of typing to a stray Escape, and had no room to say the one surprising
  thing about itself. It is **still export-only**, which has not changed and is
  now stated beside the fields rather than under them, and it gains a **Revert**
  the dialog never had. `AdminSettingsModal.astro` and the `data-open-settings`
  delegated listener are deleted.
- **Edit and Preview are tabs in the resume editor**, joining the journal editor
  and a project's page on `wireTabs()`. Side by side, the editing column got half
  the width for four stacked cards of inputs while the preview sat mostly empty;
  neither half had enough room.
- **A page per journal entry.** `/admin/journal` is now a manifest — every
  entry whatever its status, search, filter, the status menu and delete — with
  one primary action, **Create journal entry**. Writing happens at
  `/admin/journal/new` and `/admin/journal/<slug>`, which render the same
  `JournalEditor.astro`. Which post is open is the URL rather than a JavaScript
  variable, so nothing has to be kept in sync with it. See decision 13.
- **Write and Preview are tabs** in the journal editor, and **Frontmatter** and
  **Case study** are tabs on `/admin/projects/<slug>` — both were one very long
  column with the second half below the fold. `wireTabs()` in
  `src/lib/admin.ts` is the shared behaviour: ARIA tablist, arrow-key roving
  focus, panels hidden with the `hidden` attribute so their form controls leave
  the focus order. `#case-study` in the URL opens a project's second tab.
- **A page per project: `/admin/projects/<slug>`.** Every frontmatter field
  with room to read it, the repository's live state beside them, a danger zone,
  and — new — **the linked case study's structured fields, editable in place**.
  Prerendered for every project including hidden ones. The card's **Edit**
  button is now a link to it; the modal on the list screen is import-only.
- **Case studies are editable from the admin.** `patchCaseStudy()` in
  `src/lib/content-store.ts` patches title, subtitle, problem, solution,
  achievements, stack, dates, images and links one line at a time. The MDX body
  is still written in git — that half has not moved.
- **Journal: existing posts are editable, published ones included.** **Edit** on
  an entry loads its frontmatter *and* body into the editor from the last
  build's seed, so it works signed out; committing patches the fields back one
  line at a time and swaps the body, leaving anything the editor has never heard
  of untouched. The filename does not follow the title — an open post keeps its
  slug, so a URL cannot be orphaned by a rewrite.
- **Journal: a kebab menu per entry** — status (all three), open the post, and
  delete the file behind a two-click confirm. It replaces the bare `<select>`.
- **An error boundary for the admin** (`src/components/AdminErrorBoundary.astro`
  + `showAdminError()`/`mountAdminErrorBoundary()` in `src/lib/admin.ts`). A
  throw out of a page's `init`, an uncaught error or an unhandled rejection now
  renders a panel that says what failed and that nothing was committed, instead
  of leaving a screen that looks finished and does nothing.
- **Empty states**, sharing one `.admin-empty` component: no projects tracked,
  no repository matched the import filters, no journal entries, no entry matched
  the filters, no case study linked to a project, and nothing published on the
  dashboard.
- Seven more unDraw illustrations, recolored to the design tokens —
  `the-void`, `fixing-bugs`, `personal-settings`, `code-inspection`,
  `taking-notes`, `empty-mailbox`, `playful-cat`.
- `createPost()`, `updatePost()`, `removePost()` and `buildPostMarkdown()` in
  `src/lib/content-store.ts`, so the journal file format is written down in the
  same place as the project one rather than inside the editor page.
- `setBody()` and `readBody()` in `src/lib/frontmatter.ts` — the body half of
  editing a post that already exists, with the frontmatter block preserved byte
  for byte. Pinned by `scripts/test-frontmatter.mjs`.
- `applyTheme()`, `selectTheme()`, `currentTheme()`, `isThemeId()` and
  `THEME_EVENT` in `src/lib/theme.ts`. Two controls change the theme now, so the
  attribute and `theme-color` juggling belongs to the module that names themes.
- **The admin sidebar is its own component** (`src/components/AdminSidebar.astro`)
  and no longer rebuilds on navigation. `AdminLayout` mounts Astro's
  `<ClientRouter />`, the rail is `transition:persist`, and the collapsed and
  theme states are put back in `astro:after-swap` before paint.
- **Projects: a full frontmatter editor.** Every schema field is editable from
  the card's **Edit** button — title, summary, category, status, year,
  featured rank, tags, stack, repository URL, demo URL, hero image and
  highlights. One read, every change applied in memory, one commit under the
  SHA that was read.
- **Projects: an import modal** driven by the GitHub App's installations.
  Search, four filters, and three honest states per repository — *in
  portfolio*, *granted but not imported*, *not granted* (which links to the
  App's repository access). Adding a repository opens the same form,
  pre-filled with the seven fields GitHub can actually answer.
- **Projects: case-study link, unlink and scaffold**, all from one `<select>`
  in the project form. Scaffolding writes
  `src/content/case-studies/<slug>.mdx` with the structured fields filled in
  and a placeholder body.
- **Journal: three-state status.** `draft` / `published` / `unpublished`
  replaces the `draft: boolean` flag. Unpublishing removes the post from
  `getStaticPaths`, so the URL returns a real 404 rather than lingering as an
  orphan page for anyone holding the link.
- **Journal: status control, search and filter** over existing entries. A
  status change is a single frontmatter patch; the body is never touched.
- `src/lib/content-store.ts` — the write half of the content collections,
  mirroring `content.ts` on the read side. Create, patch, remove, and the
  case-study scaffold all go through one field list and one serialiser.
- `listRepositories()` and `fetchRepoLanguages()` in `src/lib/github.ts`.
- `setFrontmatterList()` in `src/lib/frontmatter.ts`, which replaces a list
  field while keeping whichever style the file already used — inline for
  `tags`, block for `highlights`.
- `onAdminPage()` in `src/lib/admin.ts`, the one entry point an admin page
  script now needs.
- `docs/FEATURES.md` and this file.

### Fixed

- **"Authorize repositories" on the projects manifest was the wrong verb and
  the wrong destination.** Signing in already authorises the App, so a button
  offering to do it again reads as done; what a fresh account is missing is the
  *installation*. It is **Repository access** now, and it goes to the picker.
  The modal footnote, the import list's "Grant access", the read-only banner and
  the 403 message all moved to the same link, and the sign-in screen gained a
  line saying repository access is a separate grant — that is the screen a first
  run starts on.
- **A disabled secondary button lifted under the pointer.** `:hover` matches a
  disabled element perfectly happily, so the hover state promised a click that
  would not be accepted. Every interactive state on that class is
  `:not(:disabled)` now, and `.btn:disabled` drops its shadow outright.
- **A second `npm run dev` could not sign in, and said nothing about why.** The
  dev port is part of the admin's OAuth identity — `http://localhost:4321/admin/`
  is a registered callback on the GitHub App and `http://localhost:4321` is an
  entry in the Worker's `ALLOWED_ORIGINS` — so a server that quietly moved to
  4322 because something already held 4321 failed twice over: GitHub refused the
  `redirect_uri`, and the Worker answered `origin_not_allowed`. What it looked
  like was a sign-in button that had stopped working. `astro.config.mjs` now
  pins the port and sets `vite.server.strictPort`, so a busy port is a startup
  error instead of a silent change of identity. (`strictPort` has to live under
  `vite` — the port hunt is Vite's, and Astro's `server` block drops the key.)
- **Sign-in failures name the value that has to change.** `explainExchange()` in
  `src/lib/github.ts` turns the exchange's slugs into instructions and quotes the
  current origin and callback URL back: `origin_not_allowed` says which origin
  the Worker rejected and where its allowlist is, `redirect_uri_mismatch` says
  which URL to add to the App, `incorrect_client_credentials` says the Worker's
  secret and client ID belong to different apps. `Token exchange failed
  (origin_not_allowed)` was true and left you reading source.
- **Every admin screen was pinned to the left edge of the window.**
  `.admin-main-wide` set a `max-width` and no `margin-inline`, so a 1100px
  column of content sat hard against the rail with the entire remainder of a
  wide screen pooling on the right. Both inner caps centre now, `.admin-main`
  carries one of its own at 1400px for the pages that have no wrapper, and the
  resume editor caps its *whole* screen rather than only its panels — a
  full-width title row over a narrow stack of cards was the same bug one level
  down. The projects grid sizes its tracks from the available width instead of
  a breakpoint, so the cards got wider rather than the gutter.
- **"Resource not accessible by integration" on every admin write.** GitHub
  sends that one sentence for two different situations, neither of them a bug
  in this code: the GitHub App is not installed on the repository, or a
  permission it has is not the one the call needs — Contents stuck on *read* is
  the usual case, because a permission added after installation does not apply
  until the owner accepts it. `explainFailure()` in `src/lib/github.ts` now says
  both, **names the repository the call was actually against** — an edit to the
  AXCAD project fails on the *portfolio* repository, and the old wording sent
  you to check the App's access to AXCAD, where there is nothing to find — and
  links `github.com/settings/installations`.
- **Fetch from GitHub failed for most projects once you signed in.** A GitHub
  App user token only reaches the repositories the App was installed on, so an
  authenticated read of anything else 403s where an *anonymous* read of the same
  public repository succeeds — being signed in was strictly worse.
  `fetchRepoMeta()` and `fetchRepoLanguages()` fall back to the public read on
  403/404. Writes do not fall back and must not. Decision 15.
- **Every admin dialog rendered with zero padding.** All three modal bands asked
  for `var(--space-5)`, which this system does not define — the scale is
  1/2/3/4/6/8. An unresolvable `var()` is invalid at computed-value time, so the
  whole `padding` declaration was discarded and the property fell back to `0`.
  Nothing warns about it: the stylesheet parses, `astro check` passes, the build
  is green. The same bug was on the resume page's experience rail. `.modal-body`
  is now a flex column with a gap as well, because `.field` carries no outer
  margin — it is a grid cell everywhere else — so a dialog that stacked fields
  put every label flush against the input above it.
- **"Building ML systems" broke across two lines.** The hero's marked phrase is
  `white-space: nowrap` — the box is the mark, and a mark split over two lines
  reads as two marks — and the title's measure went from `12ch` to `22ch` so the
  line the mark sits in actually fits.
- **The hero portrait re-downloaded from github.com on every load.** It is now
  `public/images/ui/portrait.webp`, served from this origin: 21 KB of the same
  pixels against a 227 KB PNG behind a redirect to a third party. The `<img>`
  carries `fetchpriority="high"`, since it is the hero's LCP element.
- **The import dialog's repository rows rendered unstyled.** Every one is built
  with `createElement`, so none of them carries the page's `data-astro-cid` and
  the scoped `.repo-*` rules matched nothing at all — the rows came out as
  stacked divs with the action below the name instead of beside it. They are
  `#import-list :global(.repo-…)` now, hung off a server-rendered ancestor,
  which is the same seam the resume editor's generated fields already used.
- **`npm run dev` failed to scan for dependencies.** Three `.astro` files
  spelled `<script>` literally inside a frontmatter comment; Vite's esbuild
  dependency scanner regex-matches that tag in the *raw* source, comments
  included, and handed the surrounding markup to esbuild as JavaScript. The
  build was unaffected, which is why it went unnoticed.
- Dialogs scrolled as a whole, which took the title, the search field and the
  commit button off screen exactly when the content was long enough to need
  them. `.modal` is three bands now — a pinned head, a scrolling `.modal-body`,
  a pinned foot.
- The rail marked no current section on `/admin/projects/<slug>`: the
  server-side match was a prefix and the client-side one, which replaces it
  after every transition, was an equality.

### Changed

- **"Show in preview" moved out of the resume editor's cards and above the
  preview it composes.** Those switches never touched what `buildModule()`
  writes — they only decide which bands of the preview card render — but they
  sat among fields that *do* get committed, which is a label arguing with its
  surroundings and losing. They are a section filter over the preview now, with
  Skills added so no section is the odd one out.
- **The dashboard's Recent Content links to editors, not to public pages.** It
  is an admin screen: arriving from a row means you came to change something. A
  case study has no editor of its own, so its row opens the page of the project
  that links it at `#case-study`, and an unlinked one goes to the projects
  manifest flagged `unlinked`. Because every row now has an admin URL, drafts
  and unpublished posts appear too — the published-only filter existed because
  those have no *public* page, and that reason is gone.
- ~~**Site identity is a dialog, not a screen.**~~ Reverted before release —
  identity is a screen at `/admin/settings` again, listed under Added above.
  The dialog shipped and came back within the same unreleased block; decision 14
  says why the "a destination writes" rule was sorting on the wrong axis.
- The rail is 260px rather than 220px, so the session line — `@handle · 8h
  left` — fits on one row beside the avatar, and its identity block is closed
  with a rule and real spacing above the nav. The grid gap was
  `var(--space-5)`, which is not a token this system defines, so it was
  resolving to nothing.
- The "Theme Engine" section of the old settings screen had a light/dark/system
  control that "has no effect today". It is now a real theme picker over
  `THEMES`, and it stays in step with the rail's toggle in both directions.
- `.modal*`, `.pf-*` and the project screens' shared captions moved from
  `admin/projects.astro`'s scoped block into `src/styles/admin.css`. Four
  surfaces use the dialog and two use the field grid; neither belongs to a page
  any more.
- The projects screen's description says what **Edit** now does, and the import
  modal's title and button say "Import"/"Create project" rather than the
  double-duty "Edit project"/"Commit".
- `ThemeToggle` no longer owns applying a theme — it relabels, and follows
  `THEME_EVENT` so the identity modal can change the theme underneath it.
- Journal `status` is required by `scripts/check-content.mjs`. The schema
  defaults a missing value to `draft`, which is right for a file the editor
  just wrote and wrong for a hand-authored one — without this check a typo
  would silently drop a post out of production instead of failing the build.
- `getPosts(includeDrafts)` is now `getPosts(includeAll)`.
- `AdminLayout` no longer takes a `section` prop. The current nav item is
  derived from the URL, which the persisted rail has to read after a
  transition anyway; two sources of the same fact drift.
- The collapsed-rail state moved from a class on `.admin-shell` to
  `data-admin-collapsed` on `<html>`, so the pre-paint script and the
  after-swap restore write the same thing in the same place.
- Collapsed at 64px, the rail's head now stacks. The avatar and the chevron
  did not fit on one row, which is what the overflowing icons were.
- The dashboard's activity feed lists published posts only — an unpublished
  post has no page, and a row that 404s is worse than a row that is not there.
- `ThemeToggle` looks up the `theme-color` meta tag per call. In the admin it
  lives inside the persisted rail, and a transition replaces the whole
  `<head>`.

### Removed

- The journal editor's `setEditing()`, `resetEditor()`, `openEntry()`, its
  **New entry** escape button and the `is-editing` row highlight. The URL says
  which post is open, so there is nothing left for any of them to do.
- The journal editor's copy of the entries list. It lives on the manifest,
  which means committing a status no longer reaches into a prerendered row the
  editor happens to be standing beside.
- `src/pages/admin/settings.astro`. It is the identity modal now, reachable
  from every screen instead of being one.
- **Settings** as a sidebar destination. Four nav entries, all of which write.
- The per-card **Unlink** button on the projects screen. Linking, unlinking
  and scaffolding are one control — on the project's own page now, where the
  case study it points at is also editable.

---

## 2026-08-17 — GitHub App migration and admin cleanup

### Added

- Icons across the admin surface: `astro-icon` + `@iconify-json/lucide`,
  inlined as SVG at build time. Bare `icon()` in `astro.config.mjs`
  tree-shakes to the glyphs actually referenced.
- `parseRepoUrl()` exported from `src/lib/github.ts`, so the projects screen
  and the module itself share one parser.
- `relativeTime()` in `src/lib/format.ts`.
- Session expiry: `expires_at` is stored beside the token and the rail shows
  the hours remaining.

### Changed

- **Sign-in is a GitHub App, not an OAuth App.** Permissions (Contents write,
  Metadata read) are granted per repository at install time, which is what
  makes "which repositories may this session touch" a question with an answer.
  One App carries both the production and `localhost` callbacks, so local
  admin no longer needs a second app that drifts from the first.
- **The Worker drops the refresh token.** GitHub returns a ~6-month
  `refresh_token` beside the 8-hour `access_token`; the exchange response is
  rebuilt key by key and the refresh token never leaves the Worker.
  `workers/github-oauth/test.mjs` pins this by stubbing the upstream response.
- The admin sidebar is pinned to the viewport rather than stretched to the
  document, so the identity block and **New Post** stop sinking to the bottom
  of a long page's scroll.
- Identity moved to the head of the rail: `site.name` before sign-in, the
  GitHub login and avatar after.

### Removed

- `OAUTH_SCOPE` and the `scope` search parameter — GitHub Apps ignore both.
- The `[dev.identity]` placeholder wordmark, in all four places it appeared.
  It was a deliberate mark, and it read as a failed variable.
- The projects screen's `localStorage` visibility map and its **Export
  Visibility JSON** button: a second source of truth for `hidden` that had to
  be applied by hand. Signed out, the switches are now disabled.
- The journal editor's "AI Tools" card — two permanently disabled buttons and
  a note explaining they could not work.
- The dashboard's "Manage Tags" quick action, which linked to a screen with no
  tag management.
- `splitRepo()` and a local `rel()` in `admin/projects.astro`, both duplicating
  something `src/lib/` already owned.
