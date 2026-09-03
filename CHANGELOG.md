# Changelog

Notable changes to the site and its authoring surface, newest first. Dates
rather than versions: this is a continuously deployed static site, and a push
to `main` is the release.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
`docs/DECISIONS.md` explains *why* for anything structural;
`docs/FEATURES.md` tracks what exists and what does not.

---

## Unreleased

### Added

- **Fenced code is lit, framed and dealt in.** `src/lib/code-fx.ts` colours
  every listing in a post or a case study in the browser — the write-time
  markdown processor cannot run a highlighter at all (decision 45), so the
  page shipped grey slabs on a site whose posts are mostly code. Eight
  grammars, no dependency, and the source text is never rewritten: every
  token is the original string, escaped, so copy, find-in-page and a screen
  reader all still get the program. Each block gains a real chrome bar in its
  theme's voice — Geometry's window dots and `~/`, Blueprint's `// LISTING`,
  Paper's `fig. —` — with a Copy button, and its lines arrive one at a time
  when the block scrolls into view. Colours are `--code-*` tokens: two hues
  and the neutral ramp, so a listing still looks like the theme it is in.
  Nothing here runs under `prefers-reduced-motion` but the colours, and with
  no JavaScript the block is exactly what it was.

- **Let's connect: a contact section as a terminal session.** The home
  page's closing banner is now a two-column contact section. Left, a shell
  window that types and answers `whoami`, `cat contact.txt` and `ping` when
  it scrolls into view — email, location, a live clock in the owner's
  timezone, availability — with GitHub, LinkedIn and X as terminal-flavoured
  cards under it. Right, a developer's form (name, email, subject, message,
  **Send Transmission**) that composes a `mailto:` — this site has no inbound
  mail endpoint on purpose, and the hint under the button says so. Stacks on
  mobile. The footer is now a two-row status line with the profiles as
  `--flags` and the stack named. `site.ts` gained `twitter`, `availability`
  and `timezone`; the X handle is **assumed** from the GitHub login and
  should be corrected there.
- **The `~/` wordmark, on every theme.** The blinking-bar path wordmark that
  was Geometry's is the site's: Blueprint and Paper drop their `[brackets]`
  and paint the bar in their own accent through `--brand-bar`. The same
  voice reaches the page heads as `PathLine` — `user@host:~/projects $ ls`,
  typed in on arrival — on Projects, Journal, About, every project, post and
  case study, and the home hero, whose `whoami` decodes the eyebrow in.
- **Text effects and a live transform, without a dependency.**
  `src/lib/text-fx.ts` is a scramble/decode and a typewriter on
  `requestAnimationFrame`, keeping the real string in the DOM for readers and
  find-in-page and doing nothing under reduced motion. `MathVisual.astro` is
  a wireframe cube under `Rₓ(φ)·Rᵧ(θ)` whose nine matrix cells and tracked
  vertex are rewritten every frame from the numbers that placed the lines; it
  sits in the Projects header on every theme and pauses off screen.
- **Blueprint and Paper move.** Blueprint's section rules are drawn in by a
  plotter, its marked phrase is traced by travelling dashes, its light pings
  in rust and its swatch blinks like a ready LED; Paper's highlighter stroke
  draws in, its dot taps like a pencil, its rules are ruled in by hand and a
  card lifts with a fraction of a turn.
- **Project pages and case studies say more.** A mono spec sheet
  (`category = …`) in the project sidebar, numbered highlights that arrive in
  sequence; on a case study an at-a-glance strip under the head, numbered
  sections and outcomes, staggered reveals, and a two-pixel reading-progress
  bar that turns to the second accent when the write-up is read to the end.
- **The admin rail.** Collapsed, every icon grows a tooltip from its label;
  the avatar wears a session ring that empties with the eight-hour token and
  pulses under an eighth; group labels rule out to the edge; the current
  marker grows in; **Ctrl/⌘+B** toggles the rail.
- **Both chats move.** Turns rise in from the side their rule is on, a block
  caret sits after the last streamed glyph, the assistant's rule goes accent
  while a reply is live, the header carries a live dot (read off existing
  state with `:has()`), chips and lookup rows land in sequence, and both
  panels take the theme's radius.

### Fixed

- **The dark bar in the top-left corner of every page.** The skip link is
  parked above the viewport by a transform, and it was positioned at a 16px
  inset and moved off by the same 16px — landing its bottom edge on exactly
  y=0, where its border still painted a row, and where `--shadow-lg` (a hard
  4px offset on both drafting themes) painted a solid bar. It now sits at the
  top edge, clears it by 4px, and carries its elevation only while focused.
