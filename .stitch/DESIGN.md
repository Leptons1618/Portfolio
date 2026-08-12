---
name: Anish Giri Portfolio (Current State)
colors:
  background: '#0f0a1e'
  surface: '#160d30'
  surface-secondary: '#191036'
  surface-tertiary: '#241847'
  on-background: '#eee6ff'
  on-surface-variant: '#a293cf'
  outline: '#43307a'
  primary: '#00e756'
  on-primary: '#071408'
  primary-hover: '#4dff8f'
  primary-subtle: '#00913a'
  secondary: '#ff2e97'
  tag: '#29adff'
  tag-container: '#241847'
  success: '#00e756'
  warning: '#ffec27'
  error: '#ff004d'
  header: 'rgba(15, 10, 30, 0.92)'
  glow: 'rgba(0, 231, 86, 0.18)'
  paper-background: '#f4efe3'
  paper-surface: '#fbf7ec'
  paper-on-background: '#2f2a20'
  paper-on-surface-variant: '#6e6450'
  paper-outline: '#d5cab0'
  paper-primary: '#29537a'
  paper-on-primary: '#faf6ea'
  paper-secondary: '#b3402e'
typography:
  display-hero:
    fontFamily: 'Press Start 2P'
    fontSize: clamp(1.25rem, 3.4vw, 2.1rem)
    fontWeight: '700'
    lineHeight: 1.55
    letterSpacing: '0'
  display-hero-paper:
    fontFamily: 'Special Elite'
    fontSize: clamp(2rem, 5vw, 3.5rem)
    fontWeight: '700'
    lineHeight: 1.15
    letterSpacing: '0'
  body:
    fontFamily: VT323
    fontSize: 17px
    fontWeight: '400'
    lineHeight: 1.5
    letterSpacing: 0.01em
  body-paper:
    fontFamily: 'IBM Plex Serif'
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 1.65
    letterSpacing: '0'
  mono:
    fontFamily: 'JetBrains Mono Variable'
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.4
    letterSpacing: '0'
  section-title:
    fontFamily: 'Press Start 2P'
    fontSize: 1rem
    fontWeight: '700'
    lineHeight: 1.5
    letterSpacing: '0'
  label-caps:
    fontFamily: 'JetBrains Mono Variable'
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1.2
    letterSpacing: 0.15em
rounded:
  sm: 0px
  DEFAULT: 0px
  md: 0px
  lg: 0px
  chip: 0px
  paper-sm: 3px
  paper-md: 5px
  paper-lg: 8px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  section: 64px
  gutter: 24px
  container-max: 1200px
  header-height: 60px
---

# Design System: Anish Giri Portfolio (Current-State Baseline)

**Source of truth:** Astro static site in `D:\Misc\Portfolio` (`src/styles/theme.css`, `src/styles/global.css`, layouts, pages, components).
**Purpose:** Faithful visual baseline for Stitch comparison — not a redesign.
**Default theme:** `pixel` (dark). Alternate: `paper` (light). `system` resolves to OS preference.

## 1. Visual Theme & Atmosphere

This portfolio is a **dual-theme personal product site** for an ML/CV and full-stack engineer. The default **Pixel** theme is a PICO-8-adjacent arcade CRT: deep violet-black canvas (`#0f0a1e`), neon green accent (`#00e756`), magenta secondary (`#ff2e97`), hard offset shadows, zero corner radius, chunky 2px borders, scanline overlay, and stepped “boot” motion. Body type is VT323; headings use Press Start 2P.

The alternate **Paper** theme is a workbench desk: warm cream graph paper (`#f4efe3`), ink navy accent (`#29537a`), rust secondary (`#b3402e`), soft warm shadows, slight card rotation and torn-edge pseudo-elements, typewriter headings (Special Elite) and IBM Plex Serif body. Density is **daily-app balanced**: sticky shell + card grids of projects/case studies, not a dashboard.

Do not invent screens. Existing routes only: `/`, `/projects`, `/projects/[slug]`, `/case-studies/[slug]`, `/about`, `/resume`.

## 2. Color Palette & Roles

### Primary Foundation (Pixel — default)
- **Arcade Void** (`#0f0a1e`) — Page canvas (`--color-bg`)
- **Cabinet Panel** (`#191036`) — Secondary surface
- **Cabinet Recess** (`#241847`) — Tertiary / alt surface / tag bg
- **Cartridge Card** (`#160d30`) — Card fill
- **Circuit Border** (`#43307a`) — Borders and card edges
- **Sticky Glass Header** (`rgba(15, 10, 30, 0.92)`) — Sticky header with blur

