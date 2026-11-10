-- The drafts the owner kept, as markdown: one `## Contact · Channel` section each.
--
-- Text rather than JSON for the reason `fit` is: it is read and edited by a
-- person, and the CLI, the MCP server and the `jobs` skill keep working on plain
-- markdown. `src/lib/job-view.ts` parses the sections on read; nothing about a
-- draft is a column of its own. Decision 83.
ALTER TABLE applications ADD COLUMN outreach TEXT;