- **The section band is one boundary on all three themes.** Paper drew it
  56px deep against everyone else's 72 and marked its corners with round pins
  rather than squares; both are shared tokens now. Its kraft fill and offset
  sat on the full-bleed band rather than on the column-width cell, so on any
  wide screen the strip ran past the drawing as two blank rectangles with a
  hard line under them — the paper is the cell now, and the ground shows
  either side of it. Geometry and Blueprint drew the band, its marks and its
  hatch in `--color-divider`, which on Geometry is four values off the
  ground; the band has its own `--sep-ink`, a real step down each theme's
  ramp. And between 1121px and 1160px the corner marks were sliced in half by
  the band's own clip — the frame stands down at 1160 now, where a whole
  square fits.
- **Case studies, project pages and posts use the site's own separator.**
  All three closed their cover block with a hairline `<hr>` while every other
  page used the full-bleed drafting band. Each is now an article containing
  `.container` blocks with bands between them, so a boundary looks the same
  wherever a reader meets one.
- **Geometry's primary action carries the theme at rest.** It was a plain ink
  pill: the sweep only appears under a pointer and this theme hides the
  registration ticks, so the button the page is built around showed nothing
  of the design until you touched it. It now has a violet-into-ember gradient
  ring, a mono label, and a bloom that lifts on hover as the wedge sweeps in.
- **The header no longer overflows on a tablet.** The nav wrapped its links
  to a second row below 640px, but the row measures a little over 920px — so
  every width from 641 to 920 was a bar that did not fit and a document with
  a horizontal scrollbar. The breakpoint is 960px.
- **The top bar no longer jumps between pages on Blueprint and Paper.**
  Geometry drew its nav links as padded blocks with a reserved transparent
  border and faded the hover; the drafting themes drew bare text with an
  instant colour snap — so the bar measured differently per theme and every
  hover arrived as a flicker. The link box (padding, border, transition) is
  the shared layer's now and identical everywhere; a theme only dresses it.
  The theme toggle's label also keeps a fixed width, so the script
  correcting it to the stored theme after paint no longer resizes the bar.

### Changed

- **Geometry has its portrait back.** The orbit no longer replaces the photo;
  it frames it — the portrait is a disc in the inner ring, and drifts.
- **Paper's separator is a strip of kraft tape**: surface-coloured, sepia
  cross-hatch, pencil-dashed edges with the theme's hard offset, rust
  registration marks. The shared hatch over Paper's own laid lines was moiré
  in no palette. (The tape covers the column rather than the viewport, and
  its marks are squares like every other theme's — see Fixed, above.)
- **Square corners everywhere.** The section frame's registration marks were
  the only squares on the page while Geometry rounded everything else into
  pills and soft radii. All three themes are sharp now — cards, buttons,
  tags, inputs, code windows and the nav keep square corners, and Geometry's
  primary gets its registration ticks back, sitting inside the corner they
  were hidden from. Dots stay dots: status lights, portraits and window
  controls were never corners.

### Removed

- The closing banner and its `.btn-on-accent*` rules across all three themes;
  the Geometry-only `geometry-page-art` slot on Projects (the transform took
  its place on every theme). `geometry-circuit.svg` is no longer referenced.

- **Three themes, and a drafting frame around every page.** The site now
  ships Geometry (default), Blueprint and Paper, and nothing else — Classic,
  Nocturne and the short-lived Motion are retired, Instrument Serif with
  them. Geometry is a near-black drafting board after the reference launch
  page: hairline cells with `+` crosshairs and `01 /` indices, `//` mono
  eyebrows, a violet-to-ember sweep on the primary button and the hero's
  marked phrase, pill buttons and pill nav, a `~/` wordmark, a blinking
  caret in the theme switch, code blocks framed as terminal windows, a
  closing cell with the gradient as its top rule, and a wireframe orbit in
  the hero that slowly turns. Blueprint's grid becomes graph paper (a heavier
  line every fifth cell), its eyebrows count `§1, §2 …`, its cards are
  `FIG. 01`, tags are hairline callouts, listings carry a `// listing`
  register mark, and its closing banner is a navy title block. Paper's
  eyebrows and figures count too (`§1`, `fig. 1`), its cards are index cards
  with a double-ruled top, the hero phrase wears a highlighter stroke, tags
  are pencilled, and the closing band is kraft.

  Between sections, every theme now draws the reference's separator: two
  vertical rails running the column's full height, a full-bleed hatched band
  at each boundary, and a small node wherever a rail crosses a rule. One
  mechanism in the shared layer (`.section-sep`, `SectionSep.astro`), voiced
  per theme through tokens — solid rails and square nodes on Geometry,
  dashed rails and rounded squares on Blueprint, pencil-dashed rails and pins
  on Paper. Rails and nodes stand down below the column width and in print.

### Changed

- **`data-theme` is always on `<html>`.** With no attribute-less theme left,
  the layouts render the default into the tag, the pre-paint script only
  corrects it, and `applyTheme` never deletes it. A stored id for a retired
  theme falls back to the default rather than to a page with no palette.
  `src/styles/theme.css` is now the base-token sheet — spacing, radii,
  motion, widths, the grain plumbing and the frame's tokens — and carries no
  colour of its own.

