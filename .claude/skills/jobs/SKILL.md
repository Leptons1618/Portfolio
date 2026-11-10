---
name: jobs
description: The owner's job search — track applications, assess fit against a job description, tailor a resume variant to a posting, draft outreach to recruiters, HR and hiring managers, review the pipeline for follow-ups, and suggest LinkedIn profile edits from a LinkedIn data export. Use when the user pastes a job posting, asks how well they fit a role, wants a resume tailored, wants a message to someone at a company, asks what needs a follow-up, or wants their LinkedIn profile reviewed. Works through the portfolio_* MCP tools (kind "application") or the `portfolio` CLI; load the `portfolio` skill too.
---

# Job search

The tracker is the `applications` table, read and written through the same
`portfolio_*` tools and `portfolio` CLI as everything else on the site (kind
`application`, or `job`). It is **private**: no page renders a row and the public
assistant cannot see one. The resume it tailors is the `resume` document. Decision 79.

## Two things you never do

- **Never touch linkedin.com.** No fetch, no browser tool, no "just reading the
  page". LinkedIn has no API for profiles, jobs or messages, its pages are behind
  a login, and automating them breaks its User Agreement and gets accounts
  restricted — and the account at stake is the one the owner is job-hunting
  with. The owner copies; you read what they paste. A posting on a company's own
  careers page, Greenhouse, Lever or Ashby can be fetched. A `linkedin.com/jobs`
  URL cannot: ask for the text.
- **Never send anything.** You draft; the owner sends. There is no tool here
  that sends, and none should be improvised.

## Where things are

| Thing | Read it with |
| --- | --- |
| Applications | `portfolio_list application`, `portfolio_get application <slug>` |
| Resume — master and variants | `portfolio_get doc resume` |
| Projects — the evidence | `portfolio_list project`, `portfolio_get project <slug>` |
| The site's origin, for links | `portfolio_whoami` |
| LinkedIn profile | The owner's unzipped data export (LinkedIn → Settings → Data privacy → Get a copy of your data). Ask for the folder. `Profile.csv`, `Positions.csv`, `Skills.csv`, `Projects.csv`, `Education.csv`, `Certifications.csv`. Read it from disk; never store it anywhere. |

## The row

`company` and `role` are required; everything else is optional.

| Field | What goes in it |
| --- | --- |
| `status` | `saved` → `applied` → `screening` → `interview` → `offer`, or `rejected` / `withdrawn`. A closed set; defaults to `saved`. Change it only when the owner says what happened. |
| `url` | The posting. |
| `jobDescription` | The advert, **verbatim**. Not a summary — postings get taken down, and the fit and the variant are both answers to this text. |
| `fit` | The assessment, as markdown (below). |
| `outreach` | Kept drafts, as markdown: one `## Contact · Channel` section each. The channel labels are LinkedIn note, LinkedIn message, Referral ask, Email and Follow-up. Keeping a new draft for the same contact and channel replaces the old one. The screen's Mark sent appends a dated note; you never send anything. |
| `resumeVariant` | The `id` of a variant in the resume document. |
| `contacts` | A list of `"Name — title — profile URL"`. Only people the owner named or pasted. Never look anyone up, never guess an email. The CLI's `contacts=` splits on commas, so an entry with a comma in it ("Director, Engineering") goes in through `portfolio edit` or the MCP tools. |
| `appliedOn`, `nextOn` | `YYYY-MM-DD`. Nothing checks the format, and "what's due" compares them as text — so get it right. |
| `nextStep` | One line: "Follow up with Priya", "Take-home due". |
| `notes` | Append, never overwrite — `portfolio_get` first. Dated lines: `2026-11-08 — LinkedIn note to Priya (sent by owner)`. |

The slug is `<company>-<role>`, lowercase and hyphenated, kept short:
`acme-senior-backend`. It is the row's key, not a public URL, but it still never
changes. List first: if the company and role already have a row, update it.

There is a screen for all of this too — `/admin/jobs` — and the owner may be
using it alongside you. It reads and writes the same rows.

From a shell, the pasted-advert flow is one line:

```sh
portfolio create application acme-senior-backend company=Acme role="Senior Backend Engineer" \
  url=https://… jobDescription="$(pbpaste)"
```

## Find postings

The `job-watchlist` document lists the boards to scan — `greenhouse`, `lever`
or `ashby`, plus the board's name from its careers URL — with title keywords,
exclusions and locations. `portfolio jobs` lists what is new and matching;
`portfolio jobs --save` tracks each as `saved`, advert included. To change the
watchlist, `portfolio_get doc job-watchlist`, edit, and `portfolio_update` the
whole document. `remote` matches remote roles anywhere, including US-only ones:
read the location before calling one a fit.

## Assess fit

Read the application, the resume master and the project list (and a project's
full row when it is the evidence for something). Write `fit` in this shape, then
report the verdict and the top two gaps in chat:

