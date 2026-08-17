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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
