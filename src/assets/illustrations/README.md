# Illustrations

Vector artwork from [unDraw](https://undraw.co), pulled from the MIT-licensed
`undraw-svg@2.0.0` mirror on npm. unDraw's own licence permits free commercial
use with no attribution required; this file is a provenance record, not an
attribution requirement.

| File | unDraw name | Used by |
| --- | --- | --- |
| `blogging.svg` | blogging | `/journal` header |
| `developer-activity.svg` | developer-activity | `/about` |
| `github-profile.svg` | github-profile | `/admin` sign-in |
| `no-data.svg` | no-data | `/projects` empty filter result |
| `the-void.svg` | the-void | `/admin/projects` with nothing tracked |
| `empty-mailbox.svg` | empty-mailbox | import modal and journal list, nothing matched |
| `taking-notes.svg` | taking-notes | `/admin/journal` with no entries |
| `code-inspection.svg` | code-inspection | `/admin/projects/[slug]` with no case study linked |
| `personal-settings.svg` | personal-settings | the identity modal in the admin rail |
| `fixing-bugs.svg` | fixing-bugs | the admin error boundary |
| `playful-cat.svg` | playful-cat | `/admin/dashboard` with no content yet |

## Recoloring

The flat unDraw palette was rewritten once, on download, to this repository's
design tokens so the artwork follows whichever theme is active. Skin tone was
deliberately left literal, and `currentColor` — unDraw's primary-colour slot —
is left alone so each caller decides it with a `color` on the wrapper.

| unDraw | Token |
| --- | --- |
| `#d6d6e3`, `#b6b3c5` | `var(--color-accent-200)` |
| `#ff6584` | `var(--color-accent-2)` |
| `#090814`, `#3f3d56` | `var(--color-text)` |
| `#2f2e41` | `var(--color-neutral-800)` |
| `#535461`, `#454b69` | `var(--color-neutral-700)` |
| `#e6e6e6`, `#e5e5e5`, `#e4e4e4` | `var(--color-neutral-300)` |
| `#f2f2f2`, `#f0f0f0` | `var(--color-neutral-200)` |
| `#ccc`, `#cacaca`, `#d0d2d5` | `var(--color-neutral-400)` |
| `#fff` | `var(--color-bg)` |
| `#ed9da0`, `#ffb6b6`, `#ffb7b7`, `#ffb9b9`, `#feb8b8` | *unchanged* |

Because the fills are custom properties, these files only render correctly when
**inlined** — always go through `src/components/Illustration.astro`, never an
`<img src>`.