### Accent & Interactive (Pixel)
- **Phosphor Green** (`#00e756`) — Primary CTA, links, success, focus
- **Phosphor Lift** (`#4dff8f`) — Primary hover
- **Phosphor Dim** (`#00913a`) — Subtle accent / chip active fill partner
- **Hot Magenta** (`#ff2e97`) — Secondary accent
- **HUD Cyan** (`#29adff`) — Tag text
- **Ink on Phosphor** (`#071408`) — Text on primary buttons
- **Glow Wash** (`rgba(0, 231, 86, 0.18)`) — Soft neon glow / CTA radial

### Typography & Text Hierarchy (Pixel)
- **Lavender Ink** (`#eee6ff`) — Primary text
- **Muted Violet** (`#a293cf`) — Muted body, meta, secondary links

### Functional States (Pixel)
- **Success** (`#00e756`) — Same as accent; status “active”
- **Warning** (`#ffec27`) — Status “wip”
- **Error** (`#ff004d`) — Error token (rarely surfaced in UI)

### Gradient
- **Pixel gradient text:** `linear-gradient(90deg, #00e756 0%, #29adff 100%)` — hero emphasis + nav underline

### Paper Theme (alternate — document, do not mix into Pixel screens)
- Canvas `#f4efe3`, surfaces `#faf6ea` / `#eae3d1` / `#fbf7ec`, ink `#2f2a20`, mute `#6e6450`, border `#d5cab0`
- Accent `#29537a` / hover `#1d3f5e` / on-accent `#faf6ea`, secondary `#b3402e`
- Success `#3f7d3f`, warning `#9a6b1a`, error `#b3402e`
- Gradient text: `linear-gradient(120deg, #29537a 30%, #b3402e 100%)`

## 3. Typography Rules

### Families
- **Pixel heading:** Press Start 2P (chunky pixel display)
- **Pixel body/display:** VT323 (terminal-like UI body; root `font-size: 17px` under pixel)
- **Paper heading:** Special Elite (typewriter)
- **Paper body:** IBM Plex Serif 400/600
- **Shared mono:** JetBrains Mono Variable — logo, meta labels, chips, code

### Hierarchy & Weights (as shipped)
- Hero H1 (paper-like clamp): up to ~3.5rem; Pixel overrides hero to ~1.25–2.1rem with line-height 1.55
- Page H1 (About/Resume): ~2.5rem
- Section titles: ~1.5rem generally; Pixel forces ~1rem Press Start
- Card titles: ~1.05rem; Pixel ~0.8rem
- Body muted: ~0.875–1.1rem, line-height ~1.5–1.7
- Labels / hero eyebrow: mono 0.75rem, letter-spacing 0.15em, accent color
- Headings globally: `font-weight: 700`, family `--font-heading`

### Spacing Principles
- Section vertical padding ~4rem (`section { padding: 4rem 0 }`); hero ~6rem top
- Container max-width 1200px (About/Resume content ~800px), horizontal padding 1.5rem
- Card internal padding 1.5rem; chip/badge padding ~0.2–0.65rem
- No formal spacing token scale beyond CSS vars for radius/border/shadow — values are ad-hoc rem

## 4. Component Stylings

### Buttons (`.btn`, `.btn-primary`, `.btn-outline`, `.btn-sm`, `.btn-xs`)
- Inline-flex, gap 0.5rem, padding ~0.5×1.25rem (sm/xs smaller)
- Primary: accent fill + accent border; text `--color-accent-fg`
- Outline: transparent fill, accent text, border `--color-border`; hover fills tag-bg
- Pixel: uppercase, 2px text-colored border, hard 3px offset shadow; hover `translate(-1px,-1px)`; active `translate(2px,2px)`
- Paper: Special Elite; hover slight lift + tiny rotate

### Cards (`.card`)
- Fill `--color-card-bg`, border `--border-width` + `--color-card-border`, radius `--radius-md`, shadow `--shadow-card`
- Hover: `--shadow-hover`, border accent; Pixel also `translate(-2px,-2px)`; Paper torn edges + slight rotate settle
- Used for: ProjectCard, featured case-study teasers, CTA box, sidebars, related project links

### Badges & Chips
- `.badge` — tag bg/text + 1px border; hover accent border (Pixel inverts to accent fill)
- `.chip` — FilterBar category/tag toggles; active accent border/text
- `.skill-chip` / `.stack-chip` / `.stack-badge` — similar mono/small labels, non-interactive or decorative

### Navigation
- Sticky header 60px, blur 14px, bottom border
- Logo: mono `[Anish Giri]` with accent brackets
- Links: Home, Projects, About, Resume — muted text; active/hover underline via gradient scaleX
- Header actions: GitHub ↗, LinkedIn ↗ outline sm buttons + ThemeToggle
- **Responsive:** `.main-nav { display: none }` at max-width 640px — no hamburger (current behavior; document faithfully)
- Footer: copyright + GitHub, LinkedIn, Resume, About

### Theme Toggle
- Button cycling System → Pixel → Paper; emoji + text label; aria-label updates
- Border 1px, secondary surface fill

