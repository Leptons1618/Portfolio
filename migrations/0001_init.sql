-- Content schema for the D1 backend.
--
-- This file is the successor to two things at once: the Zod schemas in
-- `src/content/config.ts`, which validated one file at a time at build time,
-- and the relational half of `scripts/check-content.mjs`, which was the only
-- thing that made a bad `caseStudySlug` fail rather than silently degrade.
-- Both were build-time gates. There is no build between an edit and a reader
-- any more, so the constraints have to live where the write lands.
--
-- Three translation rules, applied throughout:
--   * A Zod enum becomes a CHECK constraint. Same closed set, enforced on
--     every write instead of once per build.
--   * A `z.array(z.string())` becomes TEXT holding a JSON array. SQLite has no
--     array type, and a join table for tags nobody queries by would be a
--     schema for a feature that does not exist.
--   * An optional field becomes a nullable column. A required one is NOT NULL,
--     so a half-filled row is rejected by the database rather than rendered.

PRAGMA foreign_keys = ON;

-- Long-form write-ups. Created before `projects` because projects reference
-- them: the foreign key below is what replaces the `caseStudySlug` check.
CREATE TABLE case_studies (
  slug                TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  subtitle            TEXT NOT NULL,
  hero_image          TEXT,
  hero_video          TEXT,
  problem             TEXT NOT NULL,
  solution            TEXT NOT NULL,
  architecture_image  TEXT,
  achievements        TEXT NOT NULL DEFAULT '[]',
  stack               TEXT NOT NULL DEFAULT '[]',
  repo_url            TEXT,
  demo_url            TEXT,
  date                TEXT NOT NULL,
  read_time           TEXT,
  -- The markdown the editor round-trips, and the HTML the reader is served.
  -- Rendering happens once on write rather than on every request: the bodies
  -- contain no code fences and no components, so the output is a pure
  -- function of the source and caching it costs one column.
  -- ponytail: re-render all rows if the markdown pipeline changes —
  -- `npm run content:rerender`.
  body_md             TEXT NOT NULL DEFAULT '',
  body_html           TEXT NOT NULL DEFAULT '',
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The primary index. Frontmatter only: no page renders a project body, so
-- there is no body column here.
CREATE TABLE projects (
  slug            TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  summary         TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN
                    ('ml-cv','ai-llm','full-stack','devtools','systems','simulation','other')),
  tags            TEXT NOT NULL DEFAULT '[]',
  stack           TEXT NOT NULL DEFAULT '[]',
  repo_url        TEXT NOT NULL,
  demo_url        TEXT,
  -- ON DELETE RESTRICT, not CASCADE: deleting a case study that a project
  -- still points at is a mistake, and the useful outcome is a refused write
  -- with a message, not a project silently losing its link.
  case_study_slug TEXT REFERENCES case_studies(slug) ON DELETE RESTRICT ON UPDATE CASCADE,
  featured_rank   INTEGER,
  status          TEXT NOT NULL CHECK (status IN ('active','stable','archived','wip')),
  year            INTEGER NOT NULL,
  hero_image      TEXT,
  highlights      TEXT NOT NULL DEFAULT '[]',
  -- Retires a project without deleting it: drops out of every listing and
  -- stops having a detail page, keeping its row and its history.
  hidden          INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0,1)),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One column, three states, so no post can contradict itself. `unpublished`
-- takes the page away rather than leaving an orphan URL reachable by anyone
-- holding the link, which is why it is one enum and not two booleans.
CREATE TABLE journal (
  slug            TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  summary         TEXT NOT NULL,
  date            TEXT NOT NULL,
  tags            TEXT NOT NULL DEFAULT '[]',
  read_time       TEXT,
  video_duration  TEXT,
  hero_image      TEXT,
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','published','unpublished')),
  body_md         TEXT NOT NULL DEFAULT '',
  body_html       TEXT NOT NULL DEFAULT '',
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Uploaded images, served by `/media/[...path]`.
--
-- These are in the database rather than in R2 for two reasons. R2 needs a
-- payment method on the account before it can be enabled at all, which the
-- free tier otherwise would not require; and an image that still had to be
-- committed to `public/` would be the last write path keeping the GitHub App
-- on Contents:write. Every image on this site is a diagram or a photograph
-- shown at most a column wide — the portrait in the repo is 21 KB.
--
-- ponytail: D1 caps a BLOB at 2 MB and the free database at 500 MB. Move this
-- one table to R2 if video ever lands or the bucket outgrows that; nothing but
-- `/media/[...path]` reads it.
CREATE TABLE media (
  path        TEXT PRIMARY KEY,
  mime        TEXT NOT NULL,
  bytes       BLOB NOT NULL,
  size        INTEGER NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Listing order for every public query: rank first, newest year breaking ties.
CREATE INDEX projects_order ON projects (hidden, featured_rank, year DESC);
CREATE INDEX journal_order  ON journal  (status, date DESC);
CREATE INDEX case_studies_order ON case_studies (date DESC);
