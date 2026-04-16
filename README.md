# Portfolio
My Portfolio Website

## GitHub Pages deployment (main branch)

This repository includes a Pages workflow at:

- `/home/runner/work/Portfolio/Portfolio/.github/workflows/deploy.yml`

### Optional custom domain setup

1. In repository **Settings → Secrets and variables → Actions → Variables**, add:
   - `CUSTOM_DOMAIN` = your domain (example: `example.com`)
   - `SITE_URL` = full URL (example: `https://example.com`)
2. In repository **Settings → Pages**, set source to **GitHub Actions**.
3. Point your domain DNS to GitHub Pages.