- **The assistant panel docks, and the page makes room.** The header's
  placement button now shows where the panel *is* — right edge, left edge, or
  floating free, one icon each — and cycles through all three on click; the
  free placement is a first-class stop rather than something only a drag could
  reach. While it is pinned to an edge, the page's content column narrows by
  the panel's width instead of being covered, so docked writing no longer
  hides what it is editing. Everything survives a reload alongside the size
  the grip already remembered.

- **The assistant picks its own command.** Type "write a case study for this"
  or "suggest some tags" and the panel resolves it to `/write-case-study` or
  `/suggest-tags`, showing which job the words became; edit-shaped requests —
  "make my title shorter" — stay in conversation, where the reply is applied
  to the fields directly. A slash followed by a word that names no command
  gets the same one try before the "there is no such command" note.

- **Conversation can now update the case study.** On a project's screen, an
  assistant reply that opens with the write-up's labelled fields — `PROBLEM:`,
  `SOLUTION:` — lands in the case-study form with a snapshot behind it, the
  way project edits already landed in the frontmatter. Both shapes are tried
  and the request's own words break ties when both would fit, so "update the
  case study title" writes the title above the write-up rather than the
  project's.

- **An import drafts with its work on screen.** "Draft with AI" on the import
  form used to run behind a disabled button and a one-line status: twenty
  seconds whose only sign of life was the fields filling in, and nothing at all
  while the model deliberated first. `/admin/projects` mounts the same assistant
  panel both authoring screens do now, so the thinking, the lookups and any
  failure land where they do everywhere else. The two case-study writes an
  AI import makes on save go through it too. The answer still streams straight
  into the form.

- **Ask the assistant for a change and it makes the change.** A reply to the
  panel that opens with a labelled field — `TITLE: …`, `SUMMARY: …` — is applied
  to the editor's fields with a snapshot behind it, instead of landing in the
  bubble as text to copy across by hand. A question still gets prose. Both
  authoring screens, `parseEdit()` is what tells the two apart, and Undo is
  three runs deep as it is everywhere else. Decision 48.

- **The journal manifest arranges itself.** Entries are on two shelves — Active
  for published and drafts, Archived for withdrawn posts — and an order control
  offers newest, oldest, recently edited and title. Every row now carries when
  it was last written as well as its own date, which is the timestamp that says
  where you left off; a status change moves the row to the other shelf rather
  than leaving it under a heading that has stopped being true.

- **Fields grow with what is in them.** The summary, highlights and case-study
  fields the assistant writes into now grow as text arrives rather than becoming
  a two-row window onto their own contents, capped at 60% of the screen.

- **A case study has a write-up, and the assistant can write it.** `case_studies`
  has always had a body column and nothing on any screen ever wrote it, so every
  case study on the site was a header over the one paragraph the scaffold
  inserts — which is why they read as empty. The Case study tab now has the
  markdown field, saved with the header in one write, and
  `/write-case-study-body` drafts it from the repository and from the problem
  and solution above it. Decision 46.

- **The import modal shows what GitHub already told it.** Primary language,
  stars, when it was last pushed, the licence and the author's own topics, per
  row. None of it costs an extra request — it all arrived with the listing and
  was being dropped on the floor. Decision 47.

- **Draft with AI, in the import form.** The same `/write-frontmatter` task the
  project page runs, on the repository's metadata and its README, streaming into
  the fields before the project exists. The case-study picker gained a second
  create option beside the scaffold: write the header *and* the write-up from
  the repository.

- **A resume is a master and any number of variants.** Your job history, skills,
  education and certifications are written *once*. A variant is a view of it —
  which roles, which skill groups, which certifications, which projects, in what
  order, with an optional per-role rewrite for the ones that need role-specific
  framing. Fix a date in the master and it is fixed on every resume. One of them
  is flagged as what `/resume` shows strangers; the rest are for sending. It is
  all one row in `documents`, for the reason that row exists at all — decision 39.

- **Projects on the resume come from the projects table.** A variant holds a slug
  and the one line that project gets on *this* resume; the title, the URL and the
  fallback description are read live, so a renamed project is renamed on every
  resume and a hidden one is never cited.

- **Export is a real A4 sheet, in any of three layouts.** `ats` is a single
  column with no grid and no positioned elements, because an applicant tracking
  system reads the PDF as a stream of text and a two-column page interleaves the
  columns into gibberish. `sidebar` is the designed one, for applications a
  person reads. `timeline` is the sheet this site had before the renderer existed
  — rail on the left, accented section headings, roles hanging off one
  chronological spine — brought back because it is the one that looks like the
  rest of the portfolio. A4 at 14mm, 10.5pt, no entry ever split across a page
  break. The layout is a field on the variant **and on the master**.