```markdown
**Verdict:** Strong / Reasonable / Stretch / Poor — one sentence why.
**Score:** 7/10 — mostly the must-haves.

### Must-haves
- ✅ 5+ years of Python — six years across <role> and <role>
- ⚠️ Kubernetes in production — adjacent: Docker on ECS at <company>. Say adjacent.
- ❌ Go — nothing in the record

### Nice-to-haves
- …

### Gaps worth closing
- Small and concrete: a line the resume is missing for work that already happened,
  a project that shows the thing, a certification.

### Keywords for the ATS
Terms from the advert that are true of the owner and missing from the resume.

### Projects to lead with
- <project-slug> — one sentence saying why this project makes the case for this role

### Resume
An existing variant id that fits, or "new variant" and what it should select.
```

**Every ✅ cites evidence** from the resume or a project row. Adjacent experience
is ⚠️ and named as adjacent. A requirement stated in years is counted from the
roles' `start`/`end`, not estimated. A generous score helps nobody: it decides
where the owner spends a week of applications.

**Three to five projects**, strongest first — fewer only when fewer genuinely
fit. The slug must be one from `portfolio_list project`, and read the project
before writing its line.

## Tailor the resume

The admin's Resume screen does this with `build-variant` — paste the advert and
it builds the variant. From here:

1. **Reuse before you add.** A variant is a view of the master, not a copy
   (decision 39). If one already fits ("Backend, fintech"), point the application
   at it. Twelve near-identical variants is noise.
2. Otherwise `portfolio_get doc resume`, append one entry to `variants`, and
   `portfolio_update doc resume` with the **whole** document — an update on a doc
   replaces it.
3. Shape:
   `{ id, label, summary, layout: "ats", headline, jobDescription,
   experience: [{ id, description?, highlights? }], skills: [{ category, items? }],
   education: [id], certifications: [name], projects: [{ slug, line? }] }`
4. **Copy every id from the master** — `experience[].id`, `education[].id`,
   `skills[].category`, the certification strings, project slugs from
   `portfolio_list project`. An unknown id is dropped silently when the resume
   renders, so a typo is a missing section rather than an error.
5. The summary, the headline and a role's highlights may be **reframed** for the
   job. Facts may not change: no new numbers, titles, dates or tools. No contact
   details — the `portfolio` skill says why.
6. Set the application's `resumeVariant` to the id, and tell the owner to check it
   at `/admin/resume` before sending it anywhere.

## Draft outreach

Read the application (advert and fit), the resume, and whatever the owner says
about the person. Then draft for the channel they name:

| Channel | Limit |
| --- | --- |
| LinkedIn connection note | **200 characters** on a free account (300 on Premium). Free accounts get only a handful of personalised notes a month — if the owner is drafting many, say so. Show the character count. |
| LinkedIn message / InMail | About 600 characters. Three short paragraphs at most. |
| Email | A subject and under 150 words. |

Every draft has exactly three things: **one specific reason** for this company
or role, taken from the advert; **one piece of evidence**, a project page on the
site or a result from the resume; and **one clear ask** — a referral, fifteen
minutes, a look at an application already in. The ask differs by who it is for:
a recruiter is asked about the process, a hiring manager about the team's
problem, an engineer for a referral. No flattery, no "I hope this finds you
well", nothing beyond the record. Two variants at most.

When the owner says it went out: append a dated line to `notes`, set `nextStep`
to the follow-up and `nextOn` a week out.

## Review the pipeline

`portfolio_list application` returns status and dates for every row. Report, as
one short table:

- `nextOn` before today — overdue.
- `applied` or `screening` more than ten days ago with no `nextStep` — suggest a
  follow-up.
- `interview` with nothing on `nextOn` — ask what is scheduled.

Change nothing in passing. Statuses move when the owner says what happened.

## Review the LinkedIn profile

Read the export's profile files, the resume master, and the target roles (from
the variants, or ask). Return paste-ready text per section — the owner edits
LinkedIn by hand:

- **Headline** — up to 220 characters. What they do and for whom, not a list of
  buzzwords.
- **About** — the first two lines are what shows before "see more"; make them
  count.
- **Experience** — where a title or a date on LinkedIn disagrees with the resume,
  **flag it and do not pick a side**. The owner knows which is right. Bullets come
  from the resume's highlights.
- **Skills** — which to add and which to drop for the target roles, each one
  evidenced. Which to pin at the top.
- **Featured** — the project pages worth linking, from the live site.

## Privacy

- Nothing from an application — a company, a contact, a note — goes into a
  journal post, a project, a case study or the resume. The tracker is private;
  the rest of the site is not.
- Contacts are other people's details. Store only what the owner gave you.
- The LinkedIn export also holds messages and connections. Read only the
  profile files above.
