/// <reference types="astro/client" />

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
   * signs in and commits; it just sends you to the App's settings and one more
   * click instead of straight to the picker.
   */
  readonly PUBLIC_GITHUB_APP_SLUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