- **Four assistant tasks on the resume screen** — tailor the summary to a pasted
  advert, suggest which projects belong on it, rewrite one line, and build a whole
  variant from a job description. Same closed table, same panel, same endpoint;
  the variant builder returns *identifiers the author already has* rather than
  prose, and every one of them is checked against what exists before anything is
  applied. Decision 41.

- **Dark mode, on every theme.** `data-mode` is a separate axis from `data-theme`:
  light, dark, or unset — where unset follows the operating system, which is what
  a first-time visitor gets. Switching palette family keeps you in whichever mode
  you were reading in. Decision 38.

- **`npm run check:resume`** — the month parser, the variant resolver and the
  renderer's escaping, as assertions. Wired into `npm run check`.

- **The AI screen is two tabs.** **Providers** is the endpoint list, plus a rail
  explaining how one gets picked and reminding you these rows answer the writing
  assistant too. **Public assistant** is the switch that bills the account, the
  voice, the limits and what it knows. They were one column and one rail, so the
  switch sat beside a list of model ids. The head's two actions follow the tab.
  Decision 44.

- **A thinking setting on the public assistant, defaulting to Low.** Answer length
  bounds reasoning *and* prose together and can never say how a model divides
  them; this is the field that can. Decision 43.

- **`npm run probe:ai`** — the AI pipeline against a real provider, using the key
  in `.env`. Not part of `npm run check` and never will be: it needs a credential
  CI does not have. It checks that the model listing still parses, that the
  request body is one a vendor accepts, and that a streamed answer with tools
  drives the loop end to end — and it prints the thinking-vs-answer split, which
  is the number the limits screen is actually about.

- **Every field `site.ts` owns is on the Identity screen.** It edited six of
  sixteen; the short role, the tagline, the phone, the postal address, the GitHub
  username, the repository, the origin, the OG image and the portrait were
  reachable only by opening the file, and Export JSON produced an object that
  could not be merged back without hand-adding the rest. The export is the whole
  object now, keyed the way the module is. The theme card gained the light/dark
  switch it had been missing since `data-mode` became a second axis.

- **One switch on this surface, not two controls meaning the same thing.** The
  AI screen's four checkboxes are the same `role="switch"` toggle the projects
  screens have always used. `src/lib/switch.ts` replaces them the way `select.ts`
  replaces a dropdown — the checkbox stays, hidden, and stays the value — so no
  screen's `.checked` reads or writes changed.

### Fixed

- **Scaffolding a case study shows the case study.** The button wrote the row
  and the link and then asked the author to reload — the editor under it is
  rendered from the project row, so nothing in the page could show a case study
  that did not exist when it was served. It reloads itself now, back onto the
  Case study tab.

- **A case study with a code block ran off the right of the page.** The write-up
  sits in a 4fr/8fr grid, and a grid item's automatic minimum is the min-content
  width of what is in it — so one unbreakable `npx skills add …` line several
  hundred characters long widened the track, took the whole grid past the
  container, and every paragraph on the page overflowed with it. `overflow-x:
  auto` on the block could not help until the track was allowed to be narrower
  than its contents. Long inline code wraps now too.

- **The projects filter used the operating system's dropdown.** `select.ts` was
  mounted only from `AdminLayout`, so the one public `select.input` on the site
  opened a system popup in system fonts beside a design that owns every other
  control. The dropdown's rules moved to `global.css` — the shared component
  layer, which is what makes it one control rather than two — and `/projects`
  mounts it.

- **Saving a post or a case study with a body failed in production.**
  `Failed to parse Markdown file "undefined": WebAssembly.instantiate(): Wasm
  code generation disallowed by embedder` — Astro's markdown processor
  highlights code with Shiki, Shiki's default regex engine is a WebAssembly
  module, and the Workers runtime refuses to compile one. It built that
  highlighter for every body it rendered, code block or not, so every save with
  text in it threw and every save without one worked. Invisible everywhere else:
  `astro dev` renders in Node, and the build no longer renders markdown at all.
  Highlighting is off, code blocks are styled from the theme tokens as they
  always were, and `npm run check:content` fails the build if it ever comes
  back. Decision 45.

- **`/build-variant` came back "not in the expected format" and applied
  nothing.** Two halves. The output contract is restated as the last thing the
  model reads, which is the position it weights hardest; and a reply that writes
  its labels as markdown headings — `**Summary**`, `## Experience` — now parses
  instead of being thrown away. When a parsed reply matches no role, skill group
  or project you actually have, the screen says so rather than reporting success
  over a variant nothing changed in.

- **A project's hero image never appeared on the project's own page.** The
  cards have shown it since there were cards; the detail page destructured
  every other field and not that one, so an uploaded image was visible
  everywhere except where the project is actually read.

- **A dropdown near the right edge opened off the screen.** The menu is aligned
  to its trigger's left edge and can be several times wider, and nothing clamped
  it to the window — a popover is in the top layer, so there is no scrollbar that
  could bring it back. Dragging a long list's scrollbar also closed it, because a
  press anywhere on the popup that was not a row moved focus off the button.

