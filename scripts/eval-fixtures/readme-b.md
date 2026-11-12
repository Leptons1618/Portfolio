# Shelf

Shelf turns a folder of markdown notes into a browsable knowledge base. It reads
frontmatter, builds a link graph, and serves a static site with search.

## Design

- Notes are the source of truth; the site is generated output.
- Links are `[[wiki]]` references resolved against slugs, not paths.
- Search is a prebuilt inverted index shipped as JSON; there is no server.
- A note with `draft: true` is excluded from the build and from search.

The generator runs in two passes: first it parses every note and resolves links,
then it renders pages. Unresolved links are kept as text and listed in a build
report rather than failing the build.

## Limits

- No incremental build yet; a 2,000-note vault takes about four seconds.
- The search index is loaded whole, so very large vaults exceed the memory
  budget of a small device.
