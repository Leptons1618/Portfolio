-- Private repositories must not render a Repo button.
--
-- The report pass found three repo links 404ing because the repositories were
-- made private. The fix is content, not a toggle: a project with no
-- `repo_url` renders no repository button anywhere, the same way a project
-- with no `demo_url` renders no demo button.
--
-- Two things stand between here and that state:
--
--   1. `projects.repo_url` is NOT NULL, inherited from when every project was
--      a public GitHub import. A nullable column is the honest type for "no
--      public repo", so the table is rebuilt. SQLite cannot alter a column in
--      place; the twelve-step copy is done explicitly below. No table
--      references `projects`, so the rebuild does not have to dance around
--      inbound foreign keys.
--   2. The three projects whose repositories went private get the field
--      cleared, matched on URL rather than on slug so a row added after this
--      file was written is caught the same way.

ALTER TABLE projects RENAME TO projects_old;

CREATE TABLE projects (
  slug            TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  summary         TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN
                    ('ml-cv','ai-llm','full-stack','devtools','systems','simulation','other')),
  tags            TEXT NOT NULL DEFAULT '[]',
  stack           TEXT NOT NULL DEFAULT '[]',
  -- Nullable: absent means "no public repository" — private, deleted, or
  -- simply unmapped. Every render site branches on it like `demo_url`.
  repo_url        TEXT,
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

INSERT INTO projects (
  slug, title, summary, category, tags, stack, repo_url, demo_url,
  case_study_slug, featured_rank, status, year, hero_image, highlights,
  hidden, updated_at
)
SELECT
  slug, title, summary, category, tags, stack, repo_url, demo_url,
  case_study_slug, featured_rank, status, year, hero_image, highlights,
  hidden, updated_at
FROM projects_old;

DROP TABLE projects_old;

-- Same shape as 0001; the old index died with the renamed table.
CREATE INDEX projects_order ON projects (hidden, featured_rank, year DESC);

-- The repositories that went private. Matched on URL: slugs drift, URLs do
-- not, and any case study pointing at the same dead link is cleared with it.
UPDATE projects
SET repo_url = NULL
WHERE repo_url IN (
  'https://github.com/Leptons1618/AXCAD',
  'https://github.com/Leptons1618/ignition-copilot-designer',
  'https://github.com/Leptons1618/QueryPilot'
);

UPDATE case_studies
SET repo_url = NULL
WHERE repo_url IN (
  'https://github.com/Leptons1618/AXCAD',
  'https://github.com/Leptons1618/ignition-copilot-designer',
  'https://github.com/Leptons1618/QueryPilot'
);