- **Printing the resume produced a three-page sheet in a 52mm column.** A printed
  A4 page at 14mm margins is a 182mm measure — **688px** at CSS's 96dpi — so
  `resume.css`'s `max-width: 760px` breakpoint was firing on every printed page.
  It stacked the sheet and placed both halves of `.rs-body` into explicit grid
  cells; the print block below re-declared the *columns* and not the
  *placements*, so everything landed in track one with two thirds of the page
  blank beside it. Both breakpoints are `@media screen and (…)` now. One page,
  correctly laid out, in all three layouts.

- **Printing from dark mode printed a washed-out sheet.** The dark ramp applied
  to paper, so `--color-text-muted` and `--color-text-faint` resolved to *light*
  neutrals — the summary, the dates, the skill values and every section heading
  printed pale grey on white, and with "Background graphics" ticked the page was
  solid ink. Both dark blocks in `theme.css` and `blueprint.css` are inside
  `@media screen` now: paper has no dark mode. The four hard-coded hexes the
  print block used to carry to paper over the top of this are tokens again.

- **The page ground printed ivory.** `--color-bg` is right on a screen and is a
  page a printer fills with ink to reproduce a colour the paper already is. The
  reset is on `html` as well as `body` — the canvas background, including whole
  trailing pages, propagates from `html` — and it moved from the resume route
  into `global.css`, because the admin's Print button renders the same sheet and
  a rule scoped to one route never reached it.

- **`npm run check` now refuses a breakpoint that can reach paper.** Both bugs
  above were invisible: green typecheck, green build, correct on screen.
  `check-content.mjs` computes the printed page width and fails any `max-width`
  query at or above it that is not scoped to `screen`, and fails a stylesheet
  that declares a dark palette without scoping one to `screen`.

- **The primary button is two-tone again.** It had become a solid terracotta slab
  with a darker red sweeping over it on hover — which shouted on a page whose
  whole argument is restraint, and lost the sweep, because a darker red arriving
  over a lighter one is a hover state nobody notices. It is ink again, with the
  accent wedge crossing it at 120° on hover and a registration tick in two
  corners. The ticks are inset 4px rather than hung on the corner at `-1px`,
  which is where they were before this theme had a corner radius and why they had
  been dropped: a square pinned to the corner of a rounded rectangle sits outside
  the curve as a loose speck.

- **The master resume can choose its sheet.** The Sheet picker was populated from
  `RESUME_LAYOUTS` and hidden whenever the master was open, because there was
  nowhere for the choice to go — `resolveVariant()` hard-coded `sidebar`. It is a
  field on the document now, and the "Shown on /resume" picker came back with it:
  choosing which variant is public required opening a variant first, which is the
  wrong way round. Decision 42.

- **The resume masthead's job line was being styled as a job.** It and every entry
  in Experience were both `class="rs-role"`, so two declarations meant for a
  one-line tagline — 0.95em, muted — were landing on every role on the sheet.
  Nothing looked obviously wrong until the `timeline` layout hung a spine and a
  node off the same class. It is `rs-headline` now, and `check:resume` pins it.

- **A provider row no longer lifts every call to the model's maximum.** It raised
  a task ceiling to whatever the vendor's listing reported, routinely 32,000 — so
  the Answer length limit on the AI screen was decorative on the one endpoint an
  unauthenticated stranger can reach, and a model told it has 32,000 tokens and
  asked to think hard used them. It raises to a working ceiling now and no
  further; a task that needs a long answer still asks for one and still gets it.
  Decision 43.

- **`openrouter/auto` no longer shows a negative price.** The row really does come
  back priced `-1`, meaning "depends what this routes to"; multiplied out it
  rendered in the model picker as `-$1000000.00 / M`. Unknown is the honest
  reading. Found by `npm run probe:ai` against the live listing, which is the only
  place a row like that exists.

- **`npm run check` passes again.** Two assertions in `check:ai` read the secret
  they test masking on from `process.env.OPENROUTER_API_KEY`, so they passed on a
  machine with a key exported and failed for everyone else — CI included. It is a
  literal, which is also the right shape: those assertions print the first and
  last four characters of whatever they are given.

### Changed

- **A journal post is as wide as a case study.** The post page was
  `container-prose`, which is a 720px *page* rather than a 720px column, so its
  hero, title and footer were squeezed into the measure meant for its
  paragraphs. It is the full container now with the write-up in the same 4fr/8fr
  split `CaseStudyLayout` uses, and the two long-form pages read at one width.

- **The admin rail's footer is three controls rather than a stray link.** Sign
  out and the public site are both secondary buttons on one row under the theme
  controls; the ghost link under them read as a line of text that had come
  loose.