### Inputs & Forms (Projects library only)
- Search input + native select for sort (Featured / Newest / A–Z)
- Secondary surface fill, 1px border, radius `--radius-sm`
- Focus: accent border (search clears outline)
- No other forms, dialogs, tables, charts, toasts in product

### Domain: Project Card
- Year + status (featured) or year + category (library inline cards)
- Title link, summary, up to 4 tags, up to 5 stack chips
- Actions: Details (primary), optional Case Study, Repo ↗, optional Demo ↗
- Optional hero image when present (content currently rarely sets images)

### Domain: Case Study Layout
- Hero media (video/image/placeholder) + title, subtitle, date, read time, Repo/Demo
- Body grid: main (Problem, Solution, MDX slot, optional Architecture) + sidebar (Achievements, Stack)
- Prev/Next case study nav
- Sidebar stacks above main on ≤768px

### Domain: Filter Bar
- Search, sort select, category chips (All + categories), top-16 tag chips
- Client-side filter with URL query sync; empty copy: “No projects match your filters.”

## 5. Layout Principles

### Grid & Structure
- Shell: Header → `<main>` → Footer
- `PageLayout` adds min-height `calc(100vh - 60px - 80px)`
- Content width 1200px centered; prose pages 800px
- Home: left-aligned hero (max ~700px), then auto-fill grids (`minmax(260px|320px, 1fr)`)
- Detail/case study: 1fr + ~280–300px sidebar; collapse to 1 column ≤768px

### Page Templates (existing only)
1. **Home `/`** — Hero (status, eyebrow, H1 with gradient phrase, desc, 3 CTAs) → Featured Case Studies → Featured Projects → Skills & Stack → CTA card
2. **Projects `/projects`** — Page header → FilterBar → results count → project grid → empty message
3. **Project detail `/projects/[slug]`** — Meta, H1, summary, Highlights, Related → sidebar Links/Tags/Stack
4. **Case study `/case-studies/[slug]`** — CaseStudyLayout template above
5. **About `/about`** — H1, lead, photo+bio grid, lists, link row
6. **Resume `/resume`** — H1, Contact, Summary, Experience, Skills, Certifications, Education

### Whitespace Strategy
- Generous section padding (4rem); hero more open at top
- Card grids gap 1.5rem
- Macro whitespace between sections; micro gaps 0.35–0.75rem inside chips/actions

### Responsive Behavior
- Breakpoints in use: **640px** (nav hide, about profile stack), **768px** (detail/case grids)
- Chip rows wrap; button rows wrap
- Prefer documenting current gaps (no mobile nav) over inventing a menu

### Interaction States
- Links: accent → accent-hover
- Focus-visible: 2px accent outline, 2px offset
- Card/button hover transforms as above
- `prefers-reduced-motion`: animations/transitions nearly disabled; smooth scroll off
- Pixel: CRT scanlines fixed overlay; `pixel-boot` on main; blinking cursor after `.hero-title`
- Paper: `paper-settle` entrance; dashed chip borders; torn card edges

### Navigation / IA (preserve terminology)
- Labels: Home, Projects, About, Resume, Project Library, Featured Case Studies, Featured Projects, Skills & Stack, Case Study, Details, Repo, Demo, Highlights, Related Projects, Problem, Solution, Achievements, Stack
- Case studies reachable from Home cards and project links — **no dedicated case-studies index or nav item** (current IA)

## 6. Design System Notes for Stitch Generation

### Language to Use
- “Arcade CRT portfolio shell with sticky glass header and hard neon cards” (Pixel)
- “Graph-paper workbench with torn sheet cards and typewriter headings” (Paper)
- Preserve exact labels and routes; dual theme via `data-theme`

### Color References
Use descriptive names above with hex. Default screens to **Pixel** unless capturing Paper explicitly.

### Component Prompts (baseline fidelity — not redesign)
- Sticky header with `[Anish Giri]` mono logo, text nav Home/Projects/About/Resume, outline GitHub and LinkedIn, theme cycle button
- Project card with year, status dot, title, summary, tag badges, stack chips, Details/Case Study/Repo actions, hard green-accent border on hover
- Filter bar: search field, Featured/Newest/A–Z select, category chips, tag chips

### Incremental Iteration
- Capture each existing route as a separate Stitch screen titled by route path
- Do not add contact forms, dashboards, mobile drawers, or case-study index unless they exist in code
- After redesign phase, diff against these baseline screens and this DESIGN.md

### Screens to Capture (inventory)
| Route title | Source page |
|-------------|-------------|
| `/` | `src/pages/index.astro` |
| `/projects` | `src/pages/projects.astro` |
| `/projects/[slug]` | `src/pages/projects/[slug].astro` (representative project with case study) |
| `/case-studies/[slug]` | representative MDX case study |
| `/about` | `src/pages/about.astro` |
| `/resume` | `src/pages/resume.astro` |

Optional second pass: same six routes with `data-theme="paper"`.
