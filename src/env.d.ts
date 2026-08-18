/// <reference types="astro/client" />

/**
 * The Cloudflare binding, typed by hand — deliberately, and this is the reason.
 *
 * `wrangler types` generates `worker-configuration.d.ts`: an `Env` interface,
 * and fifteen thousand lines of workerd runtime types declared **globally**.
 * Those globals include an `Element` whose `remove()` returns `Element` (it is
 * HTMLRewriter's), and TypeScript merges it with the DOM's `Element`, whose
 * `remove()` returns `void`. The merge is illegal, so every `HTMLElement`
 * subtype in this project stops satisfying `HTMLElement` — and this project is
 * half browser code. Generating that file turned a green `astro check` into
 * twenty-odd errors in `admin/resume.astro` and `admin/projects/[slug].astro`,
 * files that have nothing to do with Cloudflare.
 *
 * There is no scoping flag that fixes it: a `.d.ts` full of `declare global` is
 * global wherever it is referenced from. So the runtime types are not part of
 * this project, and what is written below is the exact surface `content.ts`
 * and the API routes call — nothing more.
 *
 * ponytail: hand-written types can drift from the platform. This is five
 * methods of a stable API; if it grows past that, install
 * `@cloudflare/workers-types` and give the browser code its own tsconfig
 * project rather than widening this by hand.
 */

/** The subset of D1's client this codebase uses. */
interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { changes: number; duration: number; last_row_id: number };
}

interface D1PreparedStatement {
  /** Positional `?` parameters. Values only — never a table or column name. */
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface Env {
  DB: D1Database;
}

/**
 * `Astro.locals.runtime.env.DB` — how every content route reaches the database.
 *
 * Declared structurally rather than through the adapter's `Runtime<Env>` helper
 * for the same reason as above: that helper's generic resolves through the
 * workers types, and pulling them in is what breaks the browser code.
 */
declare namespace App {
  interface Locals {
    runtime: {
      env: Env;
      /** Present at runtime; nothing here uses it, so it stays unmodelled. */
      ctx: { waitUntil(promise: Promise<unknown>): void };
    };
  }
}

interface ImportMetaEnv {
  /**
   * GitHub App client ID (`Iv23…`). Public by design — it identifies the app,
   * it does not authorise anything. Must equal `GITHUB_CLIENT_ID` in
   * `workers/github-oauth/wrangler.toml`.
   */
  readonly PUBLIC_GITHUB_CLIENT_ID?: string;
  /**
   * Origin of the deployed token-exchange Worker, e.g.
   * `https://portfolio-github-oauth.<subdomain>.workers.dev`. No trailing slash.
   */
  readonly PUBLIC_GITHUB_OAUTH_WORKER?: string;
  /**
   * The App's slug — the last segment of `github.com/settings/apps/<slug>`,
   * which is not the client ID and cannot be derived from it. Optional: it
   * only builds the link to GitHub's repository picker. Unset, the admin still
   * signs in and saves; it just sends you to the App's settings and one more
   * click instead of straight to the picker.
   */
  readonly PUBLIC_GITHUB_APP_SLUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