- **Modernist is gone; Classic is the default theme.** Ivory paper and near-black
  ink, terracotta accent, Instrument Serif over Inter, a faint grain, soft corners
  and blurred elevation — ported from the `design/classic-theme-old-repo` branch,
  which had a complete dark palette that neither shipping theme did. Not one
  component in `global.css` was rewritten for it: the tokens were rebound, which
  is the whole point of decision 25's arrangement. Three things did change, all
  because the display face is now a serif rather than the body face — buttons and
  the `h6` eyebrow moved off it, and `.btn-primary`'s corner ticks (and
  `.button-borders` with them) were deleted, because a square drawn at the corner
  of a rounded rectangle sits outside it.

- **The resume editor is a different screen.** A variant bar, a *Master content*
  tab for the history, a *Tailor* tab for one variant's selections and rewrites,
  and a *Preview* tab showing a real A4 sheet. Roles carry `start`/`end` months
  and a list of highlight bullets rather than one typed date string and one
  paragraph; the duration is computed, so it can never be stale again.

- **The admin preview is the live page.** `renderSheet()` is one function
  returning one HTML string, and the public page, the editor's preview and the
  printed PDF all use it under one stylesheet. The preview used to be a
  hand-built approximation in the editor's script sitting beside an `.astro`
  component rendering the real thing — "the preview does not match" was the
  arrangement, not a bug. `ResumeAside.astro` is deleted. Decision 40.

- **Scroll reveal and hover affordances**, from the same branch: sections fade in
  as they arrive, links and buttons grow an arrow, underlines draw on hover. The
  reveal is armed before paint and disarmed by a three-second timer, so a page can
  never be stranded invisible by a script that failed to load.

- The pre-paint theme script was in three `<head>`s and is now one
  `ThemeHead.astro`.

### Fixed

- **`npm run check` was red on `main`.** `scripts/test-ai.mjs` had its fake API
  key fixture replaced with `process.env.OPENROUTER_API_KEY`, so two assertions
  passed only on a machine with a real key exported and CI has none. Restored the
  literal — and those assertions print the first and last four characters of
  whatever they are given, which should never be a real credential's.

- In the one-column sheet, the Skills heading collided with the last project: the
  main column's `:last-child` margin reset fired against the *aside* that follows
  it. Sections are spaced by their container's `gap` now, and a gap has no last
  child.

### Previously unreleased

#### Added

- **The assistant looks things up instead of being handed the whole site.**
  Every question used to carry the entire corpus — identity, résumé, every
  project, every case-study excerpt, every post excerpt — in the system prompt.
  Affordable once; on the tenth message of a conversation it is the whole site
  billed ten times to answer ten questions, most of which touched one post. The
  prompt now carries an *index* (a line per thing, with its slug) and five
  read-only lookups fetch the rest: `search_content`, `read_post`,
  `read_project`, `read_case_study`, `read_resume`. Nothing in that table
  writes, nothing in it takes anything that becomes SQL, and every one of them
  re-applies the public filters, so a hidden project and a withdrawn post are as
  unreachable through a lookup as they were through the corpus. Decision 37 is
  explicit about why this does not reopen the closed task table.

- **Lookups are shown, in both panels.** A row per call — the tool, what it was
  given, how long it took — above the answer. On the writing assistant it reads
  like a terminal; on the public widget it is quieter and reads as provenance,
  which is the panel's "a model reading published pages" line made specific.

- **A model picker, an effort picker and a lookups switch, on the assistant
  panel itself.** All three are things an author changes between two runs, and a
  setting you have to open another screen for is a setting nobody turns. The
  server validates a chosen model against the configured provider rows and
  ignores anything else — a model id in a request body would be a caller
  choosing what the owner's key pays for.

- **The writing assistant resizes**, from the same top-left grip the public chat
  has, with the size remembered per browser.

- **Providers gained an output ceiling, a reasoning effort, a lookups switch and
  a prompt-cache switch.** The ceiling is filled in from the vendor's own model
  listing the moment a model is picked, so "use the model's maximum" is the
  default rather than something to look up. The model browser now shows each
  model's completion limit, and whether it advertises tools and reasoning.

- **The stable half of every prompt is one leading message, marked cacheable.**
  Rules, persona and index first; the task and the fields after. On OpenRouter
  and Anthropic that becomes a `cache_control` breakpoint; everywhere else it is
  dropped and an unchanging prefix is enough on its own. The per-task
  instructions used to come *first*, which meant no two requests shared a prefix
  and no provider's cache could ever hit.

### Changed

- **A token ceiling now clears the thinking by default.** `max_tokens` bounds
  reasoning *plus* answer, so the per-task numbers — sized to their answers —
  were the direct cause of a reasoning model narrating for fifteen thousand
  characters and never writing the post. A provider row naming the model's real
  maximum **raises** every task ceiling to it and never lowers it, the settings
  ceiling went from 4,000 to 32,000 (the same constant the provider ceiling is
  capped at), the public assistant's default answer length from 600 to 2,000,
  and every task's own floor was raised. Nothing is billed for a ceiling that is
  not reached.

