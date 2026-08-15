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

## Recoloring

The flat unDraw palette was rewritten once, on download, to this repository's
design tokens so the artwork follows whichever theme is active. Skin tone was
deliberately left literal.

| unDraw | Token |
| --- | --- |
| `#d6d6e3` | `var(--color-accent-200)` |
| `#090814`, `#3f3d56` | `var(--color-text)` |
| `#2f2e41` | `var(--color-neutral-800)` |
| `#535461` | `var(--color-neutral-700)` |
| `#e6e6e6` | `var(--color-neutral-300)` |
| `#f2f2f2` | `var(--color-neutral-200)` |
| `#ccc` | `var(--color-neutral-400)` |
| `#fff` | `var(--color-bg)` |
| `#ed9da0` | *unchanged* |

Because the fills are custom properties, these files only render correctly when
**inlined** — always go through `src/components/Illustration.astro`, never an
`<img src>`.
