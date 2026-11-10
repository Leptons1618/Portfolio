-- A case study's overview facts, and whether its write-up is read as chapters.
--
-- `role` and `team` say what the owner did, which a write-up of a team project
-- tends to blur. `metrics` and `links` are JSON arrays of strings, the same
-- encoding as `achievements` — one "<value> | <label>" or "<Label> | <url>"
-- per line, split on the first " | " when the page renders, so the write
-- boundary, the CLI and the MCP server needed no new encoder. A link that is
-- not http(s) is dropped at render, because it becomes an `href` on this
-- origin. No assistant task writes any of the four: a number in front of a
-- recruiter is the owner's to type.
--
-- `paged` splits the write-up at each `## ` into its own page under
-- /case-studies/<slug>/<heading id>. Off by default, so every existing study
-- renders as it did; a two-minute read split into one-paragraph pages would be
-- worse, and the author decides. Decision 81.
ALTER TABLE case_studies ADD COLUMN role TEXT;
ALTER TABLE case_studies ADD COLUMN team TEXT;
ALTER TABLE case_studies ADD COLUMN metrics TEXT NOT NULL DEFAULT '[]';
ALTER TABLE case_studies ADD COLUMN links TEXT NOT NULL DEFAULT '[]';
ALTER TABLE case_studies ADD COLUMN paged INTEGER NOT NULL DEFAULT 0 CHECK (paged IN (0,1));