- **A model that cannot be given tools degrades instead of failing.** If every
  model refused with a 4xx while tools were sent, the walk runs once more
  without them rather than reporting "every provider refused".

- **The AI screen's "what it knows" now reports what a request actually
  carries** — the index — beside the size of the writing that is fetched a page
  at a time.

### Fixed

- **The thinking a reader was told to open was never sent.** Every request to
  OpenRouter carried `reasoning: { exclude: true }`, on the argument that a
  token never generated cannot leak. It did not work — the models that hurt
  narrate in `content`, which that switch has no reach into — and it was
  expensive in the one currency that mattered: the deliberation was generated,
  billed, and thrown away by the router before it reached the Worker. So a run
  that spent its whole budget thinking said "open Thinking to read it" over an
  empty box. The field is gone; reasoning arrives on its own channel and is
  shown as it streams.

- **A model deliberating looked like a model that had hung.** The thinking
  disclosure was closed until the run ended, so the twenty seconds before the
  first token were a panel with nothing in it. It opens itself now, follows its
  own tail as text arrives, and closes again on the first token of the answer —
  unless the reader has touched it, in which case nothing programmatic moves it
  again.

- **A reasoning model's narration still reached readers, because it marked it
  with nothing.** The `<think>`-family stripper only ever saw thinking a model
  *tagged*. The one that shipped opened `content` with "Here's a thinking
  process:" and a numbered analysis of the visitor's own question — no tag, no
  `delta.reasoning`, nothing for any of the three existing defences to catch —
  and on the writing assistant the same shape filled the panel with several
  hundred words of deliberation instead of a post.

  `thinkStripper()` now classifies the **opening** of a response: the first
  line, or ninety characters, tested once against a short list of openers no
  answering model uses, and on a match everything is routed into the reasoning
  channel a line at a time until a line says the answer has started —
  `Answer:`, a horizontal rule, or a labelled field line like `TITLE:`, which is
  kept because for a `document` task that line *is* the answer. Eight ordinary
  answers are in `check:ai` as the guard against the opposite failure.
  Decision 29.

- **A single provider outage took the assistant down.** `callChat` stopped its
  walk on any 4xx that was not a 429, on the reasoning that a malformed request
  will be refused identically everywhere. True of a malformed request, false of
  a **model id** — which is the field that goes stale, so a model retired
  overnight or briefly unrouteable ended the walk and the visitor was told the
  assistant could not answer. It walks models and then providers now, and only
  `401`/`403` — the credential rather than the model — ends a provider's turn.
  Decision 32.

- **A reasoning model could not be given room to think.** `maxOutputTokens` was
  clamped at 1500. A model that deliberates spends that budget *before* it
  writes anything, so the ceiling went on thinking and the answer arrived
  truncated or not at all. The ceiling is 4000; nothing is billed for headroom,
  and the failure without it is a dead answer.

- **Stopping a rewrite before the first token emptied the post.** `applyLive`
  is not a no-op for the two prose targets — it assigns what arrived, and what
  had arrived was `''`. Pressing Stop on `revise` or `summary` in the first
  moment therefore cleared the field it was about to rewrite. Undo recovered it;
  nothing said so.

- **A truncated answer in the public chat looked like a short one.** The editor
  already read `stopReason` off the `done` frame; the chat dropped it. It now
  says the answer hit the length limit, as a note under the answer rather than a
  toast — it qualifies what is on screen and belongs beside it.

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
  the SSE re-encoder, and a rule in both prompts. `parseDocument` reports
  `recognised: false` and the editor routes that response to the panel with Copy
  and Try again. Decision 29. *(Amended by the two entries above it: thinking
  travels in its own frame now rather than being discarded, and a fourth defence
  catches the narration that carries no tag at all.)*

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

- **The writing assistant is a conversation.** The same panel on both authoring
  screens, with the twelve tasks as commands inside it: `/write-whole-post`,
  `/draft-outline`, `/suggest-titles`, `/draw-diagram` and the rest, typed
  after a `/` that opens a filtered list. Plain text is a question about the
  draft. Conversations are saved, listed, reopened, deleted, and can be
  compacted into a summary when they get long. Decision 35.

- **The assistant, over a selection.** Highlight a passage in the body, press
  the button that appears, say what should change, and watch the replacement
  arrive beside it. Nothing is replaced until Replace is pressed, and Discard
  leaves the draft exactly as it was. Deliberately the one rewriting task that
  is *not* live — decision 36.

- **Providers are picked, not typed.** A vendor list fills the base URL and
  links where the key is bought, and Browse asks the provider what it serves —
  searchable, filterable by free and by context length, and multi-select for
  the fallback list. Three fields that used to be spelling tests with a 404 for
  feedback. Decision 33.

- **Sampling parameters, per provider.** Temperature, top-p, top-k, the
  penalties, min-p, top-a and a seed, each optional and each unsent when blank.
  Read through an allowlist with a range per key, so nothing stored — or typed
  — can add a field to the outbound request. `max_tokens` is deliberately not
  one of them. Decision 34.

