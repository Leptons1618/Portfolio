-- The structured explainer every project has, so a reader who lands on a
-- project page gets a picture of the system without a case study and without an
-- image upload. Decision 85.
--
-- `plain` is prose the owner (or the assistant, into the form) writes. `flow`
-- is a list of "Step name | what happens here" strings — the same convention
-- `metrics` and `links` already use, read by `flowOf()` in `chapters.ts`. The
-- important half of this design is that the flow is *data*: it renders in theme
-- tokens, works in dark mode and print, needs no Mermaid, and can be drafted
-- from a README without a browser.
--
-- `gallery` is a list of "/media/… | caption" paths. Only `/media/` is rendered;
-- anything else is dropped, the same rule `linksOf()` applies to hrefs, because
-- the path becomes an `<img src>`. Screenshots are uploads, so no assistant task
-- may write this column.
ALTER TABLE projects ADD COLUMN plain TEXT;
ALTER TABLE projects ADD COLUMN flow TEXT NOT NULL DEFAULT '[]';
ALTER TABLE projects ADD COLUMN gallery TEXT NOT NULL DEFAULT '[]';