- **Fallback models.** A provider row carries a `fallback_models` list, tried in
  order when its model will not answer — same key, same base URL, no second
  account. Set on the AI screen, comma- or newline-separated. Decision 32.

- **Thinking is shown, in a disclosure beside the answer.** Reasoning used to be
  stripped and counted; it is forwarded now as its own `{"thinking":…}` frame
  and lands in a closed `<details>` — above the answer in the public chat, above
  the output in both authoring panels. The answer is still `{"delta":…}` and
  still the only thing written into a post, a field or a bubble; the two never
  mix. A run that spent its whole budget deliberating says so *and* shows what
  it worked through, rather than reporting that the model wrote nothing.

- **The assistant panels report where the eye already is.** The status line, the
  thinking disclosure and the output moved above the task shelves in both the
  journal and project panels: a run used to finish off the bottom of a scrolled
  panel and announce "Ready" on a line nobody could see.

- **The assistant reached the project screen, and writes a project from its
  GitHub URL.** Two new tasks: `project` fills title, summary, category, tags,
  stack and highlights into the frontmatter form, and `casestudy` fills the
  structured half of a write-up. Both stream into the fields as they arrive,
  the same way `compose` fills a post, and both are undoable.

  The input that makes it worth having is the **README**, not GitHub's one-line
  description — a summary derived from the description says which language the
  project is in, and one derived from the README says what the thing does.
  `fetchRepoReadme()` is a new read in `github.ts`; it takes no path, because
  GitHub's `/readme` endpoint decides which file that is.

  `year`, `status` and `featuredRank` are deliberately **not** generated. They
  are facts about the author's relationship to the work rather than about the
  repository, and a model asked for them invents a plausible one — a wrong year
  written confidently into a field nobody re-reads is worse than an empty one.

- **No new API route for any of it.** `/api/ai/assist` already took a task name
  and a context object, so a second surface is two rows in `ASSIST_TASKS`, a
  `surface` field on the task, and a page that renders `ASSIST_MENU` filtered to
  its own name. The journal panel cannot offer a project task and the project
  panel cannot offer a journal one, and neither page decides that — the task
  does. Decision 31 is why there is no framework under this.

- **Undo goes three runs back.** It was one slot, replaced by the next run —
  which is wrong for how these actually get used, in sequence, where the run an
  author wants back is often not the last one. `undoRing()` in `admin.ts` is a
  bounded stack of field snapshots, shared by both editors; the button says how
  many steps are left and which run it will take back. Three and not more: a
  ring deep enough to be a document history is one, and nothing here survives a
  reload. A run that wrote nothing — failed, stopped early, or answered outside
  the format — drops its own snapshot rather than sitting in the ring as an Undo
  that does nothing.

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

- **One parser reads three shapes.** `parseDocument` knew the post's four field
  names, which is fine until a second thing returns labelled fields. It is now
  `parseFields(text, shape)`, and each `document` task names the key set it
  returns — `POST_KEYS`, `PROJECT_KEYS`, `CASE_STUDY_KEYS`. The forgiving-input
  rules that are the whole substance of it (preamble dropped, wrapping fence
  stripped, `**TITLE:**` accepted, the last line assumed partial) exist once
  rather than three times, and a label is only a label if the shape being read
  declares it — so `HIGHLIGHTS:` is a field in a project and an ordinary line in
  a post. `parseDocument` survives as an eight-line wrapper, so the journal
  editor did not change.

- **A task's context fields are a closed union.** `CONTEXT_LIMITS` is indexed by
  field name, and a field missing from it slices to `undefined` — which is not a
  cap, it is the whole value. A typo in a task's allowlist was therefore an
  *unbounded* field on a metered call rather than a missing one, which is the
  opposite of the failure anyone would expect. `AssistField` makes it a
  typecheck failure, and `check:ai` asserts the cap holds against what actually
  leaves rather than against the table.

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

### Removed

- **`scripts/seed-d1.mjs` and `npm run seed:d1`.** The script read
  `src/content/`, which was deleted when D1 became the source of truth, so it
  could only ever fail — `ENOENT: no such file or directory, scandir
  'src/content/case-studies'` — and it was the one command in `package.json`
  that was guaranteed to be broken for anyone who tried it. It was the one-way
  door of the move to D1 and that door has been walked through:
  `migrations/0002_seed_from_content.sql` is its frozen output, and applying the
  migrations is what brings a fresh database up. It was also the only importer
  of `yaml`, which no other file in the project uses. This does not, however,
  fix the underlying habit: it imported `yaml` and `@astrojs/markdown-remark`
  without either being declared in `package.json`, and
  `src/pages/api/content.ts` still imports the latter the same way — a direct
  import satisfied only by a transitive dependency of `astro`, which a lockfile
  refresh could remove from under it.


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
